'use strict';

// ---------------------------------------------------------------------------
// Mocks — must be declared before require()
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
var brewpadIntegration = require('../lib/brewpad-integration');
var axios = require('axios');

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

var scanInvoicesHandler = findHandler('get', '/api/batch/scan-invoices');
var bulkCreateHandler   = findHandler('post', '/api/batch/bulk-create');

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
// Shared invoice fixtures
// ---------------------------------------------------------------------------
function makeListInvoice(overrides) {
  return Object.assign({
    invoice_id: 'INV-ID-001',
    invoice_number: 'INV-000001',
    customer_name: 'Anne MacDougall',
    customer_id: 'CUST-001',
    status: 'paid',
    custom_fields: []
  }, overrides || {});
}

function makeDetailInvoice(overrides) {
  return Object.assign({
    invoice_id: 'INV-ID-001',
    invoice_number: 'INV-000001',
    customer_name: 'Anne MacDougall',
    customer_id: 'CUST-001',
    status: 'paid',
    line_items: [
      { item_id: 'KIT-001', sku: 'WINE-KIT-CAB', name: 'Cabernet Sauvignon Kit' },
      { item_id: 'FEE-001', sku: 'MAKERS-FEE', name: "Maker's Fee" }
    ]
  }, overrides || {});
}

