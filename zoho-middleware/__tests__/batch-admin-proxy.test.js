'use strict';

// Phase 76-02: the single allow-listed Apps-Script proxy BrewPad's batch/
// dashboard/reading/schedule reads AND writes funnel through. Asserts:
//   (1) a valid session credential + allow-listed action forwards
//       {action, ...params, server_token} to Apps Script with any
//       client-supplied `token` field stripped;
//   (2) an action outside the hardcoded allow-list is rejected 400
//       {ok:false,error:'invalid_action'} with Apps Script never called;
//   (3) NO credential -> 401, Apps Script never called (requireTiers
//       rejects synchronously before any upstream call);
//   (4) an axios rejection on an otherwise-valid request surfaces as 502,
//       never an unhandled throw;
//   (5) a device-token-only credential is rejected — BrewPad's proxy
//       excludes the kiosk device tier (session/legacy only).
//
// Mirrors __tests__/appsscript-proxy-auth-cache.test.js's mock-express-router
// + mock-axios harness (M8, Phase 52-05): lib/authTiers / lib/apiKey /
// lib/deviceToken are NOT mocked so the real tier gate runs end-to-end.
// lib/session IS mocked (mock-mirrors-real-contract, same as
// __tests__/pos-auth-tier.test.js) purely to avoid a real Redis dial from
// session.getSession's cache fallthrough — it does not weaken the auth
// assertions since resolveTier/requireTiers themselves are real.

var mockRouteHandlers = {};

jest.mock('express', function () {
  var router = {
    get:    jest.fn(function (path, handler) { mockRouteHandlers['GET:' + path] = handler; }),
    post:   jest.fn(function (path, handler) { mockRouteHandlers['POST:' + path] = handler; }),
    put:    jest.fn(function (path, handler) { mockRouteHandlers['PUT:' + path] = handler; }),
    delete: jest.fn(function (path, handler) { mockRouteHandlers['DELETE:' + path] = handler; })
  };
  var express = function () {};
  express.Router = function () { return router; };
  return express;
});

jest.mock('axios', function () {
  return { get: jest.fn(), post: jest.fn() };
});

jest.mock('../lib/logger', function () {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
});

jest.mock('../lib/eventLog', function () {
  return { logEvent: jest.fn() };
});

jest.mock('../lib/cache', function () {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    isConnected: jest.fn().mockReturnValue(false)
  };
});

jest.mock('../lib/mailer', function () { return { sendBottlingInvite: jest.fn().mockResolvedValue() }; });
jest.mock('../lib/inventory-ledger', function () { return { decrementStock: jest.fn().mockResolvedValue() }; });
jest.mock('../lib/brewpad-integration', function () {
  return {
    detectKitItems: jest.fn(),
    kitBatchQuantity: jest.fn(),
    callAppsScriptCreateBatch: jest.fn(),
    splitCustomerName: jest.fn(),
    syncBatchToZoho: jest.fn().mockResolvedValue({ ok: true }),
    createBatchesFromSale: jest.fn(),
    retryPendingBatches: jest.fn().mockResolvedValue(),
    detectRecipeSale: jest.fn(),
    queueSyncForRetry: jest.fn().mockResolvedValue(),
    retrySyncQueue: jest.fn().mockResolvedValue(),
    resolveInvoiceByNumber: jest.fn(),
    fetchLiveBatchIndex: jest.fn()
  };
});
jest.mock('../lib/zoho-api', function () {
  return { zohoGet: jest.fn(), zohoPost: jest.fn(), zohoPut: jest.fn() };
});
jest.mock('../lib/helcim', function () {
  return {
    isTerminalEnabled: jest.fn().mockReturnValue(false),
    terminalPurchase: jest.fn().mockResolvedValue({ ok: true }),
    pollTerminalResult: jest.fn().mockResolvedValue({ status: 'APPROVED' }),
    generateIdempotencyKey: jest.fn().mockReturnValue('test-idem-key'),
    voidTransaction: jest.fn().mockResolvedValue({ ok: true })
  };
});

