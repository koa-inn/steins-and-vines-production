'use strict';

// Regression test for WR-01 (phase 52 code review): SSRF allowlist/private-host
// block bypassable via HTTP redirect on POST /api/items/migrate.
//
// M6 added validateCsvUrl (allowlist + https-only + private-range block), but it
// only validated the INITIAL csv_url. axios.get was called with no maxRedirects
// override, so axios follows up to its default 5 redirects — an allowlisted host
// that returns a 3xx could bounce the fetch to 169.254.169.254 (cloud metadata)
// or any internal host, the exact fail-open corner M6 was meant to close.
//
// The fix pins maxRedirects: 0 so the fetch fails closed on any redirect rather
// than following it to an unvalidated (possibly private/metadata) target.
//
// Pattern mirrors __tests__/taxes-ssrf.test.js.

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

function flush() {
  return new Promise(function (resolve) { setImmediate(resolve); });
}

describe('POST /api/items/migrate — SSRF redirect-following guard (WR-01)', function () {
  var axiosMock, handlers, savedAllowedHosts;

  function getHandlers() {
    jest.resetModules();
    axiosMock = require('axios');
    require('../routes/taxes');
    var router = require('express').Router();
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
    process.env.CSV_MIGRATE_ALLOWED_HOSTS = 'example.com';
    getHandlers();
  });

  afterEach(function () {
    if (savedAllowedHosts === undefined) {
      delete process.env.CSV_MIGRATE_ALLOWED_HOSTS;
    } else {
      process.env.CSV_MIGRATE_ALLOWED_HOSTS = savedAllowedHosts;
    }
  });

  test('the CSV fetch does NOT follow redirects (maxRedirects: 0)', function () {
    // Resolve with a minimal CSV so the handler chain does not throw before
    // we can inspect how axios.get was invoked.
    axiosMock.get.mockResolvedValueOnce({ data: 'sku,name\n' });

    var req = { body: { csv_url: 'https://example.com/items.csv', apply: false } };
    var res = mockRes();

    handlers['POST /api/items/migrate'](req, res);

    return flush().then(function () {
      expect(axiosMock.get).toHaveBeenCalledTimes(1);
      var opts = axiosMock.get.mock.calls[0][1] || {};
      // The core WR-01 assertion: axios must be told not to follow redirects,
      // so an allowlisted open-redirect host cannot bounce the fetch to an
      // internal/metadata target that was never re-validated.
      expect(opts.maxRedirects).toBe(0);
    });
  });
});
