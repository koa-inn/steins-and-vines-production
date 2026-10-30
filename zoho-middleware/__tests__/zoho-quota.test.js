'use strict';

// Quick task 261029-zq1 Task 4 — Zoho Inventory quota guard.
//
// Zoho Inventory reports the org's daily call budget on every response:
//   x-rate-limit-limit: 1000, x-rate-limit-remaining: <n>, x-rate-limit-reset: <seconds>
// and on exhaustion returns HTTP 429 { code: 45 }. lib/zoho-quota records the
// latest values, marks the quota exhausted until the reset (not a 90 s
// cooldown), and tells background jobs to stand down below a reserve.

jest.mock('../lib/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

var mockStore = {};
jest.mock('../lib/cache', () => ({
  get: jest.fn(function (k) {
    return Promise.resolve(Object.prototype.hasOwnProperty.call(mockStore, k) ? mockStore[k] : null);
  }),
  set: jest.fn(function (k, v) { mockStore[k] = v; return Promise.resolve(); }),
  del: jest.fn(),
  acquireLock: jest.fn().mockResolvedValue(true),
  releaseLock: jest.fn().mockResolvedValue(),
  isConnected: jest.fn().mockReturnValue(true)
}));

var quota;
var cache;
var NOW = Date.parse('2026-10-29T17:00:00.000Z');

function headers(remaining, limit, reset) {
  var h = {};
  if (remaining !== undefined) h['x-rate-limit-remaining'] = String(remaining);
  if (limit !== undefined) h['x-rate-limit-limit'] = String(limit);
  if (reset !== undefined) h['x-rate-limit-reset'] = String(reset);
  return h;
}

function code45(reset) {
  var err = new Error('Request failed with status code 429');
  err.response = {
    status: 429,
    headers: headers(0, 1000, reset),
    data: { code: 45, message: 'The API call for this organization has exceeded the maximum call rate limit of 1,000' }
  };
  return err;
}

beforeEach(() => {
  jest.resetModules();
  mockStore = {};
  delete process.env.ZOHO_QUOTA_RESERVE;
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  quota = require('../lib/zoho-quota');
  cache = require('../lib/cache');
});

afterEach(() => {
  Date.now.mockRestore();
});

describe('header capture', () => {
  test('records remaining/limit/reset from a response', () => {
    quota.recordHeaders(headers(742, 1000, 3600));
    var s = quota.snapshot();
    expect(s.remaining).toBe(742);
    expect(s.limit).toBe(1000);
    expect(s.resetAt).toBe(new Date(NOW + 3600 * 1000).toISOString());
    expect(s.exhausted).toBe(false);
  });

  test('mirrors the state to Redis with TTL = reset seconds', () => {
    quota.recordHeaders(headers(742, 1000, 3600));
    var call = cache.set.mock.calls.find(function (c) { return c[0] === 'zoho:inventory:quota'; });
    expect(call).toBeTruthy();
    expect(call[1].remaining).toBe(742);
    expect(call[2]).toBe(3600);
  });

  test('missing or junk headers never throw and change nothing', () => {
    expect(function () { quota.recordHeaders(undefined); }).not.toThrow();
    expect(function () { quota.recordHeaders({}); }).not.toThrow();
    expect(function () { quota.recordHeaders(headers('abc', 'x', 'y')); }).not.toThrow();
    expect(quota.snapshot().remaining).toBeNull();
    expect(cache.set).not.toHaveBeenCalled();
  });

  test('reads AxiosHeaders-style objects with a get() method', () => {
    var h = headers(500, 1000, 100);
    quota.recordHeaders({ get: function (k) { return h[k]; } });
    expect(quota.snapshot().remaining).toBe(500);
  });
});

describe('exhaustion (429 code 45)', () => {
  test('marks exhausted until the reset header, not a 90 s cooldown', () => {
    quota.recordError(code45(22210));
    expect(quota.isExhausted()).toBe(true);
    expect(quota.snapshot().exhausted).toBe(true);
    Date.now.mockReturnValue(NOW + 22209 * 1000);
    expect(quota.isExhausted()).toBe(true);
    Date.now.mockReturnValue(NOW + 22211 * 1000);
    expect(quota.isExhausted()).toBe(false);
  });

  test('code 45 without a reset header still blocks for a while (15 min)', () => {
    var err = code45();
    err.response.headers = {};
    quota.recordError(err);
    expect(quota.isExhausted()).toBe(true);
    Date.now.mockReturnValue(NOW + 15 * 60 * 1000 + 1);
    expect(quota.isExhausted()).toBe(false);
  });

  test('a per-minute 429 (code 44) or other error does NOT mark exhaustion', () => {
    var err = code45(60);
    err.response.data.code = 44;
    err.response.headers = {};
    quota.recordError(err);
    quota.recordError(new Error('socket hang up'));
    expect(quota.isExhausted()).toBe(false);
  });

  test('remaining 0 on a successful response marks exhaustion until reset', () => {
    quota.recordHeaders(headers(0, 1000, 600));
    expect(quota.isExhausted()).toBe(true);
  });

  test('exhaustedError() looks like a Zoho code-45 429', () => {
    quota.recordError(code45(600));
    var err = quota.exhaustedError();
    expect(err.quotaExhausted).toBe(true);
    expect(err.status).toBe(429);
    expect(err.response.status).toBe(429);
    expect(err.response.data.code).toBe(45);
  });

  test('hydrate() adopts an exhausted state mirrored in Redis (e.g. after a redeploy)', () => {
    mockStore['zoho:inventory:quota'] = {
      remaining: 0, limit: 1000,
      resetAt: new Date(NOW + 3600 * 1000).toISOString(),
      updatedAt: new Date(NOW - 1000).toISOString(),
      exhaustedUntil: new Date(NOW + 3600 * 1000).toISOString()
    };
    return quota.hydrate().then(function () {
      expect(quota.isExhausted()).toBe(true);
      expect(quota.snapshot().remaining).toBe(0);
    });
  });
});

describe('reserve for background jobs', () => {
  test('unknown remaining → background allowed', () => {
    expect(quota.shouldSkipBackground()).toBe(false);
  });

  test('remaining below ZOHO_QUOTA_RESERVE (default 250) → skip background', () => {
    quota.recordHeaders(headers(249, 1000, 3600));
    expect(quota.shouldSkipBackground()).toBe(true);
  });

  test('remaining at/above the reserve → background allowed', () => {
    quota.recordHeaders(headers(250, 1000, 3600));
    expect(quota.shouldSkipBackground()).toBe(false);
  });

  test('ZOHO_QUOTA_RESERVE env overrides the default', () => {
    process.env.ZOHO_QUOTA_RESERVE = '100';
    quota.recordHeaders(headers(150, 1000, 3600));
    expect(quota.shouldSkipBackground()).toBe(false);
  });

  test('a reading from before the reset no longer counts', () => {
    quota.recordHeaders(headers(10, 1000, 60));
    Date.now.mockReturnValue(NOW + 61 * 1000);
    expect(quota.shouldSkipBackground()).toBe(false);
  });

  test('exhausted → skip background', () => {
    quota.recordError(code45(600));
    expect(quota.shouldSkipBackground()).toBe(true);
  });
});
