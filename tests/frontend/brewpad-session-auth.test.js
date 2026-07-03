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
