'use strict';

// Phase 93-04: drill-in from a range day to the day ledger, Back with scroll
// restore, mode-aware refresh and D-11 clearing. Real kiosk.html markup; fetch
// mocked. (Harness mirrors kiosk-past-sales-range.test.js; that file is untouched.)

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
  var mod = require('../../js/kiosk.js'); // eslint-disable-line global-require -- per-test isolation
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

function backlink() {
  return el('kiosk-ps-backlink');
}

function rowCount() {
  return document.querySelectorAll('#kiosk-ps-ledger-list .kiosk-ps-dayrow').length;
}

beforeEach(function () {
  localStorage.clear();
  global.fetch.mockReset();
});

describe('Drill-in', function () {
  test('tapping a day with sales opens that day ledger, no chip active, back link shown', async function () {
    await loadWeek();
    global.fetch.mockClear();
    row('2026-10-15').click();
    await flushPromises();
    expect(urls()).toEqual(['http://localhost:3001/api/kiosk/past-sales/ledger?date=2026-10-15']);
    expect(activeMode()).toBeNull();
    expect(backlink().style.display).not.toBe('none');
    expect(backlink().textContent).toBe('‹ Back to week');
    expect(el('kiosk-ps-range-label').textContent).toBe('');
  });

  test('month drill-in says Back to month', async function () {
    var s = loadSurface();
    route([['/ledger', ledgerHandler], ['/range', function () { return respond(200, monthBody()); }]]);
    openLedger(s);
    await flushPromises();
    s.core.pastSalesSetMode('month');
    await flushPromises();
    row('2026-10-16').click();
    expect(backlink().textContent).toBe('‹ Back to month');
  });

  test('zero-sale row is inert', async function () {
    await loadWeek();
    global.fetch.mockClear();
    row('2026-10-14').click();
    await flushPromises();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(activeMode()).toBe('week');
    expect(backlink().style.display).toBe('none');
  });

  test('Day prev/next while drilled in step days and keep the back link', async function () {
    var s = await loadWeek();
    row('2026-10-15').click();
    await flushPromises();
    s.core._getPastSalesState();
    global.fetch.mockClear();
    s.core.pastSalesShiftDay(-1);
    await flushPromises();
    expect(urls()[0]).toContain('/ledger?date=');
    expect(backlink().style.display).not.toBe('none');
  });

  test('tapping Day while drilled in clears origin and keeps the day ledger', async function () {
    var s = await loadWeek();
    row('2026-10-15').click();
    await flushPromises();
    global.fetch.mockClear();
    s.core.pastSalesSetMode('day');
    await flushPromises();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(activeMode()).toBe('day');
    expect(backlink().style.display).toBe('none');
    expect(s.core._getPastSalesState().origin).toBeNull();
    expect(s.core._getPastSalesState().ledger.date).toBe('2026-10-15');
  });

  test('tapping Month while drilled in clears origin and loads the period', async function () {
    var s = await loadWeek();
    row('2026-10-15').click();
    await flushPromises();
    global.fetch.mockClear();
    s.core.pastSalesSetMode('month');
    await flushPromises();
    expect(urls()[0]).toContain('/range?type=month');
    expect(backlink().style.display).toBe('none');
    expect(s.core._getPastSalesState().origin).toBeNull();
  });
});

