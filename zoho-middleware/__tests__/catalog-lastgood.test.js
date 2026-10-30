'use strict';

// Quick task 261029-zq1 Task 2 — never an empty kiosk/website catalog.
//
// Incident 2026-10-29: the shared Zoho Inventory daily quota ran out, the
// 30-minute kiosk cache expired, and GET /api/kiosk/products returned a hard
// 502 — the kiosk could not load products at all. Every successful rebuild now
// also writes a long-lived "last good" copy; when the cache misses and the
// rebuild fails, the endpoint serves that copy with source: 'stale'.
//
// Harness mirrors __tests__/kiosk-catalog-background-refresh.test.js.

var mockRouteHandlers = {};

jest.mock('express', function () {
  var router = {
    get: jest.fn(function (path, handler) { mockRouteHandlers[path] = handler; }),
    post: jest.fn(function (path, handler) { mockRouteHandlers[path] = handler; })
  };
  var express = function () {};
  express.Router = function () { return router; };
  return express;
});

jest.mock('../lib/zoho-api', function () {
  return {
    inventoryGet: jest.fn(),
    fetchAllItems: jest.fn(),
    fetchItemDetailsBulk: jest.fn()
  };
});

jest.mock('../lib/cache', function () {
  return {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    acquireLock: jest.fn(),
    releaseLock: jest.fn(),
    isConnected: jest.fn().mockReturnValue(false)
  };
});

jest.mock('../lib/logger', function () {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
});

jest.mock('../lib/inventory-ledger', function () {
  return {
    reconcile: jest.fn().mockResolvedValue(),
    overlayStock: jest.fn(function (items) {
      return Promise.resolve(items.map(function (i) { return Object.assign({}, i, { overlaid: true }); }));
    })
  };
});

jest.mock('fs', function () {
  return {
    readFileSync: jest.fn(function () { throw new Error('no file'); }),
    writeFile: jest.fn(function (path, data, cb) { if (cb) cb(null); })
  };
});

var C = require('../lib/constants');

var store;

function load() {
  mockRouteHandlers = {};
  jest.resetModules();
  var router = require('../routes/catalog');
  var mocks = {
    router: router,
    zohoApi: require('../lib/zoho-api'),
    cache: require('../lib/cache'),
    ledger: require('../lib/inventory-ledger')
  };
  store = {};
  mocks.cache.get.mockImplementation(function (k) {
    return Promise.resolve(Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null);
  });
  mocks.cache.set.mockImplementation(function (k, v) { store[k] = v; return Promise.resolve(true); });
  mocks.cache.del.mockImplementation(function (k) { delete store[k]; return Promise.resolve(true); });
  mocks.cache.acquireLock.mockResolvedValue(true);
  mocks.cache.releaseLock.mockResolvedValue();
  return mocks;
}

function call(path, query) {
  return new Promise(function (resolve) {
    var res = {
      statusCode: 200,
      status: function (c) { this.statusCode = c; return this; },
      json: function (body) { resolve({ status: this.statusCode, body: body }); }
    };
    mockRouteHandlers[path]({ query: query || {}, headers: {} }, res);
  });
}

function quota429() {
  var err = new Error('Request failed with status code 429');
  err.response = { status: 429, headers: {}, data: { code: 45, message: 'exceeded the maximum call rate limit of 1,000' } };
  return err;
}

var ITEMS = [
  { item_id: '1', name: 'Kit A', sku: 'A', rate: 10, stock_on_hand: 3, tax_percentage: 5 },
  { item_id: '2', name: 'Kit B', sku: 'B', rate: 20, stock_on_hand: 1, tax_percentage: 5 }
];

