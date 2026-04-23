'use strict';

jest.mock('../lib/zoho-api', function () { return {
  zohoGet: jest.fn(),
  zohoPost: jest.fn(),
  zohoPut: jest.fn()
}; });

jest.mock('../lib/cache', function () { return {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
  isConnected: jest.fn().mockReturnValue(true)
}; });

jest.mock('../lib/logger', function () { return { info: jest.fn(), warn: jest.fn(), error: jest.fn() }; });

var zohoApi = require('../lib/zoho-api');
var cache = require('../lib/cache');

var _routeRegistry = { get: [], post: [] };

jest.mock('express', function () {
  var router = {
    get: jest.fn(function (path, handler) {
      _routeRegistry.get.push({ path: path, handler: handler });
    }),
    post: jest.fn(function (path, handler) {
      _routeRegistry.post.push({ path: path, handler: handler });
    })
  };
  var express = function () {};
  express.Router = function () { return router; };
  return express;
});

require('../routes/consignment');

function findHandler(method, path) {
  var entries = _routeRegistry[method] || [];
  for (var i = 0; i < entries.length; i++) {
    if (entries[i].path === path) return entries[i].handler;
  }
  throw new Error('No ' + method.toUpperCase() + ' handler registered for ' + path);
}

var reportHandler = findHandler('get', '/api/admin/consignment-report');

function makeReq(query) {
  return { body: {}, query: query || {}, headers: { 'x-api-key': 'test-key' } };
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
  process.env.MW_API_KEY = 'test-key';
  process.env.ZOHO_CF_CONSIGNMENT_DETAILS = 'cf_consignment_details';
  cache.get.mockResolvedValue(null);
});

afterEach(function () {
  delete process.env.MW_API_KEY;
  delete process.env.ZOHO_CF_CONSIGNMENT_DETAILS;
});

describe('GET /api/admin/consignment-report', function () {
  test('returns 401 without API key', function () {
    var req = { body: {}, query: { month: '2026-04' }, headers: {} };
    var res = makeRes();
    reportHandler(req, res);
    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(401);
    });
  });

  test('returns 400 for invalid month format', function () {
    var req = makeReq({ month: 'April' });
    var res = makeRes();
    reportHandler(req, res);
    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  test('returns empty artisans array when no consignment invoices exist', function () {
    zohoApi.zohoGet.mockResolvedValue({ invoices: [] });
    var req = makeReq({ month: '2026-04' });
    var res = makeRes();
    reportHandler(req, res);
    return flushPromises().then(function () {
      expect(res.json).toHaveBeenCalled();
      var data = res._json;
      expect(data.month).toBe('2026-04');
      expect(data.artisans).toEqual([]);
      expect(data.totals.total_sales).toBe(0);
    });
  });

  test('aggregates consignment sales by artisan', function () {
    var invoices = [
      {
        invoice_number: 'INV-001',
        date: '2026-04-05',
        custom_fields: [{
          api_name: 'cf_consignment_details',
          value: JSON.stringify([
            { artisan_name: 'Alice', commission_rate: 65, sale_amount: 40, artisan_payout: 26, quantity: 2, item_name: 'Mug' }
          ])
        }]
      },
      {
        invoice_number: 'INV-002',
        date: '2026-04-10',
        custom_fields: [{
          api_name: 'cf_consignment_details',
          value: JSON.stringify([
            { artisan_name: 'Alice', commission_rate: 65, sale_amount: 20, artisan_payout: 13, quantity: 1, item_name: 'Bowl' },
            { artisan_name: 'Bob', commission_rate: 70, sale_amount: 50, artisan_payout: 35, quantity: 1, item_name: 'Vase' }
          ])
        }]
      }
    ];
    zohoApi.zohoGet.mockResolvedValue({ invoices: invoices });

    var req = makeReq({ month: '2026-04' });
    var res = makeRes();
    reportHandler(req, res);

    return flushPromises().then(function () {
      var data = res._json;
      expect(data.artisans).toHaveLength(2);

      var alice = data.artisans.find(function (a) { return a.artisan_name === 'Alice'; });
      expect(alice.total_sales).toBe(60);
      expect(alice.total_payout).toBe(39);
      expect(alice.items_sold).toBe(3);
      expect(alice.sales).toHaveLength(2);

      var bob = data.artisans.find(function (a) { return a.artisan_name === 'Bob'; });
      expect(bob.total_sales).toBe(50);
      expect(bob.total_payout).toBe(35);
      expect(bob.items_sold).toBe(1);

      expect(data.totals.total_sales).toBe(110);
      expect(data.totals.total_payouts).toBe(74);
    });
  });

  test('returns cached result without calling Zoho', function () {
    var cachedData = { month: '2026-04', artisans: [], totals: { total_sales: 0, total_payouts: 0, total_store_commission: 0 } };
    cache.get.mockResolvedValue(cachedData);

    var req = makeReq({ month: '2026-04' });
    var res = makeRes();
    reportHandler(req, res);

    return flushPromises().then(function () {
      expect(res.json).toHaveBeenCalledWith(cachedData);
      expect(zohoApi.zohoGet).not.toHaveBeenCalled();
    });
  });

  test('skips invoices with no consignment details', function () {
    var invoices = [
      { invoice_number: 'INV-001', date: '2026-04-01', custom_fields: [] },
      {
        invoice_number: 'INV-002',
        date: '2026-04-02',
        custom_fields: [{
          api_name: 'cf_consignment_details',
          value: JSON.stringify([
            { artisan_name: 'Alice', commission_rate: 60, sale_amount: 30, artisan_payout: 18, quantity: 1, item_name: 'Plate' }
          ])
        }]
      }
    ];
    zohoApi.zohoGet.mockResolvedValue({ invoices: invoices });

    var req = makeReq({ month: '2026-04' });
    var res = makeRes();
    reportHandler(req, res);

    return flushPromises().then(function () {
      var data = res._json;
      expect(data.artisans).toHaveLength(1);
      expect(data.artisans[0].artisan_name).toBe('Alice');
    });
  });

  test('handles Zoho API error with 502', function () {
    zohoApi.zohoGet.mockRejectedValue(new Error('Zoho unavailable'));

    var req = makeReq({ month: '2026-04' });
    var res = makeRes();
    reportHandler(req, res);

    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(502);
    });
  });
});
