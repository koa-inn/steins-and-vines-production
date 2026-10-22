'use strict';

// Kiosk New Sale reads the cached catalog (2026-10-22).
//
// The New Sale button used kioskLoadProducts(true), which sends ?bust=1: the
// server deleted its catalog cache and rebuilt it from Zoho, so every sale
// started with a 7-10 s "Loading products..." wait (production logs, 2026-10).
// The middleware now rebuilds the kiosk catalog every 10 minutes during shop
// hours, so New Sale re-fetches the cached catalog WITHOUT busting it, the same
// way checkout entry already does (Phase 67 WR-02). The manual Refresh button
// still busts.
//
// Harness mirrors kiosk-html-escaping.test.js / kiosk-catalog-freshness.test.js.

global.window = global.window || {};
global.navigator = global.navigator || { userAgent: 'test' };
global.console = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() };
global.fetch = jest.fn();
global.alert = jest.fn();

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
var CATALOG = { items: [{ item_id: 'P1', name: 'Good Kit', rate: 25, tax_percentage: 5 }] };

function loadSurface(path) {
  jest.resetModules();
  if (global.window) delete global.window.KioskCore;
  document.body.innerHTML = '';
  require(path); // eslint-disable-line global-require -- intentional dynamic per-surface isolation
  return global.window.KioskCore;
}

function injectEl(id, tag) {
  var el = document.createElement(tag || 'div');
  el.id = id;
  document.body.appendChild(el);
  return el;
}

function flushPromises() {
  return new Promise(function (resolve) { setTimeout(resolve, 0); });
}

function productCalls(since) {
  return global.fetch.mock.calls.slice(since || 0).filter(function (c) {
    return typeof c[0] === 'string' && c[0].indexOf('/api/kiosk/products') !== -1;
  });
}

beforeEach(function () {
  localStorage.clear();
  global.fetch.mockReset();
  global.fetch.mockImplementation(function () {
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(CATALOG); } });
  });
});

describe('kiosk New Sale catalog refresh', function () {
  test('New Sale after a receipt re-fetches the catalog WITHOUT ?bust=1', async function () {
    localStorage.setItem(DEVICE_TOKEN_KEY, 'kiosk-token');
    var core = loadSurface('../../js/kiosk.js');
    injectEl('kiosk-product-grid');
    injectEl('kiosk-receipt-body');
    var newSaleBtn = injectEl('kiosk-new-sale-btn', 'button');

    core.loadProducts();
    await flushPromises();
    expect(core._getProducts()).toHaveLength(1);

    core.showReceipt(
      { total: 25, invoice_number: 'INV-000999' },
      { tax: 1.25, total: 26.25, discount: 0 },
      [{ name: 'Good Kit', quantity: 1, rate: 25 }],
      []
    );

    var before = global.fetch.mock.calls.length;
    newSaleBtn.click();
    await flushPromises();

    var calls = productCalls(before);
    expect(calls).toHaveLength(1);                         // still refreshes the grid…
    expect(calls[0][0].indexOf('bust=1')).toBe(-1);        // …from the server cache
    expect(core._getProducts()).toHaveLength(1);
  });

  test('the manual Refresh button still forces a rebuild (?bust=1)', async function () {
    localStorage.setItem(DEVICE_TOKEN_KEY, 'kiosk-token');
    var core = loadSurface('../../js/kiosk.js');
    injectEl('kiosk-product-grid');

    core.loadProducts();
    await flushPromises();

    var before = global.fetch.mock.calls.length;
    core.loadProducts(true);
    await flushPromises();

    var calls = productCalls(before);
    expect(calls).toHaveLength(1);
    expect(calls[0][0].indexOf('bust=1')).not.toBe(-1);
  });
});
