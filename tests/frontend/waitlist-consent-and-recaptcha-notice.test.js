'use strict';

// =============================================================================
// Last two items of the policy build list:
//   - the beer waitlist form states what the visitor consents to (CASL express
//     consent: who we are, what we send, unsubscribe) and sends that statement
//     with the signup so the middleware can record it
//   - the checkout carries the Google reCAPTCHA notice with its two links
// =============================================================================

var fs = require('fs');
var path = require('path');
var ROOT = path.join(__dirname, '..', '..');

describe('beer.html waitlist consent statement', function () {
  var html = fs.readFileSync(path.join(ROOT, 'beer.html'), 'utf8');

  test('is present next to the form, names the sender and the unsubscribe, and links the privacy policy', function () {
    expect(html).toMatch(/<p class="beer-waitlist-consent" id="beer-waitlist-consent">/);
    var block = html.slice(html.indexOf('id="beer-waitlist-consent"'), html.indexOf('id="beer-waitlist-consent"') + 400);
    expect(block).toMatch(/agree to receive emails/i);
    expect(block).toMatch(/1571221 B\.C\. Ltd\./);
    expect(block).toMatch(/unsubscribe/i);
    expect(block).toContain('href="privacy.html"');
  });

  test('sits directly after the form it refers to', function () {
    var formEnd = html.indexOf('</form>', html.indexOf('id="beer-waitlist-form"'));
    expect(html.indexOf('id="beer-waitlist-consent"')).toBeGreaterThan(formEnd);
    expect(html.indexOf('id="beer-waitlist-consent"') - formEnd).toBeLessThan(120);
  });
});

describe('reservation.html reCAPTCHA notice', function () {
  var html = fs.readFileSync(path.join(ROOT, 'reservation.html'), 'utf8');

  test('carries the required wording and both Google links', function () {
    expect(html).toMatch(/This site is protected by reCAPTCHA/);
    expect(html).toContain('href="https://policies.google.com/privacy"');
    expect(html).toContain('href="https://policies.google.com/terms"');
  });

  test('sits inside the checkout form, near the submit button', function () {
    var submit = html.indexOf('data-content="submit-btn"');
    var notice = html.indexOf('id="recaptcha-note"');
    expect(notice).toBeGreaterThan(submit);
    expect(notice - submit).toBeLessThan(400);
  });
});

// ---------------------------------------------------------------------------
// The signup POST carries the consent statement it displayed
// ---------------------------------------------------------------------------
global.SHEETS_CONFIG = { SPREADSHEET_ID: 'test', MIDDLEWARE_URL: 'http://localhost:3001' };
global.navigator = global.navigator || {};
global.navigator.vibrate = jest.fn();
var FERMENT_CART_KEY = 'sv-cart-ferment';
var INGREDIENT_CART_KEY = 'sv-cart-ingredients';
global.FERMENT_CART_KEY = FERMENT_CART_KEY;
global.INGREDIENT_CART_KEY = INGREDIENT_CART_KEY;
global.getReservation = function () { return []; };
global.saveReservation = function () {};
global.getAllCartItems = function () { return []; };
global.isWeightUnit = function () { return false; };
global.getEffectiveMax = function () { return 999; };
global.getCartKey = function () { return FERMENT_CART_KEY; };
global.getCartKeyForTab = function () { return FERMENT_CART_KEY; };
global.setReservationQty = function () {};
global.refreshAllReserveControls = function () {};
global.updateReservationBar = function () {};
global.refreshReservationDependents = function () {};
global.renderCartSidebar = function () {};
global.showToast = jest.fn();
global.trackEvent = jest.fn();
global.formatCurrency = function (n) { return '$' + n.toFixed(2); };
global.escapeHTML = function (s) { return String(s || ''); };
global.applyKitSpecificVisibility = function () {};
global.initCheckoutStepper = function () {};
global.setupContactValidation = function () {};
global.loadTimeslots = function () {};
global.updateCompletionEstimate = function () {};

describe('waitlist signup POST', function () {
  test('sends consent: true and the exact statement shown on the page', function () {
    jest.resetModules();
    var mod = require('../../js/modules/12-checkout');
    document.body.innerHTML =
      '<form id="beer-waitlist-form"><input id="beer-waitlist-email" value="pat@example.com"><button type="submit">Join the Waitlist</button></form>' +
      '<p id="beer-waitlist-consent">By joining, you agree to receive emails from Steins &amp; Vines about the beer programme.\n   Every email has an unsubscribe link.</p>' +
      '<p id="beer-waitlist-confirm" class="hidden"></p>';
    var captured = null;
    global.fetch = jest.fn(function (url, opts) {
      captured = { url: url, body: JSON.parse(opts.body) };
      return Promise.resolve({ json: function () { return Promise.resolve({ success: true }); } });
    });
    mod.setupBeerWaitlistFormForTest();
    document.getElementById('beer-waitlist-form').dispatchEvent(new Event('submit', { cancelable: true }));
    expect(captured).not.toBeNull();
    expect(captured.url).toBe('http://localhost:3001/api/waitlist');
    expect(captured.body.email).toBe('pat@example.com');
    expect(captured.body.consent).toBe(true);
    expect(captured.body.consent_text).toBe('By joining, you agree to receive emails from Steins & Vines about the beer programme. Every email has an unsubscribe link.');
  });
});