describe('kiosk catalog last-good copy', function () {
  test('constants define the last-good keys', function () {
    expect(C.CACHE_KEYS.KIOSK_PRODUCTS_LASTGOOD).toBe('kiosk:products:lastgood');
    expect(C.CACHE_KEYS.KIOSK_PRODUCTS_LASTGOOD_AT).toBe('kiosk:products:lastgood:at');
  });

  test('a successful rebuild writes the last-good copy and its ISO timestamp', function () {
    var m = load();
    m.zohoApi.fetchAllItems.mockResolvedValue(ITEMS);
    m.zohoApi.fetchItemDetailsBulk.mockResolvedValue({});
    return m.router.rebuildKioskCatalog().then(function (sellable) {
      expect(store[C.CACHE_KEYS.KIOSK_PRODUCTS_LASTGOOD]).toEqual(sellable);
      var at = store[C.CACHE_KEYS.KIOSK_PRODUCTS_LASTGOOD_AT];
      expect(typeof at).toBe('string');
      expect(new Date(at).toISOString()).toBe(at);
    });
  });

  test('cache miss + rebuild 429 + last-good present → 200 stale, overlaid', function () {
    var m = load();
    store[C.CACHE_KEYS.KIOSK_PRODUCTS_LASTGOOD] = [{ item_id: '1', name: 'Kit A', rate: 10 }];
    store[C.CACHE_KEYS.KIOSK_PRODUCTS_LASTGOOD_AT] = '2026-10-29T16:50:00.000Z';
    m.zohoApi.fetchAllItems.mockRejectedValue(quota429());
    return call('/api/kiosk/products').then(function (r) {
      expect(r.status).toBe(200);
      expect(r.body.source).toBe('stale');
      expect(r.body.stale_at).toBe('2026-10-29T16:50:00.000Z');
      expect(r.body.items).toEqual([{ item_id: '1', name: 'Kit A', rate: 10, overlaid: true }]);
    });
  });

  test('any rebuild error (not just 429) falls back to last-good', function () {
    var m = load();
    store[C.CACHE_KEYS.KIOSK_PRODUCTS_LASTGOOD] = [{ item_id: '1' }];
    m.zohoApi.fetchAllItems.mockRejectedValue(new Error('socket hang up'));
    return call('/api/kiosk/products').then(function (r) {
      expect(r.status).toBe(200);
      expect(r.body.source).toBe('stale');
      expect(r.body.stale_at).toBeNull();
    });
  });

  test('overlay failure on the stale path still serves the raw last-good copy', function () {
    var m = load();
    store[C.CACHE_KEYS.KIOSK_PRODUCTS_LASTGOOD] = [{ item_id: '1' }];
    m.zohoApi.fetchAllItems.mockRejectedValue(quota429());
    m.ledger.overlayStock.mockRejectedValue(new Error('redis down'));
    return call('/api/kiosk/products').then(function (r) {
      expect(r.status).toBe(200);
      expect(r.body.source).toBe('stale');
      expect(r.body.items).toEqual([{ item_id: '1' }]);
    });
  });

  test('cache miss + rebuild fails + NO last-good → existing 502', function () {
    var m = load();
    m.zohoApi.fetchAllItems.mockRejectedValue(quota429());
    return call('/api/kiosk/products').then(function (r) {
      expect(r.status).toBe(502);
      expect(r.body.error).toBe('Unable to fetch kiosk products');
      expect(r.body.zoho_status).toBe(429);
    });
  });

  test('an empty last-good array is not served (502 instead)', function () {
    var m = load();
    store[C.CACHE_KEYS.KIOSK_PRODUCTS_LASTGOOD] = [];
    m.zohoApi.fetchAllItems.mockRejectedValue(quota429());
    return call('/api/kiosk/products').then(function (r) {
      expect(r.status).toBe(502);
    });
  });

  test('a failed background refresh does not touch the last-good copy', function () {
    var m = load();
    store[C.CACHE_KEYS.KIOSK_PRODUCTS_LASTGOOD] = [{ item_id: '1' }];
    m.zohoApi.fetchAllItems.mockRejectedValue(quota429());
    return m.router.refreshKioskCatalogInBackground().then(function () {
      expect(store[C.CACHE_KEYS.KIOSK_PRODUCTS_LASTGOOD]).toEqual([{ item_id: '1' }]);
    });
  });
});

