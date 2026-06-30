'use strict';

// ---------------------------------------------------------------------------
// lib/money-path.js — unit tests for the four checkout safety primitives
//
// These primitives are extracted from routes/checkout.js (D-11) into a shared
// lib so that pos.js can consume the same guards (45-06/07/08).
// ---------------------------------------------------------------------------

// Mock lazy-require dependencies that money-path.js loads internally
jest.mock('../lib/logger', function () {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
});
jest.mock('../lib/eventLog', function () {
  return { logEvent: jest.fn() };
});
// Provide mocks in case any test path calls the lazy-require fallback
jest.mock('../lib/helcim', function () {
  return {
    isEnabled: jest.fn().mockReturnValue(true),
    voidTransaction: jest.fn().mockResolvedValue({ ok: true })
  };
});
jest.mock('../lib/mailer', function () {
  return { sendVoidFailureAlert: jest.fn().mockResolvedValue() };
});
jest.mock('../lib/cache', function () {
  return {
    get: jest.fn(),
    set: jest.fn().mockResolvedValue('OK'),
    acquireLock: jest.fn().mockResolvedValue(true)
  };
});
jest.mock('../lib/checkout-helpers', function () {
  return { withTimeout: jest.fn(function (p) { return p; }) };
});

var moneyPath = require('../lib/money-path');
var eventLog = require('../lib/eventLog');

// ---------------------------------------------------------------------------
// acquireIdempotencyLock
// ---------------------------------------------------------------------------
describe('acquireIdempotencyLock', function () {
  var mockCache;

  beforeEach(function () {
    jest.clearAllMocks();
    mockCache = {
      get: jest.fn(),
      set: jest.fn().mockResolvedValue('OK'),
      acquireLock: jest.fn().mockResolvedValue(true)
    };
  });

  afterEach(function () {
    delete process.env.NODE_ENV;
  });

  // Test 1: replay path when key already cached
  test('Test 1: returns replay status with cached body when key exists', async function () {
    var cachedBody = { ok: true, salesorder_number: 'SO-001' };
    mockCache.get.mockResolvedValue(cachedBody);

    var result = await moneyPath.acquireIdempotencyLock(mockCache, 'idem-key-1', 600);

    expect(result.status).toBe('replay');
    expect(result.cached).toEqual(cachedBody);
    // acquireLock must NOT be called on the replay path
    expect(mockCache.acquireLock).not.toHaveBeenCalled();
  });

  // Test 2: contention (lock already held)
  test('Test 2: returns contention when lock cannot be acquired (→ 409)', async function () {
    mockCache.get.mockResolvedValue(null);
    mockCache.acquireLock.mockResolvedValue(false);

    var result = await moneyPath.acquireIdempotencyLock(mockCache, 'idem-key-2', 600);

    expect(result.status).toBe('contention');
  });

  // Test 3a: fail-closed in production
  test('Test 3a: fails CLOSED in prod when Redis throws (signals 409, not proceed)', async function () {
    mockCache.get.mockRejectedValue(new Error('Redis ECONNREFUSED'));

    var result = await moneyPath.acquireIdempotencyLock(mockCache, 'idem-key-3', 600, { isProd: true });

    expect(result.status).toBe('failclosed');
  });

  // Test 3b: fail-open in dev
  test('Test 3b: fails open in dev when Redis throws (proceeds)', async function () {
    mockCache.get.mockRejectedValue(new Error('Redis ECONNREFUSED'));

    var result = await moneyPath.acquireIdempotencyLock(mockCache, 'idem-key-4', 600, { isProd: false });

    expect(result.status).toBe('acquired');
  });

  // Test 3c: prod detection via NODE_ENV when opts.isProd not supplied
  test('Test 3c: reads NODE_ENV=production when opts.isProd not provided', async function () {
    process.env.NODE_ENV = 'production';
    mockCache.get.mockRejectedValue(new Error('Redis ECONNREFUSED'));

    var result = await moneyPath.acquireIdempotencyLock(mockCache, 'idem-key-5', 600);

    expect(result.status).toBe('failclosed');
  });

  // acquired path
  test('returns acquired when cache miss and lock succeeds', async function () {
    mockCache.get.mockResolvedValue(null);
    mockCache.acquireLock.mockResolvedValue(true);

    var result = await moneyPath.acquireIdempotencyLock(mockCache, 'idem-key-6', 600);

    expect(result.status).toBe('acquired');
    expect(mockCache.acquireLock).toHaveBeenCalledWith('idem-key-6', 600);
  });
});

