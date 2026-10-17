'use strict';

// Phase 93 review WR-03 (day ‹ floor state) and IN-06 (stepping while a range
// loads or after it fails). Harness mirrors kiosk-past-sales-range-drill.test.js;
// that file is untouched.

var fs = require('fs');
var path = require('path');

global.window = global.window || {};
global.window.addEventListener = global.window.addEventListener || jest.fn();
global.navigator = global.navigator || { userAgent: 'test' };
global.console = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() };
global.alert = jest.fn();
global.fetch = jest.fn();

global.SHEETS_CONFIG = {
  MIDDLEWARE_URL: 'http://localhost:3001',
  MW_API_KEY: 'test-key',
  SPREADSHEET_ID: 'test-id',
  GOOGLE_CLIENT_ID: 'test-client-id',
  STAFF_EMAILS: 'test@example.com',
  API_BASE: 'https://script.google.com/test',
  SERVER_TOKEN: 'test-token'
};

var DEVICE_TOKEN_KEY = 'sv_kiosk_device_token';
var KIOSK_HTML = fs.readFileSync(path.join(__dirname, '../../kiosk.html'), 'utf8');

function flushPromises() {
  return new Promise(function (resolve) { setTimeout(resolve, 0); });
}

function el(id) {
  var node = document.getElementById(id);
  if (!node) throw new Error('expected #' + id);
  return node;
}

function injectRealMarkup() {
  document.body.innerHTML = '';
  var doc = new DOMParser().parseFromString(KIOSK_HTML, 'text/html');
  ['kiosk-past-sales-btn', 'kiosk-view-past-sales'].forEach(function (id) {
    var node = doc.getElementById(id);
    if (!node) throw new Error('kiosk.html is missing #' + id);
    document.body.appendChild(document.importNode(node, true));
  });
  ['browse', 'browse-customer', 'customer', 'payment', 'receipt', 'collect'].forEach(function (v) {
    var d = document.createElement('div');
    d.id = 'kiosk-view-' + v;
    document.body.appendChild(d);
  });
  var lock = document.createElement('div');
  lock.id = 'kiosk-lock-screen';
  var keypad = document.createElement('div');
  keypad.id = 'kiosk-lock-keypad';
  lock.appendChild(keypad);
  document.body.appendChild(lock);
}

function loadSurface() {
  jest.resetModules();
  if (global.window) delete global.window.KioskCore;
  document.body.innerHTML = '';
  var mod = require('../../js/kiosk.js');
  injectRealMarkup();
  localStorage.setItem(DEVICE_TOKEN_KEY, 'ps-token');
  global.fetch.mockImplementation(function () { return respond(200, {}); });
  mod._initKioskSaleTab(); // wires the Past Sales controls (incl. #kiosk-ps-backlink)
  global.fetch.mockReset();
  return { mod: mod, core: global.window.KioskCore };
}

function openLedger(s) {
  s.core.showView('browse');
  s.core.showPastSales();
  s.core.pastSalesSetTab('ledger');
}

function merge(base, overrides) {
  var out = {};
  Object.keys(base).forEach(function (k) { out[k] = base[k]; });
  Object.keys(overrides || {}).forEach(function (k) { out[k] = overrides[k]; });
  return out;
}

function weekBody(overrides) {
  return merge({
    type: 'week',
    period_start: '2026-10-12',
    period_end: '2026-10-18',
    range_start: '2026-10-12',
    range_end: '2026-10-16',
    today: '2026-10-16',
    current: true,
    prev_anchor: '2026-10-11',
    next_anchor: null,
    days: [
      { date: '2026-10-16', count: 3, gross_total: 100, partial: false },
      { date: '2026-10-15', count: 1, gross_total: 20.5, partial: false },
      { date: '2026-10-14', count: 0, gross_total: 0, partial: false },
      { date: '2026-10-13', count: 2, gross_total: 2.95, partial: false },
      { date: '2026-10-12', count: 1, gross_total: 0, partial: false }
    ],
    count: 7,
    gross_total: 123.45,
    truncated: false,
    classification_incomplete: false
  }, overrides);
}

function monthBody(overrides) {
  return merge({
    type: 'month',
    period_start: '2026-10-01',
    period_end: '2026-10-31',
    range_start: '2026-10-01',
    range_end: '2026-10-16',
    today: '2026-10-16',
    current: true,
    prev_anchor: '2026-09-30',
    next_anchor: null,
    days: [{ date: '2026-10-16', count: 1, gross_total: 10, partial: false }],
    count: 1,
    gross_total: 10,
    truncated: false,
    classification_incomplete: false
  }, overrides);
}

