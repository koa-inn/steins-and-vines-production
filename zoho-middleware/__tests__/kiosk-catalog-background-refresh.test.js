'use strict';

// Kiosk catalog background refresh (2026-10-22).
//
// Production logs showed half of GET /api/kiosk/products calls taking 5-11 s:
// the 30-minute kiosk cache expired (no scheduled job warmed it) and the New
// Sale button forced a cold Zoho rebuild. refreshKioskCatalogInBackground()
// rebuilds the cache on a schedule so a kiosk load never waits on Zoho.
//
// Contract pinned here:
//   1. A refresh rebuilds from Zoho and writes the kiosk cache.
//   2. Overlapping refreshes share ONE rebuild (no Zoho stampede).
//   3. A failed refresh never throws, never deletes or overwrites the cache
//      (the last good catalog keeps serving), and logs the error.
//   4. After a failure, the next refresh runs again (the in-flight guard clears).
//
// Harness mirrors __tests__/catalog-bust-auth.test.js.

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
    overlayStock: jest.fn(function (items) { return Promise.resolve(items); })
  };
});

jest.mock('fs', function () {
  return {
    readFileSync: jest.fn(function () { throw new Error('no file'); }),
    writeFile: jest.fn(function (path, data, cb) { if (cb) cb(null); })
  };
});

var C = require('../lib/constants');

function load() {
  mockRouteHandlers = {};
  jest.resetModules();
  var router = require('../routes/catalog');
  var mocks = {
    router: router,
    zohoApi: require('../lib/zoho-api'),
    cache: require('../lib/cache'),
    log: require('../lib/logger')
  };
  mocks.cache.get.mockResolvedValue(null);
  mocks.cache.set.mockResolvedValue(true);
  mocks.cache.del.mockResolvedValue(true);
  return mocks;
}

var ITEMS = [
  { item_id: '1', name: 'Kit A', sku: 'A', rate: 10, stock_on_hand: 3, tax_percentage: 5 },
  { item_id: '2', name: 'Kit B', sku: 'B', rate: 20, stock_on_hand: 1, tax_percentage: 5 },
  { item_id: '3', name: 'Free thing', sku: 'F', rate: 0 }
];

describe('refreshKioskCatalogInBackground', function () {
  test('is exported for the server scheduler', function () {
    var m = load();
    expect(typeof m.router.refreshKioskCatalogInBackground).toBe('function');
  });

  test('rebuilds from Zoho and writes the kiosk cache', function () {
    var m = load();
    m.zohoApi.fetchAllItems.mockResolvedValue(ITEMS);
    m.zohoApi.fetchItemDetailsBulk.mockResolvedValue({});

    return m.router.refreshKioskCatalogInBackground().then(function (result) {
      expect(m.zohoApi.fetchAllItems).toHaveBeenCalledTimes(1);
      var kioskWrites = m.cache.set.mock.calls.filter(function (c) { return c[0] === C.CACHE_KEYS.KIOSK_PRODUCTS; });
      expect(kioskWrites).toHaveLength(1);
      expect(kioskWrites[0][1].map(function (i) { return i.item_id; })).toEqual(['1', '2']);
      expect(result).toHaveLength(2);
    });
  });

  test('overlapping refreshes share one Zoho rebuild', function () {
    var m = load();
    var release;
    m.zohoApi.fetchAllItems.mockReturnValue(new Promise(function (r) { release = r; }));
    m.zohoApi.fetchItemDetailsBulk.mockResolvedValue({});

    var first = m.router.refreshKioskCatalogInBackground();
    var second = m.router.refreshKioskCatalogInBackground();
    release(ITEMS);

    return Promise.all([first, second]).then(function () {
      expect(m.zohoApi.fetchAllItems).toHaveBeenCalledTimes(1);
    });
  });

  test('a failed refresh resolves, keeps the cached catalog, and logs', function () {
    var m = load();
    m.zohoApi.fetchAllItems.mockRejectedValue(new Error('Zoho 503'));

    return m.router.refreshKioskCatalogInBackground().then(function (result) {
      expect(result).toBeNull();
      expect(m.cache.del).not.toHaveBeenCalled();
      var kioskWrites = m.cache.set.mock.calls.filter(function (c) { return c[0] === C.CACHE_KEYS.KIOSK_PRODUCTS; });
      expect(kioskWrites).toHaveLength(0);
      expect(m.log.error).toHaveBeenCalledWith(expect.stringContaining('Zoho 503'));
    });
  });

  test('the next refresh runs again after a failure', function () {
    var m = load();
    m.zohoApi.fetchAllItems.mockRejectedValueOnce(new Error('Zoho 503')).mockResolvedValueOnce(ITEMS);
    m.zohoApi.fetchItemDetailsBulk.mockResolvedValue({});

    return m.router.refreshKioskCatalogInBackground().then(function () {
      return m.router.refreshKioskCatalogInBackground();
    }).then(function (result) {
      expect(m.zohoApi.fetchAllItems).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(2);
    });
  });
});
