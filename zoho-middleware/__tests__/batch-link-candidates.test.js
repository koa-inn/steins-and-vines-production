'use strict';

// ---------------------------------------------------------------------------
// Mocks — must be declared before require()
// Phase 90-05: GET /api/batch/link-candidates.
// ---------------------------------------------------------------------------
jest.mock('../lib/helcim', function () { return {
  isTerminalEnabled: jest.fn().mockReturnValue(false),
  terminalPurchase: jest.fn().mockResolvedValue({ ok: true }),
  pollTerminalResult: jest.fn().mockResolvedValue({ status: 'APPROVED', transactionId: 'txn-999', approved: true, cardType: 'VISA' }),
  generateIdempotencyKey: jest.fn().mockReturnValue('test-idem-key'),
  voidTransaction: jest.fn().mockResolvedValue({ ok: true })
}; });

jest.mock('../lib/zoho-api', function () { return {
  zohoGet: jest.fn(),
  zohoPost: jest.fn(),
  zohoPut: jest.fn()
}; });

var _cacheStore = {};
jest.mock('../lib/cache', function () { return {
  get: jest.fn(function (k) { return Promise.resolve(Object.prototype.hasOwnProperty.call(_cacheStore, k) ? _cacheStore[k] : null); }),
  set: jest.fn(function (k, v) { _cacheStore[k] = v; return Promise.resolve('OK'); }),
  del: jest.fn().mockResolvedValue(1),
  isConnected: jest.fn().mockReturnValue(true)
}; });

jest.mock('../lib/eventLog', function () { return { logEvent: jest.fn() }; });
jest.mock('../lib/logger', function () { return { info: jest.fn(), warn: jest.fn(), error: jest.fn() }; });

jest.mock('../lib/mailer', function () { return {
  sendVoidFailureAlert: jest.fn().mockResolvedValue()
}; });
jest.mock('../lib/inventory-ledger', function () { return {
  decrementStock: jest.fn().mockResolvedValue()
}; });

jest.mock('../lib/brewpad-integration', function () { return {
  detectKitItems: jest.fn(function (items) {
    return (items || []).filter(function (li) { return /kit/i.test(li.name || ''); });
  }),
  fetchLiveBatchIndex: jest.fn(),
  kitBatchQuantity: jest.fn(function (item) {
    var q = Math.floor(Number(item && item.quantity));
    if (!isFinite(q) || q < 1) return 1;
    return q > 100 ? 100 : q;
  }),
  callAppsScriptCreateBatch: jest.fn(),
  splitCustomerName: jest.fn(function (name) {
    var parts = (name || '').trim().split(/\s+/);
    return { first: parts[0] || '', last: parts.slice(1).join(' ') || '' };
  }),
  syncBatchToZoho: jest.fn().mockResolvedValue({ ok: true }),
  createBatchesFromSale: jest.fn(),
  retryPendingBatches: jest.fn().mockResolvedValue(),
  detectRecipeSale: jest.fn(),
  queueSyncForRetry: jest.fn().mockResolvedValue(),
  retrySyncQueue: jest.fn().mockResolvedValue()
}; });

jest.mock('axios', function () {
  var axiosMock = jest.fn().mockResolvedValue({ data: {} });
  axiosMock.get = jest.fn();
  axiosMock.post = jest.fn().mockResolvedValue({ data: {} });
  return axiosMock;
});

var zohoApi = require('../lib/zoho-api');

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

var brewpadIntegration = require('../lib/brewpad-integration');
var cacheMod = require('../lib/cache');
var log = require('../lib/logger');
var handler = findHandler('get', '/api/batch/link-candidates');

