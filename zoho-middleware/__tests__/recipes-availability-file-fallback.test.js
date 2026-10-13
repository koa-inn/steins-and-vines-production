'use strict';

// Regression (2026-10-13 handoff §3): /api/recipes/:id/availability returned
// summary "unknown" for every recipe. The handler read only the Redis key
// zoho:ingredients:all (1 h TTL) and, unlike every other INGREDIENTS_ALL
// reader in routes/recipes.js and routes/catalog.js, had no fallback to
// ingredients-all-cache.json. In quiet hours the key expires and the BrewPad
// stock dots go blind while /api/ingredients?include_internal=1 (which does
// fall back to the file) still shows correct stock.

var mockRouteHandlers = {};
var mockFileCatalog = null;

jest.mock('express', function () {
  var router = {
    get:    jest.fn(function (p, h) { mockRouteHandlers['GET:' + p] = h; }),
    post:   jest.fn(function (p, h) { mockRouteHandlers['POST:' + p] = h; }),
    put:    jest.fn(function (p, h) { mockRouteHandlers['PUT:' + p] = h; }),
    delete: jest.fn(function (p, h) { mockRouteHandlers['DELETE:' + p] = h; })
  };
  var express = function () {};
  express.Router = function () { return router; };
  return express;
});
jest.mock('axios', function () { return { get: jest.fn(), post: jest.fn() }; });
jest.mock('../lib/cache', function () { return { get: jest.fn(), set: jest.fn(), del: jest.fn() }; });
jest.mock('../lib/logger', function () { return { info: jest.fn(), warn: jest.fn(), error: jest.fn() }; });
jest.mock('../lib/constants', function () {
  return {
    CACHE_KEYS: {
      RECIPES: 'sv:recipes',
      RECIPES_TS: 'sv:recipes:ts',
      INGREDIENTS: 'zoho:ingredients',
      INGREDIENTS_ALL: 'zoho:ingredients:all',
      RECIPE_AVAILABILITY: 'sv:recipe-availability',
      FERM_SCHEDULES: 'sv:ferm-schedules'
    }
  };
});
jest.mock('fs', function () {
  var actual = jest.requireActual('fs');
  return Object.assign({}, actual, {
    readFileSync: jest.fn(function (p) {
      if (String(p).indexOf('ingredients-all-cache.json') !== -1) {
        if (!mockFileCatalog) throw new Error('ENOENT');
        return JSON.stringify(mockFileCatalog);
      }
      return actual.readFileSync.apply(actual, arguments);
    })
  });
});

function callHandler(method, p, req) {
  return new Promise(function (resolve, reject) {
    var handler = mockRouteHandlers[method + ':' + p];
    if (!handler) return reject(new Error('No handler for ' + method + ':' + p));
    var res = {
      _status: 200,
      _body: null,
      status: jest.fn(function (s) { res._status = s; return res; }),
      json:   jest.fn(function (b) { res._body = b; resolve(res); return res; })
    };
    try { handler(req, res); } catch (e) { reject(e); }
  });
}

describe('GET /api/recipes/:id/availability with Redis cold', function () {
  var axios, cache, OLD_KEY;

  beforeEach(function () {
    mockRouteHandlers = {};
    mockFileCatalog = null;
    jest.resetModules();
    require('../routes/recipes');
    axios = require('axios');
    cache = require('../lib/cache');
    cache.get.mockResolvedValue(null); // every Redis key cold
    cache.set.mockResolvedValue(true);
    process.env.APPS_SCRIPT_URL = 'https://script.google.com/test';
    process.env.APPS_SCRIPT_SERVER_TOKEN = 'test-token';
    OLD_KEY = process.env.API_SECRET_KEY;
    process.env.API_SECRET_KEY = 'test-api-key';
    axios.post.mockResolvedValue({
      data: {
        ok: true,
        data: {
          recipe: { recipe_id: 'SV-R-000002' },
          ingredients: [{ item_id: '100', item_name: 'Pilsner Malt', unit: 'kg', quantity: 2 }]
        }
      }
    });
  });

  afterEach(function () {
    process.env.API_SECRET_KEY = OLD_KEY;
  });

  test('falls back to the full-catalog file and reports real stock', function () {
    mockFileCatalog = [{ item_id: '100', name: 'Pilsner Malt', unit: 'kg', rate: 3, stock_on_hand: 30 }];
    return callHandler('GET', '/api/recipes/:id/availability', {
      params: { id: 'SV-R-000002' }, headers: { 'x-api-key': 'test-api-key' }
    }).then(function (res) {
      expect(res._body.summary).toBe('all_ok');
      expect(res._body.ingredients[0].stock_on_hand).toBe(30);
      expect(res._body.ingredients[0].batches_possible).toBe(15);
    });
  });

  test('still reports unknown when neither Redis nor the file has the catalog', function () {
    return callHandler('GET', '/api/recipes/:id/availability', {
      params: { id: 'SV-R-000002' }, headers: { 'x-api-key': 'test-api-key' }
    }).then(function (res) {
      expect(res._body.summary).toBe('unknown');
      expect(res._body.ingredients[0].batches_possible).toBeNull();
    });
  });
});
