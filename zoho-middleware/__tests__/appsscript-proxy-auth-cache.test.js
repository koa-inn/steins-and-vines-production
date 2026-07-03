'use strict';

// M8 (Phase 52-05): the Apps-Script-backed GET proxies — recipe availability
// (recipes.js) and gift-card next-number/lookup (gift-cards.js) — are unauth
// and uncached today, letting an anon caller exhaust Apps Script quota.
// This asserts: (1) all three require a credential tier (401 with none,
// Apps Script never called); (2) with a valid credential, a repeat
// availability call within TTL serves the cache (Apps Script called once);
// (3) with a valid credential, next-number/lookup still return their
// existing shapes. Mirrors __tests__/recipes.test.js and
// __tests__/gift-cards.test.js handler-capture shape; lib/authTiers /
// lib/apiKey are NOT mocked so the real requireTiers/apiKeyGuard logic runs
// (mirrors __tests__/pos-auth-tier.test.js intent).

var mockRouteHandlers = {};

jest.mock('express', function () {
  var router = {
    get:    jest.fn(function (path, handler) { mockRouteHandlers['GET:' + path] = handler; }),
    post:   jest.fn(function (path, handler) { mockRouteHandlers['POST:' + path] = handler; }),
    put:    jest.fn(function (path, handler) { mockRouteHandlers['PUT:' + path] = handler; }),
    delete: jest.fn(function (path, handler) { mockRouteHandlers['DELETE:' + path] = handler; })
  };
  var express = function () {};
  express.Router = function () { return router; };
  return express;
});

jest.mock('axios', function () {
  return { get: jest.fn(), post: jest.fn() };
});

jest.mock('../lib/logger', function () {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
});

jest.mock('../lib/eventLog', function () {
  return { logEvent: jest.fn() };
});

