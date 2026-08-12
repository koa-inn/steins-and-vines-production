'use strict';

// Phase 70-02 (KIOSK-MOTO) — regression tests for the kiosk phone-order
// (card-not-present) tender + HelcimPay hosted-iframe mount (js/kiosk-core.js).
//
// Contract these tests pin:
//   1. A "Phone Order" tender control is present in the payment panel
//      (kgcr-moto-btn) and there is NO card-number input anywhere (PCI).
//   2. Selecting it POSTs /api/kiosk/sale with tender:'moto', receives
//      {moto:true, checkout_token}, and calls the GLOBAL
//      appendHelcimPayIframe(checkout_token) — with NO fetch to
//      /api/payment/initialize (the token already came from /sale).
//   3. A postMessage from a FOREIGN origin (not secure.helcim.app /
//      myhelcim.com) is IGNORED (no confirm fetch).
//   4. A SUCCESS postMessage from a valid origin with the matching eventName
//      token → confirmSale with tender:'moto' and the extracted txn id.
//   5. An ABORTED postMessage removes the iframe and returns to tender
//      selection (no confirm fetch).
//
// Harness mirrors kiosk-cash-tender.test.js (loadSurface + flushPromises).

global.window = global.window || {};
global.navigator = global.navigator || { userAgent: 'test' };
global.console = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() };
global.fetch = jest.fn(function () {
  return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({}); } });
});
global.alert = jest.fn();

// The HelcimPay.js start.js <script> (added to kiosk.html in Task 3) injects
// these as page globals; stub them so kiosk-core's bare-global references and
// `typeof appendHelcimPayIframe` checks resolve in jsdom.
global.appendHelcimPayIframe = jest.fn();
global.removeHelcimPayIframe = jest.fn();

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

// Build a Helcim SUCCESS postMessage payload for a given checkout token. The
// eventMessage wraps the txn id as { data: { data: { transactionId } } }.
function helcimSuccessMessage(token, txnId) {
  return {
    eventName: 'helcim-pay-js-' + token,
    eventStatus: 'SUCCESS',
    eventMessage: { data: { data: { transactionId: txnId } } }
  };
}

function dispatchHelcimMessage(origin, data) {
  window.dispatchEvent(new MessageEvent('message', { origin: origin, data: data }));
}

beforeEach(function () {
  localStorage.clear();
  global.fetch.mockReset();
  global.fetch.mockImplementation(function () {
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({}); } });
  });
  global.appendHelcimPayIframe.mockReset();
  global.removeHelcimPayIframe.mockReset();
});