function respond(status, body) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status: status, json: function () { return Promise.resolve(body); } });
}

function resolved(body) {
  return { ok: true, status: 200, json: function () { return Promise.resolve(body); } };
}

function deferred() {
  var d = {};
  d.promise = new Promise(function (resolve) { d.resolve = resolve; });
  return d;
}

function route(handlers) {
  global.fetch.mockImplementation(function (url) {
    for (var i = 0; i < handlers.length; i++) {
      if (url.indexOf(handlers[i][0]) !== -1) return handlers[i][1](url);
    }
    return respond(404, { error: 'not_found' });
  });
}

function urls() {
  return global.fetch.mock.calls.map(function (c) { return c[0]; });
}

function dayLedgerFor(date) {
  return {
    date: date, today: '2026-10-16', prev_date: '2026-10-14', next_date: null,
    invoices: [], count: 0, gross_total: 0, truncated: false, classification_incomplete: false
  };
}

function ledgerHandler(url) {
  var m = /date=([0-9-]+)/.exec(url);
  return respond(200, dayLedgerFor(m ? m[1] : '2026-10-16'));
}

function activeMode() {
  var a = document.querySelector('.kiosk-ps-mode.active');
  return a ? a.getAttribute('data-mode') : null;
}

function panelWithScroll(value) {
  var panel = el('kiosk-ps-ledger-panel');
  Object.defineProperty(panel, 'scrollTop', { value: value, writable: true, configurable: true });
  return panel;
}

async function loadWeek(body) {
  var s = loadSurface();
  route([['/ledger', ledgerHandler], ['/range', function () { return respond(200, body || weekBody()); }]]);
  openLedger(s);
  await flushPromises();
  s.core.pastSalesSetMode('week');
  await flushPromises();
  return s;
}

function row(date) {
  return document.querySelector('.kiosk-ps-dayrow[data-date="' + date + '"]');
}

beforeEach(function () {
  localStorage.clear();
  global.fetch.mockReset();
});

var RANGE = 'http://localhost:3001/api/kiosk/past-sales/range';
var LEDGER = 'http://localhost:3001/api/kiosk/past-sales/ledger';

function floorMonthBody() {
  return monthBody({
    period_start: '2020-01-01', period_end: '2020-01-31', range_start: '2020-01-01',
    range_end: '2020-01-31', current: false, prev_anchor: null, next_anchor: '2020-02-01',
    days: [
      { date: '2020-01-15', count: 2, gross_total: 5, partial: false },
      { date: '2020-01-01', count: 1, gross_total: 3, partial: false }
    ]
  });
}

function floorDayLedger(date) {
  var prev = date === '2020-01-01' ? '2019-12-31' : '2020-01-14';
  return {
    date: date, today: '2026-10-16', prev_date: prev, next_date: '2020-01-16',
    invoices: [], count: 0, gross_total: 0, truncated: false, classification_incomplete: false
  };
}

function floorLedgerHandler(url) {
  var m = /date=([0-9-]+)/.exec(url);
  return respond(200, m && m[1].indexOf('2020-') === 0 ? floorDayLedger(m[1]) : dayLedgerFor('2026-10-16'));
}

async function loadFloorMonth() {
  var s = loadSurface();
  route([['/ledger', floorLedgerHandler], ['/range', function () { return respond(200, floorMonthBody()); }]]);
  openLedger(s);
  await flushPromises();
  s.core.pastSalesSetMode('month');
  await flushPromises();
  return s;
}

