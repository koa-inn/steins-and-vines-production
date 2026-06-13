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

// Mock axios for Apps Script calls
jest.mock('axios', function () { return { post: jest.fn() }; });

// Mock checkout-helpers (buildContactPayload)
jest.mock('../lib/checkout-helpers', function () { return {
  buildContactPayload: jest.fn(function (name, email, phone) {
    return {
      contact_name: name,
      contact_type: 'customer',
      contact_persons: [{ first_name: name.split(' ')[0], last_name: name.split(' ').slice(1).join(' '), email: email, is_primary_contact: true }]
    };
  }),
  buildLineItems: jest.fn(),
  readServicesSnapshot: jest.fn(),
  readIngredientsFileCache: jest.fn(),
  withTimeout: jest.fn(),
  verifyRecaptcha: jest.fn(),
  notifyAdminPanel: jest.fn(),
  findMakersFeeItem: jest.fn(),
  findMaterialsFeeItem: jest.fn()
}; });

// Mock brewpad-integration (already imported in pos.js)
jest.mock('../lib/brewpad-integration', function () { return {
  createBatch: jest.fn().mockResolvedValue({ ok: true }),
  retryQueuedBatches: jest.fn().mockResolvedValue()
}; });

var zohoApi = require('../lib/zoho-api');
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
// GET /api/contacts/search
// ---------------------------------------------------------------------------
describe('GET /api/contacts/search', function () {
  var OLD_MW_KEY;
  var handler;

  beforeEach(function () {
    jest.clearAllMocks();
    OLD_MW_KEY = process.env.MW_API_KEY;
    process.env.MW_API_KEY = 'test-api-key';
    handler = findHandler('get', '/api/contacts/search');
  });

  afterEach(function () {
    process.env.MW_API_KEY = OLD_MW_KEY;
  });

  // ── 401-no-key ─────────────────────────────────────────────────────────
  it('returns 401 when no api key provided', function () {
    var req = makeReq({}, { q: 'Jane' }, {});
    var res = makeRes();
    handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res._json).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 401 when wrong api key provided', function () {
    var req = makeReq({}, { q: 'Jane' }, { 'x-api-key': 'wrong-key' });
    var res = makeRes();
    handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res._json).toMatchObject({ error: 'Unauthorized' });
  });

  // ── 400-too-short ───────────────────────────────────────────────────────
  it('returns 400 when q param is missing', function () {
    var req = makeReq({}, {}, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res._json).toBeDefined();
  });

  it('returns 400 when q param is less than 2 chars', function () {
    var req = makeReq({}, { q: 'J' }, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res._json).toBeDefined();
  });

  // ── 200-slim-mapping ────────────────────────────────────────────────────
  it('returns 200 with slim contact list on valid query', function () {
    zohoApi.zohoGet.mockResolvedValue({
      contacts: [
        { contact_id: 'c001', contact_name: 'Jane Doe', email: 'jane@example.com', phone: '604-555-1234', contact_persons: [] },
        { contact_id: 'c002', contact_name: 'Jane Smith', email: 'jsmith@test.com', phone: '', contact_persons: [] }
      ]
    });

    var req = makeReq({}, { q: 'Jane' }, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    handler(req, res);

    return flushPromises().then(function () {
      expect(zohoApi.zohoGet).toHaveBeenCalledWith('/contacts', { search_text: 'Jane' });
      expect(res._json).toMatchObject({
        contacts: [
          { contact_id: 'c001', contact_name: 'Jane Doe', email: 'jane@example.com', phone: '604-555-1234' },
          { contact_id: 'c002', contact_name: 'Jane Smith', email: 'jsmith@test.com', phone: '' }
        ]
      });
      // Slim objects should only have 4 fields
      expect(Object.keys(res._json.contacts[0])).toEqual(expect.arrayContaining(['contact_id', 'contact_name', 'email', 'phone']));
    });
  });

  // ── 200-empty-result ─────────────────────────────────────────────────────
  it('returns 200 with empty contacts array when Zoho returns no results', function () {
    zohoApi.zohoGet.mockResolvedValue({ contacts: [] });

    var req = makeReq({}, { q: 'NoMatch' }, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    handler(req, res);

    return flushPromises().then(function () {
      expect(res._json).toMatchObject({ contacts: [] });
      expect(res._status).toBeNull(); // 200 is default, no status() called
    });
  });

  // ── 502-zoho-error ───────────────────────────────────────────────────────
  it('returns 502 when zohoGet rejects', function () {
    var err = new Error('Zoho quota exceeded');
    err.response = { data: { message: 'Daily limit exceeded' } };
    zohoApi.zohoGet.mockRejectedValue(err);

    var req = makeReq({}, { q: 'Jane' }, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    handler(req, res);

    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(502);
      expect(res._json).toMatchObject({ error: expect.any(String) });
    });
  });

  // ── email/phone from contact_persons primary ────────────────────────────
  it('reads email and phone from primary contact_person when top-level fields absent', function () {
    zohoApi.zohoGet.mockResolvedValue({
      contacts: [
        {
          contact_id: 'c003',
          contact_name: 'Bob Builder',
          email: '',
          phone: '',
          contact_persons: [
            { first_name: 'Bob', email: 'bob@builder.com', phone: '778-111-2222', is_primary_contact: true }
          ]
        }
      ]
    });

    var req = makeReq({}, { q: 'Bob' }, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    handler(req, res);

    return flushPromises().then(function () {
      expect(res._json.contacts[0].email).toBe('bob@builder.com');
      expect(res._json.contacts[0].phone).toBe('778-111-2222');
    });
  });
});

