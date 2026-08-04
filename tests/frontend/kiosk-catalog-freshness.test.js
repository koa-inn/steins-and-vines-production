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

// This file (unlike kiosk-load-recovery/resilience) exercises the NEW
// staleness-based wake refresh, which fires whenever a closure's OWN loaded
// catalog looks older than KIOSK_CATALOG_MAX_AGE_MS — a condition that (unlike
// the pre-existing !loaded guard) a PRIOR test's already-loaded closure can
// ALSO satisfy once Date.now() is mocked forward. loadSurface() creates a
// fresh KioskCore closure per test but the previous closure's
// document/window listeners are never detached (jsdom's document/window are
// real singletons shared across every test in this file), so without this
// tracking a stale prior closure's listener fires alongside the current
// one on the same visibilitychange/online dispatch, racing the shared
// global.fetch mock queue. Track + detach every listener before each new
// surface loads.
var _kcfTrackedListeners = [];
var _kcfOrigDocAdd = document.addEventListener.bind(document);
document.addEventListener = function (type, fn, opts) {
  _kcfTrackedListeners.push({ target: document, type: type, fn: fn });
  return _kcfOrigDocAdd(type, fn, opts);
};
var _kcfOrigWinAdd = window.addEventListener.bind(window);
window.addEventListener = function (type, fn, opts) {
  _kcfTrackedListeners.push({ target: window, type: type, fn: fn });
  return _kcfOrigWinAdd(type, fn, opts);
};

function detachTrackedListeners() {
  _kcfTrackedListeners.forEach(function (l) {
    l.target.removeEventListener(l.type, l.fn);
  });
  _kcfTrackedListeners = [];
}

function loadSurface(path) {
  detachTrackedListeners(); // remove the PREVIOUS surface's listeners before creating a new one
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

// 10 minutes + a generous 5s buffer — must exceed KIOSK_CATALOG_MAX_AGE_MS
// regardless of the exact bound chosen by the implementation (documented as
// ~10 minutes). The buffer must comfortably exceed the REAL wall-clock time
// between capturing `realNow` (before the seed load) and the moment
// _kioskProductsLoadedAt is actually set inside the fetch promise chain — a
// margin of only 1ms was observed to flake under CPU contention (the
// microtask chain occasionally takes >1ms in a busy test run).
var PAST_STALENESS_BOUND_MS = 10 * 60 * 1000 + 5000;

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

// ---------------------------------------------------------------------------
// Phase 67-02 — client displayed totals on the sale body + cart-lifecycle
// catalog refresh (kiosk-tax-under-quote.md, INV-000160).
//
// Contract these tests pin:
//   D. POST /api/kiosk/sale carries client_grand_total === totals.total and
//      client_tax_total === totals.tax (exact field names pinned by 67-01's
//      middleware pre-charge assertion — the server asserts, never trusts).
//   E. Entering checkout (kioskStartCheckout, the cart→customer transition
//      the New Sale button does not cover) force-refreshes the in-memory
//      catalog via kioskLoadProducts(true), so a parked kiosk cannot quote
//      from a stale snapshot.
// ---------------------------------------------------------------------------
describe('67-02 — client displayed totals + cart-lifecycle catalog refresh', function () {

  test('Test D: the sale POST body carries client_grand_total and client_tax_total matching the displayed totals', async function () {
    localStorage.setItem(DEVICE_TOKEN_KEY, 'kiosk-token');
    var core = loadSurface('../../js/kiosk.js').core;
    injectEl('kiosk-product-grid');
    // kiosk-payment-items needs a parentNode so the GC tender panel injects.
    injectEl('kiosk-payment-items');

    mockFetchOnce(200, { items: [{ item_id: 'P1', name: 'Good Kit', rate: 25, tax_percentage: 5 }] });
    core.loadProducts();
    await flushPromises();
    expect(core._getProducts()).toHaveLength(1);

    core._setCart({
      'P1': { item: { item_id: 'P1', name: 'Good Kit', rate: 25, tax_percentage: 5 }, qty: 2 }
    });

    var totals = core.calcTotals();
    expect(totals.total).toBe(52.5); // sanity: 50 + 5% tax
    expect(totals.tax).toBe(2.5);

    core.proceedToPayment();

    // Standard (non-recipe) sales inject the GC tender panel; "Proceed to
    // Terminal" (skip) fires the actual sale POST.
    var skipBtn = document.getElementById('kgcr-skip-btn');
    expect(skipBtn).toBeTruthy();
    skipBtn.onclick();

    var saleCall = global.fetch.mock.calls.find(function (c) {
      return typeof c[0] === 'string' && c[0].indexOf('/api/kiosk/sale') !== -1;
    });
    expect(saleCall).toBeTruthy();
    var body = JSON.parse(saleCall[1].body);
    // Exact field names pinned by the 67-01 interface contract.
    expect(body.client_grand_total).toBe(totals.total);
    expect(body.client_tax_total).toBe(totals.tax);

    await flushPromises(); // settle the mocked sale response chain
  });

  test('Test E: entering checkout force-refreshes the catalog (kioskLoadProducts(true) fires at kioskStartCheckout)', async function () {
    localStorage.setItem(DEVICE_TOKEN_KEY, 'kiosk-token');
    var core = loadSurface('../../js/kiosk.js').core;
    injectEl('kiosk-product-grid');

    mockFetchOnce(200, { items: [{ item_id: 'P1', name: 'Good Kit', rate: 25, tax_percentage: 5 }] });
    core.loadProducts();
    await flushPromises();
    expect(core._getProducts()).toHaveLength(1);

    core._setCart({
      'P1': { item: { item_id: 'P1', name: 'Good Kit', rate: 25, tax_percentage: 5 }, qty: 1 }
    });
    core.setTerminalStatus(true, 'Terminal ready');

    var callsBefore = global.fetch.mock.calls.length;
    mockFetchOnce(200, { items: [{ item_id: 'P1', name: 'Good Kit', rate: 25, tax_percentage: 5 }] });
    core.startCheckout();
    await flushPromises();

    // The cart-lifecycle hook must fire a force-refresh (?bust=1) of the catalog.
    var bustCall = global.fetch.mock.calls.slice(callsBefore).find(function (c) {
      return typeof c[0] === 'string' &&
        c[0].indexOf('/api/kiosk/products') !== -1 && c[0].indexOf('bust=1') !== -1;
    });
    expect(bustCall).toBeTruthy();

    // A failed refresh keeps the last-good catalog (keep-last-good inherited
    // from kioskLoadProducts) — assert the grid was not wiped by the refresh.
    expect(core._getProducts()).toHaveLength(1);
    expect(core._getProductsLoaded()).toBe(true);
  });
});