describe('WR-03: day ledger owns the ‹ state', function () {
  test('drilling into a mid-January day from the floor month enables ‹', async function () {
    await loadFloorMonth();
    expect(el('kiosk-ps-prev').disabled).toBe(true); // floor month: no prev_anchor
    row('2020-01-15').click();
    await flushPromises();
    expect(el('kiosk-ps-prev').disabled).toBe(false);
  });

  test('switching to Day while drilled in from the floor month leaves ‹ enabled', async function () {
    var s = await loadFloorMonth();
    row('2020-01-15').click();
    await flushPromises();
    s.core.pastSalesSetMode('day');
    await flushPromises();
    expect(el('kiosk-ps-prev').disabled).toBe(false);
    global.fetch.mockClear();
    s.core.pastSalesShiftDay(-1);
    await flushPromises();
    expect(urls()).toEqual([LEDGER + '?date=2020-01-14']);
  });

  test('day ledger on 2020-01-01 disables ‹ and never requests 2019-12-31', async function () {
    var s = loadSurface();
    route([['/ledger', floorLedgerHandler]]);
    openLedger(s);
    await flushPromises();
    expect(el('kiosk-ps-prev').disabled).toBe(false);
    s.core.pastSalesPickDate('2020-01-01');
    await flushPromises();
    expect(el('kiosk-ps-prev').disabled).toBe(true);
    global.fetch.mockClear();
    s.core.pastSalesShiftDay(-1);
    await flushPromises();
    expect(urls().length).toBe(0);
  });
});

describe('IN-06: same-type stepping while a range loads', function () {
  var PREV_WEEK = weekBody({
    period_start: '2026-10-05', period_end: '2026-10-11', range_start: '2026-10-05',
    range_end: '2026-10-11', current: false, prev_anchor: '2026-10-04', next_anchor: '2026-10-12',
    days: [{ date: '2026-10-07', count: 1, gross_total: 9, partial: false }], count: 1, gross_total: 9
  });

  test('‹/› are disabled while the next week loads; a second tap sends nothing', async function () {
    await loadWeek();
    var d = deferred();
    route([['/ledger', ledgerHandler], ['/range', function () { return d.promise; }]]);
    global.fetch.mockClear();
    el('kiosk-ps-prev').click();
    expect(el('kiosk-ps-prev').disabled).toBe(true);
    expect(el('kiosk-ps-next').disabled).toBe(true);
    el('kiosk-ps-prev').click(); // fast double tap
    expect(urls()).toEqual([RANGE + '?type=week&date=2026-10-11']);
    d.resolve(resolved(PREV_WEEK));
    await flushPromises();
    expect(el('kiosk-ps-prev').disabled).toBe(false);
    expect(el('kiosk-ps-next').disabled).toBe(false);
    expect(el('kiosk-ps-range-label').textContent).toBe('Oct 5 – 11');
  });

  test('failed step: label, date input and ↻ all follow the period Retry will load', async function () {
    var s = await loadWeek();
    route([['/ledger', ledgerHandler], ['/range', function () { return respond(502, {}); }]]);
    s.core.pastSalesShiftDay(-1);
    await flushPromises();
    expect(el('kiosk-ps-ledger-message').textContent).toContain('Could not load sales');
    expect(s.core._getPastSalesState().range).toBeNull();
    expect(el('kiosk-ps-range-label').textContent).toBe('');
    expect(el('kiosk-ps-date').value).toBe('2026-10-11');
    expect(el('kiosk-ps-prev').disabled).toBe(true);
    expect(el('kiosk-ps-next').disabled).toBe(true);

    global.fetch.mockClear();
    document.querySelector('#kiosk-ps-ledger-message .kiosk-ps-retry').click();
    await flushPromises();
    expect(urls()).toEqual([RANGE + '?type=week&date=2026-10-11']);

    global.fetch.mockClear();
    s.core.pastSalesRefresh();
    await flushPromises();
    expect(urls()).toEqual([RANGE + '?type=week&date=2026-10-11&bust=1']);
  });

  test('a successful Retry after a failed step re-enables stepping from the new week', async function () {
    var s = await loadWeek();
    var fail = true;
    route([['/ledger', ledgerHandler], ['/range', function () {
      return fail ? respond(502, {}) : respond(200, PREV_WEEK);
    }]]);
    s.core.pastSalesShiftDay(-1);
    await flushPromises();
    fail = false;
    document.querySelector('#kiosk-ps-ledger-message .kiosk-ps-retry').click();
    await flushPromises();
    expect(el('kiosk-ps-prev').disabled).toBe(false);
    expect(el('kiosk-ps-next').disabled).toBe(false);
    expect(el('kiosk-ps-date').value).toBe('2026-10-11');
    expect(el('kiosk-ps-range-label').textContent).toBe('Oct 5 – 11');
  });

  test('failed type switch clears the stale date input (WR-01 residual)', async function () {
    var s = await loadWeek();
    route([['/ledger', ledgerHandler], ['/range', function () { return respond(502, {}); }]]);
    s.core.pastSalesSetMode('month');
    await flushPromises();
    expect(el('kiosk-ps-date').value).toBe('');
  });
});
