'use strict';

// =============================================================================
// Regression tests: kiosk idle-reset must clear BOTH dual carts + milled state
//
// Bug (#4): initKioskAttractScreen() only clears the legacy RESERVATION_KEY
// (sv-reservation) on idle reset. The dual carts (sv-cart-ferment,
// sv-cart-ingredients) and milled-key sessionStorage (sv-milled-keys) are
// left intact, leaking one customer's cart into the next session.
//
// Fix: export a _resetKioskSessionForTest helper and use the same extracted
// _clearKioskSession() function inside showAttractScreen(), which must clear:
//   - localStorage['sv-cart-ferment']
//   - localStorage['sv-cart-ingredients']
//   - localStorage['sv-reservation'] (legacy — kept for backward compat)
//   - sessionStorage['sv-milled-keys']
// =============================================================================

// ---------------------------------------------------------------------------
// Globals required by 13-init.js at load time
// ---------------------------------------------------------------------------
global.SHEETS_CONFIG = { SPREADSHEET_ID: 'test', MIDDLEWARE_URL: '' };
global.navigator = global.navigator || {};
global.navigator.vibrate = jest.fn();
global.navigator.standalone = false;

// Cart key constants (normally from 11-cart.js global scope)
var FERMENT_KEY     = 'sv-cart-ferment';
var INGREDIENT_KEY  = 'sv-cart-ingredients';
var LEGACY_KEY      = 'sv-reservation';
global.RESERVATION_KEY     = LEGACY_KEY;
global.FERMENT_CART_KEY    = FERMENT_KEY;
global.INGREDIENT_CART_KEY = INGREDIENT_KEY;
global.CART_KEYS = {
  FERMENT: FERMENT_KEY,
  INGREDIENTS: INGREDIENT_KEY,
  LEGACY_RESERVATION: LEGACY_KEY
};

// Cart function stubs (normally global from 11-cart.js)
global.getReservation  = function (key) {
  try { var r = localStorage.getItem(key); return r ? JSON.parse(r) : []; } catch (e) { return []; }
};
global.saveReservation = function (items, key) {
  try { localStorage.setItem(key, JSON.stringify(items)); } catch (e) {}
};
global.refreshAllReserveControls  = function () {};
global.updateReservationBar       = function () {};
global.refreshReservationDependents = function () {};
global.renderCartSidebar          = function () {};
global.showToast                  = function () {};
global.trackEvent                 = jest.fn();
global.formatCurrency             = function (n) { return '$' + parseFloat(n).toFixed(2); };
global.escapeHTML                 = function (s) { return String(s || ''); };

// Other globals that 13-init.js may reference
global.loadTimeslots              = function () {};
global.updateCompletionEstimate   = function () {};
global.PAYMENT_DISABLED           = false;

var init = require('../../js/modules/13-init');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function seedAllCartState() {
  localStorage.setItem(FERMENT_KEY,    JSON.stringify([{ name: 'Wine Kit', qty: 1 }]));
  localStorage.setItem(INGREDIENT_KEY, JSON.stringify([{ name: 'Malt', qty: 2 }]));
  localStorage.setItem(LEGACY_KEY,     JSON.stringify([{ name: 'OldKit', qty: 1 }]));
  sessionStorage.setItem('sv-milled-keys', JSON.stringify({ 'kit-123': true }));
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------
beforeEach(function () {
  localStorage.clear();
  sessionStorage.clear();
  jest.clearAllMocks();
});

afterEach(function () {
  document.body.innerHTML = '';
});

// ---------------------------------------------------------------------------
// Test 1: idle reset clears ALL cart keys
// ---------------------------------------------------------------------------
describe('kiosk idle-reset cart leak (#4)', function () {

  test('T1: attract-screen idle reset clears sv-cart-ferment, sv-cart-ingredients, sv-reservation, and sv-milled-keys', function () {
    seedAllCartState();

    // Pre-condition: all keys are set
    expect(localStorage.getItem(FERMENT_KEY)).not.toBeNull();
    expect(localStorage.getItem(INGREDIENT_KEY)).not.toBeNull();
    expect(localStorage.getItem(LEGACY_KEY)).not.toBeNull();
    expect(sessionStorage.getItem('sv-milled-keys')).not.toBeNull();

    // Invoke the extracted reset directly
    init._resetKioskSessionForTest();

    // All four keys must be cleared
    expect(localStorage.getItem(FERMENT_KEY)).toBeNull();
    expect(localStorage.getItem(INGREDIENT_KEY)).toBeNull();
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(sessionStorage.getItem('sv-milled-keys')).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Test 2: reset must not throw when keys are already absent
  // ---------------------------------------------------------------------------
  test('T2: reset does not throw when one or more keys are already absent', function () {
    // Only set some keys — others intentionally absent
    localStorage.setItem(FERMENT_KEY, JSON.stringify([{ name: 'Kit', qty: 1 }]));
    // INGREDIENT_KEY, LEGACY_KEY, sv-milled-keys intentionally absent

    expect(function () {
      init._resetKioskSessionForTest();
    }).not.toThrow();

    // The key that was present is now cleared
    expect(localStorage.getItem(FERMENT_KEY)).toBeNull();
    // Keys that were absent remain absent (no error)
    expect(localStorage.getItem(INGREDIENT_KEY)).toBeNull();
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Test 3: reset clears all keys even when only sessionStorage key is set
  // ---------------------------------------------------------------------------
  test('T3: reset clears sv-milled-keys from sessionStorage even when localStorage carts are absent', function () {
    sessionStorage.setItem('sv-milled-keys', JSON.stringify({ 'item-abc': true }));

    init._resetKioskSessionForTest();

    expect(sessionStorage.getItem('sv-milled-keys')).toBeNull();
    // localStorage keys also absent (no error from removeItem on absent keys)
    expect(localStorage.getItem(FERMENT_KEY)).toBeNull();
    expect(localStorage.getItem(INGREDIENT_KEY)).toBeNull();
  });
});
