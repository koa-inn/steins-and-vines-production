'use strict';

// Phase 89 D-08: beer_category is a public field on the anonymous recipe
// projection; nothing else new may leak.

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
      INGREDIENTS: 'zoho:ingredients',
      INGREDIENTS_ALL: 'zoho:ingredients:all',
      RECIPE_AVAILABILITY: 'sv:recipe-availability',
      FERM_SCHEDULES: 'sv:ferm-schedules'
    }
  };
});

function load() {
  mockRouteHandlers = {};
  jest.resetModules();
  require('../routes/recipes');
  return { cache: require('../lib/cache') };
}

function callHandler(method, path, req) {
  return new Promise(function (resolve, reject) {
    var handler = mockRouteHandlers[method + ':' + path];
    if (!handler) return reject(new Error('No handler for ' + method + ':' + path));
    var res = {
      _status: 200,
      _body: null,
      status: jest.fn(function (s) { res._status = s; return res; }),
      json: jest.fn(function (b) { res._body = b; resolve(res); return res; })
    };
    try { handler(req || {}, res); } catch (e) { reject(e); }
  });
}

function source(extra) {
  var base = {
    recipe_id: 'SV-R-BC-1',
    name: 'Hazy IPA',
    style: 'IPA',
    description: 'Juicy.',
    ferment_days: 14,
    status: 'active',
    pricing_mode: 'locked',
    locked_price: 10,
    service_fee: 5,
    materials_fee: 2,
    notes: 'n',
    schedule_id: 'SCH-1',
    created_by: 'x@y',
    computed_price: 99,
    ingredients: [{ item_id: 'A' }]
  };
  Object.keys(extra || {}).forEach(function (k) { base[k] = extra[k]; });
  return base;
}

var LEAKS = ['status', 'locked_price', 'service_fee', 'materials_fee', 'notes', 'pricing_mode',
  'schedule_id', 'created_by', 'computed_price', 'ingredients'];

function expectNoLeaks(r) {
  LEAKS.forEach(function (k) { expect(r).not.toHaveProperty(k); });
}

describe('public recipe projection carries beer_category (D-08)', function () {
  var mocks;

  beforeEach(function () {
    process.env.API_SECRET_KEY = 'test-public-bc-key';
    mocks = load();
    mocks.cache.set.mockResolvedValue(true);
    mocks.cache.del.mockResolvedValue(true);
  });

  function list(recipe) {
    mocks.cache.get.mockResolvedValue({ recipes: [recipe], total: 1 });
    return callHandler('GET', '/api/recipes', { query: { status: 'active' }, headers: {} }).then(function (res) {
      return res._body.recipes[0];
    });
  }

  function detail(recipe) {
    mocks.cache.get.mockResolvedValue({ recipe: recipe, ingredients: recipe.ingredients });
    return callHandler('GET', '/api/recipes/:id', { params: { id: recipe.recipe_id }, headers: {} }).then(function (res) {
      return res._body.recipe;
    });
  }

  test('list exposes beer_category and nothing sensitive', function () {
    return list(source({ beer_category: 'ipa' })).then(function (r) {
      expect(r.beer_category).toBe('ipa');
      expectNoLeaks(r);
    });
  });

  test('detail exposes beer_category and nothing sensitive', function () {
    return detail(source({ beer_category: 'ipa' })).then(function (r) {
      expect(r.beer_category).toBe('ipa');
      expectNoLeaks(r);
    });
  });

  test('blank beer_category is passed through as ""', function () {
    return list(source({ beer_category: '' })).then(function (r) {
      expect(r.beer_category).toBe('');
    });
  });

  test('absent beer_category stays absent', function () {
    return list(source()).then(function (r) {
      expect(r).not.toHaveProperty('beer_category');
    });
  });

  test('public key set is exactly the allowlist plus price', function () {
    return list(source({ beer_category: 'stout' })).then(function (r) {
      expect(Object.keys(r).sort()).toEqual(
        ['beer_category', 'description', 'ferment_days', 'name', 'price', 'recipe_id', 'style'].sort()
      );
    });
  });

  test('dynamic recipe additionally gets price_from', function () {
    return list(source({ beer_category: 'stout', pricing_mode: 'dynamic' })).then(function (r) {
      expect(Object.keys(r).sort()).toEqual(
        ['beer_category', 'description', 'ferment_days', 'name', 'price', 'price_from', 'recipe_id', 'style'].sort()
      );
    });
  });
});