describe('Back with scroll restore', function () {
  test('Back re-renders from memory with no fetch and restores scrollTop', async function () {
    var s = await loadWeek();
    var panel = panelWithScroll(240);
    row('2026-10-15').click();
    await flushPromises();
    panel.scrollTop = 0;
    global.fetch.mockClear();
    backlink().click();
    await flushPromises();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(activeMode()).toBe('week');
    expect(backlink().style.display).toBe('none');
    expect(rowCount()).toBe(5);
    expect(el('kiosk-ps-range-label').textContent).toBe('Oct 12 – 18');
    expect(panel.scrollTop).toBe(240);
    expect(s.core._getPastSalesState().origin).toBeNull();
  });

  test('late day response after Back does not replace the restored range', async function () {
    var s = await loadWeek();
    var d = deferred();
    route([['/ledger', function () { return d.promise; }], ['/range', function () { return respond(200, weekBody()); }]]);
    row('2026-10-15').click();
    backlink().click();
    await flushPromises();
    d.resolve(resolved(dayLedgerFor('2026-10-15')));
    await flushPromises();
    expect(rowCount()).toBe(5);
    expect(s.core._getPastSalesState().ledger.date).toBe('2026-10-16');
  });

  test('late range response after a drill-in does not replace the day ledger', async function () {
    var s = await loadWeek();
    var d = deferred();
    route([['/ledger', ledgerHandler], ['/range', function () { return d.promise; }]]);
    var staleRow = row('2026-10-15');
    s.core.pastSalesRefresh();
    staleRow.click(); // detached by the skeleton; its listener still fires a drill-in attempt
    await flushPromises();
    d.resolve(resolved(weekBody({ count: 99 })));
    await flushPromises();
    expect(s.core._getPastSalesState().range.count).toBe(7);
    expect(rowCount()).toBe(0);
  });
});

describe('Mode-aware refresh', function () {
  test('refresh in Week busts the range by range_start', async function () {
    var s = await loadWeek();
    global.fetch.mockClear();
    s.core.pastSalesRefresh();
    await flushPromises();
    expect(urls()).toEqual(['http://localhost:3001/api/kiosk/past-sales/range?type=week&date=2026-10-12&bust=1']);
  });

  test('refresh while drilled in busts only that day', async function () {
    var s = await loadWeek();
    row('2026-10-15').click();
    await flushPromises();
    global.fetch.mockClear();
    s.core.pastSalesRefresh();
    await flushPromises();
    expect(urls()).toEqual(['http://localhost:3001/api/kiosk/past-sales/ledger?date=2026-10-15&bust=1']);
  });

  test('floor week: refresh and Back never send the pre-floor period_start', async function () {
    var floor = weekBody({
      period_start: '2019-12-30', period_end: '2020-01-05', range_start: '2020-01-01',
      range_end: '2020-01-05', prev_anchor: null,
      days: [{ date: '2020-01-01', count: 2, gross_total: 5, partial: false }]
    });
    var s = await loadWeek(floor);
    global.fetch.mockClear();
    s.core.pastSalesRefresh();
    await flushPromises();
    expect(urls()).toEqual(['http://localhost:3001/api/kiosk/past-sales/range?type=week&date=2020-01-01&bust=1']);
    row('2020-01-01').click();
    await flushPromises();
    global.fetch.mockClear();
    backlink().click();
    await flushPromises();
    urls().forEach(function (u) { expect(u).not.toContain('2019-'); });
  });
});

describe('D-11 clearing of drill-in state', function () {
  async function drilled() {
    var s = await loadWeek();
    row('2026-10-15').click();
    await flushPromises();
    return s;
  }

  function expectClean(s) {
    var st = s.core._getPastSalesState();
    expect(st.mode).toBe('day');
    expect(st.range).toBeNull();
    expect(st.origin).toBeNull();
    expect(backlink().style.display).toBe('none');
    expect(el('kiosk-ps-ledger-list').innerHTML).toBe('');
  }

  test('Customer View exit path', async function () {
    var s = await drilled();
    s.core.showView('browse-customer');
    expectClean(s);
  });

  test('lock screen clearPastSales', async function () {
    var s = await drilled();
    s.core.clearPastSales();
    expectClean(s);
  });

  test('new sale (browse view)', async function () {
    var s = await drilled();
    s.core.showView('browse');
    expectClean(s);
  });

  test('reopening Ledger requests the day ledger for today', async function () {
    var s = await drilled();
    s.core.clearPastSales();
    global.fetch.mockClear();
    openLedger(s);
    await flushPromises();
    expect(urls()[0]).toBe('http://localhost:3001/api/kiosk/past-sales/ledger');
  });

  test('range response resolving after a clear is dropped', async function () {
    var s = await loadWeek();
    var d = deferred();
    route([['/range', function () { return d.promise; }]]);
    s.core.pastSalesRefresh();
    s.core.clearPastSales();
    d.resolve(resolved(weekBody()));
    await flushPromises();
    expectClean(s);
  });
});

