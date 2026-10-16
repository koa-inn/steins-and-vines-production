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

describe('authTiers past-sales registration', function () {
  test('KIOSK_ROUTES lists the past-sales paths', function () {
    expect(authTiers.KIOSK_ROUTES).toEqual(expect.arrayContaining([
      '/api/kiosk/past-sales/ledger', '/api/kiosk/past-sales/customer', '/api/kiosk/past-sales/invoice/:id'
    ]));
  });
  test('isKioskRoute', function () {
    expect(authTiers.isKioskRoute('/api/kiosk/past-sales/invoice/123456789')).toBe(true);
    expect(authTiers.isKioskRoute('/api/kiosk/past-sales/ledger')).toBe(true);
    expect(authTiers.isKioskRoute('/api/kiosk/past-sales/other')).toBe(false);
    expect(authTiers.isKioskRoute('/api/invoices')).toBe(false);
  });
});

describe('indexPaymentsByInvoice', function () {
  test('fixture invoice_numbers linkage with description notes', function () {
    var idx = hist.indexPaymentsByInvoice(fixture.customerpayments_list.customerpayments, fixture._meta.linkage_field, fixture._meta.notes_field);
    expect(idx['INV-900001']).toEqual([{ payment_mode: 'creditcard', note: '' }]);
    expect(idx['INV-900002'][0].note).toBe('Kiosk POS terminal payment.');
  });
  test('comma string splits to several invoices; no linkage yields {}', function () {
    var idx = hist.indexPaymentsByInvoice([{ invoice_numbers: 'INV-1, INV-2', payment_mode: 'cash', description: 'x' }, { payment_mode: 'cash' }], 'invoice_numbers', 'description');
    expect(Object.keys(idx).sort()).toEqual(['INV-1', 'INV-2']);
    expect(hist.indexPaymentsByInvoice([{ payment_mode: 'cash' }], 'invoice_numbers', 'description')).toEqual({});
  });
  test('invoices[] array linkage', function () {
    var idx = hist.indexPaymentsByInvoice([{ invoices: [{ invoice_id: 7, invoice_number: 'INV-7' }], payment_mode: 'cash', notes: 'n' }], 'invoices', 'notes');
    expect(idx['7']).toEqual([{ payment_mode: 'cash', note: 'n' }]);
    expect(idx['INV-7']).toHaveLength(1);
  });
});

describe('validateConfig', function () {
  test('accepts and rejects', function () {
    expect(function () { router.validateConfig({ joinMode: 'list-join' }); }).not.toThrow();
    expect(function () { router.validateConfig({ joinMode: 'bogus' }); }).toThrow();
    expect(function () { router.validateConfig({ joinMode: 'none', noneBlankPolicy: null }); }).toThrow();
    expect(function () { router.validateConfig({ joinMode: 'none', noneBlankPolicy: 'exclude' }); }).not.toThrow();
  });
  test('shipped config is list-join', function () {
    expect(router._config.joinMode).toBe('list-join');
  });
});

// ---------------------------------------------------------------------------
// GET /api/kiosk/past-sales/ledger
// ---------------------------------------------------------------------------
var DEVICE = 'test-kiosk-device-token-9203';
var MW = 'test-api-key-ledger';
var DAY = '2026-10-15';
var ledgerHandler = findHandler('/api/kiosk/past-sales/ledger');