// Real in-memory cache double (not the Redis-backed lib/cache) so the
// read-through TTL behavior (Apps Script called once on repeat) is exercised
// honestly rather than asserted against a jest.fn() call count alone.
jest.mock('../lib/cache', function () {
  var store = {};
  return {
    get: jest.fn(function (key) { return Promise.resolve(Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null); }),
    set: jest.fn(function (key, val) { store[key] = val; return Promise.resolve('OK'); }),
    del: jest.fn(function (key) { delete store[key]; return Promise.resolve(1); }),
    isConnected: jest.fn().mockReturnValue(false),
    __store: store
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetAndLoad(modulePath) {
  mockRouteHandlers = {};
  jest.resetModules();
  require(modulePath);
  return {
    axios: require('axios'),
    cache: require('../lib/cache')
  };
}

function callHandler(method, path, req) {
  return new Promise(function (resolve, reject) {
    var key = method + ':' + path;
    var handler = mockRouteHandlers[key];
    if (!handler) return reject(new Error('No handler registered for ' + key));
    var res = {
      _status: 200,
      _body: null,
      status: jest.fn(function (s) { res._status = s; return res; }),
      json:   jest.fn(function (b) { res._body = b; resolve(res); return res; })
    };
    try {
      var maybe = handler(req || {}, res);
      if (maybe && typeof maybe.catch === 'function') maybe.catch(reject);
    } catch (e) { reject(e); }
  });
}

var API_KEY = 'test-appsscript-proxy-key';
var OLD_API_SECRET_KEY, OLD_MW_API_KEY;

beforeEach(function () {
  OLD_API_SECRET_KEY = process.env.API_SECRET_KEY;
  OLD_MW_API_KEY = process.env.MW_API_KEY;
  process.env.API_SECRET_KEY = API_KEY;
  delete process.env.MW_API_KEY;
  process.env.APPS_SCRIPT_URL = 'https://script.google.com/test';
  process.env.APPS_SCRIPT_SERVER_TOKEN = 'test-token';
});

afterEach(function () {
  process.env.API_SECRET_KEY = OLD_API_SECRET_KEY;
  process.env.MW_API_KEY = OLD_MW_API_KEY;
});

// ---------------------------------------------------------------------------
// GET /api/recipes/:id/availability
// ---------------------------------------------------------------------------

describe('GET /api/recipes/:id/availability — auth + cache (M8)', function () {
  var mocks;

  beforeEach(function () {
    mocks = resetAndLoad('../routes/recipes');
  });

  test('NO credential → 401, Apps Script never called', function () {
    return callHandler('GET', '/api/recipes/:id/availability', { params: { id: 'SV-R-000001' }, headers: {} }).then(function (res) {
      expect(res._status).toBe(401);
      expect(mocks.axios.post).not.toHaveBeenCalled();
    });
  });

  test('WITH a valid legacy key, first call fetches + caches; second call within TTL serves cache (Apps Script called once)', function () {
    mocks.axios.post.mockResolvedValue({
      data: {
        ok: true,
        data: {
          recipe: { recipe_id: 'SV-R-000001' },
          ingredients: [
            { item_id: '100', item_name: 'Pale Malt', unit: 'kg', quantity: 4.5 }
          ]
        }
      }
    });
    // Only the recipe-detail POST + ingredients-all cache lookup should occur; no
    // Apps Script call happens for the ingredients catalog (it's read from cache).
    var req = { params: { id: 'SV-R-000001' }, headers: { 'x-api-key': API_KEY } };

    return callHandler('GET', '/api/recipes/:id/availability', req).then(function (res1) {
      expect(res1._status).not.toBe(401);
      expect(res1._status).not.toBe(403);
      expect(res1._body.recipe_id).toBe('SV-R-000001');
      expect(mocks.axios.post).toHaveBeenCalledTimes(1);

      return callHandler('GET', '/api/recipes/:id/availability', req).then(function (res2) {
        expect(res2._body.recipe_id).toBe('SV-R-000001');
        // Served from cache — Apps Script POST count unchanged.
        expect(mocks.axios.post).toHaveBeenCalledTimes(1);
      });
    });
  });
});

// ---------------------------------------------------------------------------
// GET /api/kiosk/gift-card/next-number + lookup
// ---------------------------------------------------------------------------

describe('GET /api/kiosk/gift-card/next-number + lookup — auth (M8)', function () {
  var mocks;

  beforeEach(function () {
    mocks = resetAndLoad('../routes/gift-cards');
  });

  test('next-number: NO credential → 401, Apps Script never called', function () {
    return callHandler('GET', '/api/kiosk/gift-card/next-number', { headers: {} }).then(function (res) {
      expect(res._status).toBe(401);
      expect(mocks.axios.post).not.toHaveBeenCalled();
    });
  });

  test('next-number: WITH a valid legacy key returns the existing shape', function () {
    mocks.axios.post.mockResolvedValueOnce({ data: { ok: true, suggested: 'GC-000001' } });
    return callHandler('GET', '/api/kiosk/gift-card/next-number', { headers: { 'x-api-key': API_KEY } }).then(function (res) {
      expect(res._status).toBe(200);
      expect(res._body.ok).toBe(true);
      expect(res._body.suggested).toBe('GC-000001');
    });
  });

  test('lookup: NO credential → 401, Apps Script never called', function () {
    return callHandler('GET', '/api/kiosk/gift-card/lookup', { query: { cert_number: 'GC-000042' }, headers: {} }).then(function (res) {
      expect(res._status).toBe(401);
      expect(mocks.axios.post).not.toHaveBeenCalled();
    });
  });

  test('lookup: WITH a valid legacy key returns the existing shape', function () {
    mocks.axios.post.mockResolvedValueOnce({
      data: { ok: true, data: { current_balance: 50, status: 'active', face_value: 100 } }
    });
    return callHandler('GET', '/api/kiosk/gift-card/lookup', {
      query: { cert_number: 'GC-000042' },
      headers: { 'x-api-key': API_KEY }
    }).then(function (res) {
      expect(res._status).toBe(200);
      expect(res._body.ok).toBe(true);
      expect(res._body.data.current_balance).toBe(50);
    });
  });
});
