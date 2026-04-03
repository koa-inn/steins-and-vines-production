'use strict';

// ---------------------------------------------------------------------------
// Mocks — must be declared before require()
// ---------------------------------------------------------------------------
jest.mock('../lib/helcim', function () { return {
  isTerminalEnabled: jest.fn().mockReturnValue(true),
  terminalPurchase: jest.fn().mockResolvedValue({ ok: true }),
  pollTerminalResult: jest.fn().mockResolvedValue({
    status: 'APPROVED', transactionId: 'txn-999', approved: true, cardType: 'VISA'
  }),
  generateIdempotencyKey: jest.fn().mockReturnValue('test-idem-key'),
  voidTransaction: jest.fn().mockResolvedValue({ ok: true })
}; });

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

jest.mock('../lib/eventLog', function () { return { logEvent: jest.fn() }; });
jest.mock('../lib/logger', function () { return { info: jest.fn(), warn: jest.fn(), error: jest.fn() }; });

// Stub other modules that pos.js requires but these tests don't exercise
jest.mock('../lib/mailer', function () { return {
  sendVoidFailureAlert: jest.fn().mockResolvedValue()
}; });
jest.mock('../lib/inventory-ledger', function () { return {
  decrementStock: jest.fn().mockResolvedValue()
}; });

var helcimLib = require('../lib/helcim');
var zohoApi = require('../lib/zoho-api');
var cache = require('../lib/cache');

// ---------------------------------------------------------------------------
// Mock express.Router and capture route registrations
// ---------------------------------------------------------------------------
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

// Requiring the route file registers all handlers
require('../routes/pos');

function findHandler(method, path) {
  var entries = _routeRegistry[method] || [];
  for (var i = 0; i < entries.length; i++) {
    if (entries[i].path === path) return entries[i].handler;
  }
  throw new Error('No ' + method.toUpperCase() + ' handler registered for ' + path);
}

var getSalesordersHandler = findHandler('get', '/api/kiosk/salesorders');
var createSalesorderHandler = findHandler('post', '/api/kiosk/salesorder-create');
var paySalesorderHandler = findHandler('post', '/api/kiosk/salesorder-pay');

// ---------------------------------------------------------------------------
// Helpers — fake req/res for handler testing
// ---------------------------------------------------------------------------
function makeReq(body, query) {
  return { body: body || {}, query: query || {} };
}

function makeRes() {
  var res = {
    _status: null,
    _json: null,
    headersSent: false
  };
  res.status = jest.fn(function (code) {
    res._status = code;
    return res;
  });
  res.json = jest.fn(function (data) {
    res._json = data;
    res.headersSent = true;
    return res;
  });
  return res;
}

function flushPromises() {
  return new Promise(function (resolve) { setImmediate(resolve); });
}

// ---------------------------------------------------------------------------
// GET /api/kiosk/salesorders
// ---------------------------------------------------------------------------
describe('GET /api/kiosk/salesorders', function () {
  beforeEach(function () {
    jest.clearAllMocks();
    cache.get.mockResolvedValue(null);
    cache.set.mockResolvedValue('OK');
  });

  test('returns list of open sales orders from Zoho', function () {
    var mockSOs = [
      { salesorder_id: 'SO1', salesorder_number: 'SO-001', customer_name: 'Alice', total: 100, balance: 100 },
      { salesorder_id: 'SO2', salesorder_number: 'SO-002', customer_name: 'Bob', total: 200, balance: 150 }
    ];
    zohoApi.zohoGet.mockResolvedValue({ salesorders: mockSOs });

    var req = makeReq(null, {});
    var res = makeRes();

    getSalesordersHandler(req, res);

    return flushPromises().then(function () {
      expect(res.json).toHaveBeenCalled();
      var data = res._json;
      expect(data.salesorders).toBeDefined();
      expect(data.salesorders).toHaveLength(2);
      expect(zohoApi.zohoGet).toHaveBeenCalled();
    });
  });

  test('returns cached data on second call without calling Zoho', function () {
    var cachedData = JSON.stringify([
      { salesorder_id: 'SO1', salesorder_number: 'SO-001', customer_name: 'Alice', total: 100 }
    ]);
    cache.get.mockResolvedValue(cachedData);

    var req = makeReq(null, {});
    var res = makeRes();

    getSalesordersHandler(req, res);

    return flushPromises().then(function () {
      expect(res.json).toHaveBeenCalled();
      expect(zohoApi.zohoGet).not.toHaveBeenCalled();
    });
  });

  test('filters by search param (case-insensitive customer_name match)', function () {
    var mockSOs = [
      { salesorder_id: 'SO1', salesorder_number: 'SO-001', customer_name: 'Alice Smith', total: 100, balance: 100 },
      { salesorder_id: 'SO2', salesorder_number: 'SO-002', customer_name: 'Bob Jones', total: 200, balance: 150 }
    ];
    zohoApi.zohoGet.mockResolvedValue({ salesorders: mockSOs });

    var req = makeReq(null, { search: 'alice' });
    var res = makeRes();

    getSalesordersHandler(req, res);

    return flushPromises().then(function () {
      expect(res.json).toHaveBeenCalled();
      var data = res._json;
      expect(data.salesorders).toHaveLength(1);
      expect(data.salesorders[0].customer_name).toMatch(/Alice/i);
    });
  });

  test('handles Zoho API error gracefully with 502', function () {
    zohoApi.zohoGet.mockRejectedValue(new Error('Zoho unavailable'));

    var req = makeReq(null, {});
    var res = makeRes();

    getSalesordersHandler(req, res);

    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(502);
    });
  });
});