function setUpAtPayment() {
  localStorage.setItem(DEVICE_TOKEN_KEY, 'kiosk-moto-token');
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

describe('kiosk MOTO (phone-order card-not-present) tender (70-02 / KIOSK-MOTO)', function () {

  test('a Phone Order tender control is present in the payment panel', function () {
    setUpAtPayment();
    var motoBtn = document.getElementById('kgcr-moto-btn');
    expect(motoBtn).toBeTruthy();
  });

  test('NO card-number input exists anywhere in the payment DOM (PCI)', function () {
    setUpAtPayment();
    // No tel inputs, and no input whose id/name/placeholder hints at a card
    // number — the PAN is only ever entered inside Helcim's own iframe.
    var inputs = document.querySelectorAll('input');
    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i];
      expect((el.getAttribute('type') || '').toLowerCase()).not.toBe('tel');
      var hay = ((el.id || '') + ' ' + (el.name || '') + ' ' + (el.placeholder || '')).toLowerCase();
      expect(hay).not.toContain('card-number');
      expect(hay).not.toContain('cardnumber');
      expect(hay).not.toContain('card number');
    }
  });

  test('selecting Phone Order POSTs /api/kiosk/sale with tender:moto and mounts the HelcimPay iframe — no /api/payment/initialize fetch', async function () {
    setUpAtPayment();

    mockFetchOnce(202, { pending: false, moto: true, checkout_token: 'tok-moto-abc', reference: 'KIOSK-MOTO-T1' });

    document.getElementById('kgcr-moto-btn').onclick();
    await flushPromises();

    var saleCall = global.fetch.mock.calls.find(function (c) {
      return typeof c[0] === 'string' && c[0].indexOf('/api/kiosk/sale') !== -1 && c[0].indexOf('/confirm') === -1;
    });
    expect(saleCall).toBeTruthy();
    var saleBody = JSON.parse(saleCall[1].body);
    expect(saleBody.tender).toBe('moto');
    // Routes through _kcMergeAuth (device-token header, no credentials leak).
    expect(saleCall[1].headers['x-device-token']).toBe('kiosk-moto-token');
    expect(saleCall[1].credentials).toBeUndefined();

    // Iframe mounted with the token from the /sale response — no second init fetch.
    expect(global.appendHelcimPayIframe).toHaveBeenCalledWith('tok-moto-abc');
    var initCall = global.fetch.mock.calls.find(function (c) {
      return typeof c[0] === 'string' && c[0].indexOf('/api/payment/initialize') !== -1;
    });
    expect(initCall).toBeFalsy();
  });

  test('a postMessage from a FOREIGN origin is IGNORED (no confirm fetch)', async function () {
    setUpAtPayment();

    mockFetchOnce(202, { pending: false, moto: true, checkout_token: 'tok-moto-foreign', reference: 'KIOSK-MOTO-T2' });
    document.getElementById('kgcr-moto-btn').onclick();
    await flushPromises();

    // Correct eventName token + SUCCESS, but from an attacker origin.
    dispatchHelcimMessage('https://evil.example.com', helcimSuccessMessage('tok-moto-foreign', 'txn-should-be-ignored'));
    await flushPromises();

    var confirmCall = global.fetch.mock.calls.find(function (c) {
      return typeof c[0] === 'string' && c[0].indexOf('/api/kiosk/sale/confirm') !== -1;
    });
    expect(confirmCall).toBeFalsy();
  });

  test('a valid SUCCESS postMessage → confirmSale with tender:moto and the extracted txn id', async function () {
    setUpAtPayment();

    mockFetchOnce(202, { pending: false, moto: true, checkout_token: 'tok-moto-ok', reference: 'KIOSK-MOTO-T3' });
    document.getElementById('kgcr-moto-btn').onclick();
    await flushPromises();

    mockFetchOnce(201, { ok: true, invoice_id: 'inv-moto', invoice_number: 'INV-MOTO', total: 100 });
    dispatchHelcimMessage('https://secure.helcim.app', helcimSuccessMessage('tok-moto-ok', 'txn-moto-verified-1'));
    await flushPromises();

    expect(global.removeHelcimPayIframe).toHaveBeenCalled();

    var confirmCall = global.fetch.mock.calls.find(function (c) {
      return typeof c[0] === 'string' && c[0].indexOf('/api/kiosk/sale/confirm') !== -1;
    });
    expect(confirmCall).toBeTruthy();
    var confirmBody = JSON.parse(confirmCall[1].body);
    expect(confirmBody.tender).toBe('moto');
    expect(confirmBody.transaction_id).toBe('txn-moto-verified-1');
    expect(confirmCall[1].headers['x-device-token']).toBe('kiosk-moto-token');
  });

  test('WR-02: the MOTO /sale idempotency_key is tender-scoped (refNumber:moto) so a tender switch after an abort starts a clean idempotency scope', async function () {
    setUpAtPayment();

    mockFetchOnce(202, { pending: false, moto: true, checkout_token: 'tok-moto-idem', reference: 'KIOSK-MOTO-IDEM' });
    document.getElementById('kgcr-moto-btn').onclick();
    await flushPromises();

    var saleCall = global.fetch.mock.calls.find(function (c) {
      return typeof c[0] === 'string' && c[0].indexOf('/api/kiosk/sale') !== -1 && c[0].indexOf('/confirm') === -1;
    });
    expect(saleCall).toBeTruthy();
    var saleBody = JSON.parse(saleCall[1].body);
    // The key is suffixed with the tender so switching to cash/terminal after an
    // aborted MOTO attempt does NOT replay the cached moto /sale response.
    expect(saleBody.idempotency_key).toMatch(/:moto$/);
    expect(saleBody.idempotency_key).toBe(saleBody.reference_number + ':moto');
  });

  test('an ABORTED postMessage removes the iframe and does NOT confirm the sale', async function () {
    setUpAtPayment();

    mockFetchOnce(202, { pending: false, moto: true, checkout_token: 'tok-moto-abort', reference: 'KIOSK-MOTO-T4' });
    document.getElementById('kgcr-moto-btn').onclick();
    await flushPromises();

    dispatchHelcimMessage('https://secure.helcim.app', {
      eventName: 'helcim-pay-js-tok-moto-abort',
      eventStatus: 'ABORTED'
    });
    await flushPromises();

    expect(global.removeHelcimPayIframe).toHaveBeenCalled();
    var confirmCall = global.fetch.mock.calls.find(function (c) {
      return typeof c[0] === 'string' && c[0].indexOf('/api/kiosk/sale/confirm') !== -1;
    });
    expect(confirmCall).toBeFalsy();
  });

});
