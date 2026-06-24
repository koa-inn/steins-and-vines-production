'use strict';

// brewpad.js runs its IIFE on load — stub all globals it touches.
global.document = global.document || {};
global.window = global.window || {};
global.navigator = global.navigator || {};
global.fetch = jest.fn();
global.sessionStorage = {
  _data: {},
  getItem: function (k) { return this._data[k] || null; },
  setItem: function (k, v) { this._data[k] = v; },
  removeItem: function (k) { delete this._data[k]; },
  clear: function () { this._data = {}; }
};

// localStorage is replaced per test — define a factory helper.
function makeFakeStorage() {
  return {
    _data: {},
    getItem: function (k) { return this._data[k] || null; },
    setItem: function (k, v) { this._data[k] = v; },
    removeItem: function (k) { delete this._data[k]; },
    clear: function () { this._data = {}; }
  };
}

var SESSION_KEY = 'sv-brewpad-session';

// auth.js primitives are loaded via <script> in the browser; wire them as globals.
var _auth = require('../../js/lib/auth');
global.waitForGoogleIdentity = _auth.waitForGoogleIdentity;
global.gsiInitTokenClient = _auth.gsiInitTokenClient;
global.fetchGoogleUserInfo = _auth.fetchGoogleUserInfo;

// ---- token client mock setup (replaced before each test) -----
var mockRequestAccessToken;

function makeMockTokenClient() {
  mockRequestAccessToken = jest.fn();
  return {
    requestAccessToken: mockRequestAccessToken
  };
}

global.google = {
  accounts: {
    oauth2: {
      initTokenClient: jest.fn(function () { return makeMockTokenClient(); }),
      revoke: jest.fn()
    }
  }
};

// SHEETS_CONFIG must exist before brewpad.js IIFE runs (it reads it during initTokenClient).
global.SHEETS_CONFIG = {
  CLIENT_ID: 'test-client-id',
  SCOPES: 'https://www.googleapis.com/auth/spreadsheets',
  ADMIN_API_URL: 'https://script.example.com/api',
  MW_API_KEY: 'test-mw-key',
  MIDDLEWARE_URL: 'http://localhost:3001'
};

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

// ---- minimal DOM stub used by initGoogleAuth -----

function makeDom() {
  // initGoogleAuth touches: #bp-signout, .bp-signin-card, #bp-google-signin-btn,
  // #bp-user-email, #bp-app, #bp-signin, #bp-denied-msg, #bp-auth-dot, #bp-clear-cache,
  // #bp-toast-container, #bp-session-overlay.
  // We only need elements that initGoogleAuth accesses; others return null (handled by guards).
  var elements = {};
  function el(id, extraProps) {
    elements[id] = Object.assign({
      id: id,
      style: {},
      textContent: '',
      className: '',
      title: '',
      children: [],
      addEventListener: jest.fn(),
      appendChild: jest.fn(),
      querySelector: jest.fn(function () { return null; }),
      removeChild: jest.fn()
    }, extraProps || {});
    return elements[id];
  }

  var signinCard = el('bp-signin-card');
  var googleSigninBtn = el('bp-google-signin-btn');
  var signoutBtn = el('bp-signout');

  return {
    getElementById: jest.fn(function (id) {
      return elements[id] || null;
    }),
    querySelector: jest.fn(function (sel) {
      if (sel === '.bp-signin-card') return signinCard;
      return null;
    }),
    createElement: jest.fn(function () {
      return { id: '', style: {}, textContent: '', className: '', addEventListener: jest.fn() };
    }),
    body: { appendChild: jest.fn() },
    addEventListener: jest.fn(),
    hidden: false,
    _elements: elements
  };
}

// ============================================================
// Suite: initGoogleAuth — session-load branching
// ============================================================

