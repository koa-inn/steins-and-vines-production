'use strict';

// Phase 67 review fix (WR-04) — recipe sales previously bypassed the
// quote-vs-charge divergence contract entirely: recipeSaleBody carried no
// client_grand_total / client_tax_total, so /api/kiosk/recipe-sale had no
// way to detect that the payment screen's displayed total diverged from the
// server's recomputed charge (the dynamically-priced recipe path is
// arguably the highest-divergence surface).
//
// Contract this test pins: POST /api/kiosk/recipe-sale carries
// client_grand_total === totals.total and client_tax_total === totals.tax
// (same field names as the standard sale body, pinned by the 67-01
// interface contract). The SERVER side of this contract is log-only for
// recipes (see pos-recipe.test.js WR-04a..c for why it must not block).
//
// Harness mirrors kiosk-missing-tax.test.js.

global.window = global.window || {};
global.navigator = global.navigator || { userAgent: 'test' };

global.console = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() };

global.fetch = jest.fn(function () {
  return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({}); } });
});

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

function loadSurface(path) {
  jest.resetModules();
  if (global.window) delete global.window.KioskCore;
  document.body.innerHTML = '';
  var mod = require(path); // intentional dynamic per-surface isolation
  return { mod: mod, core: global.window.KioskCore };
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

beforeEach(function () {
  localStorage.clear();
  global.fetch.mockReset();
  global.fetch.mockImplementation(function () {
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({}); } });
  });
});

describe('WR-04 — recipe sale body carries the kiosk displayed totals', function () {

  test('POST /api/kiosk/recipe-sale carries client_grand_total and client_tax_total matching the displayed totals', async function () {
    localStorage.setItem(DEVICE_TOKEN_KEY, 'kiosk-token');
    var core = loadSurface('../../js/kiosk.js').core;
    injectEl('kiosk-product-grid');
    injectEl('kiosk-payment-items');
    injectEl('kiosk-payment-amount');
    injectEl('kiosk-terminal-msg');
    injectEl('kiosk-spinner');

    // A dynamic-mode recipe cart: one ingredient line + a taxed brewing fee
    // (the shapes kioskAddRecipeToCart builds).
    core._setCart({
      'recipe-ing-0-ing1': {
        item: { item_id: 'ing1', name: 'Pale Malt 2-Row (5 kg)', rate: 17.50, tax_percentage: 0, product_type: 'recipe_ingredient' },
        qty: 1
      },
      'recipe-fee-brewing': {
        item: { item_id: 'fee-brewing', name: 'Brewing Fee', rate: 45, tax_percentage: 5, product_type: 'fee' },
        qty: 1
      }
    });
    core._setRecipeContext({ recipe_id: 'RCP-001', sale_type: 'in-store', mill_grain: false, target_volume_l: 20 });

    var totals = core.calcTotals();
    // sanity: 17.50 + 45.00 subtotal; tax = 45 * 5% = 2.25 → 64.75
    expect(totals.total).toBe(64.75);
    expect(totals.tax).toBe(2.25);

    core.proceedToPayment();
    await flushPromises();

    var saleCall = global.fetch.mock.calls.find(function (c) {
      return typeof c[0] === 'string' && c[0].indexOf('/api/kiosk/recipe-sale') !== -1;
    });
    expect(saleCall).toBeTruthy();
    var body = JSON.parse(saleCall[1].body);
    // Same field names as the standard sale body (67-01 interface contract).
    expect(body.client_grand_total).toBe(totals.total);
    expect(body.client_tax_total).toBe(totals.tax);
    // Existing recipe body fields must be untouched by the addition.
    expect(body.recipe_id).toBe('RCP-001');
    expect(body.sale_type).toBe('in-store');
  });
});
