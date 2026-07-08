'use strict';

// =============================================================================
// Tests: kiosk device-token gate (Phase 46, D-46-01/D-46-02)
//
// The standalone kiosk (js/kiosk.js) replaces its per-staff Google sign-in
// gate with a typed-in device token persisted in localStorage:
//   1. With no stored token, boot shows the (repurposed) #kiosk-signin
//      screen as a device-token entry prompt — NOT a Google sign-in button.
//   2. Once a token is saved, every kiosk middleware fetch carries an
//      x-device-token header equal to the stored token, and never an
//      x-api-key header.
//   3. Customer search hits the narrow /api/contacts/search route (not the
//      full-PII /api/contacts route).
// =============================================================================

// ---------------------------------------------------------------------------
// Environment stubs (mirrors kiosk-recipe-modify.test.js pattern)
// ---------------------------------------------------------------------------
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
  return Promise.resolve({
    ok: true,
    status: 200,
    json: function () { return Promise.resolve({}); }
  });
});

// setTimeout fires immediately so the customer-search debounce collapses in tests
global.setTimeout = jest.fn(function (fn) {
  if (typeof fn === 'function') fn();
  return 1;
});
global.clearTimeout = jest.fn();
global.setInterval = jest.fn(function () { return 1; });
global.clearInterval = jest.fn();
global.alert = jest.fn();

global.SHEETS_CONFIG = {
  MIDDLEWARE_URL: 'http://mw.test',
  SPREADSHEET_ID: 'test-id',
  GOOGLE_CLIENT_ID: 'test-client-id',
  STAFF_EMAILS: 'test@example.com'
};

var kiosk = require('../../js/kiosk.js');

var DEVICE_TOKEN_KEY = 'sv_kiosk_device_token';

// ---------------------------------------------------------------------------
// Helper: inject a real jsdom element into document.body
// ---------------------------------------------------------------------------
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

// Minimal DOM shell the device-token gate + boot flow touches.
function injectKioskShell() {
  injectEl('kiosk-signin');
  var promptEl = document.createElement('p');
  document.getElementById('kiosk-signin').appendChild(promptEl);
  injectEl('kiosk-google-signin-btn');
  injectEl('kiosk-denied-msg');
  injectEl('kiosk-app');
  injectEl('kiosk-lock-screen');
  injectEl('kiosk-lock-user');
  injectEl('kiosk-lock-error');
  injectEl('kiosk-lock-dots');
  injectEl('kiosk-lock-keypad');
  injectEl('kiosk-lock-backspace', 'button');
  injectEl('kiosk-lock-signout', 'button');
  injectEl('kiosk-signout', 'button');
  injectEl('kiosk-user-email');
}

beforeEach(function () {
  localStorage.clear();
  document.body.innerHTML = '';
  global.fetch.mockClear();
  global.fetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: function () { return Promise.resolve({}); }
  });
});

afterEach(function () {
  document.body.innerHTML = '';
});

