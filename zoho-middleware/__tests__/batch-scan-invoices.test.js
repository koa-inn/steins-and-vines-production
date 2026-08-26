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

jest.mock('../lib/brewpad-integration', function () {
  var mockModule = {
    detectKitItems: jest.fn(),
    // Mirrors the real kitBatchQuantity: quantity → batch count, default 1, clamp 100.
    kitBatchQuantity: jest.fn(function (item) {
      var q = Math.floor(Number(item && item.quantity));
      if (!isFinite(q) || q < 1) return 1;
      return q > 100 ? 100 : q;
    }),
    // Default expansion mirrors detectKitItems() x kitBatchQuantity() with NO fee-slot
    // cap — matches pre-existing tests that never set up Maker's Fee slot data. Tests
    // exercising the D-04 fee-slot cap (Task 1 regression) override this explicitly via
    // mockReturnValue/mockReturnValueOnce.
    planKitBatches: jest.fn(function (lineItems) {
      var kits = mockModule.detectKitItems(lineItems) || [];
      var units = [];
      kits.forEach(function (item) {
        var qty = mockModule.kitBatchQuantity(item);
        for (var i = 0; i < qty; i++) units.push(item);
      });
      return units;
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
  };
  return mockModule;
});

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

  // CR-02 regression: single-invoice mode must perform search-then-detail (not raw number as path ID).
  // Before the fix, code called zohoGet('/invoices/INV-000123') which Zoho rejects (needs numeric ID).
  // After fix: zohoGet('/invoices', { invoice_number: ... }) first, then zohoGet('/invoices/<numeric_id>').
  test('CR-02 regression: single-invoice mode performs search step — does NOT call zohoGet with raw INV-/SO- number as path', function () {
    // mockReset clears default impl set by prior tests; then use Once so nothing leaks forward.
    zohoApi.zohoGet.mockReset();
    zohoApi.zohoGet
      .mockResolvedValueOnce({ invoices: [{ invoice_id: '109900000000000123', invoice_number: 'INV-000123' }] })
      .mockResolvedValueOnce({ invoice: makeDetailInvoice({ invoice_id: '109900000000000123', invoice_number: 'INV-000123' }) });

    brewpadIntegration.detectKitItems.mockReturnValue([
      { sku: 'WINE-KIT-CAB', name: 'Cabernet Sauvignon Kit' }
    ]);

    var req = makeReq(null, { number: 'INV-000123' }, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    scanInvoicesHandler(req, res);

    return flushPromises().then(function () {
      // Must NOT call zohoGet with raw 'INV-...' string as a path segment (the CR-02 bug)
      var rawNumberCalls = zohoApi.zohoGet.mock.calls.filter(function (c) {
        return typeof c[0] === 'string' && /\/invoices\/INV-/.test(c[0]);
      });
      expect(rawNumberCalls.length).toBe(0);

      // Step 1 must be a list/search call (path '/invoices' with filter param)
      var searchCalls = zohoApi.zohoGet.mock.calls.filter(function (c) {
        return c[0] === '/invoices' && c[1] && c[1].invoice_number === 'INV-000123';
      });
      expect(searchCalls.length).toBe(1);
    });
  });

  // CR-02 regression: SO- prefix resolves via /salesorders endpoint (not /invoices)
  test('CR-02 regression: single-invoice mode with SO- prefix searches salesorders endpoint', function () {
    zohoApi.zohoGet.mockReset();
    zohoApi.zohoGet
      .mockResolvedValueOnce({ salesorders: [{ salesorder_id: '109900000000000456', salesorder_number: 'SO-000456' }] })
      .mockResolvedValueOnce({ salesorder: {
        salesorder_id: '109900000000000456', salesorder_number: 'SO-000456',
        customer_name: 'Bob Builder', customer_id: 'CUST-456', status: 'confirmed',
        line_items: [{ item_id: 'KIT-001', sku: 'WINE-KIT-CAB', name: 'Cab Sav Kit' }]
      } });

    brewpadIntegration.detectKitItems.mockReturnValue([
      { sku: 'WINE-KIT-CAB', name: 'Cab Sav Kit' }
    ]);

    var req = makeReq(null, { number: 'SO-000456' }, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    scanInvoicesHandler(req, res);

    return flushPromises().then(function () {
      // Search must use /salesorders (not /invoices) for SO- prefix
      var soSearchCalls = zohoApi.zohoGet.mock.calls.filter(function (c) {
        return c[0] === '/salesorders' && c[1] && c[1].salesorder_number === 'SO-000456';
      });
      expect(soSearchCalls.length).toBe(1);

      // Must NOT call /invoices for an SO- prefix (the CR-02 bug)
      var wrongEndpoint = zohoApi.zohoGet.mock.calls.filter(function (c) {
        return typeof c[0] === 'string' && /^\/invoices/.test(c[0]);
      });
      expect(wrongEndpoint.length).toBe(0);
    });
  });

  test('single-invoice mode: ?number=INV-000123 bypasses date window and returns single-element candidates array', function () {
    // Two-step: search then detail fetch (CR-02 fix)
    zohoApi.zohoGet
      .mockResolvedValueOnce({ invoices: [{ invoice_id: 'INV-ID-123', invoice_number: 'INV-000123' }] })
      .mockResolvedValueOnce({ invoice: makeDetailInvoice({
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
    zohoApi.zohoGet
      .mockResolvedValueOnce({ invoices: [{ invoice_id: 'INV-ID-123', invoice_number: 'INV-000123' }] })
      .mockResolvedValueOnce({ invoice: makeDetailInvoice({
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

  // CR-02: single-invoice mode returns empty candidates when Zoho search finds nothing
  test('single-invoice mode: number not found in Zoho search => empty candidates', function () {
    zohoApi.zohoGet.mockReset();
    zohoApi.zohoGet.mockResolvedValueOnce({ invoices: [] });

    var req = makeReq(null, { number: 'INV-000999' }, { 'x-api-key': 'test-api-key' });
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
    // Auth check fires before format validation, so any invoice_ids value works here
    var req = makeReq({ invoice_ids: ['109900000000000001'] }, {}, {});
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
    // WR-01 fix: invoice_ids must be Zoho numeric IDs (15-20 digits), not human-readable strings
    var req = makeReq(
      {
        invoice_ids: ['109900000000000001'],
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
      expect(zohoApi.zohoGet).toHaveBeenCalledWith('/invoices/109900000000000001');

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

    // WR-01 fix: use valid Zoho numeric ID format
    var req = makeReq({ invoice_ids: ['109900000000000001'] }, {}, { 'x-api-key': 'test-api-key' });
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

  // ── quantity-aware (INV-000137): a kit line at quantity 3 => 3 batches ──
  test('quantity-aware: a kit line with quantity 3 yields 3 creates, 3 kit_results, and one count sync', function () {
    zohoApi.zohoGet.mockResolvedValue({
      invoice: makeDetailInvoice({
        line_items: [
          { item_id: 'KIT-001', sku: '80087352', name: 'Italy Nebbiolo Style', quantity: 3 },
          { item_id: 'FEE-001', sku: 'MAKERS-FEE', name: "Maker's Fee", quantity: 1 }
        ]
      })
    });
    brewpadIntegration.detectKitItems.mockReturnValue([
      { item_id: 'KIT-001', sku: '80087352', name: 'Italy Nebbiolo Style', quantity: 3 }
    ]);
    brewpadIntegration.callAppsScriptCreateBatch.mockResolvedValue({ ok: true, batch_id: 'SV-B-000002' });

    var req = makeReq({ invoice_ids: ['109900000000000001'] }, {}, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    bulkCreateHandler(req, res);

    return flushPromises().then(function () {
      expect(brewpadIntegration.callAppsScriptCreateBatch).toHaveBeenCalledTimes(3);
      var results = res._json.results || [];
      expect(results.length).toBe(1);
      expect(results[0].ok).toBe(true);
      expect(results[0].kit_results).toHaveLength(3);
      // Zoho batch-status synced once with a count of 3 (not 3 overwriting single-id syncs)
      expect(brewpadIntegration.syncBatchToZoho).toHaveBeenCalledWith(
        expect.any(String), 'SV-B-000002', 'pending', { count: 3 }
      );
    });
  });

  // ── partial failure: one callAppsScriptCreateBatch fails, response still 200 ──
  test('partial failure: one Apps Script create fails — response 200 with per-row results marking failure', function () {
    // WR-01 fix: use valid Zoho numeric ID format (15-20 digits)
    var inv1 = '109900000000000001';
    var inv2 = '109900000000000002';

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

  // ── duplicate_so_number is a benign convergence signal, not a hard failure (WR-01) ──
  // Updated 2026-08-26 for the WR-01 code-review fix: a duplicate_so_number from the
  // Apps Script guard means the batch already exists (desired state reached), so the
  // invoice is reported satisfied (ok:true) and flagged duplicate rather than failed.
  // Previously this test asserted ok:false / truthy error, which is exactly the
  // behaviour WR-01 corrects (a spurious failure toast on an idempotent re-run).
  test('duplicate_so_number from Apps Script surfaces as a benign duplicate, not a failure', function () {
    zohoApi.zohoGet.mockResolvedValue({ invoice: makeDetailInvoice() });

    brewpadIntegration.detectKitItems.mockReturnValue([
      { sku: 'WINE-KIT-CAB', name: 'Cabernet Sauvignon Kit' }
    ]);

    // Apps Script D-10.2 idempotency guard returns duplicate_so_number — the batch
    // already exists, i.e. the invoice has converged to its desired state.
    brewpadIntegration.callAppsScriptCreateBatch.mockResolvedValue({
      ok: false,
      error: 'duplicate_so_number',
      message: 'A batch for SO/invoice INV-000001 already exists: SV-B-000001'
    });

    // WR-01 fix: use valid Zoho numeric ID format (15-20 digits)
    var req = makeReq({ invoice_ids: ['109900000000000001'] }, {}, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    bulkCreateHandler(req, res);

    return flushPromises().then(function () {
      var results = res._json.results || [];
      expect(results.length).toBe(1);
      // Satisfied (converged), not a hard failure.
      expect(results[0].ok).toBe(true);
      expect(results[0].duplicate).toBe(true);
      // No hard error surfaced for a benign, already-existing batch.
      expect(results[0].error).toBeUndefined();
    });
  });

  // ── WR-01 regression: invoice_ids format validation and size cap ──────────
  test('WR-01 regression: 400 when invoice_ids contains a non-numeric-ID string (path traversal guard)', function () {
    var req = makeReq({ invoice_ids: ['../contacts'] }, {}, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    bulkCreateHandler(req, res);

    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res._json.error).toBe('bad_request');
      // Must not have called zohoGet (guard fires before Zoho call)
      expect(zohoApi.zohoGet).not.toHaveBeenCalled();
    });
  });

  test('WR-01 regression: 400 when invoice_ids contains an INV-prefixed human number (not numeric ID)', function () {
    var req = makeReq({ invoice_ids: ['INV-000123'] }, {}, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    bulkCreateHandler(req, res);

    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res._json.error).toBe('bad_request');
      expect(zohoApi.zohoGet).not.toHaveBeenCalled();
    });
  });

  test('WR-01 regression: 400 when invoice_ids array length exceeds 200', function () {
    var ids = [];
    for (var i = 0; i < 201; i++) {
      // Pad to 18 digits so format check passes but size check fires
      ids.push('109900000000' + String(i).padStart(6, '0'));
    }
    var req = makeReq({ invoice_ids: ids }, {}, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    bulkCreateHandler(req, res);

    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res._json.error).toBe('bad_request');
      expect(zohoApi.zohoGet).not.toHaveBeenCalled();
    });
  });

  test('WR-01 regression: valid 18-digit numeric invoice_ids pass format guard', function () {
    zohoApi.zohoGet.mockResolvedValue({ invoice: makeDetailInvoice() });
    brewpadIntegration.detectKitItems.mockReturnValue([
      { sku: 'WINE-KIT-CAB', name: 'Cabernet Sauvignon Kit' }
    ]);
    brewpadIntegration.callAppsScriptCreateBatch.mockResolvedValue({ ok: true, batch_id: 'SV-B-000099' });

    var req = makeReq({ invoice_ids: ['109900000000000001'] }, {}, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    bulkCreateHandler(req, res);

    return flushPromises().then(function () {
      // Should not be rejected by format guard — zohoGet must have been called
      expect(zohoApi.zohoGet).toHaveBeenCalledWith('/invoices/109900000000000001');
    });
  });
});

// ---------------------------------------------------------------------------
// POST /api/batch/bulk-create — unit_total regression (INV-000171)
//
// Reproduces the bulk-create sibling of the already-fixed INV-000137 sale-path
// bug: the bulk-create loop sends an identical batchPayload per unit that never
// sets unit_total, so the Apps Script dedup guard (apps-script/adminApi.gs:1986-
// 2014) defaults unit_total to 1 and rejects units 2+ as duplicate_so_number —
// collapsing a qty-3 kit line (INV-000171) to a single pending batch.
//
// The fakeAppsScriptGuard below reproduces the REAL guard semantics (count
// matching (zoho_so_number, product_sku) rows, allow while count < unit_total||1)
// rather than an unconditional { ok: true } stub, so these tests actually exercise
// the convergence/idempotency behaviour instead of merely counting calls.
// ---------------------------------------------------------------------------
describe('POST /api/batch/bulk-create unit_total regression (INV-000171)', function () {
  var INV171_KIT = { item_id: 'KIT-001', sku: '80087352', name: 'Italy Nebbiolo Style', quantity: 3 };
  var INV171_FEE = { item_id: 'FEE-001', sku: 'MAKERS-FEE', name: "Maker's Fee", quantity: 3 };

  beforeEach(function () {
    jest.clearAllMocks();
    process.env.MW_API_KEY = 'test-api-key';
    process.env.APPS_SCRIPT_URL = 'https://script.google.com/test';
    process.env.APPS_SCRIPT_SERVER_TOKEN = 'test-server-token-abc';
    process.env.ZOHO_CF_BATCH_STATUS = 'cf_batch_status';
  });

  // Installs a callAppsScriptCreateBatch mock backed by an in-test fake Batches sheet.
  // Mirrors apps-script/adminApi.gs createBatch dedup guard (L1986-2014): keys on
  // (zoho_so_number, product_sku); allowedUnits = Math.floor(Number(unit_total)),
  // defaulting to 1 when absent/NaN; creates only while matching count < allowedUnits.
  function installFakeAppsScriptGuard(seedRows) {
    var fakeSheet = (seedRows || []).slice();
    brewpadIntegration.callAppsScriptCreateBatch.mockImplementation(function (payload) {
      var so = payload.zoho_so_number;
      var sku = payload.product_sku;
      var allowedUnits = Math.floor(Number(payload.unit_total));
      if (!isFinite(allowedUnits) || allowedUnits < 1) allowedUnits = 1;
      var matching = fakeSheet.filter(function (row) {
        return row.zoho_so_number === so && row.product_sku === sku;
      });
      if (matching.length >= allowedUnits) {
        return Promise.resolve({ ok: false, error: 'duplicate_so_number' });
      }
      var batchId = 'SV-B-' + (fakeSheet.length + 1);
      fakeSheet.push({ zoho_so_number: so, product_sku: sku, batch_id: batchId });
      return Promise.resolve({ ok: true, batch_id: batchId });
    });
    return fakeSheet;
  }

  function makeInv171Detail() {
    return makeDetailInvoice({
      invoice_id: '109900000000171000',
      invoice_number: 'INV-000171',
      line_items: [INV171_KIT, INV171_FEE]
    });
  }

  // ── Test A: 3-qty kit line, empty sheet → exactly 3 creates, unit_total 3 ──
  test('Test A: qty-3 kit line on an empty sheet creates exactly 3 batches, each with unit_total 3', function () {
    zohoApi.zohoGet.mockResolvedValue({ invoice: makeInv171Detail() });
    brewpadIntegration.detectKitItems.mockReturnValue([INV171_KIT]);
    brewpadIntegration.planKitBatches.mockReturnValue([INV171_KIT, INV171_KIT, INV171_KIT]);
    var fakeSheet = installFakeAppsScriptGuard([]);

    var req = makeReq({ invoice_ids: ['109900000000000001'] }, {}, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    bulkCreateHandler(req, res);

    return flushPromises().then(function () {
      expect(brewpadIntegration.callAppsScriptCreateBatch).toHaveBeenCalledTimes(3);
      var calls = brewpadIntegration.callAppsScriptCreateBatch.mock.calls;
      calls.forEach(function (call) {
        expect(call[0].unit_total).toBe(3);
        expect(call[0].zoho_so_number).toBe('INV-000171');
        expect(call[0].product_sku).toBe('80087352');
      });

      var results = res._json.results || [];
      expect(results.length).toBe(1);
      var kitResults = results[0].kit_results || [];
      var oks = kitResults.filter(function (r) { return r.ok; });
      expect(oks.length).toBe(3);
      expect(results[0].ok).toBe(true);
      expect(fakeSheet.length).toBe(3);
    });
  });

  // ── Test B: pre-seeded with 1 existing row → converges by adding 2, not 3 (D-02) ──
  test('Test B: invoice line with 1 existing batch converges to 3 — adds 2 new, not 3', function () {
    zohoApi.zohoGet.mockResolvedValue({ invoice: makeInv171Detail() });
    brewpadIntegration.detectKitItems.mockReturnValue([INV171_KIT]);
    brewpadIntegration.planKitBatches.mockReturnValue([INV171_KIT, INV171_KIT, INV171_KIT]);
    var fakeSheet = installFakeAppsScriptGuard([
      { zoho_so_number: 'INV-000171', product_sku: '80087352', batch_id: 'SV-B-EXISTING-1' }
    ]);

    var req = makeReq({ invoice_ids: ['109900000000000001'] }, {}, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    bulkCreateHandler(req, res);

    return flushPromises().then(function () {
      var calls = brewpadIntegration.callAppsScriptCreateBatch.mock.calls;
      calls.forEach(function (call) {
        expect(call[0].unit_total).toBe(3);
      });

      var results = res._json.results || [];
      var kitResults = results[0].kit_results || [];
      var oks = kitResults.filter(function (r) { return r.ok; });
      // Converges to exactly 3 total (1 pre-existing + 2 new) — never re-adds a 3rd new row.
      expect(oks.length).toBe(2);
      expect(fakeSheet.length).toBe(3);
    });
  });

  // ── Test C: pre-seeded with all 3 rows → re-run creates 0 new (D-01 idempotency) ──
  test('Test C: re-running bulk-create for an already-fully-batched invoice creates 0 new rows', function () {
    zohoApi.zohoGet.mockResolvedValue({ invoice: makeInv171Detail() });
    brewpadIntegration.detectKitItems.mockReturnValue([INV171_KIT]);
    brewpadIntegration.planKitBatches.mockReturnValue([INV171_KIT, INV171_KIT, INV171_KIT]);
    var fakeSheet = installFakeAppsScriptGuard([
      { zoho_so_number: 'INV-000171', product_sku: '80087352', batch_id: 'SV-B-EXISTING-1' },
      { zoho_so_number: 'INV-000171', product_sku: '80087352', batch_id: 'SV-B-EXISTING-2' },
      { zoho_so_number: 'INV-000171', product_sku: '80087352', batch_id: 'SV-B-EXISTING-3' }
    ]);

    var req = makeReq({ invoice_ids: ['109900000000000001'] }, {}, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    bulkCreateHandler(req, res);

    return flushPromises().then(function () {
      var calls = brewpadIntegration.callAppsScriptCreateBatch.mock.calls;
      // Every call must still carry the correct unit_total — the pre-fix code never
      // sets it at all, which is what this assertion catches pre-fix.
      calls.forEach(function (call) {
        expect(call[0].unit_total).toBe(3);
      });

      var results = res._json.results || [];
      var kitResults = results[0].kit_results || [];
      var oks = kitResults.filter(function (r) { return r.ok; });
      expect(oks.length).toBe(0);
      expect(fakeSheet.length).toBe(3); // unchanged — no new rows
      // Response is still 200 (bulk-create never errors the HTTP layer on duplicates)
      expect(res._status).toBeNull();
    });
  });

  // ── WR-01: an idempotent re-run reports convergence, not spurious failures ──
  // Code-review gap-closure: the guard's duplicate_so_number (already-converged) signal
  // must not surface as a hard failure. Test C above only checks oks.length/sheet size;
  // this asserts the invoice-level contract the BrewPad toast actually consumes.
  test('WR-01: re-run of a fully-batched invoice is ok:true with duplicate kit_results, no failures', function () {
    zohoApi.zohoGet.mockResolvedValue({ invoice: makeInv171Detail() });
    brewpadIntegration.detectKitItems.mockReturnValue([INV171_KIT]);
    brewpadIntegration.planKitBatches.mockReturnValue([INV171_KIT, INV171_KIT, INV171_KIT]);
    installFakeAppsScriptGuard([
      { zoho_so_number: 'INV-000171', product_sku: '80087352', batch_id: 'SV-B-EXISTING-1' },
      { zoho_so_number: 'INV-000171', product_sku: '80087352', batch_id: 'SV-B-EXISTING-2' },
      { zoho_so_number: 'INV-000171', product_sku: '80087352', batch_id: 'SV-B-EXISTING-3' }
    ]);

    var req = makeReq({ invoice_ids: ['109900000000000001'] }, {}, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    bulkCreateHandler(req, res);

    return flushPromises().then(function () {
      var invoice = (res._json.results || [])[0];
      // Converged: every unit already exists → invoice satisfied, not failed.
      expect(invoice.ok).toBe(true);
      expect(invoice.error).toBeUndefined();
      expect(invoice.duplicate).toBe(true);
      var kitResults = invoice.kit_results || [];
      expect(kitResults.length).toBe(3);
      kitResults.forEach(function (kr) {
        expect(kr.ok).toBe(false);
        expect(kr.duplicate).toBe(true);
        expect(kr.error).toBe('duplicate_so_number');
      });
    });
  });

  // ── WR-01: partial convergence — created units succeed, pre-existing tagged duplicate ──
  test('WR-01: partial convergence tags the pre-existing unit duplicate and the invoice stays ok', function () {
    zohoApi.zohoGet.mockResolvedValue({ invoice: makeInv171Detail() });
    brewpadIntegration.detectKitItems.mockReturnValue([INV171_KIT]);
    brewpadIntegration.planKitBatches.mockReturnValue([INV171_KIT, INV171_KIT, INV171_KIT]);
    installFakeAppsScriptGuard([
      { zoho_so_number: 'INV-000171', product_sku: '80087352', batch_id: 'SV-B-EXISTING-1' }
    ]);

    var req = makeReq({ invoice_ids: ['109900000000000001'] }, {}, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    bulkCreateHandler(req, res);

    return flushPromises().then(function () {
      var invoice = (res._json.results || [])[0];
      expect(invoice.ok).toBe(true);
      expect(invoice.error).toBeUndefined();
      // 2 created + 1 pre-existing → not all-duplicate, so no invoice-level duplicate flag.
      expect(invoice.duplicate).toBeUndefined();
      var kitResults = invoice.kit_results || [];
      var created = kitResults.filter(function (r) { return r.ok; });
      var dupes = kitResults.filter(function (r) { return r.duplicate; });
      expect(created.length).toBe(2);
      expect(dupes.length).toBe(1);
    });
  });

  // ── Test D: fee-slot cap (D-04) — kit qty 5, only 3 paid Maker's Fee slots ──
  test('Test D: kit line quantity 5 with only 3 Makers Fee slots creates exactly 3 batches, not 5', function () {
    var kitQty5 = { item_id: 'KIT-001', sku: '80087352', name: 'Italy Nebbiolo Style', quantity: 5 };
    var feeQty3 = { item_id: 'FEE-001', sku: 'MAKERS-FEE', name: "Maker's Fee", quantity: 3 };
    zohoApi.zohoGet.mockResolvedValue({ invoice: makeDetailInvoice({
      invoice_id: '109900000000171000',
      invoice_number: 'INV-000171',
      line_items: [kitQty5, feeQty3]
    }) });
    brewpadIntegration.detectKitItems.mockReturnValue([kitQty5]);
    // planKitBatches applies the fee-slot cap (D-04) — 3 units, not the raw kit qty of 5.
    brewpadIntegration.planKitBatches.mockReturnValue([kitQty5, kitQty5, kitQty5]);
    var fakeSheet = installFakeAppsScriptGuard([]);

    var req = makeReq({ invoice_ids: ['109900000000000001'] }, {}, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    bulkCreateHandler(req, res);

    return flushPromises().then(function () {
      expect(brewpadIntegration.callAppsScriptCreateBatch).toHaveBeenCalledTimes(3);
      var calls = brewpadIntegration.callAppsScriptCreateBatch.mock.calls;
      calls.forEach(function (call) {
        expect(call[0].unit_total).toBe(3);
      });
      expect(fakeSheet.length).toBe(3);
    });
  });
});
