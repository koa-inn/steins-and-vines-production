'use strict';

// Phase 94 Plan 05 Task 3: get_dashboard_stats routes only through /api/batch/admin-proxy.
// Same harness as batch-proxy-routes.test.js (authTiers real, session mocked, batch-store mocked).

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

jest.mock('axios', function () { return { get: jest.fn(), post: jest.fn() }; });
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
    detectKitItems: jest.fn(), kitBatchQuantity: jest.fn(), callAppsScriptCreateBatch: jest.fn(),
    splitCustomerName: jest.fn(), syncBatchToZoho: jest.fn().mockResolvedValue({ ok: true }),
    createBatchesFromSale: jest.fn(), retryPendingBatches: jest.fn().mockResolvedValue(),
    detectRecipeSale: jest.fn(), queueSyncForRetry: jest.fn().mockResolvedValue(),
    retrySyncQueue: jest.fn().mockResolvedValue(), resolveInvoiceByNumber: jest.fn(),
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
    getSession: jest.fn().mockResolvedValue(null),
    destroySession: jest.fn().mockResolvedValue(),
    touchSession: jest.fn().mockResolvedValue(null)
  };
});

var mockVesselStore = { getMode: jest.fn(), list: jest.fn(), applyStatusChanges: jest.fn() };
var mockSchedStore = { list: jest.fn(), getStepsJson: jest.fn() };
jest.mock('../lib/vessel-store', function () { return mockVesselStore; });
jest.mock('../lib/ferm-schedule-store', function () { return mockSchedStore; });

var mockBatchStore = { dashStats: jest.fn() };
jest.mock('../lib/batch-store', function () { return mockBatchStore; });

var session = require('../lib/session');
var axios = require('axios');
var batchProxy = require('../lib/batch-proxy');
require('../routes/pos');

function callHandler(path, body, headers) {
  return new Promise(function (resolve, reject) {
    var handler = mockRouteHandlers['POST:' + path];
    if (!handler) return reject(new Error('No handler for ' + path));
    var res = {
      _status: 200, _body: null,
      status: jest.fn(function (s) { res._status = s; return res; }),
      json: jest.fn(function (b) { res._body = b; resolve(res); return res; })
    };
    var req = { headers: headers || { 'x-session-token': 'valid-sid' }, body: body, params: {}, query: {} };
    try { handler(req, res); } catch (e) { reject(e); }
  });
}

var STATS = { ok: true, data: { asOf: { today: '2026-10-27' }, batches: [], tasks: [], latestReadings: [], summary: {} } };

beforeEach(function () {
  delete process.env.API_SECRET_KEY;
  delete process.env.MW_API_KEY;
  delete process.env.BATCHES_STORE;
  delete process.env.BATCHES_FREEZE;
  process.env.APPS_SCRIPT_URL = 'https://script.google.com/test';
  process.env.APPS_SCRIPT_SERVER_TOKEN = 'test-server-token';
  session.getSession.mockReset().mockResolvedValue({ email: 'staff@x.ca' });
  axios.post.mockReset().mockResolvedValue({ data: { ok: false, error: 'invalid_action' } });
  axios.get.mockReset().mockResolvedValue({ data: { ok: false, error: 'invalid_action' } });
  mockVesselStore.getMode.mockReset().mockReturnValue('sheets');
  mockSchedStore.list.mockReset().mockResolvedValue({ ok: true, data: { schedules: [] } });
  mockBatchStore.dashStats.mockReset().mockResolvedValue(STATS);
});

afterEach(function () {
  delete process.env.BATCHES_STORE;
  delete process.env.BATCHES_FREEZE;
});

describe('get_dashboard_stats routing', function () {
  test('postgres + session tier: served by the store, Apps Script untouched', async function () {
    process.env.BATCHES_STORE = 'postgres';
    var res = await callHandler('/api/batch/admin-proxy', { action: 'get_dashboard_stats' });
    expect(res._body).toEqual(STATS);
    expect(mockBatchStore.dashStats).toHaveBeenCalledTimes(1);
    expect(axios.get).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('no auth is rejected and the store is not called', async function () {
    process.env.BATCHES_STORE = 'postgres';
    session.getSession.mockResolvedValue(null);
    var res = await callHandler('/api/batch/admin-proxy', { action: 'get_dashboard_stats' }, {});
    expect(res._status).toBeGreaterThanOrEqual(401);
    expect(mockBatchStore.dashStats).not.toHaveBeenCalled();
  });

  test('sheets mode forwards a GET to Apps Script and skips the store', async function () {
    await callHandler('/api/batch/admin-proxy', { action: 'get_dashboard_stats' });
    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(axios.post).not.toHaveBeenCalled();
    expect(mockBatchStore.dashStats).not.toHaveBeenCalled();
  });

  test('store failure collapses to 502 server_error with no detail', async function () {
    process.env.BATCHES_STORE = 'postgres';
    mockBatchStore.dashStats.mockRejectedValue(new Error('secret db detail'));
    var res = await callHandler('/api/batch/admin-proxy', { action: 'get_dashboard_stats' });
    expect(res._status).toBe(502);
    expect(res._body).toEqual({ ok: false, error: 'server_error' });
  });

  test('/api/admin/proxy does not allowlist it', async function () {
    process.env.BATCHES_STORE = 'postgres';
    var res = await callHandler('/api/admin/proxy', { action: 'get_dashboard_stats' });
    expect(res._status).toBe(400);
    expect(res._body.error).toBe('invalid_action');
    expect(mockBatchStore.dashStats).not.toHaveBeenCalled();
  });

  test('maintenance freeze does not block the read', async function () {
    process.env.BATCHES_STORE = 'postgres';
    process.env.BATCHES_FREEZE = '1';
    var res = await callHandler('/api/batch/admin-proxy', { action: 'get_dashboard_stats' });
    expect(res._body).toEqual(STATS);
  });

  test('maps are shaped as pinned', function () {
    expect(Object.keys(batchProxy.ACTION_TO_OP)).toHaveLength(17);
    expect(batchProxy.STATS_ACTION_TO_OP).toEqual({ get_dashboard_stats: 'dashStats' });
    expect(batchProxy.WRITE_ACTIONS.get_dashboard_stats).toBeUndefined();
  });
});
