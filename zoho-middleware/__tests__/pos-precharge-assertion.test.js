'use strict';

/**
 * pos-precharge-assertion.test.js — Phase 67 (KIOSK-TAX-QUOTE-01)
 *
 * Regression tests for the two middleware fixes closing the kiosk
 * quote-vs-charge seam (.planning/debug/kiosk-tax-under-quote.md):
 *
 *   1. Pre-charge total assertion — server compares the kiosk's displayed
 *      client_grand_total to its own computed grandTotal BEFORE any Helcim
 *      terminal charge. Divergence beyond $0.01 is rejected 400, no charge,
 *      idempotency lock released. Absent/non-finite client_grand_total is
 *      back-compat (assertion skipped, old cached kiosk JS still works).
 *
 *   2. Confirm-path unresolved-tax orphan guard — a catalog item with no
 *      resolvable tax must fail closed. On the CONFIRM path a real terminal
 *      charge may already exist (body.transaction_id), so the rejection MUST
 *      route through the existing void-on-failure machinery (tagged
 *      __taxUnresolved throw → outer .catch) rather than an early 400 that
 *      would orphan the charge (pos.js:816-819 invariant).
 *
 * Mock block cloned from pos-money-defects.test.js (the most complete
 * existing pos.js harness — includes ../lib/money-path with
 * voidWithTimeout/acquireIdempotencyLock and ../lib/cache with
 * acquireLock/releaseLock).
 *
 * RED phase: all tests FAIL before the pos.js fixes (Tasks 2/3).
 * GREEN phase: all tests PASS after.
 */

// =============================================================================
// Mock block (cloned from pos-money-defects.test.js)
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
    terminalPurchase: jest.fn().mockResolvedValue({ idempotencyKey: 'idem-pca-1' }),
    pollTerminalResult: jest.fn().mockResolvedValue({
      approved: true, transactionId: 'txn-pca-123', authorizationCode: 'AUTH1', cardType: 'Visa'
    }),
    voidTransaction: jest.fn().mockResolvedValue({}),
    getTerminalDiagnostics: jest.fn().mockReturnValue({}),
    generateIdempotencyKey: jest.fn().mockReturnValue('idem-pca-so-1'),
    cancelTerminal: jest.fn().mockResolvedValue({})
  };
});