// ---------------------------------------------------------------------------
// POST /api/kiosk/salesorder-create
// ---------------------------------------------------------------------------
describe('POST /api/kiosk/salesorder-create', function () {
  beforeEach(function () {
    jest.clearAllMocks();
    cache.get.mockResolvedValue(null);
    cache.set.mockResolvedValue('OK');
    cache.del.mockResolvedValue(1);
  });

  test('happy path: valid customer + items creates SO and returns 200', function () {
    zohoApi.zohoPost.mockResolvedValue({
      salesorder: {
        salesorder_id: 'SO-NEW-1',
        salesorder_number: 'SO-00999',
        total: 75.00,
        balance: 75.00
      }
    });

    var req = makeReq({
      customer_id: 'CUST-123',
      items: [
        { item_id: 'ITEM-A', name: 'Wine Kit', quantity: 1, rate: 75.00 }
      ]
    });
    var res = makeRes();

    createSalesorderHandler(req, res);

    return flushPromises().then(function () {
      expect(res.json).toHaveBeenCalled();
      var data = res._json;
      expect(data.ok).toBe(true);
      expect(data.salesorder_id).toBe('SO-NEW-1');
      expect(data.salesorder_number).toBe('SO-00999');
      expect(zohoApi.zohoPost).toHaveBeenCalled();
      // Should invalidate SO cache
      expect(cache.del).toHaveBeenCalled();
    });
  });

  test('missing customer_id returns 400', function () {
    var req = makeReq({
      items: [{ item_id: 'ITEM-A', name: 'Kit', quantity: 1, rate: 50 }]
    });
    var res = makeRes();

    createSalesorderHandler(req, res);

    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res._json.error).toMatch(/customer/i);
    });
  });

  test('empty items array returns 400', function () {
    var req = makeReq({
      customer_id: 'CUST-123',
      items: []
    });
    var res = makeRes();

    createSalesorderHandler(req, res);

    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res._json.error).toMatch(/item/i);
    });
  });

  test('item with quantity <= 0 returns 400', function () {
    var req = makeReq({
      customer_id: 'CUST-123',
      items: [{ item_id: 'ITEM-A', name: 'Kit', quantity: 0, rate: 50 }]
    });
    var res = makeRes();

    createSalesorderHandler(req, res);

    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res._json.error).toMatch(/quantity/i);
    });
  });

  test('Zoho API error returns 502', function () {
    zohoApi.zohoPost.mockRejectedValue(new Error('Zoho Books API error'));

    var req = makeReq({
      customer_id: 'CUST-123',
      items: [{ item_id: 'ITEM-A', name: 'Kit', quantity: 1, rate: 50 }]
    });
    var res = makeRes();

    createSalesorderHandler(req, res);

    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(502);
    });
  });
});