describe('initGoogleAuth — valid stored token path', function () {
  var origDoc, origLS;

  beforeEach(function () {
    origDoc = global.document;
    origLS  = global.localStorage;

    // Fresh token client mock for each test (initTokenClient is called in initGoogleAuth).
    mockRequestAccessToken = jest.fn();
    global.google.accounts.oauth2.initTokenClient = jest.fn(function () {
      return { requestAccessToken: mockRequestAccessToken };
    });

    global.document = makeDom();
    global.localStorage = makeFakeStorage();
  });

  afterEach(function () {
    global.document = origDoc;
    global.localStorage = origLS;
    jest.clearAllMocks();
  });

  // (a) Valid stored token → no silent refresh, sets accessToken, calls checkAuthorization → showApp
  test('(a) valid stored session: does NOT call requestAccessToken', function () {
    global.localStorage._data[SESSION_KEY] = JSON.stringify(makeValidSession());
    // Mock fetch for checkAuthorization → adminApiGet('check_auth') → returns authorized:true
    global.fetch = jest.fn().mockResolvedValue({
      json: function () { return Promise.resolve({ ok: true, authorized: true }); }
    });
    // Minimal DOM elements needed for showApp:
    global.document.getElementById = jest.fn(function (id) {
      var shared = {
        id: id, style: {}, textContent: '', className: '', title: '',
        addEventListener: jest.fn(), appendChild: jest.fn(), querySelector: jest.fn(function () { return null; }),
        removeChild: jest.fn()
      };
      return shared;
    });
    global.document.querySelector = jest.fn(function (sel) {
      if (sel === '.bp-signin-card') return { appendChild: jest.fn() };
      return null;
    });

    bp._initGoogleAuth();

    // No requestAccessToken must have been called (synchronously).
    expect(mockRequestAccessToken).not.toHaveBeenCalled();
  });

  test('(a) valid stored session: sets accessToken from storage', function () {
    var session = makeValidSession();
    global.localStorage._data[SESSION_KEY] = JSON.stringify(session);
    global.fetch = jest.fn().mockResolvedValue({
      json: function () { return Promise.resolve({ ok: true, authorized: true }); }
    });
    global.document.getElementById = jest.fn(function () {
      return { id: '', style: {}, textContent: '', className: '', title: '',
        addEventListener: jest.fn(), appendChild: jest.fn(),
        querySelector: jest.fn(function () { return null; }), removeChild: jest.fn() };
    });
    global.document.querySelector = jest.fn(function (sel) {
      if (sel === '.bp-signin-card') return { appendChild: jest.fn() };
      return null;
    });

    bp._initGoogleAuth();

    // accessToken should be set from storage (not null) — verify via the state accessor.
    expect(bp._getAccessToken()).toBe(session.token);
  });

  test('(a) valid stored session: sets userEmail from storage', function () {
    var session = makeValidSession('brewer@steinsandvines.ca');
    global.localStorage._data[SESSION_KEY] = JSON.stringify(session);
    global.fetch = jest.fn().mockResolvedValue({
      json: function () { return Promise.resolve({ ok: true, authorized: true }); }
    });
    global.document.getElementById = jest.fn(function () {
      return { id: '', style: {}, textContent: '', className: '', title: '',
        addEventListener: jest.fn(), appendChild: jest.fn(),
        querySelector: jest.fn(function () { return null; }), removeChild: jest.fn() };
    });
    global.document.querySelector = jest.fn(function (sel) {
      if (sel === '.bp-signin-card') return { appendChild: jest.fn() };
      return null;
    });

    bp._initGoogleAuth();

    expect(bp._getUserEmail()).toBe('brewer@steinsandvines.ca');
  });

  test('(a) valid stored session: calls fetch (checkAuthorization)', function () {
    var session = makeValidSession();
    global.localStorage._data[SESSION_KEY] = JSON.stringify(session);
    global.fetch = jest.fn().mockResolvedValue({
      json: function () { return Promise.resolve({ ok: true, authorized: true }); }
    });
    global.document.getElementById = jest.fn(function () {
      return { id: '', style: {}, textContent: '', className: '', title: '',
        addEventListener: jest.fn(), appendChild: jest.fn(),
        querySelector: jest.fn(function () { return null; }), removeChild: jest.fn() };
    });
    global.document.querySelector = jest.fn(function () { return null; });

    bp._initGoogleAuth();

    // checkAuthorization calls adminApiGet → fetchWithRetry → fetch
    expect(global.fetch).toHaveBeenCalled();
    var calledUrl = global.fetch.mock.calls[0][0];
    expect(calledUrl).toContain('action=check_auth');
    expect(calledUrl).toContain(session.token);
  });
});

