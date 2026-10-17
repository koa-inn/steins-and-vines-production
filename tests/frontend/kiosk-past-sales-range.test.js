'use strict';

// Phase 93-03: Ledger Week/Month range mode. Drives the real js/kiosk-core.js
// through js/kiosk.js with the REAL kiosk.html markup; fetch is mocked against
// the 93-02 /api/kiosk/past-sales/range contract.

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

function dayLedger() {
  return {
    date: '2026-10-16', today: '2026-10-16', prev_date: '2026-10-15', next_date: null,
    invoices: [], count: 0, gross_total: 0, truncated: false, classification_incomplete: false
  };
}

function activeMode() {
  var a = document.querySelector('.kiosk-ps-mode.active');
  return a ? a.getAttribute('data-mode') : null;
}

function resolved(body) {
  return { ok: true, status: 200, json: function () { return Promise.resolve(body); } };
}

beforeEach(function () {
  localStorage.clear();
  global.fetch.mockReset();
});

describe('Ledger mode chips', function () {
  test('Ledger opens on Day and requests the day ledger, no range call', async function () {
    var s = loadSurface();
    route([['/ledger', function () { return respond(200, dayLedger()); }]]);
    openLedger(s);
    await flushPromises();
    expect(activeMode()).toBe('day');
    expect(urls().length).toBe(1);
    expect(urls()[0]).toContain('/api/kiosk/past-sales/ledger');
    expect(urls()[0]).not.toContain('/range');
  });

  test('Week requests the current period with no date param and activates the chip', async function () {
    var s = loadSurface();
    route([['/ledger', function () { return respond(200, dayLedger()); }],
      ['/range', function () { return respond(200, weekBody()); }]]);
    openLedger(s);
    await flushPromises();
    s.core.pastSalesSetMode('week');
    await flushPromises();
    expect(urls()[1]).toBe('http://localhost:3001/api/kiosk/past-sales/range?type=week');
    expect(activeMode()).toBe('week');
  });

  test('pending range shows the loading message and skeleton, empty footer', async function () {
    var s = loadSurface();
    var d = deferred();
    route([['/ledger', function () { return respond(200, dayLedger()); }],
      ['/range', function () { return d.promise; }]]);
    openLedger(s);
    await flushPromises();
    s.core.pastSalesSetMode('month');
    expect(el('kiosk-ps-ledger-message').textContent).toContain('this can take a few seconds');
    expect(el('kiosk-ps-ledger-list').querySelector('.kiosk-so-skeleton')).not.toBeNull();
    expect(el('kiosk-ps-ledger-footer').textContent).toBe('');
  });
});

