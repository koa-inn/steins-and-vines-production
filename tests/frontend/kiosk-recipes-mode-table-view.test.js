'use strict';

// Regression (prod, 2026-10-16): in table (list) view, switching to Recipes left the product
// list on screen above the recipe tiles. css/kiosk.css gives .kiosk-product-grid--list
// display:block !important, which beat kioskSetMode's inline display:none. The hide must be
// inline !important so no stylesheet rule can override it.

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

describe('kiosk Recipes mode in table view', function () {
  test('Recipes hides the product grid with an !important inline display:none; Products restores it', function () {
    jest.resetModules();
    if (global.window) delete global.window.KioskCore;
    document.body.innerHTML = '<div id="kiosk-product-grid" class="kiosk-product-grid kiosk-product-grid--list"></div>' +
      '<div id="kiosk-recipe-grid"></div><div id="kiosk-recipe-prompt" style="display:none"></div><span id="kiosk-recipe-selected-name"></span>';
    global.fetch = jest.fn(function () {
      return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ recipes: [], items: [] }); } });
    });
    require('../../js/kiosk.js');
    var core = global.window.KioskCore;
    var grid = document.getElementById('kiosk-product-grid');

    core.setMode('recipes');
    expect(grid.style.getPropertyValue('display')).toBe('none');
    expect(grid.style.getPropertyPriority('display')).toBe('important');

    core.setMode('products');
    expect(grid.style.getPropertyValue('display')).not.toBe('none');
  });
});
