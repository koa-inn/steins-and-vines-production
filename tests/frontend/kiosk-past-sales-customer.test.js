'use strict';

// Phase 92-07: kiosk Past Sales By-customer tab (contact search, history,
// load older, walk-in, D-11 clearing). Drives the real js/kiosk-core.js through
// the real js/kiosk.js env with the REAL kiosk.html markup, fetch mocked against
// the 92-04 API contract.

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
  return { mod: mod, core: global.window.KioskCore };
}

function detailBody(id) {
  return {
    invoice: {
      invoice_id: id, invoice_number: 'INV-' + id, date: '2026-10-16', time: '2:15 PM',
      customer_name: 'Bob', status: 'paid', sub_total: 10, tax_total: 0.5, total: 10.5, balance: 0,
      line_items: [{ name: 'Pale Ale kit', quantity: 2, rate: 5, amount: 10 }]
    }
  };
}

function respond(status, body) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status: status, json: function () { return Promise.resolve(body); } });
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

function histBody(o) {
  var b = {
    walk_in: false, customer_id: '77', window_start: '2025-10-16', window_end: '2026-10-16',
    has_older: true, truncated: false,
    invoices: [
      { invoice_id: 'h2', invoice_number: 'INV-000102', date: '2026-09-01', customer_name: 'Ann', source: 'online', status: 'paid', total: 50, balance: 0 },
      { invoice_id: 'h1', invoice_number: 'INV-000101', date: '2026-08-01', customer_name: 'Ann', source: 'in-store', status: 'partially_paid', total: 20, balance: 5 },
      { invoice_id: 'h0', invoice_number: 'INV-000100', date: '2026-07-01', customer_name: 'Ann', source: 'other', status: 'void', total: 9, balance: 0 }
    ]
  };
  Object.keys(o || {}).forEach(function (k) { b[k] = o[k]; });
  return b;
}

function contactsBody(name) {
  return { contacts: [{ contact_id: '77', contact_name: name || 'Ann Smith', email: 'ann@secret.example', phone: '555-0199' }] };
}

function openView(s) {
  s.core.showView('browse');
  s.core.showPastSales();
}

beforeEach(function () {
  localStorage.clear();
  global.fetch.mockReset();
  jest.useRealTimers();
});

