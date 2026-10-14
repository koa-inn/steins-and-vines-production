'use strict';

// Phase 90-03: create-batch sheet invoice picker (Task 2) and submit path (Task 3).

global.google = { accounts: { oauth2: { initTokenClient: jest.fn() } } };
global.fetch = jest.fn();
global.localStorage = {
  _data: {},
  getItem: function (k) { return this._data[k] || null; },
  setItem: function (k, v) { this._data[k] = v; },
  removeItem: function (k) { delete this._data[k]; },
  clear: function () { this._data = {}; }
};
var _ssData = {};
global.sessionStorage = {
  getItem: function (k) { return _ssData[k] !== undefined ? _ssData[k] : null; },
  setItem: function (k, v) { _ssData[k] = v; },
  removeItem: function (k) { delete _ssData[k]; },
  clear: function () { Object.keys(_ssData).forEach(function (k) { delete _ssData[k]; }); }
};

var _auth = require('../../js/lib/auth');
global.waitForGoogleIdentity = _auth.waitForGoogleIdentity;
global.gsiInitTokenClient = _auth.gsiInitTokenClient;
global.fetchGoogleUserInfo = _auth.fetchGoogleUserInfo;

var bp = require('../../js/brewpad');

var INVOICES = [
  { invoice_id: 'i1', invoice_number: 'INV-000171', customer_name: 'Lush Ltd', customer_id: 'c1', date: '2026-09-01', line_items: [{ name: 'Pale Ale' }] },
  { invoice_id: 'i2', invoice_number: 'INV-000172', customer_name: 'Lush Two', customer_id: 'c2', date: '2026-09-02', line_items: [] }
];

function jsonResponse(body, status) {
  var st = status || 200;
  return Promise.resolve({ ok: st < 400, status: st, json: function () { return Promise.resolve(body); } });
}
function $(id) { return document.getElementById(id); }
function tick(ms) { return new Promise(function (r) { setTimeout(r, ms || 0); }); }

// Records every fetch; search-invoices returns INVOICES, everything else is configurable.
var calls;
var proxyHandler;
function installFetch() {
  calls = [];
  proxyHandler = function () { return jsonResponse({ ok: true, batch_id: 'SV-B-000099' }); };
  global.fetch = jest.fn(function (url, opts) {
    calls.push({ url: url, opts: opts || {} });
    if (/search-invoices/.test(url)) return jsonResponse({ invoices: INVOICES });
    if (/admin-proxy/.test(url)) return proxyHandler(JSON.parse(opts.body));
    return jsonResponse({ ok: true, batches: [] });
  });
}
function proxyCalls(action) {
  return calls.filter(function (c) {
    return /admin-proxy/.test(c.url) && JSON.parse(c.opts.body).action === action;
  });
}

function openSheet() {
  document.body.innerHTML = '<div id="bp-toast-container"></div><div id="sheet"></div>';
  bp._buildCreateFormForTest($('sheet'));
}

beforeEach(function () {
  jest.useRealTimers();
  installFetch();
  bp._setAllBatchesDataForTest([]);
  openSheet();
});

describe('create sheet invoice picker markup', function () {
  test('has the Invoice group, results, hidden fields, chip container and internal checkbox', function () {
    expect($('bp-new-so-search-input').getAttribute('placeholder')).toBe('Search invoices by number or customer');
    expect($('bp-new-so-results').classList.contains('bp-vessel-dropdown')).toBe(true);
    expect($('bp-new-so-number').type).toBe('hidden');
    expect($('bp-new-so-id').type).toBe('hidden');
    expect($('bp-new-so-chip')).not.toBeNull();
    expect($('bp-new-no-invoice').type).toBe('checkbox');
    expect(document.querySelector('label[for="bp-new-no-invoice"]').textContent).toContain('No invoice (internal batch)');
    expect($('bp-new-so-group').querySelector('label').textContent).toBe('Invoice (optional)');
    // sits after the customer group
    var groups = Array.prototype.slice.call(document.querySelectorAll('.bp-form-group'));
    expect(groups.indexOf($('bp-new-so-group'))).toBeGreaterThan(groups.indexOf($('bp-new-customer-text').closest('.bp-form-group')));
  });
});

