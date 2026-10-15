'use strict';

// Regression: recipes loaded in the background while the kiosk is in Products
// mode (kioskRetryStalledLoads on visibilitychange) must still render when the
// operator later switches to Recipes. Before the fix, kioskSetMode('recipes')
// only loaded when nothing was loaded, so the grid stayed on "Loading recipes..."
// forever (found during the Phase 90 D-17 staging session, 2026-10-15).

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

var RECIPES = [
  { recipe_id: 'R1', name: 'West Coast IPA', style: 'American', pricing_mode: 'fixed', locked_price: 10 },
  { recipe_id: 'R2', name: 'Amber', style: 'Red', pricing_mode: 'fixed', locked_price: 10 }
];

describe('kiosk recipes mode after a background recipe load', function () {
  test('switching to Recipes renders recipes that were loaded while in Products mode', async function () {
    jest.resetModules();
    if (global.window) delete global.window.KioskCore;
    document.body.innerHTML = '<div id="kiosk-product-grid"></div>' +
      '<div id="kiosk-recipe-grid"><p class="kiosk-loading">Loading recipes...</p></div>' +
      '<div id="kiosk-recipe-prompt" style="display:none"></div><span id="kiosk-recipe-selected-name"></span>';
    global.fetch = jest.fn(function (url) {
      var body = /\/api\/recipes/.test(String(url)) ? { recipes: RECIPES } : { items: [], products: [] };
      return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(body); } });
    });
    require('../../js/kiosk.js');
    var core = global.window.KioskCore;

    core.setMode('products');
    // iPad wakes / tab regains focus while in Products mode -> background retry loads recipes.
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: function () { return 'visible'; } });
    document.dispatchEvent(new window.Event('visibilitychange'));
    await flush();
    await flush();
    var recipeFetches = global.fetch.mock.calls.filter(function (c) { return /\/api\/recipes\?status=active/.test(String(c[0])); });
    expect(recipeFetches.length).toBeGreaterThan(0);

    core.setMode('recipes');
    await flush();
    var grid = document.getElementById('kiosk-recipe-grid');
    expect(grid.querySelectorAll('.kiosk-recipe-card')).toHaveLength(2);
    expect(grid.textContent).not.toContain('Loading recipes...');
  });
});
