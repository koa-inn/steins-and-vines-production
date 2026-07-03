'use strict';

// ---------------------------------------------------------------------------
// Regression: FIRSTBATCH promo per-email lock must provide real mutual
// exclusion (WR-03 — phase 52 code review).
//
// checkout.js acquires a per-email lock (cache.acquireLock) but previously
// never READ the result: `lockAcquired` was computed and discarded, and the
// redemption re-check + $20 discount grant proceeded whenever the lock call
// did not fail closed — regardless of whether the lock was actually acquired.
//
// acquireLock resolves `true` for the winner and `false` for a concurrent
// request that finds the lock already held. Under the old code BOTH requests
// fell through to the discount, so two simultaneous same-email FIRSTBATCH
// checkouts could both be granted the promo (bounded revenue leak).
//
// This suite proves the fixed behavior: when the lock is already held
// (acquireLock -> false), the checkout fails closed and applies NO discount.
//
// Modeled on __tests__/promo-failclosed.test.js.
// ---------------------------------------------------------------------------

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

process.env.API_SECRET_KEY = 'test-key';

var request = require('supertest');
var app = require('../server');

process.env.RECAPTCHA_SECRET_KEY = '';

var zohoApi = require('../lib/zoho-api');
var cacheLib = require('../lib/cache');

var MAKERS_FEE_ITEM = { item_id: '222', name: "Maker's Fee", sku: 'MAKERS-FEE', rate: 45 };
var MOCK_CATALOG = [{ item_id: '100', name: 'Wine Kit', rate: 49.99, quantity_available: 10 }];
var MOCK_SERVICES = [MAKERS_FEE_ITEM];

function makeCheckoutBody(overrides) {
  return Object.assign({
    customer: { name: 'Test User', email: 'promo-lock@example.com', phone: '' },
    items: [{ item_id: '100', name: 'Wine Kit', quantity: 1, rate: 49.99 }],
    notes: '',
    promo_code: 'FIRSTBATCH'
  }, overrides || {});
}

function defaultCacheGet(key) {
  if (key === 'zoho:products') return Promise.resolve(MOCK_CATALOG);
  if (key === 'zoho:services:v2') return Promise.resolve(MOCK_SERVICES);
  if (key === 'zoho:ingredients') return Promise.resolve([]);
  return Promise.resolve(null); // promo redemption key: unredeemed
}

beforeEach(function () {
  jest.clearAllMocks();
  process.env.RECAPTCHA_SECRET_KEY = '';
  zohoApi.zohoGet.mockResolvedValue({ contacts: [{ contact_id: 'cid-promo-lock-001' }] });
  zohoApi.zohoPost.mockResolvedValue({
    salesorder: {
      salesorder_id: 'so-promo-lock-1',
      salesorder_number: 'SO-PROMO-LOCK-001',
      total: 49.99
    }
  });
});

describe('POST /api/checkout — FIRSTBATCH promo, lock held by concurrent request (WR-03)', function () {
  test('does NOT apply the discount when acquireLock returns false (lock already held)', function () {
    cacheLib.get.mockImplementation(defaultCacheGet); // key unredeemed
    cacheLib.acquireLock.mockResolvedValue(false);     // a concurrent request holds the lock

    return request(app)
      .post('/api/checkout')
      .send(makeCheckoutBody())
      .expect(201)
      .then(function () {
        var call = zohoApi.zohoPost.mock.calls.find(function (c) { return c[0] === '/salesorders'; });
        expect(call).toBeTruthy();
        var feeLine = call[1].line_items.find(function (li) { return li.item_id === MAKERS_FEE_ITEM.item_id; });
        expect(feeLine).toBeTruthy();
        // Full rate — the losing concurrent request must fail closed (no discount).
        expect(feeLine.rate).toBe(45);
      });
  });

  test('still applies the discount when the lock IS acquired (winner, key unredeemed)', function () {
    cacheLib.get.mockImplementation(defaultCacheGet);
    cacheLib.acquireLock.mockResolvedValue(true); // this request wins the lock

    return request(app)
      .post('/api/checkout')
      .send(makeCheckoutBody())
      .expect(201)
      .then(function () {
        var call = zohoApi.zohoPost.mock.calls.find(function (c) { return c[0] === '/salesorders'; });
        var feeLine = call[1].line_items.find(function (li) { return li.item_id === MAKERS_FEE_ITEM.item_id; });
        // 45 * (1 - 20/100) = 36 — discount applied for the lock winner.
        expect(feeLine.rate).toBe(36);
      });
  });
});
