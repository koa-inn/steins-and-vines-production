'use strict';

// Phase 92 WR-05: concurrent builds for one cache key share a single Zoho
// chain, and bust=1 is ignored when that key was built in the last 10 s, so
// repeated refresh taps (or a leaked device token looping on bust=1) cannot
// burn the Zoho quota the money paths depend on.

jest.mock('../lib/zoho-api', function () { return { zohoGet: jest.fn(), zohoPost: jest.fn(), zohoPut: jest.fn() }; });
jest.mock('../lib/cache', function () { return {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
  isConnected: jest.fn().mockReturnValue(true)
}; });
jest.mock('../lib/logger', function () { return { info: jest.fn(), warn: jest.fn(), error: jest.fn() }; });

var _routeRegistry = { get: [] };
jest.mock('express', function () {
  var router = {
    get: jest.fn(function (path, handler) { _routeRegistry.get.push({ path: path, handler: handler }); }),
    post: jest.fn(), put: jest.fn(), delete: jest.fn(), patch: jest.fn()
  };
  var express = function () {};
  express.Router = function () { return router; };
  return express;
});

var zohoApi = require('../lib/zoho-api');
var cache = require('../lib/cache');
var router = require('../routes/kiosk-history');

var cachedOrBuild = router._internals.cachedOrBuild;
var T0 = new Date('2026-10-16T22:00:00Z').getTime();

function flushPromises() { return new Promise(function (r) { setImmediate(r); }); }
async function settle() { for (var i = 0; i < 10; i++) { await flushPromises(); } }

function deferred() {
  var d = {};
  d.promise = new Promise(function (resolve, reject) { d.resolve = resolve; d.reject = reject; });
  return d;
}