function makeReq(query, headers) {
  return { body: {}, query: query || {}, headers: headers || {} };
}
function makeRes() {
  var res = { _status: null, _json: null, headersSent: false };
  res.status = jest.fn(function (code) { res._status = code; return res; });
  res.json = jest.fn(function (data) { res._json = data; res.headersSent = true; return res; });
  return res;
}
function waitDone(res) {
  return new Promise(function (resolve) {
    var n = 0;
    (function tick() {
      if (res.headersSent || n++ > 200) return resolve();
      setImmediate(tick);
    })();
  });
}
var AUTH = { 'x-api-key': 'test-api-key' };
var START = '2026-08-01';

function day(offset) {
  var t = Date.UTC(2026, 7, 1) + offset * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}
function row(i, offset, extra) {
  return Object.assign({
    invoice_id: 'ID' + i, invoice_number: 'INV-' + (100000 + i).toString().slice(1),
    customer_name: 'Jane Doe', customer_id: '555', date: day(offset),
    total: 100 + i, balance: 0, status: 'paid'
  }, extra || {});
}
var details = {};
var listRows = [];
function setup(rows, detailOverrides) {
  listRows = rows;
  details = {};
  rows.forEach(function (r) {
    details[r.invoice_id] = Object.assign({}, r, { line_items: [{ name: 'Water', quantity: 1, rate: 1 }] });
  });
  Object.keys(detailOverrides || {}).forEach(function (k) {
    details[k] = Object.assign({}, details[k], detailOverrides[k]);
  });
  zohoApi.zohoGet.mockImplementation(function (path) {
    if (path === '/invoices') return Promise.resolve({ invoices: listRows });
    if (typeof path === 'string' && path.indexOf('/invoices/') === 0) {
      var d = details[path.slice('/invoices/'.length)];
      return d ? Promise.resolve({ invoice: d }) : Promise.reject(new Error('no detail'));
    }
    return Promise.reject(new Error('unexpected ' + path));
  });
}
function detailCalls() {
  return zohoApi.zohoGet.mock.calls.filter(function (c) { return c[0] !== '/invoices'; });
}
function run(query) {
  var res = makeRes();
  handler(makeReq(query, AUTH), res);
  return waitDone(res).then(function () { return res; });
}

