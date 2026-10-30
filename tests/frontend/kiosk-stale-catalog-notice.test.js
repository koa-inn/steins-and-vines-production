'use strict';

// Quick task 261029-zq1 Task 2 (UI): when the middleware cannot rebuild the
// kiosk catalog (e.g. the shared Zoho Inventory daily quota is exhausted) it
// now serves its last good copy with source: 'stale'. The kiosk must stay
// usable (products load and render) and show a small non-blocking notice;
// the notice clears once a fresh catalog arrives.
//
// Harness copied from kiosk-load-resilience.test.js:
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

var NOTICE_TEXT = 'Showing saved catalogue — stock may be a few minutes old';

describe('kiosk stale catalogue notice', function () {
  test('source "stale" loads products and shows the notice', async function () {
    localStorage.setItem(DEVICE_TOKEN_KEY, 'kiosk-token');
    var core = loadSurface('../../js/kiosk.js').core;
    injectEl('kiosk-product-grid');

    mockFetchOnce(200, { source: 'stale', stale_at: '2026-10-29T16:50:00.000Z',
      items: [{ item_id: 'P1', name: 'Test Kit', stock_on_hand: 10 }] });
    core.loadProducts();
    await flushPromises();

    expect(core._getProducts()).toHaveLength(1);
    expect(core._getProductsLoaded()).toBe(true);
    var notice = document.getElementById('kiosk-stale-notice');
    expect(notice).not.toBeNull();
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toBe(NOTICE_TEXT);
    // Non-blocking: lives outside the grid so it never replaces products.
    expect(document.getElementById('kiosk-product-grid').contains(notice)).toBe(false);
  });

  test('a fresh load after a stale one hides the notice', async function () {
    localStorage.setItem(DEVICE_TOKEN_KEY, 'kiosk-token');
    var core = loadSurface('../../js/kiosk.js').core;
    injectEl('kiosk-product-grid');

    mockFetchOnce(200, { source: 'stale', items: [{ item_id: 'P1', name: 'Test Kit' }] });
    core.loadProducts();
    await flushPromises();
    expect(document.getElementById('kiosk-stale-notice').hidden).toBe(false);

    mockFetchOnce(200, { source: 'cache', items: [{ item_id: 'P1', name: 'Test Kit' }] });
    core.loadProducts('cached');
    await flushPromises();
    expect(document.getElementById('kiosk-stale-notice').hidden).toBe(true);
  });

  test('a normal (non-stale) load shows no notice', async function () {
    localStorage.setItem(DEVICE_TOKEN_KEY, 'kiosk-token');
    var core = loadSurface('../../js/kiosk.js').core;
    injectEl('kiosk-product-grid');

    mockFetchOnce(200, { source: 'zoho', items: [{ item_id: 'P1', name: 'Test Kit' }] });
    core.loadProducts();
    await flushPromises();
    var notice = document.getElementById('kiosk-stale-notice');
    expect(notice === null || notice.hidden === true).toBe(true);
  });
});
