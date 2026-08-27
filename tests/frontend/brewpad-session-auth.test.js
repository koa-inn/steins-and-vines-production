'use strict';

// Plan 46-07: BrewPad session-cookie auth (D-46-09).
//
// Proves that:
//   1. checkAuthorization POSTs to /auth/google with credentials:'include' and
//      proceeds to the authenticated view when the server responds authorized:true.
//   2. checkAuthorization shows the denied view when the server responds authorized:false.
//   3. checkAuthorization still calls the onError callback (silent-refresh fallback
//      contract, preserved from before D-46-09) on a fetch/network failure.
//   4. A representative BrewPad staff fetch sends credentials:'include' and no
//      longer sends an x-api-key header.

// brewpad.js runs its IIFE on load -- stub the globals it touches at the top level.
global.document = global.document || {};
global.window = global.window || {};
global.navigator = global.navigator || {};
global.google = { accounts: { oauth2: { initTokenClient: jest.fn() } } };
global.fetch = jest.fn();

// SHEETS_CONFIG must exist before brewpad.js's IIFE runs (mwUrl() reads it at call time,
// but set it up front for consistency with the other brewpad test harnesses).
global.SHEETS_CONFIG = {
  CLIENT_ID: 'test-client-id',
  SCOPES: 'https://www.googleapis.com/auth/spreadsheets',
  MIDDLEWARE_URL: 'http://localhost:3001'
};

// auth.js primitives are loaded via <script> in the browser; in tests wire them as globals.
var _auth = require('../../js/lib/auth');
global.waitForGoogleIdentity = _auth.waitForGoogleIdentity;
global.gsiInitTokenClient = _auth.gsiInitTokenClient;
global.fetchGoogleUserInfo = _auth.fetchGoogleUserInfo;

var bp = require('../../js/brewpad');

// ---------------------------------------------------------------------------
// checkAuthorization(onError) — session-cookie identity exchange
// ---------------------------------------------------------------------------
describe('checkAuthorization — /auth/google session exchange', function () {
  beforeEach(function () {
    document.body.innerHTML =
      '<div id="bp-signin"></div>' +
      '<div id="bp-app" style="display:none"></div>' +
      '<span id="bp-user-email"></span>' +
      '<div id="bp-denied-msg" style="display:none"></div>' +
      '<span id="bp-auth-dot"></span>' +
      '<button id="bp-clear-cache"></button>';
    bp._setAccessTokenForTest('test-access-token');
    global.fetch = jest.fn();
  });

  afterEach(function () {
    jest.clearAllMocks();
  });

  test('POSTs to /auth/google with credentials:\'include\' and the access_token body', function () {
    global.fetch.mockResolvedValue({
      json: function () { return Promise.resolve({ authorized: true, email: 'staff@steinsandvines.ca' }); }
    });

    bp._checkAuthorization();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    var call = global.fetch.mock.calls[0];
    expect(call[0]).toBe('http://localhost:3001/auth/google');
    expect(call[1].method).toBe('POST');
    expect(call[1].credentials).toBe('include');
    expect(JSON.parse(call[1].body)).toEqual({ access_token: 'test-access-token' });
  });

  test('authorized:true -> proceeds to the authenticated BrewPad view (showApp)', function () {
    global.fetch.mockResolvedValue({
      json: function () { return Promise.resolve({ authorized: true, email: 'staff@steinsandvines.ca' }); }
    });

    bp._checkAuthorization();

    return new Promise(function (resolve) {
      setTimeout(function () {
        expect(document.getElementById('bp-app').style.display).toBe('');
        expect(document.getElementById('bp-signin').style.display).toBe('none');
        resolve();
      }, 0);
    });
  });

  test('authorized:false -> shows the denied view, does NOT invoke onError', function () {
    global.fetch.mockResolvedValue({
      json: function () { return Promise.resolve({ authorized: false }); }
    });
    var onError = jest.fn();

    bp._checkAuthorization(onError);

    return new Promise(function (resolve) {
      setTimeout(function () {
        expect(document.getElementById('bp-denied-msg').style.display).toBe('');
        expect(onError).not.toHaveBeenCalled();
        resolve();
      }, 0);
    });
  });

  test('fetch/network failure -> invokes the preserved onError silent-refresh fallback', function () {
    global.fetch.mockRejectedValue(new Error('network error'));
    var onError = jest.fn();

    bp._checkAuthorization(onError);

    return new Promise(function (resolve) {
      setTimeout(function () {
        expect(onError).toHaveBeenCalledTimes(1);
        // Denied view must NOT be shown on a network failure -- that's the
        // onError caller's job (silent refresh), not a hard "denied" state.
        expect(document.getElementById('bp-denied-msg').style.display).toBe('none');
        resolve();
      }, 0);
    });
  });

  test('no onError provided + failure -> falls back to showDenied (legacy no-callback contract)', function () {
    global.fetch.mockRejectedValue(new Error('network error'));

    bp._checkAuthorization();

    return new Promise(function (resolve) {
      setTimeout(function () {
        expect(document.getElementById('bp-denied-msg').style.display).toBe('');
        resolve();
      }, 0);
    });
  });
});