describe('GET /api/batch/link-candidates', function () {
  beforeEach(function () {
    jest.clearAllMocks();
    Object.keys(_cacheStore).forEach(function (k) { delete _cacheStore[k]; });
    process.env.MW_API_KEY = 'test-api-key';
    brewpadIntegration.fetchLiveBatchIndex.mockResolvedValue({ byInvoiceNumber: {}, liveBatchIds: new Set() });
  });

  test('401 without credential', function () {
    var res = makeRes();
    handler(makeReq({ customer_id: '555', start_date: START }, {}), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(zohoApi.zohoGet).not.toHaveBeenCalled();
  });

  test('400 on bad input', function () {
    return Promise.all([
      run({ customer_id: 'abc', start_date: START }),
      run({ customer_id: '555', start_date: '2026-8-1' }),
      run({ customer_name: new Array(102).join('a'), start_date: START })
    ]).then(function (rs) {
      rs.forEach(function (res) {
        expect(res._status).toBe(400);
        expect(res._json.error).toBe('bad_request');
      });
      expect(zohoApi.zohoGet).not.toHaveBeenCalled();
    });
  });

  test('customer_id path passes object params with window', function () {
    setup([row(1, -3)]);
    return run({ customer_id: '555', start_date: START }).then(function (res) {
      expect(res._status).toBeNull();
      var first = zohoApi.zohoGet.mock.calls[0];
      expect(first[0]).toBe('/invoices');
      expect(first[1]).toEqual(expect.objectContaining({
        customer_id: '555', date_start: day(-60), date_end: day(60), sort_column: 'date', per_page: 200
      }));
      expect(res._json.candidates).toHaveLength(1);
      expect(res._json.candidates[0]).toEqual(expect.objectContaining({
        invoice_number: 'INV-00001', date_distance_days: 3, total: 101, status: 'paid', balance: 0
      }));
      expect(res._json.index_available).toBe(true);
      expect(res._json.inspected_all).toBe(true);
      expect(res._json.uninspected_count).toBe(0);
    });
  });

  test('customer_name path post-filters by normalised exact name', function () {
    setup([row(1, -1, { customer_name: 'Jane Doe' }), row(2, -1, { customer_name: 'Jane Doerr' }), row(3, 1, { customer_name: '  jane  DOE ' })]);
    return run({ customer_name: 'Jane Doe', start_date: START }).then(function (res) {
      expect(zohoApi.zohoGet.mock.calls[0][1].customer_name).toBe('Jane Doe');
      var nums = res._json.candidates.map(function (c) { return c.invoice_number; }).sort();
      expect(nums).toEqual(['INV-00001', 'INV-00003']);
    });
  });

  test('void dropped; overdue and partially_paid kept', function () {
    setup([row(1, 1, { status: 'void' }), row(2, 2, { status: 'overdue' }), row(3, 3, { status: 'partially_paid' })]);
    return run({ customer_id: '555', start_date: START }).then(function (res) {
      var nums = res._json.candidates.map(function (c) { return c.invoice_number; }).sort();
      expect(nums).toEqual(['INV-00002', 'INV-00003']);
    });
  });

  test('13 invoices: 10 sequential detail calls, inspected_all false, uninspected 3', function () {
    var rows = [];
    for (var i = 1; i <= 13; i++) rows.push(row(i, i));
    setup(rows);
    var inflight = 0;
    var maxInflight = 0;
    zohoApi.zohoGet.mockImplementation(function (path) {
      if (path === '/invoices') return Promise.resolve({ invoices: rows });
      inflight++;
      if (inflight > maxInflight) maxInflight = inflight;
      return new Promise(function (resolve) {
        setImmediate(function () { inflight--; resolve({ invoice: details[path.slice('/invoices/'.length)] }); });
      });
    });
    return run({ customer_id: '555', start_date: START }).then(function (res) {
      expect(detailCalls()).toHaveLength(10);
      expect(maxInflight).toBe(1);
      var ids = detailCalls().map(function (c) { return c[0]; });
      expect(ids).not.toContain('/invoices/ID11');
      expect(res._json.inspected_all).toBe(false);
      expect(res._json.uninspected_count).toBe(3);
    });
  });

  test('4 invoices: 4 detail calls, inspected_all true', function () {
    setup([row(1, 1), row(2, 2), row(3, 3), row(4, 4)]);
    return run({ customer_id: '555', start_date: START }).then(function (res) {
      expect(detailCalls()).toHaveLength(4);
      expect(res._json.inspected_all).toBe(true);
      expect(res._json.uninspected_count).toBe(0);
    });
  });

  test('8th-nearest kit invoice ranks first; max 3 candidates', function () {
    var rows = [];
    for (var i = 1; i <= 9; i++) rows.push(row(i, i));
    setup(rows, { ID8: { line_items: [{ name: 'Pinot Kit', quantity: 1, rate: 90 }, { name: "Maker's Fee", quantity: 1, rate: 10 }] } });
    return run({ customer_id: '555', start_date: START }).then(function (res) {
      expect(res._json.candidates).toHaveLength(3);
      expect(res._json.candidates[0].invoice_number).toBe('INV-00008');
      expect(res._json.candidates[0].has_kit_line).toBe(true);
      expect(res._json.candidates[0].line_items[0]).toEqual({ name: 'Pinot Kit', quantity: 1, rate: 90 });
      expect(res._json.candidates[1].invoice_number).toBe('INV-00001');
    });
  });

  test('linked_batches annotated from live index', function () {
    setup([row(1, 1), row(2, 2)]);
    brewpadIntegration.fetchLiveBatchIndex.mockResolvedValue({
      byInvoiceNumber: { 'INV-00001': [{ batch_id: 'SV-B-000063' }, { batch_id: 'SV-B-000064' }] },
      liveBatchIds: new Set()
    });
    return run({ customer_id: '555', start_date: START }).then(function (res) {
      var by = {};
      res._json.candidates.forEach(function (c) { by[c.invoice_number] = c; });
      expect(by['INV-00001'].linked_batches).toEqual(['SV-B-000063', 'SV-B-000064']);
      expect(by['INV-00002'].linked_batches).toEqual([]);
      expect(res._json.index_available).toBe(true);
    });
  });

  test('null index -> linked_batches null, index_available false', function () {
    setup([row(1, 1)]);
    brewpadIntegration.fetchLiveBatchIndex.mockResolvedValue(null);
    return run({ customer_id: '555', start_date: START }).then(function (res) {
      expect(res._json.candidates[0].linked_batches).toBeNull();
      expect(res._json.index_available).toBe(false);
    });
  });

  test('second request hits cache for Zoho but re-reads the index', function () {
    setup([row(1, 1)]);
    return run({ customer_id: '555', start_date: START }).then(function () {
      var zohoCallsAfterFirst = zohoApi.zohoGet.mock.calls.length;
      expect(cacheMod.set).toHaveBeenCalledWith(expect.any(String), expect.anything(), 600);
      brewpadIntegration.fetchLiveBatchIndex.mockResolvedValue({
        byInvoiceNumber: { 'INV-00001': [{ batch_id: 'SV-B-000099' }] }, liveBatchIds: new Set()
      });
      return run({ customer_id: '555', start_date: START }).then(function (res) {
        expect(zohoApi.zohoGet.mock.calls.length).toBe(zohoCallsAfterFirst);
        expect(brewpadIntegration.fetchLiveBatchIndex).toHaveBeenCalledTimes(2);
        expect(res._json.candidates[0].linked_batches).toEqual(['SV-B-000099']);
      });
    });
  });

  test('cache key carries no customer name', function () {
    setup([row(1, 1)]);
    return run({ customer_name: 'Jane Doe', start_date: START }).then(function () {
      var keys = Object.keys(_cacheStore);
      expect(keys).toHaveLength(1);
      expect(keys[0].toLowerCase()).not.toContain('jane');
      expect(keys[0]).toContain(START);
    });
  });

  test('cache errors are treated as a miss', function () {
    setup([row(1, 1)]);
    cacheMod.get.mockRejectedValueOnce(new Error('redis down'));
    cacheMod.set.mockRejectedValueOnce(new Error('redis down'));
    return run({ customer_id: '555', start_date: START }).then(function (res) {
      expect(res._json.candidates).toHaveLength(1);
    });
  });

  test('walk-in / blank customer: 200 no_customer without Zoho', function () {
    return Promise.all([
      run({ customer_name: 'Walk-In', start_date: START }),
      run({ start_date: START })
    ]).then(function (rs) {
      rs.forEach(function (res) {
        expect(res._json).toEqual(expect.objectContaining({ candidates: [], reason: 'no_customer', inspected_all: true, uninspected_count: 0 }));
      });
      expect(zohoApi.zohoGet).not.toHaveBeenCalled();
    });
  });

  test('Zoho list failure -> 502 and no customer name in log', function () {
    zohoApi.zohoGet.mockRejectedValue(new Error('boom'));
    return run({ customer_name: 'Jane Doe', start_date: START }).then(function (res) {
      expect(res._status).toBe(502);
      expect(res._json).toEqual({ error: 'Invoice lookup failed' });
      log.error.mock.calls.forEach(function (c) { expect(String(c[0])).not.toMatch(/jane/i); });
      expect(log.error).toHaveBeenCalled();
    });
  });

  test('read-only: never writes', function () {
    setup([row(1, 1)]);
    return run({ customer_id: '555', start_date: START }).then(function () {
      expect(zohoApi.zohoPut).not.toHaveBeenCalled();
      expect(zohoApi.zohoPost).not.toHaveBeenCalled();
      expect(brewpadIntegration.callAppsScriptCreateBatch).not.toHaveBeenCalled();
    });
  });
});