// lib/session — mock-mirrors-real-contract: getSession(sid) -> Promise<{email}|null>.
// authTiers.resolveTier itself is real; only its session-store dependency is
// stubbed (matches __tests__/pos-auth-tier.test.js's approach).
jest.mock('../lib/session', function () {
  return {
    createSession: jest.fn().mockResolvedValue('mock-sid'),
    getSession: jest.fn().mockResolvedValue(null),
    destroySession: jest.fn().mockResolvedValue(),
    touchSession: jest.fn().mockResolvedValue(null)
  };
});

var session = require('../lib/session');

require('../routes/pos');

var axios = require('axios');

function callHandler(method, path, req) {
  return new Promise(function (resolve, reject) {
    var key = method + ':' + path;
    var handler = mockRouteHandlers[key];
    if (!handler) return reject(new Error('No handler registered for ' + key));
    var res = {
      _status: 200,
      _body: null,
      status: jest.fn(function (s) { res._status = s; return res; }),
      json:   jest.fn(function (b) { res._body = b; resolve(res); return res; })
    };
    try {
      var maybe = handler(req || {}, res);
      if (maybe && typeof maybe.catch === 'function') maybe.catch(reject);
    } catch (e) { reject(e); }
  });
}

var OLD_API_SECRET_KEY, OLD_MW_API_KEY, OLD_DEVICE_TOKEN;

beforeEach(function () {
  OLD_API_SECRET_KEY = process.env.API_SECRET_KEY;
  OLD_MW_API_KEY = process.env.MW_API_KEY;
  OLD_DEVICE_TOKEN = process.env.KIOSK_DEVICE_TOKEN;
  delete process.env.API_SECRET_KEY;
  delete process.env.MW_API_KEY;
  process.env.KIOSK_DEVICE_TOKEN = 'test-device-token';
  process.env.APPS_SCRIPT_URL = 'https://script.google.com/test';
  process.env.APPS_SCRIPT_SERVER_TOKEN = 'test-server-token';
  session.getSession.mockReset();
  session.getSession.mockResolvedValue(null);
  axios.post.mockReset();
  axios.get.mockReset();
});

afterEach(function () {
  process.env.API_SECRET_KEY = OLD_API_SECRET_KEY;
  process.env.MW_API_KEY = OLD_MW_API_KEY;
  process.env.KIOSK_DEVICE_TOKEN = OLD_DEVICE_TOKEN;
});

var SESSION_HEADERS = { 'x-session-token': 'valid-sid' };
var DEVICE_HEADERS = { 'x-device-token': 'test-device-token' };