describe('create sheet invoice search', function () {
  test('prefills from the customer text and searches with the shared search', function () {
    $('bp-new-customer-text').value = 'Lush';
    $('bp-new-customer-text').dispatchEvent(new Event('input'));
    expect($('bp-new-so-search-input').value).toBe('Lush');
    $('bp-new-so-search-input').dispatchEvent(new Event('focus'));
    return tick(0).then(function () {
      var search = calls.filter(function (c) { return /search-invoices\?search=Lush$/.test(c.url); });
      expect(search.length).toBe(1);
      expect(document.querySelectorAll('#bp-new-so-results .bp-so-result-item[data-so-id]').length).toBe(2);
    });
  });

  test('typing 2+ chars debounces into one search; 1 char does not search', function () {
    var el = $('bp-new-so-search-input');
    el.value = 'L';
    el.dispatchEvent(new Event('input'));
    el.value = 'Lu';
    el.dispatchEvent(new Event('input'));
    el.value = 'Lus';
    el.dispatchEvent(new Event('input'));
    return tick(500).then(function () {
      var search = calls.filter(function (c) { return /search-invoices/.test(c.url); });
      expect(search.length).toBe(1);
      expect(search[0].url).toMatch(/search=Lus$/);
    });
  });

  test('shows Already linked to <ids> for invoices that already have batches and stays selectable', function () {
    bp._setAllBatchesDataForTest([
      { batch_id: 'SV-B-000063', zoho_so_number: 'inv-000171' },
      { batch_id: 'SV-B-000070', zoho_so_number: 'INV-000171' },
      { batch_id: 'SV-B-000001', zoho_so_number: 'INV-000999' }
    ]);
    var el = $('bp-new-so-search-input');
    el.value = 'Lush';
    el.dispatchEvent(new Event('input'));
    return tick(500).then(function () {
      var rows = document.querySelectorAll('#bp-new-so-results .bp-so-result-item[data-so-id]');
      expect(rows[0].querySelector('.bp-so-linked-warn').textContent).toBe('Already linked to SV-B-000063, SV-B-000070');
      expect(rows[1].querySelector('.bp-so-linked-warn')).toBeNull();
      rows[0].click();
      expect($('bp-new-so-number').value).toBe('INV-000171');
    });
  });
});

describe('create sheet invoice selection', function () {
  function selectFirst() {
    var el = $('bp-new-so-search-input');
    el.value = 'Lush';
    el.dispatchEvent(new Event('input'));
    return tick(500).then(function () {
      document.querySelector('#bp-new-so-results .bp-so-result-item[data-so-id]').click();
    });
  }

  test('selecting fills hidden fields, shows the chip, hides the input and writes nothing', function () {
    return selectFirst().then(function () {
      expect($('bp-new-so-number').value).toBe('INV-000171');
      expect($('bp-new-so-id').value).toBe('i1');
      expect($('bp-new-so-chip').style.display).not.toBe('none');
      expect($('bp-new-so-chip').textContent).toContain('INV-000171');
      expect($('bp-new-so-search-input').style.display).toBe('none');
      expect(calls.filter(function (c) { return /admin-proxy/.test(c.url); }).length).toBe(0);
    });
  });

  test('the chip x clears both hidden fields and restores the input', function () {
    return selectFirst().then(function () {
      var x = $('bp-new-so-chip').querySelector('button');
      expect(x.getAttribute('aria-label')).toBe('Clear invoice');
      x.click();
      expect($('bp-new-so-number').value).toBe('');
      expect($('bp-new-so-id').value).toBe('');
      expect($('bp-new-so-chip').style.display).toBe('none');
      expect($('bp-new-so-search-input').style.display).not.toBe('none');
    });
  });

  test('selecting an invoice unchecks the internal checkbox', function () {
    var cb = $('bp-new-no-invoice');
    cb.checked = true;
    cb.dispatchEvent(new Event('change'));
    $('bp-new-so-search-input').disabled = false;
    return selectFirst().then(function () {
      expect(cb.checked).toBe(false);
    });
  });

  test('ticking the checkbox clears a chosen invoice and disables the search; unticking re-enables', function () {
    return selectFirst().then(function () {
      var cb = $('bp-new-no-invoice');
      cb.checked = true;
      cb.dispatchEvent(new Event('change'));
      expect($('bp-new-so-number').value).toBe('');
      expect($('bp-new-so-chip').style.display).toBe('none');
      expect($('bp-new-so-search-input').disabled).toBe(true);
      cb.checked = false;
      cb.dispatchEvent(new Event('change'));
      expect($('bp-new-so-search-input').disabled).toBe(false);
    });
  });
});
