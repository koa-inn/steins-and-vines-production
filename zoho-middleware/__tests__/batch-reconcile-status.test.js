'use strict';

// ---------------------------------------------------------------------------
// Mocks — must be declared before require()
// Mirrors the mocking style in __tests__/batch-scan-invoices.test.js /
// batch-search-invoices.test.js. brewpad-integration is DELIBERATELY NOT
// mocked here — it is the module under test (the reconcile core), so both
// the direct-core tests and the route tests exercise the real implementation
// against mocked zoho-api + Apps Script axios.get.
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

jest.mock('axios', function () {
  var axiosMock = jest.fn().mockResolvedValue({ data: {} });
  axiosMock.get = jest.fn();
  axiosMock.post = jest.fn().mockResolvedValue({ data: {} });
  return axiosMock;
});

var zohoApi = require('../lib/zoho-api');
var axios = require('axios');
var eventLog = require('../lib/eventLog');
var brewpadIntegration = require('../lib/brewpad-integration');

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

var reconcileInvoiceHandler = findHandler('post', '/api/batch/reconcile-invoice-status');
var reconcileStaleHandler = findHandler('post', '/api/batch/reconcile-stale-batch-status');

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

var AUTH_HEADERS = { 'x-api-key': 'test-api-key' };

// Wires axios.get('get_batches') to a fixed batch list for the reconcile helpers.
function mockLiveBatches(batches) {
  axios.get.mockImplementation(function (url, opts) {
    var params = (opts && opts.params) || {};
    if (params.action === 'get_batches') {
      return Promise.resolve({ data: { ok: true, data: { batches: batches } } });
    }
    return Promise.reject(new Error('unexpected axios.get: ' + params.action));
  });
}

beforeEach(function () {
  jest.clearAllMocks();
  process.env.MW_API_KEY = 'test-api-key';
  process.env.ZOHO_CF_BATCH_STATUS = 'cf_batch_status';
  process.env.APPS_SCRIPT_URL = 'https://script.google.com/fake';
  process.env.APPS_SCRIPT_SERVER_TOKEN = 'fake-server-token';
});

afterEach(function () {
  delete process.env.ZOHO_CF_BATCH_STATUS;
  delete process.env.APPS_SCRIPT_URL;
  delete process.env.APPS_SCRIPT_SERVER_TOKEN;
});

