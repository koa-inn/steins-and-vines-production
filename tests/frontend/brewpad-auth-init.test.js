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

  test('(a) valid stored session: calls fetch for checkAuthorization with stored token', function () {
    var session = makeValidSession();
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    global.fetch = jest.fn().mockResolvedValue({
      json: function () { return Promise.resolve({ ok: true, authorized: true }); }
    });

    bp._initGoogleAuth();

    expect(global.fetch).toHaveBeenCalled();
    var calledUrl = global.fetch.mock.calls[0][0];
    expect(calledUrl).toContain('action=check_auth');
    expect(calledUrl).toContain(encodeURIComponent(session.token));
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

    // checkAuthorization → adminApiGet → fetchWithRetry retries once after 1s then rejects.
    // Use a spy that fails immediately (no real network) so the 1s retry still fires.
    global.fetch = jest.fn().mockRejectedValue(new Error('network error'));

    bp._initGoogleAuth();

    // fetchWithRetry default retries=1 delays ~1000ms before final rejection reaches
    // checkAuthorization's .catch(), which calls doSilentRefreshOnLoad().
    // Allow 2.5s to cover the retry + promise microtask chain.
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
