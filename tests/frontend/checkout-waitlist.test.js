'use strict';

// =============================================================================
// Regression tests: beer waitlist must route through /api/contact (#2, D-02)
//
// Bug: setupBeerWaitlistForm() POSTs to a placeholder Google Form URL and
// ALWAYS shows #beer-waitlist-confirm (fake success), discarding the signup.
//
// Fix: rewrite to POST JSON to ${MIDDLEWARE_URL}/api/contact, show confirm
// ONLY on {success:true}, surface error on failure, do nothing on empty email.
// =============================================================================

// ---------------------------------------------------------------------------
// Global stubs (must be set before requiring 12-checkout.js)
// ---------------------------------------------------------------------------
global.SHEETS_CONFIG = { SPREADSHEET_ID: 'test', MIDDLEWARE_URL: 'http://localhost:3001' };
global.navigator = global.navigator || {};
global.navigator.vibrate = jest.fn();

// Cart globals expected by 12-checkout.js at load time
var FERMENT_CART_KEY    = 'sv-cart-ferment';
var INGREDIENT_CART_KEY = 'sv-cart-ingredients';
global.FERMENT_CART_KEY    = FERMENT_CART_KEY;
global.INGREDIENT_CART_KEY = INGREDIENT_CART_KEY;

function getReservationLocal(cartKey) {
  try { var r = localStorage.getItem(cartKey); return r ? JSON.parse(r) : []; } catch (e) { return []; }
}
function saveReservationLocal(items, cartKey) {
  try { localStorage.setItem(cartKey, JSON.stringify(items)); } catch (e) {}
}
global.getReservation   = getReservationLocal;
global.saveReservation  = saveReservationLocal;
global.getAllCartItems   = function () { return []; };
global.isWeightUnit     = function (unit) {
  var u = (unit || '').toLowerCase();
  return u === 'kg' || u === 'g' || u === 'lbs' || u === 'oz';
};
global.getEffectiveMax  = function (item) {
  return parseFloat(item.max_order_qty) || parseFloat(item.stock) || 999;
};
global.getCartKey               = function () { return FERMENT_CART_KEY; };
global.getCartKeyForTab         = function () { return FERMENT_CART_KEY; };
global.setReservationQty        = function () {};
global.refreshAllReserveControls = function () {};
global.updateReservationBar     = function () {};
global.refreshReservationDependents = function () {};
global.renderCartSidebar        = function () {};
global.trackEvent               = jest.fn();
global.formatCurrency = function (n) { return '$' + (Math.round(n * 100) / 100).toFixed(2); };
global.escapeHTML = function (s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
};
global.applyKitSpecificVisibility = function () {};
global.initCheckoutStepper        = function () {};
global.setupContactValidation     = function () {};
global.loadTimeslots              = function () {};
global.updateCompletionEstimate   = function () {};

// Capture showToast calls so we can assert on error surfacing
var _toastCalls = [];
global.showToast = function (msg, type) { _toastCalls.push({ msg: msg, type: type }); };

var checkout = require('../../js/modules/12-checkout');

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------
function setupWaitlistDOM() {
  document.body.innerHTML =
    '<form id="beer-waitlist-form">' +
    '  <input id="beer-waitlist-email" type="email" />' +
    '  <button type="submit">Join Waitlist</button>' +
    '</form>' +
    '<div id="beer-waitlist-confirm" class="hidden"></div>';
}

function getForm() { return document.getElementById('beer-waitlist-form'); }
function getEmail() { return document.getElementById('beer-waitlist-email'); }
function getConfirm() { return document.getElementById('beer-waitlist-confirm'); }

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------
beforeEach(function () {
  localStorage.clear();
  sessionStorage.clear();
  jest.clearAllMocks();
  _toastCalls = [];
  global.fetch = undefined;
  setupWaitlistDOM();
  checkout.setupBeerWaitlistFormForTest();
});

