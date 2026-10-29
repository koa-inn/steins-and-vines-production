'use strict';

// Phase 100 D-02 (Plan 09): kiosk shows the deposit badge on limited-release
// SOs and previews the remainder (GET /api/kiosk/salesorder-due) before the
// salesorder-pay POST. The preview is display-only; a failing preview must not
// stop the pay POST.

global.window = global.window || {};
global.window.addEventListener = global.window.addEventListener || jest.fn();
global.navigator = global.navigator || { userAgent: 'test' };
global.console = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() };
global.fetch = jest.fn();
global.alert = jest.fn();
global.Image = global.Image || jest.fn(function () { return {}; });
global.MutationObserver = global.MutationObserver || jest.fn(function () {
  return { observe: jest.fn(), disconnect: jest.fn() };
});
global.IntersectionObserver = global.IntersectionObserver || jest.fn(function () {
  return { observe: jest.fn(), disconnect: jest.fn(), unobserve: jest.fn() };
});
global.google = { accounts: { oauth2: { initTokenClient: jest.fn(function () { return { requestAccessToken: jest.fn() }; }) } } };
global.SHEETS_CONFIG = {
  MIDDLEWARE_URL: 'http://mw.test',
  MW_API_KEY: 'test-api-key',
  SPREADSHEET_ID: 'test-id',
  GOOGLE_CLIENT_ID: 'test-client-id',
  STAFF_EMAILS: 'test@example.com',
  API_BASE: 'https://script.google.com/test',
  SERVER_TOKEN: 'test-token'
};

var DEVICE_TOKEN_KEY = 'sv_kiosk_device_token';

function loadSurface() {
  jest.resetModules();
  if (global.window) delete global.window.KioskCore;
  document.body.innerHTML =
    '<div id="kiosk-so-list"></div>' +
    '<div id="kiosk-payment-amount"></div>' +
    '<div id="kiosk-terminal-msg"></div>' +
    '<div id="kiosk-spinner"></div>' +
    '<div id="kiosk-payment-items"></div>' +
    '<button id="kiosk-cancel-payment"></button>';
  require('../../js/kiosk.js'); // eslint-disable-line global-require
  return global.window.KioskCore;
}

function flush() {
  return new Promise(function (resolve) { setTimeout(resolve, 0); });
}

function jsonRes(status, body) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status: status, json: function () { return Promise.resolve(body); } });
}

var LIMITED_SO = {
  salesorder_id: 'SO-L', salesorder_number: 'SO-00200', balance: 280, total: 280, status: 'open',
  customer_name: 'Pat', reference_number: 'LIMITED-2026-27', is_limited_release: true, line_items: []
};
var PLAIN_SO = {
  salesorder_id: 'SO-P', salesorder_number: 'SO-00201', balance: 40, total: 40, status: 'open',
  customer_name: 'Sam', reference_number: '', is_limited_release: false, line_items: []
};

function seed(core) {
  global.fetch.mockImplementation(function () { return jsonRes(200, { salesorders: [LIMITED_SO, PLAIN_SO] }); });
  core.loadSalesOrders();
  return flush().then(function () { global.fetch.mockReset(); });
}

beforeEach(function () {
  localStorage.clear();
  localStorage.setItem(DEVICE_TOKEN_KEY, 'tok');
  global.fetch.mockReset();
});

describe('kiosk limited-release deposit display', function () {
  test('badge renders only on the limited-release card', function () {
    var core = loadSurface();
    return seed(core).then(function () {
      var cards = document.querySelectorAll('.kiosk-so-card');
      expect(cards.length).toBe(2);
      var badges = document.querySelectorAll('.kiosk-so-limited');
      expect(badges.length).toBe(1);
      expect(badges[0].textContent).toBe('Limited release · $50 deposit held');
      expect(badges[0].closest('.kiosk-so-card').getAttribute('data-so-id')).toBe('SO-L');
    });
  });

  test('preview is requested before the pay POST and shows the remainder', function () {
    var core = loadSurface();
    core.setTerminalStatus(true, 'Terminal ready');
    return seed(core).then(function () {
      global.fetch.mockImplementation(function (url) {
        if (url.indexOf('/api/kiosk/salesorder-due') !== -1) {
          return jsonRes(200, { salesorder_id: 'SO-L', is_limited_release: true, base: 280, deposit_applied: 50, due: 230 });
        }
        return new Promise(function () {}); // pay stays pending
      });
      core.collectPayment('SO-L');
      return flush();
    }).then(function () {
      var urls = global.fetch.mock.calls.map(function (c) { return c[0]; });
      expect(urls[0]).toContain('/api/kiosk/salesorder-due?salesorder_id=SO-L');
      expect(urls[1]).toContain('/api/kiosk/salesorder-pay');
      expect(document.getElementById('kiosk-payment-amount').textContent).toContain('230.00');
      expect(document.getElementById('kiosk-payment-items').textContent).toContain('Deposit applied');
      expect(document.getElementById('kiosk-payment-items').textContent).toContain('-$50.00');
    });
  });

  test('a failing preview still issues the pay POST with a neutral deposit line', function () {
    var core = loadSurface();
    core.setTerminalStatus(true, 'Terminal ready');
    return seed(core).then(function () {
      global.fetch.mockImplementation(function (url) {
        if (url.indexOf('/api/kiosk/salesorder-due') !== -1) return Promise.reject(new Error('network'));
        return new Promise(function () {});
      });
      core.collectPayment('SO-L');
      return flush();
    }).then(function () {
      var urls = global.fetch.mock.calls.map(function (c) { return c[0]; });
      expect(urls.some(function (u) { return u.indexOf('/api/kiosk/salesorder-pay') !== -1; })).toBe(true);
      expect(document.getElementById('kiosk-payment-items').textContent).toContain('applied at payment');
    });
  });

  test('non-limited order makes no preview request', function () {
    var core = loadSurface();
    core.setTerminalStatus(true, 'Terminal ready');
    return seed(core).then(function () {
      global.fetch.mockImplementation(function () { return new Promise(function () {}); });
      core.collectPayment('SO-P');
      var urls = global.fetch.mock.calls.map(function (c) { return c[0]; });
      expect(urls.length).toBe(1);
      expect(urls[0]).toContain('/api/kiosk/salesorder-pay');
    });
  });
});
