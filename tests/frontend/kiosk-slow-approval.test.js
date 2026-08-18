'use strict';

// Regression: a terminal approval that arrives AFTER the soft poll-timeout
// (POLL_TIMEOUT_MS) must STILL auto-confirm the sale (js/kiosk-core.js).
//
// Production incident (Aug 2026): terminal approvals started landing at ~56s,
// but the poll loop cleared its interval at 45s and only revealed a manual
// "Confirm Manually" button. A late approval was therefore never observed and
// POST /api/kiosk/sale/confirm was never called — the card was charged but no
// Zoho invoice was ever created (charged-but-unbooked orphan). This pins the
// fix: keep polling past the soft timeout and auto-confirm whenever the
// terminal finally reports approved (up to a longer hard cap).
//
// Harness mirrors kiosk-cash-tender.test.js / kiosk-push-latency.test.js.

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
  global.fetch.mockReset();
  global.fetch.mockImplementation(function () {
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({}); } });
  });
});

afterEach(function () {
  jest.useRealTimers();
});

// Drives the standard card-terminal flow: NOT injecting kiosk-payment-items
// makes proceedToPayment fall straight through to _kioskPushToTerminal (same
// as kiosk-push-latency.test.js), so the terminal push + status poll run.
function pushCardSale(core) {
  injectEl('kiosk-payment-amount');
  injectEl('kiosk-terminal-msg');
  injectEl('kiosk-spinner');
  injectEl('kiosk-cancel-payment', 'button');
  injectEl('kiosk-confirm-payment', 'button');
  core._setCart({
    P1: { item: { item_id: 'P1', name: 'Test Kit', rate: 24, tax_percentage: 5 }, qty: 1 }
  });
  core.proceedToPayment();
}

describe('kiosk slow-approval auto-confirm (poll must not stop at the soft timeout)', function () {

  test('an approval arriving ~52s (after the 45s soft timeout) still auto-confirms via /sale/confirm', async function () {
    jest.useFakeTimers();
    localStorage.setItem(DEVICE_TOKEN_KEY, 'kiosk-token');
    var core = loadSurface('../../js/kiosk.js').core;

    var saleStart = Date.now();
    var statusPolls = 0;
    var confirmBody = null;

    global.fetch.mockImplementation(function (url, opts) {
      var u = String(url);
      if (u.indexOf('/api/kiosk/sale/status') !== -1) {
        statusPolls++;
        var elapsed = Date.now() - saleStart;
        // Terminal only reports APPROVED at ~52s — AFTER the 45s soft timeout.
        var body = (elapsed >= 52000)
          ? { status: 'approved', transaction_id: 'TXN-LATE', card_type: 'Visa' }
          : { status: 'pending' };
        return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(body); } });
      }
      if (u.indexOf('/api/kiosk/sale/confirm') !== -1) {
        confirmBody = (opts && opts.body) ? JSON.parse(opts.body) : null;
        return Promise.resolve({ ok: true, status: 201, json: function () { return Promise.resolve({ ok: true, invoice_number: 'INV-LATE' }); } });
      }
      if (u.indexOf('/api/kiosk/sale') !== -1) { // the terminal push (202 pending)
        return Promise.resolve({ ok: true, status: 202, json: function () { return Promise.resolve({ pending: true, reference: 'KIOSK-LATE' }); } });
      }
      return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({}); } });
    });

    pushCardSale(core);
    await jest.advanceTimersByTimeAsync(0); // flush the push chain → poll interval armed

    // Advance ~60s in 3s poll ticks (advanceTimersByTimeAsync flushes microtasks).
    for (var t = 0; t < 60000; t += 3000) {
      await jest.advanceTimersByTimeAsync(3000);
    }

    // Polling continued past the 45s/3s = 15-tick soft timeout...
    expect(statusPolls).toBeGreaterThan(15);
    // ...and the late approval was auto-confirmed (no staff action required).
    expect(confirmBody).not.toBeNull();
    expect(confirmBody.transaction_id).toBe('TXN-LATE');
    // reference_number is client-generated (KIOSK-<timestamp>), not the server echo.
    expect(confirmBody.reference_number).toMatch(/^KIOSK-\d+$/);
  });

  test('polling still stops eventually (hard cap) — a never-approving terminal does not poll forever', async function () {
    jest.useFakeTimers();
    localStorage.setItem(DEVICE_TOKEN_KEY, 'kiosk-token');
    var core = loadSurface('../../js/kiosk.js').core;

    var statusPolls = 0;
    var confirmCalled = false;

    global.fetch.mockImplementation(function (url) {
      var u = String(url);
      if (u.indexOf('/api/kiosk/sale/status') !== -1) {
        statusPolls++;
        return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ status: 'pending' }); } });
      }
      if (u.indexOf('/api/kiosk/sale/confirm') !== -1) {
        confirmCalled = true;
        return Promise.resolve({ ok: true, status: 201, json: function () { return Promise.resolve({ ok: true }); } });
      }
      if (u.indexOf('/api/kiosk/sale') !== -1) {
        return Promise.resolve({ ok: true, status: 202, json: function () { return Promise.resolve({ pending: true, reference: 'KIOSK-STUCK' }); } });
      }
      return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({}); } });
    });

    pushCardSale(core);
    await jest.advanceTimersByTimeAsync(0);

    // Advance well past any reasonable hard cap (5 min).
    for (var t = 0; t < 300000; t += 3000) {
      await jest.advanceTimersByTimeAsync(3000);
    }

    var pollsAtCap = statusPolls;
    // Give it another 30s — polling must have stopped (count frozen).
    for (var t2 = 0; t2 < 30000; t2 += 3000) {
      await jest.advanceTimersByTimeAsync(3000);
    }

    expect(confirmCalled).toBe(false);           // never approved → never booked
    expect(statusPolls).toBe(pollsAtCap);        // polling stopped at the hard cap
  });

});
