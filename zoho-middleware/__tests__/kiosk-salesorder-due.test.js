'use strict';

// Integration tests for the 46-04 pos.js in-route tier migration (T-46-18,
// T-46-18b, T-46-18c, T-46-03b, T-46-19). Proves the SECOND enforcement
// layer (the in-route requireTiers wrap inside pos.js/consignment.js) does
// not silently re-require the retired legacy key once API_SECRET_KEY is
// rotated — the kiosk device token must keep working on kiosk-scoped
// routes, and admin/BrewPad routes must keep rejecting a device token even
// though the global 46-03 guard already lets GETs through unauthenticated.
//
// Mirrors __tests__/auth-tiers-guard.test.js's mock roster (full app require
// via supertest) — same approach, extended coverage of pos.js routes.

// ---------------------------------------------------------------------------
// Mocks — must be declared before the app require.
// ---------------------------------------------------------------------------
jest.mock('../lib/zohoAuth', function () {
  return { init: jest.fn().mockResolvedValue(), isAuthenticated: jest.fn().mockReturnValue(true) };
});
jest.mock('../lib/validateEnv', function () { return jest.fn(); });
jest.mock('../lib/checkRedis', function () { return jest.fn().mockResolvedValue(); });
jest.mock('../lib/checkMailer', function () { return jest.fn(); });
jest.mock('../lib/limited-releases-deposit', function () {
  var actual = jest.requireActual('../lib/limited-releases-deposit');
  return Object.assign({}, actual, { findDepositAdvanceForSalesOrder: jest.fn() });
});
jest.mock('../lib/brewpad-integration', function () {
  return { syncBatch: jest.fn(), init: jest.fn(), createBatchesFromSale: jest.fn() };
});
jest.mock('node-cron', function () { return { schedule: jest.fn() }; });
jest.mock('@sentry/node', function () {
  return { init: jest.fn(), setupExpressErrorHandler: jest.fn(), captureException: jest.fn() };
});
jest.mock('../lib/mailerlite', function () {
  return { isConfigured: jest.fn().mockReturnValue(false), addSubscriber: jest.fn().mockResolvedValue() };
});
jest.mock('../lib/eventLog', function () { return { logEvent: jest.fn() }; });
jest.mock('../lib/inventory-ledger', function () { return { decrementStock: jest.fn().mockResolvedValue() }; });
jest.mock('../lib/cache', function () {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    acquireLock: jest.fn().mockResolvedValue(true),
    isConnected: jest.fn().mockReturnValue(false),
    init: jest.fn().mockResolvedValue(),
    getClient: jest.fn().mockResolvedValue(null)
  };
});
jest.mock('../lib/zoho-api', function () {
  return {
    zohoPost: jest.fn().mockResolvedValue({}),
    zohoGet: jest.fn().mockResolvedValue({ salesorders: [], invoices: [], contacts: [] }),
    zohoPut: jest.fn().mockResolvedValue({}),
    inventoryGet: jest.fn().mockResolvedValue({}),
    inventoryPut: jest.fn().mockResolvedValue({}),
    ZOHO_INVENTORY_BASE: 'https://inventory.zoho.com/api/v1'
  };
});
jest.mock('axios', function () { return { post: jest.fn().mockResolvedValue({ data: { ok: true } }), get: jest.fn().mockResolvedValue({ data: { ok: true, data: { batches: [] } } }) }; });

// lib/session — mock-mirrors-real-contract: getSession(sid) -> Promise<{email}|null>.
jest.mock('../lib/session', function () {
  return {
    createSession: jest.fn().mockResolvedValue('mock-sid'),
    getSession: jest.fn().mockResolvedValue(null),
    destroySession: jest.fn().mockResolvedValue(),
    touchSession: jest.fn().mockResolvedValue(null)
  };
});

// lib/deviceToken — mock-mirrors-real-contract: matches(sent) is true only when
// sent === KIOSK_DEVICE_TOKEN and non-empty (fail closed when unset).
jest.mock('../lib/deviceToken', function () {
  return {
    getKey: function () { return process.env.KIOSK_DEVICE_TOKEN || ''; },
    matches: function (sent) {
      var key = process.env.KIOSK_DEVICE_TOKEN || '';
      return !!key && typeof sent === 'string' && sent === key;
    }
  };
});

process.env.API_SECRET_KEY = 'integration-secret';
process.env.MW_API_KEY = 'integration-secret';
process.env.KIOSK_DEVICE_TOKEN = 'integration-device-token';

var request = require('supertest');
var app = require('../server');
var zohoApi = require('../lib/zoho-api');
var deposit = require('../lib/limited-releases-deposit');

var DEVICE_TOKEN = 'integration-device-token';

function wire(so, advance) {
  zohoApi.zohoGet.mockReset();
  zohoApi.zohoPost.mockClear();
  zohoApi.zohoPut.mockClear();
  zohoApi.zohoGet.mockImplementation(function (path) {
    if (path === '/salesorders/123') return Promise.resolve({ salesorder: so });
    return Promise.resolve({});
  });
  deposit.findDepositAdvanceForSalesOrder.mockResolvedValue(advance);
}

describe('GET /api/kiosk/salesorder-due (Phase 100 D-02 preview)', function () {
  test('LIMITED SO: 280 total, 50 unused advance -> due 230, no Zoho writes', function () {
    wire({ salesorder_id: '123', reference_number: 'LIMITED-2026-27', total: 280, balance: 280, invoices: [] },
      { unused_amount: 50 });
    return request(app).get('/api/kiosk/salesorder-due?salesorder_id=123')
      .set('x-device-token', DEVICE_TOKEN)
      .then(function (res) {
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ salesorder_id: '123', is_limited_release: true, base: 280, deposit_applied: 50, due: 230 });
        expect(zohoApi.zohoPost).toHaveBeenCalledTimes(0);
        expect(zohoApi.zohoPut).toHaveBeenCalledTimes(0);
      });
  });

  test('non-LIMITED SO: due is the SO balance, no deposit', function () {
    wire({ salesorder_id: '123', reference_number: '', total: 100, balance: '75.5' }, null);
    return request(app).get('/api/kiosk/salesorder-due?salesorder_id=123')
      .set('x-device-token', DEVICE_TOKEN)
      .then(function (res) {
        expect(res.status).toBe(200);
        expect(res.body.is_limited_release).toBe(false);
        expect(res.body.deposit_applied).toBe(0);
        expect(res.body.due).toBe(75.5);
      });
  });

  test('missing or non-numeric salesorder_id -> 400', function () {
    return request(app).get('/api/kiosk/salesorder-due').set('x-device-token', DEVICE_TOKEN)
      .then(function (res) {
        expect(res.status).toBe(400);
        return request(app).get('/api/kiosk/salesorder-due?salesorder_id=12a').set('x-device-token', DEVICE_TOKEN);
      })
      .then(function (res) { expect(res.status).toBe(400); });
  });

  test('Zoho lookup failure -> 502', function () {
    zohoApi.zohoGet.mockReset();
    zohoApi.zohoGet.mockRejectedValue(new Error('zoho down'));
    return request(app).get('/api/kiosk/salesorder-due?salesorder_id=123')
      .set('x-device-token', DEVICE_TOKEN)
      .then(function (res) {
        expect(res.status).toBe(502);
        expect(res.body.error).toBeTruthy();
      });
  });

  test('no credential -> 401 like /api/kiosk/salesorders', function () {
    return request(app).get('/api/kiosk/salesorder-due?salesorder_id=123')
      .then(function (res) { expect(res.status).toBe(401); });
  });
});
