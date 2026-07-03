'use strict';

/**
 * H2 / MONEY-01 regression suite — captured-amount verification (audit finding H2).
 *
 * Standalone file (CLAUDE.md rule 10: do NOT modify checkout-route.test.js).
 * Mirrors checkout-route.test.js's server-boot + money-path mock harness, but
 * this file's OWN ../lib/helcim mock additionally exposes getCardTransactionById
 * (the checkout-route harness omits it — this suite needs it to drive the
 * captured-vs-recorded verification that does not exist yet in checkout.js).
 *
 * RED state (before checkout.js is patched): the SHORT and FETCH-ERROR cases
 * FAIL because nothing in checkout.js today reads back the actual captured
 * amount — a tampered initialize(amount:0.01) followed by a full order books
 * a paid invoice for the (unrelated) Zoho-recomputed total.
 */

// ---------------------------------------------------------------------------
// Mocks — must be declared before any require()
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
// NOTE: adds getCardTransactionById on top of the checkout-route.test.js mock shape.
jest.mock('../lib/helcim', function () {
  return {
    isEnabled: jest.fn().mockReturnValue(true),
    initializeCheckout: jest.fn().mockResolvedValue({ checkoutToken: 'tok-test-123' }),
    getDepositAmount: jest.fn().mockReturnValue(10000),
    voidTransaction: jest.fn().mockResolvedValue({ ok: true, transactionId: 'txn-mock' }),
    getTerminalDiagnostics: jest.fn().mockReturnValue({}),
    getDeviceCode: jest.fn().mockReturnValue(''),
    init: jest.fn(),
    verifyWebhookSignature: jest.fn().mockReturnValue(true),
    getCardTransactionById: jest.fn()
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

// Reset the reCAPTCHA secret before EVERY test — a non-empty secret leaking
// from another test file in the same worker would make verifyRecaptcha
// attempt a real HTTPS call; an empty secret fails open so the route proceeds.
beforeEach(function () {
  process.env.RECAPTCHA_SECRET_KEY = '';
});

// Helper: mockImplementation for zohoPost keyed on endpoint, with a per-call
// invoice total override (supports the dual-cart test's two sequential legs).
function makeZohoPostImpl(invoiceTotals) {
  var invoiceCallCount = 0;
  return function (endpoint) {
    if (endpoint === '/invoices') {
      var total = invoiceTotals[invoiceCallCount] != null ? invoiceTotals[invoiceCallCount] : invoiceTotals[invoiceTotals.length - 1];
      invoiceCallCount++;
      return Promise.resolve({
        invoice: { invoice_id: 'inv-' + invoiceCallCount, invoice_number: 'INV-00' + invoiceCallCount, total: total }
      });
    }
    if (endpoint === '/customerpayments') {
      return Promise.resolve({});
    }
    // /invoices/{id}/email and anything else — fire-and-forget, resolve empty
    return Promise.resolve({});
  };
}

// ---------------------------------------------------------------------------
// SHORT capture — the H2 attack: tampered initialize(amount:0.01) followed by
// a full order. Captured amount (0.01) is far below the invoice total (280.00).
// ---------------------------------------------------------------------------
describe('POST /api/checkout — H2 captured-amount SHORT capture (attack case)', function () {
  beforeEach(function () {
    jest.clearAllMocks();
    cacheLib.get.mockImplementation(defaultCacheGet);
    cacheLib.acquireLock.mockResolvedValue(true);
    zohoApi.zohoGet.mockResolvedValue({ contacts: [{ contact_id: 'cid-001' }] });
    zohoApi.zohoPost.mockImplementation(makeZohoPostImpl([280.00]));
    helcimLib.getCardTransactionById.mockResolvedValue({ status: 'APPROVED', amount: 0.01 });
    helcimLib.voidTransaction.mockResolvedValue({ ok: true, transactionId: 'txn-short' });
  });

  test('returns a 4xx (402) when captured amount is far below the invoice total', function () {
    var body = makeCheckoutBody({ transaction_id: 'txn-short' });
    return request(app)
      .post('/api/checkout')
      .send(body)
      .then(function (res) {
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
      });
  });

  test('never records a /customerpayments entry for a short capture', function () {
    var body = makeCheckoutBody({ transaction_id: 'txn-short' });
    return request(app)
      .post('/api/checkout')
      .send(body)
      .then(function () {
        expect(zohoApi.zohoPost).not.toHaveBeenCalledWith('/customerpayments', expect.anything());
      });
  });

  test('voids the charge via helcimLib.voidTransaction (through moneyPath.voidWithTimeout)', function () {
    var body = makeCheckoutBody({ transaction_id: 'txn-short' });
    return request(app)
      .post('/api/checkout')
      .send(body)
      .then(function () {
        expect(helcimLib.voidTransaction).toHaveBeenCalledWith('txn-short');
      });
  });
});

// ---------------------------------------------------------------------------
// EQUAL capture — legit online order: captured amount === invoice total.
// ---------------------------------------------------------------------------
describe('POST /api/checkout — H2 captured-amount EQUAL capture (legit)', function () {
  beforeEach(function () {
    jest.clearAllMocks();
    cacheLib.get.mockImplementation(defaultCacheGet);
    cacheLib.acquireLock.mockResolvedValue(true);
    zohoApi.zohoGet.mockResolvedValue({ contacts: [{ contact_id: 'cid-001' }] });
    zohoApi.zohoPost.mockImplementation(makeZohoPostImpl([49.99]));
    helcimLib.getCardTransactionById.mockResolvedValue({ status: 'APPROVED', amount: 49.99 });
  });

  test('returns 201 when captured amount equals the invoice total', function () {
    var body = makeCheckoutBody({ transaction_id: 'txn-equal' });
    return request(app)
      .post('/api/checkout')
      .send(body)
      .expect(201);
  });

  test('records /customerpayments with amount === invoice total', function () {
    var body = makeCheckoutBody({ transaction_id: 'txn-equal' });
    return request(app)
      .post('/api/checkout')
      .send(body)
      .then(function () {
        expect(zohoApi.zohoPost).toHaveBeenCalledWith('/customerpayments', expect.objectContaining({ amount: 49.99 }));
      });
  });

  test('does not void the charge', function () {
    var body = makeCheckoutBody({ transaction_id: 'txn-equal' });
    return request(app)
      .post('/api/checkout')
      .send(body)
      .then(function () {
        expect(helcimLib.voidTransaction).not.toHaveBeenCalled();
      });
  });
});

// ---------------------------------------------------------------------------
// GREATER capture (overpayment) — NOT blocked; books normally, logged only.
// ---------------------------------------------------------------------------
describe('POST /api/checkout — H2 captured-amount GREATER capture (overpayment)', function () {
  beforeEach(function () {
    jest.clearAllMocks();
    cacheLib.get.mockImplementation(defaultCacheGet);
    cacheLib.acquireLock.mockResolvedValue(true);
    zohoApi.zohoGet.mockResolvedValue({ contacts: [{ contact_id: 'cid-001' }] });
    zohoApi.zohoPost.mockImplementation(makeZohoPostImpl([49.99]));
    helcimLib.getCardTransactionById.mockResolvedValue({ status: 'APPROVED', amount: 60.00 });
  });

  test('returns 201 when captured amount exceeds the invoice total (overpayment allowed through)', function () {
    var body = makeCheckoutBody({ transaction_id: 'txn-greater' });
    return request(app)
      .post('/api/checkout')
      .send(body)
      .expect(201);
  });

  test('records /customerpayments with amount === invoice total (NOT the captured amount)', function () {
    var body = makeCheckoutBody({ transaction_id: 'txn-greater' });
    return request(app)
      .post('/api/checkout')
      .send(body)
      .then(function () {
        expect(zohoApi.zohoPost).toHaveBeenCalledWith('/customerpayments', expect.objectContaining({ amount: 49.99 }));
      });
  });

  test('does not void the charge', function () {
    var body = makeCheckoutBody({ transaction_id: 'txn-greater' });
    return request(app)
      .post('/api/checkout')
      .send(body)
      .then(function () {
        expect(helcimLib.voidTransaction).not.toHaveBeenCalled();
      });
  });
});

// ---------------------------------------------------------------------------
// FETCH-ERROR — getCardTransactionById rejects; must fail CLOSED (void + 4xx).
// ---------------------------------------------------------------------------
describe('POST /api/checkout — H2 captured-amount FETCH-ERROR (fail-closed)', function () {
  beforeEach(function () {
    jest.clearAllMocks();
    cacheLib.get.mockImplementation(defaultCacheGet);
    cacheLib.acquireLock.mockResolvedValue(true);
    zohoApi.zohoGet.mockResolvedValue({ contacts: [{ contact_id: 'cid-001' }] });
    zohoApi.zohoPost.mockImplementation(makeZohoPostImpl([49.99]));
    helcimLib.getCardTransactionById.mockRejectedValue(new Error('Helcim card-transactions API error'));
    helcimLib.voidTransaction.mockResolvedValue({ ok: true, transactionId: 'txn-fetcherr' });
  });

  test('returns a 4xx when the captured amount cannot be verified', function () {
    var body = makeCheckoutBody({ transaction_id: 'txn-fetcherr' });
    return request(app)
      .post('/api/checkout')
      .send(body)
      .then(function (res) {
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
      });
  });

  test('never records a /customerpayments entry when unverifiable', function () {
    var body = makeCheckoutBody({ transaction_id: 'txn-fetcherr' });
    return request(app)
      .post('/api/checkout')
      .send(body)
      .then(function () {
        expect(zohoApi.zohoPost).not.toHaveBeenCalledWith('/customerpayments', expect.anything());
      });
  });

  test('voids the charge (fail-closed void) when the readback fails', function () {
    var body = makeCheckoutBody({ transaction_id: 'txn-fetcherr' });
    return request(app)
      .post('/api/checkout')
      .send(body)
      .then(function () {
        expect(helcimLib.voidTransaction).toHaveBeenCalledWith('txn-fetcherr');
      });
  });
});

// ---------------------------------------------------------------------------
// DUAL-CART — one shared transactionId, two cart_keys, combined capture.
// Proves the >= tolerance direction never false-rejects a legit combined
// capture: each leg's own invoice total is a SUBSET of the shared capture.
// ---------------------------------------------------------------------------
describe('POST /api/checkout — H2 captured-amount DUAL-CART (no false-reject)', function () {
  var zohoPostImpl;

  beforeEach(function () {
    jest.clearAllMocks();
    cacheLib.get.mockImplementation(defaultCacheGet);
    cacheLib.acquireLock.mockResolvedValue(true);
    zohoApi.zohoGet.mockResolvedValue({ contacts: [{ contact_id: 'cid-001' }] });
    // Ferment leg invoice total 280, ingredients leg invoice total 20 (combined capture 300)
    zohoPostImpl = makeZohoPostImpl([280.00, 20.00]);
    zohoApi.zohoPost.mockImplementation(zohoPostImpl);
    // Both readbacks return the FULL combined capture (300.00) — proves >= tolerance is safe
    helcimLib.getCardTransactionById.mockResolvedValue({ status: 'APPROVED', amount: 300.00 });
  });

  test('both legs of a shared charge book successfully with no false-reject', function () {
    var fermentBody = makeCheckoutBody({
      transaction_id: 'shared-txn-dual',
      cart_key: 'sv-cart-ferment',
      items: [{ item_id: '12345', name: 'Wine Kit', quantity: 1, rate: 49.99 }]
    });
    var ingredientsBody = makeCheckoutBody({
      transaction_id: 'shared-txn-dual',
      cart_key: 'sv-cart-ingredients'
    });

    return request(app)
      .post('/api/checkout')
      .send(fermentBody)
      .then(function (res1) {
        expect(res1.status).toBe(201);
        return request(app)
          .post('/api/checkout')
          .send(ingredientsBody)
          .then(function (res2) {
            expect(res2.status).toBe(201);
            expect(zohoApi.zohoPost).toHaveBeenCalledWith('/customerpayments', expect.objectContaining({ amount: 280.00 }));
            expect(zohoApi.zohoPost).toHaveBeenCalledWith('/customerpayments', expect.objectContaining({ amount: 20.00 }));
            expect(helcimLib.voidTransaction).not.toHaveBeenCalled();
          });
      });
  });
});