// ---------------------------------------------------------------------------
// Core: reconcileInvoiceBatchStatus (direct, unmocked)
// ---------------------------------------------------------------------------
describe('reconcileInvoiceBatchStatus (core)', function () {
  // ── Test 1: 0 remaining -> CLEAR (the INV-000151 bug) ─────────────────────
  test('0 live batches for the invoice: clears cf_batch_status via zohoPut', function () {
    zohoApi.zohoPut.mockResolvedValue({});
    var invoice = { invoice_id: 'INV-ID-151', invoice_number: 'INV-000151', cf_batch_status: 'Pending — SV-B-000185' };
    var liveBatchIndex = { byInvoiceNumber: {}, liveBatchIds: new Set() }; // batch was deleted — no entry

    return brewpadIntegration.reconcileInvoiceBatchStatus(invoice, liveBatchIndex).then(function (result) {
      expect(result.action).toBe('cleared');
      expect(result.ok).toBe(true);
      expect(zohoApi.zohoPut).toHaveBeenCalledWith(
        '/invoices/INV-ID-151',
        { custom_fields: [{ api_name: 'cf_batch_status', value: '' }] }
      );
    });
  });

  // ── Test 2: >=1 remaining, stale count-form label -> re-sync ──────────────
  test('2 live batches, stale count-form label ("— 1 batch"): re-syncs to count 2', function () {
    zohoApi.zohoPut.mockResolvedValue({});
    var invoice = { invoice_id: 'INV-ID-200', invoice_number: 'INV-000200', cf_batch_status: 'Pending — 1 batch' };
    var liveBatchIndex = {
      byInvoiceNumber: {
        'INV-000200': [
          { batch_id: 'SV-B-000300', zoho_so_number: 'INV-000200', status: 'pending' },
          { batch_id: 'SV-B-000301', zoho_so_number: 'INV-000200', status: 'pending' }
        ]
      },
      liveBatchIds: new Set(['SV-B-000300', 'SV-B-000301'])
    };

    return brewpadIntegration.reconcileInvoiceBatchStatus(invoice, liveBatchIndex).then(function (result) {
      expect(result.action).toBe('resynced');
      expect(result.ok).toBe(true);
      expect(zohoApi.zohoPut).toHaveBeenCalledWith(
        '/invoices/INV-ID-200',
        { custom_fields: [{ api_name: 'cf_batch_status', value: 'Pending — 2 batches' }] }
      );
    });
  });

  // ── Test 3: current label already correct -> NO write ─────────────────────
  test('cf_batch_status already names a batch that IS in the live set: no write (idempotent)', function () {
    zohoApi.zohoPut.mockResolvedValue({});
    var invoice = { invoice_id: 'INV-ID-400', invoice_number: 'INV-000400', cf_batch_status: 'Active — SV-B-000500' };
    var liveBatchIndex = {
      byInvoiceNumber: {
        'INV-000400': [
          { batch_id: 'SV-B-000500', zoho_so_number: 'INV-000400', status: 'primary' }
        ]
      },
      liveBatchIds: new Set(['SV-B-000500'])
    };

    return brewpadIntegration.reconcileInvoiceBatchStatus(invoice, liveBatchIndex).then(function (result) {
      expect(result.action).toBe('unchanged');
      expect(result.ok).toBe(true);
      expect(zohoApi.zohoPut).not.toHaveBeenCalled();
    });
  });

  // ── dry-run never writes ───────────────────────────────────────────────────
  test('dryRun:true never calls zohoPut, even for a clear-worthy invoice', function () {
    zohoApi.zohoPut.mockResolvedValue({});
    var invoice = { invoice_id: 'INV-ID-151', invoice_number: 'INV-000151', cf_batch_status: 'Pending — SV-B-000185' };
    var liveBatchIndex = { byInvoiceNumber: {}, liveBatchIds: new Set() };

    return brewpadIntegration.reconcileInvoiceBatchStatus(invoice, liveBatchIndex, { dryRun: true }).then(function (result) {
      expect(result.action).toBe('would_clear');
      expect(zohoApi.zohoPut).not.toHaveBeenCalled();
    });
  });

  // ── already-empty label + 0 remaining -> unchanged (no spurious write) ────
  test('already-empty cf_batch_status with 0 live batches: unchanged, no write', function () {
    zohoApi.zohoPut.mockResolvedValue({});
    var invoice = { invoice_id: 'INV-ID-999', invoice_number: 'INV-000999', cf_batch_status: '' };
    var liveBatchIndex = { byInvoiceNumber: {}, liveBatchIds: new Set() };

    return brewpadIntegration.reconcileInvoiceBatchStatus(invoice, liveBatchIndex).then(function (result) {
      expect(result.action).toBe('unchanged');
      expect(zohoApi.zohoPut).not.toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// Route: POST /api/batch/reconcile-invoice-status (delete-hook)
// ---------------------------------------------------------------------------
describe('POST /api/batch/reconcile-invoice-status', function () {
  test('resolves the invoice and reconciles it: 0 live batches -> cleared', function () {
    zohoApi.zohoGet.mockImplementation(function (path, params) {
      if (path === '/invoices' && params && params.invoice_number === 'INV-000151') {
        return Promise.resolve({
          invoices: [{
            invoice_id: 'INV-ID-151',
            invoice_number: 'INV-000151',
            custom_fields: [{ api_name: 'cf_batch_status', value: 'Pending — SV-B-000185' }]
          }]
        });
      }
      return Promise.reject(new Error('unexpected zohoGet: ' + path));
    });
    zohoApi.zohoPut.mockResolvedValue({});
    mockLiveBatches([]); // the batch no longer exists (deleted)

    var req = makeReq({ zoho_so_number: 'INV-000151' }, {}, AUTH_HEADERS);
    var res = makeRes();
    reconcileInvoiceHandler(req, res);

    return flushPromises().then(function () {
      expect(res._json).toBeTruthy();
      expect(res._json.ok).toBe(true);
      expect(res._json.action).toBe('cleared');
      expect(zohoApi.zohoPut).toHaveBeenCalledWith(
        '/invoices/INV-ID-151',
        { custom_fields: [{ api_name: 'cf_batch_status', value: '' }] }
      );
    });
  });

  test('resolves the invoice and reconciles it: 1 live batch, stale label -> resynced', function () {
    zohoApi.zohoGet.mockImplementation(function (path, params) {
      if (path === '/invoices' && params && params.invoice_number === 'INV-000201') {
        return Promise.resolve({
          invoices: [{
            invoice_id: 'INV-ID-201',
            invoice_number: 'INV-000201',
            custom_fields: [{ api_name: 'cf_batch_status', value: 'Pending — SV-B-000900' }]
          }]
        });
      }
      return Promise.reject(new Error('unexpected zohoGet: ' + path));
    });
    zohoApi.zohoPut.mockResolvedValue({});
    mockLiveBatches([
      { batch_id: 'SV-B-000901', zoho_so_number: 'INV-000201', status: 'primary' }
    ]);

    var req = makeReq({ zoho_so_number: 'inv-000201' }, {}, AUTH_HEADERS); // lowercase input
    var res = makeRes();
    reconcileInvoiceHandler(req, res);

    return flushPromises().then(function () {
      expect(res._json.action).toBe('resynced');
      expect(zohoApi.zohoPut).toHaveBeenCalledWith(
        '/invoices/INV-ID-201',
        { custom_fields: [{ api_name: 'cf_batch_status', value: 'Active — SV-B-000901' }] }
      );
    });
  });

  test('live-ref invoice untouched: cf_batch_status already correct -> unchanged, no write', function () {
    zohoApi.zohoGet.mockImplementation(function (path, params) {
      if (path === '/invoices' && params && params.invoice_number === 'INV-000300') {
        return Promise.resolve({
          invoices: [{
            invoice_id: 'INV-ID-300',
            invoice_number: 'INV-000300',
            custom_fields: [{ api_name: 'cf_batch_status', value: 'Active — SV-B-000400' }]
          }]
        });
      }
      return Promise.reject(new Error('unexpected zohoGet: ' + path));
    });
    zohoApi.zohoPut.mockResolvedValue({});
    mockLiveBatches([
      { batch_id: 'SV-B-000400', zoho_so_number: 'INV-000300', status: 'primary' }
    ]);

    var req = makeReq({ zoho_so_number: 'INV-000300' }, {}, AUTH_HEADERS);
    var res = makeRes();
    reconcileInvoiceHandler(req, res);

    return flushPromises().then(function () {
      expect(res._json.action).toBe('unchanged');
      expect(zohoApi.zohoPut).not.toHaveBeenCalled();
    });
  });

  test('bad zoho_so_number format: 400, no Zoho calls', function () {
    var req = makeReq({ zoho_so_number: 'not-an-invoice' }, {}, AUTH_HEADERS);
    var res = makeRes();
    reconcileInvoiceHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(zohoApi.zohoGet).not.toHaveBeenCalled();
    expect(zohoApi.zohoPut).not.toHaveBeenCalled();
  });

  test('invoice not found: 404', function () {
    zohoApi.zohoGet.mockResolvedValue({ invoices: [] });
    mockLiveBatches([]);

    var req = makeReq({ zoho_so_number: 'INV-000999' }, {}, AUTH_HEADERS);
    var res = makeRes();
    reconcileInvoiceHandler(req, res);

    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  test('401 when no credential is present (auth tiers unchanged)', function () {
    var req = makeReq({ zoho_so_number: 'INV-000151' }, {}, {});
    var res = makeRes();
    reconcileInvoiceHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(zohoApi.zohoGet).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Route: POST /api/batch/reconcile-stale-batch-status (bounded scan/cleanup)
// ---------------------------------------------------------------------------
describe('POST /api/batch/reconcile-stale-batch-status', function () {
  function mockInvoicePage(invoices) {
    zohoApi.zohoGet.mockImplementation(function (path, params) {
      if (path === '/invoices') {
        if (params && params.page > 1) {
          return Promise.resolve({ invoices: [], page_context: { has_more_page: false } });
        }
        return Promise.resolve({ invoices: invoices, page_context: { has_more_page: false } });
      }
      return Promise.reject(new Error('unexpected zohoGet: ' + path));
    });
  }

  test('dry-run: reports the known stale ref (INV-000151 class) WITHOUT calling zohoPut', function () {
    mockInvoicePage([
      {
        invoice_id: 'INV-ID-151',
        invoice_number: 'INV-000151',
        custom_fields: [{ api_name: 'cf_batch_status', value: 'Pending — SV-B-000185' }]
      },
      {
        invoice_id: 'INV-ID-400',
        invoice_number: 'INV-000400',
        custom_fields: [{ api_name: 'cf_batch_status', value: 'Active — SV-B-000500' }]
      }
    ]);
    mockLiveBatches([
      // INV-000151's batch is gone; INV-000400's batch is still live and matches its label.
      { batch_id: 'SV-B-000500', zoho_so_number: 'INV-000400', status: 'primary' }
    ]);

    var req = makeReq({ dry_run: true }, {}, AUTH_HEADERS);
    var res = makeRes();
    reconcileStaleHandler(req, res);

    return flushPromises().then(function () {
      expect(res._json.dry_run).toBe(true);
      expect(zohoApi.zohoPut).not.toHaveBeenCalled();
      var changes = res._json.changes || [];
      var stale = changes.filter(function (c) { return c.invoice_number === 'INV-000151'; });
      expect(stale.length).toBe(1);
      expect(stale[0].action).toBe('would_clear');
      // Live-ref invoice must NOT appear in the changes report.
      var untouched = changes.filter(function (c) { return c.invoice_number === 'INV-000400'; });
      expect(untouched.length).toBe(0);
    });
  });

  test('apply (dry_run:false): performs the writes and reports what changed', function () {
    mockInvoicePage([
      {
        invoice_id: 'INV-ID-151',
        invoice_number: 'INV-000151',
        custom_fields: [{ api_name: 'cf_batch_status', value: 'Pending — SV-B-000185' }]
      }
    ]);
    mockLiveBatches([]);
    zohoApi.zohoPut.mockResolvedValue({});

    var req = makeReq({ dry_run: false }, {}, AUTH_HEADERS);
    var res = makeRes();
    reconcileStaleHandler(req, res);

    return flushPromises().then(function () {
      expect(zohoApi.zohoPut).toHaveBeenCalledWith(
        '/invoices/INV-ID-151',
        { custom_fields: [{ api_name: 'cf_batch_status', value: '' }] }
      );
      var changes = res._json.changes || [];
      expect(changes.length).toBe(1);
      expect(changes[0].action).toBe('cleared');
    });
  });

  test('defaults to dry_run:true when the flag is omitted', function () {
    mockInvoicePage([
      {
        invoice_id: 'INV-ID-151',
        invoice_number: 'INV-000151',
        custom_fields: [{ api_name: 'cf_batch_status', value: 'Pending — SV-B-000185' }]
      }
    ]);
    mockLiveBatches([]);

    var req = makeReq({}, {}, AUTH_HEADERS);
    var res = makeRes();
    reconcileStaleHandler(req, res);

    return flushPromises().then(function () {
      expect(res._json.dry_run).toBe(true);
      expect(zohoApi.zohoPut).not.toHaveBeenCalled();
    });
  });

  test('invoice with no cf_batch_status set is skipped entirely (not a candidate)', function () {
    mockInvoicePage([
      { invoice_id: 'INV-ID-800', invoice_number: 'INV-000800', custom_fields: [] }
    ]);
    mockLiveBatches([]);

    var req = makeReq({ dry_run: true }, {}, AUTH_HEADERS);
    var res = makeRes();
    reconcileStaleHandler(req, res);

    return flushPromises().then(function () {
      expect(res._json.scanned).toBe(0);
      expect(res._json.changes.length).toBe(0);
    });
  });

  test('live-ref invoice is never wrongly altered, even with dry_run:false', function () {
    mockInvoicePage([
      {
        invoice_id: 'INV-ID-400',
        invoice_number: 'INV-000400',
        custom_fields: [{ api_name: 'cf_batch_status', value: 'Active — SV-B-000500' }]
      }
    ]);
    mockLiveBatches([
      { batch_id: 'SV-B-000500', zoho_so_number: 'INV-000400', status: 'primary' }
    ]);
    zohoApi.zohoPut.mockResolvedValue({});

    var req = makeReq({ dry_run: false }, {}, AUTH_HEADERS);
    var res = makeRes();
    reconcileStaleHandler(req, res);

    return flushPromises().then(function () {
      expect(zohoApi.zohoPut).not.toHaveBeenCalled();
      expect(res._json.changes.length).toBe(0);
    });
  });

  test('batches_unavailable (Apps Script unreachable): 502, no Zoho invoice paging, no writes', function () {
    axios.get.mockImplementation(function () {
      return Promise.reject(new Error('Apps Script down'));
    });

    var req = makeReq({ dry_run: true }, {}, AUTH_HEADERS);
    var res = makeRes();
    reconcileStaleHandler(req, res);

    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(502);
      expect(zohoApi.zohoGet).not.toHaveBeenCalled();
      expect(zohoApi.zohoPut).not.toHaveBeenCalled();
    });
  });

  test('401 when no credential is present (auth tiers unchanged)', function () {
    var req = makeReq({ dry_run: true }, {}, {});
    var res = makeRes();
    reconcileStaleHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(zohoApi.zohoGet).not.toHaveBeenCalled();
  });

  test('logs an eventLog entry summarizing the scan', function () {
    mockInvoicePage([]);
    mockLiveBatches([]);

    var req = makeReq({ dry_run: true }, {}, AUTH_HEADERS);
    var res = makeRes();
    reconcileStaleHandler(req, res);

    return flushPromises().then(function () {
      expect(eventLog.logEvent).toHaveBeenCalledWith('batch.reconcile_stale_scan', expect.objectContaining({
        dryRun: true
      }));
    });
  });
});
