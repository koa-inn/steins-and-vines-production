'use strict';

// ---------------------------------------------------------------------------
// Regression: rate-limit store fails closed on Redis mid-op error (M4) and
// the loopback rate-limit skip is prod-gated (M5) — RESIL-01, phase 52-02.
//
// makeRedisStore.increment() previously returned { totalHits: 0 } whenever
// the Redis client's incr() call threw mid-op OR the client resolved absent
// while isConnected() reported true — silently disabling the limiter instead
// of falling through to the in-process memStore accounting that already
// backs the "Redis fully down" branch. Separately, the loopback skip
// (`{ totalHits: 1 }` for 127.x/::1 keys) ran in every environment, so a
// spoofed `X-Forwarded-For: ::1` could defeat PIN throttling in production.
//
// This suite is a NEW file (does not edit __tests__/redis-failclosed.test.js)
// and asserts both corners return closed (limiter still trips) once fixed.
//
// Modeled on __tests__/redis-failclosed.test.js SECTION 1 — real Express app
// via supertest, cache mocked with controllable isConnected/getClient so the
// "connected but op fails" and "not connected + loopback" states can be
// driven directly without touching the real redis module.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Server-level mocks — must be declared before any require()
// ---------------------------------------------------------------------------

jest.mock('../lib/zohoAuth', function () {
  return {
    init: jest.fn().mockResolvedValue(),
    isAuthenticated: jest.fn().mockReturnValue(true)
  };
});
jest.mock('../lib/validateEnv', function () { return jest.fn(); });
jest.mock('../lib/checkRedis', function () { return jest.fn().mockResolvedValue(); });
jest.mock('../lib/checkMailer', function () { return jest.fn(); });
jest.mock('../lib/brewpad-integration', function () {
  return { syncBatch: jest.fn(), init: jest.fn(), createBatchesFromSale: jest.fn() };
});
jest.mock('node-cron', function () { return { schedule: jest.fn() }; });
jest.mock('@sentry/node', function () {
  return { init: jest.fn(), setupExpressErrorHandler: jest.fn() };
});
jest.mock('../lib/mailerlite', function () {
  return {
    isConfigured: jest.fn().mockReturnValue(false),
    addSubscriber: jest.fn().mockResolvedValue()
  };
});
jest.mock('../lib/eventLog', function () { return { logEvent: jest.fn() }; });
jest.mock('../lib/inventory-ledger', function () {
  return { decrementStock: jest.fn().mockResolvedValue() };
});
jest.mock('../lib/helcim', function () {
  return {
    isEnabled: jest.fn().mockReturnValue(false),
    initializeCheckout: jest.fn().mockResolvedValue({ checkoutToken: 'tok-test' }),
    getDepositAmount: jest.fn().mockReturnValue(10000),
    voidTransaction: jest.fn().mockResolvedValue({ ok: true }),
    getTerminalDiagnostics: jest.fn().mockReturnValue({}),
    getDeviceCode: jest.fn().mockReturnValue(''),
    init: jest.fn(),
    verifyWebhookSignature: jest.fn().mockReturnValue(true)
  };
});
jest.mock('../lib/zoho-api', function () {
  return {
    zohoPost: jest.fn().mockResolvedValue({}),
    zohoGet: jest.fn().mockResolvedValue({}),
    zohoPut: jest.fn().mockResolvedValue({}),
    inventoryGet: jest.fn().mockResolvedValue({}),
    inventoryPut: jest.fn().mockResolvedValue({}),
    ZOHO_INVENTORY_BASE: 'https://inventory.zoho.com/api/v1'
  };
});
jest.mock('../lib/mailer', function () {
  return {
    sendReservationNotification: jest.fn().mockResolvedValue(),
    sendOfflineOrderNotification: jest.fn().mockResolvedValue(),
    sendVoidFailureAlert: jest.fn().mockResolvedValue(),
    sendCustomerConfirmation: jest.fn().mockResolvedValue(),
    sendContactMessage: jest.fn().mockResolvedValue(),
    sendWaitlistNotification: jest.fn().mockResolvedValue()
  };
});
jest.mock('axios', function () {
  return { post: jest.fn().mockResolvedValue({ data: { ok: true } }) };
});
jest.mock('../lib/logger', function () {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
});

// cache mock — isConnected AND getClient are independently controllable
// jest.fn()s so each test can drive exactly the Redis state it needs
// (connected-but-op-fails for M4; not-connected for M5) without touching the
// real redis client.
jest.mock('../lib/cache', function () {
  return {
    isConnected: jest.fn().mockReturnValue(false),
    getClient: jest.fn().mockResolvedValue(null),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    acquireLock: jest.fn().mockResolvedValue(true),
    releaseLock: jest.fn().mockResolvedValue(),
    init: jest.fn().mockResolvedValue()
  };
});

