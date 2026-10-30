'use strict';

// Quick task 261029-zq1 Task 4 — GET /health exposes the Zoho Inventory quota
// reading (remaining, limit, resetAt) so the shared-quota state is visible
// without logs. No secrets.
//
// Harness copied from health-database.test.js.

jest.mock('../lib/zohoAuth', function () {
  return { init: jest.fn().mockResolvedValue(), isAuthenticated: jest.fn().mockReturnValue(true) };
});
jest.mock('../lib/validateEnv', function () { return jest.fn(); });
jest.mock('../lib/checkRedis', function () { return jest.fn().mockResolvedValue(); });
jest.mock('../lib/checkMailer', function () { return jest.fn(); });
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
    zohoGet: jest.fn().mockResolvedValue({ salesorders: [] }),
    zohoPut: jest.fn().mockResolvedValue({}),
    inventoryGet: jest.fn().mockResolvedValue({}),
    inventoryPut: jest.fn().mockResolvedValue({}),
    ZOHO_INVENTORY_BASE: 'https://inventory.zoho.com/api/v1'
  };
});
jest.mock('axios', function () { return { post: jest.fn().mockResolvedValue({ data: { ok: true } }) }; });

var mockIsConfigured = jest.fn();
var mockQuery = jest.fn();
jest.mock('../lib/db', function () {
  return {
    isConfigured: function () { return mockIsConfigured(); },
    query: function (text, params) { return mockQuery(text, params); }
  };
});

process.env.API_SECRET_KEY = 'integration-secret';
process.env.MW_API_KEY = 'integration-secret';

var mockQuotaSnapshot = { remaining: 412, limit: 1000, resetAt: '2026-10-30T07:00:00.000Z',
  updatedAt: '2026-10-29T17:00:00.000Z', exhausted: false, exhaustedUntil: null, reserve: 250 };
jest.mock('../lib/zoho-quota', function () {
  return {
    snapshot: jest.fn(function () { return mockQuotaSnapshot; }),
    shouldSkipBackground: jest.fn().mockReturnValue(false),
    isExhausted: jest.fn().mockReturnValue(false),
    hydrate: jest.fn().mockResolvedValue(),
    _setListener: jest.fn()
  };
});

var request = require('supertest');
var app = require('../server');

describe('GET /health — Zoho Inventory quota', function () {
  test('reports remaining, limit, resetAt and exhausted', function () {
    mockIsConfigured.mockReturnValue(false);
    return request(app).get('/health').then(function (res) {
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.quota).toEqual({
        remaining: 412,
        limit: 1000,
        resetAt: '2026-10-30T07:00:00.000Z',
        exhausted: false
      });
    });
  });
});
