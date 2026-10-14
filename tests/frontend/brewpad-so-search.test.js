'use strict';

// Phase 90-03 Task 1: characterization of the detail-view "Link to Invoice" search
// (fetchSoSearch) plus the new parameterised use (resultsId / onSelect / renderExtra).

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
  { invoice_id: 'i1', invoice_number: 'INV-000171', customer_name: 'Lush <b>Ltd</b>', customer_id: 'c1', date: '2026-09-01',
    line_items: [{ name: 'Pale Ale' }] },
  { invoice_id: 'i2', invoice_number: 'INV-000172', customer_name: 'Lush Two', customer_id: 'c2', date: '2026-09-02', line_items: [] }
];

function jsonResponse(body) {
  return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(body); } });
}
function flush() {
  return new Promise(function (r) { setTimeout(r, 0); });
}

beforeEach(function () {
  document.body.innerHTML = '<div id="bp-so-search-results"></div><div id="x-results"></div>';
  global.fetch = jest.fn();
});

describe('fetchSoSearch default (detail view) behaviour', function () {
  test('renders result rows with data-* attributes and escaped text', function () {
    global.fetch.mockImplementation(function () { return jsonResponse({ invoices: INVOICES }); });
    bp._fetchSoSearchForTest('lush');
    return flush().then(function () {
      expect(global.fetch.mock.calls[0][0]).toMatch(/\/api\/batch\/search-invoices\?search=lush$/);
      var rows = document.querySelectorAll('#bp-so-search-results .bp-so-result-item[data-so-id]');
      expect(rows.length).toBe(2);
      expect(rows[0].getAttribute('data-so-id')).toBe('i1');
      expect(rows[0].getAttribute('data-so-number')).toBe('INV-000171');
      expect(rows[0].getAttribute('data-customer-name')).toBe('Lush <b>Ltd</b>');
      expect(rows[0].getAttribute('data-customer-id')).toBe('c1');
      expect(rows[0].getAttribute('data-so-date')).toBe('2026-09-01');
      expect(rows[0].getAttribute('data-product-name')).toBe('Pale Ale');
      expect(rows[0].querySelector('b')).toBeNull();
    });
  });

  test('empty result shows the no-match message', function () {
    global.fetch.mockImplementation(function () { return jsonResponse({ invoices: [] }); });
    bp._fetchSoSearchForTest('zzz');
    return flush().then(function () {
      expect(document.getElementById('bp-so-search-results').textContent).toBe('No matching invoices found');
    });
  });

  test('fetch rejection shows the unavailable message', function () {
    global.fetch.mockImplementation(function () { return Promise.reject(new Error('net')); });
    bp._fetchSoSearchForTest('zzz');
    return flush().then(function () {
      expect(document.getElementById('bp-so-search-results').textContent).toBe('Search unavailable — check connection');
    });
  });

  test('row click with no open batch does not write (handleSoSelect guard)', function () {
    global.fetch.mockImplementation(function () { return jsonResponse({ invoices: INVOICES }); });
    bp._fetchSoSearchForTest('lush');
    return flush().then(function () {
      var before = global.fetch.mock.calls.length;
      document.querySelector('#bp-so-search-results .bp-so-result-item[data-so-id]').click();
      expect(global.fetch.mock.calls.length).toBe(before);
    });
  });

  test('row click with an open batch posts update_batch with the invoice fields', function () {
    bp._setDetailBatchIdForTest('SV-B-000001');
    global.fetch.mockImplementation(function (url) {
      if (/search-invoices/.test(url)) return jsonResponse({ invoices: INVOICES });
      return jsonResponse({ ok: true });
    });
    bp._fetchSoSearchForTest('lush');
    return flush().then(function () {
      document.querySelector('#bp-so-search-results .bp-so-result-item[data-so-id]').click();
      var post = global.fetch.mock.calls.filter(function (c) { return /admin-proxy/.test(c[0]); })[0];
      expect(post).toBeDefined();
      var body = JSON.parse(post[1].body);
      expect(body.action).toBe('update_batch');
      expect(body.batch_id).toBe('SV-B-000001');
      expect(body.updates).toEqual({
        zoho_so_number: 'INV-000171',
        customer_id: 'c1',
        customer_name: 'Lush <b>Ltd</b>',
        product_name: 'Pale Ale'
      });
    });
  });
});

describe('fetchSoSearch parameterised use', function () {
  test('renders into opts.resultsId and calls onSelect without any write', function () {
    global.fetch.mockImplementation(function () { return jsonResponse({ invoices: INVOICES }); });
    var spy = jest.fn();
    bp._fetchSoSearchForTest('lush', { resultsId: 'x-results', onSelect: spy });
    return flush().then(function () {
      expect(document.querySelectorAll('#x-results .bp-so-result-item[data-so-id]').length).toBe(2);
      expect(document.getElementById('bp-so-search-results').innerHTML).toBe('');
      var before = global.fetch.mock.calls.length;
      document.querySelector('#x-results .bp-so-result-item[data-so-id]').click();
      expect(spy).toHaveBeenCalledWith({
        invoice_id: 'i1', invoice_number: 'INV-000171', customer_name: 'Lush <b>Ltd</b>', customer_id: 'c1', date: '2026-09-01'
      });
      expect(global.fetch.mock.calls.length).toBe(before);
    });
  });

  test('renderExtra output is appended inside each row', function () {
    global.fetch.mockImplementation(function () { return jsonResponse({ invoices: INVOICES }); });
    bp._fetchSoSearchForTest('lush', {
      resultsId: 'x-results',
      onSelect: function () {},
      renderExtra: function (inv) { return inv.invoice_number === 'INV-000171' ? '<span class="extra">warn</span>' : ''; }
    });
    return flush().then(function () {
      var rows = document.querySelectorAll('#x-results .bp-so-result-item[data-so-id]');
      expect(rows[0].querySelector('.extra').textContent).toBe('warn');
      expect(rows[1].querySelector('.extra')).toBeNull();
    });
  });
});