describe('POST /api/batch/admin-proxy — auth + allow-list + token-strip (Phase 76-02)', function () {

  test('Test 1: valid session + get_batches (READ) forwards via axios.GET (doGet), strips client token', function () {
    // Reads MUST go to Apps Script doGet (GET) — doPost's server_token allow-list
    // is write-only, so POSTing a read returns "Unknown server action" (the prod
    // dashboard outage). Reflects the fixed read/write split, not the old POST-all.
    session.getSession.mockResolvedValue({ email: 'staff@steinsandvines.ca' });
    axios.get.mockResolvedValue({ data: { ok: true, batches: [] } });

    var req = { headers: SESSION_HEADERS, body: { action: 'get_batches', token: 'client-google-token' } };
    return callHandler('POST', '/api/batch/admin-proxy', req).then(function (res) {
      expect(axios.get).toHaveBeenCalledTimes(1);
      expect(axios.post).not.toHaveBeenCalled();
      var forwardedUrl = axios.get.mock.calls[0][0];
      expect(forwardedUrl).toBe(process.env.APPS_SCRIPT_URL);
      var cfg = axios.get.mock.calls[0][1];
      expect(cfg.params.action).toBe('get_batches');
      expect(cfg.params.server_token).toBe(process.env.APPS_SCRIPT_SERVER_TOKEN);
      expect(cfg.params.token).toBeUndefined();
      expect(res._status).not.toBe(400);
      expect(res._status).not.toBe(401);
    });
  });

  test('Test 1b: get_batch_dashboard_summary (READ) routes via axios.GET — the exact prod-outage regression', function () {
    session.getSession.mockResolvedValue({ email: 'staff@steinsandvines.ca' });
    axios.get.mockResolvedValue({ data: { ok: true } });

    var req = { headers: SESSION_HEADERS, body: { action: 'get_batch_dashboard_summary' } };
    return callHandler('POST', '/api/batch/admin-proxy', req).then(function (res) {
      expect(axios.get).toHaveBeenCalledTimes(1);
      expect(axios.post).not.toHaveBeenCalled();
      expect(res._status).not.toBe(400);
      expect(res._status).not.toBe(401);
    });
  });

  test('Test 1c: a WRITE action (update_batch) still forwards via axios.POST (doPost), strips client token', function () {
    session.getSession.mockResolvedValue({ email: 'staff@steinsandvines.ca' });
    axios.post.mockResolvedValue({ data: { ok: true } });

    var req = { headers: SESSION_HEADERS, body: { action: 'update_batch', batch_id: 'B-1', updates: {}, token: 'client-google-token' } };
    return callHandler('POST', '/api/batch/admin-proxy', req).then(function (res) {
      expect(axios.post).toHaveBeenCalledTimes(1);
      expect(axios.get).not.toHaveBeenCalled();
      var payload = JSON.parse(axios.post.mock.calls[0][1]);
      expect(payload.server_token).toBe(process.env.APPS_SCRIPT_SERVER_TOKEN);
      expect(payload.token).toBeUndefined();
      expect(res._status).not.toBe(400);
    });
  });

  test('Test 2: action not in allow-list -> 400 invalid_action, Apps Script never called', function () {
    session.getSession.mockResolvedValue({ email: 'staff@steinsandvines.ca' });

    var req = { headers: SESSION_HEADERS, body: { action: 'nuke_everything' } };
    return callHandler('POST', '/api/batch/admin-proxy', req).then(function (res) {
      expect(res._status).toBe(400);
      expect(res._body).toEqual({ ok: false, error: 'invalid_action' });
      expect(axios.post).not.toHaveBeenCalled();
    });
  });

  test('Test 2b: a second non-allow-listed action (create_recipe) -> 400 invalid_action', function () {
    session.getSession.mockResolvedValue({ email: 'staff@steinsandvines.ca' });

    var req = { headers: SESSION_HEADERS, body: { action: 'create_recipe' } };
    return callHandler('POST', '/api/batch/admin-proxy', req).then(function (res) {
      expect(res._status).toBe(400);
      expect(res._body).toEqual({ ok: false, error: 'invalid_action' });
      expect(axios.post).not.toHaveBeenCalled();
    });
  });

  test('Test 3: NO credential -> 401, Apps Script never called', function () {
    var req = { headers: {}, body: { action: 'get_batches' } };
    return callHandler('POST', '/api/batch/admin-proxy', req).then(function (res) {
      expect(res._status).toBe(401);
      expect(axios.post).not.toHaveBeenCalled();
    });
  });

  test('Test 4: valid session credential + allow-listed action, axios rejects -> 502 server_error', function () {
    session.getSession.mockResolvedValue({ email: 'staff@steinsandvines.ca' });
    axios.post.mockRejectedValue(new Error('ECONNRESET'));

    var req = { headers: SESSION_HEADERS, body: { action: 'update_batch', batch_id: 'B-1', updates: {} } };
    return callHandler('POST', '/api/batch/admin-proxy', req).then(function (res) {
      expect(res._status).toBe(502);
      expect(res._body.ok).toBe(false);
    });
  });

  test('Test 5: device-token-only credential is rejected (session/legacy only, device excluded)', function () {
    var req = { headers: DEVICE_HEADERS, body: { action: 'get_batches' } };
    return callHandler('POST', '/api/batch/admin-proxy', req).then(function (res) {
      expect([401, 403]).toContain(res._status);
      expect(axios.post).not.toHaveBeenCalled();
    });
  });

  test('allow-list covers the two live write flows: create_batch and update_batch_schedule', function () {
    session.getSession.mockResolvedValue({ email: 'staff@steinsandvines.ca' });
    axios.post.mockResolvedValue({ data: { ok: true } });

    var reqCreate = { headers: SESSION_HEADERS, body: { action: 'create_batch' } };
    var reqSchedule = { headers: SESSION_HEADERS, body: { action: 'update_batch_schedule' } };

    return callHandler('POST', '/api/batch/admin-proxy', reqCreate).then(function (res1) {
      expect(res1._status).not.toBe(400);
      return callHandler('POST', '/api/batch/admin-proxy', reqSchedule);
    }).then(function (res2) {
      expect(res2._status).not.toBe(400);
    });
  });
});