// ---------------------------------------------------------------------------
// T1: No-token boot surfaces the device-token prompt, not a Google sign-in
// ---------------------------------------------------------------------------
describe('kiosk device-token gate — boot flow', function () {
  test('T1: with no stored device token, boot shows the settings prompt (no Google sign-in button)', function () {
    injectKioskShell();
    expect(localStorage.getItem(DEVICE_TOKEN_KEY)).toBeNull();

    kiosk.initKioskAuth();

    var signinScreen = document.getElementById('kiosk-signin');
    var kioskApp = document.getElementById('kiosk-app');
    var lockScreen = document.getElementById('kiosk-lock-screen');
    var tokenInput = document.getElementById('kiosk-device-token-input');

    expect(signinScreen.style.display).not.toBe('none');
    expect(kioskApp.style.display).toBe('none');
    expect(lockScreen.style.display).toBe('none');

    // A device-token input exists — the Google sign-in button never does.
    expect(tokenInput).not.toBeNull();
    expect(tokenInput.type).toBe('password');
    expect(document.querySelector('#kiosk-google-signin-btn button')).not.toBeNull();
  });

  test('T1b: saving a token via the prompt persists it and reveals the PIN lock screen', function () {
    injectKioskShell();

    kiosk.showDeviceTokenPrompt();
    var input = document.getElementById('kiosk-device-token-input');
    var saveBtn = document.querySelector('#kiosk-google-signin-btn button');
    expect(input).not.toBeNull();
    expect(saveBtn).not.toBeNull();

    input.value = 'kiosk-abc-123';
    saveBtn.click();

    expect(localStorage.getItem(DEVICE_TOKEN_KEY)).toBe('kiosk-abc-123');
    expect(document.getElementById('kiosk-lock-screen').style.display).not.toBe('none');
  });

  test('T1c: with a stored device token, boot goes straight to the PIN lock screen', function () {
    injectKioskShell();
    localStorage.setItem(DEVICE_TOKEN_KEY, 'kiosk-existing-token');

    kiosk.initKioskAuth();

    // #kiosk-lock-screen is a fixed, full-viewport overlay (z-index 9000 in
    // css/kiosk.css) — it covers #kiosk-signin without needing to hide it,
    // matching the pre-existing showLockScreen() contract.
    expect(document.getElementById('kiosk-lock-screen').style.display).not.toBe('none');
  });

  test('T1d: with a stored token, the prompt shows a Back button that returns to the PIN lock screen without re-entry', function () {
    injectKioskShell();
    localStorage.setItem(DEVICE_TOKEN_KEY, 'kiosk-existing-token');

    // Simulate an accidental "Device Settings" tap during a sale.
    kiosk.showDeviceTokenPrompt();

    var backBtn = document.getElementById('kiosk-device-token-cancel');
    expect(backBtn).not.toBeNull();
    expect(backBtn.style.display).not.toBe('none');

    backBtn.click();

    // Returns to the PIN lock screen; the stored token is left untouched.
    expect(document.getElementById('kiosk-lock-screen').style.display).not.toBe('none');
    expect(localStorage.getItem(DEVICE_TOKEN_KEY)).toBe('kiosk-existing-token');
  });

  test('T1e: with NO stored token, the Back button is hidden so first-time setup stays mandatory', function () {
    injectKioskShell();
    expect(localStorage.getItem(DEVICE_TOKEN_KEY)).toBeNull();

    kiosk.showDeviceTokenPrompt();

    var backBtn = document.getElementById('kiosk-device-token-cancel');
    // Built into the DOM once, but must not be an escape hatch when there is
    // no token to fall back to.
    expect(backBtn).not.toBeNull();
    expect(backBtn.style.display).toBe('none');
  });
});

// ---------------------------------------------------------------------------
// T2: kiosk fetches carry x-device-token, never x-api-key
// ---------------------------------------------------------------------------
describe('kiosk device-token gate — outbound headers', function () {
  test('T2: kioskFetchRecipeQuote sends x-device-token equal to the stored token and no x-api-key', function () {
    localStorage.setItem(DEVICE_TOKEN_KEY, 'kiosk-header-token');

    kiosk._kioskSetSelectedRecipe({
      recipe_id: 'RCP-001',
      batch_size_l: 23,
      pricing_mode: 'dynamic',
      computed_price: 100
    });
    kiosk._kioskSetSaleType('in-store');
    kiosk._kioskSetTargetVolumeL(23);

    global.fetch.mockResolvedValueOnce({
      status: 200,
      json: function () { return Promise.resolve({ ok: true, recipe_id: 'RCP-001', total: 100, ingredients: [] }); }
    });

    kiosk.kioskFetchRecipeQuote();

    expect(global.fetch).toHaveBeenCalled();
    var opts = global.fetch.mock.calls[0][1];
    expect(opts.headers['x-device-token']).toBe('kiosk-header-token');
    expect(opts.headers['x-api-key']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// T3: Customer search hits the narrow /api/contacts/search route
// ---------------------------------------------------------------------------
describe('kiosk device-token gate — customer search scope', function () {
  test('T3: customer search requests /api/contacts/search (not /api/contacts?search=)', function () {
    localStorage.setItem(DEVICE_TOKEN_KEY, 'kiosk-search-token');

    injectEl('kiosk-customer-search', 'input');
    injectEl('kiosk-customer-results');
    injectEl('kiosk-customer-selected');
    injectEl('kiosk-customer-proceed', 'button');
    injectEl('kiosk-customer-skip', 'button');
    injectEl('kiosk-customer-back', 'button');
    injectEl('kiosk-new-customer-toggle', 'button');
    injectEl('kiosk-new-customer-form');
    injectEl('kiosk-new-customer-save', 'button');
    injectEl('kiosk-view-customer');

    kiosk.kioskShowCustomerStep();

    var searchInput = document.getElementById('kiosk-customer-search');
    searchInput.value = 'Jane Doe';
    searchInput.dispatchEvent(new Event('input'));

    expect(global.fetch).toHaveBeenCalled();
    var url = global.fetch.mock.calls[global.fetch.mock.calls.length - 1][0];
    expect(url).toContain('/api/contacts/search?q=');
    expect(url).not.toContain('/api/contacts?search=');

    var opts = global.fetch.mock.calls[global.fetch.mock.calls.length - 1][1];
    expect(opts.headers['x-device-token']).toBe('kiosk-search-token');
    expect(opts.headers['x-api-key']).toBeUndefined();
  });
});
