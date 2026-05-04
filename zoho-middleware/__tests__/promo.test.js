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

require('../routes/promo');

function findHandler(method, path) {
  var entries = _routeRegistry[method] || [];
  for (var i = 0; i < entries.length; i++) {
    if (entries[i].path === path) return entries[i].handler;
  }
  throw new Error('No ' + method.toUpperCase() + ' handler registered for ' + path);
}

var validateHandler = findHandler('post', '/api/promo/validate');
var resetHandler = findHandler('delete', '/api/promo/redemption/:email');
var seedKioskHandler = findHandler('post', '/api/promo/seed-kiosk');

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
  cache.del.mockResolvedValue(1);
});

// ---------------------------------------------------------------------------
// POST /api/promo/validate
// ---------------------------------------------------------------------------

describe('POST /api/promo/validate', function () {
  test('returns 400 when code is missing', function () {
    var res = makeRes();
    return validateHandler(makeReq({ email: 'test@example.com' }), res).then(function () {
      expect(res._status).toBe(400);
      expect(res._json.error).toBeTruthy();
    });
  });

  test('returns 400 when code is empty string', function () {
    var res = makeRes();
    return validateHandler(makeReq({ code: '   ', email: 'test@example.com' }), res).then(function () {
      expect(res._status).toBe(400);
    });
  });

  test('returns 400 when email is missing', function () {
    var res = makeRes();
    return validateHandler(makeReq({ code: 'FIRSTBATCH' }), res).then(function () {
      expect(res._status).toBe(400);
      expect(res._json.error).toContain('email');
    });
  });

  test('returns 400 when email lacks @ symbol', function () {
    var res = makeRes();
    return validateHandler(makeReq({ code: 'FIRSTBATCH', email: 'notanemail' }), res).then(function () {
      expect(res._status).toBe(400);
      expect(res._json.error).toContain('email');
    });
  });

  test('returns 400 when code is not FIRSTBATCH', function () {
    var res = makeRes();
    return validateHandler(makeReq({ code: 'INVALIDCODE', email: 'test@example.com' }), res).then(function () {
      expect(res._status).toBe(400);
      expect(res._json.error).toContain('valid');
    });
  });

  test('returns 400 when email has already redeemed', function () {
    cache.get.mockResolvedValue({ redeemedAt: '2026-01-01' });
    var res = makeRes();
    return validateHandler(makeReq({ code: 'FIRSTBATCH', email: 'test@example.com' }), res).then(function () {
      expect(res._status).toBe(400);
      expect(res._json.error).toContain('already been used');
    });
  });

  test('returns ok:true and discountPct:20 for valid unredeemed code', function () {
    cache.get.mockResolvedValue(null);
    var res = makeRes();
    return validateHandler(makeReq({ code: 'FIRSTBATCH', email: 'test@example.com' }), res).then(function () {
      expect(res._json.ok).toBe(true);
      expect(res._json.discountPct).toBe(20);
      expect(res._json.code).toBe('FIRSTBATCH');
    });
  });

  test('normalizes email to lowercase before Redis lookup', function () {
    cache.get.mockResolvedValue(null);
    var res = makeRes();
    return validateHandler(makeReq({ code: 'FIRSTBATCH', email: 'Test@Example.COM' }), res).then(function () {
      expect(cache.get).toHaveBeenCalledWith(expect.stringContaining('test@example.com'));
    });
  });

  test('normalizes code to uppercase', function () {
    cache.get.mockResolvedValue(null);
    var res = makeRes();
    return validateHandler(makeReq({ code: 'firstbatch', email: 'test@example.com' }), res).then(function () {
      expect(res._json.ok).toBe(true);
    });
  });

  test('fails open when Redis throws on get', function () {
    cache.get.mockRejectedValue(new Error('Redis down'));
    var res = makeRes();
    return validateHandler(makeReq({ code: 'FIRSTBATCH', email: 'test@example.com' }), res).then(function () {
      expect(res._json.ok).toBe(true);
      expect(res._status).toBeNull(); // default 200, no explicit status call
    });
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/promo/redemption/:email
// ---------------------------------------------------------------------------

describe('DELETE /api/promo/redemption/:email', function () {
  test('returns ok:true after clearing redemption', function () {
    var res = makeRes();
    return resetHandler(makeReq({}, { email: 'test@example.com' }), res).then(function () {
      expect(res._json.ok).toBe(true);
      expect(res._json.email).toBe('test@example.com');
      expect(res._json.message).toBe('Redemption cleared');
      expect(cache.del).toHaveBeenCalledWith(expect.stringContaining('test@example.com'));
    });
  });

  test('returns 400 for invalid email param', function () {
    var res = makeRes();
    return resetHandler(makeReq({}, { email: 'notanemail' }), res).then(function () {
      expect(res._status).toBe(400);
    });
  });

  test('returns 500 when Redis del fails', function () {
    cache.del.mockRejectedValue(new Error('Redis down'));
    var res = makeRes();
    return resetHandler(makeReq({}, { email: 'test@example.com' }), res).then(function () {
      expect(res._status).toBe(500);
      expect(res._json.error).toContain('Failed');
    });
  });
});

// ---------------------------------------------------------------------------
// POST /api/promo/seed-kiosk
// ---------------------------------------------------------------------------

describe('POST /api/promo/seed-kiosk', function () {
  test('creates FIRSTBATCH preset when none exists', function () {
    cache.get.mockResolvedValue([]);
    var res = makeRes();
    seedKioskHandler(makeReq(), res);
    return flushPromises().then(function () {
      expect(res._status).toBe(201);
      expect(res._json.ok).toBe(true);
      expect(res._json.preset.name).toBe('FIRSTBATCH');
      expect(res._json.preset.type).toBe('percentage');
      expect(res._json.preset.value).toBe(20);
      expect(res._json.preset.scope).toBe('cart');
      expect(res._json.preset.active).toBe(true);
      expect(res._json.preset.id).toBe('promo_firstbatch');
      expect(res._json.preset.created_at).toBeTruthy();
      var savedArray = cache.set.mock.calls[0][1];
      expect(savedArray).toHaveLength(1);
      expect(savedArray[0].name).toBe('FIRSTBATCH');
    });
  });

  test('returns 200 without creating duplicate if FIRSTBATCH preset already exists', function () {
    var existing = [{ id: 'promo_firstbatch', name: 'FIRSTBATCH', type: 'percentage', value: 20, scope: 'cart', active: true }];
    cache.get.mockResolvedValue(existing);
    var res = makeRes();
    seedKioskHandler(makeReq(), res);
    return flushPromises().then(function () {
      expect(res._status).toBeNull(); // default 200
      expect(res._json.ok).toBe(true);
      expect(res._json.message).toContain('already exists');
      expect(cache.set).not.toHaveBeenCalled();
    });
  });

  test('returns 500 when Redis get fails', function () {
    cache.get.mockRejectedValue(new Error('Redis down'));
    var res = makeRes();
    seedKioskHandler(makeReq(), res);
    return flushPromises().then(function () {
      expect(res._status).toBe(500);
      expect(res._json.error).toContain('Failed');
    });
  });
});
