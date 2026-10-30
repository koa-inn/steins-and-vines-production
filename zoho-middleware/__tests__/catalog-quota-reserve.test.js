'use strict';

// Quick task 261029-zq1 Task 4 — background/scheduled catalog refreshes stand
// down while the shared Zoho Inventory quota is below ZOHO_QUOTA_RESERVE (or
// exhausted), keeping the remaining calls for interactive requests and sales.
// Interactive (cache-miss) requests are never blocked by the reserve.
//
// Harness mirrors __tests__/catalog-lastgood.test.js.

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

var mockSkip = false;
jest.mock('../lib/zoho-quota', function () {
  return {
    shouldSkipBackground: jest.fn(function () { return mockSkip; }),
    snapshot: jest.fn(function () { return { remaining: 120, limit: 1000, resetAt: null }; })
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

function flush() {
  return new Promise(function (r) { setImmediate(r); });
}

beforeEach(function () {
  mockSkip = false;
});

describe('reserve: background refreshes skip, interactive ones do not', function () {
  test('kiosk background refresh is skipped under the reserve', function () {
    var m = load();
    mockSkip = true;
    m.zohoApi.fetchAllItems.mockResolvedValue(ITEMS);
    return m.router.refreshKioskCatalogInBackground().then(function (result) {
      expect(result).toBeNull();
      expect(m.zohoApi.fetchAllItems).not.toHaveBeenCalled();
    });
  });

  test('kiosk background refresh runs when the quota is healthy', function () {
    var m = load();
    m.zohoApi.fetchAllItems.mockResolvedValue(ITEMS);
    m.zohoApi.fetchItemDetailsBulk.mockResolvedValue({});
    return m.router.refreshKioskCatalogInBackground().then(function (result) {
      expect(result).toHaveLength(2);
    });
  });

  test('refreshProducts({ background: true }) is skipped; interactive refreshProducts() is not', function () {
    var m = load();
    mockSkip = true;
    m.zohoApi.fetchAllItems.mockResolvedValue([]);
    m.zohoApi.fetchItemDetailsBulk.mockResolvedValue({});
    return m.router.refreshProducts({ background: true }).then(function () {
      expect(m.zohoApi.fetchAllItems).not.toHaveBeenCalled();
      return m.router.refreshProducts();
    }).then(function () {
      expect(m.zohoApi.fetchAllItems).toHaveBeenCalledTimes(1);
    });
  });

  test('refreshIngredients({ background: true }) is skipped; interactive is not', function () {
    var m = load();
    mockSkip = true;
    m.zohoApi.fetchAllItems.mockResolvedValue([]);
    m.zohoApi.fetchItemDetailsBulk.mockResolvedValue({});
    return m.router.refreshIngredients({ background: true }).then(function () {
      expect(m.zohoApi.fetchAllItems).not.toHaveBeenCalled();
      return m.router.refreshIngredients();
    }).then(function () {
      expect(m.zohoApi.fetchAllItems).toHaveBeenCalledTimes(1);
    });
  });

  test('/api/products soft-TTL background refresh is skipped under the reserve', function () {
    var m = load();
    mockSkip = true;
    store[C.CACHE_KEYS.PRODUCTS] = [{ item_id: '10' }];
    store[C.CACHE_KEYS.PRODUCTS_TS] = 1; // ancient → stale
    return call('/api/products').then(function (r) {
      expect(r.body.source).toBe('cache');
      return flush();
    }).then(function () {
      expect(m.zohoApi.fetchAllItems).not.toHaveBeenCalled();
    });
  });

  test('/api/products soft-TTL background refresh runs when healthy', function () {
    var m = load();
    m.zohoApi.fetchAllItems.mockResolvedValue([]);
    m.zohoApi.fetchItemDetailsBulk.mockResolvedValue({});
    store[C.CACHE_KEYS.PRODUCTS] = [{ item_id: '10' }];
    store[C.CACHE_KEYS.PRODUCTS_TS] = 1;
    return call('/api/products').then(flush).then(flush).then(function () {
      expect(m.zohoApi.fetchAllItems).toHaveBeenCalledTimes(1);
    });
  });

  test('/api/ingredients soft-TTL background refresh is skipped under the reserve', function () {
    var m = load();
    mockSkip = true;
    store[C.CACHE_KEYS.INGREDIENTS] = [{ item_id: '20' }];
    store[C.CACHE_KEYS.INGREDIENTS_TS] = 1;
    return call('/api/ingredients').then(function (r) {
      expect(r.body.source).toBe('cache');
      return flush();
    }).then(flush).then(function () {
      expect(m.zohoApi.fetchAllItems).not.toHaveBeenCalled();
    });
  });

  test('stale last-good serve does not trigger a background refresh under the reserve', function () {
    var m = load();
    mockSkip = true;
    store[C.CACHE_KEYS.PRODUCTS_LASTGOOD] = [{ item_id: '10' }];
    return call('/api/products').then(function (r) {
      expect(r.body.source).toBe('stale');
      return flush();
    }).then(flush).then(function () {
      expect(m.zohoApi.fetchAllItems).not.toHaveBeenCalled();
    });
  });

  test('interactive kiosk cache miss still rebuilds under the reserve', function () {
    var m = load();
    mockSkip = true;
    m.zohoApi.fetchAllItems.mockResolvedValue(ITEMS);
    m.zohoApi.fetchItemDetailsBulk.mockResolvedValue({});
    return call('/api/kiosk/products').then(function (r) {
      expect(r.status).toBe(200);
      expect(r.body.source).toBe('zoho');
      expect(m.zohoApi.fetchAllItems).toHaveBeenCalledTimes(1);
    });
  });
});
