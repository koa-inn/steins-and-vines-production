'use strict';

// Phase 89 D-04/D-05: beer_category validation at the recipe write API.

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

jest.mock('../lib/recipe-store', function () {
  return {
    create: jest.fn(function () { return Promise.resolve({ ok: true, recipe_id: 'SV-R-000099' }); }),
    update: jest.fn(function () { return Promise.resolve({ ok: true }); })
  };
});

function load() {
  mockRouteHandlers = {};
  jest.resetModules();
  require('../routes/recipes');
  return {
    store: require('../lib/recipe-store'),
    cache: require('../lib/cache')
  };
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
    try { handler(req, res); } catch (e) { reject(e); }
  });
}

describe('beer_category route validation (D-04/D-05)', function () {
  var mocks;

  beforeEach(function () {
    mocks = load();
    mocks.cache.get.mockResolvedValue(null);
    mocks.cache.set.mockResolvedValue(true);
    mocks.cache.del.mockResolvedValue(true);
  });

  [['purple'], [['ipa']], ['123'], [5]].forEach(function (c) {
    test('POST rejects ' + JSON.stringify(c[0]) + ' with 400 invalid_beer_category', function () {
      return callHandler('POST', '/api/recipes', { body: { name: 'X', beer_category: c[0] } }).then(function (res) {
        expect(res._status).toBe(400);
        expect(res._body.code).toBe('invalid_beer_category');
        expect(res._body.error.indexOf('Beer category must be one of: pilsner, lager, pale, ipa')).toBe(0);
        expect(mocks.store.create).not.toHaveBeenCalled();
      });
    });
  });

  test('POST canonicalises IPA to ipa before the store', function () {
    return callHandler('POST', '/api/recipes', { body: { name: 'X', beer_category: 'IPA' } }).then(function (res) {
      expect(res._status).toBe(201);
      expect(mocks.store.create.mock.calls[0][0].beer_category).toBe('ipa');
    });
  });

  test('PUT canonicalises " Red Ale " to redale', function () {
    return callHandler('PUT', '/api/recipes/:id', { params: { id: 'SV-R-000011' }, body: { beer_category: ' Red Ale ' } }).then(function () {
      expect(mocks.store.update.mock.calls[0][0].beer_category).toBe('redale');
    });
  });

  test('PUT without beer_category leaves it untouched', function () {
    return callHandler('PUT', '/api/recipes/:id', { params: { id: 'SV-R-000011' }, body: { name: 'N' } }).then(function () {
      var p = mocks.store.update.mock.calls[0][0];
      expect(Object.prototype.hasOwnProperty.call(p, 'beer_category')).toBe(false);
    });
  });

  test('PUT with empty beer_category forwards ""', function () {
    return callHandler('PUT', '/api/recipes/:id', { params: { id: 'SV-R-000011' }, body: { beer_category: '' } }).then(function () {
      expect(mocks.store.update.mock.calls[0][0].beer_category).toBe('');
    });
  });

  test('PUT off-list category with status active gets 400 before the activation guard', function () {
    return callHandler('PUT', '/api/recipes/:id', { params: { id: 'SV-R-000011' }, body: { beer_category: 'purple', status: 'active' } }).then(function (res) {
      expect(res._status).toBe(400);
      expect(res._body.code).toBe('invalid_beer_category');
      expect(mocks.store.update).not.toHaveBeenCalled();
    });
  });
});