afterEach(function () {
  document.body.innerHTML = '';
});

// ---------------------------------------------------------------------------
// Test 1 (RED): valid email POSTs to /api/contact; confirm shown on success
// ---------------------------------------------------------------------------
describe('beer waitlist — /api/contact routing (D-02)', function () {

  test('T1: submitting a valid email POSTs to /api/contact and shows confirm on success', function () {
    var capturedUrl = null;
    var capturedBody = null;

    global.fetch = jest.fn(function (url, opts) {
      capturedUrl = url;
      capturedBody = JSON.parse(opts.body);
      return Promise.resolve({
        json: function () { return Promise.resolve({ success: true }); }
      });
    });

    getEmail().value = 'test@example.com';
    getForm().dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    return new Promise(function (resolve) { setTimeout(resolve, 50); }).then(function () {
      // Must POST to /api/contact (not docs.google.com)
      expect(capturedUrl).toMatch(/\/api\/contact$/);
      expect(capturedUrl).not.toMatch(/docs\.google\.com/);
      expect(capturedUrl).not.toMatch(/YOUR_BEER_WAITLIST_FORM_ID/);

      // Body must carry the email
      expect(capturedBody).toBeDefined();
      expect(capturedBody.email).toBe('test@example.com');

      // Confirm shown ONLY after success
      expect(getConfirm().classList.contains('hidden')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Test 2 (RED): failure response must NOT show confirm; must surface error
  // ---------------------------------------------------------------------------
  test('T2: on {success:false} response, confirm is NOT shown and error is surfaced', function () {
    global.fetch = jest.fn(function () {
      return Promise.resolve({
        json: function () { return Promise.resolve({ success: false, error: 'Server error' }); }
      });
    });

    getEmail().value = 'test@example.com';
    getForm().dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    return new Promise(function (resolve) { setTimeout(resolve, 50); }).then(function () {
      // Confirm must remain hidden
      expect(getConfirm().classList.contains('hidden')).toBe(true);
      // An error must have been surfaced (showToast called with 'error' type)
      var errorToasts = _toastCalls.filter(function (t) { return t.type === 'error'; });
      expect(errorToasts.length).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Test 3 (RED): network error must NOT show confirm; must surface error
  // ---------------------------------------------------------------------------
  test('T3: on network error, confirm is NOT shown and error is surfaced', function () {
    global.fetch = jest.fn(function () {
      return Promise.reject(new Error('Network failure'));
    });

    getEmail().value = 'test@example.com';
    getForm().dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    return new Promise(function (resolve) { setTimeout(resolve, 50); }).then(function () {
      expect(getConfirm().classList.contains('hidden')).toBe(true);
      var errorToasts = _toastCalls.filter(function (t) { return t.type === 'error'; });
      expect(errorToasts.length).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Test 4 (RED): blank email must not fire a request
  // ---------------------------------------------------------------------------
  test('T4: blank email does not fire a fetch request', function () {
    global.fetch = jest.fn();

    getEmail().value = '';
    getForm().dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    return new Promise(function (resolve) { setTimeout(resolve, 50); }).then(function () {
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Test 5 (RED): no Google Form reference should exist in POSTed URL
  // ---------------------------------------------------------------------------
  test('T5: Google Form placeholder is not used — no docs.google.com POST', function () {
    var urls = [];
    global.fetch = jest.fn(function (url) {
      urls.push(url);
      return Promise.resolve({ json: function () { return Promise.resolve({ success: true }); } });
    });

    getEmail().value = 'test@example.com';
    getForm().dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    return new Promise(function (resolve) { setTimeout(resolve, 50); }).then(function () {
      urls.forEach(function (u) {
        expect(u).not.toMatch(/docs\.google\.com/);
        expect(u).not.toMatch(/YOUR_BEER_WAITLIST_FORM_ID/);
        expect(u).not.toMatch(/YOUR_EMAIL_ENTRY_ID/);
      });
    });
  });
});
