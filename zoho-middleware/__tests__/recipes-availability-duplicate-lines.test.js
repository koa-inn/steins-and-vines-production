'use strict';

// Regression (2026-10-13): availability checked each recipe line against
// stock on its own, so an item used on several lines (e.g. Czech Saaz at
// 0.14 + 0.11 + 0.075 kg on SV-R-000002) reported 21/27/40 batches when the
// combined 0.325 kg per batch only supports 9. Batches must come from the
// item's total per-batch need. Harness copied from
// recipes-availability-file-fallback.test.js.

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

describe('GET /api/recipes/:id/availability with an item on several lines', function () {
  var axios, cache, OLD_KEY;

  function load(ingredients, catalog) {
    mockRouteHandlers = {};
    mockFileCatalog = null;
    jest.resetModules();
    require('../routes/recipes');
    axios = require('axios');
    cache = require('../lib/cache');
    cache.get.mockImplementation(function (key) {
      return Promise.resolve(key === 'zoho:ingredients:all' ? catalog : null);
    });
    cache.set.mockResolvedValue(true);
    axios.post.mockResolvedValue({
      data: { ok: true, data: { recipe: { recipe_id: 'SV-R-DUP' }, ingredients: ingredients } }
    });
    return callHandler('GET', '/api/recipes/:id/availability', {
      params: { id: 'SV-R-DUP' }, headers: { 'x-api-key': 'test-api-key' }
    });
  }

  beforeEach(function () {
    process.env.APPS_SCRIPT_URL = 'https://script.google.com/test';
    process.env.APPS_SCRIPT_SERVER_TOKEN = 'test-token';
    OLD_KEY = process.env.API_SECRET_KEY;
    process.env.API_SECRET_KEY = 'test-api-key';
  });

  afterEach(function () {
    process.env.API_SECRET_KEY = OLD_KEY;
  });

  test('batches_possible uses the summed per-batch need for a repeated item', function () {
    var catalog = [{ item_id: '621293', name: 'Czech Saaz Bulk', unit: 'kg', rate: 40, stock_on_hand: 3 }];
    return load([
      { item_id: '621293', item_name: 'Czech Saaz Bulk', unit: 'kg', quantity: 0.14 },
      { item_id: '621293', item_name: 'Czech Saaz Bulk', unit: 'kg', quantity: 0.11 },
      { item_id: '621293', item_name: 'Czech Saaz Bulk', unit: 'kg', quantity: 0.075 }
    ], catalog).then(function (res) {
      expect(res._body.ingredients).toHaveLength(3);
      res._body.ingredients.forEach(function (row) {
        expect(row.batches_possible).toBe(9); // floor(3 / 0.325)
        expect(row.status).toBe('ok');
      });
    });
  });

  test('a repeated item that runs short marks every one of its lines', function () {
    var catalog = [
      { item_id: 'H', name: 'Hop', unit: 'kg', rate: 40, stock_on_hand: 0.5 },
      { item_id: 'M', name: 'Malt', unit: 'kg', rate: 3, stock_on_hand: 100 }
    ];
    return load([
      { item_id: 'H', item_name: 'Hop', unit: 'kg', quantity: 0.2 },
      { item_id: 'M', item_name: 'Malt', unit: 'kg', quantity: 5 },
      { item_id: 'H', item_name: 'Hop', unit: 'kg', quantity: 0.2 }
    ], catalog).then(function (res) {
      var rows = res._body.ingredients;
      expect(rows[0].batches_possible).toBe(1); // floor(0.5 / 0.4)
      expect(rows[2].batches_possible).toBe(1);
      expect(rows[0].status).toBe('low');
      expect(rows[1].batches_possible).toBe(20);
      expect(res._body.summary).toBe('some_low');
    });
  });

  test('a single-line item is unchanged', function () {
    var catalog = [{ item_id: 'M', name: 'Malt', unit: 'kg', rate: 3, stock_on_hand: 30 }];
    return load([{ item_id: 'M', item_name: 'Malt', unit: 'kg', quantity: 2 }], catalog).then(function (res) {
      expect(res._body.ingredients[0].batches_possible).toBe(15);
    });
  });
});
