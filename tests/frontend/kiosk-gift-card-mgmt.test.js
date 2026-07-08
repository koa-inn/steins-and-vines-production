'use strict';

// Regression tests for the KIOSK Gift Card Management panel (kgcm-*), Phase 54.
//
// Companion to tests/frontend/admin-gift-card-mgmt.test.js (admin cookie-auth path).
// This file drives the SAME shared js/kiosk-core.js panel through the REAL
// js/kiosk.js env injection (loadSurface harness, per kiosk-core-parity.test.js),
// so the fetch calls resolve buildAuthOptions() to the kiosk device-token shape
// (D-54-03) rather than admin's credentials:'include'. It also adds the
// reason-required negative case the admin file lacks (D-54-02 gate).
//
// Mock response shape mirrors the REAL /api/kiosk/gift-card/lookup contract:
// { ok: true, data: { cert_number, status, face_value, current_balance } }
// (same fixture as admin-gift-card-mgmt.test.js, verified against
// zoho-middleware/__tests__/gift-cards.test.js).

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
  return Promise.resolve({ status: 200, json: function () { return Promise.resolve({}); } });
});

// Real timers (unlike kiosk-device-token.test.js's debounce-collapsing mock) —
// flushPromises() below relies on a genuine macrotask setTimeout(0) to drain
// every microtask queued by the fetch(...).then().then() chains first, exactly
// like tests/frontend/admin-gift-card-mgmt.test.js's flushPromises().
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

// ---------------------------------------------------------------------------
// Helper: load the kiosk surface in full isolation — fresh require cache +
// fresh window.KioskCore singleton — so js/kiosk.js's own KioskCore.init(env)
// call (device-token buildAuthOptions) is the ONLY one active (per
// kiosk-core-parity.test.js loadSurface()).
// ---------------------------------------------------------------------------
function loadSurface(path) {
  jest.resetModules();
  if (global.window) delete global.window.KioskCore;
  document.body.innerHTML = '';
  var mod = require(path); // eslint-disable-line global-require -- intentional dynamic per-surface isolation
  return { mod: mod, core: global.window.KioskCore };
}

function injectEl(id, tag) {
  var existing = document.getElementById(id);
  if (existing) {
    existing.innerHTML = '';
    existing.style.display = '';
    return existing;
  }
  var el = document.createElement(tag || 'div');
  el.id = id;
  document.body.appendChild(el);
  return el;
}

// Injects the kgcm-* markup (kiosk.html) so the real showGiftCardMgmt() panel
// can find its DOM targets in jsdom.
function injectGiftCardMgmtMarkup() {
  injectEl('kgcm-panel');
  injectEl('kgcm-close', 'button');
  injectEl('kgcm-lookup-view');
  injectEl('kgcm-cert', 'input');
  injectEl('kgcm-lookup-btn', 'button');
  injectEl('kgcm-error');
  injectEl('kgcm-result');
  injectEl('kgcm-result-info');
  injectEl('kgcm-void-btn', 'button');
  injectEl('kgcm-void-view');
  injectEl('kgcm-void-confirm');
  injectEl('kgcm-void-reason', 'input');
  injectEl('kgcm-void-error');
  injectEl('kgcm-void-cancel-btn', 'button');
  injectEl('kgcm-void-confirm-btn', 'button');
}

function el(id) {
  var node = document.getElementById(id);
  if (!node) throw new Error('expected panel element #' + id + ' to exist');
  return node;
}

// Real lookup contract (see header comment) — same fixture as the admin test.
var LOOKUP_RESPONSE = {
  ok: true,
  data: { cert_number: 'GC-000001', status: 'active', face_value: 15, current_balance: 7.5 }
};

