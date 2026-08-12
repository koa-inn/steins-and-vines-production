'use strict';

// Phase 68-02 — client-side cancel/orphan-charge safety regression tests
// (js/kiosk-core.js). Two behaviours pinned:
//
//   (a) The terminal-cancel POST to /api/pos/cancel now carries a JSON body
//       with reference_number set to the SAME refNumber used for the sale
//       push — this is what lets the server (routes/pos.js) write the
//       KIOSK_CANCELLED_PREFIX flag the webhook void path checks.
//
//   (b) The 'Tap, insert, or swipe card...' terminal prompt is no longer
//       shown immediately (the "reader isn't picking up" perception bug) —
//       a neutral 'Contacting terminal…' message shows before the sale-push
//       fetch resolves, and the tap prompt is only set once the server
//       confirms 202 pending (push actually sent).
//
// Harness mirrors kiosk-push-latency.test.js / kiosk-sale-beacon-servererror.test.js
// (proceedToPayment falls straight to _kioskPushToTerminal when
// kiosk-payment-items is not injected). Unlike those two files, this suite
// DOES inject the terminal-msg/cancel-button DOM nodes so message text and
// the cancel handler's POST body can be asserted directly.

global.window = global.window || {};
global.navigator = global.navigator || { userAgent: 'test-iPad' };
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
var CANCEL_PATH = '/api/pos/cancel';
var SALE_PATH = '/api/kiosk/sale';

function loadSurface(p) {
  jest.resetModules();
  if (global.window) delete global.window.KioskCore;
  document.body.innerHTML = '';
  var mod = require(p); // eslint-disable-line global-require -- intentional per-surface isolation
  return { mod: mod, core: global.window.KioskCore };
}

// Injects the payment-view DOM nodes _kioskPushToTerminal reads/writes —
// none of these are created dynamically by kiosk-core.js, they live in the
// static kiosk.html markup which this jsdom harness does not load.
function injectPaymentViewDom() {
  document.body.innerHTML =
    '<div id="kiosk-payment-amount"></div>' +
    '<div id="kiosk-terminal-msg"></div>' +
    '<div id="kiosk-spinner"></div>' +
    '<button id="kiosk-cancel-payment"></button>' +
    '<button id="kiosk-confirm-payment"></button>';
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

function flushPromises() {
  return new Promise(function (resolve) { setTimeout(resolve, 0); });
}

function findCall(pathFragment) {
  var call = global.fetch.mock.calls.find(function (c) {
    return typeof c[0] === 'string' && c[0].indexOf(pathFragment) !== -1;
  });
  if (!call) return null;
  var opts = call[1] || {};
  return { url: call[0], opts: opts, body: opts.body ? JSON.parse(opts.body) : null };
}

beforeEach(function () {
  localStorage.clear();
  global.fetch.mockReset();
  global.fetch.mockImplementation(function () {
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({}); } });
  });
});

describe('kiosk cancel/orphan-charge client safety (68-02)', function () {

  test('(a) the terminal-cancel POST to /api/pos/cancel includes reference_number matching the sale ref', async function () {
    localStorage.setItem(DEVICE_TOKEN_KEY, 'kiosk-token');
    var core = loadSurface('../../js/kiosk.js').core;
    injectPaymentViewDom();

    core._setCart({
      P1: { item: { item_id: 'P1', name: 'Test Kit', rate: 25, tax_percentage: 5 }, qty: 1 }
    });

    mockFetchOnce(202, { pending: true, reference: 'KIOSK-CANCEL-A1' });
    core.proceedToPayment();
    await flushPromises();

    var saleCall = findCall(SALE_PATH);
    expect(saleCall).not.toBeNull();
    var refNumber = saleCall.body.reference_number;
    expect(typeof refNumber).toBe('string');
    expect(refNumber.length).toBeGreaterThan(0);

    var cancelBtn = document.getElementById('kiosk-cancel-payment');
    expect(typeof cancelBtn.onclick).toBe('function');

    mockFetchOnce(200, { ok: false, device_cancel_required: true });
    cancelBtn.onclick();
    await flushPromises();

    var cancelCall = findCall(CANCEL_PATH);
    expect(cancelCall).not.toBeNull();
    expect(cancelCall.body).not.toBeNull();
    expect(cancelCall.body.reference_number).toBe(refNumber);
  });

  test('(b) the tap-card prompt is NOT shown before the sale-push 202 response — only a neutral message', async function () {
    localStorage.setItem(DEVICE_TOKEN_KEY, 'kiosk-token');
    var core = loadSurface('../../js/kiosk.js').core;
    injectPaymentViewDom();

    core._setCart({
      P1: { item: { item_id: 'P1', name: 'Test Kit', rate: 25, tax_percentage: 5 }, qty: 1 }
    });

    var resolveSale;
    global.fetch.mockImplementationOnce(function () {
      return new Promise(function (resolve) { resolveSale = resolve; });
    });

    core.proceedToPayment();

    // Synchronous check: the sale-push fetch has not resolved yet.
    var msgEl = document.getElementById('kiosk-terminal-msg');
    expect(msgEl.textContent).not.toMatch(/Tap, insert, or swipe/);
    expect(msgEl.textContent).toMatch(/Contacting terminal/i);

    resolveSale({
      ok: true,
      status: 202,
      json: function () { return Promise.resolve({ pending: true, reference: 'KIOSK-CANCEL-B1' }); }
    });
    await flushPromises();

    expect(msgEl.textContent).toMatch(/Tap, insert, or swipe/);
  });
});
