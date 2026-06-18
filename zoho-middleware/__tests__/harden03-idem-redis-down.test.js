'use strict';

// ---------------------------------------------------------------------------
// HARDEN-03 gap test: idempotency_key + Redis-down prod gate
//
// Requirement: A second POST /api/checkout with the same idempotency_key when
// Redis is unavailable returns 409 (no duplicate Zoho order) in production.
// Same guard must be fail-OPEN in dev (proceeds to checkout).
//
// Why a separate file: checkout-route.test.js loads the real app at file scope
// without mocking checkout-helpers. To stub verifyRecaptcha (so it passes in
// prod without a live RECAPTCHA_SECRET_KEY), we must hoist jest.mock before
// require('../server') — that is only possible in a fresh Jest module scope.
// ---------------------------------------------------------------------------

// --- MUST be declared before any require() ---

// Stub verifyRecaptcha to return {success:true, score:1} so the reCAPTCHA gate
// does NOT fire — this lets us reach the idempotency-key Redis-down catch.
jest.mock('../lib/checkout-helpers', function () {
  var real = jest.requireActual('../lib/checkout-helpers');
  return Object.assign({}, real, {
    verifyRecaptcha: jest.fn().mockResolvedValue({ success: true, score: 1.0 })
  });
});

// Server boot mocks (identical set to checkout-route.test.js)
jest.mock('../lib/zohoAuth', function () {
  return {
    init: jest.fn().mockResolvedValue(),
    isAuthenticated: jest.fn().mockReturnValue(true)
  };
});
jest.mock('../lib/validateEnv', function () { return jest.fn(); });
jest.mock('../lib/checkRedis', function () { return jest.fn().mockResolvedValue(); });
jest.mock('../lib/checkMailer', function () { return jest.fn(); });
jest.mock('../lib/brewpad-integration', function () {
  return { syncBatch: jest.fn(), init: jest.fn(), createBatchesFromSale: jest.fn() };
});
jest.mock('node-cron', function () { return { schedule: jest.fn() }; });
jest.mock('@sentry/node', function () {
  return { init: jest.fn(), setupExpressErrorHandler: jest.fn() };
});
jest.mock('../lib/mailerlite', function () {
  return { isConfigured: jest.fn().mockReturnValue(false), addSubscriber: jest.fn().mockResolvedValue() };
});
jest.mock('../lib/eventLog', function () {
  return { logEvent: jest.fn() };
});
jest.mock('../lib/inventory-ledger', function () {
  return { decrementStock: jest.fn().mockResolvedValue() };
});
jest.mock('../lib/helcim', function () {
  return {
    isEnabled: jest.fn().mockReturnValue(false),
    initializeCheckout: jest.fn().mockResolvedValue({ checkoutToken: 'tok-test' }),
    getDepositAmount: jest.fn().mockReturnValue(10000),
    voidTransaction: jest.fn().mockResolvedValue({ ok: true }),
    getTerminalDiagnostics: jest.fn().mockReturnValue({}),
    getDeviceCode: jest.fn().mockReturnValue(''),
    init: jest.fn(),
    verifyWebhookSignature: jest.fn().mockReturnValue(true)
  };
});
jest.mock('../lib/cache', function () {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    acquireLock: jest.fn().mockResolvedValue(true),
    releaseLock: jest.fn().mockResolvedValue(),
    isConnected: jest.fn().mockReturnValue(false),
    init: jest.fn().mockResolvedValue(),
    getClient: jest.fn().mockResolvedValue(null)
  };
});
jest.mock('../lib/zoho-api', function () {
  return { zohoPost: jest.fn(), zohoGet: jest.fn() };
});
jest.mock('../lib/mailer', function () {
  return {
    sendReservationNotification: jest.fn().mockResolvedValue(),
    sendOfflineOrderNotification: jest.fn().mockResolvedValue(),
    sendVoidFailureAlert: jest.fn().mockResolvedValue(),
    sendCustomerConfirmation: jest.fn().mockResolvedValue()
  };
});
jest.mock('axios', function () {
  return { post: jest.fn().mockResolvedValue({ data: { ok: true } }) };
});

