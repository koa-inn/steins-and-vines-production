'use strict';

// Tests for GET /health's database field — Phase 83 Plan 02 Task 3 (D-02).
//
// D-02: a database outage (or absence) at runtime is REPORTED, not fatal —
// /health gains a boolean `database` field but `status` stays 'ok'. Mirrors
// the existing `redis` field exactly (server.js ~:126-143).
//
// Harness mirrors api-key-guard.test.js's supertest mock block (server.js
// requires a long chain of libs at module load; all must be mocked before
// `require('../server')`).

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

var request = require('supertest');
var app = require('../server');

describe('GET /health — database field (D-02)', function () {
  beforeEach(function () {
    mockIsConfigured.mockReset();
    mockQuery.mockReset();
  });

  test('database:false when db.isConfigured() is false; status stays ok', function () {
    mockIsConfigured.mockReturnValue(false);
    return request(app).get('/health').then(function (res) {
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.database).toBe(false);
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  test('database:true when configured and query resolves; status stays ok', function () {
    mockIsConfigured.mockReturnValue(true);
    mockQuery.mockResolvedValue({ rows: [{ '?column?': 1 }] });
    return request(app).get('/health').then(function (res) {
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.database).toBe(true);
      expect(mockQuery).toHaveBeenCalledWith('select 1', undefined);
    });
  });

  test('database:false when configured and query rejects; status stays ok (never fatal)', function () {
    mockIsConfigured.mockReturnValue(true);
    mockQuery.mockRejectedValue(new Error('connection refused'));
    return request(app).get('/health').then(function (res) {
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.database).toBe(false);
    });
  });

  test('database:false within ~3s when the query never settles (timeout race); status stays ok', function () {
    mockIsConfigured.mockReturnValue(true);
    mockQuery.mockReturnValue(new Promise(function () { /* never resolves */ }));
    return request(app).get('/health').then(function (res) {
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.database).toBe(false);
    });
  }, 6000);

  test('existing keys status/authenticated/redis/uptime are still present with the same types', function () {
    mockIsConfigured.mockReturnValue(false);
    return request(app).get('/health').then(function (res) {
      expect(typeof res.body.status).toBe('string');
      expect(typeof res.body.authenticated).toBe('boolean');
      expect(typeof res.body.redis).toBe('boolean');
      expect(typeof res.body.uptime).toBe('number');
      expect(typeof res.body.database).toBe('boolean');
    });
  });
});