jest.mock('../lib/zoho-api', function () {
  return {
    zohoGet: jest.fn(),
    zohoPost: jest.fn().mockResolvedValue({ invoice: { invoice_id: 'inv-pca-1', invoice_number: 'INV-PCA-001' } }),
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
      return helcimLike.voidTransaction(txnId)
        .then(function () {})
        .catch(function () {});
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
// Test catalog fixtures
// =============================================================================

var CATALOG_EXEMPT = [
  {
    item_id:        'item-gc-pca',
    name:           'Test Item',
    rate:           100.00,
    stock_on_hand:  10,
    tax_percentage: 0,
    tax_id:         'exempt-tax',
    custom_fields:  []
  }
];

// No tax_percentage, no tax_id, no sales_tax_rule_id — genuinely unresolvable
// (Phase 67 fail-closed contract), used by the confirm-path orphan-guard tests.
var CATALOG_UNRESOLVED = [
  {
    item_id:       'item-unresolved-pca',
    name:          'Mystery Import',
    rate:          150.00,
    stock_on_hand: 10,
    tax_id:        '',
    tax_name:      '',
    custom_fields: []
  }
];

// =============================================================================
// Test harness for pos.js (cloned from pos-money-defects.test.js)
// =============================================================================

var cache, helcimLib, axiosMock, zohoApi, moneyPath, router, handlers;

function getPosHandlers() {
  jest.resetModules();
  cache      = require('../lib/cache');
  helcimLib  = require('../lib/helcim');
  axiosMock  = require('axios');
  zohoApi    = require('../lib/zoho-api');
  moneyPath  = require('../lib/money-path');
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

// =============================================================================
// Pre-charge assertion — client_grand_total vs. server grandTotal
// =============================================================================

describe('Pre-charge assertion — client_grand_total vs. server grandTotal', function () {

  beforeEach(function () {
    getPosHandlers();
    process.env.KIOSK_CONTACT_ID = 'contact-walkin';
    cache.get.mockImplementation(function (key) {
      if (key === 'test:kiosk-products') return Promise.resolve(CATALOG_EXEMPT);
      return Promise.resolve(null);
    });
    moneyPath.acquireIdempotencyLock.mockResolvedValue({ status: 'acquired' });
  });

  afterEach(function () {
    delete process.env.KIOSK_CONTACT_ID;
  });

  // item-gc-pca: rate=100, tax_percentage=0, tax_id set → resolved 0% tax,
  // server grandTotal = 100.00

  test('client_grand_total differs from server grandTotal by > $0.01 → 400, no Helcim charge, idempotency lock released', function (done) {
    var req = {
      body: {
        items:              [{ item_id: 'item-gc-pca', name: 'Test Item', quantity: 1 }],
        idempotency_key:    'pca-mismatch-key-001',
        client_grand_total: 150.00 // server computes 100.00 — off by more than $0.01
      }
    };
    var res = mockRes();
    var statusCapture = captureStatus(res);
    res.json.mockImplementation(function (body) {
      try {
        expect(statusCapture.code).toBe(400);
        expect(body.error).toBeTruthy();
        expect(helcimLib.terminalPurchase).not.toHaveBeenCalled();
        expect(cache.releaseLock).toHaveBeenCalledWith('test:idem:pca-mismatch-key-001');
        done();
      } catch (e) { done(e); }
    });
    handlers['/api/kiosk/sale'](req, res);
  });

  test('client_grand_total matches within $0.01 → sale proceeds to the terminal', function (done) {
    var req = {
      body: {
        items:              [{ item_id: 'item-gc-pca', name: 'Test Item', quantity: 1 }],
        idempotency_key:    'pca-match-key-001',
        client_grand_total: 100.005 // within $0.01 of the server's 100.00
      }
    };
    var res = mockRes();
    res.json.mockImplementation(function (body) {
      try {
        expect(body.pending).toBe(true);
        expect(helcimLib.terminalPurchase).toHaveBeenCalled();
        done();
      } catch (e) { done(e); }
    });
    res.status.mockImplementation(function (code) {
      if (code >= 400) {
        return { json: function (body) { done(new Error('Got status ' + code + ': ' + JSON.stringify(body))); } };
      }
      return res;
    });
    handlers['/api/kiosk/sale'](req, res);
  });

  test('client_grand_total absent → sale proceeds unchanged (back-compat with old cached kiosk JS)', function (done) {
    var req = {
      body: {
        items:           [{ item_id: 'item-gc-pca', name: 'Test Item', quantity: 1 }],
        idempotency_key: 'pca-absent-key-001'
        // no client_grand_total field at all
      }
    };
    var res = mockRes();
    res.json.mockImplementation(function (body) {
      try {
        expect(body.pending).toBe(true);
        expect(helcimLib.terminalPurchase).toHaveBeenCalled();
        done();
      } catch (e) { done(e); }
    });
    res.status.mockImplementation(function (code) {
      if (code >= 400) {
        return { json: function (body) { done(new Error('Got status ' + code + ': ' + JSON.stringify(body))); } };
      }
      return res;
    });
    handlers['/api/kiosk/sale'](req, res);
  });

  test('client_grand_total present but not a finite number → treated as absent, sale proceeds', function (done) {
    var req = {
      body: {
        items:              [{ item_id: 'item-gc-pca', name: 'Test Item', quantity: 1 }],
        idempotency_key:    'pca-nonfinite-key-001',
        client_grand_total: 'abc'
      }
    };
    var res = mockRes();
    res.json.mockImplementation(function (body) {
      try {
        expect(body.pending).toBe(true);
        expect(helcimLib.terminalPurchase).toHaveBeenCalled();
        done();
      } catch (e) { done(e); }
    });
    res.status.mockImplementation(function (code) {
      if (code >= 400) {
        return { json: function (body) { done(new Error('Got status ' + code + ': ' + JSON.stringify(body))); } };
      }
      return res;
    });
    handlers['/api/kiosk/sale'](req, res);
  });
});

// =============================================================================
// Confirm-path unresolved tax — void, never orphan
// =============================================================================

describe('Confirm-path unresolved tax — void, never orphan', function () {

  beforeEach(function () {
    getPosHandlers();
    process.env.KIOSK_CONTACT_ID = 'contact-walkin';
    cache.get.mockImplementation(function (key) {
      if (key === 'test:kiosk-products') return Promise.resolve(CATALOG_UNRESOLVED);
      return Promise.resolve(null);
    });
    moneyPath.acquireIdempotencyLock.mockResolvedValue({ status: 'acquired' });
  });

  afterEach(function () {
    delete process.env.KIOSK_CONTACT_ID;
  });

  test('unresolved tax during confirm WITH body.transaction_id (real terminal charge exists) → void-on-failure invoked, voided-shape 502, never a bare 400 and never a booked invoice', function (done) {
    var req = {
      body: {
        items:            [{ item_id: 'item-unresolved-pca', name: 'Mystery Import', quantity: 1 }],
        transaction_id:   'txn-real-charged-001',
        reference_number: 'KIOSK-PCA-VOID-001'
      }
    };
    var res = mockRes();
    var statusCapture = captureStatus(res);
    res.json.mockImplementation(function (body) {
      try {
        expect(statusCapture.code).toBe(502);
        expect(body.payment_voided).toBe(true);
        expect(body.voided_transaction_id).toBe('txn-real-charged-001');
        // Never a bare 400 after a charge — must not be the confirm-level "no
        // catalog match" 400, and must not be a booked invoice.
        expect(moneyPath.voidWithTimeout).toHaveBeenCalled();
        expect(moneyPath.voidWithTimeout.mock.calls[0][1]).toBe('txn-real-charged-001');
        var invoiceCall = zohoApi.zohoPost.mock.calls.find(function (c) { return c[0] === '/invoices'; });
        expect(invoiceCall).toBeFalsy();
        done();
      } catch (e) { done(e); }
    });
    handlers['/api/kiosk/sale/confirm'](req, res);
  });

  test('unresolved tax during confirm WITHOUT body.transaction_id (nothing charged) → 400 naming the item, void NOT called', function (done) {
    var req = {
      body: {
        items:            [{ item_id: 'item-unresolved-pca', name: 'Mystery Import', quantity: 1 }],
        reference_number: 'KIOSK-PCA-NOVOID-001'
        // no transaction_id — nothing was charged
      }
    };
    var res = mockRes();
    var statusCapture = captureStatus(res);
    res.json.mockImplementation(function (body) {
      try {
        expect(statusCapture.code).toBe(400);
        expect(body.error).toMatch(/Mystery Import|item-unresolved-pca/i);
        expect(moneyPath.voidWithTimeout).not.toHaveBeenCalled();
        var invoiceCall = zohoApi.zohoPost.mock.calls.find(function (c) { return c[0] === '/invoices'; });
        expect(invoiceCall).toBeFalsy();
        done();
      } catch (e) { done(e); }
    });
    handlers['/api/kiosk/sale/confirm'](req, res);
  });
});