// ---------------------------------------------------------------------------
// POST /api/kiosk/salesorder-pay
// ---------------------------------------------------------------------------
describe('POST /api/kiosk/salesorder-pay', function () {
  beforeEach(function () {
    jest.clearAllMocks();
    helcimLib.isTerminalEnabled.mockReturnValue(true);
    helcimLib.terminalPurchase.mockResolvedValue({ ok: true });
    helcimLib.pollTerminalResult.mockResolvedValue({
      status: 'APPROVED', transactionId: 'txn-999', approved: true, cardType: 'VISA'
    });
    helcimLib.voidTransaction.mockResolvedValue({ ok: true });
    cache.get.mockResolvedValue(null);
    cache.set.mockResolvedValue('OK');
    cache.del.mockResolvedValue(1);
  });

  test('happy path: valid SO → terminal approved → payment recorded → returns ok', function () {
    // Mock fetching the SO
    zohoApi.zohoGet.mockResolvedValue({
      salesorder: {
        salesorder_id: 'SO-PAY-1',
        salesorder_number: 'SO-00100',
        balance: 150.00,
        status: 'confirmed',
        customer_id: 'CUST-1'
      }
    });
    // Mock recording the payment in Zoho
    zohoApi.zohoPost.mockResolvedValue({ payment: { payment_id: 'PAY-1' } });

    var req = makeReq({ salesorder_id: 'SO-PAY-1' });
    var res = makeRes();

    paySalesorderHandler(req, res);

    return flushPromises().then(function () {
      return flushPromises();
    }).then(function () {
      return flushPromises();
    }).then(function () {
      expect(res.json).toHaveBeenCalled();
      var data = res._json;
      expect(data.ok).toBe(true);
      expect(helcimLib.terminalPurchase).toHaveBeenCalledWith(
        150.00, expect.any(String), expect.anything()
      );
      expect(zohoApi.zohoPost).toHaveBeenCalled();
    });
  });

  test('missing salesorder_id returns 400', function () {
    var req = makeReq({});
    var res = makeRes();

    paySalesorderHandler(req, res);

    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res._json.error).toMatch(/salesorder_id/i);
    });
  });

  test('SO balance is zero returns 400', function () {
    zohoApi.zohoGet.mockResolvedValue({
      salesorder: {
        salesorder_id: 'SO-ZERO',
        salesorder_number: 'SO-00200',
        balance: 0,
        status: 'confirmed',
        customer_id: 'CUST-1'
      }
    });

    var req = makeReq({ salesorder_id: 'SO-ZERO' });
    var res = makeRes();

    paySalesorderHandler(req, res);

    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res._json.error).toMatch(/balance/i);
    });
  });

  test('terminal not configured returns 503', function () {
    helcimLib.isTerminalEnabled.mockReturnValue(false);

    var req = makeReq({ salesorder_id: 'SO-123' });
    var res = makeRes();

    paySalesorderHandler(req, res);

    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(503);
      expect(res._json.error).toMatch(/terminal/i);
    });
  });

  test('payment declined returns 402', function () {
    zohoApi.zohoGet.mockResolvedValue({
      salesorder: {
        salesorder_id: 'SO-DEC',
        salesorder_number: 'SO-00300',
        balance: 50.00,
        status: 'confirmed',
        customer_id: 'CUST-1'
      }
    });
    helcimLib.pollTerminalResult.mockResolvedValue({
      status: 'DECLINED', approved: false
    });

    var req = makeReq({ salesorder_id: 'SO-DEC' });
    var res = makeRes();

    paySalesorderHandler(req, res);

    return flushPromises().then(function () {
      return flushPromises();
    }).then(function () {
      return flushPromises();
    }).then(function () {
      expect(res.status).toHaveBeenCalledWith(402);
    });
  });

  test('terminal timeout returns 504', function () {
    zohoApi.zohoGet.mockResolvedValue({
      salesorder: {
        salesorder_id: 'SO-TIMEOUT',
        salesorder_number: 'SO-00400',
        balance: 80.00,
        status: 'confirmed',
        customer_id: 'CUST-1'
      }
    });
    // Simulate terminal never resolving with approved/declined — poll always pending,
    // eventually the handler should time out
    helcimLib.pollTerminalResult.mockResolvedValue({
      status: 'PENDING', approved: false
    });
    // Override terminalPurchase to reject with timeout
    helcimLib.terminalPurchase.mockRejectedValue(new Error('Terminal timeout after 90s'));

    var req = makeReq({ salesorder_id: 'SO-TIMEOUT' });
    var res = makeRes();

    paySalesorderHandler(req, res);

    return flushPromises().then(function () {
      return flushPromises();
    }).then(function () {
      return flushPromises();
    }).then(function () {
      expect(res.status).toHaveBeenCalledWith(504);
    });
  });

  test('Zoho payment recording fails after approval → attempts void → returns 502', function () {
    zohoApi.zohoGet.mockResolvedValue({
      salesorder: {
        salesorder_id: 'SO-FAIL',
        salesorder_number: 'SO-00500',
        balance: 120.00,
        status: 'confirmed',
        customer_id: 'CUST-1'
      }
    });
    // Terminal approves, but Zoho payment recording fails
    helcimLib.pollTerminalResult.mockResolvedValue({
      status: 'APPROVED', transactionId: 'txn-fail-after', approved: true, cardType: 'VISA'
    });
    zohoApi.zohoPost.mockRejectedValue(new Error('Zoho payment API error'));

    var req = makeReq({ salesorder_id: 'SO-FAIL' });
    var res = makeRes();

    paySalesorderHandler(req, res);

    return flushPromises().then(function () {
      return flushPromises();
    }).then(function () {
      return flushPromises();
    }).then(function () {
      return flushPromises();
    }).then(function () {
      expect(helcimLib.voidTransaction).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(502);
    });
  });
});