function inv(id, number, ref, created, status, total) {
  return {
    invoice_id: String(id), invoice_number: number, reference_number: ref, created_time: created,
    date: created.slice(0, 10), status: status || 'paid', total: total === undefined ? 10 : total, balance: 0,
    customer_name: 'Cust ' + id, email: 'SENTINEL_EMAIL@x.test', phone: 'SENTINEL_PHONE',
    notes: 'SENTINEL_NOTES', custom_fields: [{ value: 'SENTINEL_CF' }], customer_id: 'SENTINEL_CID'
  };
}
function pay(numbers, mode, note) {
  return { invoice_numbers: numbers, payment_mode: mode, description: note || '', reference_number: 'SENTINEL_PAYREF', amount: 1 };
}
function dayInvoices() {
  return [
    inv(1, 'INV-1', 'KIOSK-1', '2026-10-15T10:00:00-0700', 'paid', 10),
    inv(2, 'INV-2', 'POS-2', '2026-10-15T11:00:00-0700', 'paid', 20),
    inv(3, 'INV-3', '', '2026-10-15T12:00:00-0700', 'paid', 30),
    inv(4, 'INV-4', '', '2026-10-15T13:00:00-0700', 'paid', 40),
    inv(5, 'INV-5', '48213377', '2026-10-15T14:00:00-0700', 'paid', 50),
    inv(6, 'INV-6', '', '2026-10-15T15:00:00-0700', 'draft', 60),
    inv(7, 'INV-7', 'KIOSK-7', '2026-10-15T16:00:00-0700', 'void', 70),
    Object.assign(inv(8, 'INV-8', 'KIOSK-8', '2026-10-15T19:30:00-0700', 'paid', 80), { date: '2026-10-16' }),
    inv(9, 'INV-9', 'KIOSK-9', '2026-10-16T09:00:00-0700', 'paid', 90),
    inv(10, 'INV-10', '123456', '2026-10-15T17:00:00-0700', 'paid', 100),
    inv(11, 'INV-11', 'KIOSK-11', '2026-10-15T18:00:00-0700', 'paid', 110)
  ];
}
function dayPayments() {
  return [
    pay('INV-1', 'cash'),
    pay('INV-3', 'creditcard', 'Kiosk SO payment. Terminal txn: 1'),
    pay('INV-4', 'debitcard', 'In-store terminal payment. Helcim txn: 2'),
    pay('INV-5', 'creditcard', 'Online payment for Invoice'),
    pay('INV-10', 'creditcard', 'Kiosk recipe sale. Ref: 1'),
    pay('INV-11', 'others'),
    pay('INV-11', 'creditcard')
  ];
}
function mockZoho(opts) {
  opts = opts || {};
  zohoApi.zohoGet.mockImplementation(function (path, params) {
    if (opts.fail) return Promise.reject(new Error('zoho down'));
    if (path === '/invoices') {
      return Promise.resolve({ invoices: opts.invoices || dayInvoices(), page_context: { has_more_page: !!opts.more } });
    }
    if (path === '/customerpayments') {
      return Promise.resolve({ customerpayments: opts.payments || dayPayments(), page_context: { has_more_page: false } });
    }
    return Promise.reject(new Error('unexpected ' + path + JSON.stringify(params)));
  });
}
async function call(query, headers) {
  var res = makeRes();
  ledgerHandler(makeReq(query, headers || { 'x-device-token': DEVICE }), res);
  await settle();
  return res;
}