// (b) Expired stored token → attempts silent refresh (existing behavior preserved)
describe('initGoogleAuth — expired stored token path', function () {
  var origDoc, origLS;

  beforeEach(function () {
    origDoc = global.document;
    origLS  = global.localStorage;
    mockRequestAccessToken = jest.fn();
    global.google.accounts.oauth2.initTokenClient = jest.fn(function () {
      return { requestAccessToken: mockRequestAccessToken };
    });
    global.document = makeDom();
    global.localStorage = makeFakeStorage();
  });

  afterEach(function () {
    global.document = origDoc;
    global.localStorage = origLS;
    jest.clearAllMocks();
  });

  test('(b) expired token: DOES call requestAccessToken (silent refresh)', function () {
    global.localStorage._data[SESSION_KEY] = JSON.stringify(makeExpiredSession());
    global.fetch = jest.fn();

    bp._initGoogleAuth();

    // The silent-refresh path calls tokenClient.requestAccessToken({prompt:'', login_hint})
    expect(mockRequestAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: '' })
    );
  });

  test('(b) expired token: does NOT call fetch for checkAuthorization (waits for token)', function () {
    global.localStorage._data[SESSION_KEY] = JSON.stringify(makeExpiredSession());
    global.fetch = jest.fn();

    bp._initGoogleAuth();

    // No fetch call should happen on load — checkAuthorization only fires after token arrives.
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// (c) No session → shows sign-in button (no requestAccessToken on load)
describe('initGoogleAuth — no session path', function () {
  var origDoc, origLS;

  beforeEach(function () {
    origDoc = global.document;
    origLS  = global.localStorage;
    mockRequestAccessToken = jest.fn();
    global.google.accounts.oauth2.initTokenClient = jest.fn(function () {
      return { requestAccessToken: mockRequestAccessToken };
    });
    global.document = makeDom();
    global.localStorage = makeFakeStorage();
  });

  afterEach(function () {
    global.document = origDoc;
    global.localStorage = origLS;
    jest.clearAllMocks();
  });

  test('(c) no session: does NOT call requestAccessToken on load', function () {
    // Empty localStorage — no session
    global.fetch = jest.fn();

    bp._initGoogleAuth();

    expect(mockRequestAccessToken).not.toHaveBeenCalled();
  });

  test('(c) no session: renders sign-in button in #bp-google-signin-btn', function () {
    global.fetch = jest.fn();

    // Track if a button was appended to #bp-google-signin-btn
    var signinBtnContainer = {
      id: 'bp-google-signin-btn',
      style: {},
      textContent: '',
      className: '',
      children: [],
      querySelector: jest.fn(function () { return null; }), // no existing button
      appendChild: jest.fn(),
      addEventListener: jest.fn(),
      removeChild: jest.fn()
    };
    var createdButton = null;
    global.document.getElementById = jest.fn(function (id) {
      if (id === 'bp-google-signin-btn') return signinBtnContainer;
      return { id: id, style: {}, textContent: '', className: '', title: '',
        addEventListener: jest.fn(), appendChild: jest.fn(),
        querySelector: jest.fn(function () { return null; }), removeChild: jest.fn() };
    });
    global.document.createElement = jest.fn(function (tag) {
      createdButton = { type: '', className: '', textContent: '', addEventListener: jest.fn() };
      return createdButton;
    });
    global.document.querySelector = jest.fn(function () { return null; });

    bp._initGoogleAuth();

    expect(signinBtnContainer.appendChild).toHaveBeenCalled();
  });
});

// (d) Graceful fallback: valid stored token but checkAuthorization fails with auth/network error
describe('initGoogleAuth — graceful fallback on stale stored token', function () {
  var origDoc, origLS;

  beforeEach(function () {
    origDoc = global.document;
    origLS  = global.localStorage;
    mockRequestAccessToken = jest.fn();
    global.google.accounts.oauth2.initTokenClient = jest.fn(function () {
      return { requestAccessToken: mockRequestAccessToken };
    });
    global.document = makeDom();
    global.localStorage = makeFakeStorage();
  });

  afterEach(function () {
    global.document = origDoc;
    global.localStorage = origLS;
    jest.clearAllMocks();
  });

  test('(d) valid token, checkAuth rejects with network error → falls back to silent refresh', function () {
    var session = makeValidSession();
    global.localStorage._data[SESSION_KEY] = JSON.stringify(session);

    // checkAuthorization calls fetch which rejects (network error)
    global.fetch = jest.fn().mockRejectedValue(new Error('network error'));

    global.document.getElementById = jest.fn(function () {
      return { id: '', style: {}, textContent: '', className: '', title: '',
        addEventListener: jest.fn(), appendChild: jest.fn(),
        querySelector: jest.fn(function () { return null; }), removeChild: jest.fn() };
    });
    global.document.querySelector = jest.fn(function (sel) {
      if (sel === '.bp-signin-card') return { appendChild: jest.fn() };
      return null;
    });

    bp._initGoogleAuth();

    // After checkAuthorization fails, the fallback should attempt silent refresh.
    // This is async (promise rejection), so we return a promise.
    return new Promise(function (resolve) {
      setTimeout(function () {
        expect(mockRequestAccessToken).toHaveBeenCalledWith(
          expect.objectContaining({ prompt: '' })
        );
        resolve();
      }, 50);
    });
  });

  test('(d) valid token, checkAuth returns authorized:false → showDenied (no silent refresh)', function () {
    var session = makeValidSession();
    global.localStorage._data[SESSION_KEY] = JSON.stringify(session);

    // authorized:false = wrong Google account — no fallback, just show denied
    global.fetch = jest.fn().mockResolvedValue({
      json: function () { return Promise.resolve({ ok: true, authorized: false }); }
    });

    var deniedEl = { id: 'bp-denied-msg', style: { display: 'none' }, textContent: '',
      className: '', title: '', addEventListener: jest.fn(), appendChild: jest.fn(),
      querySelector: jest.fn(function () { return null; }), removeChild: jest.fn() };

    global.document.getElementById = jest.fn(function (id) {
      if (id === 'bp-denied-msg') return deniedEl;
      return { id: id, style: {}, textContent: '', className: '', title: '',
        addEventListener: jest.fn(), appendChild: jest.fn(),
        querySelector: jest.fn(function () { return null; }), removeChild: jest.fn() };
    });
    global.document.querySelector = jest.fn(function () { return null; });

    bp._initGoogleAuth();

    return new Promise(function (resolve) {
      setTimeout(function () {
        // No silent refresh for a genuine "wrong account" response
        expect(mockRequestAccessToken).not.toHaveBeenCalled();
        // Denied message should be shown
        expect(deniedEl.style.display).toBe('');
        resolve();
      }, 50);
    });
  });
});