function mockFetchOnce(status, body) {
  global.fetch.mockImplementationOnce(function () {
    return Promise.resolve({
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

describe('kiosk Gift Card Management panel (kgcm) — device-token auth path (D-54-03)', function () {
  test('lookup fetch carries x-device-token and never credentials:"include"', async function () {
    var surface = loadSurface('../../js/kiosk.js');
    localStorage.setItem(DEVICE_TOKEN_KEY, 'kiosk-gc-mgmt-token');
    injectGiftCardMgmtMarkup();

    surface.core.showGiftCardMgmt();
    el('kgcm-cert').value = 'GC-000001';
    mockFetchOnce(200, LOOKUP_RESPONSE);

    el('kgcm-lookup-btn').onclick();
    await flushPromises();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    var call = global.fetch.mock.calls[0];
    expect(call[0]).toBe('http://localhost:3001/api/kiosk/gift-card/lookup?cert_number=GC-000001');
    var opts = call[1];
    expect(opts.headers['x-device-token']).toBe('kiosk-gc-mgmt-token');
    expect(opts.credentials).toBeUndefined();
  });

  test('lookup renders cert #, status, face value, and current balance from the nested data payload', async function () {
    var surface = loadSurface('../../js/kiosk.js');
    localStorage.setItem(DEVICE_TOKEN_KEY, 'kiosk-gc-mgmt-token');
    injectGiftCardMgmtMarkup();

    surface.core.showGiftCardMgmt();
    el('kgcm-cert').value = 'GC-000001';
    mockFetchOnce(200, LOOKUP_RESPONSE);

    el('kgcm-lookup-btn').onclick();
    await flushPromises();

    var html = el('kgcm-result-info').innerHTML;
    expect(html).toContain('GC-000001');
    expect(html).toContain('active');
    expect(html).toContain('$15.00'); // face_value
    expect(html).toContain('$7.50');  // current_balance
    expect(el('kgcm-result').style.display).toBe('block');
  });

  test('void posts to the middleware host with cert number and reason, using the device-token header', async function () {
    var surface = loadSurface('../../js/kiosk.js');
    localStorage.setItem(DEVICE_TOKEN_KEY, 'kiosk-gc-mgmt-token');
    injectGiftCardMgmtMarkup();

    surface.core.showGiftCardMgmt();
    el('kgcm-cert').value = 'GC-000001';
    mockFetchOnce(200, LOOKUP_RESPONSE);
    el('kgcm-lookup-btn').onclick();
    await flushPromises();

    // Switch to void view, provide a reason, confirm.
    el('kgcm-void-btn').onclick();
    el('kgcm-void-reason').value = 'UAT test certificate';
    mockFetchOnce(200, { ok: true });
    el('kgcm-void-confirm-btn').onclick();
    await flushPromises();

    expect(global.fetch).toHaveBeenCalledTimes(2);
    var call = global.fetch.mock.calls[1];
    expect(call[0]).toBe('http://localhost:3001/api/kiosk/gift-card/void');
    expect(call[1].headers['x-device-token']).toBe('kiosk-gc-mgmt-token');
    expect(call[1].credentials).toBeUndefined();
    var body = JSON.parse(call[1].body);
    expect(body.cert_number).toBe('GC-000001');
    expect(body.reason).toBe('UAT test certificate');
  });

  test('an empty reason blocks Confirm Void — no second (void) fetch is fired (D-54-02 gate)', async function () {
    var surface = loadSurface('../../js/kiosk.js');
    localStorage.setItem(DEVICE_TOKEN_KEY, 'kiosk-gc-mgmt-token');
    injectGiftCardMgmtMarkup();

    surface.core.showGiftCardMgmt();
    el('kgcm-cert').value = 'GC-000001';
    mockFetchOnce(200, LOOKUP_RESPONSE);
    el('kgcm-lookup-btn').onclick();
    await flushPromises();

    el('kgcm-void-btn').onclick();
    el('kgcm-void-reason').value = '';
    el('kgcm-void-confirm-btn').onclick();
    await flushPromises();

    // Still only the lookup call — Confirm Void must not have fired a request.
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(el('kgcm-void-error').textContent).toBe('Please enter a reason for voiding.');
    expect(el('kgcm-void-error').style.display).toBe('block');
  });
});
