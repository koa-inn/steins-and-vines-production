'use strict';

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
var log = require('../lib/logger');
var C = require('../lib/constants');
var hist = require('../lib/kiosk-history');
var authTiers = require('../lib/authTiers');
var router = require('../routes/kiosk-history');
var fixture = require('./fixtures/zoho-past-sales-shapes.json');

function findHandler(path) {
  for (var i = 0; i < _routeRegistry.get.length; i++) {
    if (_routeRegistry.get[i].path === path) return _routeRegistry.get[i].handler;
  }
  throw new Error('No GET handler for ' + path);
}
function makeReq(query, headers) { return { body: {}, query: query || {}, headers: headers || {} }; }
function makeRes() {
  var res = { _status: null, _json: null, headersSent: false };
  res.status = jest.fn(function (c) { res._status = c; return res; });
  res.json = jest.fn(function (d) { res._json = d; res.headersSent = true; return res; });
  return res;
}
function flushPromises() { return new Promise(function (r) { setImmediate(r); }); }
async function settle() { for (var i = 0; i < 10; i++) { await flushPromises(); } }


var DEVICE = 'test-kiosk-device-token-9203';
var MW = 'test-api-key-hist';
async function call(handler, query, headers, params) {
  var res = makeRes();
  var req = makeReq(query, headers || { 'x-device-token': DEVICE });
  req.params = params || {};
  handler(req, res);
  await settle();
  return res;
}
function fakeNow() {
  jest.useFakeTimers({ now: new Date('2026-10-16T22:00:00Z'), doNotFake: ['setImmediate', 'nextTick', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
}
function setup() {
  jest.clearAllMocks();
  router._internals.resetCacheState(); // WR-05 bust throttle is per process
  cache.get.mockResolvedValue(null);
  cache.set.mockResolvedValue('OK');
  process.env.KIOSK_DEVICE_TOKEN = DEVICE;
  process.env.MW_API_KEY = MW;
}

var handler = findHandler('/api/kiosk/past-sales/invoice/:id');
var ID = '1000000000000000042';

function detail(status) {
  return {
    invoice: {
      invoice_id: ID, invoice_number: 'INV-42', created_time: '2026-10-10T10:00:00-0700', status: status || 'paid',
      customer_name: 'Cust', sub_total: 10, tax_total: 1.2, total: 11.2, balance: 0,
      email: 'SENTINEL_EMAIL@x.test', notes: 'SENTINEL_NOTES', reference_number: 'SENTINEL_REF',
      billing_address: { address: 'SENTINEL_ADDR' }, custom_fields: [{ value: 'SENTINEL_CF' }],
      payments: [{ reference_number: 'SENTINEL_PAYREF' }],
      line_items: [
        { name: 'Kit', quantity: 1, rate: 10, item_total: 10, description: 'd' },
        { description: 'Fallback desc', quantity: 2, rate: 1, amount: 2 }
      ]
    }
  };
}

describe('GET /api/kiosk/past-sales/invoice/:id', function () {
  beforeEach(function () {
    setup();
    zohoApi.zohoGet.mockImplementation(function () { return Promise.resolve(detail()); });
    fakeNow();
  });
  afterEach(function () { jest.useRealTimers(); });

  test('auth: 401 then 200', async function () {
    var r0 = makeRes();
    var req = makeReq({}, {}); req.params = { id: ID };
    handler(req, r0);
    expect(r0._status).toBe(401);
    expect((await call(handler, {}, null, { id: ID }))._json.invoice.invoice_id).toBe(ID);
  });

  test.each(['abc', '12345', '123456789012345678901234567', '1234567;drop', '../x'])('id %s is 400, no Zoho call', async function (id) {
    var r = await call(handler, {}, null, { id: id });
    expect(r._status).toBe(400);
    expect(zohoApi.zohoGet).not.toHaveBeenCalled();
  });

  test('allowlisted shape and fallbacks', async function () {
    var r = await call(handler, {}, null, { id: ID });
    expect(zohoApi.zohoGet).toHaveBeenCalledTimes(1);
    expect(zohoApi.zohoGet.mock.calls[0][0]).toBe('/invoices/' + ID);
    expect(Object.keys(r._json.invoice)).toEqual(hist.DETAIL_KEYS);
    r._json.invoice.line_items.forEach(function (li) { expect(Object.keys(li)).toEqual(hist.LINE_ITEM_KEYS); });
    expect(r._json.invoice.line_items[1]).toEqual({ name: 'Fallback desc', quantity: 2, rate: 1, amount: 2 });
    var s = JSON.stringify(r._json);
    ['SENTINEL_EMAIL', 'SENTINEL_NOTES', 'SENTINEL_REF', 'SENTINEL_ADDR', 'SENTINEL_CF', 'SENTINEL_PAYREF'].forEach(function (k) { expect(s).not.toContain(k); });
  });

  test.each([['paid', 3600], ['void', 3600], ['sent', 60], ['partially_paid', 60], ['draft', 60]])('status %s caches %i s', async function (st, ttl) {
    zohoApi.zohoGet.mockImplementation(function () { return Promise.resolve(detail(st)); });
    await call(handler, {}, null, { id: ID });
    expect(cache.set).toHaveBeenCalledWith(C.CACHE_KEYS.KIOSK_HISTORY_INVOICE_PREFIX + ID, expect.any(Object), ttl);
  });

  test('cache hit skips Zoho; bust skips cache.get', async function () {
    cache.get.mockResolvedValue({ invoice_id: ID, cached: true });
    var r = await call(handler, {}, null, { id: ID });
    expect(r._json.invoice.cached).toBe(true);
    expect(zohoApi.zohoGet).not.toHaveBeenCalled();
    jest.clearAllMocks();
    await call(handler, { bust: '1' }, null, { id: ID });
    expect(cache.get).not.toHaveBeenCalled();
    expect(zohoApi.zohoGet).toHaveBeenCalledTimes(1);
  });

  test('404 and 502 mapping, never cached', async function () {
    var e404 = new Error('nf'); e404.response = { status: 404 };
    zohoApi.zohoGet.mockImplementation(function () { return Promise.reject(e404); });
    var r = await call(handler, {}, null, { id: ID });
    expect(r._status).toBe(404);
    expect(r._json).toEqual({ error: 'not_found' });
    zohoApi.zohoGet.mockImplementation(function () { return Promise.reject(new Error('boom')); });
    var r2 = await call(handler, {}, null, { id: ID });
    expect(r2._status).toBe(502);
    expect(r2._json).toEqual({ error: 'Unable to fetch invoice' });
    expect(cache.set).not.toHaveBeenCalled();
  });
});
