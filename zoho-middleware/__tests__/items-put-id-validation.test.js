'use strict';

// Regression test for WR-02 (phase 52 code review): PUT /api/inventory/items/:id
// missing the M20 numeric-id guard.
//
// M20 added isValidId(req.params.id) to the two GET routes but not to the sibling
// PUT /api/inventory/items/:id, which builds the same Zoho path from an
// unvalidated :id — the same param-injection / path-pivot surface the guard was
// introduced to close, left open on the one route that MUTATES data.
//
// Pattern mirrors __tests__/items-id-validation.test.js.

jest.mock('express', function () {
  var router = { get: jest.fn(), post: jest.fn(), put: jest.fn() };
  var express = function () {};
  express.Router = function () { return router; };
  return express;
});

jest.mock('../lib/zoho-api', function () {
  return {
    zohoGet: jest.fn(),
    zohoPost: jest.fn(),
    inventoryGet: jest.fn(),
    inventoryPut: jest.fn(),
    ZOHO_INVENTORY_BASE: 'https://inventory.zoho.com/api/v1'
  };
});

jest.mock('../lib/zohoAuth', function () {
  return { getAccessToken: jest.fn().mockResolvedValue('test-token') };
});

jest.mock('../lib/logger', function () {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
});

jest.mock('../lib/validate', function () {
  return {
    validateBody: jest.fn().mockReturnValue({ clean: {} })
  };
});

jest.mock('axios', function () {
  return { get: jest.fn() };
});

function flush() {
  return new Promise(function (resolve) { setImmediate(resolve); });
}

describe('PUT /api/inventory/items/:id — :id validation (WR-02)', function () {
  var zohoApi, handlers;

  function getHandlers() {
    jest.resetModules();
    zohoApi = require('../lib/zoho-api');
    require('../routes/items');
    var router = require('express').Router();
    handlers = {};
    router.put.mock.calls.forEach(function (call) {
      handlers['PUT ' + call[0]] = call[call.length - 1];
    });
  }

  function mockRes() {
    var res = { json: jest.fn(), status: jest.fn() };
    res.status.mockReturnValue(res);
    return res;
  }

  beforeEach(function () {
    getHandlers();
  });

  test('%2F-pivot id (decoded to "7/bar") returns 400, inventoryPut never called', function () {
    var req = { params: { id: '7/bar' }, body: { name: 'x' } };
    var res = mockRes();

    handlers['PUT /api/inventory/items/:id'](req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(zohoApi.inventoryPut).not.toHaveBeenCalled();
  });

  test('non-numeric id "abc" returns 400, inventoryPut never called', function () {
    var req = { params: { id: 'abc' }, body: { name: 'x' } };
    var res = mockRes();

    handlers['PUT /api/inventory/items/:id'](req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(zohoApi.inventoryPut).not.toHaveBeenCalled();
  });

  test('valid numeric id still reaches the Zoho update', function () {
    zohoApi.inventoryPut.mockResolvedValueOnce({ item: { item_id: '12345' } });
    var req = { params: { id: '12345' }, body: { name: 'x' } };
    var res = mockRes();

    handlers['PUT /api/inventory/items/:id'](req, res);

    return flush().then(function () {
      expect(zohoApi.inventoryPut).toHaveBeenCalledWith('/items/12345', expect.anything());
      expect(res.status).not.toHaveBeenCalledWith(400);
    });
  });
});