// ---------------------------------------------------------------------------
// Representative staff fetch — proves credentials:'include' replaces x-api-key
// ---------------------------------------------------------------------------
describe('BrewPad staff fetch — session cookie transport (D-46-09)', function () {
  beforeEach(function () {
    global.fetch = jest.fn().mockResolvedValue({
      json: function () { return Promise.resolve({ ok: true, recipe_id: 'r1' }); }
    });
    bp._bpSetResolvedRecipe({ recipe: { recipe_id: 'r0' }, ingredients: [] });
  });

  afterEach(function () {
    jest.clearAllMocks();
  });

  test('bpSaveAsNewRecipe sends credentials:\'include\' and no x-api-key header', function () {
    return bp.bpSaveAsNewRecipe('New Draft Recipe', []).then(function () {
      expect(global.fetch).toHaveBeenCalledTimes(1);
      var call = global.fetch.mock.calls[0];
      expect(call[0]).toBe('http://localhost:3001/api/recipes');
      expect(call[1].credentials).toBe('include');
      expect(call[1].headers).not.toHaveProperty('x-api-key');
      expect(Object.keys(call[1].headers)).not.toContain('x-api-key');
    });
  });
});

// ---------------------------------------------------------------------------
// Phase 76 — single-credential migration (D-01/D-02/D-03).
//
// The bug (CONTEXT.md): a Google-token / Apps-Script failure (silent-refresh
// death, or a response merely containing the substring "unauthorized") used
// to call handleUnauthorized() -> clearSession(), which deletes the still-
// valid sv_session_token -- forcing a full re-login while the real
// middleware credential was fine. These tests pin the fix:
//   1. An Apps-Script/Google-shaped "unauthorized" body that is NOT a real
//      middleware HTTP 401 must never clear sv_session_token.
//   2. adminApiGet/adminApiPost transport = the middleware admin-proxy, with
//      no Google token field in the body (mirrors the existing "no
//      x-api-key header" assertion above).
//   3. A REAL middleware HTTP 401 is the sole, idempotent logout trigger
//      (res.status === 401 -- never a body substring).
// ---------------------------------------------------------------------------
describe('Phase 76 — single-credential migration', function () {
  beforeEach(function () {
    document.body.innerHTML =
      '<div id="bp-signin"></div>' +
      '<div id="bp-app" style="display:none"></div>' +
      '<span id="bp-user-email"></span>' +
      '<div id="bp-denied-msg" style="display:none"></div>' +
      '<span id="bp-auth-dot"></span>' +
      '<button id="bp-clear-cache"></button>';
    bp._resetAuthStateForTest();
    bp._setAccessTokenForTest('test-access-token');
    // Pre-migration guard: today's adminApiGet/adminApiPost short-circuit
    // ("Admin API not configured") unless ADMIN_API_URL is set -- set it here
    // so Test 1 genuinely reaches the current isUnauthorizedError/
    // handleUnauthorized code path (real RED, not a false-negative early
    // reject). Harmless post-migration: the new transport never reads it.
    global.SHEETS_CONFIG.ADMIN_API_URL = 'https://script.google.com/test/admin-legacy';
    try { localStorage.removeItem('sv_session_token'); } catch (e) {}
    global.fetch = jest.fn();
  });

  afterEach(function () {
    jest.clearAllMocks();
    delete global.SHEETS_CONFIG.ADMIN_API_URL;
    try { localStorage.removeItem('sv_session_token'); } catch (e) {}
  });

  test('an Apps-Script/Google-shaped "unauthorized" body that is NOT a real middleware 401 does not clear sv_session_token', function () {
    localStorage.setItem('sv_session_token', 'still-valid-session-id');
    global.fetch.mockResolvedValue({
      status: 200,
      ok: true,
      json: function () { return Promise.resolve({ ok: false, error: 'Unauthorized: token not recognized' }); }
    });

    return bp._adminApiGetForTest('get_batches', { status: 'all' }).then(
      function () { throw new Error('expected adminApiGet to reject on data.ok:false'); },
      function () {
        expect(localStorage.getItem('sv_session_token')).toBe('still-valid-session-id');
      }
    );
  });

  test('adminApiGet/adminApiPost transport = middleware admin-proxy, no Google token field', function () {
    global.fetch.mockResolvedValue({
      status: 200,
      ok: true,
      json: function () { return Promise.resolve({ ok: true, data: {} }); }
    });

    return Promise.all([
      bp._adminApiGetForTest('get_batches', { status: 'all' }),
      bp._adminApiPostForTest('update_batch', { batch_id: 'B1', updates: {} })
    ]).then(function () {
      expect(global.fetch).toHaveBeenCalledTimes(2);
      global.fetch.mock.calls.forEach(function (call) {
        expect(call[0]).toBe('http://localhost:3001/api/batch/admin-proxy');
        expect(call[0]).not.toBe(global.SHEETS_CONFIG.ADMIN_API_URL);
        var body = JSON.parse(call[1].body);
        expect(body).not.toHaveProperty('token');
      });
    });
  });

  test('a real middleware HTTP 401 triggers the sole logout path exactly once', function () {
    localStorage.setItem('sv_session_token', 'still-valid-session-id');

    bp._handleMiddlewareResponse('http://localhost:3001/api/batch/admin-proxy', { status: 401 });

    expect(localStorage.getItem('sv_session_token')).toBeNull();
    expect(document.getElementById('bp-session-overlay')).not.toBeNull();

    // Idempotent -- a second 401 must not throw or duplicate the overlay.
    bp._handleMiddlewareResponse('http://localhost:3001/api/batch/admin-proxy', { status: 401 });
    expect(document.querySelectorAll('#bp-session-overlay').length).toBe(1);
  });
});
