'use strict';

// Regression tests for Phase 46-06: admin session-cookie auth exchange.
//
// checkAuthorization() no longer round-trips through the Apps-Script
// check_auth action or the client-side Config-sheet allowlist fallback
// (T-46-22). It now POSTs the GIS access_token to POST /auth/google with
// credentials:'include', reads {authorized, email} from the response, and
// shows the dashboard or the denied state accordingly. Every admin staff
// fetch -- including the admin-embedded kiosk under #tab-kiosk, which rides
// the admin session (Finding #2) -- drops x-api-key/MW_API_KEY and adds
// credentials:'include' so the sv_session cookie is sent instead.

document.body.innerHTML =
  '<div id="admin-signin"></div>' +
  '<div id="admin-denied" style="display:none"></div>' +
  '<div id="admin-dashboard" style="display:none"></div>' +
  '<span id="admin-user-email"></span>' +
  '<button id="admin-signout" style="display:none"></button>' +
  '<div id="admin-modal" style="display:none">' +
  '  <h3 id="admin-modal-title"></h3>' +
  '  <div id="admin-modal-body"></div>' +
  '</div>';

global.google = { accounts: { oauth2: { initTokenClient: jest.fn(function () { return { requestAccessToken: jest.fn() }; }) } } };

// Default fetch resolves ok:false -- showDashboard() also kicks off
// loadAllData()/loadEmailTemplates() in the background (not under test here).
// ok:false makes sheetsGet's fallback chain reject immediately (no retry
// delay) so its .catch() fires without ever reaching the dashboard-render
// DOM code, which this minimal fixture doesn't include.
global.fetch = jest.fn(function () {
  return Promise.resolve({ ok: false, status: 500, json: function () { return Promise.resolve({}); } });
});

global.SHEETS_CONFIG = {
  MIDDLEWARE_URL: 'http://localhost:3001',
  SPREADSHEET_ID: 'test-id',
  CLIENT_ID: 'test-client-id',
  ADMIN_API_URL: '',
  SHEET_NAMES: {
    KITS: 'Kits', INGREDIENTS: 'Ingredients', RESERVATIONS: 'Reservations',
    HOLDS: 'Holds', SCHEDULE: 'Schedule', HOMEPAGE: 'Homepage'
  }
};

var admin = require('../../js/admin.js');

function flushPromises() {
  return new Promise(function (resolve) { setTimeout(resolve, 0); });
}

function el(id) {
  var node = document.getElementById(id);
  if (!node) throw new Error('expected element #' + id + ' to exist');
  return node;
}

function mockFetchOnce(body) {
  global.fetch.mockImplementationOnce(function () {
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(body); } });
  });
}

describe('admin checkAuthorization() -> POST /auth/google session exchange (46-06)', function () {
  beforeEach(function () {
    global.fetch.mockClear();
    admin._setAccessToken('test-access-token');
    admin._setUserEmail('staff@example.com');
    el('admin-signin').style.display = '';
    el('admin-denied').style.display = 'none';
    el('admin-dashboard').style.display = 'none';
  });

  test('authorized:true -> shows the dashboard', async function () {
    mockFetchOnce({ authorized: true, email: 'staff@example.com' });

    admin.checkAuthorization();
    await flushPromises();

    expect(el('admin-dashboard').style.display).toBe('');
    expect(el('admin-signin').style.display).toBe('none');
    expect(el('admin-denied').style.display).toBe('none');
  });

  test('authorized:false -> shows the denied state (no client-side allowlist fallback)', async function () {
    mockFetchOnce({ authorized: false });

    admin.checkAuthorization();
    await flushPromises();

    expect(el('admin-denied').style.display).toBe('');
    expect(el('admin-dashboard').style.display).toBe('none');
  });

  test('POSTs to /auth/google with credentials:"include" and the access_token body', async function () {
    mockFetchOnce({ authorized: true, email: 'staff@example.com' });

    admin.checkAuthorization();
    await flushPromises();

    // checkAuthorization's own fetch is always the first call issued -- authorized:true
    // additionally triggers showDashboard()'s background data loads, which are not under
    // test here (default-mocked to fail closed without touching this fixture's DOM).
    var call = global.fetch.mock.calls[0];
    expect(call[0]).toBe('http://localhost:3001/auth/google');
    var opts = call[1];
    expect(opts.method).toBe('POST');
    expect(opts.credentials).toBe('include');
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(opts.body)).toEqual({ access_token: 'test-access-token' });
  });

  test('network/parse error -> fails closed to the denied state', async function () {
    global.fetch.mockImplementationOnce(function () { return Promise.reject(new Error('network down')); });

    admin.checkAuthorization();
    await flushPromises();

    expect(el('admin-denied').style.display).toBe('');
    expect(el('admin-dashboard').style.display).toBe('none');
  });
});

describe('admin-embedded kiosk staff fetch: credentials:"include", no x-api-key (46-06)', function () {
  beforeEach(function () {
    global.fetch.mockClear();
  });

  test('gift-card lookup (a representative #tab-kiosk staff fetch) sends credentials, omits x-api-key', async function () {
    admin._kioskShowGcMgmtModal();
    el('kgcm-cert').value = 'GC-000001';
    mockFetchOnce({
      ok: true,
      data: { cert_number: 'GC-000001', status: 'active', face_value: 15, current_balance: 7.5 }
    });

    el('kgcm-lookup-btn').onclick();
    await flushPromises();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    var opts = global.fetch.mock.calls[0][1];
    expect(opts).toBeDefined();
    expect(opts.credentials).toBe('include');
    // No headers object at all on this call site post-migration -- in particular, no x-api-key.
    expect(opts.headers).toBeUndefined();
  });
});
