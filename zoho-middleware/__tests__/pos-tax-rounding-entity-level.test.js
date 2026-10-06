'use strict';

/**
 * pos-tax-rounding-entity-level.test.js — kiosk 1-cent tax drift vs Zoho
 *
 * Incident 2026-10-03 (INV-000226): a $25 fixed-discount kit sale was pushed
 * to the terminal at $247.59 while Zoho created the invoice at $247.58. The
 * $247.59 customer payment then 400'd against the $247.58 balance ("Payment
 * recording failed: Request failed with status code 400"), the sale threw,
 * and the customer was left charged with an unpaid invoice.
 *
 * Root cause: computeTax summed UNROUNDED per-line tax and rounded once
 *   Makers Fee 40.83 x 5%  = 2.0415
 *   Materials  4.54 x 12% = 0.5448
 *   sum 2.5863 -> 2.59
 * whereas the Zoho org uses tax_rounding: "entity_level" — each tax is
 * rounded on its own across the invoice and the rounded taxes are summed:
 *   GST 2.04 + BC PST+GST 0.54 = 2.58   (verified on INV-000226's `taxes`)
 *
 * Fix: group taxable amounts by tax rate, round each group, then sum —
 * mirrored in js/kiosk-core.js kioskCalcTotals so displayed == charged.
 * RED before the fix, GREEN after.
 *
 * Mock block cloned from pos-discount-rounding.test.js (pos.js needs its
 * dependencies mocked to load; only the exported computeTax is exercised).
 */

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

var computeTax;

beforeAll(function () {
  computeTax = require('../routes/pos').computeTax;
});

function catalog(items) {
  var map = {};
  items.forEach(function (it) { map[it.item_id] = it; });
  return map;
}

describe('computeTax — entity_level tax rounding (matches Zoho)', function () {
  test('INV-000226 reproduction: $25-off kit sale taxes to 2.58, not 2.59', function () {
    var cat = catalog([
      { item_id: 'kit', name: 'Passport Cabernet Mataro Merlot', tax_percentage: 0, tax_id: 'zero' },
      { item_id: 'makers', name: 'Makers Fee', tax_percentage: 5, tax_id: 'gst' },
      { item_id: 'mat', name: 'Materials Fee', tax_percentage: 12, tax_id: 'pst-gst' }
    ]);
    // Discount shares exactly as resolveDiscount/the client allocate them
    // (and as Zoho recorded them on INV-000226): 20.37 + 4.17 + 0.46 = 25.00.
    var lines = [
      { item_id: 'kit', quantity: 1, rate: 220, discount: 20.37 },
      { item_id: 'makers', quantity: 1, rate: 45, discount: 4.17 },
      { item_id: 'mat', quantity: 1, rate: 5, discount: 0.46 }
    ];
    expect(computeTax(lines, cat)).toEqual({ taxTotal: 2.58 });
  });

  test('lines sharing a rate are rounded together, not per line', function () {
    // Two 5% lines of $0.50: per-line rounding would give 0.03 + 0.03 = 0.06;
    // entity_level rounds the GST total once: 0.05.
    var cat = catalog([
      { item_id: 'a', name: 'A', tax_percentage: 5, tax_id: 'gst' },
      { item_id: 'b', name: 'B', tax_percentage: 5, tax_id: 'gst' }
    ]);
    var lines = [
      { item_id: 'a', quantity: 1, rate: 0.5 },
      { item_id: 'b', quantity: 1, rate: 0.5 }
    ];
    expect(computeTax(lines, cat)).toEqual({ taxTotal: 0.05 });
  });

  test('undiscounted whole-dollar kit sale is unchanged (2.25 + 0.60 = 2.85)', function () {
    var cat = catalog([
      { item_id: 'kit', name: 'Kit', tax_percentage: 0, tax_id: 'zero' },
      { item_id: 'makers', name: 'Makers Fee', tax_percentage: 5, tax_id: 'gst' },
      { item_id: 'mat', name: 'Materials Fee', tax_percentage: 12, tax_id: 'pst-gst' }
    ]);
    var lines = [
      { item_id: 'kit', quantity: 1, rate: 220 },
      { item_id: 'makers', quantity: 1, rate: 45 },
      { item_id: 'mat', quantity: 1, rate: 5 }
    ];
    expect(computeTax(lines, cat)).toEqual({ taxTotal: 2.85 });
  });

  test('custom lines join the group for their own rate', function () {
    // Custom 5% line $0.50 + catalog 5% line $0.50 -> one GST group -> 0.05.
    var cat = catalog([{ item_id: 'a', name: 'A', tax_percentage: 5, tax_id: 'gst' }]);
    var lines = [
      { item_id: 'a', quantity: 1, rate: 0.5 },
      { custom: true, quantity: 1, rate: 0.5, tax_percentage: 5 }
    ];
    expect(computeTax(lines, cat)).toEqual({ taxTotal: 0.05 });
  });
});
