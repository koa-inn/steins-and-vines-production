'use strict';

// Phase 68-01 — regression tests for the kiosk terminal-push-latency beacon
// (js/kiosk-core.js). Measures real wall-time from the moment the terminal
// prompt is shown (_kioskPushToTerminal) to the sale-push 202 response, and
// reports it via a NEW fire-and-forget beacon (_kcReportTerminalPushLatency)
// to a NEW sink route (/api/kiosk/telemetry) — deliberately NOT the pinned
// /api/kiosk/client-error beacon (kiosk-client-error-beacon.test.js pins its
// exact 6-key shape; this beacon must never be routed through it).
//
// Harness mirrors kiosk-sale-beacon-servererror.test.js (proceedToPayment
// falls straight to _kioskPushToTerminal when kiosk-payment-items is not
// injected).

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
var TELEMETRY_PATH = '/api/kiosk/telemetry';
var CLIENT_ERROR_PATH = '/api/kiosk/client-error';

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

function telemetryCall() {
  var call = global.fetch.mock.calls.find(function (c) {
    return typeof c[0] === 'string' && c[0].indexOf(TELEMETRY_PATH) !== -1;
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

describe('kiosk terminal-push-latency beacon (68-01)', function () {

  test('a 202-pending sale-push fires a fire-and-forget beacon to /api/kiosk/telemetry (not /api/kiosk/client-error) with a numeric duration + stage', async function () {
    localStorage.setItem(DEVICE_TOKEN_KEY, 'kiosk-token');
    var core = loadSurface('../../js/kiosk.js').core;

    core._setCart({
      P1: { item: { item_id: 'P1', name: 'Test Kit', rate: 25, tax_percentage: 5 }, qty: 1 }
    });

    mockFetchOnce(202, { pending: true, reference: 'KIOSK-1' });
    core.proceedToPayment();
    await flushPromises();

    var t = telemetryCall();
    expect(t).not.toBeNull();
    expect(typeof t.body.duration_ms).toBe('number');
    expect(isFinite(t.body.duration_ms)).toBe(true);
    expect(typeof t.body.stage).toBe('string');
    expect(t.body.stage.length).toBeGreaterThan(0);

    // Must NOT be routed through the pinned client-error beacon shape.
    var clientErrorCall = global.fetch.mock.calls.find(function (c) {
      return typeof c[0] === 'string' && c[0].indexOf(CLIENT_ERROR_PATH) !== -1;
    });
    expect(clientErrorCall).toBeUndefined();
  });

  test('the telemetry beacon rejecting (fetch failure) never throws into the payment flow', async function () {
    localStorage.setItem(DEVICE_TOKEN_KEY, 'kiosk-token');
    var core = loadSurface('../../js/kiosk.js').core;

    core._setCart({
      P1: { item: { item_id: 'P1', name: 'Test Kit', rate: 25, tax_percentage: 5 }, qty: 1 }
    });

    // Sale push succeeds (202 pending); the beacon's own fetch (next call) rejects.
    mockFetchOnce(202, { pending: true, reference: 'KIOSK-2' });
    global.fetch.mockImplementationOnce(function () {
      return Promise.reject(new Error('network down'));
    });

    expect(function () {
      core.proceedToPayment();
    }).not.toThrow();

    await flushPromises();
    // Reaching here without an unhandled rejection/throw is the assertion.
  });
});
