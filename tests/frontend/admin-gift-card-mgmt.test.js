'use strict';

// Regression tests for the admin Gift Card Management modal (kgcm-*), Phase 45-09 UAT F7.
//
// Live UAT 2026-07-02: lookup from admin.html failed with "Connection error" because the
// modal read SHEETS_CONFIG.MW_URL (which does not exist — the key is MIDDLEWARE_URL),
// fetching relative to the static Pages host. It also read the response fields one level
// too shallow (result.data.X instead of result.data.data.X) and used `balance` instead of
// the contract's `current_balance` (same field-name defect family as F1).
//
// Mock response shape below mirrors the REAL /api/kiosk/gift-card/lookup contract:
// { ok: true, data: { cert_number, status, face_value, current_balance } }
// (verified live against prod middleware + zoho-middleware/__tests__/gift-cards.test.js).
//
// Runs against the real jsdom DOM: openModal() renders the modal HTML into
// #admin-modal-body, so the kgcm-* elements are real nodes.

// Modal container fixture must exist before admin.js loads.
document.body.innerHTML =
  '<div id="admin-modal" style="display:none">' +
  '  <h3 id="admin-modal-title"></h3>' +
  '  <div id="admin-modal-body"></div>' +
  '</div>';

global.google = { accounts: { oauth2: { initTokenClient: jest.fn(function () { return { requestAccessToken: jest.fn() }; }) } } };
global.alert = jest.fn();
global.fetch = jest.fn(function () {
  return Promise.resolve({ status: 200, json: function () { return Promise.resolve({}); } });
});

// SHEETS_CONFIG stub — deliberately has NO MW_URL key, matching the real js/sheets-config.js
global.SHEETS_CONFIG = {
  MIDDLEWARE_URL: 'http://localhost:3001',
  MW_API_KEY: 'test-key',
  SPREADSHEET_ID: 'test-id',
  GOOGLE_CLIENT_ID: 'test-client-id',
  STAFF_EMAILS: 'test@example.com',
  API_BASE: 'https://script.google.com/test',
  SERVER_TOKEN: 'test-token'
};

var admin = require('../../js/admin.js');

function flushPromises() {
  return new Promise(function (resolve) { setTimeout(resolve, 0); });
}

function el(id) {
  var node = document.getElementById(id);
  if (!node) throw new Error('expected modal element #' + id + ' to exist');
  return node;
}

// Real lookup contract (see header comment). Non-zero, distinct amounts so a
// shallow/wrong-field read cannot accidentally produce the expected output.
var LOOKUP_RESPONSE = {
  ok: true,
  data: { cert_number: 'GC-000001', status: 'active', face_value: 15, current_balance: 7.5 }
};

function mockFetchOnce(status, body) {
  global.fetch.mockImplementationOnce(function () {
    return Promise.resolve({
      status: status,
      json: function () { return Promise.resolve(body); }
    });
  });
}

describe('admin Gift Card Management modal (kgcm) — F7 regression', function () {
  beforeEach(function () {
    global.fetch.mockClear();
  });

  test('lookup fetches the middleware host (MIDDLEWARE_URL), not a relative path', async function () {
    admin._kioskShowGcMgmtModal();
    el('kgcm-cert').value = 'GC-000001';
    mockFetchOnce(200, LOOKUP_RESPONSE);

    el('kgcm-lookup-btn').onclick();
    await flushPromises();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    var url = global.fetch.mock.calls[0][0];
    expect(url).toBe('http://localhost:3001/api/kiosk/gift-card/lookup?cert_number=GC-000001');
  });

  test('lookup renders status, face value, and current_balance from the nested data payload', async function () {
    admin._kioskShowGcMgmtModal();
    el('kgcm-cert').value = 'GC-000001';
    mockFetchOnce(200, LOOKUP_RESPONSE);

    el('kgcm-lookup-btn').onclick();
    await flushPromises();

    var html = el('kgcm-result-info').innerHTML;
    expect(html).toContain('GC-000001');
    expect(html).toContain('active');
    expect(html).toContain('$15.00'); // face_value
    expect(html).toContain('$7.50');  // current_balance (not `balance`, not top-level)
    expect(el('kgcm-result').style.display).toBe('block');
  });

  test('void posts to the middleware host with cert number and reason', async function () {
    admin._kioskShowGcMgmtModal();
    el('kgcm-cert').value = 'GC-000001';
    mockFetchOnce(200, LOOKUP_RESPONSE);
    el('kgcm-lookup-btn').onclick();
    await flushPromises();

    // Switch to void view, provide a reason, confirm
    el('kgcm-void-btn').onclick();
    el('kgcm-void-reason').value = 'UAT test certificate';
    mockFetchOnce(200, { ok: true });
    el('kgcm-void-confirm-btn').onclick();
    await flushPromises();

    expect(global.fetch).toHaveBeenCalledTimes(2);
    var call = global.fetch.mock.calls[1];
    expect(call[0]).toBe('http://localhost:3001/api/kiosk/gift-card/void');
    var body = JSON.parse(call[1].body);
    expect(body.cert_number).toBe('GC-000001');
    expect(body.reason).toBe('UAT test certificate');
  });
});
