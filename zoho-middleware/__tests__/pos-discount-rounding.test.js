'use strict';

/**
 * pos-discount-rounding.test.js — Phase 67 review fix CR-01
 *
 * The pre-charge assertion (client_grand_total vs server grandTotal, $0.01
 * tolerance) deterministically FALSE-REJECTED legitimate discounted sales
 * because the client and server used different discount-rounding
 * methodologies:
 *
 *   - Percentage discounts: the client rounds the discount PER LINE
 *     (kioskR2(lt * pct / 100), kiosk-core.js kioskCalcTotals) and sums the
 *     rounded values; the server summed unrounded lt * (1 - pct/100) and
 *     rounded the SUM once. ~half a cent of drift per line.
 *   - Fixed discounts: the client allocates proportional per-line shares and
 *     gives the LAST matched line the exact remainder (total discount ==
 *     preset value); the server rounded every share independently with no
 *     remainder correction, so its effective discount could differ from the
 *     preset by several cents.
 *
 * Because the divergence is a pure methodology artifact it is DETERMINISTIC:
 * re-ringing the identical cart reproduces the identical 400 — a hard
 * checkout outage for affected discount+cart combinations (reviewer verified
 * 3,033 divergent combinations on realistic price grids).
 *
 * Fix: the server's discount/tax computation now mirrors the client's
 * per-line rounding methodology EXACTLY (resolveDiscount + computeTax in
 * pos.js), so displayed == charged to the cent and the honest $0.01
 * tolerance stays.
 *
 * These tests reproduce the reviewer's exact failing example plus a
 * fixed-discount case. RED before the pos.js fix, GREEN after.
 *
 * Mock block cloned from pos-precharge-assertion.test.js.
 */

// =============================================================================
// Mock block (cloned from pos-precharge-assertion.test.js)
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
    terminalPurchase: jest.fn().mockResolvedValue({ idempotencyKey: 'idem-pdr-1' }),
    pollTerminalResult: jest.fn().mockResolvedValue({
      approved: true, transactionId: 'txn-pdr-123', authorizationCode: 'AUTH1', cardType: 'Visa'
    }),
    voidTransaction: jest.fn().mockResolvedValue({}),
    getTerminalDiagnostics: jest.fn().mockReturnValue({}),
    generateIdempotencyKey: jest.fn().mockReturnValue('idem-pdr-so-1'),
    cancelTerminal: jest.fn().mockResolvedValue({})
  };
});

