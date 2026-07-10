'use strict';

// Regression tests for kiosk product/recipe load resilience (js/kiosk-core.js).
//
// LIVE PROD BUG (2026-07): the kiosk product grid blanked after the first sale.
// After a sale, kioskLoadProducts(true) issues GET /api/kiosk/products?bust=1
// under the device token, which the Phase 52-05 bust-gate rejected -> 403.
// The load handler read r.json() WITHOUT checking r.ok, so the 403 error body
// (no `items` field) drove `_kioskProducts = data.items || []` -> [] AND
// `_kioskProductsLoaded = true`, wiping the grid until a full page reload.
//
// Contract these tests pin: a failed (non-ok) response must NOT wipe the
// last-good products/recipes and must NOT flip the loaded flag — the kiosk
// keeps showing what it already has and degrades gracefully.
//
// Harness mirrors kiosk-gift-card-mgmt.test.js: drive the shared kiosk-core.js
// through the REAL js/kiosk.js env injection (loadSurface) with real timers +
// flushPromises() to drain the fetch(...).then().then() microtask chain.

global.window = global.window || {};
global.window.addEventListener = global.window.addEventListener || jest.fn();

global.navigator = global.navigator || { userAgent: 'test' };

global.console = {
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn()
};

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

// Load the kiosk surface in full isolation (fresh require cache + fresh
// KioskCore singleton) so js/kiosk.js's own KioskCore.init(env) is the only
// active one — per kiosk-gift-card-mgmt.test.js / kiosk-core-parity.test.js.
function loadSurface(path) {
  jest.resetModules();
  if (global.window) delete global.window.KioskCore;
  document.body.innerHTML = '';
  var mod = require(path); // eslint-disable-line global-require -- intentional dynamic per-surface isolation
  return { mod: mod, core: global.window.KioskCore };
}

function injectEl(id, tag) {
  var el = document.createElement(tag || 'div');
  el.id = id;
  document.body.appendChild(el);
  return el;
}

// Resolves like the real fetch: `ok` derived from status unless given explicitly.
function mockFetchOnce(status, body, ok) {
  global.fetch.mockImplementationOnce(function () {
    return Promise.resolve({
      ok: typeof ok === 'boolean' ? ok : (status >= 200 && status < 300),
      status: status,
      json: function () { return Promise.resolve(body); }
    });
  });
}

function flushPromises() {
  return new Promise(function (resolve) { setTimeout(resolve, 0); });
}

beforeEach(function () {
  localStorage.clear();
  global.fetch.mockClear();
});

describe('kiosk product load resilience — failed refresh must not wipe the grid', function () {
  test('a 403 on bust refresh keeps the last-good products and the loaded flag', async function () {
    localStorage.setItem(DEVICE_TOKEN_KEY, 'kiosk-token');
    var core = loadSurface('../../js/kiosk.js').core;
    injectEl('kiosk-product-grid');

    // Seed: first load succeeds and populates the grid.
    mockFetchOnce(200, { items: [{ item_id: 'P1', name: 'Test Kit', stock_on_hand: 10 }] });
    core.loadProducts();
    await flushPromises();

    expect(core._getProducts()).toHaveLength(1);
    expect(core._getProductsLoaded()).toBe(true);

    // After a sale: forced bust refresh is rejected (device token, 403).
    mockFetchOnce(403, { error: 'forbidden' });
    core.loadProducts(true);
    await flushPromises();

    // Bug repro: buggy code sets _kioskProducts = [] and leaves loaded = true,
    // blanking the grid. Contract: products preserved, still marked loaded.
    expect(core._getProducts()).toHaveLength(1);
    expect(core._getProducts()[0].item_id).toBe('P1');
    expect(core._getProductsLoaded()).toBe(true);
    expect(core._getProductsLoading()).toBe(false);

    // Grid must not show a failure placeholder when we already had products.
    var grid = document.getElementById('kiosk-product-grid');
    expect(grid.innerHTML).not.toContain('Failed to load');
  });

  test('a first-load failure (nothing to preserve) still surfaces an error placeholder', async function () {
    localStorage.setItem(DEVICE_TOKEN_KEY, 'kiosk-token');
    var core = loadSurface('../../js/kiosk.js').core;
    injectEl('kiosk-product-grid');

    mockFetchOnce(500, { error: 'boom' });
    core.loadProducts();
    await flushPromises();

    expect(core._getProducts()).toHaveLength(0);
    expect(core._getProductsLoaded()).toBe(false);
    var grid = document.getElementById('kiosk-product-grid');
    expect(grid.innerHTML).toContain('Failed to load');
  });
});

describe('kiosk recipe load resilience — failed refresh must not wipe the grid', function () {
  test('a 403 on forced recipe refresh keeps the last-good recipes and the grid', async function () {
    localStorage.setItem(DEVICE_TOKEN_KEY, 'kiosk-token');
    var core = loadSurface('../../js/kiosk.js').core;
    injectEl('kiosk-recipe-grid');

    // Recipes only render in 'recipes' mode; setMode auto-fires the first load,
    // which the mock below satisfies as the seed.
    mockFetchOnce(200, { recipes: [{ recipe_id: 'RCP-1', name: 'IPA', pricing_mode: 'dynamic', computed_price: 50 }] });
    core.setMode('recipes');
    await flushPromises();

    // No public getter for recipes; the rendered card proves they loaded.
    var grid = document.getElementById('kiosk-recipe-grid');
    expect(grid.innerHTML).toContain('IPA');
    var seeded = grid.innerHTML;

    // After a sale: forced refresh rejected (device token, 403).
    mockFetchOnce(403, { error: 'forbidden' });
    core.loadRecipes(true);
    await flushPromises();

    // Grid preserved — not blanked, no error placeholder, cards intact.
    expect(grid.innerHTML).not.toContain('Failed to load');
    expect(grid.innerHTML).toContain('IPA');
    expect(grid.innerHTML).toBe(seeded);
  });
});