// ---------------------------------------------------------------------------
// App setup — loaded ONCE; NODE_ENV / cache mock state are read at request
// time inside makeRedisStore, so per-test mutation below is safe.
// ---------------------------------------------------------------------------

process.env.API_SECRET_KEY = 'test-key';

var request = require('supertest');
var app = require('../server');
var cacheLib = require('../lib/cache');

var ORIGINAL_NODE_ENV = process.env.NODE_ENV;

afterEach(function () {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  cacheLib.isConnected.mockReturnValue(false);
  cacheLib.getClient.mockResolvedValue(null);
});

// ---------------------------------------------------------------------------
// M4: mid-op Redis error falls through to memStore accounting (never
// totalHits:0) — the limiter must keep tripping even when Redis reports
// connected but the actual INCR op fails.
// ---------------------------------------------------------------------------
describe('Rate-limit store fails closed on mid-op Redis error (M4)', function () {
  test('pinLimiter still trips after 5 attempts when incr() throws mid-op', async function () {
    cacheLib.isConnected.mockReturnValue(true);
    var throwingClient = {
      incr: jest.fn().mockRejectedValue(new Error('READONLY You can\'t write against a read only replica')),
      expire: jest.fn().mockResolvedValue(1),
      ttl: jest.fn().mockResolvedValue(30)
    };
    cacheLib.getClient.mockResolvedValue(throwingClient);

    for (var i = 0; i < 5; i++) {
      var res = await request(app)
        .post('/api/kiosk/verify-pin')
        .set('X-Forwarded-For', '10.4.0.1')
        .set('x-api-key', 'test-key')
        .send({ pin: '0000' });
      expect(res.status).not.toBe(429);
    }
    var blocked = await request(app)
      .post('/api/kiosk/verify-pin')
      .set('X-Forwarded-For', '10.4.0.1')
      .set('x-api-key', 'test-key')
      .send({ pin: '0000' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/PIN/i);
  });

  test('paymentLimiter still trips after 10 attempts when the Redis client is absent while connected', async function () {
    // Race-window corner: isConnected() reports true but getClient() resolves
    // null (e.g. an 'end' event fired between the check and the resolve).
    cacheLib.isConnected.mockReturnValue(true);
    cacheLib.getClient.mockResolvedValue(null);

    for (var i = 0; i < 10; i++) {
      var res = await request(app)
        .post('/api/payment/initialize')
        .set('X-Forwarded-For', '10.4.0.2')
        .set('x-api-key', 'test-key')
        .send({ amount: 50 });
      expect(res.status).not.toBe(429);
    }
    var blocked = await request(app)
      .post('/api/payment/initialize')
      .set('X-Forwarded-For', '10.4.0.2')
      .set('x-api-key', 'test-key')
      .send({ amount: 50 });
    expect(blocked.status).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// M5: loopback rate-limit skip is gated to non-production.
// ---------------------------------------------------------------------------
describe('Rate-limit store loopback skip is prod-gated (M5)', function () {
  test('production: a loopback key (spoofed X-Forwarded-For) accumulates — skip disabled', async function () {
    process.env.NODE_ENV = 'production';
    cacheLib.isConnected.mockReturnValue(false);

    for (var i = 0; i < 5; i++) {
      var res = await request(app)
        .post('/api/kiosk/verify-pin')
        .set('X-Forwarded-For', '127.0.0.1')
        .set('x-api-key', 'test-key')
        .send({ pin: '0000' });
      expect(res.status).not.toBe(429);
    }
    var blocked = await request(app)
      .post('/api/kiosk/verify-pin')
      .set('X-Forwarded-For', '127.0.0.1')
      .set('x-api-key', 'test-key')
      .send({ pin: '0000' });
    expect(blocked.status).toBe(429);
  });

  test('non-production: loopback skip preserved — totalHits:1 always, never trips', async function () {
    process.env.NODE_ENV = 'test';
    cacheLib.isConnected.mockReturnValue(false);

    for (var i = 0; i < 10; i++) {
      var res = await request(app)
        .post('/api/kiosk/verify-pin')
        .set('X-Forwarded-For', '127.0.0.9')
        .set('x-api-key', 'test-key')
        .send({ pin: '0000' });
      expect(res.status).not.toBe(429);
    }
  });
});