describe('GET /api/kiosk/past-sales/ledger', function () {
  var oldDev, oldMw;
  beforeEach(function () {
    jest.clearAllMocks();
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
  function fakeNow() {
    jest.useFakeTimers({ now: new Date('2026-10-16T22:00:00Z'), doNotFake: ['setImmediate', 'nextTick', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  }

  test('auth: no credential 401, wrong device token 403, api key 200, device 200', async function () {
    fakeNow();
    var r0 = makeRes();
    ledgerHandler(makeReq({}, {}), r0);
    expect(r0._status).toBe(401);
    expect(zohoApi.zohoGet).not.toHaveBeenCalled();
    expect((await call({}, { 'x-device-token': 'wrong' }))._status).toBe(403);
    expect((await call({ date: DAY }, { 'x-api-key': MW }))._json.date).toBe(DAY);
    expect((await call({ date: DAY }))._json.date).toBe(DAY);
  });

  test('no date means today in Vancouver with null next_date', async function () {
    fakeNow();
    var r = await call({});
    expect(r._json.date).toBe('2026-10-16');
    expect(r._json.today).toBe('2026-10-16');
    expect(r._json.next_date).toBeNull();
    expect(r._json.prev_date).toBe('2026-10-15');
  });

  test.each(['2026-13-01', 'abc', '2026-10-17', '2019-12-31', '2026-2-3'])('date %s is a 400 with no Zoho call', async function (d) {
    fakeNow();
    var r = await call({ date: d });
    expect(r._status).toBe(400);
    expect(r._json.error).toBe('bad_request');
    expect(zohoApi.zohoGet).not.toHaveBeenCalled();
    expect(cache.get).not.toHaveBeenCalled();
  });

  test('past day: in-store only, bucketed to Vancouver day, newest first, voids excluded from totals', async function () {
    fakeNow();
    var r = await call({ date: DAY });
    expect(r._status).toBeNull();
    var nums = r._json.invoices.map(function (i) { return i.invoice_number; });
    // INV-5 online excluded, INV-9 is D+1; blank-ref INV-6 (no payment) is in-store per owner decision
    expect(nums).toEqual(['INV-8', 'INV-11', 'INV-10', 'INV-7', 'INV-6', 'INV-4', 'INV-3', 'INV-2', 'INV-1']);
    expect(r._json.next_date).toBe('2026-10-16');
    expect(r._json.prev_date).toBe('2026-10-14');
    var void7 = r._json.invoices.filter(function (i) { return i.invoice_number === 'INV-7'; })[0];
    expect(void7.status).toBe('Void');
    expect(r._json.count).toBe(8);
    expect(r._json.gross_total).toBe(10 + 20 + 30 + 40 + 60 + 80 + 100 + 110);
    expect(r._json.invoices.every(function (i) { return i.source === 'in-store'; })).toBe(true);
    expect(r._json.classification_incomplete).toBe(false);
    expect(r._json.unclassified_count).toBe(0);
  });

  test('tender labels', async function () {
    fakeNow();
    var r = await call({ date: DAY });
    var t = {};
    r._json.invoices.forEach(function (i) { t[i.invoice_number] = i.tender; });
    expect(t['INV-1']).toBe('Cash');
    expect(t['INV-3']).toBe('Card');
    expect(t['INV-4']).toBe('Card');
    expect(t['INV-11']).toBe('Card + Gift card');
    expect(t['INV-2']).toBe('');
    expect(r._json.tender_incomplete).toBe(true);
  });

  test('response exposes only ROW_KEYS and no PII sentinels', async function () {
    fakeNow();
    var r = await call({ date: DAY });
    r._json.invoices.forEach(function (row) {
      expect(Object.keys(row).sort()).toEqual(hist.ROW_KEYS.slice().sort());
    });
    expect(JSON.stringify(r._json)).not.toMatch(/SENTINEL|KIOSK-|POS-/);
  });

  test('response contract top-level keys', async function () {
    fakeNow();
    var r = await call({ date: DAY });
    expect(Object.keys(r._json).sort()).toEqual(['classification_incomplete', 'count', 'date', 'gross_total', 'invoices', 'next_date', 'prev_date', 'tender_incomplete', 'today', 'truncated', 'unclassified_count']);
  });

  test('caps: per_page/page/status ignored, sequential, at most 3 invoice pages, truncated', async function () {
    fakeNow();
    mockZoho({ more: true });
    var r = await call({ date: DAY, per_page: '1000', page: '9', status: 'void' });
    var calls = zohoApi.zohoGet.mock.calls;
    var invCalls = calls.filter(function (c) { return c[0] === '/invoices'; });
    expect(invCalls).toHaveLength(3);
    expect(invCalls.map(function (c) { return c[1].page; })).toEqual([1, 2, 3]);
    calls.forEach(function (c) {
      expect(c[1].per_page).toBe(200);
      expect(c[1]).not.toHaveProperty('status');
    });
    expect(r._json.truncated).toBe(true);
    var paths = calls.map(function (c) { return c[0]; });
    expect(paths.indexOf('/customerpayments')).toBeGreaterThan(paths.lastIndexOf('/invoices'));
    expect(paths.some(function (p) { return /^\/invoices\/./.test(p); })).toBe(false);
  });

  test('one ranged payments call D..D+1', async function () {
    fakeNow();
    await call({ date: DAY });
    var payCalls = zohoApi.zohoGet.mock.calls.filter(function (c) { return c[0] === '/customerpayments'; });
    expect(payCalls).toHaveLength(1);
    expect(payCalls[0][1].date_start).toBe(DAY);
    expect(payCalls[0][1].date_end).toBe('2026-10-16');
  });

  test('cache hit skips Zoho; bust skips read and rewrites; TTLs and key', async function () {
    fakeNow();
    cache.get.mockResolvedValueOnce({ date: DAY, cached: true });
    var hit = await call({ date: DAY });
    expect(hit._json.cached).toBe(true);
    expect(zohoApi.zohoGet).not.toHaveBeenCalled();

    cache.get.mockClear();
    await call({ date: DAY, bust: '1' });
    expect(cache.get).not.toHaveBeenCalled();
    expect(cache.set).toHaveBeenCalledWith(C.CACHE_KEYS.KIOSK_HISTORY_LEDGER_PREFIX + DAY, expect.any(Object), 3600);

    cache.set.mockClear();
    await call({});
    expect(cache.set).toHaveBeenCalledWith(C.CACHE_KEYS.KIOSK_HISTORY_LEDGER_PREFIX + '2026-10-16', expect.any(Object), 60);
  });

  test('cache read error is a miss', async function () {
    fakeNow();
    cache.get.mockRejectedValueOnce(new Error('redis down'));
    var r = await call({ date: DAY });
    expect(r._json.invoices.length).toBeGreaterThan(0);
  });

  test('Zoho failure is 502, not cached, log has no names', async function () {
    fakeNow();
    mockZoho({ fail: true });
    var r = await call({ date: DAY });
    expect(r._status).toBe(502);
    expect(r._json).toEqual({ error: 'Unable to fetch sales' });
    expect(cache.set).not.toHaveBeenCalled();
    expect(log.error.mock.calls[0][0]).not.toMatch(/Cust /);
  });

  test('unbuilt join mode fails loudly with 502', async function () {
    fakeNow();
    router._config.joinMode = 'detail-fallback';
    try {
      var r = await call({ date: DAY });
      expect(r._status).toBe(502);
      expect(zohoApi.zohoGet).not.toHaveBeenCalled();
    } finally {
      router._config.joinMode = 'list-join';
    }
  });
});