describe('website /api/products last-good copy', function () {
  var KIT = [{ item_id: '10', name: 'Merlot Kit', rate: 100, product_type: 'goods', group_name: '' }];
  var KIT_DETAIL = { '10': { item_id: '10', custom_fields: [{ label: 'Type', value: 'wine' }] } };

  test('constants define the products last-good keys', function () {
    expect(C.CACHE_KEYS.PRODUCTS_LASTGOOD).toBe('zoho:products:lastgood');
    expect(C.CACHE_KEYS.PRODUCTS_LASTGOOD_AT).toBe('zoho:products:lastgood:at');
  });

  test('a successful refresh writes the last-good copy', function () {
    var m = load();
    m.zohoApi.fetchAllItems.mockResolvedValue(KIT.map(function (i) { return Object.assign({}, i); }));
    m.zohoApi.fetchItemDetailsBulk.mockResolvedValue(KIT_DETAIL);
    return m.router.refreshProducts().then(function (enriched) {
      expect(enriched).toHaveLength(1);
      expect(store[C.CACHE_KEYS.PRODUCTS_LASTGOOD]).toEqual(enriched);
      expect(typeof store[C.CACHE_KEYS.PRODUCTS_LASTGOOD_AT]).toBe('string');
    });
  });

  test('cache + file miss with a last-good copy → 200 stale (no blank page)', function () {
    var m = load();
    store[C.CACHE_KEYS.PRODUCTS_LASTGOOD] = [{ item_id: '10', name: 'Merlot Kit' }];
    store[C.CACHE_KEYS.PRODUCTS_LASTGOOD_AT] = '2026-10-29T16:00:00.000Z';
    m.zohoApi.fetchAllItems.mockRejectedValue(quota429());
    return call('/api/products').then(function (r) {
      expect(r.status).toBe(200);
      expect(r.body.source).toBe('stale');
      expect(r.body.stale_at).toBe('2026-10-29T16:00:00.000Z');
      expect(r.body.items[0].overlaid).toBe(true);
    });
  });

  test('cache miss, no last-good, refresh fails → existing 502', function () {
    var m = load();
    m.zohoApi.fetchAllItems.mockRejectedValue(quota429());
    return call('/api/products').then(function (r) {
      expect(r.status).toBe(502);
    });
  });
});

describe('website /api/ingredients last-good copy', function () {
  var ING = [{ item_id: '20', name: 'Pale Malt', rate: 3, product_type: 'goods', cf_type: '' }];

  test('constants define the ingredients last-good keys', function () {
    expect(C.CACHE_KEYS.INGREDIENTS_LASTGOOD).toBe('zoho:ingredients:lastgood');
    expect(C.CACHE_KEYS.INGREDIENTS_LASTGOOD_AT).toBe('zoho:ingredients:lastgood:at');
  });

  test('a successful refresh writes the last-good copy', function () {
    var m = load();
    m.zohoApi.fetchAllItems.mockResolvedValue(ING.map(function (i) { return Object.assign({}, i); }));
    m.zohoApi.fetchItemDetailsBulk.mockResolvedValue({});
    return m.router.refreshIngredients().then(function (enriched) {
      expect(enriched).toHaveLength(1);
      expect(store[C.CACHE_KEYS.INGREDIENTS_LASTGOOD]).toEqual(enriched);
      expect(typeof store[C.CACHE_KEYS.INGREDIENTS_LASTGOOD_AT]).toBe('string');
    });
  });

  test('cache + file miss with a last-good copy → 200 stale', function () {
    var m = load();
    store[C.CACHE_KEYS.INGREDIENTS_LASTGOOD] = [{ item_id: '20', name: 'Pale Malt' }];
    store[C.CACHE_KEYS.INGREDIENTS_LASTGOOD_AT] = '2026-10-29T16:00:00.000Z';
    m.zohoApi.fetchAllItems.mockRejectedValue(quota429());
    return call('/api/ingredients').then(function (r) {
      expect(r.status).toBe(200);
      expect(r.body.source).toBe('stale');
      expect(r.body.items[0].overlaid).toBe(true);
    });
  });

  test('cache miss, no last-good, refresh fails → existing 502', function () {
    var m = load();
    m.zohoApi.fetchAllItems.mockRejectedValue(quota429());
    return call('/api/ingredients').then(function (r) {
      expect(r.status).toBe(502);
    });
  });
});

