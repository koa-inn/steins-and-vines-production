'use strict';

// Phase 70-01 (KIOSK-CASH) — regression tests for the kiosk Cash tender +
// change-due UI (js/kiosk-core.js).
//
// Contract these tests pin:
//   1. A Cash tender control is present in the payment panel (kgcr-cash-btn).
//   2. Selecting Cash reveals the change-due sub-panel (tendered input +
//      display-only change field); Complete is disabled while
//      tendered < cashRemainder and enabled once tendered >= cashRemainder.
//   3. Pressing Complete POSTs /api/kiosk/sale with tender:'cash', then
//      confirmSale with tender:'cash' and NO transaction_id — the tendered
//      and change values appear in NEITHER request body.
//   4. Every new fetch routes through _kcMergeAuth (x-device-token header
//      present, no credentials:'include' leak on the standalone kiosk).
//
// Harness mirrors kiosk-catalog-freshness.test.js's Test D (GC tender panel
// injection via kiosk-payment-items + proceedToPayment) and
// kiosk-push-latency.test.js's mockFetchOnce/flushPromises idiom.

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

beforeEach(function () {
  localStorage.clear();
  global.fetch.mockReset();
  global.fetch.mockImplementation(function () {
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({}); } });
  });
});

// Sets up a standalone-kiosk surface with a single-item cart at the payment
// screen, GC/cash panel injected (kiosk-payment-items has a parentNode).
function setUpAtPayment() {
  localStorage.setItem(DEVICE_TOKEN_KEY, 'kiosk-cash-token');
  var core = loadSurface('../../js/kiosk.js').core;
  injectEl('kiosk-payment-items');
  injectEl('kiosk-payment-amount');
  injectEl('kiosk-terminal-msg');
  injectEl('kiosk-spinner');
  injectEl('kiosk-cancel-payment', 'button');
  injectEl('kiosk-confirm-payment', 'button');

  core._setCart({
    P1: { item: { item_id: 'P1', name: 'Test Kit', rate: 100, tax_percentage: 0 }, qty: 1 }
  });

  var totals = core.calcTotals();
  core.proceedToPayment();
  return { core: core, totals: totals };
}

describe('kiosk Cash tender + change-due UI (70-01 / KIOSK-CASH)', function () {

  test('a Cash tender control is present in the payment panel', function () {
    setUpAtPayment();
    var cashBtn = document.getElementById('kgcr-cash-btn');
    expect(cashBtn).toBeTruthy();
  });

  test('selecting Cash reveals the change-due sub-panel; Complete disabled while tendered < remainder, enabled at >= remainder', function () {
    var setup = setUpAtPayment();
    var cashBtn = document.getElementById('kgcr-cash-btn');
    cashBtn.onclick();

    var cashPanel = document.getElementById('kgcr-cash-panel');
    var tenderedInput = document.getElementById('kcash-tendered');
    var completeBtn = document.getElementById('kcash-complete-btn');
    var changeEl = document.getElementById('kcash-change');

    expect(cashPanel.style.display).not.toBe('none');
    expect(completeBtn.disabled).toBe(true);

    // Under-tender: still disabled.
    tenderedInput.value = (setup.totals.total - 1).toFixed(2);
    tenderedInput.oninput();
    expect(completeBtn.disabled).toBe(true);
    expect(changeEl.textContent).toBe('$0.00');

    // Exact tender: enabled, change is $0.00.
    tenderedInput.value = setup.totals.total.toFixed(2);
    tenderedInput.oninput();
    expect(completeBtn.disabled).toBe(false);
    expect(changeEl.textContent).toBe('$0.00');

    // Over-tender: still enabled, change reflects the difference.
    tenderedInput.value = (setup.totals.total + 20).toFixed(2);
    tenderedInput.oninput();
    expect(completeBtn.disabled).toBe(false);
    expect(changeEl.textContent).toBe('$20.00');
  });

  test('pressing Complete POSTs /api/kiosk/sale with tender:cash then confirms with tender:cash and NO transaction_id; tendered/change are never sent', async function () {
    var setup = setUpAtPayment();

    document.getElementById('kgcr-cash-btn').onclick();
    var tenderedInput = document.getElementById('kcash-tendered');
    tenderedInput.value = (setup.totals.total + 20).toFixed(2); // tender $20 over
    tenderedInput.oninput();

    mockFetchOnce(202, { pending: false, cash: true, reference: 'KIOSK-CASH-TEST-1' });
    mockFetchOnce(201, { ok: true, invoice_id: 'inv-1', invoice_number: 'INV-1', total: setup.totals.total });

    document.getElementById('kcash-complete-btn').onclick();
    await flushPromises();

    var saleCall = global.fetch.mock.calls.find(function (c) {
      return typeof c[0] === 'string' && c[0].indexOf('/api/kiosk/sale') !== -1 && c[0].indexOf('/confirm') === -1;
    });
    expect(saleCall).toBeTruthy();
    var saleBody = JSON.parse(saleCall[1].body);
    expect(saleBody.tender).toBe('cash');
    expect(saleBody.tendered).toBeUndefined();
    expect(saleBody.change).toBeUndefined();

    var confirmCall = global.fetch.mock.calls.find(function (c) {
      return typeof c[0] === 'string' && c[0].indexOf('/api/kiosk/sale/confirm') !== -1;
    });
    expect(confirmCall).toBeTruthy();
    var confirmBody = JSON.parse(confirmCall[1].body);
    expect(confirmBody.tender).toBe('cash');
    expect(confirmBody.transaction_id).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(confirmBody, 'transaction_id')).toBe(false);
    expect(confirmBody.tendered).toBeUndefined();
    expect(confirmBody.change).toBeUndefined();
  });

  test('both the /sale and /confirm cash fetches route through _kcMergeAuth (x-device-token present, no credentials:"include")', async function () {
    var setup = setUpAtPayment();

    document.getElementById('kgcr-cash-btn').onclick();
    var tenderedInput = document.getElementById('kcash-tendered');
    tenderedInput.value = setup.totals.total.toFixed(2);
    tenderedInput.oninput();

    mockFetchOnce(202, { pending: false, cash: true, reference: 'KIOSK-CASH-TEST-2' });
    mockFetchOnce(201, { ok: true, invoice_id: 'inv-2', invoice_number: 'INV-2', total: setup.totals.total });

    document.getElementById('kcash-complete-btn').onclick();
    await flushPromises();

    var kioskSaleCalls = global.fetch.mock.calls.filter(function (c) {
      return typeof c[0] === 'string' && c[0].indexOf('/api/kiosk/sale') !== -1;
    });
    expect(kioskSaleCalls.length).toBe(2);
    kioskSaleCalls.forEach(function (c) {
      var opts = c[1];
      expect(opts.headers['x-device-token']).toBe('kiosk-cash-token');
      expect(opts.credentials).toBeUndefined();
    });
  });

});
