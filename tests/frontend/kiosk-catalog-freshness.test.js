'use strict';

// Phase 57-03 Task 1 — regression tests for the CONFIRMED variant-2 cause
// (57-DIAGNOSIS.md): a long-open iPad holds a STALE client catalog containing
// a phantom item (an item_id that no longer exists in Zoho). Staff add it;
// the server's price-anchoring guard correctly hard-rejects the sale (400);
// the only recovery today is a manual "Refresh the product list".
//
// Contract these tests pin:
//   1. A loaded-but-stale catalog (older than KIOSK_CATALOG_MAX_AGE_MS)
//      self-heals on the next wake — kioskLoadProducts(true) fires and a
//      phantom item is dropped from _kioskProducts. No more manual refresh.
//   2. A FAILED staleness-triggered refresh must never wipe a good grid
//      (guards the existing 7cbf856 keep-last-good resilience).
//   3. A cart line whose item_id is no longer in the (loaded) catalog is
//      blocked BEFORE the /api/kiosk/sale POST — the server guard remains
//      the backstop, never relied on as the only check.
//
// Harness mirrors kiosk-load-recovery.test.js / kiosk-load-resilience.test.js.

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
  var mod = require(path); // eslint-disable-line global-require -- intentional dynamic per-surface isolation
  return { mod: mod, core: global.window.KioskCore };
}

function injectEl(id, tag) {
  var el = document.createElement(tag || 'div');
  el.id = id;
  document.body.appendChild(el);
  return el;
}

function mockFetchOnce(status, body, ok) {
  global.fetch.mockImplementationOnce(function () {
    return Promise.resolve({
      ok: typeof ok === 'boolean' ? ok : (status >= 200 && status < 300),
      status: status,
      json: function () { return Promise.resolve(body); }
    });
  });
}

function mockFetchRejectOnce(message) {
  global.fetch.mockImplementationOnce(function () {
    return Promise.reject(new TypeError(message || 'Failed to fetch'));
  });
}

function flushPromises() {
  return new Promise(function (resolve) { setTimeout(resolve, 0); });
}

function setVisibility(state) {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

// 10 minutes + 1ms — must exceed KIOSK_CATALOG_MAX_AGE_MS regardless of the
// exact bound chosen by the implementation (documented as ~10 minutes).
var PAST_STALENESS_BOUND_MS = 10 * 60 * 1000 + 1;

beforeEach(function () {
  localStorage.clear();
  global.fetch.mockReset();
  global.fetch.mockImplementation(function () {
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({}); } });
  });
  setVisibility('visible');
});

afterEach(function () {
  if (Date.now.mockRestore) Date.now.mockRestore();
});

describe('kiosk catalog freshness — the confirmed stale-catalog/phantom-item cause (57-DIAGNOSIS.md)', function () {

  test('Test A: a loaded-but-stale catalog force-refreshes on wake and drops the phantom item', async function () {
    localStorage.setItem(DEVICE_TOKEN_KEY, 'kiosk-token');
    var core = loadSurface('../../js/kiosk.js').core;
    injectEl('kiosk-product-grid');

    var realNow = Date.now();

    // Seed: catalog loads with a phantom item present (mirrors the captured case —
    // item 1099000000000109115 no longer exists in Zoho but is still in the
    // client's stale catalog).
    mockFetchOnce(200, {
      items: [
        { item_id: 'P1', name: 'Good Kit', rate: 25 },
        { item_id: 'PHANTOM-109115', name: 'Ghost Kit', rate: 30 }
      ]
    });
    core.loadProducts();
    await flushPromises();
    expect(core._getProducts()).toHaveLength(2);

    // Time passes well beyond the staleness bound.
    jest.spyOn(Date, 'now').mockImplementation(function () { return realNow + PAST_STALENESS_BOUND_MS; });

    // Staff wake the iPad (tab becomes visible again). The refreshed catalog no
    // longer contains the phantom.
    mockFetchOnce(200, { items: [{ item_id: 'P1', name: 'Good Kit', rate: 25 }] });
    setVisibility('visible');
    await flushPromises();

    // A force-refresh (?bust=1) must have fired.
    var bustCall = global.fetch.mock.calls.find(function (c) {
      return typeof c[0] === 'string' && c[0].indexOf('bust=1') !== -1;
    });
    expect(bustCall).toBeTruthy();

    expect(core._getProducts()).toHaveLength(1);
    expect(core._getProducts().some(function (p) { return p.item_id === 'PHANTOM-109115'; })).toBe(false);
  });

  test('Test B: a FAILED staleness refresh keeps the last-good grid (7cbf856 preserved)', async function () {
    localStorage.setItem(DEVICE_TOKEN_KEY, 'kiosk-token');
    var core = loadSurface('../../js/kiosk.js').core;
    injectEl('kiosk-product-grid');

    var realNow = Date.now();

    mockFetchOnce(200, { items: [{ item_id: 'P1', name: 'Good Kit', rate: 25 }] });
    core.loadProducts();
    await flushPromises();
    expect(core._getProducts()).toHaveLength(1);
    expect(core._getProductsLoaded()).toBe(true);

    jest.spyOn(Date, 'now').mockImplementation(function () { return realNow + PAST_STALENESS_BOUND_MS; });

    // The staleness-triggered force-refresh fails outright (network down).
    mockFetchRejectOnce('Failed to fetch');
    setVisibility('visible');
    await flushPromises();

    // Last-good grid must be untouched — no wipe, no error placeholder.
    expect(core._getProducts()).toHaveLength(1);
    expect(core._getProducts()[0].item_id).toBe('P1');
    expect(core._getProductsLoaded()).toBe(true);
    var grid = document.getElementById('kiosk-product-grid');
    expect(grid.innerHTML).not.toContain('Failed to load');
  });

  test('Test C: a cart line with a phantom item_id is blocked before the sale POST', async function () {
    localStorage.setItem(DEVICE_TOKEN_KEY, 'kiosk-token');
    var core = loadSurface('../../js/kiosk.js').core;
    injectEl('kiosk-product-grid');
    var errMsgEl = injectEl('kiosk-error-msg');
    injectEl('kiosk-error-title');

    // Catalog loaded, does NOT contain the phantom item the cart is about to carry.
    mockFetchOnce(200, { items: [{ item_id: 'P1', name: 'Good Kit', rate: 25 }] });
    core.loadProducts();
    await flushPromises();
    expect(core._getProducts()).toHaveLength(1);

    core._setCart({
      'PHANTOM-109115': {
        item: { item_id: 'PHANTOM-109115', name: 'Ghost Kit', rate: 30 },
        qty: 1
      }
    });

    var callsBefore = global.fetch.mock.calls.length;
    core.proceedToPayment();

    // No sale POST for a cart carrying a phantom line — the server 400 must
    // never be the only backstop.
    var saleCall = global.fetch.mock.calls.slice(callsBefore).find(function (c) {
      return typeof c[0] === 'string' && c[0].indexOf('/api/kiosk/sale') !== -1;
    });
    expect(saleCall).toBeUndefined();

    // Staff-facing message must exist and be clear.
    expect(errMsgEl.textContent).toMatch(/Ghost Kit|no longer|re-add/i);
  });
});
