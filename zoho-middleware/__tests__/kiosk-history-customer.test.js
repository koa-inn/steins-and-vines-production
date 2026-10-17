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

describe('GET /api/kiosk/past-sales/customer', function () {
  var oldDev, oldMw, oldWalk, savedMode;
  beforeEach(function () {
    setup();
    oldDev = process.env.KIOSK_DEVICE_TOKEN; oldMw = process.env.MW_API_KEY; oldWalk = process.env.KIOSK_CONTACT_ID;
    process.env.KIOSK_DEVICE_TOKEN = DEVICE; process.env.MW_API_KEY = MW;
    process.env.KIOSK_CONTACT_ID = WALKIN;
    savedMode = router._config.joinMode;
    mockZoho();
    fakeNow();
  });
  afterEach(function () {
    router._config.joinMode = savedMode;
    process.env.KIOSK_CONTACT_ID = oldWalk;
    if (oldWalk === undefined) delete process.env.KIOSK_CONTACT_ID;
    jest.useRealTimers();
  });

  test('auth: 401 none, 403 wrong device, 200 device', async function () {
    var r0 = makeRes();
    handler(makeReq({ customer_id: CID }, {}), r0);
    expect(r0._status).toBe(401);
    expect((await call(handler, { customer_id: CID }, { 'x-device-token': 'wrong' }))._status).toBe(403);
    var ok = await call(handler, { customer_id: CID });
    expect(ok._json.walk_in).toBe(false);
  });

  test.each([undefined, 'abc', '12', '1234567890123456789012345678', '123456;x'])('customer_id %s is 400, no Zoho call', async function (v) {
    var r = await call(handler, v === undefined ? {} : { customer_id: v });
    expect(r._status).toBe(400);
    expect(zohoApi.zohoGet).not.toHaveBeenCalled();
  });

  test('walk-in contact short-circuits before cache and Zoho', async function () {
    var r = await call(handler, { customer_id: WALKIN });
    expect(r._status).toBeNull();
    expect(r._json).toEqual({ walk_in: true, invoices: [] });
    expect(zohoApi.zohoGet).not.toHaveBeenCalled();
    expect(cache.get).not.toHaveBeenCalled();
  });

  test('KIOSK_CONTACT_ID unset proceeds with a warning', async function () {
    delete process.env.KIOSK_CONTACT_ID;
    var r = await call(handler, { customer_id: CID });
    expect(r._json.walk_in).toBe(false);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('KIOSK_CONTACT_ID'));
  });

  test('initial window params and has_older', async function () {
    var r = await call(handler, { customer_id: CID });
    var p = callsTo('/invoices')[0][1];
    expect(p).toMatchObject({ customer_id: CID, date_start: '2025-10-16', date_end: '2026-10-17', sort_column: 'created_time', sort_order: 'D', per_page: 200, page: 1 });
    expect(r._json.window_start).toBe('2025-10-16');
    expect(r._json.window_end).toBe('2026-10-17');
    expect(r._json.has_older).toBe(true);
  });

  test('before pages back 12 months', async function () {
    var r = await call(handler, { customer_id: CID, before: '2025-10-16' });
    var p = callsTo('/invoices')[0][1];
    expect(p.date_end).toBe('2025-10-15');
    expect(p.date_start).toBe('2024-10-16');
    expect(r._json.window_start).toBe('2024-10-16');
  });

  test.each(['2026-13-01', 'nope', '2016-10-15', '2026-10-19'])('before %s is 400', async function (b) {
    var r = await call(handler, { customer_id: CID, before: b });
    expect(r._status).toBe(400);
    expect(zohoApi.zohoGet).not.toHaveBeenCalled();
  });

  test('before equal to the 10-year floor is 400, never an inverted Zoho range (WR-07)', async function () {
    var r = await call(handler, { customer_id: CID, before: '2016-10-16' });
    expect(r._status).toBe(400);
    expect(zohoApi.zohoGet).not.toHaveBeenCalled();
    var ok = await call(handler, { customer_id: CID, before: '2016-10-17' });
    expect(ok._status).toBeNull();
    var p = callsTo('/invoices')[0][1];
    expect(p.date_start <= p.date_end).toBe(true);
  });

  test('window reaching the 10-year floor has has_older false and is clamped', async function () {
    var r = await call(handler, { customer_id: CID, before: '2017-03-01' });
    expect(r._json.window_start).toBe('2016-10-16');
    expect(r._json.has_older).toBe(false);
  });

  test('source tags and status folding', async function () {
    mockZoho({
      invoices: [
        inv(1, 'INV-1', 'KIOSK-1', '2026-10-10T10:00:00-0700', 'paid'),
        inv(2, 'INV-2', '48213377', '2026-10-09T10:00:00-0700', 'paid'),
        inv(3, 'INV-3', '48213378', '2026-10-08T10:00:00-0700', 'paid'),
        inv(4, 'INV-4', '', '2026-10-07T10:00:00-0700', 'draft'),
        inv(5, 'INV-5', 'WEIRD', '2026-10-06T10:00:00-0700', 'void')
      ],
      payments: [pay('INV-2', 'creditcard', 'Kiosk recipe sale. Ref: 1'), pay('INV-3', 'creditcard', 'Online payment for Invoice')]
    });
    var r = await call(handler, { customer_id: CID });
    var by = {};
    r._json.invoices.forEach(function (x) { by[x.invoice_number] = x; });
    expect(by['INV-1'].source).toBe('in-store');
    expect(by['INV-2'].source).toBe('in-store');
    expect(by['INV-3'].source).toBe('online');
    expect(by['INV-4'].source).toBe('in-store');
    expect(by['INV-5'].source).toBe('other');
    expect(by['INV-4'].status).toBe('Draft'); // WR-03: same label as the ledger
    expect(by['INV-5'].status).toBe('Void');
    r._json.invoices.forEach(function (x) {
      expect(x.tender).toBe('');
      expect(Object.keys(x)).toEqual(hist.ROW_KEYS);
    });
    expect(r._json.invoices.map(function (x) { return x.invoice_number; })).toEqual(['INV-1', 'INV-2', 'INV-3', 'INV-4', 'INV-5']);
  });

  test('payments only fetched when an all-digit reference exists', async function () {
    mockZoho({ invoices: [inv(1, 'INV-1', 'KIOSK-1', '2026-10-10T10:00:00-0700'), inv(2, 'INV-2', '', '2026-10-09T10:00:00-0700')] });
    await call(handler, { customer_id: CID });
    expect(callsTo('/customerpayments')).toHaveLength(0);
    cache.get.mockResolvedValue(null);
    mockZoho({ invoices: [inv(3, 'INV-3', '555', '2026-10-09T10:00:00-0700')] });
    await call(handler, { customer_id: CID, bust: '1' });
    expect(callsTo('/customerpayments')).toHaveLength(1);
    expect(callsTo('/customerpayments')[0][1].customer_id).toBe(CID);
  });

  test('rows for another customer are dropped; salesorders never called', async function () {
    var other = inv(2, 'INV-2', 'KIOSK-2', '2026-10-09T10:00:00-0700');
    other.customer_id = '999999999999';
    mockZoho({ invoices: [inv(1, 'INV-1', 'KIOSK-1', '2026-10-10T10:00:00-0700'), other] });
    var r = await call(handler, { customer_id: CID });
    expect(r._json.invoices).toHaveLength(1);
    expect(callsTo('/salesorders')).toHaveLength(0);
  });

  test('ignores per_page/page/status and caps invoice pages at 3, payment pages at 2', async function () {
    mockZoho({ invoices: [inv(1, 'INV-1', '777', '2026-10-10T10:00:00-0700')], more: true, morePay: true });
    var r = await call(handler, { customer_id: CID, per_page: '5', page: '9', status: 'void' });
    expect(callsTo('/invoices')).toHaveLength(3);
    expect(callsTo('/customerpayments')).toHaveLength(2);
    callsTo('/invoices').forEach(function (c) { expect(c[1].per_page).toBe(200); expect(c[1].status).toBeUndefined(); });
    expect(r._json.truncated).toBe(true);
  });

  test('WR-04: payment truncation is surfaced as source_incomplete', async function () {
    mockZoho({ invoices: [inv(1, 'INV-1', '777', '2026-10-10T10:00:00-0700')], morePay: true });
    var r = await call(handler, { customer_id: CID });
    expect(r._json.truncated).toBe(false);
    expect(r._json.source_incomplete).toBe(true);
    mockZoho({ invoices: [inv(1, 'INV-1', '777', '2026-10-10T10:00:00-0700')] });
    var r2 = await call(handler, { customer_id: CID, bust: '1', before: '2026-10-01' });
    expect(r2._json.source_incomplete).toBe(false);
  });

  test('WR-04: payments window runs past the invoice window end', async function () {
    mockZoho({ invoices: [inv(1, 'INV-1', '777', '2026-10-10T10:00:00-0700')] });
    await call(handler, { customer_id: CID, before: '2025-10-16' });
    var p = callsTo('/customerpayments')[0][1];
    expect(p.date_start).toBe('2024-10-16');
    expect(p.date_end).toBe('2025-10-22'); // winEnd 2025-10-15 + 7 days
  });

  test('WR-04: untruncated window pages back from window_start', async function () {
    var r = await call(handler, { customer_id: CID });
    expect(r._json.next_before).toBe('2025-10-16');
    expect(r._json.has_older).toBe(true);
  });

  test('WR-04: truncated invoices page back from the oldest returned day, not window_start', async function () {
    var a = inv(1, 'INV-1', 'KIOSK-1', '2026-10-10T10:00:00-0700');
    var b = inv(2, 'INV-2', 'KIOSK-2', '2026-06-03T10:00:00-0700');
    b.date = '2026-06-03';
    mockZoho({ invoices: [a, b], more: true });
    var r = await call(handler, { customer_id: CID });
    expect(r._json.truncated).toBe(true);
    // the next window must still include 2026-06-03 (more invoices may share that day)
    expect(r._json.next_before).toBe('2026-06-04');
    expect(r._json.has_older).toBe(true);
  });

  test('WR-04: truncated window whose oldest day is its end still makes progress', async function () {
    var a = inv(1, 'INV-1', 'KIOSK-1', '2025-10-15T10:00:00-0700');
    a.date = '2025-10-15';
    mockZoho({ invoices: [a], more: true });
    var r = await call(handler, { customer_id: CID, before: '2025-10-16' });
    expect(r._json.next_before).toBe('2025-10-15');
    expect(r._json.next_before < '2025-10-16').toBe(true);
  });

  test('cache key, ttl, bust', async function () {
    await call(handler, { customer_id: CID });
    expect(cache.get).toHaveBeenCalledWith(C.CACHE_KEYS.KIOSK_HISTORY_CUSTOMER_PREFIX + CID + ':latest');
    expect(cache.set).toHaveBeenCalledWith(C.CACHE_KEYS.KIOSK_HISTORY_CUSTOMER_PREFIX + CID + ':latest', expect.any(Object), 60);
    jest.clearAllMocks();
    await call(handler, { customer_id: CID, before: '2025-10-16', bust: '1' });
    expect(cache.get).not.toHaveBeenCalled();
    expect(cache.set.mock.calls[0][0]).toBe(C.CACHE_KEYS.KIOSK_HISTORY_CUSTOMER_PREFIX + CID + ':2025-10-16');
  });

  test('cache hit skips Zoho', async function () {
    cache.get.mockResolvedValue({ walk_in: false, invoices: [], cached: true });
    var r = await call(handler, { customer_id: CID });
    expect(r._json.cached).toBe(true);
    expect(zohoApi.zohoGet).not.toHaveBeenCalled();
  });

  test('Zoho failure is 502 and not cached', async function () {
    mockZoho({ fail: true });
    var r = await call(handler, { customer_id: CID });
    expect(r._status).toBe(502);
    expect(r._json).toEqual({ error: 'Unable to fetch customer sales' });
    expect(cache.set).not.toHaveBeenCalled();
  });

  test('non list-join mode is a loud 502', async function () {
    router._config.joinMode = 'none';
    var r = await call(handler, { customer_id: CID });
    expect(r._status).toBe(502);
    expect(zohoApi.zohoGet).not.toHaveBeenCalled();
  });

  test('response carries no PII sentinels', async function () {
    mockZoho({ invoices: [inv(1, 'INV-1', '555', '2026-10-10T10:00:00-0700')], payments: [pay('INV-1', 'cash', 'SENTINEL_NOTE')] });
    var r = await call(handler, { customer_id: CID });
    var s = JSON.stringify(r._json);
    ['SENTINEL_EMAIL', 'SENTINEL_PHONE', 'SENTINEL_NOTES', 'SENTINEL_CF', 'SENTINEL_NOTE'].forEach(function (k) { expect(s).not.toContain(k); });
    expect(s).not.toContain('"reference_number"');
  });
});