jest.mock('../lib/zoho-api', function () {
  return {
    zohoGet: jest.fn(),
    zohoPost: jest.fn().mockResolvedValue({ invoice: { invoice_id: 'inv-pdr-1', invoice_number: 'INV-PDR-001' } }),
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
// Fixtures — the reviewer's exact CR-01 failing example
// =============================================================================

// 3-line cart: $1.50 + $1.95 + 2 x $1.50, all taxed 12% (resolved via
// tax_percentage + tax_id — no rule needed).
var CATALOG_PCT = [
  { item_id: 'pdr-a', name: 'Item A', rate: 1.50, stock_on_hand: 10, tax_percentage: 12, tax_id: 'tax-12', custom_fields: [] },
  { item_id: 'pdr-b', name: 'Item B', rate: 1.95, stock_on_hand: 10, tax_percentage: 12, tax_id: 'tax-12', custom_fields: [] },
  { item_id: 'pdr-c', name: 'Item C', rate: 1.50, stock_on_hand: 10, tax_percentage: 12, tax_id: 'tax-12', custom_fields: [] }
];

// 6 lines of $1.00, resolved 0% (explicit tax_percentage 0 + tax_id) — used
// for the fixed-discount remainder-allocation case.
var CATALOG_FIXED = [1, 2, 3, 4, 5, 6].map(function (n) {
  return { item_id: 'pdr-f' + n, name: 'Fixed Item ' + n, rate: 1.00, stock_on_hand: 10, tax_percentage: 0, tax_id: 'exempt-tax', custom_fields: [] };
});

var PRESETS = [
  { id: 'pdr-disc-5pct',  name: '5% Off',    active: true, scope: 'cart', type: 'percentage', value: 5 },
  { id: 'pdr-disc-2fix',  name: '$2 Off',    active: true, scope: 'cart', type: 'fixed',      value: 2.00 }
];

// =============================================================================
// Test harness for pos.js (cloned from pos-precharge-assertion.test.js)
// =============================================================================

var cache, helcimLib, moneyPath, router, handlers;

function getPosHandlers() {
  jest.resetModules();
  cache      = require('../lib/cache');
  helcimLib  = require('../lib/helcim');
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

function failOn4xx(res, done) {
  res.status.mockImplementation(function (code) {
    if (code >= 400) {
      return { json: function (body) { done(new Error('Got status ' + code + ': ' + JSON.stringify(body))); } };
    }
    return res;
  });
}

describe('CR-01 — discounted carts must not false-reject the pre-charge assertion', function () {

  beforeEach(function () {
    getPosHandlers();
    process.env.KIOSK_CONTACT_ID = 'contact-walkin';
    moneyPath.acquireIdempotencyLock.mockResolvedValue({ status: 'acquired' });
  });

  afterEach(function () {
    delete process.env.KIOSK_CONTACT_ID;
  });

  function mockCatalog(catalog) {
    cache.get.mockImplementation(function (key) {
      if (key === 'test:kiosk-products') return Promise.resolve(catalog);
      if (key === 'test:kiosk-discount-presets') return Promise.resolve(PRESETS);
      return Promise.resolve(null);
    });
  }

  // Reviewer's exact failing example: $1.50 + $1.95 + 2x$1.50 at 12% tax with
  // a 5% cart discount. Client methodology (per-line rounded discounts):
  //   d = 0.08 + 0.10 + 0.15 = 0.33; taxable = 6.12; tax = R2(0.7344) = 0.73
  //   client total = R2(6.45 - 0.33 + 0.73) = 6.85
  // The OLD server methodology (round-the-sum-once) computed 6.87 →
  // |6.85 - 6.87| = 0.02 > 0.01 → deterministic 400, re-ring reproduces it.
  test('percentage discount: client per-line-rounded total (6.85) is accepted and charged exactly', function (done) {
    mockCatalog(CATALOG_PCT);
    var req = {
      body: {
        items: [
          { item_id: 'pdr-a', name: 'Item A', quantity: 1 },
          { item_id: 'pdr-b', name: 'Item B', quantity: 1 },
          { item_id: 'pdr-c', name: 'Item C', quantity: 2 }
        ],
        discount:           { preset_id: 'pdr-disc-5pct' },
        idempotency_key:    'pdr-pct-key-001',
        client_grand_total: 6.85, // the kiosk's displayed total (client methodology)
        client_tax_total:   0.73
      }
    };
    var res = mockRes();
    res.json.mockImplementation(function (body) {
      try {
        expect(body.pending).toBe(true);
        expect(helcimLib.terminalPurchase).toHaveBeenCalled();
        // Server must now charge the SAME cent-exact total the kiosk displayed.
        expect(helcimLib.terminalPurchase.mock.calls[0][0]).toBe(6.85);
        done();
      } catch (e) { done(e); }
    });
    failOn4xx(res, done);
    handlers['/api/kiosk/sale'](req, res);
  });

  // Fixed-discount remainder allocation: 6 x $1.00 with a $2.00 fixed cart
  // discount. Client: shares 0.33 x 5, last line absorbs the 0.35 remainder →
  // total discount exactly $2.00 → client total $4.00 (0% tax).
  // OLD server: every share rounded independently (0.33 x 6 = 1.98) → server
  // total $4.02 → |4.00 - 4.02| = 0.02 > 0.01 → deterministic 400.
  test('fixed discount: client last-line-remainder total (4.00) is accepted and the preset value is discounted exactly', function (done) {
    mockCatalog(CATALOG_FIXED);
    var req = {
      body: {
        items: CATALOG_FIXED.map(function (p) { return { item_id: p.item_id, name: p.name, quantity: 1 }; }),
        discount:           { preset_id: 'pdr-disc-2fix' },
        idempotency_key:    'pdr-fix-key-001',
        client_grand_total: 4.00,
        client_tax_total:   0
      }
    };
    var res = mockRes();
    res.json.mockImplementation(function (body) {
      try {
        expect(body.pending).toBe(true);
        expect(helcimLib.terminalPurchase).toHaveBeenCalled();
        expect(helcimLib.terminalPurchase.mock.calls[0][0]).toBe(4.00);
        done();
      } catch (e) { done(e); }
    });
    failOn4xx(res, done);
    handlers['/api/kiosk/sale'](req, res);
  });

  // The detector must stay honest: a REAL divergence (stale client quote)
  // beyond $0.01 still rejects, even on a discounted cart.
  test('percentage discount: a genuinely stale client total still 400s (tolerance not widened)', function (done) {
    mockCatalog(CATALOG_PCT);
    var req = {
      body: {
        items: [
          { item_id: 'pdr-a', name: 'Item A', quantity: 1 },
          { item_id: 'pdr-b', name: 'Item B', quantity: 1 },
          { item_id: 'pdr-c', name: 'Item C', quantity: 2 }
        ],
        discount:           { preset_id: 'pdr-disc-5pct' },
        idempotency_key:    'pdr-stale-key-001',
        client_grand_total: 6.45 // stale quote (e.g. old rates) — off by 0.40
      }
    };
    var res = mockRes();
    var captured = { code: null };
    res.status.mockImplementation(function (code) { captured.code = code; return res; });
    res.json.mockImplementation(function (body) {
      try {
        expect(captured.code).toBe(400);
        expect(body.error).toBeTruthy();
        expect(helcimLib.terminalPurchase).not.toHaveBeenCalled();
        expect(cache.releaseLock).toHaveBeenCalledWith('test:idem:pdr-stale-key-001');
        done();
      } catch (e) { done(e); }
    });
    handlers['/api/kiosk/sale'](req, res);
  });
});
