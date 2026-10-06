'use strict';

// Gift-cert number entry on the iPad kiosk (quick task, 2026-10-06).
//
// Typing "GC-000042" on an iPad means hopping between the letter, symbol and
// number keyboards. Staff can now type just the digits ("42"): every cert
// field opens the number pad (inputmode="numeric") and the value is
// normalized to the canonical GC-NNNNNN before any lookup / cart line /
// redemption uses it. A full "GC-000042" (typed, pasted or scanned) still works.
//
// Covers the shared helper plus each live entry point:
//   - KioskCore.normalizeCertNumber            (js/kiosk-core.js)
//   - Gift Card Management lookup  (kgcm-cert)  (js/kiosk-core.js, kiosk.html markup)
//   - Redeem-at-payment lookup + apply (kgcr-cert) (js/kiosk-core.js)
//   - Issue / Reload modal         (kgci-cert)  (js/kiosk.js)

global.window = global.window || {};
global.window.addEventListener = global.window.addEventListener || jest.fn();
global.navigator = global.navigator || { userAgent: 'test' };
global.console = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() };
global.alert = jest.fn();
global.fetch = jest.fn(function () {
  return Promise.resolve({ status: 200, json: function () { return Promise.resolve({}); } });
});
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
var LOOKUP_URL = 'http://localhost:3001/api/kiosk/gift-card/lookup?cert_number=';

function loadSurface() {
  jest.resetModules();
  if (global.window) delete global.window.KioskCore;
  document.body.innerHTML = '';
  var mod = require('../../js/kiosk.js'); // eslint-disable-line global-require -- per-test isolation
  return { mod: mod, core: global.window.KioskCore };
}

function injectEl(id, tag) {
  var node = document.createElement(tag || 'div');
  node.id = id;
  document.body.appendChild(node);
  return node;
}

function el(id) {
  var node = document.getElementById(id);
  if (!node) throw new Error('expected element #' + id + ' to exist');
  return node;
}

function mockFetchOnce(status, body) {
  global.fetch.mockImplementationOnce(function () {
    return Promise.resolve({ status: status, json: function () { return Promise.resolve(body); } });
  });
}

function flushPromises() {
  return new Promise(function (resolve) { setTimeout(resolve, 0); });
}

function activeCard(cert, balance) {
  return { ok: true, data: { cert_number: cert, status: 'active', face_value: 50, current_balance: balance } };
}

beforeEach(function () {
  localStorage.clear();
  localStorage.setItem(DEVICE_TOKEN_KEY, 'kiosk-test-token');
  global.fetch.mockClear();
});

describe('KioskCore.normalizeCertNumber', function () {
  var norm;
  beforeAll(function () { norm = loadSurface().core.normalizeCertNumber; });

  test.each([
    ['42', 'GC-000042'],
    ['7', 'GC-000007'],
    ['000042', 'GC-000042'],
    ['123456', 'GC-123456'],
    ['GC-000042', 'GC-000042'],
    ['gc-42', 'GC-000042'],
    ['GC42', 'GC-000042'],
    ['  42 ', 'GC-000042'],
    ['GC - 42', 'GC-000042']
  ])('%p -> %p', function (raw, expected) {
    expect(norm(raw)).toBe(expected);
  });

  test.each([
    ['', ''],
    ['1234567', '1234567'],
    ['abc', 'ABC'],
    ['GC-12A', 'GC-12A'],
    ['Loading…', 'LOADING…']
  ])('leaves non-numbers for the existing validation to reject: %p -> %p', function (raw, expected) {
    expect(norm(raw)).toBe(expected);
  });

  test('tolerates null/undefined', function () {
    expect(norm(null)).toBe('');
    expect(norm(undefined)).toBe('');
  });
});

