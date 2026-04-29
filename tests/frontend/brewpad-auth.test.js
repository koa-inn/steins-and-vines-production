'use strict';

// brewpad.js runs its IIFE on load -- stub the globals it touches at the top level.
global.document = global.document || {};
global.window = global.window || {};
global.navigator = global.navigator || {};
global.google = { accounts: { oauth2: { initTokenClient: jest.fn() } } };
global.fetch = jest.fn();
global.localStorage = {
  _data: {},
  getItem: function (k) { return this._data[k] || null; },
  setItem: function (k, v) { this._data[k] = v; },
  removeItem: function (k) { delete this._data[k]; },
  clear: function () { this._data = {}; }
};
global.sessionStorage = {
  _data: {},
  getItem: function (k) { return this._data[k] || null; },
  setItem: function (k, v) { this._data[k] = v; },
  removeItem: function (k) { delete this._data[k]; },
  clear: function () { this._data = {}; }
};

// auth.js primitives are loaded via <script> in the browser; in tests wire them as globals.
var _auth = require('../../js/lib/auth');
global.waitForGoogleIdentity = _auth.waitForGoogleIdentity;
global.gsiInitTokenClient = _auth.gsiInitTokenClient;
global.fetchGoogleUserInfo = _auth.fetchGoogleUserInfo;

var bp = require('../../js/brewpad');

describe('isSessionStale', function () {
  test('returns true when lastTokenTime is 0', function () {
    expect(bp.isSessionStale(0, 45 * 60 * 1000)).toBe(true);
  });

  test('returns true when elapsed exceeds threshold', function () {
    var old = Date.now() - (46 * 60 * 1000);
    expect(bp.isSessionStale(old, 45 * 60 * 1000)).toBe(true);
  });

  test('returns false when elapsed is under threshold', function () {
    var recent = Date.now() - (10 * 60 * 1000);
    expect(bp.isSessionStale(recent, 45 * 60 * 1000)).toBe(false);
  });

  test('returns true when lastTokenTime is null', function () {
    expect(bp.isSessionStale(null, 45 * 60 * 1000)).toBe(true);
  });

  test('returns true when thresholdMs is 0', function () {
    expect(bp.isSessionStale(Date.now(), 0)).toBe(true);
  });
});

describe('isSessionExpired', function () {
  test('returns true when loginAt is null', function () {
    expect(bp.isSessionExpired(null, 7 * 24 * 60 * 60 * 1000)).toBe(true);
  });

  test('returns true when older than 7 days', function () {
    var eightDaysAgo = Date.now() - (8 * 24 * 60 * 60 * 1000);
    expect(bp.isSessionExpired(eightDaysAgo, 7 * 24 * 60 * 60 * 1000)).toBe(true);
  });

  test('returns false when within 7 days', function () {
    var twoDaysAgo = Date.now() - (2 * 24 * 60 * 60 * 1000);
    expect(bp.isSessionExpired(twoDaysAgo, 7 * 24 * 60 * 60 * 1000)).toBe(false);
  });

  test('returns false when loginAt is very recent', function () {
    expect(bp.isSessionExpired(Date.now() - 1000, 7 * 24 * 60 * 60 * 1000)).toBe(false);
  });

  test('returns true when maxAgeMs is 0', function () {
    expect(bp.isSessionExpired(Date.now(), 0)).toBe(true);
  });
});
