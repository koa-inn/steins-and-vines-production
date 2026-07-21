'use strict';

// ---------------------------------------------------------------------------
// Tests for POST /api/batch/bottling-invite
// ---------------------------------------------------------------------------

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
  sendVoidFailureAlert: jest.fn().mockResolvedValue(),
  sendBottlingInvite: jest.fn().mockResolvedValue({ id: 'email_abc' })
}; });
jest.mock('../lib/inventory-ledger', function () { return {
  decrementStock: jest.fn().mockResolvedValue()
}; });

jest.mock('axios', function () { return { post: jest.fn() }; });

jest.mock('../lib/checkout-helpers', function () { return {
  buildContactPayload: jest.fn(),
  buildLineItems: jest.fn(),
  readServicesSnapshot: jest.fn(),
  readIngredientsFileCache: jest.fn(),
  withTimeout: jest.fn(),
  verifyRecaptcha: jest.fn(),
  notifyAdminPanel: jest.fn(),
  findMakersFeeItem: jest.fn(),
  findMaterialsFeeItem: jest.fn()
}; });

jest.mock('../lib/brewpad-integration', function () { return {
  createBatch: jest.fn().mockResolvedValue({ ok: true }),
  retryQueuedBatches: jest.fn().mockResolvedValue(),
  syncBatchToZoho: jest.fn().mockResolvedValue({ ok: true }),
  retryPendingBatches: jest.fn().mockResolvedValue(),
  retrySyncQueue: jest.fn().mockResolvedValue()
}; });

