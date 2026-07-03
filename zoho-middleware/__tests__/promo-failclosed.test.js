'use strict';

// ---------------------------------------------------------------------------
// Regression: FIRSTBATCH promo re-validation fails CLOSED during a Redis
// outage (M1 — RESIL-01, phase 52-02).
//
// checkout.js's server-authoritative promo re-check (lock acquisition +
// redemption lookup) previously caught its own Redis errors and set
// promoDiscount = 20 (fail open) — meaning the $20 discount could be applied
// repeatedly, forever, any time Redis was down. This suite proves the fixed
// behavior: on a simulated outage, no discount is applied, and it stays that
// way across repeated requests (not repeatable).
//
// Modeled on __tests__/checkout-route.test.js — real Express app via
// supertest, external services (Zoho/Helcim/mailer/axios) mocked, cache
// mocked with per-key controllable jest.fn()s.
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
    getCardTransactionById: jest.fn(),
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
// require — verifyRecaptcha reads process.env at call time.
process.env.RECAPTCHA_SECRET_KEY = '';

var zohoApi = require('../lib/zoho-api');
var cacheLib = require('../lib/cache');

// ---------------------------------------------------------------------------
// Fixture builder — non-ingredient cart (kit item) so Maker's Fee injection
// runs and the promo discount has an observable effect on the outgoing
// Zoho payload (rate reduced 20% when promoDiscount > 0).
// ---------------------------------------------------------------------------
var MAKERS_FEE_ITEM = { item_id: '222', name: "Maker's Fee", sku: 'MAKERS-FEE', rate: 45 };
var MOCK_CATALOG = [{ item_id: '100', name: 'Wine Kit', rate: 49.99, quantity_available: 10 }];
var MOCK_SERVICES = [MAKERS_FEE_ITEM];

function makeCheckoutBody(overrides) {
  return Object.assign({
    customer: { name: 'Test User', email: 'promo-outage@example.com', phone: '' },
    items: [{ item_id: '100', name: 'Wine Kit', quantity: 1, rate: 49.99 }],
    notes: '',
    promo_code: 'FIRSTBATCH'
    // no cart_key — default (non-ingredient) cart so Maker's Fee is injected
  }, overrides || {});
}

// Default cache.get: catalog/services/ingredients resolve normally; every
// other key (contact cache, etc.) misses. Per-test overrides layer the promo
// key throw on top of this.
function defaultCacheGet(key) {
  if (key === 'zoho:products') return Promise.resolve(MOCK_CATALOG);
  if (key === 'zoho:services:v2') return Promise.resolve(MOCK_SERVICES);
  if (key === 'zoho:ingredients') return Promise.resolve([]);
  return Promise.resolve(null);
}

// Redis-outage cache.get: catalog/services/ingredients still resolve (a real
// outage would fail those closed too, but that's covered by existing tests —
// this suite isolates the promo re-validation corner specifically), but any
// promo-redemption key throws, simulating the mid-op Redis error.
function outageCacheGet(key) {
  if (typeof key === 'string' && key.indexOf('promo:firstbatch:redeemed:') === 0) {
    return Promise.reject(new Error('ECONNREFUSED — Redis unavailable'));
  }
  return defaultCacheGet(key);
}

beforeEach(function () {
  jest.clearAllMocks();
  process.env.RECAPTCHA_SECRET_KEY = '';
  zohoApi.zohoGet.mockResolvedValue({ contacts: [{ contact_id: 'cid-promo-001' }] });
  zohoApi.zohoPost.mockResolvedValue({
    salesorder: {
      salesorder_id: 'so-promo-1',
      salesorder_number: 'SO-PROMO-001',
      total: 49.99
    }
  });
});

