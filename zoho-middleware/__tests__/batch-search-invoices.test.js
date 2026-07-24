'use strict';

// ---------------------------------------------------------------------------
// Mocks — must be declared before require()
// Mirrors the mocking style in __tests__/batch-scan-invoices.test.js.
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

jest.mock('../lib/cache', function () { return {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
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
  detectKitItems: jest.fn(),
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

var searchInvoicesHandler = findHandler('get', '/api/batch/search-invoices');

// ---------------------------------------------------------------------------
// Helpers — fake req/res for handler testing
// ---------------------------------------------------------------------------
function makeReq(query, headers) {
  return { body: {}, query: query || {}, headers: headers || {} };
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

var AUTH_HEADERS = { 'x-api-key': 'test-api-key' };

// ---------------------------------------------------------------------------
// Shared invoice fixtures
// ---------------------------------------------------------------------------
function makeListInvoice(overrides) {
  return Object.assign({
    invoice_id: 'INV-ID-001',
    invoice_number: 'INV-000001',
    customer_name: 'Anne MacDougall',
    customer_id: 'CUST-001',
    date: '2026-07-01',
    line_items: [] // list endpoint NEVER returns real line items — this is the bug being fixed
  }, overrides || {});
}

function makeDetailInvoice(overrides) {
  return Object.assign({
    invoice_id: 'INV-ID-001',
    invoice_number: 'INV-000001',
    customer_name: 'Anne MacDougall',
    customer_id: 'CUST-001',
    date: '2026-07-01',
    line_items: [
      { item_id: 'KIT-001', name: 'Cabernet Sauvignon Kit', quantity: 1, rate: 89.99, item_total: 89.99 }
    ]
  }, overrides || {});
}

// A single mock implementation that routes list vs. detail calls by path shape,
// used by most tests below so call order doesn't matter for assertions.
function mockZohoRouting(listInvoices, detailByInvoiceId) {
  zohoApi.zohoGet.mockImplementation(function (arg) {
    if (typeof arg === 'string' && arg.indexOf('/invoices?search_text=') === 0) {
      return Promise.resolve({ invoices: listInvoices });
    }
    if (typeof arg === 'string' && arg.indexOf('/invoices/') === 0) {
      var id = arg.slice('/invoices/'.length);
      var detail = detailByInvoiceId[id];
      if (!detail) return Promise.reject(new Error('no detail mock for ' + id));
      return Promise.resolve({ invoice: detail });
    }
    return Promise.reject(new Error('unexpected zohoGet call: ' + arg));
  });
}

// ---------------------------------------------------------------------------
// GET /api/batch/search-invoices
// ---------------------------------------------------------------------------
describe('GET /api/batch/search-invoices', function () {
  beforeEach(function () {
    jest.clearAllMocks();
    process.env.MW_API_KEY = 'test-api-key';
  });

  // ── real line_items merged (OPS-03 SC#1) ──────────────────────────────────
  test('real line_items merged: response carries detail line_items (name/quantity present), not the empty list-endpoint field', function () {
    var listInvoices = [
      makeListInvoice({ invoice_id: 'INV-ID-001', invoice_number: 'INV-000001' }),
      makeListInvoice({ invoice_id: 'INV-ID-002', invoice_number: 'INV-000002', customer_name: 'Bob Builder' })
    ];
    var detailByInvoiceId = {
      'INV-ID-001': makeDetailInvoice({
        invoice_id: 'INV-ID-001',
        invoice_number: 'INV-000001',
        line_items: [
          { item_id: 'KIT-001', name: 'Cabernet Sauvignon Kit', quantity: 2, rate: 89.99, item_total: 179.98 }
        ]
      }),
      'INV-ID-002': makeDetailInvoice({
        invoice_id: 'INV-ID-002',
        invoice_number: 'INV-000002',
        customer_name: 'Bob Builder',
        line_items: [
          { item_id: 'KIT-002', name: 'Pale Ale Kit', quantity: 1, rate: 64.99, item_total: 64.99 }
        ]
      })
    };
    mockZohoRouting(listInvoices, detailByInvoiceId);

    var req = makeReq({ search: 'MacDougall' }, AUTH_HEADERS);
    var res = makeRes();
    searchInvoicesHandler(req, res);

    return flushPromises().then(function () {
      expect(res._json).toBeTruthy();
      var invoices = res._json.invoices || [];
      expect(invoices.length).toBe(2);

      var inv1 = invoices.filter(function (i) { return i.invoice_number === 'INV-000001'; })[0];
      expect(inv1).toBeTruthy();
      expect(inv1.line_items.length).toBe(1);
      expect(inv1.line_items[0].name).toBe('Cabernet Sauvignon Kit');
      expect(inv1.line_items[0].quantity).toBe(2);

      var inv2 = invoices.filter(function (i) { return i.invoice_number === 'INV-000002'; })[0];
      expect(inv2).toBeTruthy();
      expect(inv2.line_items.length).toBe(1);
      expect(inv2.line_items[0].name).toBe('Pale Ale Kit');
    });
  });

  // ── cap enforced (T-64-01) ─────────────────────────────────────────────────
  test('cap enforced: 15 matched invoices with cap 10 issues at most 10 detail fetches; returned set is well-formed', function () {
    var listInvoices = [];
    var detailByInvoiceId = {};
    for (var i = 0; i < 15; i++) {
      var id = 'INV-ID-' + i;
      listInvoices.push(makeListInvoice({ invoice_id: id, invoice_number: 'INV-0000' + i }));
      detailByInvoiceId[id] = makeDetailInvoice({ invoice_id: id, invoice_number: 'INV-0000' + i });
    }
    mockZohoRouting(listInvoices, detailByInvoiceId);

    var req = makeReq({ search: 'wine' }, AUTH_HEADERS);
    var res = makeRes();
    searchInvoicesHandler(req, res);

    return flushPromises().then(function () {
      var detailCalls = zohoApi.zohoGet.mock.calls.filter(function (c) {
        return typeof c[0] === 'string' && c[0].indexOf('/invoices/') === 0;
      });
      expect(detailCalls.length).toBeLessThanOrEqual(10);
      expect(detailCalls.length).toBeGreaterThan(0);

      expect(res._json).toBeTruthy();
      var invoices = res._json.invoices || [];
      // Well-formed for the returned (capped) set
      invoices.forEach(function (inv) {
        expect(inv.invoice_id).toBeTruthy();
        expect(inv.invoice_number).toBeTruthy();
        expect(Array.isArray(inv.line_items)).toBe(true);
      });
    });
  });

  // ── short query (existing 2-char guard preserved) ─────────────────────────
  test('short query: search shorter than 2 chars returns 400 with zero Zoho calls', function () {
    var req = makeReq({ search: 'a' }, AUTH_HEADERS);
    var res = makeRes();
    searchInvoicesHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(zohoApi.zohoGet).not.toHaveBeenCalled();
  });

  // ── Zoho detail-fetch error path ───────────────────────────────────────────
  // Chosen behavior: a detail-fetch rejection surfaces as 502, matching the
  // existing catch for a list-search failure (pos.js:2284) — no unhandled
  // rejection, no partial/degraded response.
  test('Zoho error: a detail fetch rejecting responds 502 (matches existing list-failure catch)', function () {
    var listInvoices = [
      makeListInvoice({ invoice_id: 'INV-ID-001', invoice_number: 'INV-000001' })
    ];
    zohoApi.zohoGet.mockImplementation(function (arg) {
      if (typeof arg === 'string' && arg.indexOf('/invoices?search_text=') === 0) {
        return Promise.resolve({ invoices: listInvoices });
      }
      if (typeof arg === 'string' && arg.indexOf('/invoices/') === 0) {
        return Promise.reject(new Error('Zoho rate limit'));
      }
      return Promise.reject(new Error('unexpected zohoGet call: ' + arg));
    });

    var req = makeReq({ search: 'MacDougall' }, AUTH_HEADERS);
    var res = makeRes();
    searchInvoicesHandler(req, res);

    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(502);
      expect(res._json.error).toBeTruthy();
    });
  });

  // ── shape unchanged ─────────────────────────────────────────────────────────
  test('shape unchanged: each invoice still exposes invoice_id, invoice_number, customer_name, customer_id, date, line_items', function () {
    var listInvoices = [makeListInvoice({ invoice_id: 'INV-ID-001', invoice_number: 'INV-000001' })];
    var detailByInvoiceId = {
      'INV-ID-001': makeDetailInvoice({ invoice_id: 'INV-ID-001', invoice_number: 'INV-000001' })
    };
    mockZohoRouting(listInvoices, detailByInvoiceId);

    var req = makeReq({ search: 'MacDougall' }, AUTH_HEADERS);
    var res = makeRes();
    searchInvoicesHandler(req, res);

    return flushPromises().then(function () {
      var invoices = res._json.invoices || [];
      expect(invoices.length).toBe(1);
      var inv = invoices[0];
      var keys = Object.keys(inv).sort();
      expect(keys).toEqual(['customer_id', 'customer_name', 'date', 'invoice_id', 'invoice_number', 'line_items'].sort());
    });
  });

  // ── auth preserved ─────────────────────────────────────────────────────────
  test('401 when no credential is present (auth tiers unchanged)', function () {
    var req = makeReq({ search: 'MacDougall' }, {});
    var res = makeRes();
    searchInvoicesHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(zohoApi.zohoGet).not.toHaveBeenCalled();
  });
});
