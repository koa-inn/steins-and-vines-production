'use strict';

jest.mock('../lib/cache', function () { return {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
  isConnected: jest.fn().mockReturnValue(true)
}; });

jest.mock('../lib/logger', function () { return { info: jest.fn(), warn: jest.fn(), error: jest.fn() }; });

var cache = require('../lib/cache');

var _routeRegistry = { get: [], post: [], put: [], delete: [] };

jest.mock('express', function () {
  var router = {
    get: jest.fn(function (path, handler) {
      _routeRegistry.get.push({ path: path, handler: handler });
    }),
    post: jest.fn(function (path, handler) {
      _routeRegistry.post.push({ path: path, handler: handler });
    }),
    put: jest.fn(function (path, handler) {
      _routeRegistry.put.push({ path: path, handler: handler });
    }),
    delete: jest.fn(function (path, handler) {
      _routeRegistry.delete.push({ path: path, handler: handler });
    })
  };
  var express = function () {};
  express.Router = function () { return router; };
  return express;
});

require('../routes/discounts');

function findHandler(method, path) {
  var entries = _routeRegistry[method] || [];
  for (var i = 0; i < entries.length; i++) {
    if (entries[i].path === path) return entries[i].handler;
  }
  throw new Error('No ' + method.toUpperCase() + ' handler registered for ' + path);
}

var getHandler = findHandler('get', '/api/kiosk/discounts');
var postHandler = findHandler('post', '/api/kiosk/discounts');
var putHandler = findHandler('put', '/api/kiosk/discounts/:id');
var deleteHandler = findHandler('delete', '/api/kiosk/discounts/:id');

function makeReq(body, params) {
  return { body: body || {}, params: params || {} };
}

function makeRes() {
  var res = { _status: null, _json: null };
  res.status = jest.fn(function (code) { res._status = code; return res; });
  res.json = jest.fn(function (data) { res._json = data; return res; });
  return res;
}

function flushPromises() {
  return new Promise(function (resolve) { setImmediate(resolve); });
}

beforeEach(function () {
  jest.clearAllMocks();
  cache.get.mockResolvedValue(null);
  cache.set.mockResolvedValue('OK');
});

// ---------------------------------------------------------------------------
// GET /api/kiosk/discounts
// ---------------------------------------------------------------------------

describe('GET /api/kiosk/discounts', function () {
  test('returns empty array when no presets exist', function () {
    cache.get.mockResolvedValue(null);
    var res = makeRes();
    getHandler(makeReq(), res);
    return flushPromises().then(function () {
      expect(res.json).toHaveBeenCalledWith({ ok: true, discounts: [] });
    });
  });

  test('returns existing presets', function () {
    var presets = [{ id: 'disc_abc', name: 'Test', type: 'percentage', value: 10, scope: 'cart', active: true }];
    cache.get.mockResolvedValue(presets);
    var res = makeRes();
    getHandler(makeReq(), res);
    return flushPromises().then(function () {
      expect(res._json.ok).toBe(true);
      expect(res._json.discounts).toEqual(presets);
    });
  });

  test('returns 500 on cache error', function () {
    cache.get.mockRejectedValue(new Error('Redis down'));
    var res = makeRes();
    getHandler(makeReq(), res);
    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });
});

// ---------------------------------------------------------------------------
// POST /api/kiosk/discounts
// ---------------------------------------------------------------------------

