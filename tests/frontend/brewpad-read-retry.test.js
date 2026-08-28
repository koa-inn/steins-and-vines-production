'use strict';

// Regression tests for the "BrewPad momentarily loses batch data" bug.
//
// Symptom: the dashboard shows stat cards + month chart but "No wine batches
// started in the last 6 months" (and empty Needs-Attention / Next-7-Days),
// contradicting the chart. Root cause: the middleware proxy collapses a
// transient Apps-Script timeout/cold-start into an HTTP 502; the heaviest read
// (get_batches?status=all) intermittently hits it; and fetchWithRetry only
// retried on fetch() REJECTION (network failure), never on an HTTP error
// response — so a 502 was never retried, eagerLoad's settle() swallowed it, and
// _allBatchesData stayed []. The fix: reads (adminApiGet) retry transient
// 502/503/504; writes (adminApiPost) must NOT (non-idempotent re-apply risk).

var fs = require('fs');
var path = require('path');

// brewpad.js IIFE touches these globals on load — stub them all.
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
global.sessionStorage = global.localStorage;

var _auth = require('../../js/lib/auth');
global.waitForGoogleIdentity = _auth.waitForGoogleIdentity;
global.gsiInitTokenClient = _auth.gsiInitTokenClient;
global.fetchGoogleUserInfo = _auth.fetchGoogleUserInfo;

var bp = require('../../js/brewpad');

describe('fetchWithRetry — transient 5xx retry for reads', function () {
  beforeEach(function () { jest.useFakeTimers(); });
  afterEach(function () { jest.useRealTimers(); });

  test('is exported as a test seam', function () {
    expect(typeof bp._fetchWithRetryForTest).toBe('function');
  });

  test('read config retries a 502 then resolves the eventual 200', async function () {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ status: 502 })
      .mockResolvedValueOnce({ status: 200 });

    var p = bp._fetchWithRetryForTest('u', {}, 2, [502, 503, 504]);
    await jest.advanceTimersByTimeAsync(5000);
    var r = await p;

    expect(r.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('read config gives up after exhausting retries and returns the final 502', async function () {
    global.fetch = jest.fn().mockResolvedValue({ status: 502 });

    var p = bp._fetchWithRetryForTest('u', {}, 2, [502, 503, 504]);
    await jest.advanceTimersByTimeAsync(5000);
    var r = await p;

    expect(r.status).toBe(502);
    // initial attempt + 2 retries
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  test('write config (no retryStatuses) does NOT retry a 502', async function () {
    global.fetch = jest.fn().mockResolvedValue({ status: 502 });

    var p = bp._fetchWithRetryForTest('u', {}, 1); // write-style: network-only retry
    await jest.advanceTimersByTimeAsync(5000);
    var r = await p;

    expect(r.status).toBe(502);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('a genuine network rejection is still retried (both reads and writes)', async function () {
    global.fetch = jest.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ status: 200 });

    var p = bp._fetchWithRetryForTest('u', {}, 1); // no retryStatuses
    await jest.advanceTimersByTimeAsync(5000);
    var r = await p;

    expect(r.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

describe('read/write retry wiring contract (source)', function () {
  var SRC = fs.readFileSync(path.join(__dirname, '../../js/brewpad.js'), 'utf8');

  function bodyOf(fnName) {
    var start = SRC.indexOf('function ' + fnName + '(');
    expect(start).toBeGreaterThan(-1);
    // slice to the next top-level function declaration
    var next = SRC.indexOf('\n  function ', start + 1);
    return SRC.slice(start, next === -1 ? SRC.length : next);
  }

  test('adminApiGet opts reads into 502/503/504 retry', function () {
    expect(bodyOf('adminApiGet')).toMatch(/\[502, 503, 504\]/);
  });

  test('adminApiPost does NOT opt writes into any 5xx retry', function () {
    var body = bodyOf('adminApiPost');
    expect(body).not.toMatch(/50[234]/);
  });
});
