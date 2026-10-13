'use strict';

// Regression (2026-10-13 handoff §4): POST /api/admin/cache-clear deleted the
// public ingredients key and file but not zoho:ingredients:all or
// ingredients-all-cache.json — the full list the BrewPad recipe editor and
// recipe availability read. It only looked fresh afterwards because the
// follow-up doRefreshIngredients() overwrites it; if that refresh fails the
// editor keeps serving stale prices silently (observed after three Zoho
// price corrections).
//
// Harness copied from __tests__/catalog.test.js, plus fs.unlinkSync.

// We need handlers to be re-populated per test group.
// The mock variable must be at top level (prefixed "mock" to satisfy jest hoisting rules).
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
    releaseLock: jest.fn()
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
    writeFile: jest.fn(function (path, data, cb) { if (cb) cb(null); }),
    unlinkSync: jest.fn()
  };
});

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

describe('POST /api/admin/cache-clear', function () {
  var cache, fs, zohoApi;

  beforeEach(function () {
    mockRouteHandlers = {};
    jest.resetModules();
    require('../routes/catalog');
    cache = require('../lib/cache');
    fs = require('fs');
    zohoApi = require('../lib/zoho-api');
    cache.get.mockResolvedValue(null);
    cache.set.mockResolvedValue('OK');
    cache.del.mockResolvedValue(1);
    cache.acquireLock.mockResolvedValue(true);
    cache.releaseLock.mockResolvedValue();
    zohoApi.fetchAllItems.mockResolvedValue([]);
    zohoApi.fetchItemDetailsBulk.mockResolvedValue({});
    zohoApi.inventoryGet.mockResolvedValue({});
  });

  test('deletes the full (include-internal) ingredients Redis key', function () {
    return callHandler('/api/admin/cache-clear', {}).then(function (res) {
      expect(res._body.ok).toBe(true);
      var deleted = cache.del.mock.calls.map(function (c) { return c[0]; });
      expect(deleted).toContain('zoho:ingredients:all');
    });
  });

  test('deletes the full ingredients file cache', function () {
    return callHandler('/api/admin/cache-clear', {}).then(function () {
      var unlinked = fs.unlinkSync.mock.calls.map(function (c) { return String(c[0]); });
      expect(unlinked.some(function (p) { return /ingredients-all-cache\.json$/.test(p); })).toBe(true);
    });
  });
});
