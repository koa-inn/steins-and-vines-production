'use strict';

/**
 * kiosk-sale-catalog-lastgood.test.js — follow-up to 261029-zq1
 * (owner-approved 2026-10-29).
 *
 * When the live kiosk catalog (zoho:kiosk-products) cannot price the cart and
 * the one sale-time rebuild FAILS (Zoho Inventory quota exhausted, 429,
 * outage), kiosk sales price from the last-good catalog
 * (kiosk:products:lastgood) instead of 400 "Item not found in current
 * catalog". With no last-good copy, or an item absent from it too, the
 * existing 400 is unchanged. The cache-hit path never reads last-good.
 *
 * Harness cloned from pos-cash-tender.test.js (+ routes/catalog mock).
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
    terminalPurchase: jest.fn().mockResolvedValue({ idempotencyKey: 'idem-cash-1' }),
    pollTerminalResult: jest.fn().mockResolvedValue({
      approved: true, transactionId: 'txn-cash-123', authorizationCode: 'AUTH1', cardType: 'Visa'
    }),
    voidTransaction: jest.fn().mockResolvedValue({}),
    getTerminalDiagnostics: jest.fn().mockReturnValue({}),
    generateIdempotencyKey: jest.fn().mockReturnValue('idem-cash-so-1'),
    cancelTerminal: jest.fn().mockResolvedValue({})
  };
});

jest.mock('../lib/zoho-api', function () {
  return {
    zohoGet: jest.fn(),
    zohoPost: jest.fn().mockResolvedValue({ invoice: { invoice_id: 'inv-cash-1', invoice_number: 'INV-CASH-001' } }),
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

jest.mock('../routes/catalog', function () {
  return { rebuildKioskCatalog: jest.fn() };
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
      INGREDIENTS_ALL:             'zoho:ingredients:all',
      KIOSK_PRODUCTS_LASTGOOD:     'test:kiosk-products:lastgood',
      KIOSK_PRODUCTS_LASTGOOD_AT:  'test:kiosk-products:lastgood:at'
    },
    LOCK_KEYS: { RECIPE_SALE: 'recipe-sale' },
    LEDGER_KEYS: {},
    RATE_LIMIT_PREFIX: 'test:rl:'
  };
});

// =============================================================================
// Test harness (mirrors pos-money-defects.test.js getPosHandlers)
// =============================================================================

var cache, helcimLib, axiosMock, zohoApi, moneyPath, ledger, router, handlers, catalogRoutes, eventLog, log;

function getHandlers() {
  jest.resetModules();
  cache      = require('../lib/cache');
  helcimLib  = require('../lib/helcim');
  axiosMock  = require('axios');
  zohoApi    = require('../lib/zoho-api');
  moneyPath  = require('../lib/money-path');
  ledger     = require('../lib/inventory-ledger');
  catalogRoutes = require('../routes/catalog');
  eventLog   = require('../lib/eventLog');
  log        = require('../lib/logger');
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


var ITEM = '1099000000000109999';
var PHANTOM = '1099000000000000001';
var STALE_AT = '2026-10-29T16:50:00.000Z';
// tax_id set + 0% so the grand total is exactly the catalog rate.
var LAST_GOOD = [
  { item_id: ITEM, name: 'Kit X', sku: 'SKU-X', rate: 42, stock_on_hand: 5, tax_id: 'test-zero-tax', tax_percentage: 0, custom_fields: [] }
];

function mockCacheStore(store) {
  cache.get.mockImplementation(function (key) {
    return Promise.resolve(Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null);
  });
}

function lastGoodReads() {
  return cache.get.mock.calls.filter(function (c) {
    return c[0] === 'test:kiosk-products:lastgood' || c[0] === 'test:kiosk-products:lastgood:at';
  }).length;
}

function cart(id, rate) {
  return [{ item_id: id || ITEM, name: 'Kit X', quantity: 1, rate: rate === undefined ? 1 : rate }];
}

function run(path, body) {
  return new Promise(function (resolve) {
    var res = mockRes();
    var out = { code: null, body: null };
    res.status.mockImplementation(function (code) { out.code = code; return res; });
    res.json.mockImplementation(function (b) { out.body = b; res.headersSent = true; resolve(out); return res; });
    handlers[path]({ body: body }, res);
  });
}

function zohoUnavailable() {
  var err = new Error('Zoho Inventory quota exhausted');
  err.quotaExhausted = true;
  return err;
}

describe('lib/kiosk-sale-catalog getKioskCatalogForSale', function () {
  beforeEach(function () { getHandlers(); });

  test('cache hit → source cache, no rebuild, no last-good read', function () {
    mockCacheStore({ 'test:kiosk-products': LAST_GOOD, 'test:kiosk-products:lastgood': LAST_GOOD });
    return require('../lib/kiosk-sale-catalog').getKioskCatalogForSale().then(function (r) {
      expect(r.source).toBe('cache');
      expect(r.items).toBe(LAST_GOOD);
      expect(catalogRoutes.rebuildKioskCatalog).not.toHaveBeenCalled();
      expect(lastGoodReads()).toBe(0);
    });
  });

  test('miss → rebuild → source zoho', function () {
    mockCacheStore({});
    catalogRoutes.rebuildKioskCatalog.mockResolvedValue(LAST_GOOD);
    return require('../lib/kiosk-sale-catalog').getKioskCatalogForSale().then(function (r) {
      expect(r.source).toBe('zoho');
      expect(lastGoodReads()).toBe(0);
    });
  });

  test('miss + rebuild fails + last-good → source stale with staleAt', function () {
    mockCacheStore({ 'test:kiosk-products:lastgood': LAST_GOOD, 'test:kiosk-products:lastgood:at': STALE_AT });
    catalogRoutes.rebuildKioskCatalog.mockRejectedValue(zohoUnavailable());
    return require('../lib/kiosk-sale-catalog').getKioskCatalogForSale().then(function (r) {
      expect(r.source).toBe('stale');
      expect(r.staleAt).toBe(STALE_AT);
      expect(r.items).toEqual(LAST_GOOD);
    });
  });

  test('miss + rebuild fails + no last-good → rethrows the rebuild error', function () {
    mockCacheStore({});
    catalogRoutes.rebuildKioskCatalog.mockRejectedValue(zohoUnavailable());
    return require('../lib/kiosk-sale-catalog').getKioskCatalogForSale().then(function () {
      throw new Error('expected rejection');
    }, function (err) {
      expect(err.message).toBe('Zoho Inventory quota exhausted');
      expect(err.stage).toBe('rebuild');
    });
  });
});

describe('POST /api/kiosk/sale — last-good catalog when the rebuild fails', function () {
  beforeEach(function () { getHandlers(); });

  test('rebuild fails + last-good has the item → sale proceeds at the last-good rate (client rate ignored)', function () {
    mockCacheStore({ 'test:kiosk-products:lastgood': LAST_GOOD, 'test:kiosk-products:lastgood:at': STALE_AT });
    catalogRoutes.rebuildKioskCatalog.mockRejectedValue(zohoUnavailable());
    return run('/api/kiosk/sale', { items: cart(ITEM, 999999) }).then(function (out) {
      expect(out.code).toBe(202);
      expect(out.body.pending).toBe(true);
      expect(helcimLib.terminalPurchase.mock.calls[0][0]).toBe(42);
      expect(catalogRoutes.rebuildKioskCatalog).toHaveBeenCalledTimes(1);
      var warns = log.warn.mock.calls.filter(function (c) { return /last-good/.test(c[0]); });
      expect(warns.length).toBe(1);
      expect(warns[0][0]).toContain(STALE_AT);
    });
  });

  test('stale sale: the sale event-log record carries catalog_source stale', function () {
    mockCacheStore({ 'test:kiosk-products:lastgood': LAST_GOOD, 'test:kiosk-products:lastgood:at': STALE_AT });
    catalogRoutes.rebuildKioskCatalog.mockRejectedValue(zohoUnavailable());
    return run('/api/kiosk/sale', { items: cart() }).then(function () {
      var ev = eventLog.logEvent.mock.calls.filter(function (c) {
        return c[0] === 'kiosk.sale_stage_timing' && c[1].stage === 'catalog_read';
      });
      expect(ev.length).toBe(1);
      expect(ev[0][1].catalog_source).toBe('stale');
    });
  });

  test('rebuild fails + no last-good → existing 400 "Item not found in current catalog"', function () {
    mockCacheStore({});
    catalogRoutes.rebuildKioskCatalog.mockRejectedValue(zohoUnavailable());
    return run('/api/kiosk/sale', { items: cart() }).then(function (out) {
      expect(out.code).toBe(400);
      expect(out.body.error).toContain('Item not found in current catalog: ' + ITEM);
      expect(helcimLib.terminalPurchase).not.toHaveBeenCalled();
    });
  });

  test('item absent from BOTH live and last-good → existing 400', function () {
    mockCacheStore({ 'test:kiosk-products:lastgood': LAST_GOOD, 'test:kiosk-products:lastgood:at': STALE_AT });
    catalogRoutes.rebuildKioskCatalog.mockRejectedValue(zohoUnavailable());
    return run('/api/kiosk/sale', { items: cart(PHANTOM) }).then(function (out) {
      expect(out.code).toBe(400);
      expect(out.body.error).toContain('Item not found in current catalog: ' + PHANTOM);
      expect(helcimLib.terminalPurchase).not.toHaveBeenCalled();
    });
  });

  test('cache hit path unchanged: no rebuild, no last-good read, no catalog_source', function () {
    mockCacheStore({ 'test:kiosk-products': LAST_GOOD, 'test:kiosk-products:lastgood': LAST_GOOD });
    return run('/api/kiosk/sale', { items: cart() }).then(function (out) {
      expect(out.code).toBe(202);
      expect(catalogRoutes.rebuildKioskCatalog).not.toHaveBeenCalled();
      expect(lastGoodReads()).toBe(0);
      var ev = eventLog.logEvent.mock.calls.filter(function (c) {
        return c[0] === 'kiosk.sale_stage_timing' && c[1].stage === 'catalog_read';
      });
      expect(ev[0][1].cache).toBe('hit');
      expect(ev[0][1].catalog_source).toBeUndefined();
    });
  });
});

describe('POST /api/kiosk/sale/confirm — prices from last-good when the live cache cannot', function () {
  beforeEach(function () {
    getHandlers();
    process.env.KIOSK_CONTACT_ID = 'contact-walkin';
  });
  afterEach(function () { delete process.env.KIOSK_CONTACT_ID; });

  test('empty live cache + last-good → invoice at last-good rate, sale_completed carries catalog_source stale, no rebuild', function () {
    mockCacheStore({ 'test:kiosk-products:lastgood': LAST_GOOD, 'test:kiosk-products:lastgood:at': STALE_AT });
    return run('/api/kiosk/sale/confirm', { items: cart(ITEM, 999999), tender: 'cash', reference_number: 'KIOSK-LG-1' }).then(function (out) {
      expect(out.code).toBe(201);
      expect(out.body.total).toBe(42);
      expect(catalogRoutes.rebuildKioskCatalog).not.toHaveBeenCalled();
      var ev = eventLog.logEvent.mock.calls.filter(function (c) { return c[0] === 'kiosk.sale_completed'; });
      expect(ev.length).toBe(1);
      expect(ev[0][1].catalog_source).toBe('stale');
    });
  });

  test('live cache hit → no last-good read, no catalog_source', function () {
    mockCacheStore({ 'test:kiosk-products': LAST_GOOD });
    return run('/api/kiosk/sale/confirm', { items: cart(), tender: 'cash', reference_number: 'KIOSK-LG-2' }).then(function (out) {
      expect(out.code).toBe(201);
      expect(lastGoodReads()).toBe(0);
      var ev = eventLog.logEvent.mock.calls.filter(function (c) { return c[0] === 'kiosk.sale_completed'; });
      expect(ev[0][1].catalog_source).toBeUndefined();
    });
  });

  test('no live cache and no last-good → existing 400', function () {
    mockCacheStore({});
    return run('/api/kiosk/sale/confirm', { items: cart(), tender: 'cash', reference_number: 'KIOSK-LG-3' }).then(function (out) {
      expect(out.code).toBe(400);
      expect(out.body.error).toContain('Item not found in catalog');
    });
  });
});