var mailer = require('../lib/mailer');
var eventLog = require('../lib/eventLog');
var log = require('../lib/logger');
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
// POST /api/batch/bottling-invite
// ---------------------------------------------------------------------------
describe('POST /api/batch/bottling-invite', function () {
  var OLD_MW_KEY;
  var handler;

  var OLD_SECRET_KEY;
  var OLD_APPS_URL;
  var OLD_APPS_TOKEN;

  beforeEach(function () {
    jest.clearAllMocks();
    OLD_MW_KEY = process.env.MW_API_KEY;
    OLD_SECRET_KEY = process.env.API_SECRET_KEY;
    OLD_APPS_URL = process.env.APPS_SCRIPT_URL;
    OLD_APPS_TOKEN = process.env.APPS_SCRIPT_SERVER_TOKEN;
    process.env.MW_API_KEY = 'test-api-key';
    process.env.APPS_SCRIPT_URL = 'https://apps-script.example/exec';
    process.env.APPS_SCRIPT_SERVER_TOKEN = 'server-token-xyz';
    // The guard now resolves API_SECRET_KEY || MW_API_KEY; clear the primary so
    // this file deterministically owns the key via the alias (no cross-file bleed).
    delete process.env.API_SECRET_KEY;
    handler = findHandler('post', '/api/batch/bottling-invite');
    mailer.sendBottlingInvite.mockResolvedValue({ id: 'email_abc' });
    axios.post.mockResolvedValue({ data: { ok: true, newVersion: '2026-07-17T00:00:00.000Z' } });
  });

  afterEach(function () {
    process.env.MW_API_KEY = OLD_MW_KEY;
    if (OLD_SECRET_KEY === undefined) delete process.env.API_SECRET_KEY;
    else process.env.API_SECRET_KEY = OLD_SECRET_KEY;
    if (OLD_APPS_URL === undefined) delete process.env.APPS_SCRIPT_URL;
    else process.env.APPS_SCRIPT_URL = OLD_APPS_URL;
    if (OLD_APPS_TOKEN === undefined) delete process.env.APPS_SCRIPT_SERVER_TOKEN;
    else process.env.APPS_SCRIPT_SERVER_TOKEN = OLD_APPS_TOKEN;
  });

  // ── 401 ──────────────────────────────────────────────────────────────────
  it('returns 401 when no api key provided', function () {
    var req = makeReq({ email: 'jane@example.com', batchId: 'SV-B-000001', name: 'Jane', productName: 'Pinot' }, {}, {});
    var res = makeRes();
    handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res._json).toMatchObject({ error: 'Unauthorized' });
    expect(mailer.sendBottlingInvite).not.toHaveBeenCalled();
  });

  it('returns 401 when wrong api key provided', function () {
    var req = makeReq({ email: 'jane@example.com', batchId: 'SV-B-000001', name: 'Jane', productName: 'Pinot' }, {}, { 'x-api-key': 'wrong-key' });
    var res = makeRes();
    handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mailer.sendBottlingInvite).not.toHaveBeenCalled();
  });

  // ── 400 ──────────────────────────────────────────────────────────────────
  it('returns 400 when email is missing', function () {
    var req = makeReq({ batchId: 'SV-B-000001', name: 'Jane', productName: 'Pinot' }, {}, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res._json).toMatchObject({ error: expect.stringMatching(/email/i) });
    expect(mailer.sendBottlingInvite).not.toHaveBeenCalled();
  });

  it('returns 400 when email is invalid', function () {
    var req = makeReq({ email: 'notanemail', batchId: 'SV-B-000001', name: 'Jane', productName: 'Pinot' }, {}, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res._json).toMatchObject({ error: expect.stringMatching(/email/i) });
    expect(mailer.sendBottlingInvite).not.toHaveBeenCalled();
  });

  it('returns 400 when batchId is missing', function () {
    var req = makeReq({ email: 'jane@example.com', name: 'Jane', productName: 'Pinot' }, {}, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res._json).toMatchObject({ error: expect.stringMatching(/batchId/i) });
    expect(mailer.sendBottlingInvite).not.toHaveBeenCalled();
  });

  // ── Happy path ────────────────────────────────────────────────────────────
  it('calls sendBottlingInvite with correct params and returns {success:true}', function () {
    var req = makeReq({
      email: 'jane@example.com',
      name: 'Jane Doe',
      batchId: 'SV-B-000001',
      productName: 'Pinot Noir'
    }, {}, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    handler(req, res);

    return flushPromises().then(function () {
      expect(mailer.sendBottlingInvite).toHaveBeenCalledWith({
        name: 'Jane Doe',
        email: 'jane@example.com',
        batchId: 'SV-B-000001',
        productName: 'Pinot Noir'
      });
      expect(res._json).toMatchObject({ success: true });
      expect(res.status).not.toHaveBeenCalled(); // 200 by default
    });
  });

  it('logs a batch.bottling_invite_sent event on success', function () {
    var req = makeReq({
      email: 'jo@example.com',
      name: 'Jo',
      batchId: 'SV-B-000007',
      productName: 'Beer Kit'
    }, {}, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    handler(req, res);

    return flushPromises().then(function () {
      expect(eventLog.logEvent).toHaveBeenCalledWith('batch.bottling_invite_sent', { batchId: 'SV-B-000007' });
    });
  });

  // ── Send-tracking stamp ─────────────────────────────────────────────────────
  it('stamps bottling_invite_sent_at + email via update_batch and returns sent_at', function () {
    var req = makeReq({
      email: 'jane@example.com',
      name: 'Jane Doe',
      batchId: 'SV-B-000001',
      productName: 'Pinot Noir'
    }, {}, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    handler(req, res);

    return flushPromises().then(function () {
      expect(res._json).toMatchObject({ success: true });
      expect(typeof res._json.sent_at).toBe('string');

      expect(axios.post).toHaveBeenCalledTimes(1);
      var call = axios.post.mock.calls[0];
      expect(call[0]).toBe('https://apps-script.example/exec');
      var payload = JSON.parse(call[1]);
      expect(payload).toMatchObject({
        action: 'update_batch',
        server_token: 'server-token-xyz',
        batch_id: 'SV-B-000001',
        updates: {
          bottling_invite_sent_at: res._json.sent_at,
          bottling_invite_email: 'jane@example.com'
        }
      });
      // Advisory stamp — no optimistic lock is sent.
      expect(payload.expectedVersion).toBeUndefined();
    });
  });

  it('still returns success when the stamp update_batch fails', function () {
    axios.post.mockRejectedValue(new Error('Apps Script 500'));
    var req = makeReq({
      email: 'jane@example.com',
      name: 'Jane',
      batchId: 'SV-B-000001',
      productName: 'Pinot'
    }, {}, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    handler(req, res);

    return flushPromises().then(function () {
      expect(res._json).toMatchObject({ success: true });
      expect(res.status).not.toHaveBeenCalledWith(500);
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('[batch/bottling-invite]'));
    });
  });

  it('skips the stamp (no throw) when APPS_SCRIPT_URL is unset', function () {
    delete process.env.APPS_SCRIPT_URL;
    var req = makeReq({
      email: 'jane@example.com',
      name: 'Jane',
      batchId: 'SV-B-000001',
      productName: 'Pinot'
    }, {}, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    handler(req, res);

    return flushPromises().then(function () {
      expect(res._json).toMatchObject({ success: true });
      expect(axios.post).not.toHaveBeenCalled();
    });
  });

  // ── 500 on send failure ───────────────────────────────────────────────────
  it('returns 500 and logs error when sendBottlingInvite rejects', function () {
    mailer.sendBottlingInvite.mockRejectedValue(new Error('Resend API down'));
    var req = makeReq({
      email: 'jane@example.com',
      name: 'Jane',
      batchId: 'SV-B-000001',
      productName: 'Pinot'
    }, {}, { 'x-api-key': 'test-api-key' });
    var res = makeRes();
    handler(req, res);

    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res._json).toMatchObject({ error: 'Failed to send bottling invite' });
      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('[batch/bottling-invite]'));
    });
  });

  // ── rejects api_key in the URL (#2: header-only, no key-in-URL) ────────────
  it('rejects api_key supplied as a query param (header-only)', function () {
    var req = makeReq({
      email: 'jane@example.com',
      name: 'Jane',
      batchId: 'SV-B-000001',
      productName: 'Pinot'
    }, { api_key: 'test-api-key' }, {});
    var res = makeRes();
    handler(req, res);

    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res._json).toMatchObject({ error: 'Unauthorized' });
      expect(mailer.sendBottlingInvite).not.toHaveBeenCalled();
    });
  });
});