describe('Gift Card Management (kgcm-cert)', function () {
  function openMgmt() {
    var surface = loadSurface();
    ['kgcm-panel', 'kgcm-close', 'kgcm-lookup-view', 'kgcm-error', 'kgcm-result', 'kgcm-result-info',
      'kgcm-void-view', 'kgcm-void-confirm', 'kgcm-void-error'].forEach(function (id) { injectEl(id); });
    ['kgcm-lookup-btn', 'kgcm-void-btn', 'kgcm-void-cancel-btn', 'kgcm-void-confirm-btn'].forEach(function (id) {
      injectEl(id, 'button');
    });
    injectEl('kgcm-cert', 'input');
    injectEl('kgcm-void-reason', 'input');
    surface.core.showGiftCardMgmt();
    return surface;
  }

  test('kiosk.html markup opens the number pad on the cert field', function () {
    var fs = require('fs'); // eslint-disable-line global-require -- read the real markup
    var html = fs.readFileSync(require('path').join(__dirname, '../../kiosk.html'), 'utf8');
    var tag = html.match(/<input[^>]*id="kgcm-cert"[^>]*>/)[0];
    expect(tag).toMatch(/inputmode="numeric"/);
    expect(tag).not.toMatch(/type="tel"/);
  });

  test('typing just "1" looks up GC-000001', async function () {
    openMgmt();
    el('kgcm-cert').value = '1';
    mockFetchOnce(200, activeCard('GC-000001', 7.5));
    el('kgcm-lookup-btn').onclick();
    await flushPromises();
    expect(global.fetch.mock.calls[0][0]).toBe(LOOKUP_URL + 'GC-000001');
  });

  test('blur rewrites the digits to the full number so staff see what they will act on', function () {
    openMgmt();
    el('kgcm-cert').value = '42';
    el('kgcm-cert').dispatchEvent(new Event('blur'));
    expect(el('kgcm-cert').value).toBe('GC-000042');
  });

  test('blur leaves junk alone (no LOADING… / uppercase rewrite of non-numbers)', function () {
    openMgmt();
    el('kgcm-cert').value = 'abc';
    el('kgcm-cert').dispatchEvent(new Event('blur'));
    expect(el('kgcm-cert').value).toBe('abc');
  });

  test('a full GC-000001 still works unchanged', async function () {
    openMgmt();
    el('kgcm-cert').value = 'GC-000001';
    mockFetchOnce(200, activeCard('GC-000001', 7.5));
    el('kgcm-lookup-btn').onclick();
    await flushPromises();
    expect(global.fetch.mock.calls[0][0]).toBe(LOOKUP_URL + 'GC-000001');
  });
});

describe('Redeem at payment (kgcr-cert)', function () {
  function setUpAtPayment() {
    var core = loadSurface().core;
    ['kiosk-payment-items', 'kiosk-payment-amount', 'kiosk-terminal-msg', 'kiosk-spinner'].forEach(function (id) {
      injectEl(id);
    });
    injectEl('kiosk-cancel-payment', 'button');
    injectEl('kiosk-confirm-payment', 'button');
    core._setCart({ P1: { item: { item_id: 'P1', name: 'Test Kit', rate: 100, tax_percentage: 0 }, qty: 1 } });
    core.proceedToPayment();
    return core;
  }

  test('the redeem field opens the number pad and is not a tel input (PCI test guard)', function () {
    setUpAtPayment();
    expect(el('kgcr-cert').getAttribute('inputmode')).toBe('numeric');
    expect((el('kgcr-cert').getAttribute('type') || '').toLowerCase()).toBe('text');
  });

  test('typing "7" looks up GC-000007 and applies the card as GC-000007', async function () {
    var core = setUpAtPayment();
    var setGiftCard = jest.fn();
    core.init({ setGiftCard: setGiftCard });

    el('kgcr-open-btn').onclick();
    el('kgcr-cert').value = '7';
    mockFetchOnce(200, activeCard('GC-000007', 20));
    el('kgcr-lookup-btn').onclick();
    await flushPromises();
    expect(global.fetch.mock.calls[0][0]).toBe(LOOKUP_URL + 'GC-000007');

    el('kgcr-confirm-btn').onclick();
    expect(setGiftCard).toHaveBeenCalledWith(expect.objectContaining({ cert_number: 'GC-000007' }));
  });
});

describe('Issue / Reload modal (kgci-cert)', function () {
  function openIssueModal() {
    var surface = loadSurface();
    injectEl('kiosk-root');
    mockFetchOnce(200, { ok: true, suggested: 'GC-000003' });
    surface.mod._kioskShowGiftCardIssueModal();
    return surface;
  }

  test('the cert field opens the number pad', function () {
    openIssueModal();
    expect(el('kgci-cert').getAttribute('inputmode')).toBe('numeric');
  });

  test('Issue: typing "12" adds a cart line for GC-000012', async function () {
    var surface = openIssueModal();
    await flushPromises();
    el('kgci-cert').value = '12';
    el('kgci-value').value = '25';
    el('kgci-issue').onclick();

    var lines = Object.keys(surface.mod._kioskGetCart()).map(function (k) { return surface.mod._kioskGetCart()[k]; });
    var cert = lines.filter(function (l) { return l.item.gift_cert; })[0];
    expect(cert.item.cert_number).toBe('GC-000012');
    expect(cert.item.name).toBe('Gift Certificate GC-000012');
  });

  test('Reload: typing "5" looks up GC-000005', async function () {
    openIssueModal();
    await flushPromises();
    el('kgci-mode-reload').onclick();
    el('kgci-cert').value = '5';
    el('kgci-value').value = '10';
    global.fetch.mockClear();
    mockFetchOnce(200, activeCard('GC-000005', 0));
    el('kgci-issue').onclick();
    await flushPromises();
    expect(global.fetch.mock.calls[0][0]).toBe(LOOKUP_URL + 'GC-000005');
  });

  test('the suggested next number still prefills in full', async function () {
    openIssueModal();
    await flushPromises();
    expect(el('kgci-cert').value).toBe('GC-000003');
  });
});