describe('Gap WR-01: Week/Month switch drops the stale payload', function () {
  var RANGE = 'http://localhost:3001/api/kiosk/past-sales/range';

  function routePending() {
    var d = deferred();
    route([['/ledger', ledgerHandler], ['/range', function () { return d.promise; }]]);
    return d;
  }

  test('A: week to month, pending: range dropped, label blank, stepping disabled and inert', async function () {
    var s = await loadWeek();
    routePending();
    s.core.pastSalesSetMode('month');
    expect(s.core._getPastSalesState().range).toBeNull();
    expect(el('kiosk-ps-range-label').textContent).toBe('');
    expect(el('kiosk-ps-prev').disabled).toBe(true);
    expect(el('kiosk-ps-next').disabled).toBe(true);
    global.fetch.mockClear();
    s.core.pastSalesShiftDay(-1);
    await flushPromises();
    expect(urls().some(function (u) { return u.indexOf('date=2026-10-11') !== -1; })).toBe(false);
    expect(urls().length).toBe(0);
  });

  test('B: refresh during a pending switch requests the new type current period', async function () {
    var s = await loadWeek();
    routePending();
    s.core.pastSalesSetMode('month');
    global.fetch.mockClear();
    s.core.pastSalesRefresh();
    await flushPromises();
    expect(urls()).toEqual([RANGE + '?type=month&bust=1']);
  });

  test('C: loading copy names the month from the day ledger today, not the old payload', async function () {
    var s = await loadWeek(weekBody({
      period_start: '2026-09-28', period_end: '2026-10-04', range_start: '2026-09-28',
      range_end: '2026-10-04', prev_anchor: '2026-09-27', next_anchor: '2026-10-05', current: false
    }));
    routePending();
    s.core.pastSalesSetMode('month');
    var msg = el('kiosk-ps-ledger-message').textContent;
    expect(msg).toContain('October');
    expect(msg).not.toContain('September');
  });

  test('D: failed switch leaves no payload and stepping stays inert', async function () {
    var s = await loadWeek();
    route([['/ledger', ledgerHandler], ['/range', function () { return respond(502, {}); }]]);
    s.core.pastSalesSetMode('month');
    await flushPromises();
    expect(s.core._getPastSalesState().range).toBeNull();
    expect(el('kiosk-ps-range-label').textContent).toBe('');
    expect(el('kiosk-ps-prev').disabled).toBe(true);
    expect(el('kiosk-ps-next').disabled).toBe(true);
    expect(el('kiosk-ps-ledger-message').textContent).toContain('Could not load sales');
    global.fetch.mockClear();
    s.core.pastSalesShiftDay(-1);
    await flushPromises();
    expect(urls().length).toBe(0);
  });

  test('E: month to week, then success: stepping uses the new payload anchors', async function () {
    var s = loadSurface();
    route([['/ledger', ledgerHandler], ['/range', function () { return respond(200, monthBody()); }]]);
    openLedger(s);
    await flushPromises();
    s.core.pastSalesSetMode('month');
    await flushPromises();
    var d = routePending();
    s.core.pastSalesSetMode('week');
    expect(el('kiosk-ps-prev').disabled).toBe(true);
    global.fetch.mockClear();
    s.core.pastSalesShiftDay(-1);
    expect(urls().some(function (u) { return u.indexOf('date=2026-09-30') !== -1; })).toBe(false);
    d.resolve(resolved(weekBody()));
    await flushPromises();
    expect(el('kiosk-ps-prev').disabled).toBe(false);
    expect(s.core._getPastSalesState().range.type).toBe('week');
    global.fetch.mockClear();
    s.core.pastSalesShiftDay(-1);
    await flushPromises();
    expect(urls()).toEqual([RANGE + '?type=week&date=2026-10-11']);
  });
});