beforeEach(function () {
  jest.clearAllMocks();
  cache.get.mockResolvedValue(null);
  cache.set.mockResolvedValue('OK');
  router._internals.resetCacheState();
  jest.useFakeTimers({ now: T0, doNotFake: ['setImmediate', 'nextTick', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
});
afterEach(function () {
  jest.useRealTimers();
});

describe('cachedOrBuild in-flight dedupe', function () {
  test('concurrent requests for one key run one build and share its result', async function () {
    var d = deferred();
    var build = jest.fn(function () { return d.promise; });
    var a = cachedOrBuild('k1', 60, false, build);
    var b = cachedOrBuild('k1', 60, false, build);
    var c = cachedOrBuild('k1', 60, true, build); // a bust joins the in-flight build
    await settle();
    expect(build).toHaveBeenCalledTimes(1);
    d.resolve({ v: 1 });
    expect(await a).toEqual({ v: 1 });
    expect(await b).toEqual({ v: 1 });
    expect(await c).toEqual({ v: 1 });
    expect(cache.set).toHaveBeenCalledTimes(1);
  });

  test('different keys build independently', async function () {
    var build = jest.fn(function () { return Promise.resolve({ v: 1 }); });
    await Promise.all([cachedOrBuild('k1', 60, false, build), cachedOrBuild('k2', 60, false, build)]);
    expect(build).toHaveBeenCalledTimes(2);
  });

  test('the in-flight entry is released after success, so a later miss builds again', async function () {
    var build = jest.fn(function () { return Promise.resolve({ v: 1 }); });
    await cachedOrBuild('k1', 60, false, build);
    await cachedOrBuild('k1', 60, false, build);
    expect(build).toHaveBeenCalledTimes(2);
  });

  test('a failed build rejects every waiter, is not cached, and does not stick', async function () {
    var d = deferred();
    var build = jest.fn(function () { return d.promise; });
    var a = cachedOrBuild('k1', 60, false, build);
    var b = cachedOrBuild('k1', 60, false, build);
    await settle();
    d.reject(new Error('zoho down'));
    await expect(a).rejects.toThrow('zoho down');
    await expect(b).rejects.toThrow('zoho down');
    expect(cache.set).not.toHaveBeenCalled();
    var ok = jest.fn(function () { return Promise.resolve({ v: 2 }); });
    expect(await cachedOrBuild('k1', 60, true, ok)).toEqual({ v: 2 });
    expect(ok).toHaveBeenCalledTimes(1);
  });
});

describe('cachedOrBuild bust throttle', function () {
  test('bust within 10 s of a build reads the cache instead of rebuilding', async function () {
    var build = jest.fn(function () { return Promise.resolve({ v: 1 }); });
    await cachedOrBuild('k1', 60, false, build);
    expect(build).toHaveBeenCalledTimes(1);

    cache.get.mockClear();
    cache.get.mockResolvedValue({ v: 1, cached: true });
    jest.setSystemTime(T0 + 5000);
    var r = await cachedOrBuild('k1', 60, true, build);
    expect(cache.get).toHaveBeenCalledWith('k1');
    expect(build).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ v: 1, cached: true });
  });

  test('bust after 10 s skips the cache and rebuilds', async function () {
    var build = jest.fn(function () { return Promise.resolve({ v: 1 }); });
    await cachedOrBuild('k1', 60, false, build);
    cache.get.mockClear();
    cache.get.mockResolvedValue({ v: 1, cached: true });
    jest.setSystemTime(T0 + 10001);
    await cachedOrBuild('k1', 60, true, build);
    expect(cache.get).not.toHaveBeenCalled();
    expect(build).toHaveBeenCalledTimes(2);
  });

  test('bust on a key with no recent build skips the cache read', async function () {
    var build = jest.fn(function () { return Promise.resolve({ v: 1 }); });
    await cachedOrBuild('k9', 60, true, build);
    expect(cache.get).not.toHaveBeenCalled();
    expect(build).toHaveBeenCalledTimes(1);
  });

  test('a throttled bust on a cache miss still builds (never returns nothing)', async function () {
    var build = jest.fn(function () { return Promise.resolve({ v: 1 }); });
    await cachedOrBuild('k1', 60, false, build);
    jest.setSystemTime(T0 + 1000);
    cache.get.mockResolvedValue(null); // e.g. Redis down
    expect(await cachedOrBuild('k1', 60, true, build)).toEqual({ v: 1 });
    expect(build).toHaveBeenCalledTimes(2);
  });

  test('the throttle window is a server constant, not request-controlled', function () {
    expect(router._internals.caps.BUST_MIN_INTERVAL_MS).toBe(10000);
  });
});

describe('ledger route shares one Zoho chain for simultaneous requests', function () {
  var DEVICE = 'test-kiosk-device-token-9205';
  var oldDev;
  beforeEach(function () {
    oldDev = process.env.KIOSK_DEVICE_TOKEN;
    process.env.KIOSK_DEVICE_TOKEN = DEVICE;
  });
  afterEach(function () {
    if (oldDev === undefined) delete process.env.KIOSK_DEVICE_TOKEN;
    else process.env.KIOSK_DEVICE_TOKEN = oldDev;
  });

  function makeRes() {
    var res = { _status: null, _json: null, headersSent: false };
    res.status = jest.fn(function (c) { res._status = c; return res; });
    res.json = jest.fn(function (d) { res._json = d; res.headersSent = true; return res; });
    return res;
  }

  test('two concurrent bust=1 ledger requests make one invoices + one payments call', async function () {
    var handler = _routeRegistry.get.filter(function (r) { return r.path === '/api/kiosk/past-sales/ledger'; })[0].handler;
    zohoApi.zohoGet.mockImplementation(function (path) {
      if (path === '/invoices') return Promise.resolve({ invoices: [], page_context: { has_more_page: false } });
      return Promise.resolve({ customerpayments: [], page_context: { has_more_page: false } });
    });
    var r1 = makeRes();
    var r2 = makeRes();
    handler({ query: { date: '2026-10-15', bust: '1' }, headers: { 'x-device-token': DEVICE }, body: {} }, r1);
    handler({ query: { date: '2026-10-15', bust: '1' }, headers: { 'x-device-token': DEVICE }, body: {} }, r2);
    await settle();
    var paths = zohoApi.zohoGet.mock.calls.map(function (c) { return c[0]; });
    expect(paths).toEqual(['/invoices', '/customerpayments']);
    expect(r1._json.date).toBe('2026-10-15');
    expect(r2._json.date).toBe('2026-10-15');
  });
});