describe('Range rendering', function () {
  async function loadWeek(body) {
    var s = loadSurface();
    route([['/ledger', function () { return respond(200, dayLedger()); }],
      ['/range', function () { return respond(200, body || weekBody()); }]]);
    openLedger(s);
    await flushPromises();
    s.core.pastSalesSetMode('week');
    await flushPromises();
    return s;
  }

  test('week label, stepping buttons, rows and footer', async function () {
    await loadWeek();
    expect(el('kiosk-ps-range-label').textContent).toBe('Oct 12 – 18');
    expect(el('kiosk-ps-next').disabled).toBe(true);
    expect(el('kiosk-ps-prev').disabled).toBe(false);
    var rows = document.querySelectorAll('#kiosk-ps-ledger-list .kiosk-ps-dayrow');
    expect(rows.length).toBe(5);
    expect(rows[0].textContent).toContain('Today');
    expect(rows[1].textContent).toContain('Thu Oct 15');
    expect(rows[0].textContent).toContain('3 sales');
    expect(rows[0].textContent).toContain('$100.00');
    expect(rows[1].textContent).toContain('1 sale');
    expect(el('kiosk-ps-ledger-footer').textContent).toBe('7 sales · $123.45');
    expect(el('kiosk-ps-date').value).toBe('2026-10-16');
    expect(el('kiosk-ps-date').getAttribute('max')).toBe('2026-10-16');
  });

  test('zero-sale day is greyed with 0 sales line', async function () {
    await loadWeek();
    var row = document.querySelectorAll('#kiosk-ps-ledger-list .kiosk-ps-dayrow')[2];
    expect(row.classList.contains('kiosk-ps-dayrow--zero')).toBe(true);
    expect(row.textContent).toContain('0 sales');
    expect(row.textContent).toContain('$0.00');
  });

  test('month label', async function () {
    var s = loadSurface();
    route([['/ledger', function () { return respond(200, dayLedger()); }],
      ['/range', function () { return respond(200, monthBody()); }]]);
    openLedger(s);
    await flushPromises();
    s.core.pastSalesSetMode('month');
    await flushPromises();
    expect(el('kiosk-ps-range-label').textContent).toBe('October 2026');
  });

  test('cross-month week label', async function () {
    await loadWeek(weekBody({ period_start: '2026-10-26', period_end: '2026-11-01' }));
    expect(el('kiosk-ps-range-label').textContent).toBe('Oct 26 – Nov 1');
  });

  test('cross-year week label', async function () {
    await loadWeek(weekBody({ period_start: '2026-12-28', period_end: '2027-01-03' }));
    expect(el('kiosk-ps-range-label').textContent).toBe('Dec 28, 2026 – Jan 3, 2027');
  });

  test('all-zero payload still renders the footer', async function () {
    await loadWeek(weekBody({ days: [{ date: '2026-10-16', count: 0, gross_total: 0, partial: false }], count: 0, gross_total: 0 }));
    expect(el('kiosk-ps-ledger-footer').textContent).toBe('0 sales · $0.00');
  });

  test('truncated shows at-least prefix, notice and partial badge', async function () {
    await loadWeek(weekBody({
      truncated: true,
      days: [{ date: '2026-10-16', count: 3, gross_total: 100, partial: true }]
    }));
    expect(el('kiosk-ps-ledger-footer').textContent.indexOf('at least ')).toBe(0);
    expect(el('kiosk-ps-ledger-message').textContent).toContain('Not all sales are shown for this period.');
    var row = document.querySelector('#kiosk-ps-ledger-list .kiosk-ps-dayrow');
    expect(row.textContent).toContain('partial');
  });

  test('classification_incomplete adds a totals note', async function () {
    await loadWeek(weekBody({ classification_incomplete: true }));
    expect(el('kiosk-ps-ledger-message').textContent).toContain('totals may be incomplete');
  });

  test('XSS: server date strings are escaped', async function () {
    await loadWeek(weekBody({
      days: [{ date: '<img src=x onerror=alert(1)>', count: 1, gross_total: 1, partial: false }]
    }));
    expect(document.querySelector('#kiosk-ps-ledger-list img')).toBeNull();
    expect(document.querySelector('#kiosk-ps-ledger-footer img')).toBeNull();
  });
});

describe('Stepping and date jump', function () {
  test('prev uses prev_anchor; next with null anchor does nothing', async function () {
    var s = loadSurface();
    route([['/ledger', function () { return respond(200, dayLedger()); }],
      ['/range', function () { return respond(200, weekBody()); }]]);
    openLedger(s);
    await flushPromises();
    s.core.pastSalesSetMode('week');
    await flushPromises();
    var n = urls().length;
    s.core.pastSalesShiftDay(1);
    expect(urls().length).toBe(n);
    s.core.pastSalesShiftDay(-1);
    await flushPromises();
    expect(urls()[n]).toBe('http://localhost:3001/api/kiosk/past-sales/range?type=week&date=2026-10-11');
  });

  test('date pick jumps to the containing period in month mode, day ledger in day mode', async function () {
    var s = loadSurface();
    route([['/ledger', function () { return respond(200, dayLedger()); }],
      ['/range', function () { return respond(200, monthBody()); }]]);
    openLedger(s);
    await flushPromises();
    s.core.pastSalesPickDate('2026-09-09');
    await flushPromises();
    expect(urls()[urls().length - 1]).toContain('/ledger?date=2026-09-09');
    s.core.pastSalesSetMode('month');
    await flushPromises();
    s.core.pastSalesPickDate('2026-09-10');
    await flushPromises();
    expect(urls()[urls().length - 1]).toBe('http://localhost:3001/api/kiosk/past-sales/range?type=month&date=2026-09-10');
  });
});

