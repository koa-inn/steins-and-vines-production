'use strict';

/**
 * pos-manual-confirm-void-txnid.test.js — void-on-failure must use the REAL
 * Helcim id on a manual confirm, whatever fails after the charge.
 *
 * On a manual confirm the client sends transaction_id: 'manual-confirm'; the
 * real id is resolved by pollTerminalResult into the confirm continuation's
 * local `txnId`, which the outer catch cannot see. Only the captured-amount
 * mismatch error carried it (err.__capturedTxnId). Any OTHER failure after
 * the charge — invoice creation, payment recording — reached the outer catch
 * untagged, so the void was attempted against the literal 'manual-confirm',
 * which can never resolve: customer left charged, unpaid invoice.
 * (HANDOFF-kiosk-manual-confirm-void-txnid.md; latent — on INV-000226 the
 * client had the real id.)
 *
 * Fix: tag every error escaping the post-verification chain with the
 * resolved id. RED before, GREEN after.
 *
 * Mock block + harness cloned from pos-confirm-amount-drift.test.js.
 */


// =============================================================================
// Mocks — cloned from pos-moto-tender.test.js (the closest existing template
// for a getCardTransactionById-driven confirm-route check).
// =============================================================================

jest.mock('express', function () {
  var router = { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() };
  var express = function () {};
  express.Router = function () { return router; };
  return express;
});

jest.mock('axios', function () {
  return { get: jest.fn(), post: jest.fn() };
});

jest.mock('../lib/helcim', function () {
  return {
    isTerminalEnabled: jest.fn().mockReturnValue(true),
    isEnabled: jest.fn().mockReturnValue(true),
    terminalPurchase: jest.fn().mockResolvedValue({ idempotencyKey: 'idem-drift-1' }),
    pollTerminalResult: jest.fn(),
    initializeCheckout: jest.fn().mockResolvedValue({ checkoutToken: 'tok-drift-test' }),
    getCardTransactionById: jest.fn(),
    voidTransaction: jest.fn().mockResolvedValue({ ok: true }),
    getTerminalDiagnostics: jest.fn().mockReturnValue({}),
    generateIdempotencyKey: jest.fn().mockReturnValue('idem-drift-so-1'),
    cancelTerminal: jest.fn().mockResolvedValue({})
  };
});

jest.mock('../lib/zoho-api', function () {
  return {
    zohoGet: jest.fn(),
    zohoPost: jest.fn().mockResolvedValue({ invoice: { invoice_id: 'inv-drift-1', invoice_number: 'INV-DRIFT-001' } }),
    zohoPut: jest.fn()
  };
});

jest.mock('../lib/cache', function () {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    acquireLock: jest.fn().mockResolvedValue(true),
    releaseLock: jest.fn().mockResolvedValue()
  };
});

jest.mock('../lib/logger', function () {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
});

jest.mock('../lib/eventLog', function () {
  return { logEvent: jest.fn() };
});

jest.mock('../lib/mailer', function () {
  return { sendVoidFailureAlert: jest.fn().mockResolvedValue({}) };
});

jest.mock('../lib/inventory-ledger', function () {
  return { decrementStock: jest.fn().mockResolvedValue({}), reconcileFromZoho: jest.fn() };
});

jest.mock('../lib/brewpad-integration', function () {
  return { createBatchesFromSale: jest.fn(), detectRecipeSale: jest.fn() };
});

jest.mock('../lib/discount-match', function () {
  return { classifyCatalogItem: jest.fn().mockReturnValue([]), matches: jest.fn().mockReturnValue(false) };
});

jest.mock('../lib/checkout-helpers', function () {
  return { buildContactPayload: jest.fn(), withTimeout: function (p) { return p; } };
});

jest.mock('../lib/money-path', function () {
  return {
    acquireIdempotencyLock: jest.fn().mockResolvedValue({ status: 'acquired' }),
    voidWithTimeout: jest.fn().mockImplementation(function (helcimLike, txnId) {
      return helcimLike.voidTransaction(txnId).then(function () {}).catch(function () {});
    }),
    CHECKOUT_IDEMPOTENCY_TTL: 600
  };
});

jest.mock('../lib/constants', function () {
  return {
    CACHE_KEYS: {
      KIOSK_PRODUCTS:              'test:kiosk-products',
      RECENT_ORDERS:               'test:recent-orders',
      KIOSK_IDEM_PREFIX:           'test:idem:',
      KIOSK_SALESORDERS:           'test:kiosk-salesorders',
      KIOSK_DISCOUNT_PRESETS:      'test:kiosk-discount-presets',
      CONSIGNMENT_REPORT_PREFIX:   'test:consignment:report:',
      KIOSK_PENDING_CHARGE_PREFIX: 'test:kiosk:pending-charge:',
      INGREDIENTS_ALL:             'zoho:ingredients:all'
    },
    LOCK_KEYS: { RECIPE_SALE: 'recipe-sale' },
    LEDGER_KEYS: {},
    RATE_LIMIT_PREFIX: 'test:rl:'
  };
});

