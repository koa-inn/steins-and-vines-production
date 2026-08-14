'use strict';

/**
 * Phase 71-02 — dead-code cleanup regression LOCK (NOT a money-path bug fix).
 *
 * Reachability analysis (see 71-02-PLAN.md / SUMMARY): the deposit-booking
 * block at checkout.js:680 is entered only when `transactionId` is truthy
 * (guard: `transactionId && depositAmount > 0 && soId`), and depositAmount
 * is only ever nonzero when transactionId is truthy (checkout.js:496), while
 * `useInvoice = !!transactionId` (checkout.js:562). So entering the block
 * guarantees useInvoice === true, and the dead `else { salesorders_to_apply }`
 * branch removed in this plan could never run. This suite pins that shape as
 * a permanent regression lock so a future refactor cannot silently
 * reintroduce the orphaned-advance bug by flipping the useInvoice invariant.
 *
 * Standalone file (CLAUDE.md rule 10: do NOT modify existing checkout tests).
 * Mirrors checkout-captured-amount.test.js's server-boot + money-path mock
 * harness (H2 captured-amount readback must be satisfied for the deposit
 * block to be reached at all).
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
  return { init: jest.fn(), setupExpressErrorHandler: jest.fn(), captureException: jest.fn() };
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

// zohoPost mock keyed on endpoint. /invoices always resolves with a fixed
// invoice_id/total; /salesorders resolves with a fixed salesorder_id (used by
// the no-transaction-id case to confirm the deposit block is never entered).
function zohoPostImpl(endpoint) {
  if (endpoint === '/invoices') {
    return Promise.resolve({
      invoice: { invoice_id: 'inv-71-02', invoice_number: 'INV-7102', total: 49.99 }
    });
  }
  if (endpoint === '/salesorders') {
    return Promise.resolve({
      salesorder: { salesorder_id: 'so-71-02', salesorder_number: 'SO-7102', total: 49.99 }
    });
  }
  if (endpoint === '/customerpayments') {
    return Promise.resolve({});
  }
  // /invoices/{id}/email, /salesorders/{id}/email, and anything else —
  // fire-and-forget, resolve empty.
  return Promise.resolve({});
}

describe('POST /api/checkout — deposit-booking block (71-02 regression lock)', function () {
  beforeEach(function () {
    jest.clearAllMocks();
    cacheLib.get.mockImplementation(defaultCacheGet);
    cacheLib.acquireLock.mockResolvedValue(true);
    zohoApi.zohoGet.mockResolvedValue({ contacts: [{ contact_id: 'cid-001' }] });
    zohoApi.zohoPost.mockImplementation(zohoPostImpl);
    // Captured-amount readback (MONEY-01/H2 guard) must match the invoice
    // total or the deposit block is never reached.
    helcimLib.getCardTransactionById.mockResolvedValue({ status: 'APPROVED', amount: 49.99 });
  });

  test('WITH transaction_id: books the customerpayment via invoices[] with correct invoice_id/amount_applied, and NEVER emits salesorders_to_apply', function () {
    var body = makeCheckoutBody({ transaction_id: 'txn-71-02' });
    return request(app)
      .post('/api/checkout')
      .send(body)
      .expect(201)
      .then(function () {
        expect(zohoApi.zohoPost).toHaveBeenCalledWith('/customerpayments', expect.objectContaining({
          invoices: [{ invoice_id: 'inv-71-02', amount_applied: 49.99 }]
        }));

        // Assert on the actual recorded call args — no salesorders_to_apply key anywhere.
        var paymentCall = zohoApi.zohoPost.mock.calls.find(function (call) {
          return call[0] === '/customerpayments';
        });
        expect(paymentCall).toBeDefined();
        var paymentBody = paymentCall[1];
        expect(paymentBody.amount_applied).toBeUndefined();
        expect(Object.prototype.hasOwnProperty.call(paymentBody, 'salesorders_to_apply')).toBe(false);
      });
  });

  test('WITHOUT transaction_id: the deposit-booking block is never entered — no /customerpayments call at all', function () {
    var body = makeCheckoutBody(); // no transaction_id
    return request(app)
      .post('/api/checkout')
      .send(body)
      .expect(201)
      .then(function () {
        expect(zohoApi.zohoPost).not.toHaveBeenCalledWith('/customerpayments', expect.anything());
      });
  });
});
