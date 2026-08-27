'use strict';

// brewpad.js runs its IIFE on load — stub all globals it touches.
// We must set globals BEFORE require('../../js/brewpad') because the IIFE
// runs immediately at require time and captures the global environment.

global.window = global.window || {};
global.navigator = global.navigator || {};
global.fetch = jest.fn();

// Use jsdom's built-in localStorage (available in testEnvironment:'jsdom').
// Do NOT reassign global.localStorage — jsdom protects that property.
// Use localStorage.setItem / .getItem / .clear() in tests instead.

var SESSION_KEY = 'sv-brewpad-session';

// auth.js primitives are loaded via <script> in the browser; wire them as globals.
var _auth = require('../../js/lib/auth');
global.waitForGoogleIdentity = _auth.waitForGoogleIdentity;
global.gsiInitTokenClient = _auth.gsiInitTokenClient;
global.fetchGoogleUserInfo = _auth.fetchGoogleUserInfo;

// ---- token client mock (re-created before each test) -----
var mockRequestAccessToken;

global.google = {
  accounts: {
    oauth2: {
      initTokenClient: jest.fn(function () {
        mockRequestAccessToken = jest.fn();
        return { requestAccessToken: mockRequestAccessToken };
      }),
      revoke: jest.fn()
    }
  }
};

// SHEETS_CONFIG must exist before brewpad.js IIFE runs.
global.SHEETS_CONFIG = {
  CLIENT_ID: 'test-client-id',
  SCOPES: 'https://www.googleapis.com/auth/spreadsheets',
  ADMIN_API_URL: 'https://script.example.com/api',
  MW_API_KEY: 'test-mw-key',
  MIDDLEWARE_URL: 'http://localhost:3001'
};

// ---- minimal DOM stub used by initGoogleAuth -----
// Returns a fresh stub each call to avoid cross-test contamination.
function makeDom() {
  var elements = {};
  function makeEl(id) {
    return {
      id: id,
      style: {},
      textContent: '',
      className: '',
      title: '',
      parentNode: { removeChild: jest.fn() },
      children: [],
      addEventListener: jest.fn(),
      appendChild: jest.fn(),
      querySelector: jest.fn(function () { return null; }),
      removeChild: jest.fn()
    };
  }
  var signinCard = makeEl('bp-signin-card');
  var googleSigninBtn = makeEl('bp-google-signin-btn');

  return {
    getElementById: jest.fn(function (id) {
      if (!elements[id]) elements[id] = makeEl(id);
      return elements[id];
    }),
    querySelector: jest.fn(function (sel) {
      if (sel === '.bp-signin-card') return signinCard;
      return null;
    }),
    createElement: jest.fn(function (tag) {
      return {
        type: '', id: '', style: {}, cssText: '',
        textContent: '', className: '',
        parentNode: { removeChild: jest.fn() },
        addEventListener: jest.fn()
      };
    }),
    body: { appendChild: jest.fn() },
    addEventListener: jest.fn(),
    hidden: false
  };
}

var bp = require('../../js/brewpad');

// ---- helpers to make a valid or expired session payload -----

function makeValidSession(email) {
  return {
    token: 'valid-access-token-abc',
    expires_at: Date.now() + 60 * 60 * 1000,   // 1 hour from now → tokenValid = true
    email: email || 'staff@steinsandvines.ca',
    login_at: Date.now() - 60 * 1000            // logged in 1 min ago
  };
}

function makeExpiredSession(email) {
  return {
    token: 'old-token-xyz',
    expires_at: Date.now() - 60 * 1000,         // expired 1 min ago → tokenValid = false
    email: email || 'staff@steinsandvines.ca',
    login_at: Date.now() - 10 * 60 * 1000
  };
}

// ============================================================
// Suite (a): valid stored token → no silent refresh, uses stored token
// ============================================================