// ---------------------------------------------------------------------------
// Set base env before requiring app
// ---------------------------------------------------------------------------
process.env.API_SECRET_KEY = 'test-key';

var request = require('supertest');
var app     = require('../server');
var cacheLib = require('../lib/cache');
var zohoApi  = require('../lib/zoho-api');

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------
function makeBody(overrides) {
  return Object.assign({
    customer: { name: 'Test User', email: 'test@example.com', phone: '' },
    items: [{ item_id: '12345', name: 'Wine Kit', quantity: 1, rate: 49.99 }],
    notes: '',
    cart_key: 'sv-cart-ingredients'
  }, overrides || {});
}

var MOCK_CATALOG = [{ item_id: '12345', name: 'Wine Kit', rate: 49.99, quantity_available: 10 }];

// ---------------------------------------------------------------------------
// HARDEN-03: idempotency_key + Redis-down prod gate
// ---------------------------------------------------------------------------

describe('HARDEN-03: idempotency_key + Redis-down + NODE_ENV=production returns 409', function () {
  beforeEach(function () {
    jest.clearAllMocks();
    // Redis is DOWN for ALL operations
    cacheLib.get.mockRejectedValue(new Error('Redis ECONNREFUSED'));
    cacheLib.acquireLock.mockRejectedValue(new Error('Redis ECONNREFUSED'));
    cacheLib.set.mockRejectedValue(new Error('Redis ECONNREFUSED'));
    cacheLib.isConnected.mockReturnValue(false);

    // verifyRecaptcha is mocked to always pass (see jest.mock above)
  });

  afterEach(function () {
    delete process.env.NODE_ENV;
  });

  test('idempotency_key + Redis down + prod: returns 409 (no duplicate Zoho order)', function () {
    process.env.NODE_ENV = 'production';

    return request(app)
      .post('/api/checkout')
      .send(makeBody({ idempotency_key: 'idem-key-redis-down-001' }))
      .expect(409)
      .then(function (res) {
        expect(res.body.error).toBeDefined();
        // The idempotency-key Redis-down guard must block before Zoho is called
        expect(zohoApi.zohoPost).not.toHaveBeenCalled();
      });
  });

  test('idempotency_key + Redis down + dev: proceeds to checkout (fail-open preserved)', function () {
    delete process.env.NODE_ENV;  // dev — NODE_ENV unset

    // For the fail-open path to complete, catalog and contact lookups must succeed.
    // cache.get resolves null for all keys (simulates Redis up but empty, not Redis down).
    // Only acquireLock rejects — this is what triggers the idempotency-key catch block.
    cacheLib.get.mockImplementation(function (key) {
      if (key === 'zoho:products') return Promise.resolve(MOCK_CATALOG);
      if (key === 'zoho:services:v2') return Promise.resolve([]);
      if (key === 'zoho:ingredients') return Promise.resolve([{ item_id: '12345', name: 'Wine Kit', rate: 49.99 }]);
      // All other keys (contact cache, idempotency key itself) → null (not found)
      return Promise.resolve(null);
    });
    // acquireLock rejects — this is the Redis-down signal that triggers the catch
    cacheLib.acquireLock.mockRejectedValue(new Error('Redis ECONNREFUSED'));
    // set is fine (contact cache write fails silently, does not block checkout)
    cacheLib.set.mockResolvedValue('OK');

    zohoApi.zohoGet.mockResolvedValue({ contacts: [{ contact_id: 'cid-001' }] });
    zohoApi.zohoPost.mockResolvedValue({
      salesorder: { salesorder_id: 'so-1', salesorder_number: 'SO-DEV-001', total: 49.99 }
    });

    return request(app)
      .post('/api/checkout')
      .send(makeBody({ idempotency_key: 'idem-key-redis-down-002' }))
      .expect(201)
      .then(function (res) {
        expect(res.body.ok).toBe(true);
        expect(zohoApi.zohoPost).toHaveBeenCalled();
      });
  });
});