// 261029-zq1 Task 3: item details are cached for 6 h in lib/zoho-api; the
// explicit staff refresh paths must still force fresh details.
describe('explicit refresh forces fresh item details', function () {
  test('kiosk ?bust=1 rebuild passes { force: true }', function () {
    var m = load();
    m.zohoApi.fetchAllItems.mockResolvedValue(ITEMS);
    m.zohoApi.fetchItemDetailsBulk.mockResolvedValue({});
    var authTiers = require('../lib/authTiers');
    jest.spyOn(authTiers, 'requireTiers').mockReturnValue(function (req, res, next) { next(); });
    return call('/api/kiosk/products', { bust: '1' }).then(function (r) {
      expect(r.status).toBe(200);
      expect(m.zohoApi.fetchItemDetailsBulk).toHaveBeenCalledWith(['1', '2'], { force: true });
    });
  });

  test('scheduled/background kiosk refresh uses the detail cache (no force)', function () {
    var m = load();
    m.zohoApi.fetchAllItems.mockResolvedValue(ITEMS);
    m.zohoApi.fetchItemDetailsBulk.mockResolvedValue({});
    return m.router.refreshKioskCatalogInBackground().then(function () {
      expect(m.zohoApi.fetchItemDetailsBulk).toHaveBeenCalledWith(['1', '2']);
    });
  });

  test('admin cache-clear forces fresh product details', function () {
    var m = load();
    m.zohoApi.fetchAllItems.mockResolvedValue([{ item_id: '10', name: 'Merlot Kit', rate: 100, group_name: '' }]);
    m.zohoApi.fetchItemDetailsBulk.mockResolvedValue({ '10': { custom_fields: [{ label: 'Type', value: 'wine' }] } });
    return call('/api/admin/cache-clear').then(function (r) {
      expect(r.body.ok).toBe(true);
      expect(m.zohoApi.fetchItemDetailsBulk.mock.calls[0]).toEqual([['10'], { force: true }]);
    });
  });
});

// 261029-zq1 (deviation, Rule 2): a staff refresh (?bust=1) DELETES the kiosk
// cache before rebuilding. With Zoho unavailable (quota exhausted) the rebuild
// fails and the deleted cache is the very catalog processSale anchors prices
// to — every sale then 400s until the reset. A failed bust rebuild now puts
// the previous entry back.
describe('kiosk ?bust=1 restores the cache when the rebuild fails', function () {
  test('bust + rebuild failure restores the kiosk cache and serves last-good', function () {
    var m = load();
    var authTiers = require('../lib/authTiers');
    jest.spyOn(authTiers, 'requireTiers').mockReturnValue(function (req, res, next) { next(); });
    store[C.CACHE_KEYS.KIOSK_PRODUCTS] = [{ item_id: '1', rate: 10 }];
    store[C.CACHE_KEYS.KIOSK_PRODUCTS_LASTGOOD] = [{ item_id: '1', rate: 10 }];
    m.zohoApi.fetchAllItems.mockRejectedValue(quota429());
    return call('/api/kiosk/products', { bust: '1' }).then(function (r) {
      expect(r.status).toBe(200);
      expect(r.body.source).toBe('stale');
      expect(store[C.CACHE_KEYS.KIOSK_PRODUCTS]).toEqual([{ item_id: '1', rate: 10 }]);
    });
  });

  test('bust + successful rebuild replaces the cache with fresh data', function () {
    var m = load();
    var authTiers = require('../lib/authTiers');
    jest.spyOn(authTiers, 'requireTiers').mockReturnValue(function (req, res, next) { next(); });
    store[C.CACHE_KEYS.KIOSK_PRODUCTS] = [{ item_id: 'old' }];
    m.zohoApi.fetchAllItems.mockResolvedValue(ITEMS);
    m.zohoApi.fetchItemDetailsBulk.mockResolvedValue({});
    return call('/api/kiosk/products', { bust: '1' }).then(function (r) {
      expect(r.body.source).toBe('zoho');
      expect(store[C.CACHE_KEYS.KIOSK_PRODUCTS].map(function (i) { return i.item_id; })).toEqual(['1', '2']);
    });
  });
});
