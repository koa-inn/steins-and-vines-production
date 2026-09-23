'use strict';

// ---------------------------------------------------------------------------
// Regression: the Zoho refresh token was written to Redis (90-day TTL) only
// in exchangeCode(), i.e. when the owner connected at /auth/zoho. A process
// that ran longer than that outlived its own saved token, and the next
// restart came up "No saved refresh token" — production checkout fell into
// offline fallback and the kiosk could not book to Zoho on 2026-09-23 until
// the owner re-authorised. Every successful refresh must re-persist the token
// so the 90-day clock restarts while the service is alive.
// ---------------------------------------------------------------------------

const { EventEmitter } = require('events');

jest.mock('../lib/cache', () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  acquireLock: jest.fn().mockResolvedValue(true),
  releaseLock: jest.fn().mockResolvedValue(undefined)
}));
jest.mock('https', () => ({ request: jest.fn() }));

function mockHttpsSuccess(https, responseData) {
  https.request.mockImplementation(function (opts, callback) {
    var req = new EventEmitter();
    req.write = jest.fn();
    req.end = jest.fn(function () {
      var res = new EventEmitter();
      callback(res);
      res.emit('data', Buffer.from(JSON.stringify(responseData)));
      res.emit('end');
    });
    return req;
  });
}
function mockHttpsError(https, err) {
  https.request.mockImplementation(function () {
    var req = new EventEmitter();
    req.write = jest.fn();
    req.end = jest.fn(function () { req.emit('error', err); });
    return req;
  });
}

var REFRESH_KEY = 'zoho:refresh_token';
var NINETY_DAYS = 60 * 60 * 24 * 90;

function refreshTokenWrites(cache) {
  return cache.set.mock.calls.filter(function (c) { return c[0] === REFRESH_KEY; });
}

describe('refresh token re-persistence', () => {
  let auth, cache, https;
  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    delete process.env.REDIS_ENCRYPTION_KEY; // plaintext at rest → values comparable
    process.env.ZOHO_CLIENT_ID = 'cid';
    process.env.ZOHO_CLIENT_SECRET = 'secret';
    cache = require('../lib/cache');
    https = require('https');
    cache.get.mockResolvedValue(null);
    cache.set.mockClear();
    cache.acquireLock.mockResolvedValue(true);
    auth = require('../lib/zohoAuth');
  });
  afterEach(() => { jest.useRealTimers(); });

  test('a successful refresh re-writes the refresh token with a fresh 90-day TTL', () => {
    auth.setRefreshToken('rt-saved');
    mockHttpsSuccess(https, { access_token: 'at-1', expires_in: 3600 });
    return auth.refreshAccessToken().then(() => {
      var writes = refreshTokenWrites(cache);
      expect(writes).toHaveLength(1);
      expect(writes[0][1]).toBe('rt-saved');
      expect(writes[0][2]).toBe(NINETY_DAYS);
    });
  });

  test('startup init() with a saved token refreshes AND re-persists it', () => {
    cache.get.mockImplementation((k) => Promise.resolve(k === REFRESH_KEY ? 'rt-from-redis' : null));
    mockHttpsSuccess(https, { access_token: 'at-boot', expires_in: 3600 });
    return auth.init().then(() => {
      expect(auth.isAuthenticated()).toBe(true);
      var writes = refreshTokenWrites(cache);
      expect(writes).toHaveLength(1);
      expect(writes[0][1]).toBe('rt-from-redis');
      expect(writes[0][2]).toBe(NINETY_DAYS);
    });
  });

  test('a rotated refresh token in the response replaces the saved one', () => {
    auth.setRefreshToken('rt-old');
    mockHttpsSuccess(https, { access_token: 'at-2', expires_in: 3600, refresh_token: 'rt-new' });
    return auth.refreshAccessToken().then(() => {
      var writes = refreshTokenWrites(cache);
      expect(writes).toHaveLength(1);
      expect(writes[0][1]).toBe('rt-new');
    });
  });

  test('a failed refresh writes nothing', () => {
    auth.setRefreshToken('rt-saved');
    mockHttpsError(https, new Error('ECONNRESET'));
    return auth.refreshAccessToken().catch(() => {}).then(() => {
      expect(refreshTokenWrites(cache)).toHaveLength(0);
    });
  });

  test('a Redis write failure does not break the refresh', () => {
    auth.setRefreshToken('rt-saved');
    cache.set.mockImplementation(() => { throw new Error('redis down'); });
    mockHttpsSuccess(https, { access_token: 'at-3', expires_in: 3600 });
    return auth.refreshAccessToken().then((t) => {
      expect(t.accessToken).toBe('at-3');
    });
  });
});
