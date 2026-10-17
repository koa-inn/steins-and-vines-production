'use strict';

// Phase 92 CR-01 (owner decision 2026-10-16): leaving Customer View requires the
// staff PIN. Both exits ("<- POS" and "Start Purchase ->") show the lock screen;
// only a server-verified PIN returns to the staff POS (browse), with the
// Customer View cart preserved and without re-running showKioskApp's init.

var fs = require('fs');
var path = require('path');

global.window = global.window || {};
global.window.addEventListener = global.window.addEventListener || jest.fn();
global.navigator = global.navigator || { userAgent: 'test' };
global.console = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() };
global.alert = jest.fn();
global.fetch = jest.fn();

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
var KIOSK_HTML = fs.readFileSync(path.join(__dirname, '../../kiosk.html'), 'utf8');

function wait(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function el(id) {
  var node = document.getElementById(id);
  if (!node) throw new Error('expected #' + id);
  return node;
}

function injectRealMarkup() {
  document.body.innerHTML = '';
  var doc = new DOMParser().parseFromString(KIOSK_HTML, 'text/html');
  ['kiosk-browse-mode-btn', 'kiosk-past-sales-btn', 'kiosk-view-past-sales',
    'kiosk-view-browse-customer', 'kiosk-lock-screen'].forEach(function (id) {
    var node = doc.getElementById(id);
    if (!node) throw new Error('kiosk.html is missing #' + id);
    document.body.appendChild(document.importNode(node, true));
  });
  ['browse', 'customer', 'payment', 'receipt', 'collect'].forEach(function (v) {
    var d = document.createElement('div');
    d.id = 'kiosk-view-' + v;
    document.body.appendChild(d);
  });
}

function loadSurface() {
  jest.resetModules();
  if (global.window) delete global.window.KioskCore;
  document.body.innerHTML = '';
  var mod = require('../../js/kiosk.js'); // eslint-disable-line global-require -- per-test isolation
  injectRealMarkup();
  localStorage.setItem(DEVICE_TOKEN_KEY, 'cv-token');
  global.fetch.mockImplementation(function () {
    return Promise.resolve({ ok: false, status: 404, json: function () { return Promise.resolve({}); } });
  });
  mod._initKioskSaleTab(); // fires a discounts-preset fetch; not under test
  global.fetch.mockClear();
  return { mod: mod, core: global.window.KioskCore };
}

function pinResponse(ok) {
  global.fetch.mockImplementation(function (url) {
    if (url.indexOf('/api/kiosk/verify-pin') !== -1) {
      return Promise.resolve({
        ok: ok, status: ok ? 200 : 401,
        json: function () { return Promise.resolve(ok ? { ok: true } : { ok: false, error: 'Incorrect PIN' }); }
      });
    }
    return Promise.resolve({ ok: false, status: 404, json: function () { return Promise.resolve({}); } });
  });
}

function typePin(digits) {
  digits.split('').forEach(function (d) {
    document.querySelector('#kiosk-lock-keypad .kiosk-lock-key[data-digit="' + d + '"]').click();
  });
}

var CART = { 'item-1': { item: { item_id: 'item-1', name: 'Pale Ale kit', rate: 10 }, qty: 2 } };

function enterCustomerView(s) {
  s.core.showView('browse');
  s.core._setCart(JSON.parse(JSON.stringify(CART)));
  el('kiosk-browse-mode-btn').click();
  expect(el('kiosk-view-browse-customer').style.display).toBe('');
  expect(el('kiosk-past-sales-btn').style.display).toBe('none');
}

beforeEach(function () {
  localStorage.clear();
  global.fetch.mockReset();
});

afterEach(function () {
  // the unlock path restarts the 10-minute inactivity timer; drop it
  if (global.window._kioskInactivityCleanup) global.window._kioskInactivityCleanup();
});

describe('CR-01: leaving Customer View requires the staff PIN', function () {
  [['kiosk-cb-back-btn', '<- POS'], ['kiosk-cb-start-purchase-btn', 'Start Purchase']].forEach(function (pair) {
    test(pair[1] + ' shows the lock screen, not the POS or Past Sales', function () {
      var s = loadSurface();
      enterCustomerView(s);
      el(pair[0]).click();
      expect(el('kiosk-lock-screen').style.display).toBe('');
      expect(el('kiosk-view-browse').style.display).toBe('none');
      expect(el('kiosk-past-sales-btn').style.display).toBe('none');
      s.core.showPastSales();
      expect(el('kiosk-view-past-sales').style.display).toBe('none');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test(pair[1] + ' + correct PIN returns to browse with the cart intact and no app re-init', async function () {
      var s = loadSurface();
      enterCustomerView(s);
      pinResponse(true);
      el(pair[0]).click();
      typePin('1234');
      await wait(450);
      expect(el('kiosk-lock-screen').style.display).toBe('none');
      expect(el('kiosk-view-browse').style.display).toBe('');
      expect(el('kiosk-view-browse-customer').style.display).toBe('none');
      expect(el('kiosk-browse-mode-btn').style.display).toBe('');
      expect(el('kiosk-past-sales-btn').style.display).toBe('');
      expect(s.core._getCart()).toEqual(CART);
      var urls = global.fetch.mock.calls.map(function (c) { return c[0]; });
      expect(urls).toEqual(['http://localhost:3001/api/kiosk/verify-pin']);
      expect(global.fetch.mock.calls[0][1].headers['x-device-token']).toBe('cv-token');
    });

    test(pair[1] + ' + wrong PIN stays locked', async function () {
      var s = loadSurface();
      enterCustomerView(s);
      pinResponse(false);
      el(pair[0]).click();
      typePin('9999');
      await wait(450);
      expect(el('kiosk-lock-screen').style.display).toBe('');
      expect(el('kiosk-view-browse').style.display).toBe('none');
      expect(el('kiosk-past-sales-btn').style.display).toBe('none');
      expect(el('kiosk-lock-error').textContent).toBe('Incorrect PIN');
      expect(s.core._getCart()).toEqual(CART);
    });
  });

  test('wrong PIN then correct PIN still lands on browse with the cart', async function () {
    var s = loadSurface();
    enterCustomerView(s);
    pinResponse(false);
    el('kiosk-cb-back-btn').click();
    typePin('9999');
    await wait(800);
    pinResponse(true);
    typePin('1234');
    await wait(450);
    expect(el('kiosk-view-browse').style.display).toBe('');
    expect(s.core._getCart()).toEqual(CART);
  });

  test('the lock screen shown on exit still clears Past Sales', function () {
    var s = loadSurface();
    s.core.showView('browse');
    var spy = jest.spyOn(s.core, 'clearPastSales');
    el('kiosk-browse-mode-btn').click();
    spy.mockClear();
    el('kiosk-cb-back-btn').click();
    expect(spy).toHaveBeenCalled();
  });
});
