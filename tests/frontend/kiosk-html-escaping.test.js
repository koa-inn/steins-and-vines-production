'use strict';

// Regression tests for HTML escaping of product names on the kiosk MONEY screens
// (js/kiosk-core.js).
//
// AUDIT FINDING M-C1 (AUDIT-2026-06-29, re-verified 2026-07-13):
//   kioskProceedToPayment() and kioskShowReceipt() interpolate `it.name` RAW into
//   innerHTML:
//       html += '<span>' + (it.name || '') + ' x' + (it.quantity || 1) + '</span>';
//   ...while the very same file calls escapeHTML() 89 times, including two lines
//   below the payment-screen bug (the discount name IS escaped) and on the
//   sales-order screen (`escapeHTML(it.name)`). It is an oversight, not a policy.
//
// WHY IT MATTERS: the source is staff-entered (a Zoho product name), so this is
// defense-in-depth rather than a public XSS hole. But these are the two screens
// where staff read back the AMOUNT before taking money. A product name containing
// markup silently corrupts the amount-confirmation layout at exactly the moment a
// human is checking what they are about to charge — an operational hazard, not a
// cosmetic one.
//
// PHASE 48 DE-FORK IMPACT: this code moved from js/kiosk.js into the SHARED
// js/kiosk-core.js and was carried through unfixed, so it now renders on BOTH
// kiosk.html and admin.html. The fix lands on both surfaces at once.
//
// Contract these tests pin: a product name is NEVER interpreted as markup on the
// payment screen or the receipt — it is displayed as literal text.
//
// Harness mirrors kiosk-load-recovery.test.js.

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

// A product name that is valid text but, if interpolated raw, becomes MARKUP.
// The <img onerror> is the canonical injection probe; the trailing <b> proves the
// layout-corruption half of the finding (an unclosed/steering tag reflows the row).
var HOSTILE_NAME = '<img src=x onerror="window.__kioskPwned=1">Merlot <b>Kit';

function loadSurface(path) {
  jest.resetModules();
  if (global.window) delete global.window.KioskCore;
  document.body.innerHTML = '';
  var mod = require(path); // eslint-disable-line global-require -- intentional per-surface isolation
  return { mod: mod, core: global.window.KioskCore };
}

function injectEl(id, tag) {
  var el = document.createElement(tag || 'div');
  el.id = id;
  document.body.appendChild(el);
  return el;
}

beforeEach(function () {
  localStorage.clear();
  delete global.window.__kioskPwned;
  // mockReset (not mockClear): drains queued one-shot impls so a failing test
  // cannot leak a pending mock into the next one.
  global.fetch.mockReset();
  global.fetch.mockImplementation(function () {
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({}); } });
  });
});

describe('kiosk money screens must never interpret a product name as markup (M-C1)', function () {

  test('showReceipt() escapes the product name — no injected element, literal text preserved', function () {
    localStorage.setItem(DEVICE_TOKEN_KEY, 'kiosk-token');
    var core = loadSurface('../../js/kiosk.js').core;
    var body = injectEl('kiosk-receipt-body');

    core.showReceipt(
      { total: 42.5, invoice_number: 'INV-000999' },
      { tax: 0, total: 42.5, discount: 0 },
      [{ name: HOSTILE_NAME, quantity: 1, rate: 42.5 }],
      []
    );

    // The injection must not have become a DOM element.
    expect(body.querySelector('img')).toBeNull();
    expect(body.querySelector('b')).toBeNull();
    expect(global.window.__kioskPwned).toBeUndefined();

    // ...and the name must still be READABLE by staff, as literal text.
    expect(body.textContent).toContain('Merlot');
    expect(body.textContent).toContain('<img');
  });

  test('proceedToPayment() escapes the product name on the amount-confirmation screen', function () {
    localStorage.setItem(DEVICE_TOKEN_KEY, 'kiosk-token');
    var core = loadSurface('../../js/kiosk.js').core;

    injectEl('kiosk-payment-amount');
    injectEl('kiosk-terminal-msg');
    injectEl('kiosk-spinner');
    var itemsEl = injectEl('kiosk-payment-items');
    injectEl('kiosk-cancel-payment', 'button');

    // The terminal call must never resolve — we assert the SYNCHRONOUS render that
    // happens before it, so no charge is ever simulated.
    global.fetch.mockImplementation(function () { return new Promise(function () {}); });

    core._setCart({
      P1: {
        item: { item_id: 'P1', name: HOSTILE_NAME, rate: 42.5 },
        qty: 1
      }
    });

    core.proceedToPayment();

    // The items list is rendered synchronously, before the terminal is touched.
    expect(itemsEl.querySelector('img')).toBeNull();
    expect(itemsEl.querySelector('b')).toBeNull();
    expect(global.window.__kioskPwned).toBeUndefined();

    expect(itemsEl.textContent).toContain('Merlot');
    expect(itemsEl.textContent).toContain('<img');
  });

});
