'use strict';

// Phase 92-06: kiosk Past Sales view lifecycle, Ledger tab and shared detail
// expand. Drives the real js/kiosk-core.js through the real js/kiosk.js env
// (device-token auth) with the REAL kiosk.html markup, and fetch mocked against
// the 92-03 / 92-04 API contract.

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
var XSS = '<img src=x onerror=alert(1)>';

function flushPromises() {
  return new Promise(function (resolve) { setTimeout(resolve, 0); });
}

function el(id) {
  var node = document.getElementById(id);
  if (!node) throw new Error('expected #' + id);
  return node;
}

// Real markup lifted from kiosk.html so the tests track the real ids.
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

function ledgerBody(overrides) {
  var base = {
    date: '2026-10-16',
    today: '2026-10-16',
    prev_date: '2026-10-15',
    next_date: null,
    invoices: [
      { invoice_id: 'inv-2', invoice_number: 'INV-000002', date: '2026-10-16', time: '2:15 PM', customer_name: 'Bob', source: 'in-store', status: 'paid', tender: 'Card + Gift card', total: 1200.55, balance: 0 },
      { invoice_id: 'inv-1', invoice_number: 'INV-000001', date: '2026-10-16', time: '1:00 PM', customer_name: 'Ann', source: 'in-store', status: 'void', tender: 'Cash', total: 40, balance: 0 }
    ],
    count: 14,
    gross_total: 1240.55,
    truncated: false,
    tender_incomplete: false,
    classification_incomplete: false,
    unclassified_count: 0
  };
  var out = {};
  Object.keys(base).forEach(function (k) { out[k] = base[k]; });
  Object.keys(overrides || {}).forEach(function (k) { out[k] = overrides[k]; });
  return out;
}

function detailBody(id, nameOverride) {
  return {
    invoice: {
      invoice_id: id, invoice_number: 'INV-' + id, date: '2026-10-16', time: '2:15 PM',
      customer_name: 'Bob', status: 'paid', sub_total: 10, tax_total: 0.5, total: 10.5, balance: 0,
      line_items: [{ name: nameOverride || 'Pale Ale kit', quantity: 2, rate: 5, amount: 10 }]
    }
  };
}

function respond(status, body) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status: status, json: function () { return Promise.resolve(body); } });
}

// Routes fetch by URL substring -> handler(url) returning a response promise.
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

beforeEach(function () {
  localStorage.clear();
  global.fetch.mockReset();
});