// ---------------------------------------------------------------------------
// GET /api/batch/scan-invoices
// ---------------------------------------------------------------------------
describe('GET /api/batch/scan-invoices', function () {
  beforeEach(function () {
    jest.clearAllMocks();
    process.env.MW_API_KEY = 'test-api-key';
    process.env.APPS_SCRIPT_URL = 'https://script.google.com/test';
    process.env.APPS_SCRIPT_SERVER_TOKEN = 'test-server-token-abc';
    process.env.ZOHO_CF_BATCH_STATUS = 'cf_batch_status';

    // Default: get_batches returns empty set
    axios.get.mockResolvedValue({ data: { ok: true, data: { batches: [], total: 0, filtered: 0 } } });
  });

  // ── 401-auth ──────────────────────────────────────────────────────────────
  test('401 when x-api-key header is absent', function () {
    var req = makeReq(null, {}, {});
    var res = makeRes();
    scanInvoicesHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res._json.error).toBe('Unauthorized');
    expect(zohoApi.zohoGet).not.toHaveBeenCalled();
  });

  test('401 when x-api-key is wrong', function () {
    var req = makeReq(null, {}, { 'x-api-key': 'wrong-key' });
    var res = makeRes();
    scanInvoicesHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res._json.error).toBe('Unauthorized');
    expect(zohoApi.zohoGet).not.toHaveBeenCalled();
  });

  // ── date-window page cap (D-01) ───────────────────────────────────────────
  test('date-window mode hard-caps pages: zohoGet called at most 4 times for paginated list', function () {
    // Each page returns 50 invoices (full page) to trigger pagination
    var fullPage = [];
    for (var i = 0; i < 50; i++) {
      fullPage.push(makeListInvoice({
        invoice_id: 'INV-ID-' + i,
        invoice_number: 'INV-0000' + i,
        status: 'paid'
      }));
    }

    // Return full pages indefinitely — cap must stop the loop
    zohoApi.zohoGet.mockResolvedValue({ invoices: fullPage, page_context: { has_more_page: true } });

    // Detail fetch: every invoice has no Maker's Fee
    brewpadIntegration.detectKitItems.mockReturnValue([]);

    var req = makeReq(null, {}, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    scanInvoicesHandler(req, res);

    return flushPromises().then(function () {
      // Must have called zohoGet for listing, capped at MAX_PAGES (4) per spec
      var listCalls = zohoApi.zohoGet.mock.calls.filter(function (c) {
        return c[0] === '/invoices';
      });
      expect(listCalls.length).toBeLessThanOrEqual(4);
      expect(listCalls.length).toBeGreaterThan(0);
    });
  });

  // ── cf_batch_status skip (D-02) ───────────────────────────────────────────
  test('cf skip: invoice with cf_batch_status already set is NOT detail-fetched', function () {
    var skippedInvoice = makeListInvoice({
      invoice_id: 'INV-ID-SKIP',
      invoice_number: 'INV-000999',
      custom_fields: [
        { api_name: 'cf_batch_status', value: 'Pending — SV-B-000001' }
      ]
    });

    // Only one page, no more pages
    zohoApi.zohoGet.mockResolvedValue({ invoices: [skippedInvoice], page_context: { has_more_page: false } });

    var req = makeReq(null, {}, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    scanInvoicesHandler(req, res);

    return flushPromises().then(function () {
      // No detail fetch for the skipped invoice
      var detailCalls = zohoApi.zohoGet.mock.calls.filter(function (c) {
        return c[0] === '/invoices/INV-ID-SKIP';
      });
      expect(detailCalls.length).toBe(0);
    });
  });

  // ── void exclusion + draft inclusion (D-04/D-05) ─────────────────────────
  test('void invoice is excluded from candidates; draft invoice with Maker\'s Fee is a candidate with status "draft"', function () {
    var voidInvoice = makeListInvoice({ invoice_id: 'INV-VOID', invoice_number: 'INV-000100', status: 'void' });
    var draftInvoice = makeListInvoice({ invoice_id: 'INV-DRAFT', invoice_number: 'INV-000101', status: 'draft' });

    zohoApi.zohoGet
      .mockResolvedValueOnce({ invoices: [voidInvoice, draftInvoice], page_context: { has_more_page: false } })
      .mockResolvedValueOnce({ invoice: makeDetailInvoice({
        invoice_id: 'INV-DRAFT',
        invoice_number: 'INV-000101',
        status: 'draft'
      }) });

    // Draft has Maker's Fee -> kit items returned
    brewpadIntegration.detectKitItems.mockReturnValue([
      { item_id: 'KIT-001', sku: 'WINE-KIT-CAB', name: 'Cabernet Sauvignon Kit' }
    ]);

    var req = makeReq(null, {}, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    scanInvoicesHandler(req, res);

    return flushPromises().then(function () {
      expect(res._json).toBeTruthy();
      var candidates = res._json.candidates || [];
      // Void is excluded
      var voidCand = candidates.filter(function (c) { return c.invoice_number === 'INV-000100'; });
      expect(voidCand.length).toBe(0);
      // Draft with Maker's Fee is included
      var draftCand = candidates.filter(function (c) { return c.invoice_number === 'INV-000101'; });
      expect(draftCand.length).toBe(1);
      expect(draftCand[0].status).toBe('draft');
    });
  });

  // ── dedup pre-check uses server_token NOT token (regression guard for auth-param bug) ──
  test('dedup pre-check sends server_token param (not token) to Apps Script get_batches', function () {
    // Single invoice on one page, no more pages
    zohoApi.zohoGet
      .mockResolvedValueOnce({ invoices: [makeListInvoice()], page_context: { has_more_page: false } })
      .mockResolvedValueOnce({ invoice: makeDetailInvoice() });

    brewpadIntegration.detectKitItems.mockReturnValue([
      { sku: 'WINE-KIT-CAB', name: 'Cabernet Sauvignon Kit' }
    ]);

    var req = makeReq(null, {}, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    scanInvoicesHandler(req, res);

    return flushPromises().then(function () {
      // Must have called axios.get for get_batches
      expect(axios.get).toHaveBeenCalled();
      var axiosCall = axios.get.mock.calls[0];
      var callParams = axiosCall[1] && axiosCall[1].params;
      expect(callParams).toBeTruthy();
      // Must use server_token (not token) — Apps Script reads e.parameter.server_token
      // e.parameter.token is validated as Google OAuth token and WILL fail for server tokens
      expect(callParams.server_token).toBe('test-server-token-abc');
      expect(callParams.token).toBeUndefined();
    });
  });

  // ── dedup pre-check (D-10.1): already-batched invoices filtered out ───────
  test('dedup: invoice whose number is in get_batches zoho_so_number set is filtered out', function () {
    var alreadyBatchedInvoice = makeListInvoice({
      invoice_id: 'INV-ID-DUP',
      invoice_number: 'INV-000050'
    });

    axios.get.mockResolvedValue({
      data: {
        ok: true,
        data: {
          batches: [{ zoho_so_number: 'INV-000050', batch_id: 'SV-B-000001' }],
          total: 1,
          filtered: 1
        }
      }
    });

    zohoApi.zohoGet.mockResolvedValueOnce({ invoices: [alreadyBatchedInvoice], page_context: { has_more_page: false } });

    var req = makeReq(null, {}, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    scanInvoicesHandler(req, res);

    return flushPromises().then(function () {
      // Invoice detail should NOT have been fetched (filtered by dedup)
      var detailCalls = zohoApi.zohoGet.mock.calls.filter(function (c) {
        return c[0] === '/invoices/INV-ID-DUP';
      });
      expect(detailCalls.length).toBe(0);
      // Candidates should be empty
      expect(res._json.candidates).toEqual([]);
    });
  });

  // ── dedup graceful degradation: unauthorized response ────────────────────
  // D-10.1 backstop: when get_batches fails, dedup set is treated as empty and
  // scan still returns candidates. The Apps Script idempotency guard (D-10.2, plan 29.3-02)
  // is the backstop that prevents duplicate batches when dedup degrades.
  test('dedup graceful degradation: get_batches unauthorized response — scan still returns 200 candidates', function () {
    axios.get.mockResolvedValue({ data: { ok: false, error: 'unauthorized' } });

    zohoApi.zohoGet
      .mockResolvedValueOnce({ invoices: [makeListInvoice()], page_context: { has_more_page: false } })
      .mockResolvedValueOnce({ invoice: makeDetailInvoice() });

    brewpadIntegration.detectKitItems.mockReturnValue([
      { sku: 'WINE-KIT-CAB', name: 'Cabernet Sauvignon Kit' }
    ]);

    var req = makeReq(null, {}, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    scanInvoicesHandler(req, res);

    return flushPromises().then(function () {
      // Scan must not throw — still returns 200 with candidates (empty dedup set)
      expect(res._status).toBeNull(); // implicit 200
      expect(res._json.candidates).toBeDefined();
      expect(res._json.candidates.length).toBeGreaterThan(0);
    });
  });

  // ── dedup graceful degradation: network error (rejection path) ───────────
  test('dedup graceful degradation: get_batches network error — scan still returns 200 candidates', function () {
    axios.get.mockRejectedValue(new Error('Network timeout'));

    zohoApi.zohoGet
      .mockResolvedValueOnce({ invoices: [makeListInvoice()], page_context: { has_more_page: false } })
      .mockResolvedValueOnce({ invoice: makeDetailInvoice() });

    brewpadIntegration.detectKitItems.mockReturnValue([
      { sku: 'WINE-KIT-CAB', name: 'Cabernet Sauvignon Kit' }
    ]);

    var req = makeReq(null, {}, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    scanInvoicesHandler(req, res);

    return flushPromises().then(function () {
      // Scan must not throw — still returns 200 with candidates
      expect(res._status).toBeNull(); // implicit 200
      expect(res._json.candidates).toBeDefined();
      expect(res._json.candidates.length).toBeGreaterThan(0);
    });
  });

  // ── single-invoice mode (D-09) ────────────────────────────────────────────
  test('single-invoice mode: ?number=INV-000123 bypasses date window and returns single-element candidates array', function () {
    // Single invoice mode: no list call (or a targeted single call), just detail fetch
    zohoApi.zohoGet.mockResolvedValue({ invoice: makeDetailInvoice({
      invoice_id: 'INV-ID-123',
      invoice_number: 'INV-000123'
    }) });

    brewpadIntegration.detectKitItems.mockReturnValue([
      { sku: 'WINE-KIT-CAB', name: 'Cabernet Sauvignon Kit' }
    ]);

    var req = makeReq(null, { number: 'INV-000123' }, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    scanInvoicesHandler(req, res);

    return flushPromises().then(function () {
      expect(res._json.candidates).toBeDefined();
      expect(res._json.candidates.length).toBe(1);
      expect(res._json.candidates[0].invoice_number).toBe('INV-000123');
    });
  });

  test('single-invoice mode: no Maker\'s Fee => empty candidates array', function () {
    zohoApi.zohoGet.mockResolvedValue({ invoice: makeDetailInvoice({
      invoice_id: 'INV-ID-123',
      invoice_number: 'INV-000123',
      line_items: [
        { item_id: 'ITEM-001', sku: 'SOME-PRODUCT', name: 'Some Product' }
      ]
    }) });

    brewpadIntegration.detectKitItems.mockReturnValue([]); // No Maker's Fee

    var req = makeReq(null, { number: 'INV-000123' }, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    scanInvoicesHandler(req, res);

    return flushPromises().then(function () {
      expect(res._json.candidates).toBeDefined();
      expect(res._json.candidates.length).toBe(0);
    });
  });

  // ── one failing detail-fetch does NOT abort the scan ─────────────────────
  test('one detail-fetch rejecting does not abort scan — other candidates still returned', function () {
    var inv1 = makeListInvoice({ invoice_id: 'INV-ID-FAIL', invoice_number: 'INV-000010' });
    var inv2 = makeListInvoice({ invoice_id: 'INV-ID-OK', invoice_number: 'INV-000011' });

    zohoApi.zohoGet
      .mockResolvedValueOnce({ invoices: [inv1, inv2], page_context: { has_more_page: false } })
      .mockRejectedValueOnce(new Error('Zoho rate limit')) // first detail fetch fails
      .mockResolvedValueOnce({ invoice: makeDetailInvoice({ invoice_id: 'INV-ID-OK', invoice_number: 'INV-000011' }) });

    brewpadIntegration.detectKitItems.mockReturnValue([
      { sku: 'WINE-KIT-CAB', name: 'Cabernet Sauvignon Kit' }
    ]);

    var req = makeReq(null, {}, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    scanInvoicesHandler(req, res);

    return flushPromises().then(function () {
      // Should still get 200 with the second invoice
      expect(res._status).toBeNull(); // implicit 200
      expect(res._json.candidates).toBeDefined();
      var okCand = res._json.candidates.filter(function (c) {
        return c.invoice_number === 'INV-000011';
      });
      expect(okCand.length).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------
// POST /api/batch/bulk-create
// ---------------------------------------------------------------------------
describe('POST /api/batch/bulk-create', function () {
  beforeEach(function () {
    jest.clearAllMocks();
    process.env.MW_API_KEY = 'test-api-key';
    process.env.APPS_SCRIPT_URL = 'https://script.google.com/test';
    process.env.APPS_SCRIPT_SERVER_TOKEN = 'test-server-token-abc';
    process.env.ZOHO_CF_BATCH_STATUS = 'cf_batch_status';
  });

  // ── 401 ───────────────────────────────────────────────────────────────────
  test('401 when x-api-key header is absent', function () {
    var req = makeReq({ invoice_ids: ['INV-ID-001'] }, {}, {});
    var res = makeRes();
    bulkCreateHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res._json.error).toBe('Unauthorized');
  });

  // ── 400 bad request ───────────────────────────────────────────────────────
  test('400 bad_request when invoice_ids is missing or empty', function () {
    var req = makeReq({}, {}, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    bulkCreateHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res._json.error).toBe('bad_request');
  });

  test('400 bad_request when invoice_ids is empty array', function () {
    var req = makeReq({ invoice_ids: [] }, {}, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    bulkCreateHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res._json.error).toBe('bad_request');
  });

  // ── server-authoritative (D-06): re-resolves from Zoho, ignores client batch fields ──
  test('server-authoritative: re-detail-fetches invoice and calls callAppsScriptCreateBatch with server-built payload including source:zoho_scan', function () {
    zohoApi.zohoGet.mockResolvedValue({ invoice: makeDetailInvoice() });

    brewpadIntegration.detectKitItems.mockReturnValue([
      { item_id: 'KIT-001', sku: 'WINE-KIT-CAB', name: 'Cabernet Sauvignon Kit' }
    ]);

    brewpadIntegration.callAppsScriptCreateBatch.mockResolvedValue({ ok: true, batch_id: 'SV-B-000001' });

    // Client supplies only invoice_ids — no product/customer data (D-06)
    var req = makeReq(
      {
        invoice_ids: ['INV-ID-001'],
        // These client-supplied fields must NOT be used:
        product_name: 'FAKE PRODUCT',
        customer_name: 'FAKE CUSTOMER'
      },
      {},
      { 'x-api-key': 'test-api-key' }
    );
    var res = makeRes();
    bulkCreateHandler(req, res);

    return flushPromises().then(function () {
      // Must have re-fetched from Zoho (not used client data)
      expect(zohoApi.zohoGet).toHaveBeenCalledWith('/invoices/INV-ID-001');

      // callAppsScriptCreateBatch must be called with server-built payload
      expect(brewpadIntegration.callAppsScriptCreateBatch).toHaveBeenCalled();
      var createCall = brewpadIntegration.callAppsScriptCreateBatch.mock.calls[0][0];

      // source must be zoho_scan (not kiosk)
      expect(createCall.source).toBe('zoho_scan');
      // zoho_so_number from invoice (server-resolved), not from client
      expect(createCall.zoho_so_number).toBe('INV-000001');
      // customer_name from Zoho invoice, not fake client value
      expect(createCall.customer_name).toBe('Anne MacDougall');
      // Must NOT have customer_email (no PII per D-06/T-29.3-06)
      expect(createCall.customer_email).toBeUndefined();
    });
  });

  // ── per-kit-item loop (D-07/D-08): 2 kit items => 2 callAppsScriptCreateBatch calls ──
  test('per-kit-item loop: invoice with 2 kit items results in callAppsScriptCreateBatch called twice', function () {
    zohoApi.zohoGet.mockResolvedValue({
      invoice: makeDetailInvoice({
        line_items: [
          { item_id: 'KIT-001', sku: 'WINE-KIT-CAB', name: 'Cabernet Sauvignon Kit' },
          { item_id: 'KIT-002', sku: 'BEER-KIT-ALE', name: 'Pale Ale Kit' },
          { item_id: 'FEE-001', sku: 'MAKERS-FEE', name: "Maker's Fee" }
        ]
      })
    });

    // detectKitItems returns 2 kit items (excludes Maker's Fee)
    brewpadIntegration.detectKitItems.mockReturnValue([
      { item_id: 'KIT-001', sku: 'WINE-KIT-CAB', name: 'Cabernet Sauvignon Kit' },
      { item_id: 'KIT-002', sku: 'BEER-KIT-ALE', name: 'Pale Ale Kit' }
    ]);

    brewpadIntegration.callAppsScriptCreateBatch.mockResolvedValue({ ok: true, batch_id: 'SV-B-000002' });

    var req = makeReq({ invoice_ids: ['INV-ID-001'] }, {}, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    bulkCreateHandler(req, res);

    return flushPromises().then(function () {
      expect(brewpadIntegration.callAppsScriptCreateBatch).toHaveBeenCalledTimes(2);
      // Results should contain one entry for the invoice
      var results = res._json.results || [];
      expect(results.length).toBe(1);
      expect(results[0].ok).toBe(true);
    });
  });

  // ── partial failure: one callAppsScriptCreateBatch fails, response still 200 ──
  test('partial failure: one Apps Script create fails — response 200 with per-row results marking failure', function () {
    var inv1 = 'INV-ID-001';
    var inv2 = 'INV-ID-002';

    var detail1 = makeDetailInvoice({ invoice_id: inv1, invoice_number: 'INV-000001' });
    var detail2 = makeDetailInvoice({ invoice_id: inv2, invoice_number: 'INV-000002', customer_name: 'Bob Smith' });

    zohoApi.zohoGet
      .mockResolvedValueOnce({ invoice: detail1 })
      .mockResolvedValueOnce({ invoice: detail2 });

    brewpadIntegration.detectKitItems.mockReturnValue([
      { item_id: 'KIT-001', sku: 'WINE-KIT-CAB', name: 'Cabernet Sauvignon Kit' }
    ]);

    brewpadIntegration.callAppsScriptCreateBatch
      .mockResolvedValueOnce({ ok: true, batch_id: 'SV-B-000001' })
      .mockResolvedValueOnce({ ok: false, error: 'apps_script_error' });

    var req = makeReq({ invoice_ids: [inv1, inv2] }, {}, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    bulkCreateHandler(req, res);

    return flushPromises().then(function () {
      // Must be 200 even on partial failure
      expect(res._status).toBeNull(); // implicit 200
      var results = res._json.results || [];
      expect(results.length).toBe(2);
      var ok = results.filter(function (r) { return r.ok === true; });
      var failed = results.filter(function (r) { return r.ok === false; });
      expect(ok.length).toBe(1);
      expect(failed.length).toBe(1);
    });
  });

  // ── duplicate_so_number error from Apps Script surfaces in per-row results ──
  test('duplicate_so_number error from Apps Script surfaces in per-row results', function () {
    zohoApi.zohoGet.mockResolvedValue({ invoice: makeDetailInvoice() });

    brewpadIntegration.detectKitItems.mockReturnValue([
      { sku: 'WINE-KIT-CAB', name: 'Cabernet Sauvignon Kit' }
    ]);

    // Apps Script D-10.2 idempotency guard returns duplicate_so_number
    brewpadIntegration.callAppsScriptCreateBatch.mockResolvedValue({
      ok: false,
      error: 'duplicate_so_number',
      message: 'A batch for SO/invoice INV-000001 already exists: SV-B-000001'
    });

    var req = makeReq({ invoice_ids: ['INV-ID-001'] }, {}, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    bulkCreateHandler(req, res);

    return flushPromises().then(function () {
      var results = res._json.results || [];
      expect(results.length).toBe(1);
      expect(results[0].ok).toBe(false);
      // error field should be surfaced so client can handle duplicate gracefully
      expect(results[0].error).toBeTruthy();
    });
  });
});