describe('initGoogleAuth — valid stored token path', function () {
  beforeEach(function () {
    localStorage.clear();
    bp._resetAuthStateForTest();
    mockRequestAccessToken = jest.fn();
    global.google.accounts.oauth2.initTokenClient = jest.fn(function () {
      return { requestAccessToken: mockRequestAccessToken };
    });
    global.document = makeDom();
  });

  afterEach(function () {
    jest.clearAllMocks();
    localStorage.clear();
  });

  test('(a) valid stored session: does NOT call requestAccessToken', function () {
    localStorage.setItem(SESSION_KEY, JSON.stringify(makeValidSession()));
    global.fetch = jest.fn().mockResolvedValue({
      json: function () { return Promise.resolve({ ok: true, authorized: true }); }
    });

    bp._initGoogleAuth();

    // No requestAccessToken must have been called (synchronously — the stored-token fast path).
    expect(mockRequestAccessToken).not.toHaveBeenCalled();
  });

  test('(a) valid stored session: sets accessToken from storage', function () {
    var session = makeValidSession();
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    global.fetch = jest.fn().mockResolvedValue({
      json: function () { return Promise.resolve({ ok: true, authorized: true }); }
    });

    bp._initGoogleAuth();

    expect(bp._getAccessToken()).toBe(session.token);
  });

  test('(a) valid stored session: sets userEmail from storage', function () {
    var session = makeValidSession('brewer@steinsandvines.ca');
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    global.fetch = jest.fn().mockResolvedValue({
      json: function () { return Promise.resolve({ ok: true, authorized: true }); }
    });

    bp._initGoogleAuth();

    expect(bp._getUserEmail()).toBe('brewer@steinsandvines.ca');
  });

  // D-46-09: checkAuthorization now POSTs to /auth/google with credentials:'include'
  // instead of the Apps-Script adminApiGet('check_auth') round trip.
  test('(a) valid stored session: calls fetch for checkAuthorization against /auth/google with the stored token', function () {
    var session = makeValidSession();
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    global.fetch = jest.fn().mockResolvedValue({
      json: function () { return Promise.resolve({ authorized: true }); }
    });

    bp._initGoogleAuth();

    expect(global.fetch).toHaveBeenCalled();
    var call = global.fetch.mock.calls[0];
    expect(call[0]).toBe('http://localhost:3001/auth/google');
    expect(call[1].method).toBe('POST');
    expect(call[1].credentials).toBe('include');
    expect(JSON.parse(call[1].body)).toEqual({ access_token: session.token });
  });
});

// ============================================================
// Suite (b): expired stored token → silent refresh (existing behavior)
// ============================================================

describe('initGoogleAuth — expired stored token path', function () {
  beforeEach(function () {
    localStorage.clear();
    bp._resetAuthStateForTest();
    mockRequestAccessToken = jest.fn();
    global.google.accounts.oauth2.initTokenClient = jest.fn(function () {
      return { requestAccessToken: mockRequestAccessToken };
    });
    global.document = makeDom();
  });

  afterEach(function () {
    jest.clearAllMocks();
    localStorage.clear();
  });

  test('(b) expired token: DOES call requestAccessToken with prompt:""', function () {
    localStorage.setItem(SESSION_KEY, JSON.stringify(makeExpiredSession()));
    global.fetch = jest.fn();

    bp._initGoogleAuth();

    expect(mockRequestAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: '' })
    );
  });

  test('(b) expired token: does NOT call fetch (waits for token before checkAuthorization)', function () {
    localStorage.setItem(SESSION_KEY, JSON.stringify(makeExpiredSession()));
    global.fetch = jest.fn();

    bp._initGoogleAuth();

    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// ============================================================
// Suite (c): no session → show sign-in button, no requestAccessToken
// ============================================================

describe('initGoogleAuth — no session path', function () {
  beforeEach(function () {
    localStorage.clear();
    bp._resetAuthStateForTest();
    mockRequestAccessToken = jest.fn();
    global.google.accounts.oauth2.initTokenClient = jest.fn(function () {
      return { requestAccessToken: mockRequestAccessToken };
    });
    global.document = makeDom();
  });

  afterEach(function () {
    jest.clearAllMocks();
    localStorage.clear();
  });

  test('(c) no session: does NOT call requestAccessToken on load', function () {
    global.fetch = jest.fn();

    bp._initGoogleAuth();

    expect(mockRequestAccessToken).not.toHaveBeenCalled();
  });

  test('(c) no session: appends sign-in button to #bp-google-signin-btn container', function () {
    global.fetch = jest.fn();

    var appendedEl = null;
    var signinBtnContainer = {
      id: 'bp-google-signin-btn',
      style: {},
      textContent: '',
      className: '',
      parentNode: { removeChild: jest.fn() },
      querySelector: jest.fn(function () { return null; }),
      appendChild: jest.fn(function (el) { appendedEl = el; }),
      addEventListener: jest.fn(),
      removeChild: jest.fn()
    };
    global.document.getElementById = jest.fn(function (id) {
      if (id === 'bp-google-signin-btn') return signinBtnContainer;
      if (id === 'bp-resuming-msg') return null;  // no resumeEl present
      return {
        id: id, style: {}, textContent: '', className: '', title: '',
        parentNode: { removeChild: jest.fn() },
        addEventListener: jest.fn(), appendChild: jest.fn(),
        querySelector: jest.fn(function () { return null; }), removeChild: jest.fn()
      };
    });

    bp._initGoogleAuth();

    expect(signinBtnContainer.appendChild).toHaveBeenCalled();
  });
});

// ============================================================
// Suite (d): graceful fallback — stale stored token
// ============================================================

describe('initGoogleAuth — graceful fallback on stale stored token', function () {
  beforeEach(function () {
    localStorage.clear();
    bp._resetAuthStateForTest();
    mockRequestAccessToken = jest.fn();
    global.google.accounts.oauth2.initTokenClient = jest.fn(function () {
      return { requestAccessToken: mockRequestAccessToken };
    });
    global.document = makeDom();
  });

  afterEach(function () {
    jest.clearAllMocks();
    localStorage.clear();
  });

  test('(d) valid token, checkAuth rejects (network error) → falls back to silent refresh', function (done) {
    var session = makeValidSession();
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));

    // checkAuthorization now fetches /auth/google directly (D-46-09) — a rejected
    // fetch reaches checkAuthorization's .catch() (the onError callback), which
    // calls doSilentRefreshOnLoad().
    global.fetch = jest.fn().mockRejectedValue(new Error('network error'));

    bp._initGoogleAuth();

    // Allow 2.5s to cover the promise microtask chain.
    setTimeout(function () {
      expect(mockRequestAccessToken).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: '' })
      );
      done();
    }, 2500);
  }, 8000);  // explicit 8s test timeout

  test('(d) valid token, checkAuth returns authorized:false → showDenied (no silent refresh)', function () {
    var session = makeValidSession();
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));

    // authorized:false = wrong Google account — should showDenied, NOT fall back to silent refresh
    global.fetch = jest.fn().mockResolvedValue({
      json: function () { return Promise.resolve({ ok: true, authorized: false }); }
    });

    var deniedEl = {
      id: 'bp-denied-msg',
      style: { display: 'none' },
      textContent: '',
      className: '',
      parentNode: { removeChild: jest.fn() },
      addEventListener: jest.fn(), appendChild: jest.fn(),
      querySelector: jest.fn(function () { return null; }), removeChild: jest.fn()
    };

    global.document.getElementById = jest.fn(function (id) {
      if (id === 'bp-denied-msg') return deniedEl;
      return {
        id: id, style: {}, textContent: '', className: '', title: '',
        parentNode: { removeChild: jest.fn() },
        addEventListener: jest.fn(), appendChild: jest.fn(),
        querySelector: jest.fn(function () { return null; }), removeChild: jest.fn()
      };
    });

    bp._initGoogleAuth();

    return new Promise(function (resolve) {
      setTimeout(function () {
        // No silent refresh for a genuine "wrong account" response
        expect(mockRequestAccessToken).not.toHaveBeenCalled();
        // Denied message element's display should have been cleared (showDenied sets style.display = '')
        expect(deniedEl.style.display).toBe('');
        resolve();
      }, 50);
    });
  });
});

