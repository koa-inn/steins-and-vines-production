'use strict';

// Phase 90-05 (D-04/D-05, research A5): staff create_batch through the admin
// proxies may only store source 'internal' or 'manual'. Automated sources
// (kiosk, online, zoho_scan, kiosk_recipe) are server-token only.
// Harness mirrors admin-proxy-attribution.test.js.

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
jest.mock('../lib/eventLog', function () { return { logEvent: jest.fn() }; });
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
jest.mock('../lib/session', function () {
  return {
    createSession: jest.fn().mockResolvedValue('mock-sid'),
    getSession: jest.fn().mockResolvedValue({ email: 'staff@example.com' }),
    destroySession: jest.fn().mockResolvedValue(),
    touchSession: jest.fn().mockResolvedValue(null)
  };
});

// PG-mode seam: record what batchProxy().intercept receives, never intercept.
var mockIntercepted = [];
jest.mock('../lib/batch-proxy', function () {
  return {
    intercept: jest.fn(function (action, payload) {
      mockIntercepted.push({ action: action, payload: JSON.parse(JSON.stringify(payload)) });
      return false;
    })
  };
});

var session = require('../lib/session');

require('../routes/pos');

var axios = require('axios');

function callHandler(method, path, req) {
  return new Promise(function (resolve, reject) {
    var handler = mockRouteHandlers[method + ':' + path];
    if (!handler) return reject(new Error('No handler registered for ' + method + ':' + path));
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

var OLD_ENV = {};
var ENV_KEYS = ['API_SECRET_KEY', 'MW_API_KEY', 'KIOSK_DEVICE_TOKEN', 'APPS_SCRIPT_URL', 'APPS_SCRIPT_SERVER_TOKEN'];

beforeEach(function () {
  ENV_KEYS.forEach(function (k) { OLD_ENV[k] = process.env[k]; });
  delete process.env.API_SECRET_KEY;
  delete process.env.MW_API_KEY;
  process.env.KIOSK_DEVICE_TOKEN = 'test-device-token';
  process.env.APPS_SCRIPT_URL = 'https://script.google.com/test';
  process.env.APPS_SCRIPT_SERVER_TOKEN = 'test-server-token';
  session.getSession.mockResolvedValue({ email: 'staff@example.com' });
  axios.post.mockReset();
  axios.get.mockReset();
  axios.post.mockResolvedValue({ data: { ok: true } });
  axios.get.mockResolvedValue({ data: { ok: true } });
  mockIntercepted.length = 0;
});

afterEach(function () {
  ENV_KEYS.forEach(function (k) {
    if (OLD_ENV[k] === undefined) delete process.env[k]; else process.env[k] = OLD_ENV[k];
  });
});

var HEADERS = { 'x-session-token': 'valid-sid' };

function forwarded() {
  expect(axios.post).toHaveBeenCalledTimes(1);
  return JSON.parse(axios.post.mock.calls[0][1]);
}

['/api/batch/admin-proxy', '/api/admin/proxy'].forEach(function (path) {
  // /api/admin/proxy only allows a subset of actions; skip it if it rejects create_batch.
  describe('POST ' + path + ' - create_batch source coercion (Phase 90 D-04/D-05)', function () {
    function post(body) {
      return callHandler('POST', path, { headers: HEADERS, body: body });
    }

    it('keeps source internal', function () {
      return post({ action: 'create_batch', source: 'internal' }).then(function (res) {
        if (res._status === 400) return; // action not on this proxy's allowlist
        expect(forwarded().source).toBe('internal');
      });
    });

    ['kiosk', 'online', 'zoho_scan', 'kiosk_recipe', 'manual', '', 'weird'].forEach(function (src) {
      it('coerces source ' + JSON.stringify(src) + ' to manual', function () {
        return post({ action: 'create_batch', source: src }).then(function (res) {
          if (res._status === 400) return;
          expect(forwarded().source).toBe('manual');
        });
      });
    });

    it('normalises "Internal " (case/whitespace) to internal', function () {
      return post({ action: 'create_batch', source: 'Internal ' }).then(function (res) {
        if (res._status === 400) return;
        expect(forwarded().source).toBe('internal');
      });
    });

    it('leaves an absent source absent (Apps Script defaults to manual)', function () {
      return post({ action: 'create_batch' }).then(function (res) {
        if (res._status === 400) return;
        expect(forwarded()).not.toHaveProperty('source');
      });
    });

    it('does not alter update_batch payloads', function () {
      return post({ action: 'update_batch', batch_id: 'B1', source: 'kiosk' }).then(function () {
        expect(forwarded().source).toBe('kiosk');
      });
    });

    it('passes the coerced payload to batchProxy().intercept', function () {
      return post({ action: 'create_batch', source: 'kiosk' }).then(function (res) {
        if (res._status === 400) return;
        expect(mockIntercepted).toHaveLength(1);
        expect(mockIntercepted[0].action).toBe('create_batch');
        expect(mockIntercepted[0].payload.source).toBe('manual');
      });
    });
  });
});

describe('create_batch is accepted on /api/batch/admin-proxy', function () {
  it('is not rejected as invalid_action (guards the vacuous-pass branch above)', function () {
    return callHandler('POST', '/api/batch/admin-proxy', { headers: HEADERS, body: { action: 'create_batch', source: 'internal' } })
      .then(function (res) {
        expect(res._status).not.toBe(400);
      });
  });
});
