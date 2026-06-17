'use strict';

// ---------------------------------------------------------------------------
// Mocks — must be declared before any require()
// External services: Zoho, Helcim, Redis/cache, mailer, axios stay mocked.
// express is NOT mocked — real app must be wired for supertest.
// https is NOT mocked — reCAPTCHA fails open when RECAPTCHA_SECRET_KEY is unset.
// ---------------------------------------------------------------------------

// --- Server-boot mocks (required so require('../server') loads cleanly) ---
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

// --- External service mocks (money path) ---
jest.mock('../lib/helcim', function () {
  return {
    isEnabled: jest.fn().mockReturnValue(true),
    initializeCheckout: jest.fn().mockResolvedValue({ checkoutToken: 'tok-test-123' }),
    getDepositAmount: jest.fn().mockReturnValue(10000),
    voidTransaction: jest.fn().mockResolvedValue({ ok: true, transactionId: 'txn-mock' }),
    getTerminalDiagnostics: jest.fn().mockReturnValue({}),
    getDeviceCode: jest.fn().mockReturnValue(''),
    init: jest.fn(),
    verifyWebhookSignature: jest.fn().mockReturnValue(true)
  };
});
jest.mock('../lib/zoho-api', function () {
  return { zohoPost: jest.fn(), zohoGet: jest.fn() };
});
jest.mock('../lib/cache', function () {
  return {
    get: jest.fn(),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    acquireLock: jest.fn().mockResolvedValue(true),
    isConnected: jest.fn().mockReturnValue(false),
    init: jest.fn().mockResolvedValue(),
    getClient: jest.fn().mockResolvedValue(null)
  };
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
// Set env vars before requiring app (ensures boot path is deterministic)
// ---------------------------------------------------------------------------
process.env.API_SECRET_KEY = 'test-key';

var request = require('supertest');
var app = require('../server');

// server.js calls dotenv.config() on require, which repopulates
// RECAPTCHA_SECRET_KEY from a local (gitignored) .env. Neutralize it AFTER the
// require — verifyRecaptcha reads process.env at call time, so an empty secret
// makes reCAPTCHA fail open and the route proceeds past verification.
process.env.RECAPTCHA_SECRET_KEY = '';

var helcimLib = require('../lib/helcim');
var zohoApi = require('../lib/zoho-api');
var cacheLib = require('../lib/cache');
var mailer = require('../lib/mailer');

// ---------------------------------------------------------------------------
// Fixture builder
// ---------------------------------------------------------------------------
function makeCheckoutBody(overrides) {
  return Object.assign({
    customer: { name: 'Test User', email: 'test@example.com', phone: '' },
    items: [{ item_id: '12345', name: 'Wine Kit', quantity: 1, rate: 49.99 }],
    notes: '',
    cart_key: 'sv-cart-ingredients'  // ingredient cart avoids Maker's Fee lookup
  }, overrides || {});
}

// A minimal catalog array containing item_id '12345' so catalog validation passes
var MOCK_CATALOG = [{ item_id: '12345', name: 'Wine Kit', rate: 49.99, quantity_available: 10 }];

// Default cache.get: return catalog for products key, null for everything else
function defaultCacheGet(key) {
  if (key === 'zoho:products') return Promise.resolve(MOCK_CATALOG);
  if (key === 'zoho:services:v2') return Promise.resolve([]);
  if (key === 'zoho:ingredients') return Promise.resolve([{ item_id: '12345', name: 'Wine Kit', rate: 49.99 }]);
  return Promise.resolve(null);
}

// Reset the reCAPTCHA secret before EVERY test. checkout.test.js runs in the
// same Jest worker and sets process.env.RECAPTCHA_SECRET_KEY = 'secret123',
// which leaks across files. A non-empty secret makes verifyRecaptcha attempt a
// real HTTPS call; an empty secret fails open so the route proceeds.
beforeEach(function () {
  process.env.RECAPTCHA_SECRET_KEY = '';
});

// ---------------------------------------------------------------------------
// PATH-1: Success — Zoho sales order created, salesorder_number in response
// ---------------------------------------------------------------------------
describe('POST /api/checkout — PATH-1 success', function () {
  beforeEach(function () {
    jest.clearAllMocks();
    cacheLib.get.mockImplementation(defaultCacheGet);
    cacheLib.acquireLock.mockResolvedValue(true);
    // Contact lookup: no cached contact, found by email in Zoho
    zohoApi.zohoGet.mockResolvedValue({ contacts: [{ contact_id: 'cid-001' }] });
    // Zoho salesorder create succeeds
    zohoApi.zohoPost.mockResolvedValue({
      salesorder: {
        salesorder_id: 'so-1',
        salesorder_number: 'SO-001',
        total: 49.99
      }
    });
  });

  test('returns 201 with salesorder_number and ok:true when Zoho succeeds', function () {
    return request(app)
      .post('/api/checkout')
      .send(makeCheckoutBody())
      .expect(201)
      .then(function (res) {
        expect(res.body.ok).toBe(true);
        expect(res.body.salesorder_number).toBe('SO-001');
      });
  });

  test('helcim.voidTransaction is NOT called on success', function () {
    return request(app)
      .post('/api/checkout')
      .send(makeCheckoutBody())
      .expect(201)
      .then(function () {
        expect(helcimLib.voidTransaction).not.toHaveBeenCalled();
      });
  });
});

// ---------------------------------------------------------------------------
// PATH-2: Void recovery — Zoho fails after charge, voidTransaction called
// ---------------------------------------------------------------------------
describe('POST /api/checkout — PATH-2 void recovery', function () {
  beforeEach(function () {
    jest.clearAllMocks();
    cacheLib.get.mockImplementation(defaultCacheGet);
    cacheLib.acquireLock.mockResolvedValue(true);
    // Contact lookup succeeds
    zohoApi.zohoGet.mockResolvedValue({ contacts: [{ contact_id: 'cid-001' }] });
    // Zoho invoice create throws (transaction_id set → useInvoice=true → /invoices)
    zohoApi.zohoPost.mockRejectedValue(new Error('Zoho API error'));
    // Void resolves OK
    helcimLib.voidTransaction.mockResolvedValue({ ok: true, transactionId: 'txn-001' });
  });

  test('calls voidTransaction with the transaction_id when Zoho fails', function () {
    var body = makeCheckoutBody({ transaction_id: 'txn-001' });
    return request(app)
      .post('/api/checkout')
      .send(body)
      .then(function () {
        expect(helcimLib.voidTransaction).toHaveBeenCalledWith('txn-001');
      });
  });

  test('response contains payment_voided:true when Zoho fails and void succeeds', function () {
    var body = makeCheckoutBody({ transaction_id: 'txn-001' });
    return request(app)
      .post('/api/checkout')
      .send(body)
      .then(function (res) {
        expect(res.body.payment_voided).toBe(true);
      });
  });
});

// ---------------------------------------------------------------------------
// PATH-3: Void-failure alert — Zoho fails AND voidTransaction rejects
// ---------------------------------------------------------------------------
describe('POST /api/checkout — PATH-3 void-failure alert', function () {
  beforeEach(function () {
    jest.clearAllMocks();
    cacheLib.get.mockImplementation(defaultCacheGet);
    cacheLib.acquireLock.mockResolvedValue(true);
    // Contact lookup succeeds
    zohoApi.zohoGet.mockResolvedValue({ contacts: [{ contact_id: 'cid-001' }] });
    // Zoho invoice create throws
    zohoApi.zohoPost.mockRejectedValue(new Error('Zoho API error'));
    // Void also rejects
    helcimLib.voidTransaction.mockRejectedValue(new Error('Helcim void failed'));
  });

  test('calls sendVoidFailureAlert with an object containing the transaction id (txnId)', function () {
    var body = makeCheckoutBody({ transaction_id: 'txn-002' });
    return request(app)
      .post('/api/checkout')
      .send(body)
      .then(function (res) {
        // Allow async void callback to run
        return new Promise(function (resolve) { setTimeout(resolve, 100); }).then(function () {
          expect(mailer.sendVoidFailureAlert).toHaveBeenCalled();
          var alertArg = mailer.sendVoidFailureAlert.mock.calls[0][0];
          expect(alertArg.txnId).toBe('txn-002');
        });
      });
  });

  test('route returns a handled response (not an unhandled 500 crash)', function () {
    var body = makeCheckoutBody({ transaction_id: 'txn-002' });
    return request(app)
      .post('/api/checkout')
      .send(body)
      .then(function (res) {
        // The route resolves with payment_voided:true even when void fails
        // (the void failure alert fires asynchronously via .catch)
        expect(res.body.payment_voided).toBe(true);
        expect(res.body.error).toBeDefined();
      });
  });
});

// ---------------------------------------------------------------------------
// PATH-4: Dual-cart shared-charge reversal
// Second cart call with same transaction_id when first already succeeded:
//   - voidTransaction NOT called (would reverse the shared charge)
//   - payment_voided: false in response
//   - sendVoidFailureAlert called (manual partial refund notification)
// ---------------------------------------------------------------------------
describe('POST /api/checkout — PATH-4 dual-cart shared-charge reversal', function () {
  beforeEach(function () {
    jest.clearAllMocks();
    // Catalog available
    // Contact lookup succeeds
    zohoApi.zohoGet.mockResolvedValue({ contacts: [{ contact_id: 'cid-001' }] });
    // Zoho invoice create throws on this (second) cart
    zohoApi.zohoPost.mockRejectedValue(new Error('Zoho second cart error'));
    // Void resolves (but should NOT be called)
    helcimLib.voidTransaction.mockResolvedValue({ ok: true, transactionId: 'shared-txn' });
    // cache.get: return catalog for products key, and 'used' for the OTHER cart's key
    // cart_key = 'sv-cart-ferment' → otherCartKey = 'sv-cart-ingredients'
    // otherUsedKey = 'helcim:txn:shared-txn:sv-cart-ingredients'
    cacheLib.get.mockImplementation(function (key) {
      if (key === 'zoho:products') return Promise.resolve(MOCK_CATALOG);
      if (key === 'zoho:services:v2') return Promise.resolve([]);
      if (key === 'zoho:ingredients') return Promise.resolve([{ item_id: '12345', name: 'Wine Kit', rate: 49.99 }]);
      if (key === 'helcim:txn:shared-txn:sv-cart-ingredients') return Promise.resolve('used');
      return Promise.resolve(null);
    });
    cacheLib.acquireLock.mockResolvedValue(true);
  });

  test('voidTransaction is NOT called when other cart already used the charge', function () {
    var body = makeCheckoutBody({
      transaction_id: 'shared-txn',
      cart_key: 'sv-cart-ferment'
    });
    return request(app)
      .post('/api/checkout')
      .send(body)
      .then(function () {
        return new Promise(function (resolve) { setTimeout(resolve, 100); }).then(function () {
          expect(helcimLib.voidTransaction).not.toHaveBeenCalled();
        });
      });
  });

  test('response payment_voided is false for dual-cart reversal', function () {
    var body = makeCheckoutBody({
      transaction_id: 'shared-txn',
      cart_key: 'sv-cart-ferment'
    });
    return request(app)
      .post('/api/checkout')
      .send(body)
      .then(function (res) {
        expect(res.body.payment_voided).toBe(false);
      });
  });

  test('sendVoidFailureAlert is called for dual-cart partial failure', function () {
    var body = makeCheckoutBody({
      transaction_id: 'shared-txn',
      cart_key: 'sv-cart-ferment'
    });
    return request(app)
      .post('/api/checkout')
      .send(body)
      .then(function () {
        return new Promise(function (resolve) { setTimeout(resolve, 100); }).then(function () {
          expect(mailer.sendVoidFailureAlert).toHaveBeenCalled();
        });
      });
  });
});

// ---------------------------------------------------------------------------
// Phase 32 gap markers — suite stays green; these document future hardening
// ---------------------------------------------------------------------------
test.todo('HARDEN-01: unauthenticated checkout (no x-api-key) currently passes — Phase 32 closes');
test.todo('HARDEN-03: duplicate charge_key not rejected 409 when Redis down — Phase 32 fixes');
