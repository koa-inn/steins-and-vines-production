'use strict';

// Tests for GET /health's database_required field + the DB-down alert —
// Phase 84 Plan 06 Task 2 (D-10).
//
// D-10 revisits Phase 83 D-02: when any store (GIFT_CARDS_STORE/
// RECIPES_STORE) resolves to 'dual' or 'postgres', database_required:true is
// added to the /health body. `status` NEVER flips to anything but 'ok' (no
// Railway restart loop) — D-10 moves the actual gate to the deploy smoke
// check (gated-deploy.yml), not /health. A DB-down alert fires via
// lib/sentry-capture, throttled to once per 10 minutes in-process.
//
// Harness: mirrors health-database.test.js's supertest mock block, but each
// test needs a DIFFERENT GIFT_CARDS_STORE env value, so server.js (and its
// full require chain, incl. lib/store-flag which reads process.env at
// require time) must be freshly required per test via jest.resetModules().
// Outer-scope mock-control functions (mockIsConfigured/mockQuery/
// mockCaptureExceptionSafe) persist across resets, mirroring
// store-flag.test.js's pattern.

var mockIsConfigured = jest.fn();
var mockQuery = jest.fn();
var mockCaptureExceptionSafe = jest.fn();

function freshServer() {
  jest.resetModules();

  jest.mock('../lib/zohoAuth', function () {
    return { init: jest.fn().mockResolvedValue(), isAuthenticated: jest.fn().mockReturnValue(true) };
  });
  jest.mock('../lib/validateEnv', function () { return jest.fn(); });
  jest.mock('../lib/checkRedis', function () { return jest.fn().mockResolvedValue(); });
  jest.mock('../lib/checkMailer', function () { return jest.fn(); });
  jest.mock('../lib/brewpad-integration', function () {
    return { syncBatch: jest.fn(), init: jest.fn(), createBatchesFromSale: jest.fn(), refreshKitSkus: jest.fn().mockResolvedValue(), retryPendingBatches: jest.fn().mockResolvedValue(), retrySyncQueue: jest.fn().mockResolvedValue() };
  });
  jest.mock('node-cron', function () { return { schedule: jest.fn() }; });
  jest.mock('@sentry/node', function () {
    return { init: jest.fn(), setupExpressErrorHandler: jest.fn(), captureException: jest.fn() };
  });
  jest.mock('../lib/sentry-capture', function () {
    return { captureExceptionSafe: function (err, opts) { return mockCaptureExceptionSafe(err, opts); } };
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
  return { request: request, app: app };
}

describe('GET /health — database_required field + DB-down alert (D-10)', function () {
  var SAVED_ENV;

  beforeEach(function () {
    SAVED_ENV = Object.assign({}, process.env);
    delete process.env.GIFT_CARDS_STORE;
    delete process.env.RECIPES_STORE;
    mockIsConfigured.mockReset();
    mockQuery.mockReset();
    mockCaptureExceptionSafe.mockReset();
  });

  afterEach(function () {
    Object.keys(process.env).forEach(function (k) {
      if (!(k in SAVED_ENV)) delete process.env[k];
    });
    Object.keys(SAVED_ENV).forEach(function (k) {
      process.env[k] = SAVED_ENV[k];
    });
  });

  test('all store flags unset -> database_required:false; database:false keeps status ok, no alert', function () {
    mockIsConfigured.mockReturnValue(false);
    var h = freshServer();
    return h.request(h.app).get('/health').then(function (res) {
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.database).toBe(false);
      expect(res.body.database_required).toBe(false);
      expect(mockCaptureExceptionSafe).not.toHaveBeenCalled();
    });
  });

  test('GIFT_CARDS_STORE=dual and DB query fails -> database_required:true, database:false, status ok, one Sentry alert', function () {
    process.env.GIFT_CARDS_STORE = 'dual';
    mockIsConfigured.mockReturnValue(true);
    mockQuery.mockRejectedValue(new Error('connection refused'));
    var h = freshServer();
    return h.request(h.app).get('/health').then(function (res) {
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.database).toBe(false);
      expect(res.body.database_required).toBe(true);
      expect(mockCaptureExceptionSafe).toHaveBeenCalledTimes(1);
      var opts = mockCaptureExceptionSafe.mock.calls[0][1];
      expect(opts.level).toBe('error');
      expect(opts.tags.component).toBe('database');
    });
  });

  test('two /health calls within 10 minutes while down -> only one Sentry alert (in-process throttle)', function () {
    process.env.GIFT_CARDS_STORE = 'dual';
    mockIsConfigured.mockReturnValue(true);
    mockQuery.mockRejectedValue(new Error('connection refused'));
    var h = freshServer();
    return h.request(h.app).get('/health').then(function () {
      return h.request(h.app).get('/health');
    }).then(function (res) {
      expect(res.body.database_required).toBe(true);
      expect(res.body.database).toBe(false);
      expect(mockCaptureExceptionSafe).toHaveBeenCalledTimes(1);
    });
  });

  test('GIFT_CARDS_STORE=postgres and DB up -> database:true, database_required:true, no alert', function () {
    process.env.GIFT_CARDS_STORE = 'postgres';
    mockIsConfigured.mockReturnValue(true);
    mockQuery.mockResolvedValue({ rows: [{ '?column?': 1 }] });
    var h = freshServer();
    return h.request(h.app).get('/health').then(function (res) {
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.database).toBe(true);
      expect(res.body.database_required).toBe(true);
      expect(mockCaptureExceptionSafe).not.toHaveBeenCalled();
    });
  });
});