// ============================================================
// Suite (e): Phase 76 gap closure — GIS silent-refresh-on-load error must
// NOT clear sv_session (D-03).
//
// onTokenResponse's else branch (response.error with no in-memory
// accessToken) is reachable from doSilentRefreshOnLoad on page load -- e.g.
// iPad Safari's third-party-cookie restriction causes GIS to report an
// error to the silent, no-popup token request. That is a Google-side
// hiccup, not evidence the durable middleware session (sv_session_token)
// is invalid, so it must survive exactly like the two adjacent branches in
// the same function already fixed in 76-03 (error_callback and the
// exhausted-retries branch above).
// ============================================================

describe('initGoogleAuth — GIS silent-refresh-on-load error (D-03 gap closure)', function () {
  var capturedCallback;

  beforeEach(function () {
    localStorage.clear();
    bp._resetAuthStateForTest();
    capturedCallback = null;
    global.google.accounts.oauth2.initTokenClient = jest.fn(function (opts) {
      capturedCallback = opts.callback;
      return {
        requestAccessToken: function () {
          // Simulate GIS asynchronously reporting an error during the
          // page-load silent refresh (no popup was ever shown, and no
          // in-memory accessToken is held yet).
          capturedCallback({ error: 'popup_closed_by_user' });
        }
      };
    });
    global.document = makeDom();
  });

  afterEach(function () {
    jest.clearAllMocks();
    localStorage.clear();
  });

  test('(e) GIS error during silent-refresh-on-load does NOT clear sv_session_token', function () {
    localStorage.setItem(SESSION_KEY, JSON.stringify(makeExpiredSession()));
    localStorage.setItem('sv_session_token', 'still-valid-session-id');
    global.fetch = jest.fn();

    bp._initGoogleAuth();

    expect(localStorage.getItem('sv_session_token')).toBe('still-valid-session-id');
  });
});
