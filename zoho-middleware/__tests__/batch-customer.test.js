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

// Stub other modules that pos.js requires but these tests don't exercise
jest.mock('../lib/mailer', function () { return {
  sendVoidFailureAlert: jest.fn().mockResolvedValue()
}; });
jest.mock('../lib/inventory-ledger', function () { return {
  decrementStock: jest.fn().mockResolvedValue()
}; });

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

var customerByNumberHandler = findHandler('get', '/api/batch/customer-by-number');

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
// GET /api/batch/customer-by-number
// ---------------------------------------------------------------------------
describe('GET /api/batch/customer-by-number', function () {
  var OLD_MW_KEY;

  beforeEach(function () {
    jest.clearAllMocks();
    OLD_MW_KEY = process.env.MW_API_KEY;
    process.env.MW_API_KEY = 'test-api-key';
  });

  afterEach(function () {
    process.env.MW_API_KEY = OLD_MW_KEY;
  });

  // ── 401-no-key ──────────────────────────────────────────────────────────
  test('401 when x-api-key header is absent', function () {
    var req = makeReq(null, { number: 'INV-000123' }, {});
    var res = makeRes();
    customerByNumberHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res._json.error).toBe('Unauthorized');
    expect(zohoApi.zohoGet).not.toHaveBeenCalled();
  });

  test('401 when x-api-key header is wrong', function () {
    var req = makeReq(null, { number: 'INV-000123' }, { 'x-api-key': 'wrong-key' });
    var res = makeRes();
    customerByNumberHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res._json.error).toBe('Unauthorized');
    expect(zohoApi.zohoGet).not.toHaveBeenCalled();
  });

  // ── 400-invalid-number ──────────────────────────────────────────────────
  test('400 when number param is missing', function () {
    var req = makeReq(null, {}, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    customerByNumberHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res._json.error).toBe('invalid_number');
    expect(zohoApi.zohoGet).not.toHaveBeenCalled();
  });

  test('400 when number param is empty string', function () {
    var req = makeReq(null, { number: '' }, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    customerByNumberHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res._json.error).toBe('invalid_number');
    expect(zohoApi.zohoGet).not.toHaveBeenCalled();
  });

  test('400 for invalid number shape (no INV-/SO- prefix)', function () {
    var req = makeReq(null, { number: 'BADNUM' }, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    customerByNumberHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res._json.error).toBe('invalid_number');
    expect(zohoApi.zohoGet).not.toHaveBeenCalled();
  });

  // ── 404-not-found-empty-list ─────────────────────────────────────────────
  test('404 not_found when Zoho returns empty invoice list', function () {
    zohoApi.zohoGet.mockResolvedValueOnce({ invoices: [] });
    var req = makeReq(null, { number: 'INV-000999' }, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    customerByNumberHandler(req, res);
    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res._json.error).toBe('not_found');
      expect(zohoApi.zohoGet).toHaveBeenCalledTimes(1);
    });
  });

  // ── 404-exact-match-reject ───────────────────────────────────────────────
  test('404 not_found when returned doc invoice_number does not match requested number', function () {
    // Zoho returns a doc whose invoice_number differs from the requested number
    zohoApi.zohoGet.mockResolvedValueOnce({
      invoices: [{
        invoice_id: 'INV-ID-FUZZY',
        invoice_number: 'INV-0009990',  // different from requested INV-000999
        customer_id: 'CUST-FUZZY',
        customer_name: 'Wrong Customer',
        status: 'sent'
      }]
    });
    var req = makeReq(null, { number: 'INV-000999' }, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    customerByNumberHandler(req, res);
    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res._json.error).toBe('not_found');
      // Contact fetch must NOT have been called
      expect(zohoApi.zohoGet).toHaveBeenCalledTimes(1);
    });
  });

  // ── success-with-email-fallback (D-07) ───────────────────────────────────
  test('success: returns customer_name, customer_email (contact_person fallback D-07), customer_phone, document fields', function () {
    zohoApi.zohoGet
      .mockResolvedValueOnce({ invoices: [{
        invoice_id: 'INV-ID-1',
        invoice_number: 'INV-000001',
        customer_id: 'CUST-1',
        customer_name: 'Anne MacDougall',
        status: 'sent'
      }] })
      .mockResolvedValueOnce({ contact: {
        email: '',  // blank top-level — D-07 fallback case
        contact_persons: [{
          email: 'anne@example.com',
          phone: '604-555-0100',
          mobile: '',
          is_primary_contact: true
        }]
      } });
    var req = makeReq(null, { number: 'INV-000001' }, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    customerByNumberHandler(req, res);
    return flushPromises().then(function () {
      // Implicit 200 — status must NOT have been called
      expect(res.status).not.toHaveBeenCalled();
      expect(res._json.customer_name).toBe('Anne MacDougall');
      expect(res._json.customer_email).toBe('anne@example.com');  // D-07 fallback
      expect(res._json.customer_phone).toBe('604-555-0100');
      expect(res._json.customer_id).toBe('CUST-1');
      expect(res._json.document_number).toBe('INV-000001');
      expect(res._json.document_status).toBe('sent');
      expect(res._json.contact_unavailable).toBeUndefined();
    });
  });

  // ── phone-mobile-fallback (D-04) ─────────────────────────────────────────
  test('phone mobile fallback: uses mobile when phone is blank (D-04)', function () {
    zohoApi.zohoGet
      .mockResolvedValueOnce({ invoices: [{
        invoice_id: 'INV-ID-2',
        invoice_number: 'INV-000002',
        customer_id: 'CUST-2',
        customer_name: 'Bob Smith',
        status: 'paid'
      }] })
      .mockResolvedValueOnce({ contact: {
        email: 'bob@example.com',
        contact_persons: [{
          email: 'bob@example.com',
          phone: '',         // blank phone
          mobile: '778-999-0001',  // mobile present
          is_primary_contact: true
        }]
      } });
    var req = makeReq(null, { number: 'INV-000002' }, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    customerByNumberHandler(req, res);
    return flushPromises().then(function () {
      expect(res.status).not.toHaveBeenCalled();
      expect(res._json.customer_phone).toBe('778-999-0001');  // D-04 mobile fallback
    });
  });

  // ── SO-routing (D-05) ───────────────────────────────────────────────────
  test('SO routing: SO- number calls /salesorders with salesorder_number filter and reads data.salesorders', function () {
    zohoApi.zohoGet
      .mockResolvedValueOnce({ salesorders: [{
        salesorder_id: 'SO-ID-1',
        salesorder_number: 'SO-1',
        customer_id: 'CUST-SO-1',
        customer_name: 'Charlie Brew',
        status: 'open'
      }] })
      .mockResolvedValueOnce({ contact: {
        email: 'charlie@example.com',
        contact_persons: []
      } });
    var req = makeReq(null, { number: 'SO-1' }, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    customerByNumberHandler(req, res);
    return flushPromises().then(function () {
      expect(res.status).not.toHaveBeenCalled();
      // Verify first Zoho call uses /salesorders with salesorder_number param
      var firstCall = zohoApi.zohoGet.mock.calls[0];
      expect(firstCall[0]).toBe('/salesorders');
      expect(firstCall[1]).toEqual({ salesorder_number: 'SO-1' });
      expect(res._json.customer_name).toBe('Charlie Brew');
      expect(res._json.document_number).toBe('SO-1');
      expect(res._json.document_status).toBe('open');
    });
  });

  // ── partial-200-contact-fail (D-15) ─────────────────────────────────────
  test('partial 200: document resolves but second zohoGet (contact) rejects — returns customer_name with null email/phone and contact_unavailable: true', function () {
    zohoApi.zohoGet
      .mockResolvedValueOnce({ invoices: [{
        invoice_id: 'INV-ID-3',
        invoice_number: 'INV-000003',
        customer_id: 'CUST-3',
        customer_name: 'Diana Prince',
        status: 'paid'
      }] })
      .mockRejectedValueOnce(new Error('Contact not found'));
    var req = makeReq(null, { number: 'INV-000003' }, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    customerByNumberHandler(req, res);
    return flushPromises().then(function () {
      // Should be 200 (implicit) — status must NOT have been called
      expect(res.status).not.toHaveBeenCalled();
      expect(res._json.customer_name).toBe('Diana Prince');
      expect(res._json.customer_email).toBeNull();
      expect(res._json.customer_phone).toBeNull();
      expect(res._json.contact_unavailable).toBe(true);
      expect(res._json.document_number).toBe('INV-000003');
      expect(res._json.document_status).toBe('paid');
    });
  });

  // ── 502-zoho-error ───────────────────────────────────────────────────────
  test('502 zoho_error when the first zohoGet rejects', function () {
    zohoApi.zohoGet.mockRejectedValue(new Error('Zoho down'));
    var req = makeReq(null, { number: 'INV-000004' }, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    customerByNumberHandler(req, res);
    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(502);
      expect(res._json.error).toBe('zoho_error');
    });
  });
});