describe('Errors', function () {
  test('400 shows the pick-a-date message', async function () {
    var s = loadSurface();
    route([['/ledger', function () { return respond(200, dayLedger()); }],
      ['/range', function () { return respond(400, { error: 'bad' }); }]]);
    openLedger(s);
    await flushPromises();
    s.core.pastSalesSetMode('week');
    await flushPromises();
    expect(el('kiosk-ps-ledger-message').textContent).toContain('Pick a date up to today.');
  });

  test('502 shows retry and Retry re-requests the same range', async function () {
    var s = loadSurface();
    route([['/ledger', function () { return respond(200, dayLedger()); }],
      ['/range', function () { return respond(502, { error: 'x' }); }]]);
    openLedger(s);
    await flushPromises();
    s.core.pastSalesSetMode('week');
    await flushPromises();
    var retry = document.querySelector('#kiosk-ps-ledger-message .kiosk-ps-retry');
    expect(retry).not.toBeNull();
    var n = urls().length;
    retry.click();
    await flushPromises();
    expect(urls()[n]).toBe('http://localhost:3001/api/kiosk/past-sales/range?type=week');
  });
});

describe('Late responses and clearing', function () {
  test('late month response is dropped after switching to day', async function () {
    var s = loadSurface();
    var d = deferred();
    route([['/ledger', function () { return respond(200, dayLedger()); }],
      ['/range', function () { return d.promise; }]]);
    openLedger(s);
    await flushPromises();
    s.core.pastSalesSetMode('month');
    s.core.pastSalesSetMode('day');
    await flushPromises();
    var before = el('kiosk-ps-ledger-list').innerHTML;
    d.resolve(resolved(monthBody()));
    await flushPromises();
    expect(el('kiosk-ps-ledger-list').innerHTML).toBe(before);
    expect(s.core._getPastSalesState().range).toBeNull();
  });

  test('late month response is dropped when a week load supersedes it', async function () {
    var s = loadSurface();
    var d = deferred();
    route([['/ledger', function () { return respond(200, dayLedger()); }],
      ['/range', function (u) {
        return u.indexOf('type=month') !== -1 ? d.promise : respond(200, weekBody());
      }]]);
    openLedger(s);
    await flushPromises();
    s.core.pastSalesSetMode('month');
    s.core.pastSalesSetMode('week');
    await flushPromises();
    d.resolve(resolved(monthBody()));
    await flushPromises();
    expect(s.core._getPastSalesState().range.type).toBe('week');
    expect(el('kiosk-ps-range-label').textContent).toBe('Oct 12 – 18');
  });

  test('clearPastSales resets mode and drops a range response arriving afterwards', async function () {
    var s = loadSurface();
    var d = deferred();
    route([['/ledger', function () { return respond(200, dayLedger()); }],
      ['/range', function () { return d.promise; }]]);
    openLedger(s);
    await flushPromises();
    s.core.pastSalesSetMode('week');
    s.core.clearPastSales();
    expect(activeMode()).toBe('day');
    expect(s.core._getPastSalesState().mode).toBe('day');
    expect(s.core._getPastSalesState().range).toBeNull();
    expect(el('kiosk-ps-range-label').textContent).toBe('');
    d.resolve(resolved(weekBody()));
    await flushPromises();
    expect(s.core._getPastSalesState().range).toBeNull();
    expect(el('kiosk-ps-ledger-list').innerHTML).toBe('');
    expect(el('kiosk-ps-range-label').textContent).toBe('');
  });

  test('clearPastSales after a rendered week resets state', async function () {
    var s = loadSurface();
    route([['/ledger', function () { return respond(200, dayLedger()); }],
      ['/range', function () { return respond(200, weekBody()); }]]);
    openLedger(s);
    await flushPromises();
    s.core.pastSalesSetMode('week');
    await flushPromises();
    s.core.clearPastSales();
    expect(s.core._getPastSalesState().range).toBeNull();
    expect(el('kiosk-ps-range-label').textContent).toBe('');
    expect(el('kiosk-ps-prev').disabled).toBe(false);
  });
});
