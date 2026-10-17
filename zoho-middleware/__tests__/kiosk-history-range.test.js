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

var fs = require('fs');
var path = require('path');
var zohoApi = require('../lib/zoho-api');
var cache = require('../lib/cache');
var log = require('../lib/logger');
var authTiers = require('../lib/authTiers');
var router = require('../routes/kiosk-history');

function findHandler(p) {
  for (var i = 0; i < _routeRegistry.get.length; i++) {
    if (_routeRegistry.get[i].path === p) return _routeRegistry.get[i].handler;
  }
  throw new Error('No GET handler for ' + p);
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

var DEVICE = 'test-kiosk-device-token-9303';
var MW = 'test-api-key-range';
var RANGE = '/api/kiosk/past-sales/range';
var rangeHandler = findHandler(RANGE);
var ledgerHandler = findHandler('/api/kiosk/past-sales/ledger');

function inv(id, number, ref, created, status, total, date) {
  return {
    invoice_id: String(id), invoice_number: number, reference_number: ref, created_time: created,
    date: date || created.slice(0, 10), status: status || 'paid', total: total === undefined ? 10 : total, balance: 0,
    customer_name: 'SENTINEL_NAME ' + id, email: 'SENTINEL_EMAIL@x.test', phone: 'SENTINEL_PHONE',
    notes: 'SENTINEL_NOTES', custom_fields: [{ value: 'SENTINEL_CF' }], customer_id: 'SENTINEL_CID'
  };
}
function pay(numbers, mode, note, date) {
  return { invoice_numbers: numbers, payment_mode: mode, description: note || '', date: date, reference_number: 'SENTINEL_PAYREF', amount: 1 };
}

function weekInvoices() {
  return [
    inv(1, 'INV-1', 'KIOSK-1', '2026-10-12T10:00:00-0700', 'paid', 10.10),
    inv(2, 'INV-2', 'POS-2', '2026-10-13T11:00:00-0700', 'paid', 20.20),
    inv(3, 'INV-3', '', '2026-10-13T12:00:00-0700', 'paid', 30.30),
    inv(4, 'INV-4', '1001', '2026-10-14T09:00:00-0700', 'paid', 40),
    inv(5, 'INV-5', '1002', '2026-10-14T10:00:00-0700', 'paid', 50),
    inv(6, 'INV-6', 'ABC1', '2026-10-15T10:00:00-0700', 'paid', 60.60),
    inv(7, 'INV-7', 'ABC2', '2026-10-15T11:00:00-0700', 'paid', 70),
    inv(8, 'INV-8', 'KIOSK-8', '2026-10-15T12:00:00-0700', 'void', 80),
    inv(9, 'INV-9', '', '2026-10-15T13:00:00-0700', 'draft', 90),
    // backdated: created 10-15, invoice date 10-12
    inv(10, 'INV-10', 'KIOSK-10', '2026-10-15T14:00:00-0700', 'paid', 100.10, '2026-10-12'),
    // late evening Vancouver (UTC is already 10-15)
    inv(11, 'INV-11', 'KIOSK-11', '2026-10-14T23:30:00-0700', 'paid', 110.11, '2026-10-14'),
    // payment with an in-store note dated 3 days after the invoice
    inv(12, 'INV-12', '5550001', '2026-10-12T15:00:00-0700', 'paid', 120),
    inv(13, 'INV-13', 'KIOSK-13', '2026-10-16T09:00:00-0700', 'paid', 7.07),
    inv(14, 'INV-14', '1003', '2026-10-16T10:00:00-0700', 'paid', 14.14)
  ];
}
function weekPayments() {
  return [
    pay('INV-1', 'cash', '', '2026-10-12'),
    pay('INV-4', 'creditcard', 'Kiosk recipe sale. Ref: 1', '2026-10-14'),
    pay('INV-5', 'creditcard', 'Online payment for Invoice', '2026-10-14'),
    pay('INV-6', 'debitcard', 'In-store terminal payment. Helcim txn: 2', '2026-10-15'),
    pay('INV-12', 'creditcard', 'Kiosk recipe sale. Ref: 2', '2026-10-15'),
    pay('INV-14', 'creditcard', 'Online payment for Invoice', '2026-10-16')
  ];
}

// Honours date_start/date_end inclusively on the row `date` field.
function inRange(row, params) {
  var d = row.date;
  if (params.date_start && d < params.date_start) return false;
  if (params.date_end && d > params.date_end) return false;
  return true;
}
function mockZoho(opts) {
  opts = opts || {};
  zohoApi.zohoGet.mockImplementation(function (p, params) {
    if (opts.fail) return Promise.reject(new Error('zoho down'));
    if (p === '/invoices') {
      var src = opts.invoices || weekInvoices();
      var rows = src.filter(function (r) { return inRange(r, params); });
      return Promise.resolve({ invoices: rows, page_context: { has_more_page: !!opts.moreInvoices } });
    }
    if (p === '/customerpayments') {
      var psrc = opts.payments || weekPayments();
      var prows = psrc.filter(function (r) { return inRange(r, params); });
      return Promise.resolve({ customerpayments: prows, page_context: { has_more_page: !!opts.morePayments } });
    }
    return Promise.reject(new Error('unexpected ' + p + JSON.stringify(params)));
  });
}
async function call(query, headers) {
  var res = makeRes();
  rangeHandler(makeReq(query, headers || { 'x-device-token': DEVICE }), res);
  await settle();
  return res;
}
async function callLedger(query) {
  var res = makeRes();
  ledgerHandler(makeReq(query, { 'x-device-token': DEVICE }), res);
  await settle();
  return res;
}
function fakeNow() {
  jest.useFakeTimers({ now: new Date('2026-10-16T22:00:00Z'), doNotFake: ['setImmediate', 'nextTick', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
}
function callsTo(p) {
  return zohoApi.zohoGet.mock.calls.filter(function (c) { return c[0] === p; });
}

var CONTRACT_KEYS = ['type', 'period_start', 'period_end', 'range_start', 'range_end', 'today', 'current',
  'prev_anchor', 'next_anchor', 'days', 'count', 'gross_total', 'truncated', 'classification_incomplete'].sort();

describe('GET /api/kiosk/past-sales/range', function () {
  var oldDev, oldMw;
  beforeEach(function () {
    jest.clearAllMocks();
    router._internals.resetCacheState();
    cache.get.mockResolvedValue(null);
    cache.set.mockResolvedValue('OK');
    oldDev = process.env.KIOSK_DEVICE_TOKEN; oldMw = process.env.MW_API_KEY;
    process.env.KIOSK_DEVICE_TOKEN = DEVICE;
    process.env.MW_API_KEY = MW;
    mockZoho();
  });
  afterEach(function () {
    process.env.KIOSK_DEVICE_TOKEN = oldDev; process.env.MW_API_KEY = oldMw;
    jest.useRealTimers();
  });

  describe('auth', function () {
    test('KIOSK_ROUTES lists the range path; unlisted sibling stays denied', function () {
      expect(authTiers.KIOSK_ROUTES).toContain(RANGE);
      expect(authTiers.isKioskRoute(RANGE)).toBe(true);
      expect(authTiers.isKioskRoute('/api/kiosk/past-sales/other')).toBe(false);
    });
    test('no credential 401, wrong token 403, device 200, api key 200', async function () {
      fakeNow();
      var r0 = makeRes();
      rangeHandler(makeReq({ type: 'week' }, {}), r0);
      expect(r0._status).toBe(401);
      expect(zohoApi.zohoGet).not.toHaveBeenCalled();
      expect((await call({ type: 'week' }, { 'x-device-token': 'wrong' }))._status).toBe(403);
      expect((await call({ type: 'week' }))._json.type).toBe('week');
      router._internals.resetCacheState();
      expect((await call({ type: 'week' }, { 'x-api-key': MW }))._json.type).toBe('week');
    });
  });

  describe('validation', function () {
    test.each([[undefined], ['day'], ['year'], ['']])('type %s is a 400 with no Zoho call', async function (t) {
      fakeNow();
      var r = await call(t === undefined ? {} : { type: t });
      expect(r._status).toBe(400);
      expect(zohoApi.zohoGet).not.toHaveBeenCalled();
    });
    test.each(['2026-13-01', 'abc', '2026-2-3', '2026-10-17', '2019-12-31', '2019-12-30'])('date %s is a 400 with no Zoho call', async function (d) {
      fakeNow();
      var r = await call({ type: 'week', date: d });
      expect(r._status).toBe(400);
      expect(zohoApi.zohoGet).not.toHaveBeenCalled();
    });
  });

  describe('periods', function () {
    test('current week without date: Mon-Sun, ends today, newest first', async function () {
      fakeNow();
      var r = await call({ type: 'week' });
      var j = r._json;
      expect(r._status).toBe(null);
      expect(j.period_start).toBe('2026-10-12');
      expect(j.period_end).toBe('2026-10-18');
      expect(j.range_start).toBe('2026-10-12');
      expect(j.range_end).toBe('2026-10-16');
      expect(j.today).toBe('2026-10-16');
      expect(j.current).toBe(true);
      expect(j.next_anchor).toBeNull();
      expect(j.prev_anchor).toBe('2026-10-11');
      expect(j.days.map(function (d) { return d.date; })).toEqual(['2026-10-16', '2026-10-15', '2026-10-14', '2026-10-13', '2026-10-12']);
    });
    test('past month: 30 rows, not current, next anchor is first of next month', async function () {
      fakeNow();
      var j = (await call({ type: 'month', date: '2026-09-10' }))._json;
      expect(j.days).toHaveLength(30);
      expect(j.days[0].date).toBe('2026-09-30');
      expect(j.days[29].date).toBe('2026-09-01');
      expect(j.current).toBe(false);
      expect(j.next_anchor).toBe('2026-10-01');
      expect(j.prev_anchor).toBe('2026-08-31');
    });
    test('first week clamps to 2020-01-01 and the clamped range_start reloads the same period', async function () {
      fakeNow();
      var j = (await call({ type: 'week', date: '2020-01-01' }))._json;
      expect(j.period_start).toBe('2019-12-30');
      expect(j.range_start).toBe('2020-01-01');
      expect(j.prev_anchor).toBeNull();
      router._internals.resetCacheState();
      var again = await call({ type: 'week', date: j.range_start });
      expect(again._status).toBe(null);
      expect(again._json.period_start).toBe('2019-12-30');
    });
    test('zero fill', async function () {
      fakeNow();
      mockZoho({ invoices: [], payments: [] });
      var j = (await call({ type: 'week' }))._json;
      expect(j.days).toHaveLength(5);
      j.days.forEach(function (d) {
        expect(d).toEqual({ date: d.date, count: 0, gross_total: 0, partial: false });
      });
      expect(j.count).toBe(0);
      expect(j.gross_total).toBe(0);
    });
  });

  describe('D-12 equality', function () {
    test('every day count and gross equals the day ledger, and the footer equals the sums', async function () {
      fakeNow();
      var j = (await call({ type: 'week' }))._json;
      var sumCount = 0;
      var sumCents = 0;
      var sawNonZero = 0;
      for (var i = 0; i < j.days.length; i++) {
        var d = j.days[i];
        router._internals.resetCacheState();
        var l = (await callLedger({ date: d.date }))._json;
        expect(l.date).toBe(d.date);
        expect(d.count).toBe(l.count);
        expect(Math.round(d.gross_total * 100)).toBe(Math.round(l.gross_total * 100));
        sumCount += d.count;
        sumCents += Math.round(d.gross_total * 100);
        if (d.count > 0) sawNonZero++;
      }
      expect(sawNonZero).toBeGreaterThan(3);
      expect(j.count).toBe(sumCount);
      expect(Math.round(j.gross_total * 100)).toBe(sumCents);
    });
    test('fixture sanity values', async function () {
      fakeNow();
      var j = (await call({ type: 'week' }))._json;
      var byDate = {};
      j.days.forEach(function (d) { byDate[d.date] = d; });
      // 10-12: KIOSK-1 10.10 only (backdated INV-10 and late-paid INV-12 excluded)
      expect(byDate['2026-10-12'].count).toBe(1);
      expect(byDate['2026-10-12'].gross_total).toBe(10.1);
      // 10-13: POS 20.20 + blank 30.30
      expect(byDate['2026-10-13'].count).toBe(2);
      expect(byDate['2026-10-13'].gross_total).toBe(50.5);
    });
  });

  describe('payments fetch', function () {
    test('skipped when every invoice is KIOSK-/POS-/blank', async function () {
      fakeNow();
      mockZoho({ invoices: [
        inv(1, 'INV-1', 'KIOSK-1', '2026-10-14T10:00:00-0700', 'paid', 5),
        inv(2, 'INV-2', 'POS-2', '2026-10-15T10:00:00-0700', 'paid', 6),
        inv(3, 'INV-3', '', '2026-10-15T11:00:00-0700', 'paid', 7)
      ] });
      var j = (await call({ type: 'week' }))._json;
      expect(callsTo('/customerpayments')).toHaveLength(0);
      expect(j.count).toBe(3);
    });
    test.each(['ABC1', '48213377'])('runs once, ranged, when an invoice has ref %s', async function (ref) {
      fakeNow();
      mockZoho({ invoices: [
        inv(1, 'INV-1', 'KIOSK-1', '2026-10-14T10:00:00-0700', 'paid', 5),
        inv(2, 'INV-2', ref, '2026-10-15T10:00:00-0700', 'paid', 6)
      ] });
      await call({ type: 'week' });
      var c = callsTo('/customerpayments');
      expect(c).toHaveLength(1);
      expect(c[0][1].date_start).toBe('2026-10-12');
      expect(c[0][1].date_end).toBe('2026-10-17');
    });
    test('invoice query params', async function () {
      fakeNow();
      await call({ type: 'week' });
      var c = callsTo('/invoices');
      expect(c[0][1]).toEqual(expect.objectContaining({
        date_start: '2026-10-12', date_end: '2026-10-17', sort_column: 'created_time', sort_order: 'D', per_page: 200
      }));
    });
  });

  describe('caps', function () {
    test('invoice paging stops at 5, ignores request params, flags partial days', async function () {
      fakeNow();
      mockZoho({ invoices: [inv(1, 'INV-1', 'KIOSK-1', '2026-10-14T10:00:00-0700', 'paid', 5)], moreInvoices: true });
      var r = await call({ type: 'week', per_page: '9999', page: '50', max_pages: '99' });
      var c = callsTo('/invoices');
      expect(c).toHaveLength(5);
      c.forEach(function (x) { expect(x[1].per_page).toBe(200); });
      var j = r._json;
      expect(j.truncated).toBe(true);
      var byDate = {};
      j.days.forEach(function (d) { byDate[d.date] = d; });
      expect(byDate['2026-10-12'].partial).toBe(true);
      expect(byDate['2026-10-14'].partial).toBe(true);
      expect(byDate['2026-10-15'].partial).toBe(false);
      expect(byDate['2026-10-16'].partial).toBe(false);
    });
    test('truncated with no invoices fetched marks every day partial', async function () {
      fakeNow();
      mockZoho({ invoices: [], moreInvoices: true });
      var j = (await call({ type: 'week' }))._json;
      expect(j.truncated).toBe(true);
      j.days.forEach(function (d) { expect(d.partial).toBe(true); });
    });
    test('payment cap hit sets classification_incomplete', async function () {
      fakeNow();
      mockZoho({ invoices: [inv(1, 'INV-1', 'ABC1', '2026-10-14T10:00:00-0700', 'paid', 5)], morePayments: true });
      var j = (await call({ type: 'week' }))._json;
      expect(callsTo('/customerpayments')).toHaveLength(5);
      expect(j.classification_incomplete).toBe(true);
    });
    test('constants', function () {
      expect(router._internals.caps.RANGE_MAX_INVOICE_PAGES).toBe(5);
      expect(router._internals.caps.RANGE_MAX_PAYMENT_PAGES).toBe(5);
    });
  });

  describe('slim output', function () {
    test('exact key set and no PII', async function () {
      fakeNow();
      var j = (await call({ type: 'week' }))._json;
      expect(Object.keys(j).sort()).toEqual(CONTRACT_KEYS);
      j.days.forEach(function (d) {
        expect(Object.keys(d).sort()).toEqual(['count', 'date', 'gross_total', 'partial']);
      });
      var s = JSON.stringify(j);
      expect(s).not.toMatch(/SENTINEL_/);
    });
    test('route file has no write paths or fan-out', function () {
      var src = fs.readFileSync(path.join(__dirname, '../routes/kiosk-history.js'), 'utf8');
      expect(src).not.toMatch(/router\.(post|put|delete)|zohoPost|zohoPut/);
      expect(src).not.toMatch(/Promise\.all/);
      expect(src).not.toMatch(/q\.(per_page|page|max_pages)/);
    });
  });

  describe('cache', function () {
    test('key uses the nominal period start for any anchor in the period; TTL 300 current', async function () {
      fakeNow();
      await call({ type: 'week', date: '2026-10-12' });
      router._internals.resetCacheState();
      await call({ type: 'week', date: '2026-10-15' });
      expect(cache.set).toHaveBeenCalledTimes(2);
      cache.set.mock.calls.forEach(function (c) {
        expect(c[0]).toBe('kiosk:history:range:v1:week:2026-10-12');
        expect(c[2]).toBe(300);
      });
    });
    test('past month TTL 3600', async function () {
      fakeNow();
      await call({ type: 'month', date: '2026-09-10' });
      expect(cache.set.mock.calls[0][0]).toBe('kiosk:history:range:v1:month:2026-09-01');
      expect(cache.set.mock.calls[0][2]).toBe(3600);
    });
    test('cache hit skips Zoho', async function () {
      fakeNow();
      cache.get.mockResolvedValue({ type: 'week', cached: true });
      var r = await call({ type: 'week' });
      expect(r._json.cached).toBe(true);
      expect(zohoApi.zohoGet).not.toHaveBeenCalled();
    });
    test('bust=1 skips the cache read', async function () {
      fakeNow();
      cache.get.mockResolvedValue({ type: 'week', cached: true });
      var r = await call({ type: 'week', bust: '1' });
      expect(cache.get).not.toHaveBeenCalled();
      expect(r._json.cached).toBeUndefined();
      expect(zohoApi.zohoGet).toHaveBeenCalled();
    });
    test('Zoho failure is 502 and not cached', async function () {
      fakeNow();
      mockZoho({ fail: true });
      var r = await call({ type: 'week' });
      expect(r._status).toBe(502);
      expect(r._json).toEqual({ error: 'Unable to fetch sales' });
      expect(cache.set).not.toHaveBeenCalled();
      expect(log.error).toHaveBeenCalled();
    });
  });
});