// ---------------------------------------------------------------------------
// Baseline (existing behavior, preserved): Redis up, key unredeemed —
// FIRSTBATCH still applies the $20-equivalent (20%) discount to Maker's Fee.
// ---------------------------------------------------------------------------
describe('POST /api/checkout — FIRSTBATCH promo, Redis healthy', function () {
  test('applies the promo discount to Maker\'s Fee when Redis is up and key unredeemed', function () {
    cacheLib.get.mockImplementation(defaultCacheGet);
    cacheLib.acquireLock.mockResolvedValue(true);

    return request(app)
      .post('/api/checkout')
      .send(makeCheckoutBody())
      .expect(201)
      .then(function () {
        var call = zohoApi.zohoPost.mock.calls.find(function (c) { return c[0] === '/salesorders'; });
        expect(call).toBeTruthy();
        var lineItems = call[1].line_items;
        var feeLine = lineItems.find(function (li) { return li.item_id === MAKERS_FEE_ITEM.item_id; });
        expect(feeLine).toBeTruthy();
        // 45 * (1 - 20/100) = 36
        expect(feeLine.rate).toBe(36);
      });
  });

  test('rejects the promo (no discount) when the redemption key is already set', function () {
    cacheLib.get.mockImplementation(function (key) {
      if (typeof key === 'string' && key.indexOf('promo:firstbatch:redeemed:') === 0) {
        return Promise.resolve({ redeemedAt: '2026-01-01T00:00:00Z' });
      }
      return defaultCacheGet(key);
    });
    cacheLib.acquireLock.mockResolvedValue(true);

    return request(app)
      .post('/api/checkout')
      .send(makeCheckoutBody())
      .expect(201)
      .then(function () {
        var call = zohoApi.zohoPost.mock.calls.find(function (c) { return c[0] === '/salesorders'; });
        var feeLine = call[1].line_items.find(function (li) { return li.item_id === MAKERS_FEE_ITEM.item_id; });
        expect(feeLine.rate).toBe(45); // full rate — already redeemed
      });
  });
});

// ---------------------------------------------------------------------------
// M1 regression: Redis outage during promo re-validation.
// ---------------------------------------------------------------------------
describe('POST /api/checkout — FIRSTBATCH promo, Redis outage (M1 fail-closed)', function () {
  test('does NOT apply the FIRSTBATCH discount when the promo Redis read throws', function () {
    cacheLib.get.mockImplementation(outageCacheGet);
    cacheLib.acquireLock.mockRejectedValue(new Error('ECONNREFUSED — Redis unavailable'));

    return request(app)
      .post('/api/checkout')
      .send(makeCheckoutBody())
      .expect(201)
      .then(function () {
        var call = zohoApi.zohoPost.mock.calls.find(function (c) { return c[0] === '/salesorders'; });
        expect(call).toBeTruthy();
        var feeLine = call[1].line_items.find(function (li) { return li.item_id === MAKERS_FEE_ITEM.item_id; });
        expect(feeLine).toBeTruthy();
        // Full rate — promoDiscount must be 0 when the Redis check throws (fail closed)
        expect(feeLine.rate).toBe(45);
      });
  });

  test('promo is NOT repeatable across two outage-time requests (still no discount on the second attempt)', function () {
    cacheLib.get.mockImplementation(outageCacheGet);
    cacheLib.acquireLock.mockRejectedValue(new Error('ECONNREFUSED — Redis unavailable'));

    return request(app)
      .post('/api/checkout')
      .send(makeCheckoutBody())
      .expect(201)
      .then(function () {
        // Fresh Zoho contact-id resolve for the second request (mock still active)
        zohoApi.zohoPost.mockClear();
        return request(app)
          .post('/api/checkout')
          .send(makeCheckoutBody())
          .expect(201);
      })
      .then(function () {
        var call = zohoApi.zohoPost.mock.calls.find(function (c) { return c[0] === '/salesorders'; });
        expect(call).toBeTruthy();
        var feeLine = call[1].line_items.find(function (li) { return li.item_id === MAKERS_FEE_ITEM.item_id; });
        expect(feeLine.rate).toBe(45); // still full rate — not repeatable
      });
  });
});
