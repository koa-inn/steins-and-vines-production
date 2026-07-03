'use strict';

// Regression tests for M20 (path traversal / Zoho-path pivot via unvalidated
// :id / :item_id route params).
//
// Before the fix, req.params.id / req.params.item_id flowed unvalidated into
// a Zoho path concatenation ('/items/' + req.params.id), so a value like
// '7%2Fbar' (decoded by Express to '7/bar') could pivot the request to an
// arbitrary Inventory sub-path using the middleware's own Zoho token.
//
// Pattern mirrors __tests__/gift-cards.test.js: mock express.Router() so we
// can pull handlers out directly and invoke them without booting the full
// app / supertest.

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

// Neither handler under test returns its internal promise chain, so tests
// that need to observe post-async-resolution state wait a macrotask tick
// (flush) rather than chaining off the handler's (undefined) return value.
function flush() {
  return new Promise(function (resolve) { setImmediate(resolve); });
}

describe('items.js — :id / :item_id validation (M20)', function () {
  var zohoApi, axiosMock, router, handlers;

  function getHandlers() {
    jest.resetModules();
    zohoApi = require('../lib/zoho-api');
    axiosMock = require('axios');
    require('../routes/items');
    router = require('express').Router();
    // Keyed by "METHOD path" — items.js registers both GET and PUT on
    // '/api/inventory/items/:id', so a path-only key would collide.
    handlers = {};
    router.get.mock.calls.forEach(function (call) {
      handlers['GET ' + call[0]] = call[call.length - 1];
    });
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

  // -------------------------------------------------------------------------
  // GET /api/inventory/items/:id
  // -------------------------------------------------------------------------

  describe('GET /api/inventory/items/:id', function () {
    test('%2F-pivot id (decoded to "7/bar") returns 400, inventoryGet never called', function () {
      var req = { params: { id: '7/bar' } };
      var res = mockRes();

      handlers['GET /api/inventory/items/:id'](req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(zohoApi.inventoryGet).not.toHaveBeenCalled();
    });

    test('non-numeric id "abc" returns 400, inventoryGet never called', function () {
      var req = { params: { id: 'abc' } };
      var res = mockRes();

      handlers['GET /api/inventory/items/:id'](req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(zohoApi.inventoryGet).not.toHaveBeenCalled();
    });

    test('valid numeric id still reaches the Zoho call', function () {
      zohoApi.inventoryGet.mockResolvedValueOnce({ item: { item_id: '12345' } });
      var req = { params: { id: '12345' } };
      var res = mockRes();

      handlers['GET /api/inventory/items/:id'](req, res);

      return flush().then(function () {
        expect(zohoApi.inventoryGet).toHaveBeenCalledWith('/items/12345');
        expect(res.json).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalledWith(400);
      });
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/items/:item_id/image
  // -------------------------------------------------------------------------

  describe('GET /api/items/:item_id/image', function () {
    test('%2F-pivot item_id (decoded to "7/bar") returns 400, Zoho image fetch never called', function () {
      var req = { params: { item_id: '7/bar' } };
      var res = mockRes();

      handlers['GET /api/items/:item_id/image'](req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(axiosMock.get).not.toHaveBeenCalled();
    });

    test('non-numeric item_id "abc" returns 400, Zoho image fetch never called', function () {
      var req = { params: { item_id: 'abc' } };
      var res = mockRes();

      handlers['GET /api/items/:item_id/image'](req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(axiosMock.get).not.toHaveBeenCalled();
    });

    test('valid numeric item_id still reaches the Zoho image fetch', function () {
      axiosMock.get.mockResolvedValueOnce({
        status: 200,
        data: Buffer.from('fake-image-bytes'),
        headers: { 'content-type': 'image/png' }
      });
      var req = { params: { item_id: '12345' } };
      var res = { set: jest.fn(), send: jest.fn(), status: jest.fn(), json: jest.fn() };
      res.status.mockReturnValue(res);

      handlers['GET /api/items/:item_id/image'](req, res);

      return flush().then(function () {
        expect(axiosMock.get).toHaveBeenCalled();
        expect(axiosMock.get.mock.calls[0][0]).toBe(
          'https://inventory.zoho.com/api/v1/items/12345/image'
        );
        expect(res.send).toHaveBeenCalled();
      });
    });
  });
});
