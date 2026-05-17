'use strict';

// ---------------------------------------------------------------------------
// Express mock — captures route handlers keyed by method:path
// ---------------------------------------------------------------------------

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

jest.mock('../lib/cache', function () {
  return { get: jest.fn(), set: jest.fn(), del: jest.fn() };
});

jest.mock('../lib/logger', function () {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
});

jest.mock('../lib/constants', function () {
  return {
    CACHE_KEYS: {
      RECIPES: 'sv:recipes',
      RECIPES_TS: 'sv:recipes:ts',
      INGREDIENTS: 'zoho:ingredients'
    }
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetAndLoadRecipes() {
  mockRouteHandlers = {};
  jest.resetModules();
  require('../routes/recipes');
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
    try { handler(req || {}, res); } catch (e) { reject(e); }
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/recipes', function () {
  var mocks;
  beforeEach(function () {
    mocks = resetAndLoadRecipes();
    mocks.cache.get.mockResolvedValue(null);
    mocks.cache.set.mockResolvedValue(true);
    mocks.cache.del.mockResolvedValue(true);
    process.env.APPS_SCRIPT_URL = 'https://script.google.com/test';
    process.env.APPS_SCRIPT_SERVER_TOKEN = 'test-token';
  });

  test('returns cached data on cache hit', function () {
    var cached = { recipes: [{ recipe_id: 'SV-R-000001', name: 'Pale Ale' }], total: 1 };
    mocks.cache.get.mockResolvedValue(cached);
    return callHandler('GET', '/api/recipes', { query: { status: 'all' } }).then(function (res) {
      expect(res._body.source).toBe('cache');
      expect(res._body.recipes).toEqual(cached.recipes);
      expect(res._body.total).toBe(1);
      expect(mocks.axios.post).not.toHaveBeenCalled();
    });
  });

  test('fetches from Apps Script on cache miss and caches result', function () {
    mocks.cache.get.mockResolvedValue(null);
    mocks.axios.post.mockResolvedValue({
      data: { ok: true, data: { recipes: [{ recipe_id: 'SV-R-000001' }], total: 1 } }
    });
    return callHandler('GET', '/api/recipes', { query: { status: 'active' } }).then(function (res) {
      expect(res._body.source).toBe('apps-script');
      expect(res._body.recipes).toHaveLength(1);
      expect(mocks.cache.set).toHaveBeenCalled();
    });
  });

  test('returns 502 on Apps Script error', function () {
    mocks.cache.get.mockResolvedValue(null);
    mocks.axios.post.mockRejectedValue(new Error('timeout'));
    return callHandler('GET', '/api/recipes', { query: {} }).then(function (res) {
      expect(res._status).toBe(502);
      expect(res._body.error).toBe('Unable to fetch recipes');
    });
  });
});

describe('GET /api/recipes/:id', function () {
  var mocks;
  beforeEach(function () {
    mocks = resetAndLoadRecipes();
    mocks.cache.get.mockResolvedValue(null);
    mocks.cache.set.mockResolvedValue(true);
    mocks.cache.del.mockResolvedValue(true);
    process.env.APPS_SCRIPT_URL = 'https://script.google.com/test';
    process.env.APPS_SCRIPT_SERVER_TOKEN = 'test-token';
  });

  test('returns cached recipe detail on hit', function () {
    var cached = { recipe: { recipe_id: 'SV-R-000001', name: 'Pale Ale' }, ingredients: [] };
    mocks.cache.get.mockResolvedValue(cached);
    return callHandler('GET', '/api/recipes/:id', { params: { id: 'SV-R-000001' } }).then(function (res) {
      expect(res._body.recipe.recipe_id).toBe('SV-R-000001');
      expect(mocks.axios.post).not.toHaveBeenCalled();
    });
  });

  test('fetches and caches on miss', function () {
    mocks.cache.get.mockResolvedValue(null);
    mocks.axios.post.mockResolvedValue({
      data: { ok: true, data: { recipe: { recipe_id: 'SV-R-000001' }, ingredients: [{ item_id: '123' }] } }
    });
    return callHandler('GET', '/api/recipes/:id', { params: { id: 'SV-R-000001' } }).then(function (res) {
      expect(res._body.recipe.recipe_id).toBe('SV-R-000001');
      expect(res._body.ingredients).toHaveLength(1);
      expect(mocks.cache.set).toHaveBeenCalled();
    });
  });

  test('returns 404 when Apps Script returns ok:false', function () {
    mocks.cache.get.mockResolvedValue(null);
    mocks.axios.post.mockResolvedValue({
      data: { ok: false, message: 'Recipe not found' }
    });
    return callHandler('GET', '/api/recipes/:id', { params: { id: 'SV-R-999999' } }).then(function (res) {
      expect(res._status).toBe(404);
      expect(res._body.error).toBe('Recipe not found');
    });
  });
});

describe('GET /api/recipes/:id/availability', function () {
  var mocks;
  beforeEach(function () {
    mocks = resetAndLoadRecipes();
    mocks.cache.set.mockResolvedValue(true);
    mocks.cache.del.mockResolvedValue(true);
    process.env.APPS_SCRIPT_URL = 'https://script.google.com/test';
    process.env.APPS_SCRIPT_SERVER_TOKEN = 'test-token';
  });

  test('returns per-ingredient status with stock data from ingredients cache', function () {
    // Apps Script returns recipe with ingredients
    mocks.axios.post.mockResolvedValue({
      data: {
        ok: true,
        data: {
          recipe: { recipe_id: 'SV-R-000001' },
          ingredients: [
            { item_id: '100', item_name: 'Pale Malt', unit: 'kg', quantity: 4.5 },
            { item_id: '200', item_name: 'Cascade Hops', unit: 'g', quantity: 50 }
          ]
        }
      }
    });
    // Ingredients cache has stock data
    mocks.cache.get.mockImplementation(function (key) {
      if (key === 'zoho:ingredients') {
        return Promise.resolve([
          { item_id: '100', stock_on_hand: 45 },
          { item_id: '200', stock_on_hand: 100 }
        ]);
      }
      return Promise.resolve(null);
    });

    return callHandler('GET', '/api/recipes/:id/availability', { params: { id: 'SV-R-000001' } }).then(function (res) {
      expect(res._body.recipe_id).toBe('SV-R-000001');
      expect(res._body.summary).toBe('some_low');
      expect(res._body.ingredients).toHaveLength(2);
      // Pale Malt: 45/4.5 = 10 batches -> ok
      expect(res._body.ingredients[0].batches_possible).toBe(10);
      expect(res._body.ingredients[0].status).toBe('ok');
      // Cascade Hops: 100/50 = 2 batches -> low (< 3)
      expect(res._body.ingredients[1].batches_possible).toBe(2);
      expect(res._body.ingredients[1].status).toBe('low');
    });
  });

  test('returns status unknown when ingredients cache is cold', function () {
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
    // Ingredients cache is cold (null)
    mocks.cache.get.mockResolvedValue(null);

    return callHandler('GET', '/api/recipes/:id/availability', { params: { id: 'SV-R-000001' } }).then(function (res) {
      expect(res._body.summary).toBe('unknown');
      expect(res._body.ingredients[0].status).toBe('unknown');
      expect(res._body.ingredients[0].stock_on_hand).toBeNull();
      expect(res._body.ingredients[0].batches_possible).toBeNull();
    });
  });
});

describe('POST /api/recipes', function () {
  var mocks;
  beforeEach(function () {
    mocks = resetAndLoadRecipes();
    mocks.cache.get.mockResolvedValue(null);
    mocks.cache.set.mockResolvedValue(true);
    mocks.cache.del.mockResolvedValue(true);
    process.env.APPS_SCRIPT_URL = 'https://script.google.com/test';
    process.env.APPS_SCRIPT_SERVER_TOKEN = 'test-token';
  });

  test('creates recipe and busts cache', function () {
    mocks.axios.post.mockResolvedValue({
      data: { ok: true, recipe_id: 'SV-R-000002' }
    });
    return callHandler('POST', '/api/recipes', { body: { name: 'IPA', style: 'American IPA' } }).then(function (res) {
      expect(res._status).toBe(201);
      expect(res._body.ok).toBe(true);
      expect(res._body.recipe_id).toBe('SV-R-000002');
      // Cache bust: RECIPES_TS + 4 status variants = 5 calls
      expect(mocks.cache.del).toHaveBeenCalled();
    });
  });

  test('returns 422 on create failure', function () {
    mocks.axios.post.mockResolvedValue({
      data: { ok: false, message: 'Name is required' }
    });
    return callHandler('POST', '/api/recipes', { body: {} }).then(function (res) {
      expect(res._status).toBe(422);
      expect(res._body.error).toBe('Name is required');
    });
  });
});

describe('PUT /api/recipes/:id', function () {
  var mocks;
  beforeEach(function () {
    mocks = resetAndLoadRecipes();
    mocks.cache.get.mockResolvedValue(null);
    mocks.cache.set.mockResolvedValue(true);
    mocks.cache.del.mockResolvedValue(true);
    process.env.APPS_SCRIPT_URL = 'https://script.google.com/test';
    process.env.APPS_SCRIPT_SERVER_TOKEN = 'test-token';
  });

  test('updates recipe and busts cache including per-recipe key', function () {
    mocks.axios.post.mockResolvedValue({
      data: { ok: true }
    });
    return callHandler('PUT', '/api/recipes/:id', {
      params: { id: 'SV-R-000001' },
      body: { name: 'Updated IPA', status: 'draft' }
    }).then(function (res) {
      expect(res._body.ok).toBe(true);
      // Should bust per-recipe key
      expect(mocks.cache.del).toHaveBeenCalledWith('sv:recipes:SV-R-000001');
    });
  });

  test('rejects activation without locked_price', function () {
    return callHandler('PUT', '/api/recipes/:id', {
      params: { id: 'SV-R-000001' },
      body: { status: 'active', locked_price: 0, ingredient_count: 3 }
    }).then(function (res) {
      expect(res._status).toBe(422);
      expect(res._body.error).toContain('Cannot activate recipe');
      expect(mocks.axios.post).not.toHaveBeenCalled();
    });
  });

  test('rejects activation without ingredients', function () {
    return callHandler('PUT', '/api/recipes/:id', {
      params: { id: 'SV-R-000001' },
      body: { status: 'active', locked_price: 50, ingredient_count: 0 }
    }).then(function (res) {
      expect(res._status).toBe(422);
      expect(res._body.error).toContain('Cannot activate recipe');
      expect(mocks.axios.post).not.toHaveBeenCalled();
    });
  });
});

describe('DELETE /api/recipes/:id', function () {
  var mocks;
  beforeEach(function () {
    mocks = resetAndLoadRecipes();
    mocks.cache.get.mockResolvedValue(null);
    mocks.cache.set.mockResolvedValue(true);
    mocks.cache.del.mockResolvedValue(true);
    process.env.APPS_SCRIPT_URL = 'https://script.google.com/test';
    process.env.APPS_SCRIPT_SERVER_TOKEN = 'test-token';
  });

  test('deletes recipe and busts cache', function () {
    mocks.axios.post.mockResolvedValue({
      data: { ok: true }
    });
    return callHandler('DELETE', '/api/recipes/:id', {
      params: { id: 'SV-R-000001' },
      body: {}
    }).then(function (res) {
      expect(res._body.ok).toBe(true);
      expect(mocks.cache.del).toHaveBeenCalledWith('sv:recipes:SV-R-000001');
    });
  });
});