// ---------------------------------------------------------------------------
// assertTxnNotReplayed
// ---------------------------------------------------------------------------
describe('assertTxnNotReplayed', function () {
  var mockCache;

  beforeEach(function () {
    jest.clearAllMocks();
    mockCache = {
      get: jest.fn()
    };
  });

  // Test 4a: replay when txn key exists
  test('Test 4a: returns replay when txn key already exists in cache (→ 409)', async function () {
    mockCache.get.mockResolvedValue('used');

    var result = await moneyPath.assertTxnNotReplayed(mockCache, 'txn-abc', ':sv-cart-ferment');

    expect(result.status).toBe('replay');
    expect(mockCache.get).toHaveBeenCalledWith('helcim:txn:txn-abc:sv-cart-ferment');
  });

  test('returns ok when txn key not found in cache', async function () {
    mockCache.get.mockResolvedValue(null);

    var result = await moneyPath.assertTxnNotReplayed(mockCache, 'txn-new', '');

    expect(result.status).toBe('ok');
  });

  test('fails closed on Redis error (never returns ok)', async function () {
    mockCache.get.mockRejectedValue(new Error('Redis down'));

    var result = await moneyPath.assertTxnNotReplayed(mockCache, 'txn-fail', '');

    expect(result.status).not.toBe('ok');
  });

  test('uses empty suffix when not provided', async function () {
    mockCache.get.mockResolvedValue(null);

    await moneyPath.assertTxnNotReplayed(mockCache, 'txn-xyz');

    expect(mockCache.get).toHaveBeenCalledWith('helcim:txn:txn-xyz');
  });
});

// ---------------------------------------------------------------------------
// markTxnUsed
// ---------------------------------------------------------------------------
describe('markTxnUsed', function () {
  var mockCache;

  beforeEach(function () {
    jest.clearAllMocks();
    mockCache = {
      set: jest.fn().mockResolvedValue('OK')
    };
  });

  // Test 4b: writes key with 86400s TTL
  test('Test 4b: writes helcim:txn key with "used" value and 86400s TTL', async function () {
    await moneyPath.markTxnUsed(mockCache, 'txn-abc', ':sv-cart-ferment');

    expect(mockCache.set).toHaveBeenCalledWith(
      'helcim:txn:txn-abc:sv-cart-ferment',
      'used',
      86400
    );
  });

  test('accepts custom TTL', async function () {
    await moneyPath.markTxnUsed(mockCache, 'txn-abc', '', 3600);

    expect(mockCache.set).toHaveBeenCalledWith('helcim:txn:txn-abc', 'used', 3600);
  });

  test('uses empty suffix correctly', async function () {
    await moneyPath.markTxnUsed(mockCache, 'txn-xyz', '');

    expect(mockCache.set).toHaveBeenCalledWith('helcim:txn:txn-xyz', 'used', 86400);
  });
});