describe('Past Sales view + Ledger tab', function () {
  test('showPastSales opens on the By customer tab and makes no ledger fetch', function () {
    var s = loadSurface();
    s.core.showView('browse');
    s.core.showPastSales();
    expect(el('kiosk-view-past-sales').style.display).toBe('');
    expect(el('kiosk-view-browse').style.display).toBe('none');
    expect(s.core._getPastSalesState().tab).toBe('customer');
    expect(el('kiosk-ps-customer-panel').style.display).toBe('');
    expect(el('kiosk-ps-ledger-panel').style.display).toBe('none');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('ledger tab fetches with device token, renders rows in server order, date/max/next', async function () {
    var s = loadSurface();
    route([['/api/kiosk/past-sales/ledger', function () { return respond(200, ledgerBody()); }]]);
    s.core.showView('browse');
    s.core.showPastSales();
    s.core.pastSalesSetTab('ledger');
    await flushPromises();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    var call = global.fetch.mock.calls[0];
    expect(call[0]).toBe('http://localhost:3001/api/kiosk/past-sales/ledger');
    expect(call[1].headers['x-device-token']).toBe('ps-token');
    expect(call[1].credentials).toBeUndefined();

    var rows = document.querySelectorAll('#kiosk-ps-ledger-list .kiosk-ps-row');
    expect(rows.length).toBe(2);
    expect(rows[0].getAttribute('data-invoice-id')).toBe('inv-2');
    expect(rows[0].textContent).toContain('2:15 PM');
    expect(rows[0].textContent).toContain('INV-000002');
    expect(rows[0].textContent).toContain('Bob');
    expect(rows[0].textContent).toContain('Card + Gift card');
    expect(rows[0].textContent).toContain('$1,200.55');
    expect(el('kiosk-ps-date').value).toBe('2026-10-16');
    expect(el('kiosk-ps-date').getAttribute('max')).toBe('2026-10-16');
    expect(el('kiosk-ps-next').disabled).toBe(true);
  });

  test('footer shows server count and gross total with thousands separator', async function () {
    var s = loadSurface();
    route([['/ledger', function () { return respond(200, ledgerBody()); }]]);
    s.core.showView('browse');
    s.core.showPastSales();
    s.core.pastSalesSetTab('ledger');
    await flushPromises();
    expect(el('kiosk-ps-ledger-footer').textContent).toBe('14 sales · $1,240.55');
  });

  test('footer is singular for one sale', async function () {
    var s = loadSurface();
    route([['/ledger', function () { return respond(200, ledgerBody({ count: 1, gross_total: 5 })); }]]);
    s.core.showView('browse');
    s.core.showPastSales();
    s.core.pastSalesSetTab('ledger');
    await flushPromises();
    expect(el('kiosk-ps-ledger-footer').textContent).toBe('1 sale · $5.00');
  });

  test('void rows are greyed with a Void badge', async function () {
    var s = loadSurface();
    route([['/ledger', function () { return respond(200, ledgerBody()); }]]);
    s.core.showView('browse');
    s.core.showPastSales();
    s.core.pastSalesSetTab('ledger');
    await flushPromises();
    var rows = document.querySelectorAll('#kiosk-ps-ledger-list .kiosk-ps-row');
    expect(rows[0].classList.contains('kiosk-ps-row--void')).toBe(false);
    expect(rows[1].classList.contains('kiosk-ps-row--void')).toBe(true);
    expect(rows[1].querySelector('.kiosk-ps-badge--void').textContent).toBe('Void');
  });

  test('empty day, 502 with retry, and 400 messages', async function () {
    var s = loadSurface();
    route([['/ledger', function () { return respond(200, ledgerBody({ invoices: [], count: 0, gross_total: 0 })); }]]);
    s.core.showView('browse');
    s.core.showPastSales();
    s.core.pastSalesSetTab('ledger');
    await flushPromises();
    expect(el('kiosk-ps-ledger-message').textContent).toContain('No in-store sales on this day.');

    s = loadSurface();
    route([['/ledger', function () { return respond(502, { error: 'x' }); }]]);
    s.core.showView('browse');
    s.core.showPastSales();
    s.core.pastSalesSetTab('ledger');
    await flushPromises();
    expect(el('kiosk-ps-ledger-message').textContent).toContain('Could not load sales. Check connection and try again.');
    var retry = document.querySelector('#kiosk-ps-ledger-message .kiosk-ps-retry');
    expect(retry).not.toBeNull();
    route([['/ledger', function () { return respond(200, ledgerBody()); }]]);
    retry.click();
    await flushPromises();
    expect(document.querySelectorAll('#kiosk-ps-ledger-list .kiosk-ps-row').length).toBe(2);

    s = loadSurface();
    route([['/ledger', function () { return respond(400, { error: 'bad_request' }); }]]);
    s.core.showView('browse');
    s.core.showPastSales();
    s.core.pastSalesSetTab('ledger');
    await flushPromises();
    expect(el('kiosk-ps-ledger-message').textContent).toBe('Pick a date up to today.');
  });

  test('truncated, tender_incomplete and classification_incomplete notices', async function () {
    var s = loadSurface();
    route([['/ledger', function () {
      return respond(200, ledgerBody({ truncated: true, tender_incomplete: true, classification_incomplete: true, unclassified_count: 5 }));
    }]]);
    s.core.showView('browse');
    s.core.showPastSales();
    s.core.pastSalesSetTab('ledger');
    await flushPromises();
    var msg = el('kiosk-ps-ledger-message').textContent;
    expect(msg).toContain('Not all sales are shown');
    expect(msg).toContain('Some tenders could not be loaded');
    expect(el('kiosk-ps-ledger-footer').textContent).toContain('5 sales could not be checked; totals may be incomplete.');

    s = loadSurface();
    route([['/ledger', function () { return respond(200, ledgerBody({ classification_incomplete: true, unclassified_count: 1 })); }]]);
    s.core.showView('browse');
    s.core.showPastSales();
    s.core.pastSalesSetTab('ledger');
    await flushPromises();
    expect(el('kiosk-ps-ledger-footer').textContent).toContain('1 sale could not be checked; totals may be incomplete.');

    s = loadSurface();
    route([['/ledger', function () { return respond(200, ledgerBody()); }]]);
    s.core.showView('browse');
    s.core.showPastSales();
    s.core.pastSalesSetTab('ledger');
    await flushPromises();
    expect(el('kiosk-ps-ledger-footer').textContent).not.toContain('could not be checked');
  });

  test('day arrows use server prev/next; next on today makes no fetch', async function () {
    var s = loadSurface();
    route([['/ledger', function () { return respond(200, ledgerBody()); }]]);
    s.core.showView('browse');
    s.core.showPastSales();
    s.core.pastSalesSetTab('ledger');
    await flushPromises();
    global.fetch.mockClear();
    s.core.pastSalesShiftDay(1);
    expect(global.fetch).not.toHaveBeenCalled();
    s.core.pastSalesShiftDay(-1);
    await flushPromises();
    expect(urls()).toEqual(['http://localhost:3001/api/kiosk/past-sales/ledger?date=2026-10-15']);
  });
});

describe('Past Sales detail expand + refresh', function () {
  async function openLedger(s) {
    route([
      ['/ledger', function () { return respond(200, ledgerBody()); }],
      ['/invoice/', function (u) { return respond(200, detailBody(decodeURIComponent(u.split('/invoice/')[1].split('?')[0]))); }]
    ]);
    s.core.showView('browse');
    s.core.showPastSales();
    s.core.pastSalesSetTab('ledger');
    await flushPromises();
  }

  test('row tap fetches detail once, caches, per-row ids', async function () {
    var s = loadSurface();
    await openLedger(s);
    var rows = document.querySelectorAll('#kiosk-ps-ledger-list .kiosk-ps-row');
    global.fetch.mockClear();

    rows[0].click();
    await flushPromises();
    expect(urls()).toEqual(['http://localhost:3001/api/kiosk/past-sales/invoice/inv-2']);
    var detail = rows[0].querySelector('.kiosk-ps-detail');
    expect(detail.textContent).toContain('Pale Ale kit');
    expect(detail.textContent).toContain('2');
    expect(detail.textContent).toContain('$5.00');
    expect(detail.textContent).toContain('$10.00');
    expect(detail.textContent).toContain('Subtotal $10.00');
    expect(detail.textContent).toContain('Tax $0.50');
    expect(detail.textContent).toContain('Total $10.50');

    rows[0].click(); // collapse
    rows[0].click(); // re-expand
    await flushPromises();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    rows[1].click();
    await flushPromises();
    expect(urls()[1]).toBe('http://localhost:3001/api/kiosk/past-sales/invoice/inv-1');
  });

  test('refresh re-requests the same date with bust=1 and drops the detail cache', async function () {
    var s = loadSurface();
    await openLedger(s);
    var rows = document.querySelectorAll('#kiosk-ps-ledger-list .kiosk-ps-row');
    rows[0].click();
    await flushPromises();
    expect(s.core._getPastSalesState().detailCount).toBe(1);
    global.fetch.mockClear();

    s.core.pastSalesRefresh();
    await flushPromises();
    expect(urls()[0]).toBe('http://localhost:3001/api/kiosk/past-sales/ledger?date=2026-10-16&bust=1');
    expect(s.core._getPastSalesState().detailCount).toBe(0);

    var rows2 = document.querySelectorAll('#kiosk-ps-ledger-list .kiosk-ps-row');
    rows2[0].click();
    await flushPromises();
    expect(urls()[1]).toBe('http://localhost:3001/api/kiosk/past-sales/invoice/inv-2');
  });

  test('customer name and item name render as text, not HTML', async function () {
    var s = loadSurface();
    route([
      ['/ledger', function () {
        var b = ledgerBody();
        b.invoices[0].customer_name = XSS;
        return respond(200, b);
      }],
      ['/invoice/', function () { return respond(200, detailBody('inv-2', XSS)); }]
    ]);
    s.core.showView('browse');
    s.core.showPastSales();
    s.core.pastSalesSetTab('ledger');
    await flushPromises();
    document.querySelector('#kiosk-ps-ledger-list .kiosk-ps-row').click();
    await flushPromises();
    expect(document.querySelector('#kiosk-view-past-sales img')).toBeNull();
    expect(el('kiosk-ps-ledger-list').textContent).toContain(XSS);
  });
});

describe('Past Sales D-11 clearing', function () {
  async function populated(s) {
    route([
      ['/ledger', function () { return respond(200, ledgerBody()); }],
      ['/invoice/', function () { return respond(200, detailBody('inv-2')); }]
    ]);
    s.core.showView('browse');
    s.core.showPastSales();
    s.core.pastSalesSetTab('ledger');
    await flushPromises();
    document.querySelector('#kiosk-ps-ledger-list .kiosk-ps-row').click();
    await flushPromises();
    expect(document.querySelectorAll('.kiosk-ps-detail').length).toBe(1);
  }

  ['browse-customer', 'browse', 'receipt', 'collect'].forEach(function (target) {
    test('switching to ' + target + ' empties Past Sales DOM and state', async function () {
      var s = loadSurface();
      await populated(s);
      s.core.showView(target);
      expect(el('kiosk-ps-ledger-list').innerHTML).toBe('');
      expect(el('kiosk-ps-ledger-footer').innerHTML).toBe('');
      expect(document.querySelectorAll('.kiosk-ps-detail').length).toBe(0);
      expect(el('kiosk-ps-date').value).toBe('');
      var st = s.core._getPastSalesState();
      expect(st.ledger).toBeNull();
      expect(st.detailCount).toBe(0);
    });
  });

  test('a ledger response arriving after clearPastSales is discarded', async function () {
    var s = loadSurface();
    var resolveFetch;
    global.fetch.mockImplementation(function () {
      return new Promise(function (resolve) { resolveFetch = resolve; });
    });
    s.core.showView('browse');
    s.core.showPastSales();
    s.core.pastSalesSetTab('ledger');
    s.core.clearPastSales();
    resolveFetch({ ok: true, status: 200, json: function () { return Promise.resolve(ledgerBody()); } });
    await flushPromises();
    expect(el('kiosk-ps-ledger-list').innerHTML).toBe('');
    expect(s.core._getPastSalesState().ledger).toBeNull();
  });

  test('button hidden in Customer View, shown in browse; open refused from browse-customer', function () {
    var s = loadSurface();
    s.core.showView('browse-customer');
    expect(el('kiosk-past-sales-btn').style.display).toBe('none');
    s.core.showPastSales();
    expect(el('kiosk-view-past-sales').style.display).toBe('none');
    s.core.showView('browse');
    expect(el('kiosk-past-sales-btn').style.display).toBe('');
  });

  test('clearing and view switching with no Past Sales markup throws nothing', function () {
    var s = loadSurface();
    document.body.innerHTML = '';
    expect(function () { s.core.clearPastSales(); }).not.toThrow();
    expect(function () { s.core.showView('browse'); }).not.toThrow();
  });
});

describe('Past Sales kiosk.js wiring', function () {
  test('button opens view, Ledger chip fetches, Back returns and empties, lock clears', async function () {
    var s = loadSurface();
    route([['/ledger', function () { return respond(200, ledgerBody()); }]]);
    s.mod._initKioskSaleTab();
    s.core.showView('browse');

    el('kiosk-past-sales-btn').click();
    expect(el('kiosk-view-past-sales').style.display).toBe('');

    document.querySelector('.kiosk-ps-tab[data-tab="ledger"]').click();
    await flushPromises();
    expect(urls().filter(function (u) { return u.indexOf('past-sales') !== -1; }))
      .toEqual(['http://localhost:3001/api/kiosk/past-sales/ledger']);
    expect(document.querySelectorAll('#kiosk-ps-ledger-list .kiosk-ps-row').length).toBe(2);

    el('kiosk-ps-back').click();
    expect(el('kiosk-view-browse').style.display).toBe('');
    expect(el('kiosk-ps-ledger-list').innerHTML).toBe('');

    // lock path
    el('kiosk-past-sales-btn').click();
    document.querySelector('.kiosk-ps-tab[data-tab="ledger"]').click();
    await flushPromises();
    expect(s.core._getPastSalesState().ledger).not.toBeNull();
    s.mod._showLockScreen({});
    expect(s.core._getPastSalesState().ledger).toBeNull();
    expect(el('kiosk-ps-ledger-list').innerHTML).toBe('');
  });
});

describe('WR-01: superseded responses are dropped', function () {
  function deferredRoute(match) {
    var pending = [];
    global.fetch.mockImplementation(function (url) {
      if (url.indexOf(match) === -1) return respond(404, {});
      return new Promise(function (resolve) { pending.push({ url: url, resolve: resolve }); });
    });
    return pending;
  }
  function ok(body) {
    return { ok: true, status: 200, json: function () { return Promise.resolve(body); } };
  }

  test('an older ledger response landing last does not overwrite the newer day', async function () {
    var s = loadSurface();
    var pending = deferredRoute('/ledger');
    s.core.showView('browse');
    s.core.showPastSales();
    s.core.pastSalesLoadLedger('2026-10-10', false);
    s.core.pastSalesLoadLedger('2026-10-12', false);
    expect(pending.length).toBe(2);
    pending[1].resolve(ok(ledgerBody({ date: '2026-10-12', prev_date: '2026-10-11', next_date: '2026-10-13' })));
    await flushPromises();
    pending[0].resolve(ok(ledgerBody({ date: '2026-10-10', prev_date: '2026-10-09', next_date: '2026-10-11' })));
    await flushPromises();
    expect(el('kiosk-ps-date').value).toBe('2026-10-12');
    expect(s.core._getPastSalesState().ledger.date).toBe('2026-10-12');
  });

  test('an older ledger error landing last does not replace the newer day', async function () {
    var s = loadSurface();
    var pending = deferredRoute('/ledger');
    s.core.showView('browse');
    s.core.showPastSales();
    s.core.pastSalesLoadLedger('2026-10-10', false);
    s.core.pastSalesLoadLedger('2026-10-12', false);
    pending[1].resolve(ok(ledgerBody({ date: '2026-10-12' })));
    await flushPromises();
    pending[0].resolve({ ok: false, status: 502, json: function () { return Promise.resolve({}); } });
    await flushPromises();
    expect(el('kiosk-ps-ledger-message').textContent).not.toContain('Could not load sales');
    expect(document.querySelectorAll('#kiosk-ps-ledger-list .kiosk-ps-row').length).toBe(2);
  });

  test('an older contact-search response landing last does not overwrite newer results', async function () {
    var s = loadSurface();
    var pending = deferredRoute('/api/contacts/search');
    s.core.showView('browse');
    s.core.showPastSales();
    jest.useFakeTimers();
    s.core.pastSalesSearch('an');
    jest.advanceTimersByTime(301);
    s.core.pastSalesSearch('ann');
    jest.advanceTimersByTime(301);
    jest.useRealTimers();
    expect(pending.length).toBe(2);
    pending[1].resolve(ok({ contacts: [{ contact_id: '2', contact_name: 'Ann Newer' }] }));
    await flushPromises();
    pending[0].resolve(ok({ contacts: [{ contact_id: '1', contact_name: 'Andy Older' }] }));
    await flushPromises();
    expect(el('kiosk-ps-contact-results').textContent).toBe('Ann Newer');
  });

  test('clearing the search box drops an in-flight search response', async function () {
    var s = loadSurface();
    var pending = deferredRoute('/api/contacts/search');
    s.core.showView('browse');
    s.core.showPastSales();
    jest.useFakeTimers();
    s.core.pastSalesSearch('ann');
    jest.advanceTimersByTime(301);
    jest.useRealTimers();
    s.core.pastSalesSearch('');
    pending[0].resolve(ok({ contacts: [{ contact_id: '1', contact_name: 'Ann' }] }));
    await flushPromises();
    expect(el('kiosk-ps-contact-results').innerHTML).toBe('');
  });
});