// ---------------------------------------------------------------------------
// POST /api/batch/reassign-customer
// ---------------------------------------------------------------------------
describe('POST /api/batch/reassign-customer', function () {
  var OLD_MW_KEY;
  var OLD_APPS_SCRIPT_URL;
  var OLD_APPS_SCRIPT_TOKEN;
  var handler;

  beforeEach(function () {
    jest.clearAllMocks();
    OLD_MW_KEY = process.env.MW_API_KEY;
    OLD_APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;
    OLD_APPS_SCRIPT_TOKEN = process.env.APPS_SCRIPT_SERVER_TOKEN;
    process.env.MW_API_KEY = 'test-api-key';
    process.env.APPS_SCRIPT_URL = 'https://script.google.com/test';
    process.env.APPS_SCRIPT_SERVER_TOKEN = 'test-server-token';
    handler = findHandler('post', '/api/batch/reassign-customer');
  });

  afterEach(function () {
    process.env.MW_API_KEY = OLD_MW_KEY;
    process.env.APPS_SCRIPT_URL = OLD_APPS_SCRIPT_URL;
    process.env.APPS_SCRIPT_SERVER_TOKEN = OLD_APPS_SCRIPT_TOKEN;
  });

  // ── 401 ──────────────────────────────────────────────────────────────────
  it('returns 401 when no api key provided', function () {
    var req = makeReq({ batch_id: 'SV-B-000001', customer: { name: 'Jane Doe' } }, {}, {});
    var res = makeRes();
    handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res._json).toMatchObject({ error: 'Unauthorized' });
  });

  // ── 400 missing batch_id ──────────────────────────────────────────────────
  it('returns 400 when batch_id is missing', function () {
    var req = makeReq({ customer: { name: 'Jane Doe' } }, {}, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res._json).toMatchObject({ error: expect.stringMatching(/batch_id/i) });
  });

  // ── 400 missing customer ───────────────────────────────────────────────────
  it('returns 400 when customer block has no name or contact_id', function () {
    var req = makeReq({ batch_id: 'SV-B-000001', customer: { email: 'no-name@test.com' } }, {}, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res._json).toMatchObject({ error: expect.any(String) });
  });

  // ── Happy path: contact found by email → batch updated → Zoho SO updated ──
  it('happy path: resolves existing contact, updates batch, updates Zoho SO', function () {
    // Contact search returns existing contact
    zohoApi.zohoGet.mockImplementation(function (path, params) {
      if (path === '/contacts' && params && params.email) {
        return Promise.resolve({ contacts: [{ contact_id: 'ZOHO-C-001', contact_name: 'Jane Doe' }] });
      }
      if (path === '/salesorders') {
        return Promise.resolve({ salesorders: [{ salesorder_id: 'SO-INT-001', salesorder_number: 'SO-1001', customer_id: 'OLD-C', customer_name: 'Old Customer' }] });
      }
      return Promise.resolve({});
    });

    // Apps Script returns success
    axios.post.mockResolvedValue({ data: { ok: true, data: { last_updated: '2026-06-13T12:00:00Z' } } });

    // Zoho PUT succeeds
    zohoApi.zohoPut.mockResolvedValue({ salesorder: { salesorder_id: 'SO-INT-001' } });

    var req = makeReq({
      batch_id: 'SV-B-000001',
      zoho_so_number: 'SO-1001',
      expectedVersion: '2026-06-12T10:00:00Z',
      customer: { name: 'Jane Doe', email: 'jane@example.com', phone: '604-555-1234' }
    }, {}, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    handler(req, res);

    return flushPromises().then(function () {
      expect(axios.post).toHaveBeenCalledWith(
        'https://script.google.com/test',
        expect.stringContaining('"action":"update_batch"'),
        expect.objectContaining({ headers: { 'Content-Type': 'application/json' } })
      );
      expect(zohoApi.zohoPut).toHaveBeenCalledWith(
        '/salesorders/SO-INT-001',
        expect.objectContaining({ customer_id: 'ZOHO-C-001' })
      );
      expect(res._json).toMatchObject({
        ok: true,
        batch_updated: true,
        zoho_updated: true,
        new_version: '2026-06-13T12:00:00Z'
      });
    });
  });

  // ── D-05: Zoho PUT rejects — batch update stands, zoho_warning returned ───
  it('D-05: returns ok:true with zoho_warning when Zoho PUT fails', function () {
    zohoApi.zohoGet.mockImplementation(function (path, params) {
      if (path === '/contacts' && params && params.email) {
        return Promise.resolve({ contacts: [{ contact_id: 'ZOHO-C-001', contact_name: 'Jane Doe' }] });
      }
      if (path === '/salesorders') {
        return Promise.resolve({ salesorders: [{ salesorder_id: 'SO-INT-001', salesorder_number: 'SO-1001' }] });
      }
      return Promise.resolve({});
    });

    axios.post.mockResolvedValue({ data: { ok: true, data: { last_updated: '2026-06-13T12:00:00Z' } } });

    var zohoErr = new Error('Cannot change customer on confirmed SO');
    zohoErr.response = { data: { message: 'Customer change not allowed for confirmed orders' } };
    zohoApi.zohoPut.mockRejectedValue(zohoErr);

    var req = makeReq({
      batch_id: 'SV-B-000001',
      zoho_so_number: 'SO-1001',
      expectedVersion: '2026-06-12T10:00:00Z',
      customer: { name: 'Jane Doe', email: 'jane@example.com' }
    }, {}, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    handler(req, res);

    return flushPromises().then(function () {
      // Must NOT return 502 — batch change stands
      expect(res._status).not.toBe(502);
      expect(res._json).toMatchObject({
        ok: true,
        batch_updated: true,
        zoho_warning: 'Customer change not allowed for confirmed orders',
        new_version: '2026-06-13T12:00:00Z'
      });
      // zohoPut WAS called (D-05: attempt was made, failed gracefully)
      expect(zohoApi.zohoPut).toHaveBeenCalled();
    });
  });

  // ── D-03: no zoho_so_number — batch-only, NO Zoho call ──────────────────
  it('D-03: batch-only update when no zoho_so_number — zohoPut NOT called', function () {
    zohoApi.zohoGet.mockImplementation(function (path, params) {
      if (path === '/contacts' && params && params.email) {
        return Promise.resolve({ contacts: [{ contact_id: 'ZOHO-C-001', contact_name: 'Jane Doe' }] });
      }
      return Promise.resolve({});
    });

    axios.post.mockResolvedValue({ data: { ok: true, data: { last_updated: '2026-06-13T12:00:00Z' } } });

    var req = makeReq({
      batch_id: 'SV-B-000001',
      // No zoho_so_number
      expectedVersion: '2026-06-12T10:00:00Z',
      customer: { name: 'Jane Doe', email: 'jane@example.com' }
    }, {}, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    handler(req, res);

    return flushPromises().then(function () {
      // zohoPut must NOT have been called (D-03)
      expect(zohoApi.zohoPut).not.toHaveBeenCalled();
      expect(res._json).toMatchObject({
        ok: true,
        batch_updated: true,
        new_version: '2026-06-13T12:00:00Z'
      });
      // zoho_updated should be falsy or absent
      expect(res._json.zoho_updated).toBeFalsy();
    });
  });

  // ── Contact not found → creates new contact ───────────────────────────────
  it('creates a new Zoho contact when not found by email', function () {
    zohoApi.zohoGet.mockImplementation(function (path, params) {
      if (path === '/contacts' && params && params.email) {
        return Promise.resolve({ contacts: [] }); // not found
      }
      if (path === '/salesorders') {
        return Promise.resolve({ salesorders: [{ salesorder_id: 'SO-INT-001', salesorder_number: 'SO-1001' }] });
      }
      return Promise.resolve({});
    });

    zohoApi.zohoPost.mockResolvedValue({ contact: { contact_id: 'ZOHO-C-NEW' } });

    axios.post.mockResolvedValue({ data: { ok: true, data: { last_updated: '2026-06-13T12:00:00Z' } } });

    zohoApi.zohoPut.mockResolvedValue({ salesorder: { salesorder_id: 'SO-INT-001' } });

    var req = makeReq({
      batch_id: 'SV-B-000001',
      zoho_so_number: 'SO-1001',
      expectedVersion: '2026-06-12T10:00:00Z',
      customer: { name: 'New Customer', email: 'new@example.com', phone: '778-123-4567' }
    }, {}, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    handler(req, res);

    return flushPromises().then(function () {
      expect(zohoApi.zohoPost).toHaveBeenCalledWith('/contacts', expect.objectContaining({
        contact_name: 'New Customer',
        contact_type: 'customer'
      }));
      expect(zohoApi.zohoPut).toHaveBeenCalledWith(
        '/salesorders/SO-INT-001',
        expect.objectContaining({ customer_id: 'ZOHO-C-NEW' })
      );
      expect(res._json).toMatchObject({ ok: true, batch_updated: true, zoho_updated: true });
    });
  });

  // ── Version conflict → 409 ────────────────────────────────────────────────
  it('returns 409 when Apps Script returns version_conflict', function () {
    zohoApi.zohoGet.mockImplementation(function (path, params) {
      if (path === '/contacts' && params && params.email) {
        return Promise.resolve({ contacts: [{ contact_id: 'ZOHO-C-001', contact_name: 'Jane Doe' }] });
      }
      return Promise.resolve({});
    });

    axios.post.mockResolvedValue({
      data: {
        ok: false,
        error: 'version_conflict',
        message: 'Batch was modified by another user. Refresh and try again.'
      }
    });

    var req = makeReq({
      batch_id: 'SV-B-000001',
      expectedVersion: '2026-06-11T08:00:00Z', // stale version
      customer: { name: 'Jane Doe', email: 'jane@example.com' }
    }, {}, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    handler(req, res);

    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(409);
      expect(res._json).toMatchObject({ error: 'version_conflict' });
      // No Zoho push should happen
      expect(zohoApi.zohoPut).not.toHaveBeenCalled();
    });
  });

  // ── contact_id provided directly (skip lookup) ────────────────────────────
  it('uses contact_id directly when provided without doing a lookup', function () {
    axios.post.mockResolvedValue({ data: { ok: true, data: { last_updated: '2026-06-13T12:00:00Z' } } });
    zohoApi.zohoGet.mockImplementation(function (path) {
      if (path === '/salesorders') {
        return Promise.resolve({ salesorders: [{ salesorder_id: 'SO-INT-001', salesorder_number: 'SO-1001' }] });
      }
      return Promise.resolve({});
    });
    zohoApi.zohoPut.mockResolvedValue({ salesorder: { salesorder_id: 'SO-INT-001' } });

    var req = makeReq({
      batch_id: 'SV-B-000001',
      zoho_so_number: 'SO-1001',
      expectedVersion: '2026-06-12T10:00:00Z',
      customer: { contact_id: 'ZOHO-C-EXISTING', name: 'Jane Doe' }
    }, {}, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    handler(req, res);

    return flushPromises().then(function () {
      // Should not call zohoPost to create contact
      expect(zohoApi.zohoPost).not.toHaveBeenCalledWith('/contacts', expect.anything());
      expect(zohoApi.zohoPut).toHaveBeenCalledWith(
        '/salesorders/SO-INT-001',
        expect.objectContaining({ customer_id: 'ZOHO-C-EXISTING' })
      );
      expect(res._json).toMatchObject({ ok: true, batch_updated: true, zoho_updated: true });
    });
  });

  // ── INV- number: resolves via invoices endpoint ───────────────────────────
  it('resolves invoice doc id when zoho_so_number is INV- prefixed', function () {
    zohoApi.zohoGet.mockImplementation(function (path, params) {
      if (path === '/contacts' && params && params.email) {
        return Promise.resolve({ contacts: [{ contact_id: 'ZOHO-C-001' }] });
      }
      if (path === '/invoices') {
        return Promise.resolve({ invoices: [{ invoice_id: 'INV-INT-001', invoice_number: 'INV-1001' }] });
      }
      return Promise.resolve({});
    });
    axios.post.mockResolvedValue({ data: { ok: true, data: { last_updated: '2026-06-13T12:00:00Z' } } });
    zohoApi.zohoPut.mockResolvedValue({ invoice: { invoice_id: 'INV-INT-001' } });

    var req = makeReq({
      batch_id: 'SV-B-000001',
      zoho_so_number: 'INV-1001',
      expectedVersion: '2026-06-12T10:00:00Z',
      customer: { name: 'Jane Doe', email: 'jane@example.com' }
    }, {}, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    handler(req, res);

    return flushPromises().then(function () {
      expect(zohoApi.zohoPut).toHaveBeenCalledWith(
        '/invoices/INV-INT-001',
        expect.objectContaining({ customer_id: 'ZOHO-C-001' })
      );
      expect(res._json).toMatchObject({ ok: true, batch_updated: true, zoho_updated: true });
    });
  });
});
