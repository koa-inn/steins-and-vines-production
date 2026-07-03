'use strict';

// M7 (Phase 52-05): GET /api/kiosk/products?bust=1 must require a credential
// (the bust branch forces a cold Zoho refetch — an unauth caller could use it
// to exhaust Zoho API quota). The normal cached read (no ?bust=1) stays
// public. Mirrors __tests__/catalog.test.js's express-mock/handler-capture
// shape; lib/authTiers is NOT mocked so the real requireTiers/apiKeyGuard
// logic is exercised (mirrors __tests__/auth-tiers-guard.test.js intent).

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
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  };
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

// ---------------------------------------------------------------------------
// Helpers (mirrors catalog.test.js)
// ---------------------------------------------------------------------------

function resetAndLoadCatalog() {
  mockRouteHandlers = {};
  jest.resetModules();
  require('../routes/catalog');
  return {
    zohoApi: require('../lib/zoho-api'),
    cache:   require('../lib/cache'),
    ledger:  require('../lib/inventory-ledger')
  };
}

function callHandler(path, req) {
  return new Promise(function (resolve, reject) {
    var handler = mockRouteHandlers[path];
    if (!handler) return reject(new Error('No handler registered for ' + path));
    var res = {
      _status: 200,
      _body: null,
      status: jest.fn(function (s) { res._status = s; return res; }),
      json: jest.fn(function (b) { res._body = b; resolve(res); return res; })
    };
    try { handler(req || {}, res); } catch (e) { reject(e); }
  });
}

function setupDefaultMocks(mocks) {
  mocks.cache.get.mockResolvedValue(null);
  mocks.cache.set.mockResolvedValue(true);
  mocks.cache.del.mockResolvedValue(true);
  mocks.cache.acquireLock.mockResolvedValue(true);
  mocks.cache.releaseLock.mockResolvedValue(true);
  mocks.ledger.reconcile.mockResolvedValue();
  mocks.ledger.overlayStock.mockImplementation(function (items) { return Promise.resolve(items); });
}

var API_KEY = 'test-catalog-bust-key';

describe('GET /api/kiosk/products?bust=1 — requires a credential (M7)', function () {
  var mocks;
  var OLD_API_SECRET_KEY, OLD_MW_API_KEY;

  beforeEach(function () {
    OLD_API_SECRET_KEY = process.env.API_SECRET_KEY;
    OLD_MW_API_KEY = process.env.MW_API_KEY;
    process.env.API_SECRET_KEY = API_KEY;
    delete process.env.MW_API_KEY;

    mocks = resetAndLoadCatalog();
    setupDefaultMocks(mocks);
    mocks.zohoApi.fetchAllItems.mockResolvedValue([]);
    mocks.zohoApi.fetchItemDetailsBulk.mockResolvedValue({});
  });

  afterEach(function () {
    process.env.API_SECRET_KEY = OLD_API_SECRET_KEY;
    process.env.MW_API_KEY = OLD_MW_API_KEY;
  });

  test('NO credential → 401 and never busts the cache / refetches Zoho', function () {
    return callHandler('/api/kiosk/products', { query: { bust: '1' }, headers: {} }).then(function (res) {
      expect(res._status).toBe(401);
      expect(mocks.cache.del).not.toHaveBeenCalled();
      expect(mocks.zohoApi.fetchAllItems).not.toHaveBeenCalled();
    });
  });

  test('WITH a valid legacy key → bust path proceeds (cache busted)', function () {
    mocks.cache.get.mockResolvedValue(null);
    return callHandler('/api/kiosk/products', {
      query: { bust: '1' },
      headers: { 'x-api-key': API_KEY }
    }).then(function (res) {
      expect(res._status).not.toBe(401);
      expect(res._status).not.toBe(403);
      expect(mocks.cache.del).toHaveBeenCalled();
    });
  });

  test('normal read (no bust) stays public — 200 with no credential', function () {
    mocks.cache.get.mockResolvedValue([{ item_id: 'i1' }]);
    return callHandler('/api/kiosk/products', { query: {}, headers: {} }).then(function (res) {
      expect(res._status).toBe(200);
      expect(mocks.cache.del).not.toHaveBeenCalled();
    });
  });
});
