'use strict';

// Phase 57-03 Task 2 — regression tests for the kiosk sale SERVER-ERROR beacon
// (js/kiosk-core.js), closing the two 57-DIAGNOSIS.md "Beacon findings":
//   1. The catalog-miss 400 (pos.js:325-333) is handled in the sale push
//      `.then(result)` branch, NOT the network `.catch` the 57-01 beacon was
//      wired into — so 57-01 never captured this failure class.
//   2. The offending item_id (a 19-digit Zoho id) collides with the beacon's
//      13-19-digit PAN-redaction heuristic, so even if it HAD been captured
//      as free text it would have logged "[REDACTED]" — destroying the one
//      field that made the diagnosis possible.
//
// Contract these tests pin:
//   Test A — a non-202 sale-push result now beacons with the real endpoint,
//            http_status, and message.
//   Test B — the beacon payload carries the offending item_id as its OWN
//            structured field (not just inside the free-text message).
//
// Harness mirrors kiosk-client-error-beacon.test.js / kiosk-core-parity.test.js
// (proceedToPayment falls straight to _kioskPushToTerminal when
// kiosk-payment-items is not injected).

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
var BEACON_PATH = '/api/kiosk/client-error';

function loadSurface(p) {
  jest.resetModules();
  if (global.window) delete global.window.KioskCore;
  document.body.innerHTML = '';
  var mod = require(p); // eslint-disable-line global-require -- intentional per-surface isolation
  return { mod: mod, core: global.window.KioskCore };
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

function beaconCall() {
  var call = global.fetch.mock.calls.find(function (c) {
    return typeof c[0] === 'string' && c[0].indexOf(BEACON_PATH) !== -1;
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

describe('kiosk sale server-error beacon (57-03, client half of 57-DIAGNOSIS beacon findings)', function () {

  test('Test A: a non-202 sale result beacons endpoint /api/kiosk/sale with the real status + message', async function () {
    localStorage.setItem(DEVICE_TOKEN_KEY, 'kiosk-token');
    var core = loadSurface('../../js/kiosk.js').core;

    core._setCart({
      // 67-02: fixture carries an explicit tax_percentage — a missing one now
      // fail-closed-blocks checkout before the sale POST this test needs.
      P1: { item: { item_id: 'P1', name: 'Test Kit', rate: 25, tax_percentage: 5 }, qty: 1 }
    });

    // The captured catalog-miss 400 (57-DIAGNOSIS.md), no `pending` flag.
    mockFetchOnce(400, { error: 'Item not found in current catalog: 1099000000000109115. Refresh the product list and try again.' });
    core.proceedToPayment();
    await flushPromises();

    var b = beaconCall();
    expect(b).not.toBeNull();
    expect(b.body.endpoint).toBe('/api/kiosk/sale');
    expect(b.body.http_status).toBe(400);
    expect(b.body.message).toContain('Item not found in current catalog');
  });

  test('Test B: the beacon payload carries the offending item_id as a structured field', async function () {
    localStorage.setItem(DEVICE_TOKEN_KEY, 'kiosk-token');
    var core = loadSurface('../../js/kiosk.js').core;

    core._setCart({
      // 67-02: fixture carries an explicit tax_percentage — a missing one now
      // fail-closed-blocks checkout before the sale POST this test needs.
      P1: { item: { item_id: 'P1', name: 'Test Kit', rate: 25, tax_percentage: 5 }, qty: 1 }
    });

    mockFetchOnce(400, { error: 'Item not found in current catalog: 1099000000000109115. Refresh the product list and try again.' });
    core.proceedToPayment();
    await flushPromises();

    var b = beaconCall();
    expect(b).not.toBeNull();
    expect(b.body.item_id).toBe('1099000000000109115');
  });
});
