'use strict';

// ---------------------------------------------------------------------------
// Redis-outage fail-closed policy — 45-03
//
// Two groups of tests:
//
// 1. Rate limiter fail-closed (Task 1 — D-06/D-07):
//    security-critical limiters (pin, payment, api) must count in-process
//    when Redis is down, not skip counting entirely.
//
// 2. acquireLock in-process fallback (Task 2 — D-06):
//    acquireLock must serialize a double-tap per-process when Redis is down,
//    not silently return true for every caller.
//
// Why a separate file: the rate limiter section needs the real Express app
// wired via supertest (to exercise the middleware chain) while the acquireLock
// section needs the REAL cache module (not the server-level mock) to test
// in-process locking semantics. Both concerns live here to keep the
// Redis-outage policy tests co-located.
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
  return { init: jest.fn(), setupExpressErrorHandler: jest.fn(), captureException: jest.fn() };
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

// cache mock — isConnected is a controllable jest.fn().
// Default: false (Redis down). Rate limiter tests override per describe.
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

// redis mock — used by the acquireLock unit tests (Section 2).
// By default createClient returns a client whose connect() rejects, so
// the real cache module stays disconnected (connected = false).
jest.mock('redis', function () {
  return {
    createClient: jest.fn(function () {
      return {
        on: jest.fn(),
        connect: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
        set: jest.fn().mockResolvedValue('OK'),
        del: jest.fn().mockResolvedValue(1),
        quit: jest.fn().mockResolvedValue(undefined)
      };
    })
  };
});
jest.mock('../lib/logger', function () {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
});

// ---------------------------------------------------------------------------
// App setup — loaded ONCE for rate limiter tests (Section 1)
// ---------------------------------------------------------------------------

process.env.API_SECRET_KEY = 'test-key';

var request = require('supertest');
var app = require('../server');
var cacheLib = require('../lib/cache');

// ---------------------------------------------------------------------------
// SECTION 1: Rate limiter fail-closed policy (Task 1 — D-06/D-07)
//
// With skip:redisUnavailableSkip REMOVED from security-critical limiters and
// makeRedisStore returning in-process counts when !isConnected(), the limiter
// must still throttle requests even when Redis is down.
//
// Each test uses a unique X-Forwarded-For IP to isolate in-process counters
// between tests (trust proxy: 1 means req.ip comes from X-Forwarded-For).
// ---------------------------------------------------------------------------

