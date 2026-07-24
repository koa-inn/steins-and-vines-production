'use strict';

// Regression test for Phase 64-03 / OPS-03 SC#3: adminApiGet leaked the Google
// OAuth access token into the request URL query string
// (ADMIN_API_URL + '?action=...&token=...') on BOTH staff surfaces
// (brewpad.js:1285, admin.js:681) -- any intermediary/proxy/access log that
// captures request URLs (but not bodies) captured the short-lived token.
//
// Verifies adminApiGet now POSTs the token in the JSON body (matching the
// existing adminApiPost transport), the URL carries no query string at all,
// and the exact return contract (resolve `data` unchanged on ok:true;
// handleUnauthorized()-then-reject on ok:false unauthorized) is preserved.
//
// RED until js/brewpad.js and js/admin.js's adminApiGet are rewritten
// (Task 4 of this plan). Exercised via the same test-only export seam already
// used by every other IIFE-scoped helper in these files (mirrors
// _setAccessTokenForTest / checkAuthorization in the same exports blocks) --
// adminApiGet has no public caller that isolates a single call/response.

function flushPromises() {
  return new Promise(function (resolve) { setTimeout(resolve, 0); });
}

function mockFetchOnce(body) {
  global.fetch.mockImplementationOnce(function () {
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(body); } });
  });
}

// ---------------------------------------------------------------------------
// Per-surface suite -- identical behavior contract, different module + DOM
// fixture (brewpad.js's handleUnauthorized touches #bp-* elements; admin.js's
// touches #admin-* elements).
// ---------------------------------------------------------------------------
function runAdminApiGetTokenSuite(surface) {
  describe('adminApiGet POSTs the token in the body, never the URL (' + surface.name + ', 64-03/OPS-03 SC#3)', function () {
    var mod;

    beforeEach(function () {
      jest.resetModules();

      document.body.innerHTML = surface.domFixture;
      global.window = global.window || {};
      global.navigator = global.navigator || {};
      global.google = { accounts: { oauth2: { initTokenClient: jest.fn(function () { return { requestAccessToken: jest.fn() }; }) } } };
      global.fetch = jest.fn();
      global.localStorage = {
        _data: {},
        getItem: function (k) { return this._data[k] || null; },
        setItem: function (k, v) { this._data[k] = v; },
        removeItem: function (k) { delete this._data[k]; },
        clear: function () { this._data = {}; }
      };
      global.sessionStorage = global.localStorage;
      global.SHEETS_CONFIG = {
        MIDDLEWARE_URL: 'http://mw.test',
        SPREADSHEET_ID: 'test-id',
        CLIENT_ID: 'test-client-id',
        ADMIN_API_URL: 'https://script.google.com/test/admin',
        SHEET_NAMES: {
          KITS: 'Kits', INGREDIENTS: 'Ingredients', RESERVATIONS: 'Reservations',
          HOLDS: 'Holds', SCHEDULE: 'Schedule', HOMEPAGE: 'Homepage'
        }
      };

      // auth.js primitives are loaded via <script> in the browser; wire as
      // globals for tests (mirrors tests/frontend/brewpad-delete-reconcile.test.js).
      var _auth = require('../../js/lib/auth');
      global.waitForGoogleIdentity = _auth.waitForGoogleIdentity;
      global.gsiInitTokenClient = _auth.gsiInitTokenClient;
      global.fetchGoogleUserInfo = _auth.fetchGoogleUserInfo;

      mod = require(surface.modulePath);
      surface.setAccessToken(mod, 'test-access-token');
    });

    test('issues a fetch whose URL carries no token= and no ?action= query string', function () {
      mockFetchOnce({ ok: true, data: { vessels: [] } });

      mod._adminApiGetForTest('get_vessels');

      expect(global.fetch).toHaveBeenCalledTimes(1);
      var url = String(global.fetch.mock.calls[0][0]);
      expect(url).toBe(global.SHEETS_CONFIG.ADMIN_API_URL);
      expect(url.indexOf('token=')).toBe(-1);
      expect(url.indexOf('?action=')).toBe(-1);
    });

    test('POSTs method with token + action + params in the JSON body', function () {
      mockFetchOnce({ ok: true, data: { batch_id: 'X' } });

      mod._adminApiGetForTest('get_batch', { batch_id: 'X' });

      var call = global.fetch.mock.calls[0];
      var opts = call[1];
      expect(opts.method).toBe('POST');
      var body = JSON.parse(opts.body);
      expect(body.token).toBe('test-access-token');
      expect(body.action).toBe('get_batch');
      expect(body.batch_id).toBe('X');
    });

    test('resolves { ok:true, data } unchanged (return contract)', function () {
      mockFetchOnce({ ok: true, data: { vessels: ['v1'] } });

      return mod._adminApiGetForTest('get_vessels').then(function (data) {
        expect(data).toEqual({ ok: true, data: { vessels: ['v1'] } });
      });
    });

    test('{ ok:false, message: "unauthorized" } triggers handleUnauthorized and rejects', function () {
      mockFetchOnce({ ok: false, message: 'unauthorized' });

      var rejected = mod._adminApiGetForTest('get_vessels').then(
        function () { throw new Error('expected rejection, got resolution'); },
        function (err) { return err; }
      );

      return flushPromises().then(function () {
        return rejected;
      }).then(function (err) {
        expect(err).toBeInstanceOf(Error);
        surface.assertUnauthorizedSideEffect();
      });
    });
  });
}

runAdminApiGetTokenSuite({
  name: 'brewpad.js',
  modulePath: '../../js/brewpad',
  domFixture: '<div id="bp-toast-container"></div>',
  setAccessToken: function (mod, token) { mod._setAccessTokenForTest(token); },
  assertUnauthorizedSideEffect: function () {
    // handleUnauthorized() shows the session-expired overlay -- a visible,
    // implementation-stable side effect (js/brewpad.js:showSessionExpiredOverlay).
    expect(document.getElementById('bp-session-overlay')).not.toBeNull();
  }
});

runAdminApiGetTokenSuite({
  name: 'admin.js',
  modulePath: '../../js/admin',
  domFixture:
    '<div id="admin-signin"></div>' +
    '<div id="admin-denied" style="display:none"></div>' +
    '<div id="admin-dashboard"></div>' +
    '<span id="admin-user-email">staff@example.com</span>' +
    '<button id="admin-signout"></button>',
  setAccessToken: function (mod, token) { mod._setAccessToken(token); },
  assertUnauthorizedSideEffect: function () {
    // handleUnauthorized() re-shows the sign-in screen and hides the dashboard
    // (js/admin.js:handleUnauthorized).
    expect(document.getElementById('admin-signin').style.display).toBe('');
    expect(document.getElementById('admin-dashboard').style.display).toBe('none');
  }
});
