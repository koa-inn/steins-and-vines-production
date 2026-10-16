'use strict';

// Regression (prod, 2026-10-16): the kiosk recipe tile showed a locked recipe's base price
// ($45.00) labelled "incl. brewing fee", but the server charges locked_price + service_fee +
// materials_fee for in-store sales ($45 + $45 + $5 = $95, recipe-scaling.js
// computeScaledRecipeTotal). Take-out adds no fees.

global.window = global.window || {};
global.window.addEventListener = global.window.addEventListener || jest.fn();
global.navigator = global.navigator || { userAgent: 'test' };
global.console = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() };
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

function flush() { return new Promise(function (r) { setTimeout(r, 0); }); }

var LOCKED = { recipe_id: 'SV-R-000016', name: 'Bavarian Style Lager', style: 'Lager', pricing_mode: 'locked', locked_price: 45, service_fee: 45, materials_fee: 5 };

function load(recipes) {
  jest.resetModules();
  if (global.window) delete global.window.KioskCore;
  document.body.innerHTML = '<div id="kiosk-product-grid"></div><div id="kiosk-recipe-grid"></div>' +
    '<div id="kiosk-recipe-prompt" style="display:none"></div><span id="kiosk-recipe-selected-name"></span>';
  global.fetch = jest.fn(function (url) {
    var body = /\/api\/recipes/.test(String(url)) ? { recipes: recipes } : { items: [], products: [] };
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(body); } });
  });
  require('../../js/kiosk.js');
  return global.window.KioskCore;
}

describe('kiosk locked recipe price includes the in-store fees', function () {
  test('headline price is locked_price + service_fee + materials_fee', function () {
    var core = load([LOCKED]);
    expect(core.recipePrice(LOCKED)).toBe(95);
  });

  test('in-store context adds the fees; take-out does not', function () {
    var core = load([LOCKED]);
    expect(core.recipePriceForContext(LOCKED, 'in-store')).toBe(95);
    expect(core.recipePriceForContext(LOCKED, 'take-out')).toBe(45);
  });

  test('the Recipes tile shows $95.00 for the locked recipe', async function () {
    var core = load([LOCKED]);
    core.setMode('recipes');
    await flush(); await flush();
    var tile = document.querySelector('#kiosk-recipe-grid .kiosk-recipe-card .kiosk-product-price');
    expect(tile.textContent).toContain('95.00');
  });
});
