'use strict';

// Phase 100 staging-run fix: the SO card is the only amount staff see before
// Collect pushes to the terminal. For limited-release SOs it must show the
// deposit-aware remainder (amount_due from /api/kiosk/salesorders), and
// "Import to Cart" must not be offered (the cart path is not deposit-aware and
// would charge the full kit price).

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
  salesorder_id: 'SO-L', salesorder_number: 'SO-000086', balance: 252.85, total: 252.85, status: 'draft',
  customer_name: 'Pat', reference_number: 'LIMITED-2026-27', is_limited_release: true,
  deposit_held: 50, amount_due: 202.85, line_items: []
};
var LIMITED_NO_DUE = {
  salesorder_id: 'SO-N', salesorder_number: 'SO-000087', balance: 262.85, total: 262.85, status: 'draft',
  customer_name: 'Lee', reference_number: 'LIMITED-2026-27', is_limited_release: true, line_items: []
};
var PLAIN_SO = {
  salesorder_id: 'SO-P', salesorder_number: 'SO-00201', balance: 40, total: 40, status: 'open',
  customer_name: 'Sam', reference_number: '', is_limited_release: false, line_items: []
};

function seed(core, rows) {
  global.fetch.mockImplementation(function () { return jsonRes(200, { salesorders: rows }); });
  core.loadSalesOrders();
  return flush().then(function () { global.fetch.mockReset(); });
}

function card(id) { return document.querySelector('.kiosk-so-card[data-so-id="' + id + '"]'); }

beforeEach(function () {
  localStorage.clear();
  localStorage.setItem(DEVICE_TOKEN_KEY, 'tok');
  global.fetch.mockReset();
});

describe('kiosk limited-release SO card', function () {
  test('card amount and Collect button show the remainder, with the deposit line', function () {
    var core = loadSurface();
    return seed(core, [LIMITED_SO, PLAIN_SO]).then(function () {
      var c = card('SO-L');
      expect(c.querySelector('.kiosk-so-balance').textContent).toContain('202.85');
      expect(c.querySelector('.kiosk-so-pay-btn').textContent).toContain('202.85');
      expect(c.querySelector('.kiosk-so-pay-btn').textContent).not.toContain('252.85');
      expect(c.textContent).toContain('$50.00 deposit applied');
    });
  });

  test('Import to Cart is not offered on limited-release SOs but stays on others', function () {
    var core = loadSurface();
    return seed(core, [LIMITED_SO, LIMITED_NO_DUE, PLAIN_SO]).then(function () {
      expect(card('SO-L').querySelector('.kiosk-so-import-btn')).toBeNull();
      expect(card('SO-N').querySelector('.kiosk-so-import-btn')).toBeNull();
      expect(card('SO-P').querySelector('.kiosk-so-import-btn')).not.toBeNull();
    });
  });

  test('without amount_due the card says the deposit is applied at payment instead of implying the full charge', function () {
    var core = loadSurface();
    return seed(core, [LIMITED_NO_DUE]).then(function () {
      var c = card('SO-N');
      expect(c.querySelector('.kiosk-so-pay-btn')).not.toBeNull();
      expect(c.textContent).toMatch(/deposit applied at payment/i);
    });
  });

  test('plain SO card is unchanged', function () {
    var core = loadSurface();
    return seed(core, [PLAIN_SO]).then(function () {
      var c = card('SO-P');
      expect(c.querySelector('.kiosk-so-pay-btn').textContent).toBe('Collect $40.00');
      expect(c.textContent).not.toContain('deposit');
    });
  });
});