// ---------------------------------------------------------------------------
// rejectWithVoid
// ---------------------------------------------------------------------------
describe('rejectWithVoid', function () {
  var res;
  var mockHelcim;
  var mockMailer;

  beforeEach(function () {
    jest.clearAllMocks();
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    mockHelcim = {
      isEnabled: jest.fn().mockReturnValue(true),
      voidTransaction: jest.fn().mockResolvedValue({ ok: true })
    };
    mockMailer = {
      sendVoidFailureAlert: jest.fn().mockResolvedValue()
    };
  });

  // Test 5a: calls voidTransaction for a valid token
  test('Test 5a: calls helcim.voidTransaction when payment_token is present and helcim enabled', function () {
    var body = { payment_token: 'tok-123' };

    moneyPath.rejectWithVoid(res, body, 400, 'Bad request', {
      helcim: mockHelcim,
      mailer: mockMailer
    });

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Bad request' });
    expect(mockHelcim.voidTransaction).toHaveBeenCalledWith('tok-123');
  });

  test('does NOT void when payment_token is absent', function () {
    var body = {};

    moneyPath.rejectWithVoid(res, body, 400, 'No token', {
      helcim: mockHelcim,
      mailer: mockMailer
    });

    expect(mockHelcim.voidTransaction).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('does NOT void when helcim is disabled', function () {
    mockHelcim.isEnabled.mockReturnValue(false);
    var body = { payment_token: 'tok-123' };

    moneyPath.rejectWithVoid(res, body, 400, 'Helcim off', {
      helcim: mockHelcim,
      mailer: mockMailer
    });

    expect(mockHelcim.voidTransaction).not.toHaveBeenCalled();
  });

  test('does NOT void when token is empty string', function () {
    var body = { payment_token: '' };

    moneyPath.rejectWithVoid(res, body, 400, 'Empty token', {
      helcim: mockHelcim,
      mailer: mockMailer
    });

    expect(mockHelcim.voidTransaction).not.toHaveBeenCalled();
  });

  // Test 5b: calls sendVoidFailureAlert on void rejection
  test('Test 5b: calls mailer.sendVoidFailureAlert when voidTransaction rejects', async function () {
    mockHelcim.voidTransaction.mockRejectedValue(new Error('Void API error'));
    var body = { payment_token: 'tok-err' };

    moneyPath.rejectWithVoid(res, body, 400, 'Validation failed', {
      helcim: mockHelcim,
      mailer: mockMailer
    });

    // Allow the async void promise to settle
    await new Promise(function (resolve) { setTimeout(resolve, 20); });

    expect(mockMailer.sendVoidFailureAlert).toHaveBeenCalled();
    var alertArg = mockMailer.sendVoidFailureAlert.mock.calls[0][0];
    expect(alertArg.txnId).toBe('tok-err');
  });
});

// ---------------------------------------------------------------------------
// voidWithTimeout
// ---------------------------------------------------------------------------
describe('voidWithTimeout', function () {
  var mockHelcim;
  var mockMailer;
  var mockWithTimeout;

  beforeEach(function () {
    jest.clearAllMocks();
    mockHelcim = {
      voidTransaction: jest.fn().mockResolvedValue({ ok: true })
    };
    mockMailer = {
      sendVoidFailureAlert: jest.fn().mockResolvedValue()
    };
    // Default: pass-through (void completes within timeout)
    mockWithTimeout = jest.fn(function (p) { return p; });
  });

  // Test 6a: resolves within the timeout
  test('Test 6a: resolves when void completes within timeout', async function () {
    mockHelcim.voidTransaction.mockResolvedValue({ ok: true });

    await moneyPath.voidWithTimeout(mockHelcim, 'txn-ok', 49.99, {
      withTimeout: mockWithTimeout,
      mailer: mockMailer,
      eventLog: eventLog
    });

    expect(mockHelcim.voidTransaction).toHaveBeenCalledWith('txn-ok');
    expect(mockWithTimeout).toHaveBeenCalled();
    expect(mockMailer.sendVoidFailureAlert).not.toHaveBeenCalled();
  });

  // Test 6b: timeout is handled without alerting (log only, matches checkout.js:846)
  test('Test 6b: timeout error is caught and handled without sending void-failure alert', async function () {
    var timeoutErr = new Error('Timeout after 8000ms');
    mockWithTimeout.mockRejectedValue(timeoutErr);

    await moneyPath.voidWithTimeout(mockHelcim, 'txn-timeout', 49.99, {
      withTimeout: mockWithTimeout,
      mailer: mockMailer,
      eventLog: eventLog
    });

    // Timeout case: log only — no mailer alert (preserves checkout.js:846 behavior)
    expect(mockMailer.sendVoidFailureAlert).not.toHaveBeenCalled();
  });

  // Test 6c: non-timeout error routes to void-failure alert path
  test('Test 6c: non-timeout error triggers void-failure alert via mailer', async function () {
    var voidErr = new Error('Connection refused');
    mockWithTimeout.mockRejectedValue(voidErr);

    await moneyPath.voidWithTimeout(mockHelcim, 'txn-fail', 99.00, {
      withTimeout: mockWithTimeout,
      mailer: mockMailer,
      eventLog: eventLog
    });

    expect(mockMailer.sendVoidFailureAlert).toHaveBeenCalled();
    var alertArg = mockMailer.sendVoidFailureAlert.mock.calls[0][0];
    expect(alertArg.txnId).toBe('txn-fail');
    expect(alertArg.amount).toBe(99.00);
  });

  test('void declined (ok:false) is logged but does not alert', async function () {
    mockHelcim.voidTransaction.mockResolvedValue({ ok: false, message: 'Declined' });

    await moneyPath.voidWithTimeout(mockHelcim, 'txn-declined', 49.99, {
      withTimeout: mockWithTimeout,
      mailer: mockMailer,
      eventLog: eventLog
    });

    expect(mockMailer.sendVoidFailureAlert).not.toHaveBeenCalled();
    expect(eventLog.logEvent).toHaveBeenCalledWith(
      'checkout.void_fired',
      expect.objectContaining({ voidResult: 'declined' })
    );
  });

  test('uses default 8000ms timeout when no opts.timeoutMs provided', async function () {
    var capturedMs;
    mockWithTimeout.mockImplementation(function (p, ms) {
      capturedMs = ms;
      return p;
    });

    await moneyPath.voidWithTimeout(mockHelcim, 'txn-default', 0, {
      withTimeout: mockWithTimeout,
      mailer: mockMailer,
      eventLog: eventLog
    });

    expect(capturedMs).toBe(8000);
  });

  test('CHECKOUT_IDEMPOTENCY_TTL is exported as 600', function () {
    expect(moneyPath.CHECKOUT_IDEMPOTENCY_TTL).toBe(600);
  });
});