describe('By customer tab', function () {
  test('search: 1 char no fetch; debounced 300ms; one fetch; name only', async function () {
    var s = loadSurface();
    route([['/api/contacts/search', function () { return respond(200, contactsBody()); }]]);
    openView(s);
    jest.useFakeTimers();
    s.core.pastSalesSearch('a');
    jest.advanceTimersByTime(500);
    expect(global.fetch).not.toHaveBeenCalled();
    s.core.pastSalesSearch('sm');
    jest.advanceTimersByTime(200);
    s.core.pastSalesSearch('smi');
    jest.advanceTimersByTime(299);
    expect(global.fetch).not.toHaveBeenCalled();
    jest.advanceTimersByTime(2);
    jest.useRealTimers();
    await flushPromises();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toBe('http://localhost:3001/api/contacts/search?q=smi');
    expect(global.fetch.mock.calls[0][1].headers['x-device-token']).toBe('ps-token');
    var rows = document.querySelectorAll('#kiosk-ps-contact-results .kiosk-ps-contact-row');
    expect(rows.length).toBe(1);
    expect(rows[0].getAttribute('data-id')).toBe('77');
    expect(rows[0].textContent).toBe('Ann Smith');
    expect(el('kiosk-ps-contact-results').innerHTML).not.toContain('secret.example');
    expect(el('kiosk-ps-contact-results').innerHTML).not.toContain('555-0199');
  });

  test('selecting a contact fetches history and renders rows with badges, no tender', async function () {
    var s = loadSurface();
    route([['/past-sales/customer', function () { return respond(200, histBody()); }]]);
    openView(s);
    s.core.pastSalesSelectContact('77', 'Ann Smith');
    await flushPromises();
    expect(global.fetch.mock.calls[0][0]).toBe('http://localhost:3001/api/kiosk/past-sales/customer?customer_id=77');
    expect(el('kiosk-ps-customer-heading').textContent).toBe('Ann Smith');
    var rows = document.querySelectorAll('#kiosk-ps-customer-list .kiosk-ps-row');
    expect(rows.length).toBe(3);
    expect(rows[0].getAttribute('data-invoice-id')).toBe('h2');
    expect(rows[0].textContent).toContain('2026-09-01');
    expect(rows[0].textContent).toContain('INV-000102');
    expect(rows[0].textContent).toContain('$50.00');
    expect(rows[0].querySelector('.kiosk-ps-badge--paid').textContent).toBe('Paid');
    expect(rows[0].querySelector('.kiosk-ps-badge--online').textContent).toBe('Online');
    expect(rows[1].querySelector('.kiosk-ps-badge--partial').textContent).toBe('Partial');
    expect(rows[1].querySelector('.kiosk-ps-badge--in-store').textContent).toBe('In-store');
    expect(rows[2].querySelector('.kiosk-ps-badge--void').textContent).toBe('Void');
    expect(rows[2].querySelector('.kiosk-ps-badge--other').textContent).toBe('Other');
    expect(document.querySelectorAll('#kiosk-ps-customer-list .kiosk-ps-tender').length).toBe(0);
    expect(el('kiosk-ps-load-older').style.display).toBe('');
  });

  test('load older appends using window_start and hides when has_older false', async function () {
    var s = loadSurface();
    route([['/past-sales/customer', function (url) {
      if (url.indexOf('before=') === -1) return respond(200, histBody());
      return respond(200, histBody({
        has_older: false,
        window_start: '2024-10-16',
        invoices: [{ invoice_id: 'o1', invoice_number: 'INV-000050', date: '2025-05-01', source: 'in-store', status: 'paid', total: 3 }]
      }));
    }]]);
    openView(s);
    s.core.pastSalesSelectContact('77', 'Ann');
    await flushPromises();
    s.core.pastSalesLoadOlder();
    await flushPromises();
    expect(urls()[1]).toBe('http://localhost:3001/api/kiosk/past-sales/customer?customer_id=77&before=2025-10-16');
    expect(document.querySelectorAll('#kiosk-ps-customer-list .kiosk-ps-row').length).toBe(4);
    expect(el('kiosk-ps-load-older').style.display).toBe('none');
    expect(s.core._getPastSalesState().historyCount).toBe(4);
  });

  test('empty history shows message and keeps Load older when has_older', async function () {
    var s = loadSurface();
    route([['/past-sales/customer', function () { return respond(200, histBody({ invoices: [] })); }]]);
    openView(s);
    s.core.pastSalesSelectContact('77', 'Ann');
    await flushPromises();
    expect(el('kiosk-ps-customer-message').textContent).toBe('No sales in this period.');
    expect(el('kiosk-ps-load-older').style.display).toBe('');
  });

  test('walk-in shows exact message, empty list, no Load older', async function () {
    var s = loadSurface();
    route([['/past-sales/customer', function () { return respond(200, { walk_in: true, invoices: [] }); }]]);
    openView(s);
    s.core.pastSalesSelectContact('1', 'Walk-in');
    await flushPromises();
    expect(el('kiosk-ps-customer-message').textContent).toBe("Walk-in sales aren't tied to a customer, use the Ledger by date.");
    expect(el('kiosk-ps-customer-list').children.length).toBe(0);
    expect(el('kiosk-ps-load-older').style.display).toBe('none');
  });

  test('502 shows error message with retry', async function () {
    var s = loadSurface();
    route([['/past-sales/customer', function () { return respond(502, {}); }]]);
    openView(s);
    s.core.pastSalesSelectContact('77', 'Ann');
    await flushPromises();
    expect(el('kiosk-ps-customer-message').textContent).toContain("Could not load this customer's sales. Check connection and try again.");
    route([['/past-sales/customer', function () { return respond(200, histBody()); }]]);
    el('kiosk-ps-customer-retry').click();
    await flushPromises();
    expect(document.querySelectorAll('#kiosk-ps-customer-list .kiosk-ps-row').length).toBe(3);
  });

  test('tapping a history row expands detail once via shared fetch', async function () {
    var s = loadSurface();
    route([
      ['/past-sales/customer', function () { return respond(200, histBody()); }],
      ['/past-sales/invoice/', function () { return respond(200, detailBody('h2')); }]
    ]);
    openView(s);
    s.core.pastSalesSelectContact('77', 'Ann');
    await flushPromises();
    var row = document.querySelector('#kiosk-ps-customer-list .kiosk-ps-row');
    row.click();
    await flushPromises();
    expect(row.querySelector('.kiosk-ps-detail').textContent).toContain('Pale Ale kit');
    row.click();
    row.click();
    await flushPromises();
    expect(urls().filter(function (u) { return u.indexOf('/past-sales/invoice/h2') !== -1; }).length).toBe(1);
  });

  test('refresh reloads selected customer with bust=1 and no before', async function () {
    var s = loadSurface();
    route([['/past-sales/customer', function () { return respond(200, histBody()); }]]);
    openView(s);
    s.core.pastSalesSelectContact('77', 'Ann');
    await flushPromises();
    s.core.pastSalesRefresh();
    await flushPromises();
    expect(urls()[1]).toBe('http://localhost:3001/api/kiosk/past-sales/customer?customer_id=77&bust=1');
  });

  test('refresh with no contact selected does nothing', function () {
    var s = loadSurface();
    openView(s);
    s.core.pastSalesRefresh();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('D-11: view switch clears search, results, heading, list, load older, contact', async function () {
    var s = loadSurface();
    route([['/past-sales/customer', function () { return respond(200, histBody()); }]]);
    openView(s);
    el('kiosk-ps-search').value = 'ann';
    s.core.pastSalesSelectContact('77', 'Ann');
    await flushPromises();
    el('kiosk-ps-contact-results').innerHTML = '<div>x</div>';
    s.core.showView('browse-customer');
    expect(el('kiosk-ps-search').value).toBe('');
    expect(el('kiosk-ps-contact-results').innerHTML).toBe('');
    expect(el('kiosk-ps-customer-heading').innerHTML).toBe('');
    expect(el('kiosk-ps-customer-list').innerHTML).toBe('');
    expect(el('kiosk-ps-load-older').style.display).toBe('none');
    var st = s.core._getPastSalesState();
    expect(st.contact).toBeNull();
    expect(st.historyCount).toBe(0);
  });

  test('stale contact-search and history responses after clear render nothing', async function () {
    var s = loadSurface();
    var resolveSearch;
    var resolveHist;
    route([
      ['/api/contacts/search', function () { return new Promise(function (r) { resolveSearch = r; }); }],
      ['/past-sales/customer', function () { return new Promise(function (r) { resolveHist = r; }); }]
    ]);
    openView(s);
    jest.useFakeTimers();
    s.core.pastSalesSearch('ann');
    jest.advanceTimersByTime(301);
    jest.useRealTimers();
    s.core.pastSalesSelectContact('77', 'Ann');
    s.core.clearPastSales();
    resolveSearch({ ok: true, status: 200, json: function () { return Promise.resolve(contactsBody()); } });
    resolveHist({ ok: true, status: 200, json: function () { return Promise.resolve(histBody()); } });
    await flushPromises();
    expect(el('kiosk-ps-contact-results').innerHTML).toBe('');
    expect(el('kiosk-ps-customer-list').innerHTML).toBe('');
    expect(el('kiosk-ps-customer-heading').innerHTML).toBe('');
    expect(el('kiosk-ps-load-older').style.display).toBe('none');
  });

  test('pending debounce timer is cancelled by clear', function () {
    var s = loadSurface();
    openView(s);
    jest.useFakeTimers();
    s.core.pastSalesSearch('ann');
    s.core.clearPastSales();
    jest.advanceTimersByTime(1000);
    jest.useRealTimers();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('XSS payloads in contact name and invoice number render as text', async function () {
    var s = loadSurface();
    route([
      ['/api/contacts/search', function () { return respond(200, contactsBody(XSS)); }],
      ['/past-sales/customer', function () {
        return respond(200, histBody({ invoices: [{ invoice_id: 'x"1', invoice_number: XSS, date: '2026-01-01', source: 'other', status: 'paid', total: 1 }] }));
      }]
    ]);
    openView(s);
    jest.useFakeTimers();
    s.core.pastSalesSearch('xx');
    jest.advanceTimersByTime(301);
    jest.useRealTimers();
    await flushPromises();
    expect(document.querySelector('#kiosk-ps-contact-results img')).toBeNull();
    expect(el('kiosk-ps-contact-results').textContent).toBe(XSS);
    document.querySelector('.kiosk-ps-contact-row').click();
    await flushPromises();
    expect(el('kiosk-ps-customer-heading').textContent).toBe(XSS);
    expect(document.querySelector('#kiosk-view-past-sales img')).toBeNull();
    expect(document.querySelector('#kiosk-ps-customer-list .kiosk-ps-number').textContent).toBe(XSS);
  });
});

describe('By customer wiring (kiosk.js)', function () {
  test('typing in search and clicking Load older drive the core', async function () {
    var s = loadSurface();
    route([
      ['/api/contacts/search', function () { return respond(200, contactsBody()); }],
      ['/past-sales/customer', function () { return respond(200, histBody()); }]
    ]);
    s.mod._initKioskSaleTab();
    openView(s);
    jest.useFakeTimers();
    el('kiosk-ps-search').value = 'ann';
    el('kiosk-ps-search').dispatchEvent(new Event('input'));
    jest.advanceTimersByTime(301);
    jest.useRealTimers();
    await flushPromises();
    expect(urls().some(function (u) { return u.indexOf('/api/contacts/search?q=ann') !== -1; })).toBe(true);
    document.querySelector('.kiosk-ps-contact-row').click();
    await flushPromises();
    el('kiosk-ps-load-older').click();
    await flushPromises();
    expect(urls().some(function (u) { return u.indexOf('customer_id=77&before=2025-10-16') !== -1; })).toBe(true);
  });
});

describe('WR-02: Load older in-flight guard and per-contact error isolation', function () {
  function ok(body) {
    return { ok: true, status: 200, json: function () { return Promise.resolve(body); } };
  }
  function fail() {
    return { ok: false, status: 502, json: function () { return Promise.resolve({}); } };
  }
  function deferred() {
    var pending = [];
    global.fetch.mockImplementation(function (url) {
      return new Promise(function (resolve) { pending.push({ url: url, resolve: resolve }); });
    });
    return pending;
  }

  test('double-tapped Load older sends one request and does not duplicate rows', async function () {
    var s = loadSurface();
    route([['/past-sales/customer', function () { return respond(200, histBody()); }]]);
    openView(s);
    s.core.pastSalesSelectContact('77', 'Ann');
    await flushPromises();
    var pending = deferred();
    s.core.pastSalesLoadOlder();
    expect(el('kiosk-ps-load-older').disabled).toBe(true);
    s.core.pastSalesLoadOlder();
    expect(pending.length).toBe(1);
    pending[0].resolve(ok(histBody({
      has_older: false, window_start: '2024-10-16',
      invoices: [{ invoice_id: 'o1', invoice_number: 'INV-000050', date: '2025-05-01', source: 'in-store', status: 'paid', total: 3 }]
    })));
    await flushPromises();
    expect(document.querySelectorAll('#kiosk-ps-customer-list .kiosk-ps-row').length).toBe(4);
    expect(s.core._getPastSalesState().historyCount).toBe(4);
    expect(el('kiosk-ps-load-older').disabled).toBe(false);
  });

  test("an old contact's late error does not overwrite the new contact's message", async function () {
    var s = loadSurface();
    var pending = deferred();
    openView(s);
    s.core.pastSalesSelectContact('77', 'Ann');
    s.core.pastSalesSelectContact('88', 'Bob');
    expect(pending.length).toBe(2);
    pending[1].resolve(ok(histBody({ customer_id: '88' })));
    await flushPromises();
    pending[0].resolve(fail());
    await flushPromises();
    expect(el('kiosk-ps-customer-message').textContent).not.toContain('Could not load');
    expect(document.getElementById('kiosk-ps-customer-retry')).toBeNull();
    expect(document.querySelectorAll('#kiosk-ps-customer-list .kiosk-ps-row').length).toBe(3);
  });

  test("a stale Retry from the old contact does nothing after switching contacts", async function () {
    var s = loadSurface();
    route([['/past-sales/customer', function () { return respond(502, {}); }]]);
    openView(s);
    s.core.pastSalesSelectContact('77', 'Ann');
    await flushPromises();
    var staleRetry = el('kiosk-ps-customer-retry');
    route([['/past-sales/customer', function () { return respond(200, histBody({ customer_id: '88' })); }]]);
    s.core.pastSalesSelectContact('88', 'Bob');
    await flushPromises();
    global.fetch.mockClear();
    staleRetry.click();
    await flushPromises();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(el('kiosk-ps-customer-heading').textContent).toBe('Bob');
  });
});

describe('WR-03: draft rows in customer history', function () {
  test('a Draft invoice shows a Draft badge, not Unpaid', async function () {
    var s = loadSurface();
    route([['/past-sales/customer', function () {
      return respond(200, histBody({ invoices: [{ invoice_id: 'd1', invoice_number: 'INV-000200', date: '2026-10-01', source: 'in-store', status: 'Draft', total: 7 }] }));
    }]]);
    openView(s);
    s.core.pastSalesSelectContact('77', 'Ann');
    await flushPromises();
    var row = document.querySelector('#kiosk-ps-customer-list .kiosk-ps-row');
    expect(row.querySelector('.kiosk-ps-badge--draft').textContent).toBe('Draft');
    expect(row.textContent).not.toContain('Unpaid');
  });
});

describe('WR-04: incompleteness signals and next_before paging', function () {
  test('Load older uses next_before and de-dupes rows already shown', async function () {
    var s = loadSurface();
    route([['/past-sales/customer', function (url) {
      if (url.indexOf('before=') === -1) {
        return respond(200, histBody({ truncated: true, next_before: '2026-07-02' }));
      }
      return respond(200, histBody({
        has_older: false, window_start: '2025-07-02', next_before: '2025-07-02',
        invoices: [
          { invoice_id: 'h0', invoice_number: 'INV-000100', date: '2026-07-01', source: 'other', status: 'void', total: 9 },
          { invoice_id: 'o1', invoice_number: 'INV-000050', date: '2026-06-01', source: 'in-store', status: 'paid', total: 3 }
        ]
      }));
    }]]);
    openView(s);
    s.core.pastSalesSelectContact('77', 'Ann');
    await flushPromises();
    expect(el('kiosk-ps-customer-message').textContent).toBe('More sales in this period. Tap Load older to see them.');
    s.core.pastSalesLoadOlder();
    await flushPromises();
    expect(urls()[1]).toBe('http://localhost:3001/api/kiosk/past-sales/customer?customer_id=77&before=2026-07-02');
    var ids = Array.prototype.map.call(document.querySelectorAll('#kiosk-ps-customer-list .kiosk-ps-row'),
      function (r) { return r.getAttribute('data-invoice-id'); });
    expect(ids).toEqual(['h2', 'h1', 'h0', 'o1']);
    expect(s.core._getPastSalesState().historyCount).toBe(4);
  });

  test('source_incomplete shows a tag warning', async function () {
    var s = loadSurface();
    route([['/past-sales/customer', function () { return respond(200, histBody({ source_incomplete: true })); }]]);
    openView(s);
    s.core.pastSalesSelectContact('77', 'Ann');
    await flushPromises();
    expect(el('kiosk-ps-customer-message').textContent).toBe('Some In-store / Online tags may be wrong.');
  });

  test('older responses without next_before still page from window_start', async function () {
    var s = loadSurface();
    route([['/past-sales/customer', function () { return respond(200, histBody()); }]]);
    openView(s);
    s.core.pastSalesSelectContact('77', 'Ann');
    await flushPromises();
    s.core.pastSalesLoadOlder();
    await flushPromises();
    expect(urls()[1]).toBe('http://localhost:3001/api/kiosk/past-sales/customer?customer_id=77&before=2025-10-16');
  });
});