// =============================================================================
// Test harness (mirrors pos-moto-tender.test.js getHandlers)
// =============================================================================

var cache, helcimLib, zohoApi, router, handlers;

function getHandlers() {
  jest.resetModules();
  cache      = require('../lib/cache');
  helcimLib  = require('../lib/helcim');
  zohoApi    = require('../lib/zoho-api');
  require('../routes/pos');
  router   = require('express').Router();
  handlers = {};
  router.post.mock.calls.forEach(function (call) { handlers[call[0]] = call[call.length - 1]; });
  router.get.mock.calls.forEach(function (call) { handlers[call[0]] = call[call.length - 1]; });
}

function mockRes() {
  var r = { json: jest.fn(), status: jest.fn(), headersSent: false };
  r.status.mockReturnValue(r);
  return r;
}

function captureStatus(res) {
  var captured = { code: null };
  res.status.mockImplementation(function (code) { captured.code = code; return res; });
  return captured;
}

// A single tax-exempt custom line: bypasses the catalog check entirely on
// /confirm (item.custom === true). rate controls grandTotal exactly.
function driftCartItems(rate) {
  return [{ custom: true, description: 'Drift Test Item', quantity: 1, rate: rate, taxable: false }];
}

describe('manual confirm — void uses the resolved real txn id on any post-charge failure', function () {
  beforeEach(function () {
    getHandlers();
    process.env.KIOSK_CONTACT_ID = 'contact-walkin';
    helcimLib.pollTerminalResult.mockResolvedValue({
      approved: true, transactionId: 'txn-real-777', status: 'APPROVED'
    });
    helcimLib.getCardTransactionById.mockResolvedValue({ status: 'APPROVED', amount: 50.00 });
  });

  afterEach(function () {
    delete process.env.KIOSK_CONTACT_ID;
  });

  function confirmReq(ref) {
    return { body: { items: driftCartItems(50), transaction_id: 'manual-confirm', reference_number: ref } };
  }

  function expectRealVoid(res, statusCapture, done) {
    res.json.mockImplementation(function (body) {
      try {
        expect(statusCapture.code).toBe(502);
        expect(helcimLib.voidTransaction).toHaveBeenCalledWith('txn-real-777');
        expect(helcimLib.voidTransaction).not.toHaveBeenCalledWith('manual-confirm');
        expect(body.voided_transaction_id).toBe('txn-real-777');
        done();
      } catch (e) { done(e); }
    });
  }

  test('payment recording fails (INV-000226 shape) -> voids txn-real-777', function (done) {
    zohoApi.zohoPost.mockImplementation(function (path) {
      if (path === '/customerpayments') {
        return Promise.reject(new Error('Request failed with status code 400'));
      }
      return Promise.resolve({ invoice: { invoice_id: 'inv-mc-1', invoice_number: 'INV-MC-001' } });
    });
    var res = mockRes();
    var statusCapture = captureStatus(res);
    expectRealVoid(res, statusCapture, done);
    handlers['/api/kiosk/sale/confirm'](confirmReq('KIOSK-MC-PAY-001'), res);
  });

  test('invoice creation fails -> voids txn-real-777', function (done) {
    zohoApi.zohoPost.mockImplementation(function (path) {
      if (path === '/invoices') return Promise.reject(new Error('Request failed with status code 500'));
      return Promise.resolve({});
    });
    var res = mockRes();
    var statusCapture = captureStatus(res);
    expectRealVoid(res, statusCapture, done);
    handlers['/api/kiosk/sale/confirm'](confirmReq('KIOSK-MC-INV-001'), res);
  });

  test('a terminal (non-manual) confirm still voids the id the client sent', function (done) {
    zohoApi.zohoPost.mockImplementation(function (path) {
      if (path === '/customerpayments') return Promise.reject(new Error('400'));
      return Promise.resolve({ invoice: { invoice_id: 'inv-t-1', invoice_number: 'INV-T-001' } });
    });
    helcimLib.getCardTransactionById.mockResolvedValue({ status: 'APPROVED', amount: 50.00 });
    var res = mockRes();
    var statusCapture = captureStatus(res);
    res.json.mockImplementation(function () {
      try {
        expect(statusCapture.code).toBe(502);
        expect(helcimLib.voidTransaction).toHaveBeenCalledWith('txn-client-555');
        done();
      } catch (e) { done(e); }
    });
    handlers['/api/kiosk/sale/confirm']({
      body: { items: driftCartItems(50), transaction_id: 'txn-client-555', reference_number: 'KIOSK-T-001' }
    }, res);
  });
});