describe('POST /api/kiosk/discounts', function () {
  test('creates a new preset', function () {
    cache.get.mockResolvedValue([]);
    var body = { name: 'Staff 10%', type: 'percentage', value: 10, scope: 'cart' };
    var res = makeRes();
    postHandler(makeReq(body), res);
    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res._json.ok).toBe(true);
      var disc = res._json.discount;
      expect(disc.name).toBe('Staff 10%');
      expect(disc.type).toBe('percentage');
      expect(disc.value).toBe(10);
      expect(disc.scope).toBe('cart');
      expect(disc.active).toBe(true);
      expect(disc.id).toMatch(/^disc_/);
      expect(disc.created_at).toBeTruthy();
      expect(cache.set).toHaveBeenCalled();
    });
  });

  test('rejects missing name', function () {
    var body = { type: 'percentage', value: 10, scope: 'cart' };
    var res = makeRes();
    postHandler(makeReq(body), res);
    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res._json.error).toContain('name');
    });
  });

  test('rejects empty name', function () {
    var body = { name: '   ', type: 'percentage', value: 10, scope: 'cart' };
    var res = makeRes();
    postHandler(makeReq(body), res);
    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  test('rejects name over 64 chars', function () {
    var body = { name: 'x'.repeat(65), type: 'percentage', value: 10, scope: 'cart' };
    var res = makeRes();
    postHandler(makeReq(body), res);
    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res._json.error).toContain('64');
    });
  });

  test('rejects invalid type', function () {
    var body = { name: 'Test', type: 'bogo', value: 10, scope: 'cart' };
    var res = makeRes();
    postHandler(makeReq(body), res);
    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res._json.error).toContain('type');
    });
  });

  test('rejects value <= 0', function () {
    var body = { name: 'Test', type: 'fixed', value: 0, scope: 'cart' };
    var res = makeRes();
    postHandler(makeReq(body), res);
    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res._json.error).toContain('value');
    });
  });

  test('rejects negative value', function () {
    var body = { name: 'Test', type: 'fixed', value: -5, scope: 'cart' };
    var res = makeRes();
    postHandler(makeReq(body), res);
    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  test('rejects percentage > 100', function () {
    var body = { name: 'Test', type: 'percentage', value: 101, scope: 'cart' };
    var res = makeRes();
    postHandler(makeReq(body), res);
    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res._json.error).toContain('100');
    });
  });

  test('rejects fixed > 9999.99', function () {
    var body = { name: 'Test', type: 'fixed', value: 10000, scope: 'cart' };
    var res = makeRes();
    postHandler(makeReq(body), res);
    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res._json.error).toContain('9999.99');
    });
  });

  test('rejects invalid scope', function () {
    var body = { name: 'Test', type: 'percentage', value: 10, scope: 'order' };
    var res = makeRes();
    postHandler(makeReq(body), res);
    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res._json.error).toContain('scope');
    });
  });

  test('appends to existing presets', function () {
    var existing = [{ id: 'disc_old', name: 'Old', type: 'fixed', value: 5, scope: 'cart', active: true }];
    cache.get.mockResolvedValue(existing);
    var body = { name: 'New', type: 'percentage', value: 15, scope: 'cart' };
    var res = makeRes();
    postHandler(makeReq(body), res);
    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(201);
      // cache.set should have been called with array of length 2
      var savedArray = cache.set.mock.calls[0][1];
      expect(savedArray).toHaveLength(2);
      expect(savedArray[0].id).toBe('disc_old');
    });
  });

  test('rejects legacy "item" scope (no longer supported)', function () {
    var body = { name: 'Legacy', type: 'percentage', value: 10, scope: 'item' };
    var res = makeRes();
    postHandler(makeReq(body), res);
    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res._json.error).toContain('scope');
    });
  });

  test('creates a "type"-scoped preset with applies_to', function () {
    cache.get.mockResolvedValue([]);
    var body = { name: 'Wine 10%', type: 'percentage', value: 10, scope: 'type', applies_to: ['kit:wine', 'kit:beer'] };
    var res = makeRes();
    postHandler(makeReq(body), res);
    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res._json.discount.scope).toBe('type');
      expect(res._json.discount.applies_to).toEqual(['kit:wine', 'kit:beer']);
    });
  });

  test('accepts group + single tokens in applies_to', function () {
    cache.get.mockResolvedValue([]);
    var body = { name: 'Ingredients+Svc', type: 'fixed', value: 5, scope: 'type', applies_to: ['ingredient', 'service', 'recipe'] };
    var res = makeRes();
    postHandler(makeReq(body), res);
    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res._json.discount.applies_to).toEqual(['ingredient', 'service', 'recipe']);
    });
  });

  test('rejects "type" scope with missing applies_to', function () {
    var body = { name: 'NoTokens', type: 'percentage', value: 10, scope: 'type' };
    var res = makeRes();
    postHandler(makeReq(body), res);
    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res._json.error).toContain('applies_to');
    });
  });

  test('rejects "type" scope with empty applies_to', function () {
    var body = { name: 'EmptyTokens', type: 'percentage', value: 10, scope: 'type', applies_to: [] };
    var res = makeRes();
    postHandler(makeReq(body), res);
    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res._json.error).toContain('applies_to');
    });
  });

  test('rejects unknown token in applies_to', function () {
    var body = { name: 'BadToken', type: 'percentage', value: 10, scope: 'type', applies_to: ['kit:merlot'] };
    var res = makeRes();
    postHandler(makeReq(body), res);
    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res._json.error).toContain('unknown token');
    });
  });

  test('does not store applies_to for cart scope', function () {
    cache.get.mockResolvedValue([]);
    var body = { name: 'Cart', type: 'percentage', value: 10, scope: 'cart', applies_to: ['kit'] };
    var res = makeRes();
    postHandler(makeReq(body), res);
    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res._json.discount.applies_to).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// PUT /api/kiosk/discounts/:id
// ---------------------------------------------------------------------------

describe('PUT /api/kiosk/discounts/:id', function () {
  test('updates an existing preset', function () {
    var presets = [{ id: 'disc_123', name: 'Old Name', type: 'percentage', value: 10, scope: 'cart', active: true }];
    cache.get.mockResolvedValue(presets);
    var body = { name: 'New Name', value: 20 };
    var res = makeRes();
    putHandler(makeReq(body, { id: 'disc_123' }), res);
    return flushPromises().then(function () {
      expect(res._json.ok).toBe(true);
      expect(res._json.discount.name).toBe('New Name');
      expect(res._json.discount.value).toBe(20);
      expect(res._json.discount.type).toBe('percentage'); // unchanged
    });
  });

  test('can deactivate a preset', function () {
    var presets = [{ id: 'disc_123', name: 'Test', type: 'percentage', value: 10, scope: 'cart', active: true }];
    cache.get.mockResolvedValue(presets);
    var body = { active: false };
    var res = makeRes();
    putHandler(makeReq(body, { id: 'disc_123' }), res);
    return flushPromises().then(function () {
      expect(res._json.discount.active).toBe(false);
    });
  });

  test('returns 404 for unknown id', function () {
    cache.get.mockResolvedValue([]);
    var body = { name: 'Test' };
    var res = makeRes();
    putHandler(makeReq(body, { id: 'disc_nope' }), res);
    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  test('validates updated fields', function () {
    var presets = [{ id: 'disc_123', name: 'Test', type: 'percentage', value: 10, scope: 'cart', active: true }];
    cache.get.mockResolvedValue(presets);
    var body = { type: 'bogus' };
    var res = makeRes();
    putHandler(makeReq(body, { id: 'disc_123' }), res);
    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  test('switching to "type" scope without applies_to is rejected', function () {
    var presets = [{ id: 'disc_123', name: 'Test', type: 'percentage', value: 10, scope: 'cart', active: true }];
    cache.get.mockResolvedValue(presets);
    var res = makeRes();
    putHandler(makeReq({ scope: 'type' }, { id: 'disc_123' }), res);
    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res._json.error).toContain('applies_to');
    });
  });

  test('switching to "type" scope with applies_to succeeds', function () {
    var presets = [{ id: 'disc_123', name: 'Test', type: 'percentage', value: 10, scope: 'cart', active: true }];
    cache.get.mockResolvedValue(presets);
    var res = makeRes();
    putHandler(makeReq({ scope: 'type', applies_to: ['service'] }, { id: 'disc_123' }), res);
    return flushPromises().then(function () {
      expect(res._json.ok).toBe(true);
      expect(res._json.discount.scope).toBe('type');
      expect(res._json.discount.applies_to).toEqual(['service']);
    });
  });

  test('switching back to "cart" scope drops applies_to', function () {
    var presets = [{ id: 'disc_123', name: 'Test', type: 'percentage', value: 10, scope: 'type', applies_to: ['kit'], active: true }];
    cache.get.mockResolvedValue(presets);
    var res = makeRes();
    putHandler(makeReq({ scope: 'cart' }, { id: 'disc_123' }), res);
    return flushPromises().then(function () {
      expect(res._json.ok).toBe(true);
      expect(res._json.discount.applies_to).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/kiosk/discounts/:id
// ---------------------------------------------------------------------------

describe('DELETE /api/kiosk/discounts/:id', function () {
  test('deletes an existing preset', function () {
    var presets = [
      { id: 'disc_a', name: 'A' },
      { id: 'disc_b', name: 'B' }
    ];
    cache.get.mockResolvedValue(presets);
    var res = makeRes();
    deleteHandler(makeReq({}, { id: 'disc_a' }), res);
    return flushPromises().then(function () {
      expect(res._json.ok).toBe(true);
      var saved = cache.set.mock.calls[0][1];
      expect(saved).toHaveLength(1);
      expect(saved[0].id).toBe('disc_b');
    });
  });

  test('returns 404 for unknown id', function () {
    cache.get.mockResolvedValue([]);
    var res = makeRes();
    deleteHandler(makeReq({}, { id: 'disc_nope' }), res);
    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });
});
