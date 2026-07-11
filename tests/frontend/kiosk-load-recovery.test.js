'use strict';

// Regression tests for kiosk catalog load RECOVERY (js/kiosk-core.js).
//
// LIVE BUG (reported 2026-07-11): after the iPad sits idle, the staff reload the
// page to get the product grid back. iOS suspends/discards the backgrounded tab;
// on resume the first catalog fetch fires while wifi is still reconnecting and
// rejects. The .catch() painted "Failed to load products: <err>" into the grid and
// stopped there — no retry, no backoff, and no online/visibilitychange handler
// anywhere in kiosk.js or kiosk-core.js. So a single failed fetch was terminal
// until a manual page reload.
//
// Contract these tests pin: a catalog load failure is always recoverable —
//   1. the error state offers a Retry control,
//   2. the kiosk retries by itself when the page becomes visible again,
//   3. the kiosk retries by itself when the network comes back,
//   4. recovery NEVER re-fetches when we already have a good catalog (no churn,
//      and no risk of a failed refresh wiping the grid — see kiosk-load-resilience).
//
// Harness mirrors kiosk-load-resilience.test.js.

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

// The real-world trigger: the network is gone, so fetch REJECTS (TypeError:
// Failed to fetch) rather than resolving with an error status.
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

beforeEach(function () {
  localStorage.clear();
  // mockReset (not mockClear): drains any queued one-shot implementations so a
  // failing test cannot leak a pending mock into the next one.
  global.fetch.mockReset();
  global.fetch.mockImplementation(function () {
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({}); } });
  });
  setVisibility('visible');
});

describe('kiosk catalog load recovery — a failed load must never be a dead end', function () {

  test('the error state offers a Retry control that reloads the catalog', async function () {
    localStorage.setItem(DEVICE_TOKEN_KEY, 'kiosk-token');
    var core = loadSurface('../../js/kiosk.js').core;
    injectEl('kiosk-product-grid');

    // The iPad wakes with no network: the fetch rejects outright.
    mockFetchRejectOnce('Failed to fetch');
    core.loadProducts();
    await flushPromises();

    var grid = document.getElementById('kiosk-product-grid');
    expect(grid.innerHTML).toContain('Failed to load');
    expect(core._getProductsLoaded()).toBe(false);

    // A retry affordance must exist — without it the only way out is a page reload.
    var retry = document.getElementById('kiosk-products-retry');
    expect(retry).not.toBeNull();

    // Tapping it recovers, now that the network is back.
    mockFetchOnce(200, { items: [{ item_id: 'P1', name: 'Test Kit', stock_on_hand: 10 }] });
    retry.click();
    await flushPromises();

    expect(core._getProducts()).toHaveLength(1);
    expect(core._getProductsLoaded()).toBe(true);
    expect(document.getElementById('kiosk-product-grid').innerHTML).not.toContain('Failed to load');
  });

  test('returning to the page (visibilitychange) retries a catalog that never loaded', async function () {
    localStorage.setItem(DEVICE_TOKEN_KEY, 'kiosk-token');
    var core = loadSurface('../../js/kiosk.js').core;
    injectEl('kiosk-product-grid');

    mockFetchRejectOnce('Failed to fetch');
    core.loadProducts();
    await flushPromises();
    expect(core._getProductsLoaded()).toBe(false);

    // Staff come back to the iPad; wifi has reconnected.
    mockFetchOnce(200, { items: [{ item_id: 'P1', name: 'Test Kit', stock_on_hand: 10 }] });
    setVisibility('visible');
    await flushPromises();

    expect(core._getProducts()).toHaveLength(1);
    expect(core._getProductsLoaded()).toBe(true);
  });

  test('the network coming back (online) retries a catalog that never loaded', async function () {
    localStorage.setItem(DEVICE_TOKEN_KEY, 'kiosk-token');
    var core = loadSurface('../../js/kiosk.js').core;
    injectEl('kiosk-product-grid');

    mockFetchRejectOnce('Failed to fetch');
    core.loadProducts();
    await flushPromises();
    expect(core._getProductsLoaded()).toBe(false);

    mockFetchOnce(200, { items: [{ item_id: 'P1', name: 'Test Kit', stock_on_hand: 10 }] });
    window.dispatchEvent(new Event('online'));
    await flushPromises();

    expect(core._getProducts()).toHaveLength(1);
    expect(core._getProductsLoaded()).toBe(true);
  });

  test('recovery does NOT re-fetch when the catalog is already loaded', async function () {
    localStorage.setItem(DEVICE_TOKEN_KEY, 'kiosk-token');
    var core = loadSurface('../../js/kiosk.js').core;
    injectEl('kiosk-product-grid');

    mockFetchOnce(200, { items: [{ item_id: 'P1', name: 'Test Kit', stock_on_hand: 10 }] });
    core.loadProducts();
    await flushPromises();
    expect(core._getProductsLoaded()).toBe(true);

    var callsAfterLoad = global.fetch.mock.calls.length;

    // Idle/relock/wake cycles must not stampede the middleware or risk wiping
    // the good grid with a failed refresh.
    setVisibility('visible');
    window.dispatchEvent(new Event('online'));
    await flushPromises();

    expect(global.fetch.mock.calls.length).toBe(callsAfterLoad);
    expect(core._getProducts()).toHaveLength(1);
  });

  test('recovery does not fire while a load is already in flight', async function () {
    localStorage.setItem(DEVICE_TOKEN_KEY, 'kiosk-token');
    var core = loadSurface('../../js/kiosk.js').core;
    injectEl('kiosk-product-grid');

    // A slow first load that has not settled yet.
    var resolveIt;
    global.fetch.mockImplementationOnce(function () {
      return new Promise(function (res) {
        resolveIt = function () {
          res({ ok: true, status: 200, json: function () { return Promise.resolve({ items: [] }); } });
        };
      });
    });
    core.loadProducts();
    expect(core._getProductsLoading()).toBe(true);

    var callsInFlight = global.fetch.mock.calls.length;
    setVisibility('visible');
    window.dispatchEvent(new Event('online'));
    await flushPromises();

    // No duplicate request piled on top of the in-flight one.
    expect(global.fetch.mock.calls.length).toBe(callsInFlight);

    resolveIt();
    await flushPromises();
    expect(core._getProductsLoading()).toBe(false);
  });
});