describe('Rate limiter fail-closed: in-process counting when Redis is down', function () {
  afterEach(function () {
    // Reset to default (Redis down) after each test
    cacheLib.isConnected.mockReturnValue(false);
  });

  // -------------------------------------------------------------------------
  // Test 1 (RED): pinLimiter must throttle when Redis is down.
  // Before the fix: skip:redisUnavailableSkip bypasses counting entirely —
  // all requests pass. After the fix: in-process Map counts → 6th returns 429.
  // -------------------------------------------------------------------------
  test('pinLimiter returns 429 after 5 verify-pin attempts with Redis down (D-07)', async function () {
    // Requests 1-5: limiter should allow (in-process count 1..5 ≤ max:5)
    for (var i = 0; i < 5; i++) {
      var res = await request(app)
        .post('/api/kiosk/verify-pin')
        .set('X-Forwarded-For', '10.1.0.1')
        .set('x-api-key', 'test-key')
        .send({ pin: '0000' });
      expect(res.status).not.toBe(429);
    }
    // Request 6: count exceeds max:5 → rate limiter returns 429
    var blocked = await request(app)
      .post('/api/kiosk/verify-pin')
      .set('X-Forwarded-For', '10.1.0.1')
      .set('x-api-key', 'test-key')
      .send({ pin: '0000' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/PIN/i);
  });

  // -------------------------------------------------------------------------
  // Test 2 (RED): paymentLimiter must throttle when Redis is down.
  // Before the fix: skip bypasses counting — all requests pass.
  // After the fix: 11th request to a payment-limited route returns 429.
  // -------------------------------------------------------------------------
  test('paymentLimiter returns 429 after 10 payment attempts with Redis down (D-06)', async function () {
    // Requests 1-10: limiter should allow (count 1..10 ≤ max:10)
    for (var i = 0; i < 10; i++) {
      var res = await request(app)
        .post('/api/payment/initialize')
        .set('X-Forwarded-For', '10.2.0.1')
        .set('x-api-key', 'test-key')
        .send({ amount: 50 });
      expect(res.status).not.toBe(429);
    }
    // Request 11: count exceeds max:10 → rate limiter returns 429
    var blocked = await request(app)
      .post('/api/payment/initialize')
      .set('X-Forwarded-For', '10.2.0.1')
      .set('x-api-key', 'test-key')
      .send({ amount: 50 });
    expect(blocked.status).toBe(429);
  });

  // -------------------------------------------------------------------------
  // Test 3 (regression, updated 52-02/M4): when Redis IS connected and the
  // client is healthy, the REAL Redis path handles counting — not the
  // in-process Map. Verified by asserting the mock Redis client's incr() is
  // actually invoked once per request, and that the limiter enforces
  // normally through that path (6th request trips, same as production).
  //
  // Before 52-02 (M4), this test drove a mock combination that cannot happen
  // in production — isConnected():true while getClient() resolves null —
  // and asserted 6 requests never trip (totalHits:0 forever). That exact
  // combination was the fail-open corner 52-02 closes: a connected-but-
  // absent-client race now falls through to the same in-process accounting
  // used when Redis is fully down, rather than silently returning
  // totalHits:0. See __tests__/ratelimit-failclosed-52.test.js for the M4
  // regression coverage of that corner. This test now verifies the healthy-
  // client case instead: a working, connected Redis client is genuinely used
  // (not bypassed by the in-process Map).
  // -------------------------------------------------------------------------
  test('Redis path is used (not the in-process Map) when Redis is connected and healthy', async function () {
    cacheLib.isConnected.mockReturnValue(true);
    // Track hits per redisKey (not a single shared counter) — apiLimiter runs
    // ahead of pinLimiter on every request and shares this same mock client,
    // so counts must stay isolated per key the way real Redis INCR would.
    var hitsByKey = {};
    var healthyClient = {
      incr: jest.fn(function (redisKey) {
        hitsByKey[redisKey] = (hitsByKey[redisKey] || 0) + 1;
        return Promise.resolve(hitsByKey[redisKey]);
      }),
      expire: jest.fn().mockResolvedValue(1),
      ttl: jest.fn().mockResolvedValue(30)
    };
    cacheLib.getClient.mockResolvedValue(healthyClient);

    for (var i = 0; i < 5; i++) {
      var res = await request(app)
        .post('/api/kiosk/verify-pin')
        .set('X-Forwarded-For', '10.3.0.1')
        .set('x-api-key', 'test-key')
        .send({ pin: '0000' });
      expect(res.status).not.toBe(429);
    }
    // 6th request: the Redis-backed count reaches 6 > max:5 — the limiter
    // enforces via the real Redis path itself, same as it would in production.
    var blocked = await request(app)
      .post('/api/kiosk/verify-pin')
      .set('X-Forwarded-For', '10.3.0.1')
      .set('x-api-key', 'test-key')
      .send({ pin: '0000' });
    expect(blocked.status).toBe(429);
    // pinLimiter's own key (prefix rl:pin:) reached 6 via the real incr() path
    var pinKey = Object.keys(hitsByKey).filter(function (k) { return k.indexOf('rl:pin:') === 0; })[0];
    expect(pinKey).toBeTruthy();
    expect(hitsByKey[pinKey]).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// SECTION 2: acquireLock in-process fallback (Task 2 — D-06)
//
// These tests load the REAL cache module (not the server-level mock) via
// jest.requireActual so we can test the actual in-process Map logic.
//
// beforeEach calls jest.resetModules() so each test gets an isolated,
// freshly-initialised cache module with connected = false (redis is still
// mocked at the jest.mock() level above, so the real cache.js never tries
// to reach real Redis).
// ---------------------------------------------------------------------------

describe('cache.acquireLock in-process fallback when Redis is down (D-06)', function () {
  var realCache;

  beforeEach(function () {
    jest.resetModules();
    // After resetModules the mock factory for 'redis' re-runs, returning a
    // fresh client whose connect() rejects → connected stays false.
    realCache = jest.requireActual('../lib/cache');
  });

  // -------------------------------------------------------------------------
  // Test 4 (RED): first acquireLock call should return true.
  // Passes both before and after fix (current code also returns true when
  // disconnected). Included as a sanity check.
  // -------------------------------------------------------------------------
  test('first call returns true (lock acquired) when disconnected', async function () {
    var result = await realCache.acquireLock('lock-a', 30);
    expect(result).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 5 (RED): second call within TTL should return false.
  // Before the fix: acquireLock always returns true when disconnected
  // (current line 107: return Promise.resolve(true)).
  // After the fix: in-process Map tracks the lock → second call = false.
  // -------------------------------------------------------------------------
  test('second call within TTL returns false (double-tap serialized in-process)', async function () {
    await realCache.acquireLock('lock-b', 30);  // first call — acquires lock
    var second = await realCache.acquireLock('lock-b', 30);  // second call — should block
    expect(second).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Test 6 (RED): lock must be re-acquirable after its TTL expires.
  // Using ttlSeconds=0: expiresAt = Date.now() + 0. By the time the second
  // acquireLock runs (even 1 ms later), Date.now() >= expiresAt → expired.
  // -------------------------------------------------------------------------
  test('lock is re-acquirable after TTL expires (0-second TTL)', async function () {
    await realCache.acquireLock('lock-c', 0);  // expires immediately
    var reacquired = await realCache.acquireLock('lock-c', 30);
    expect(reacquired).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 7 (regression): when Redis is connected, acquireLock must use the
  // Redis SET NX path, not the in-process Map.
  // -------------------------------------------------------------------------
  test('uses Redis NX path when connected (existing behavior preserved)', async function () {
    // Reset modules again so we can control the redis client independently
    jest.resetModules();
    var mockClient = {
      on: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
      quit: jest.fn().mockResolvedValue(undefined)
    };
    require('redis').createClient.mockReturnValue(mockClient);

    var connectedCache = jest.requireActual('../lib/cache');
    await connectedCache.init();  // connect() resolves → connected = true

    var result = await connectedCache.acquireLock('lock-redis', 30);
    expect(result).toBe(true);
    expect(mockClient.set).toHaveBeenCalledWith('lock:lock-redis', '1', { NX: true, EX: 30 });
  });
});
