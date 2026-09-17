'use strict';

// =============================================================================
// Checkout acknowledgement (BPCPA s.18.3 "express opportunity to view the
// entire contract") and the CASL-style newsletter opt-in.
//
//   - a required checkbox: "I confirm I am 19 or older and agree to the
//     Terms & Conditions, the Refund, Return & Cancellation Policy, and the
//     Privacy Policy" — the 19+ phrase shows only for kit (ferment) orders
//   - a separate, UNTICKED newsletter checkbox
//   - both values travel with the order as terms_accepted / newsletter_opt_in
// =============================================================================

global.SHEETS_CONFIG = { SPREADSHEET_ID: 'test', MIDDLEWARE_URL: '' };
global.navigator = global.navigator || {};
global.navigator.vibrate = jest.fn();

var val = require('../../js/modules/12a-checkout-validation');

function setupForm(opts) {
  opts = opts || {};
  document.body.className = opts.kiosk ? 'kiosk-mode' : '';
  document.body.innerHTML =
    '<div id="form-error-announce" role="alert"></div>' +
    '<form id="reservation-form">' +
    '  <input id="res-name" value="' + (opts.name === undefined ? 'Pat Example' : opts.name) + '">' +
    '  <input id="res-email" value="pat@example.com">' +
    '  <input id="res-phone" value="(604) 555-0100">' +
    (opts.noConsent ? '' :
      '  <div class="checkout-consent">' +
      '    <label for="res-terms"><input type="checkbox" id="res-terms"' + (opts.terms ? ' checked' : '') + '>' +
      '      <span><span id="res-terms-age" class="hidden">I confirm I am 19 or older and </span>I agree to the Terms</span></label>' +
      '    <label for="res-newsletter"><input type="checkbox" id="res-newsletter"' + (opts.newsletter ? ' checked' : '') + '></label>' +
      '  </div>') +
    '  <button type="submit">Submit</button>' +
    '</form>';
}

describe('validateCheckoutForm — terms acknowledgement', function () {
  test('blocks submission until the terms box is ticked, with a clear message', function () {
    setupForm({ terms: false });
    expect(val.validateCheckoutForm()).toBe(false);
    expect(document.getElementById('form-error-announce').textContent).toMatch(/Terms/);
  });

  test('passes once the box is ticked', function () {
    setupForm({ terms: true });
    expect(val.validateCheckoutForm()).toBe(true);
  });

  test('the newsletter box is never required', function () {
    setupForm({ terms: true, newsletter: false });
    expect(val.validateCheckoutForm()).toBe(true);
  });

  test('a page without the checkbox is unaffected', function () {
    setupForm({ noConsent: true });
    expect(val.validateCheckoutForm()).toBe(true);
  });

  test('kiosk mode (staff-run, ID and slip signed in store) does not require the box', function () {
    setupForm({ terms: false, kiosk: true });
    expect(val.validateCheckoutForm()).toBe(true);
  });

  test('still reports the other field errors alongside the terms error', function () {
    setupForm({ terms: false, name: '' });
    expect(val.validateCheckoutForm()).toBe(false);
    var msg = document.getElementById('form-error-announce').textContent;
    expect(msg).toMatch(/Name is required/);
    expect(msg).toMatch(/Terms/);
  });
});

describe('getCheckoutConsent — what travels with the order', function () {
  test('reports both boxes', function () {
    setupForm({ terms: true, newsletter: true });
    expect(val.getCheckoutConsent()).toEqual({ terms_accepted: true, newsletter_opt_in: true });
  });

  test('newsletter defaults to false when unticked', function () {
    setupForm({ terms: true, newsletter: false });
    expect(val.getCheckoutConsent()).toEqual({ terms_accepted: true, newsletter_opt_in: false });
  });

  test('missing controls read as false, never as consent', function () {
    setupForm({ noConsent: true });
    expect(val.getCheckoutConsent()).toEqual({ terms_accepted: false, newsletter_opt_in: false });
  });
});

describe('applyKitSpecificVisibility — the 19+ phrase', function () {
  test('is shown for kit (ferment) orders', function () {
    setupForm({ terms: false });
    val.applyKitSpecificVisibility(true);
    expect(document.getElementById('res-terms-age').classList.contains('hidden')).toBe(false);
  });

  test('is hidden for ingredient-only orders', function () {
    setupForm({ terms: false });
    val.applyKitSpecificVisibility(true);
    val.applyKitSpecificVisibility(false);
    expect(document.getElementById('res-terms-age').classList.contains('hidden')).toBe(true);
  });
});

describe('reservation.html markup', function () {
  var fs = require('fs');
  var path = require('path');
  var html = fs.readFileSync(path.join(__dirname, '..', '..', 'reservation.html'), 'utf8');

  test('has the required terms checkbox with links to the three policies', function () {
    expect(html).toMatch(/<input[^>]*id="res-terms"[^>]*required/);
    expect(html).toContain('href="terms.html"');
    expect(html).toContain('href="refunds.html"');
    expect(html).toContain('href="privacy.html"');
  });

  test('has an unticked newsletter checkbox', function () {
    var m = html.match(/<input[^>]*id="res-newsletter"[^>]*>/);
    expect(m).not.toBeNull();
    expect(m[0]).not.toMatch(/checked/);
    expect(m[0]).not.toMatch(/required/);
  });

  test('the checkboxes sit before the submit button', function () {
    expect(html.indexOf('id="res-terms"')).toBeLessThan(html.indexOf('data-content="submit-btn"'));
  });
});
