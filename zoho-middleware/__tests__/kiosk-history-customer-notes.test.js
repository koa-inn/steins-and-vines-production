'use strict';

// Customer history must classify invoices with the same payments-notes rule as the
// ledger (hist.needsPaymentNotes), not only all-digit references.

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

var handler = findHandler('/api/kiosk/past-sales/customer');
var CID = '1000000000000000001';
var WALKIN = '1000000000000000099';

function inv(id, number, ref, created, status, total) {
  return {
    invoice_id: String(id), invoice_number: number, reference_number: ref, created_time: created,
    status: status || 'paid', total: total === undefined ? 10 : total, balance: 0,
    customer_name: 'Cust', customer_id: CID, email: 'SENTINEL_EMAIL@x.test', phone: 'SENTINEL_PHONE',
    notes: 'SENTINEL_NOTES', custom_fields: [{ value: 'SENTINEL_CF' }]
  };
}
function pay(numbers, mode, note) {
  return { invoice_numbers: numbers, payment_mode: mode, description: note || '' };
}
function mockZoho(opts) {
  opts = opts || {};
  zohoApi.zohoGet.mockImplementation(function (path) {
    if (opts.fail) return Promise.reject(new Error('zoho down'));
    if (path === '/invoices') {
      return Promise.resolve({ invoices: opts.invoices || [], page_context: { has_more_page: !!opts.more } });
    }
    if (path === '/customerpayments') {
      return Promise.resolve({ customerpayments: opts.payments || [], page_context: { has_more_page: !!opts.morePay } });
    }
    return Promise.reject(new Error('unexpected ' + path));
  });
}
function callsTo(p) { return zohoApi.zohoGet.mock.calls.filter(function (c) { return c[0] === p; }); }

describe('customer history payments-notes rule matches the ledger', function () {
  var oldWalk, savedMode;
  beforeEach(function () {
    setup();
    oldWalk = process.env.KIOSK_CONTACT_ID;
    process.env.KIOSK_CONTACT_ID = WALKIN;
    savedMode = router._config.joinMode;
    fakeNow();
  });
  afterEach(function () {
    router._config.joinMode = savedMode;
    process.env.KIOSK_CONTACT_ID = oldWalk;
    if (oldWalk === undefined) delete process.env.KIOSK_CONTACT_ID;
    jest.useRealTimers();
  });

  test('a non-digit, non-KIOSK reference with an in-store payment note is In-store', async function () {
    var ref = 'SO-00042';
    expect(hist.needsPaymentNotes({ reference_number: ref })).toBe(true);
    mockZoho({
      invoices: [inv(1, 'INV-000901', ref, '2026-10-16T12:00:00-0700')],
      payments: [pay('INV-000901', 'creditcard', 'Kiosk recipe sale')]
    });
    var r = await call(handler, { customer_id: CID });
    expect(callsTo('/customerpayments').length).toBe(1);
    expect(r._json.invoices.map(function (x) { return x.source; })).toEqual(['in-store']);
  });

  test('only KIOSK- and blank references: no payments call (unchanged)', async function () {
    mockZoho({
      invoices: [
        inv(1, 'INV-000902', 'KIOSK-1', '2026-10-16T12:00:00-0700'),
        inv(2, 'INV-000903', '', '2026-10-15T12:00:00-0700')
      ]
    });
    var r = await call(handler, { customer_id: CID });
    expect(callsTo('/customerpayments').length).toBe(0);
    expect(r._json.invoices.map(function (x) { return x.source; })).toEqual(['in-store', 'in-store']);
  });
});
