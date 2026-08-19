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
var _routeRegistry = { get: [], post: [], put: [] };

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
var getSalesorderDetailHandler = findHandler('get', '/api/kiosk/salesorder/:id');
var createSalesorderHandler = findHandler('post', '/api/kiosk/salesorder-create');
var paySalesorderHandler = findHandler('post', '/api/kiosk/salesorder-pay');
var updateSalesorderHandler = findHandler('put', '/api/kiosk/salesorder-update');
var verifyPinHandler = findHandler('post', '/api/kiosk/verify-pin');

// ---------------------------------------------------------------------------
// Helpers — fake req/res for handler testing
// ---------------------------------------------------------------------------
function makeReq(body, query, headers) {
  return { body: body || {}, query: query || {}, headers: headers || {} };
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
  var OLD_MW_KEY;

  beforeEach(function () {
    jest.clearAllMocks();
    cache.get.mockResolvedValue(null);
    cache.set.mockResolvedValue('OK');
    OLD_MW_KEY = process.env.MW_API_KEY;
    process.env.MW_API_KEY = 'test-api-key';
  });

  afterEach(function () {
    process.env.MW_API_KEY = OLD_MW_KEY;
  });

  // D-09 auth guard
  test('returns 401 without x-api-key header', function () {
    var req = makeReq(null, {}, {});
    var res = makeRes();
    getSalesordersHandler(req, res);
    expect(res._status).toBe(401);
    expect(res._json.error).toBe('Unauthorized');
    expect(zohoApi.zohoGet).not.toHaveBeenCalled();
  });

  test('returns list of open sales orders from Zoho', function () {
    var mockSOs = [
      { salesorder_id: 'SO1', salesorder_number: 'SO-001', customer_name: 'Alice', total: 100, balance: 100 },
      { salesorder_id: 'SO2', salesorder_number: 'SO-002', customer_name: 'Bob', total: 200, balance: 150 }
    ];
    zohoApi.zohoGet
      .mockResolvedValueOnce({ salesorders: mockSOs })
      .mockResolvedValueOnce({ salesorders: [] })
      .mockResolvedValueOnce({ salesorders: [] })
      .mockResolvedValueOnce({ salesorders: [] })
      .mockResolvedValueOnce({ salesorders: [] });

    var req = makeReq(null, {}, { 'x-api-key': 'test-api-key' });
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

    var req = makeReq(null, {}, { 'x-api-key': 'test-api-key' });
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
    zohoApi.zohoGet
      .mockResolvedValueOnce({ salesorders: mockSOs })
      .mockResolvedValueOnce({ salesorders: [] })
      .mockResolvedValueOnce({ salesorders: [] })
      .mockResolvedValueOnce({ salesorders: [] })
      .mockResolvedValueOnce({ salesorders: [] });

    var req = makeReq(null, { search: 'alice' }, { 'x-api-key': 'test-api-key' });
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

    var req = makeReq(null, {}, { 'x-api-key': 'test-api-key' });
    var res = makeRes();

    getSalesordersHandler(req, res);

    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(502);
    });
  });

  test('returns item_id in line_items when present', function () {
    var mockSOs = [
      {
        salesorder_id: 'SO-100', salesorder_number: 'SO-100', customer_name: 'Test',
        total: 50, balance: 50, status: 'open', date: '2026-04-27',
        line_items: [{ item_id: 'ITEM-A', name: 'Kit', quantity: 1, rate: 50, amount: 50 }]
      }
    ];
    zohoApi.zohoGet
      .mockResolvedValueOnce({ salesorders: mockSOs })
      .mockResolvedValueOnce({ salesorders: [] })
      .mockResolvedValueOnce({ salesorders: [] })
      .mockResolvedValueOnce({ salesorders: [] })
      .mockResolvedValueOnce({ salesorders: [] });

    var req = makeReq(null, {}, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    getSalesordersHandler(req, res);

    return flushPromises().then(function () {
      expect(res.json).toHaveBeenCalled();
      var orders = res._json.salesorders;
      expect(orders[0].line_items[0].item_id).toBe('ITEM-A');
    });
  });

  test('fetches 5 statuses (open, draft, closed, confirmed, invoiced)', function () {
    zohoApi.zohoGet.mockResolvedValue({ salesorders: [] });

    var req = makeReq(null, {}, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    getSalesordersHandler(req, res);

    return flushPromises().then(function () {
      expect(zohoApi.zohoGet).toHaveBeenCalledTimes(5);
      var calls = zohoApi.zohoGet.mock.calls;
      var statuses = calls.map(function (c) { return c[1].status; }).sort();
      expect(statuses).toEqual(['closed', 'confirmed', 'draft', 'invoiced', 'open']);
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
    // Mock fetching the SO + the finalized invoice (ensureOpenInvoiceForSalesOrder
    // + apply run the real money-path against these routed mocks).
    zohoApi.zohoGet.mockImplementation(function (path) {
      if (path === '/salesorders/SO-PAY-1') {
        return Promise.resolve({ salesorder: {
          salesorder_id: 'SO-PAY-1', salesorder_number: 'SO-00100',
          balance: 150.00, status: 'confirmed', customer_id: 'CUST-1', invoices: []
        } });
      }
      if (path === '/invoices/INV-SO-1') {
        return Promise.resolve({ invoice: { invoice_id: 'INV-SO-1', balance_due: 150.00 } });
      }
      return Promise.resolve({});
    });
    zohoApi.zohoPost.mockImplementation(function (endpoint) {
      if (endpoint.indexOf('/invoices/fromsalesorder') === 0) return Promise.resolve({ invoice: { invoice_id: 'INV-SO-1' } });
      if (/^\/invoices\/.+\/status\/sent$/.test(endpoint)) return Promise.resolve({});
      if (endpoint === '/customerpayments') return Promise.resolve({ payment: { payment_id: 'PAY-1' } });
      return Promise.resolve({});
    });

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

  // Phase-71 twin fix (caught on staging 2026-08-19): salesorder-pay is the LIVE
  // kiosk SO-payment route (the frontend calls it; /api/pos/collect has no
  // caller). It previously booked via salesorders_to_apply + a draft invoice —
  // the same unapplied-advance/draft bug phase 71 fixed only in the collect
  // webhook. It must now finalize the SO's invoice (/status/sent) and apply the
  // payment to that invoice via invoices:[...].
  test('books payment against a FINALIZED invoice via invoices[] — not salesorders_to_apply', function () {
    zohoApi.zohoGet.mockImplementation(function (path) {
      if (path === '/salesorders/SO-PAY-1') {
        return Promise.resolve({ salesorder: {
          salesorder_id: 'SO-PAY-1', salesorder_number: 'SO-00100',
          balance: 150.00, status: 'confirmed', customer_id: 'CUST-1', invoices: []
        } });
      }
      if (path === '/invoices/INV-SO-1') {
        return Promise.resolve({ invoice: { invoice_id: 'INV-SO-1', balance_due: 150.00 } });
      }
      return Promise.resolve({});
    });
    zohoApi.zohoPost.mockImplementation(function (endpoint) {
      if (endpoint.indexOf('/invoices/fromsalesorder') === 0) return Promise.resolve({ invoice: { invoice_id: 'INV-SO-1' } });
      if (/^\/invoices\/.+\/status\/sent$/.test(endpoint)) return Promise.resolve({});
      if (endpoint === '/customerpayments') return Promise.resolve({ payment: { payment_id: 'PAY-1' } });
      return Promise.resolve({});
    });

    var req = makeReq({ salesorder_id: 'SO-PAY-1' });
    var res = makeRes();
    paySalesorderHandler(req, res);

    return flushPromises().then(flushPromises).then(flushPromises).then(flushPromises).then(flushPromises).then(function () {
      expect(res._json && res._json.ok).toBe(true);
      // Finalize the SO's invoice via /status/sent (NOT /submit)
      expect(zohoApi.zohoPost).toHaveBeenCalledWith('/invoices/fromsalesorder?salesorder_id=SO-PAY-1', {});
      expect(zohoApi.zohoPost).toHaveBeenCalledWith('/invoices/INV-SO-1/status/sent', {});
      // Payment applied to the INVOICE, not the sales order
      var payCall = zohoApi.zohoPost.mock.calls.find(function (c) { return c[0] === '/customerpayments'; });
      expect(payCall).toBeTruthy();
      expect(payCall[1].invoices).toEqual([{ invoice_id: 'INV-SO-1', amount_applied: 150.00 }]);
      expect(payCall[1].salesorders_to_apply).toBeUndefined();
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

// ---------------------------------------------------------------------------
// PUT /api/kiosk/salesorder-update
// ---------------------------------------------------------------------------
describe('PUT /api/kiosk/salesorder-update', function () {
  var OLD_MW_KEY;

  beforeEach(function () {
    jest.clearAllMocks();
    cache.del.mockResolvedValue(1);
    OLD_MW_KEY = process.env.MW_API_KEY;
    process.env.MW_API_KEY = 'test-api-key';
  });

  afterEach(function () {
    process.env.MW_API_KEY = OLD_MW_KEY;
  });

  test('returns 401 without valid API key', function () {
    var req = makeReq({ salesorder_id: 'SO-1', items: [{ item_id: 'A', name: 'X', quantity: 1, rate: 10 }] }, {}, { 'x-api-key': 'wrong-key' });
    var res = makeRes();
    updateSalesorderHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res._json.error).toBe('Unauthorized');
  });

  test('returns 400 when salesorder_id missing', function () {
    var req = makeReq({ items: [{ item_id: 'A', name: 'X', quantity: 1, rate: 10 }] }, {}, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    updateSalesorderHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res._json.error).toContain('salesorder_id');
  });

  test('returns 400 when items array is empty', function () {
    var req = makeReq({ salesorder_id: 'SO-1', items: [] }, {}, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    updateSalesorderHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res._json.error).toContain('Items');
  });

  test('returns 400 when items is not an array', function () {
    var req = makeReq({ salesorder_id: 'SO-1', items: 'not-array' }, {}, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    updateSalesorderHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 400 when item_id missing from item', function () {
    var req = makeReq({ salesorder_id: 'SO-1', items: [{ name: 'X', quantity: 1, rate: 10 }] }, {}, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    updateSalesorderHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res._json.error).toContain('item_id');
  });

  test('returns 400 when quantity is zero', function () {
    var req = makeReq({ salesorder_id: 'SO-1', items: [{ item_id: 'A', name: 'X', quantity: 0, rate: 10 }] }, {}, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    updateSalesorderHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res._json.error).toContain('quantity');
  });

  test('returns 400 when rate is negative', function () {
    var req = makeReq({ salesorder_id: 'SO-1', items: [{ item_id: 'A', name: 'X', quantity: 1, rate: -5 }] }, {}, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    updateSalesorderHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res._json.error).toContain('rate');
  });

  test('happy path: updates SO and returns ok with cache bust', function () {
    zohoApi.zohoPut.mockResolvedValue({
      salesorder: { salesorder_id: 'SO-1', salesorder_number: 'SO-001', total: 75, balance: 75 }
    });

    var req = makeReq(
      { salesorder_id: 'SO-1', items: [{ item_id: 'ITEM-A', name: 'Kit', quantity: 1, rate: 75 }] },
      {},
      { 'x-api-key': 'test-api-key' }
    );
    var res = makeRes();
    updateSalesorderHandler(req, res);

    return flushPromises().then(function () {
      expect(zohoApi.zohoPut).toHaveBeenCalledWith('/salesorders/SO-1', {
        line_items: [{ item_id: 'ITEM-A', quantity: 1, rate: 75, name: 'Kit' }]
      });
      expect(cache.del).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalled();
      expect(res._json.ok).toBe(true);
      expect(res._json.salesorder_id).toBe('SO-1');
      expect(res._json.salesorder_number).toBe('SO-001');
      expect(res._json.total).toBe(75);
      expect(res._json.balance).toBe(75);
    });
  });

  test('returns 502 when Zoho API fails', function () {
    zohoApi.zohoPut.mockRejectedValue(new Error('Zoho timeout'));

    var req = makeReq(
      { salesorder_id: 'SO-1', items: [{ item_id: 'ITEM-A', name: 'Kit', quantity: 1, rate: 75 }] },
      {},
      { 'x-api-key': 'test-api-key' }
    );
    var res = makeRes();
    updateSalesorderHandler(req, res);

    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(502);
      expect(res._json.error).toContain('Failed to update');
    });
  });

  test('handles multiple items in payload', function () {
    zohoApi.zohoPut.mockResolvedValue({
      salesorder: { salesorder_id: 'SO-2', salesorder_number: 'SO-002', total: 150, balance: 150 }
    });

    var items = [
      { item_id: 'ITEM-A', name: 'Kit A', quantity: 2, rate: 50 },
      { item_id: 'ITEM-B', name: 'Kit B', quantity: 1, rate: 50 }
    ];
    var req = makeReq({ salesorder_id: 'SO-2', items: items }, {}, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    updateSalesorderHandler(req, res);

    return flushPromises().then(function () {
      var callPayload = zohoApi.zohoPut.mock.calls[0][1];
      expect(callPayload.line_items).toHaveLength(2);
      expect(callPayload.line_items[0].item_id).toBe('ITEM-A');
      expect(callPayload.line_items[1].item_id).toBe('ITEM-B');
      expect(res._json.ok).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// GET /api/kiosk/salesorder/:id  (D-09 auth guard + happy path)
// ---------------------------------------------------------------------------
describe('GET /api/kiosk/salesorder/:id', function () {
  var OLD_MW_KEY;

  beforeEach(function () {
    jest.clearAllMocks();
    OLD_MW_KEY = process.env.MW_API_KEY;
    process.env.MW_API_KEY = 'test-api-key';
  });

  afterEach(function () {
    process.env.MW_API_KEY = OLD_MW_KEY;
  });

  test('returns 401 without x-api-key header', function () {
    var req = makeReq(null, {}, {});
    req.params = { id: 'SO-123' };
    var res = makeRes();
    getSalesorderDetailHandler(req, res);
    expect(res._status).toBe(401);
    expect(res._json.error).toBe('Unauthorized');
    expect(zohoApi.zohoGet).not.toHaveBeenCalled();
  });

  test('returns order detail with valid API key', function () {
    zohoApi.zohoGet.mockResolvedValue({
      salesorder: {
        salesorder_id: 'SO-123',
        salesorder_number: 'SO-00123',
        customer_name: 'Alice',
        customer_id: 'CUST-1',
        balance: 50,
        total: 100,
        status: 'open',
        date: '2026-06-29',
        line_items: [{ item_id: 'ITEM-A', name: 'Kit', quantity: 1, rate: 100, item_total: 100 }]
      }
    });

    var req = makeReq(null, {}, { 'x-api-key': 'test-api-key' });
    req.params = { id: 'SO-123' };
    var res = makeRes();

    getSalesorderDetailHandler(req, res);

    return flushPromises().then(function () {
      expect(res.json).toHaveBeenCalled();
      var data = res._json;
      expect(data.salesorder_id).toBe('SO-123');
      expect(data.customer_name).toBe('Alice');
      expect(data.line_items).toHaveLength(1);
      expect(data.line_items[0].item_id).toBe('ITEM-A');
    });
  });

  test('returns 502 when Zoho API fails', function () {
    zohoApi.zohoGet.mockRejectedValue(new Error('Zoho unavailable'));

    var req = makeReq(null, {}, { 'x-api-key': 'test-api-key' });
    req.params = { id: 'SO-123' };
    var res = makeRes();

    getSalesorderDetailHandler(req, res);

    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(502);
    });
  });
});

// ---------------------------------------------------------------------------
// POST /api/kiosk/verify-pin  (D-15 regression: length-check before timingSafeEqual)
// ---------------------------------------------------------------------------
describe('POST /api/kiosk/verify-pin', function () {
  var OLD_KIOSK_PIN;

  beforeEach(function () {
    jest.clearAllMocks();
    OLD_KIOSK_PIN = process.env.KIOSK_PIN;
  });

  afterEach(function () {
    process.env.KIOSK_PIN = OLD_KIOSK_PIN;
  });

  // REGRESSION: Before the D-15 fix, a misconfigured KIOSK_PIN (wrong length)
  // caused crypto.timingSafeEqual to throw a RangeError — Express surfaced a 500
  // on every login, locking out all staff. This test asserts the correct 503 path.
  test('[REGRESSION D-15] KIOSK_PIN length mismatch returns 503 (not 500/RangeError)', function () {
    process.env.KIOSK_PIN = '123456'; // 6 chars — mismatched with 4-digit submitted pin
    var req = makeReq({ pin: '1234' });
    var res = makeRes();
    verifyPinHandler(req, res);
    expect(res._status).toBe(503);
    expect(res._json.ok).toBe(false);
    expect(res._json.error).toBe('PIN not configured');
  });

  test('returns 400 when pin is not 4 digits', function () {
    var req = makeReq({ pin: '123' });
    var res = makeRes();
    verifyPinHandler(req, res);
    expect(res._status).toBe(400);
    expect(res._json.error).toMatch(/4 digits/i);
  });

  test('returns 503 when KIOSK_PIN is not set', function () {
    delete process.env.KIOSK_PIN;
    var req = makeReq({ pin: '1234' });
    var res = makeRes();
    verifyPinHandler(req, res);
    expect(res._status).toBe(503);
    expect(res._json.error).toBe('PIN not configured');
  });

  test('returns ok:true when correct 4-digit PIN is submitted', function () {
    process.env.KIOSK_PIN = '1234';
    var req = makeReq({ pin: '1234' });
    var res = makeRes();
    verifyPinHandler(req, res);
    expect(res.json).toHaveBeenCalled();
    expect(res._json.ok).toBe(true);
  });

  test('returns 401 when wrong same-length PIN is submitted', function () {
    process.env.KIOSK_PIN = '1234';
    var req = makeReq({ pin: '5678' });
    var res = makeRes();
    verifyPinHandler(req, res);
    expect(res._status).toBe(401);
    expect(res._json.ok).toBe(false);
  });
});

