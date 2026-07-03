'use strict';

// Regression tests for M6 (SSRF via POST /api/items/migrate csv_url).
//
// Before the fix, `csvUrl` (attacker/staff-controlled request body) was
// passed straight to axios.get with no scheme/host allowlist, letting a
// caller point the middleware's own network position at internal services
// (cloud metadata endpoint, localhost, private ranges) or any http(s) host.
//
// The fix is a MANDATORY (fail-closed-by-default) allowlist: the route 400s
// with no fetch when CSV_MIGRATE_ALLOWED_HOSTS is unset — NOT default-open.
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

jest.mock('axios', function () {
  return { get: jest.fn() };
});

jest.mock('../lib/zoho-api', function () {
  return {
    zohoGet: jest.fn(),
    zohoPost: jest.fn(),
    zohoPut: jest.fn(),
    inventoryGet: jest.fn(),
    inventoryPut: jest.fn(),
    fetchAllItems: jest.fn()
  };
});

jest.mock('../lib/cache', function () {
  return { get: jest.fn(), set: jest.fn(), del: jest.fn() };
});

jest.mock('../lib/logger', function () {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
});

jest.mock('../lib/constants', function () {
  return { CACHE_KEYS: { PRODUCTS: 'products-cache-key' } };
});

jest.mock('../lib/validate', function () {
  return {
    validateBody: jest.fn().mockReturnValue({ clean: {} })
  };
});

// Handlers that reject before axios.get run synchronously; handlers that
// proceed to the (mocked, resolved) fetch chain resolve over a few
// microtask ticks. flush() waits a macrotask tick so either shape settles
// before assertions run.
function flush() {
  return new Promise(function (resolve) { setImmediate(resolve); });
}

describe('POST /api/items/migrate — csv_url SSRF guard (M6)', function () {
  var axiosMock, router, handlers, savedAllowedHosts;

  function getHandlers() {
    jest.resetModules();
    axiosMock = require('axios');
    require('../routes/taxes');
    router = require('express').Router();
    handlers = {};
    router.post.mock.calls.forEach(function (call) {
      handlers['POST ' + call[0]] = call[call.length - 1];
    });
  }

  function mockRes() {
    var res = { json: jest.fn(), status: jest.fn() };
    res.status.mockReturnValue(res);
    return res;
  }

  beforeEach(function () {
    savedAllowedHosts = process.env.CSV_MIGRATE_ALLOWED_HOSTS;
    delete process.env.CSV_MIGRATE_ALLOWED_HOSTS;
    getHandlers();
  });

  afterEach(function () {
    if (savedAllowedHosts === undefined) delete process.env.CSV_MIGRATE_ALLOWED_HOSTS;
    else process.env.CSV_MIGRATE_ALLOWED_HOSTS = savedAllowedHosts;
  });

  test('CSV_MIGRATE_ALLOWED_HOSTS unset → 400, csv_url never fetched (fail closed by default)', function () {
    var req = { body: { csv_url: 'https://example.com/products.csv' } };
    var res = mockRes();

    handlers['POST /api/items/migrate'](req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(axiosMock.get).not.toHaveBeenCalled();
  });

  test('host not in allowlist → 400, never fetched', function () {
    process.env.CSV_MIGRATE_ALLOWED_HOSTS = 'trusted.example.com';
    getHandlers();
    var req = { body: { csv_url: 'https://not-allowed.example.com/x.csv' } };
    var res = mockRes();

    handlers['POST /api/items/migrate'](req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(axiosMock.get).not.toHaveBeenCalled();
  });

  test('non-https scheme (http) on an allowlisted host → 400, never fetched', function () {
    process.env.CSV_MIGRATE_ALLOWED_HOSTS = 'trusted.example.com';
    getHandlers();
    var req = { body: { csv_url: 'http://trusted.example.com/x.csv' } };
    var res = mockRes();

    handlers['POST /api/items/migrate'](req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(axiosMock.get).not.toHaveBeenCalled();
  });

  test('cloud metadata IP (169.254.169.254) → 400, never fetched', function () {
    process.env.CSV_MIGRATE_ALLOWED_HOSTS = '169.254.169.254';
    getHandlers();
    var req = { body: { csv_url: 'https://169.254.169.254/latest/meta-data/' } };
    var res = mockRes();

    handlers['POST /api/items/migrate'](req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(axiosMock.get).not.toHaveBeenCalled();
  });

  test('loopback host (127.0.0.1) → 400, never fetched', function () {
    process.env.CSV_MIGRATE_ALLOWED_HOSTS = '127.0.0.1';
    getHandlers();
    var req = { body: { csv_url: 'https://127.0.0.1/x.csv' } };
    var res = mockRes();

    handlers['POST /api/items/migrate'](req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(axiosMock.get).not.toHaveBeenCalled();
  });

  test('private-range host (10.0.0.1) → 400, never fetched', function () {
    process.env.CSV_MIGRATE_ALLOWED_HOSTS = '10.0.0.1';
    getHandlers();
    var req = { body: { csv_url: 'https://10.0.0.1/x.csv' } };
    var res = mockRes();

    handlers['POST /api/items/migrate'](req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(axiosMock.get).not.toHaveBeenCalled();
  });

  test('malformed csv_url → 400, no uncaught exception', function () {
    process.env.CSV_MIGRATE_ALLOWED_HOSTS = 'trusted.example.com';
    getHandlers();
    var req = { body: { csv_url: 'not a url at all' } };
    var res = mockRes();

    expect(function () {
      handlers['POST /api/items/migrate'](req, res);
    }).not.toThrow();

    expect(res.status).toHaveBeenCalledWith(400);
    expect(axiosMock.get).not.toHaveBeenCalled();
  });

  test('https + allowlisted host → proceeds to fetch (CSV parsing continues)', function () {
    process.env.CSV_MIGRATE_ALLOWED_HOSTS = 'trusted.example.com';
    getHandlers();
    axiosMock.get.mockResolvedValueOnce({ data: 'sku,name\nABC-1,Widget' });
    var zohoApi = require('../lib/zoho-api');
    zohoApi.fetchAllItems.mockResolvedValueOnce([]);

    var req = { body: { csv_url: 'https://trusted.example.com/x.csv' } };
    var res = mockRes();

    handlers['POST /api/items/migrate'](req, res);

    return flush().then(function () {
      expect(axiosMock.get).toHaveBeenCalledWith(
        'https://trusted.example.com/x.csv',
        expect.objectContaining({ responseType: 'text' })
      );
    });
  });
});
