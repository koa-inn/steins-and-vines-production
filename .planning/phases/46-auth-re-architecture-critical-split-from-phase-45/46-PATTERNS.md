# Phase 46: Auth Re-Architecture (CRITICAL) - Pattern Map

**Mapped:** 2026-07-02
**Files analyzed:** 16 (6 new middleware files, 2 modified middleware files, 8 modified/large-change frontend files)
**Analogs found:** 16 / 16

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `zoho-middleware/lib/deviceToken.js` (NEW) | utility (credential guard) | request-response | `zoho-middleware/lib/apiKey.js` | exact |
| `zoho-middleware/lib/session.js` (NEW) | service (session store) | CRUD + fallback | `zoho-middleware/lib/cache.js` (`acquireLock`/`acquireInProcessLock`) | exact |
| `zoho-middleware/lib/googleVerify.js` (NEW) | service (identity verification) | request-response | `zoho-middleware/lib/zohoAuth.js` (OAuth token exchange shape) + RESEARCH.md Pattern 4 (Context7-sourced) | role-match |
| `zoho-middleware/routes/auth.js` (MODIFIED — add `POST /auth/google`, `POST /auth/logout`) | route/controller | request-response | itself (`GET /auth/zoho/callback` — existing exchange-and-respond shape) | exact |
| `zoho-middleware/server.js` (MODIFIED — 3-tier guard dispatch, exemptions, cookie-parser mount) | middleware/config | request-response | itself (existing `/api` guard block, `PII_GET_ROUTES` pattern) | exact |
| `zoho-middleware/__tests__/device-token-guard.test.js` (NEW) | test | request-response | `zoho-middleware/__tests__/api-key-guard.test.js` | exact |
| `zoho-middleware/__tests__/session.test.js` (NEW) | test | CRUD | `zoho-middleware/__tests__/api-key-guard.test.js` (unit-test half) | role-match |
| `zoho-middleware/__tests__/google-verify.test.js` (NEW) | test | request-response | `zoho-middleware/__tests__/api-key-guard.test.js` (mock-mirrors-real-contract style) | role-match |
| `js/kiosk.js` (LARGE CHANGE — remove Google-auth plumbing, add device-token prompt) | component (page controller) | event-driven | itself (existing `initGoogleAuth`/PIN-lock block, lines 109-420) | exact (self-analog; also compare `js/admin.js`/`js/brewpad.js` for what NOT to keep) |
| `js/admin.js` (MODIFIED — `checkAuthorization()` → `/auth/google`; fetches → `credentials:'include'`) | component (page controller) | request-response | itself (existing `onTokenResponse`/`checkAuthorization`/`adminApiGet`, lines 452-697) | exact |
| `js/brewpad.js` (MODIFIED — same shape as admin.js) | component (page controller) | request-response | `js/admin.js` (near-identical `initGoogleAuth`/`onTokenResponse`/`mwApiKey()` structure) | exact |
| `js/sheets-config.js` (MODIFIED — remove `MW_API_KEY`) | config | — | itself (single-object config module) | exact |
| `js/modules/12-checkout.js` (MODIFIED — remove `x-api-key` from 6 call sites) | transform/utility (checkout flow) | request-response | itself; server-side exemption pattern to mirror is `/checkout` and `/promo/validate` in `server.js` | exact |
| `js/modules/16-catalog-subpage.js` (MODIFIED — remove `x-api-key` header, GET-only) | utility | request-response | itself (leak-removal only, no guard change) | exact |
| `js/modules/17-search-overlay.js` (MODIFIED — remove `x-api-key` header, GET-only) | utility | request-response | itself (leak-removal only, no guard change) | exact |
| `zoho-middleware/lib/validateEnv.js` (MODIFIED — add `STAFF_EMAILS`, `KIOSK_DEVICE_TOKEN`, `SHEETS_CLIENT_ID`, session-secret-adjacent vars) | config | — | itself (`REQUIRED`/`REQUIRED_IN_PROD`/`OPTIONAL` arrays, isProd branch) | exact |

## Pattern Assignments

### `zoho-middleware/lib/deviceToken.js` (NEW — utility, request-response)

**Analog:** `zoho-middleware/lib/apiKey.js` (verbatim pattern to replicate — this is also RESEARCH.md's own recommendation, Pattern 1)

**Full source to mirror** (`zoho-middleware/lib/apiKey.js` lines 1-38):
```javascript
'use strict';

var crypto = require('crypto');

function getKey() {
  return process.env.API_SECRET_KEY || process.env.MW_API_KEY || '';
}

// Constant-time comparison. A plain `===`/`!==` on the secret is a timing
// oracle that leaks the key byte-by-byte via response-time measurement. Length
// is checked first (lengths are not secret) so timingSafeEqual always receives
// equal-length buffers.
function matches(sent) {
  var key = getKey();
  if (!key || typeof sent !== 'string') return false;
  var a = Buffer.from(sent);
  var b = Buffer.from(key);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { getKey: getKey, matches: matches };
```

**What changes for `deviceToken.js`:** swap `API_SECRET_KEY`/`MW_API_KEY` → single new env var `KIOSK_DEVICE_TOKEN` (no legacy alias needed — this is net-new, not a migrated secret). Same `getKey()`/`matches()` shape, same constant-time comparison, same "header only, never query string" rule.

**Error handling pattern:** fail closed — `matches()` returns `false` when `key` is empty (no env var set), mirroring `apiKey.js`'s "rejects everything when no key is configured" test case.

---

### `zoho-middleware/lib/session.js` (NEW — service, CRUD + Redis-with-fallback)

**Analog:** `zoho-middleware/lib/cache.js` — specifically the `acquireLock`/`acquireInProcessLock`/`releaseLock` trio (lines 106-147), which is the exact "Redis primary, in-process Map fallback, single-Railway-instance justification" pattern RESEARCH.md Pattern 2 calls out to mirror.

**Fallback pattern to replicate** (`zoho-middleware/lib/cache.js` lines 113-147):
```javascript
// In-process lock Map: key → expiresAt (ms). Provides NX-style lock semantics
// when Redis is unavailable. Within a single Railway instance, per-process
// coverage is equivalent to cross-process coverage (D-06).
var inProcessLocks = Object.create(null);

function acquireInProcessLock(key, ttlSeconds) {
  var now = Date.now();
  var entry = inProcessLocks[key];
  if (entry && now < entry.expiresAt) {
    return false; // lock is held and has not expired
  }
  inProcessLocks[key] = { expiresAt: now + ttlSeconds * 1000 };
  return true;
}

function acquireLock(key, ttlSeconds) {
  if (!connected) return Promise.resolve(acquireInProcessLock(key, ttlSeconds));
  return getClient().then(function (c) {
    return c.set('lock:' + key, '1', { NX: true, EX: ttlSeconds });
  }).then(function (result) {
    return result !== null; // 'OK' if acquired; null if already held
  }).catch(function () {
    // Redis mid-op error: fall back to in-process guard (D-06)
    return acquireInProcessLock(key, ttlSeconds);
  });
}

function releaseLock(key) {
  // Always clear the in-process fallback lock so retries can re-acquire
  // even when Redis is unavailable.
  delete inProcessLocks[key];
  if (!connected) return Promise.resolve();
  return getClient().then(function (c) {
    return c.del('lock:' + key);
  }).catch(function () {});
}
```

**get/set base to build on** (`zoho-middleware/lib/cache.js` lines 64-92 — `session.js` should call these, not reimplement Redis access):
```javascript
function get(key) {
  if (!connected) return Promise.resolve(null);
  return getClient().then(function (c) {
    return c.get(key);
  }).then(function (val) {
    if (val === null) return null;
    try { return JSON.parse(val); } catch (e) { return null; }
  }).catch(function () { return null; });
}

function set(key, value, ttlSeconds) {
  if (!connected) return Promise.resolve();
  return getClient().then(function (c) {
    return c.set(key, JSON.stringify(value), { EX: ttlSeconds });
  }).catch(function (err) {
    log.error('[redis] Failed to set cache: ' + err.message);
  });
}
```

**Isolation check needed:** `cache.isConnected()` (line 173-175) is the exported flag `session.js` must consult to decide Redis-vs-in-process, exactly as `acquireLock` does.

**Shape for the new module (illustrative, from RESEARCH.md Finding #5 — not yet written):**
```javascript
var cache = require('./cache');
var crypto = require('crypto');
var inProcessSessions = Object.create(null); // sid -> { email, createdAt, expiresAt }

function createSession(email) {
  var sid = crypto.randomBytes(32).toString('hex');
  var payload = { email: email, createdAt: Date.now() };
  inProcessSessions[sid] = payload; // write-through, mirrors inProcessLocks
  return cache.set('session:' + sid, payload, 7 * 24 * 3600).then(function () { return sid; });
}

function getSession(sid) {
  if (!cache.isConnected()) {
    return Promise.resolve(inProcessSessions[sid] || null);
  }
  return cache.get('session:' + sid);
}

function destroySession(sid) {
  delete inProcessSessions[sid];
  return cache.del('session:' + sid);
}
```

---

### `zoho-middleware/lib/googleVerify.js` (NEW — service, request-response)

**Analog:** No exact analog exists in-repo for "verify a third-party OAuth token server-side" — `zoho-middleware/lib/zohoAuth.js` handles a *different* OAuth relationship (server↔Zoho, code-exchange flow, not applicable by pattern). Use RESEARCH.md's Context7-sourced Pattern 4 directly (already vetted against the real `google-auth-library` API surface):

```javascript
// Source: RESEARCH.md Pattern 4, Context7 /googleapis/google-auth-library-nodejs
var { OAuth2Client } = require('google-auth-library');
var client = new OAuth2Client();

function verifyStaffAccessToken(accessToken) {
  return client.getTokenInfo(accessToken).then(function (tokenInfo) {
    // getTokenInfo does NOT check audience for you — this repo's own responsibility:
    if (tokenInfo.aud !== process.env.SHEETS_CLIENT_ID) {
      throw new Error('Token audience mismatch');
    }
    if (!tokenInfo.email_verified) {
      throw new Error('Email not verified');
    }
    return tokenInfo.email.toLowerCase();
  });
}
```

**Pitfall (do not omit):** the `aud` check above is mandatory — `getTokenInfo()` does not validate provenance itself. `SHEETS_CLIENT_ID` should read from `SHEETS_CONFIG.CLIENT_ID` (`js/sheets-config.js:17`, value `8605205683-tck2da2tpp03vcbr5etauu9q7kompg3q.apps.googleusercontent.com`) mirrored into a matching server-side env var.

**Error handling pattern to follow (mirrors `zoho-middleware/routes/auth.js` catch blocks, lines 48-55):**
```javascript
.catch(function (err) {
  log.error('[callback] Token exchange failed: ' + err.message);
  res.status(500).json({ error: 'Authentication failed' });
});
```

---

### `zoho-middleware/routes/auth.js` (MODIFIED — add `POST /auth/google`, `POST /auth/logout`)

**Analog:** itself — the existing `GET /auth/zoho/callback` handler (lines 28-56) is the closest in-file precedent for "receive a credential, validate it, issue a result."

**Imports pattern** (lines 1-8):
```javascript
var express = require('express');
var crypto = require('crypto');
var axios = require('axios');
var zohoAuth = require('../lib/zohoAuth');
var cache = require('../lib/cache');
var log = require('../lib/logger');
var helcimLib = require('../lib/helcim');
var C = require('../lib/constants');

var router = express.Router();
```
(New file will additionally `require('../lib/googleVerify')`, `require('../lib/session')`.)

**Core exchange pattern to mirror** (lines 28-56 — state validation → exchange → respond):
```javascript
router.get('/auth/zoho/callback', function (req, res) {
  var code = req.query.code;
  var state = req.query.state;
  if (!code) {
    return res.status(400).json({ error: 'Missing authorization code' });
  }
  if (!state) {
    return res.status(403).json({ error: 'Missing state parameter' });
  }
  var stateKey = C.CACHE_KEYS.OAUTH_STATE_PREFIX + state;
  cache.get(stateKey).then(function (stored) {
    if (!stored) {
      return res.status(403).json({ error: 'Invalid or expired OAuth state' });
    }
    cache.del(stateKey).catch(function () {});
    return zohoAuth.exchangeCode(code)
      .then(function () {
        res.json({ ok: true, message: 'Zoho authentication successful' });
      })
      .catch(function (err) {
        log.error('[callback] Token exchange failed: ' + err.message);
        res.status(500).json({ error: 'Authentication failed' });
      });
  }).catch(function (err) {
    log.error('[callback] State validation failed: ' + err.message);
    res.status(500).json({ error: 'Authentication failed' });
  });
});
```

**Full illustrative new-route shape (RESEARCH.md Code Examples section — use as the actual template):**
```javascript
router.post('/auth/google', function (req, res) {
  var accessToken = req.body && req.body.access_token;
  if (!accessToken) return res.status(400).json({ error: 'Missing access_token' });

  verifyStaffAccessToken(accessToken)
    .then(function (email) {
      var allowlist = (process.env.STAFF_EMAILS || '').split(',').map(function (e) { return e.trim().toLowerCase(); });
      if (allowlist.indexOf(email) === -1) {
        return res.status(403).json({ authorized: false });
      }
      return session.createSession(email).then(function (sid) {
        res.cookie('sv_session', sid, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
          maxAge: 7 * 24 * 60 * 60 * 1000
        });
        res.json({ authorized: true, email: email });
      });
    })
    .catch(function (err) {
      log.warn('[auth/google] verification failed: ' + err.message);
      res.status(401).json({ authorized: false });
    });
});
```

**Mounting note:** `app.use('/', require('./routes/auth'))` is already mounted at `server.js:128`, explicitly BEFORE the API-key/session guards (comment: "Auth routes (MUST be mounted BEFORE auth guard)") — the new `/auth/google` and `/auth/logout` routes ride this same pre-guard mount point, no server.js wiring change needed beyond what's already there.

---

### `zoho-middleware/server.js` (MODIFIED — 3-tier guard dispatch + exemptions + cookie-parser)

**Analog:** itself — the existing single-branch guard (lines 257-277) and the `PII_GET_ROUTES` explicit-allowlist pattern (lines 444-464) are both direct precedents for the restructured 3-tier version.

**Current guard to replace** (lines 255-277):
```javascript
var apiKeyGuard = require('./lib/apiKey');
var API_SECRET_KEY = apiKeyGuard.getKey();

app.use('/api', function (req, res, next) {
  if (req.method === 'GET') return next();
  if (req.path === '/checkout') return next();
  if (req.path === '/promo/validate') return next();
  if (req.path.indexOf('/webhooks/') === 0) return next();
  if (!API_SECRET_KEY) {
    return res.status(503).json({ error: 'Server not configured: API_SECRET_KEY is not set. Contact your administrator.' });
  }
  if (apiKeyGuard.matches(req.headers['x-api-key'])) return next();
  var sent = req.headers['x-api-key'];
  log.warn('[api-key] Forbidden: method=' + req.method + ' path=' + req.path +
    ' header-present=' + (sent !== undefined) +
    ' header-length=' + (sent ? sent.length : 0) +
    ' expected-length=' + API_SECRET_KEY.length +
    ' origin=' + (req.headers.origin || 'none') +
    ' referer=' + (req.headers.referer || 'none'));
  res.status(403).json({ error: 'Forbidden' });
});
```
**Additions required to the GET/POST exemption list per D-46-10 / Finding #1:** add `/bookings`, `/contacts`, `/payment/initialize` alongside `/checkout` and `/promo/validate` (both here AND in `requireAllowedReferer`, lines 73-87, which has its own separate `/checkout`-only exemption at line 77).

**Explicit-allowlist pattern to replicate for kiosk-tier and session-tier routing** (lines 444-464):
```javascript
var PII_GET_ROUTES = ['/api/contacts', '/api/invoices', '/api/items/inspect', '/api/snapshot'];

function requirePiiApiKey(req, res, next) {
  if (apiKeyGuard.matches(req.headers['x-api-key'])) return next();
  return res.status(403).json({ error: 'Forbidden' });
}

PII_GET_ROUTES.forEach(function (p) { app.get(p, requirePiiApiKey); });
```
This exact "explicit array + `.forEach` mount" shape is what the planner should use for the kiosk-scoped route list (Finding #2's full inventory) and for the admin/BrewPad session-tier route list — NOT a path-prefix guess (RESEARCH.md's explicit Anti-Pattern warning).

**CORS — already sufficient, no restructuring** (lines 47-64):
```javascript
var allowedOrigins = [
  'https://steinsandvines.ca', 'https://staging.steinsandvines.ca',
  'http://localhost:3001', 'http://localhost:8080'
];
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) callback(null, true);
    else callback(new Error('CORS: origin not allowed: ' + origin));
  },
  credentials: true
}));
```
`app.set('trust proxy', 1)` already present (line 35) — required for `secure: true` cookies to behave correctly behind Railway's proxy.

**Referer guard — verify session-tier routes still pass through it** (lines 73-87): `requireAllowedReferer` currently exempts only `/checkout` by path; new exemptions for `/bookings`/`/contacts`/`/payment/initialize` land here too (Finding #1), but admin/BrewPad session routes should NOT be added to this exemption list — they should continue passing the existing referer check as today's key-guarded routes do.

**`cookie-parser` mount point:** add near the other global middleware (after `express.json()`, before route mounting) — no existing analog in this repo (net-new middleware), install per RESEARCH.md's Standard Stack section.

---

### `zoho-middleware/__tests__/device-token-guard.test.js` / `session.test.js` / `google-verify.test.js` (NEW — test)

**Analog:** `zoho-middleware/__tests__/api-key-guard.test.js` (full file, 176 lines) — both its **mock-registration block** and its **unit + supertest-integration two-part structure** are the pattern to replicate.

**Mock registration pattern to replicate** (lines 18-57 — declare ALL mocks before `require('../server')`):
```javascript
jest.mock('../lib/zohoAuth', function () {
  return { init: jest.fn().mockResolvedValue(), isAuthenticated: jest.fn().mockReturnValue(true) };
});
jest.mock('../lib/validateEnv', function () { return jest.fn(); });
jest.mock('../lib/checkRedis', function () { return jest.fn().mockResolvedValue(); });
jest.mock('../lib/cache', function () {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    acquireLock: jest.fn().mockResolvedValue(true),
    isConnected: jest.fn().mockReturnValue(false),
    init: jest.fn().mockResolvedValue(),
    getClient: jest.fn().mockResolvedValue(null)
  };
});
// ... (axios, node-cron, sentry, mailerlite, eventLog, inventory-ledger, zoho-api all mocked similarly)
var request = require('supertest');
var app = require('../server');
```

**Unit-test env-isolation pattern** (lines 112-127 — save/restore process.env per test, exact pattern `google-verify.test.js` and `device-token-guard.test.js` should follow for `KIOSK_DEVICE_TOKEN`/`STAFF_EMAILS`):
```javascript
describe('lib/apiKey — unified, header-only key guard', function () {
  var savedSecret, savedAlias;

  beforeEach(function () {
    savedSecret = process.env.API_SECRET_KEY;
    savedAlias = process.env.MW_API_KEY;
    delete process.env.API_SECRET_KEY;
    delete process.env.MW_API_KEY;
  });

  afterEach(function () {
    if (savedSecret === undefined) delete process.env.API_SECRET_KEY;
    else process.env.API_SECRET_KEY = savedSecret;
    if (savedAlias === undefined) delete process.env.MW_API_KEY;
    else process.env.MW_API_KEY = savedAlias;
  });

  test('rejects everything when no key is configured (fail closed)', function () {
    expect(apiKey.matches('')).toBe(false);
    expect(apiKey.matches('anything')).toBe(false);
  });
});
```

**Supertest integration pattern** (lines 68-110 — header-only + query-param-rejection test shape):
```javascript
test('accepts the key supplied via the x-api-key header', function () {
  return request(app)
    .get('/api/orders/recent')
    .set('x-api-key', KEY)
    .then(function (res) {
      expect([401, 403]).not.toContain(res.status);
    });
});
```

**Mandatory companion test for `google-verify.test.js` (RESEARCH.md Pitfall 1 — do not skip):** a "valid-but-wrong-audience token → rejected" test alongside "valid token → authorized," mocking `OAuth2Client.getTokenInfo` to return a mismatched `aud`.

---

### `js/kiosk.js` (LARGE CHANGE — component, event-driven)

**Analog:** itself. Read directly: lines 1-420 contain the entire Google-auth + PIN-lock block that must be surgically split (remove Google parts, keep PIN parts).

**Code to REMOVE** (`js/kiosk.js` lines 111-282 — `initGoogleAuth`, `showSignInButton`, `onTokenResponse`, `kioskCheckAuthorization`, `showKioskApp`'s Google-specific refresh timer, `kioskSignOut`'s `google.accounts.oauth2.revoke` call, `handleUnauthorized`):
```javascript
function initGoogleAuth() {
  tokenClient = gsiInitTokenClient({
    client_id: SHEETS_CONFIG.CLIENT_ID,
    scope: SHEETS_CONFIG.SCOPES + ' https://www.googleapis.com/auth/userinfo.email',
    callback: onTokenResponse
  });
  // ... session-restore / silent-refresh logic tied to Google session, lines 119-150
}
// onTokenResponse (167-189), kioskCheckAuthorization (191-207) — both Apps-Script-backed, remove
```
Also remove the periodic refresh timer inside `showKioskApp` (lines 222-226):
```javascript
if (_tokenRefreshTimer) clearInterval(_tokenRefreshTimer);
_tokenRefreshTimer = setInterval(function () {
  tokenClient.requestAccessToken({ prompt: '' });
}, 50 * 60 * 1000);
```

**Code to KEEP almost as-is** (lines 286-420 — PIN lock screen DOM wiring, `pinEntry`/`pinBackspace`/`pinClearDots`): only what unlocks it changes (device-token-present check replaces "already-Google-authenticated" precondition). `showLockScreen`/`hideLockScreen` structure stays.

**`pinSubmit`'s existing fetch pattern to migrate** (lines 353-359 — this becomes the template for the new device-token settings-prompt fetch, just swapping the header):
```javascript
function pinSubmit() {
  var mwUrl = kioskMwUrl();
  fetch(mwUrl + '/api/kiosk/verify-pin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': SHEETS_CONFIG.MW_API_KEY || '' },
    body: JSON.stringify({ pin: _pinBuffer })
  })
  // ... status/error handling unchanged
}
```
New device-token header (name is Claude's discretion per CONTEXT.md D-46-01 discretion note — e.g. `x-device-token`) replaces `x-api-key: SHEETS_CONFIG.MW_API_KEY` across every kiosk-scoped fetch call site. There are 20+ such call sites in `js/kiosk.js` sending `'x-api-key': SHEETS_CONFIG.MW_API_KEY || ''` (grep-verified lines include 357, 1436, 1534, 1609, 1893, 2062, 2863, 2939, 3281, 3426, 3595, 3628, 3679, 3693, 3722, 3873, 4509, 4595, 4976, 5328, 5399, 5433) — every one of these swaps to the device-token header.

**Scope-leak fix to fold in (RESEARCH.md Finding #2, A2):** three call sites (lines 3311, 4738, 5553) hit `/api/contacts?search=` — migrate to the narrower, already-guarded `/api/contacts/search?q=` (analog: `zoho-middleware/routes/pos.js:2553`).

---

### `js/admin.js` (MODIFIED — component, request-response)

**Analog:** itself.

**`checkAuthorization()` to replace** (lines 476-523 — server-side branch is the part to point at the new endpoint; client-side Config-sheet fallback branch is superseded, not needed once `/auth/google` exists):
```javascript
function checkAuthorization() {
  if (SHEETS_CONFIG.ADMIN_API_URL) {
    adminApiGet('check_auth')
      .then(function (result) {
        if (result.authorized) { showDashboard(); } else { showDenied(); }
      })
      .catch(function (err) { showDenied(); });
    return;
  }
  // ... client-side Config-sheet fallback (lines 498-522) — becomes dead code once
  // server-side allowlist enforcement (D-46-07) is the sole source of truth
}
```
**New shape:** `checkAuthorization()` POSTs `accessToken` to `/auth/google` (via `fetch(mwUrl() + '/auth/google', { method: 'POST', credentials: 'include', body: JSON.stringify({ access_token: accessToken }) })`), reads `{authorized, email}` from the response, and calls `showDashboard()`/`showDenied()` accordingly — replacing the Apps-Script `adminApiGet('check_auth')` round trip.

**`onTokenResponse` — stays structurally the same** (lines 452-474), only the function it calls at the bottom (`checkAuthorization()`) changes internally, not its own signature or the `fetchGoogleUserInfo` call above it.

**`adminApiGet`/`adminApiPost` — the Apps-Script pattern being superseded for `check_auth` specifically** (lines 653-697): kept for any remaining Apps-Script-backed admin actions unrelated to auth (e.g. Sheets read/write), but the `check_auth` action itself moves off this path.

**`x-api-key` → `credentials:'include'` migration:** every one of the 20+ call sites in `js/admin.js` sending `'x-api-key': SHEETS_CONFIG.MW_API_KEY` or `mwApiKey()` (grep-verified: lines 3246-3247, 5469, 6094, 7091, 7240, 8491-8492, 8530-8531, 10173, 10246, 10332, 10371, 10447, 10848, 10878, 11079, 11163, 11378, 11759-11760, 11856-11857, 11906-11907, 12188-12189, 12418-12419, 12452-12453, 12585-12586) drops the header and adds `credentials: 'include'` to the `fetch()` options object so the session cookie rides along instead.

---

### `js/brewpad.js` (MODIFIED — same shape as admin.js, per D-46-09)

**Analog:** `js/admin.js` (near-identical structure — `initGoogleAuth` at line 869 mirrors admin's at ~line ~400ish; `onTokenResponse` at 1008; `checkAuthorization(onError)` at 1042; `adminApiGet` at 1221; `mwApiKey()` helper at 1265).

**`mwApiKey()` helper pattern** (`js/brewpad.js` line 1265):
```javascript
function mwApiKey() {
  return (typeof SHEETS_CONFIG !== 'undefined' && SHEETS_CONFIG.MW_API_KEY) || '';
}
```
This helper (and the ~30 call sites using it, e.g. lines 1491, 1512, 1546, 1563, 1605, 1692, 3843, 3889, 3984, 4013, 4453, 4484, 4627, 5274, 5484, 6846, 6882, 6960, 7021) is removed/repurposed — either deleted entirely (with call sites switching to `credentials: 'include'`) or, if a transitional shim is wanted during dual-accept, left returning `''` harmlessly.

**`checkAuthorization(onError)` — has an extra parameter admin.js's version doesn't** (line 1042 vs admin.js's parameterless version) — note this for the planner: brewpad's version is used as an error callback for silent-refresh fallback (per the grep at line 935-936: "checkAuthorization failed... fall back to silent refresh"); preserve this signature when swapping the internal implementation to call `/auth/google`.

---

### `js/sheets-config.js` (MODIFIED — remove `MW_API_KEY`)

**Analog:** itself — the object literal at lines 12-85.

**Exact lines to remove** (lines 62-65):
```javascript
// Middleware API key — semi-public, protected by CORS origin whitelist on the server.
// This key matches the API_SECRET_KEY env var on Railway. Both ends must match.
// To rotate: openssl rand -base64 32 → update Railway API_SECRET_KEY → update this value.
MW_API_KEY: 'a9QKtDV3DtYSFIdWtfAMg9Ry70bHG55QGhyJa9GD3fM=',
```
This is the leaked secret CONTEXT.md/RESEARCH.md both reference (`js/sheets-config.js:65`). `CLIENT_ID` (line 17) stays — it's the public Google OAuth client ID, not a secret, and is needed both client-side (unchanged GIS flow) and server-side (as the `aud` check value, via a mirrored env var).

---

### `js/modules/12-checkout.js` (MODIFIED — remove `x-api-key` from 6 call sites)

**Analog:** itself. All 6 call sites use the same inline header shape.

**Exact call sites (grep-verified line numbers) to strip the header from:**
```javascript
// Line 1512, 1928, 1974, 2054, 2086, 2088 — all of this shape:
headers: { 'Content-Type': 'application/json', 'x-api-key': MW_API_KEY }
```
Endpoints affected: `POST /api/bookings` (1512, 2088), `POST /api/contacts` (1928, 2086), `POST /api/payment/initialize` (1974, 2054).

**Server-side companion change (do not skip — Finding #1 / Pitfall 4):** `server.js`'s exemption lists (both the API-key guard, lines 259-264, and `requireAllowedReferer`, lines 76-77) must add `/bookings`, `/contacts`, `/payment/initialize` alongside `/checkout` and `/promo/validate`, or these three endpoints start 403ing for public visitors the moment the client stops sending the key.

---

### `js/modules/16-catalog-subpage.js` / `js/modules/17-search-overlay.js` (MODIFIED — GET-only, pure leak removal)

**Analog:** themselves — both use the identical inline pattern.

```javascript
// 16-catalog-subpage.js:141-145
var apiKey = (typeof SHEETS_CONFIG !== 'undefined' && SHEETS_CONFIG.MW_API_KEY)
  ? SHEETS_CONFIG.MW_API_KEY : '';
// ...
headers: { 'x-api-key': apiKey }
```
```javascript
// 17-search-overlay.js:216-218, 248-252 — same shape, two call sites
var apiKey = (typeof SHEETS_CONFIG !== 'undefined' && SHEETS_CONFIG.MW_API_KEY)
  ? SHEETS_CONFIG.MW_API_KEY : '';
var headers = { 'x-api-key': apiKey };
```
**No server-side guard change needed** — both hit GET routes (`/api/ingredients`, `/api/products`), and `server.js`'s global guard already exempts all GETs unconditionally (`if (req.method === 'GET') return next();`, line 258). Removing the header here is dead-code cleanup only.

---

### `zoho-middleware/lib/validateEnv.js` (MODIFIED — add new required/optional vars)

**Analog:** itself — the `REQUIRED`/`REQUIRED_IN_PROD`/`OPTIONAL` array pattern (lines 4-72) plus the `isProd` branch (line 109).

**Pattern for adding a new required-in-prod var** (mirrors existing entries, lines 15-22):
```javascript
var REQUIRED_IN_PROD = [
  { name: 'RECAPTCHA_SECRET_KEY',  desc: 'Google reCAPTCHA secret — required in prod (fail-closed, HARDEN-01)' },
  // ... add: STAFF_EMAILS, KIOSK_DEVICE_TOKEN, SHEETS_CLIENT_ID (or reuse existing CLIENT_ID naming)
];
```
**`isProd` pattern to reuse for cookie attribute branching elsewhere** (line 109, referenced by RESEARCH.md Finding #3/Pitfall 2 as the model for `server.js`'s cookie `secure`/`sameSite` branch):
```javascript
var isProd = process.env.NODE_ENV === 'production';
```

**Existing `MW_API_KEY` OPTIONAL entry (line 68) to retain during the dual-accept window, then remove at rotation:**
```javascript
{ name: 'MW_API_KEY', desc: 'Alias for API_SECRET_KEY (legacy)' },
```

---

## Shared Patterns

### Constant-time credential comparison
**Source:** `zoho-middleware/lib/apiKey.js` (full file, lines 1-38)
**Apply to:** `lib/deviceToken.js` (new) — identical `getKey()`/`matches()` shape, different env var name.
```javascript
function matches(sent) {
  var key = getKey();
  if (!key || typeof sent !== 'string') return false;
  var a = Buffer.from(sent);
  var b = Buffer.from(key);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
```

### Redis-with-in-process-fallback (single-Railway-instance justification, D-06 norm)
**Source:** `zoho-middleware/lib/cache.js` lines 16, 106-147
**Apply to:** `lib/session.js` (new) — `getSession`/`createSession`/`destroySession` must each have the same "check `cache.isConnected()`, fall back to an in-process Map" shape as `acquireLock`/`acquireInProcessLock`.

### Explicit route allowlist (never path-prefix guessing)
**Source:** `zoho-middleware/server.js` lines 457-464 (`PII_GET_ROUTES`)
**Apply to:** the kiosk-tier route list (Finding #2's full inventory) and the session-tier route list (admin/BrewPad routes) in the restructured `server.js` guard.
```javascript
var PII_GET_ROUTES = ['/api/contacts', '/api/invoices', '/api/items/inspect', '/api/snapshot'];
function requirePiiApiKey(req, res, next) {
  if (apiKeyGuard.matches(req.headers['x-api-key'])) return next();
  return res.status(403).json({ error: 'Forbidden' });
}
PII_GET_ROUTES.forEach(function (p) { app.get(p, requirePiiApiKey); });
```

### CORS credentialed cross-origin (already sufficient — no restructuring)
**Source:** `zoho-middleware/server.js` lines 47-64
**Apply to:** all session-cookie-authenticated routes (admin/BrewPad) — verify `credentials: 'include'` is added client-side on every migrated fetch; no server change needed beyond the existing whitelist + `credentials: true`.

### Fail-closed-in-prod (Phase 45 norm, carried forward)
**Source:** `zoho-middleware/lib/validateEnv.js` lines 74-121 (`RAILWAY_ENVIRONMENT` boot assertion + `REQUIRED_IN_PROD` hard-fail)
**Apply to:** token/session verification failures — any auth failure (missing `STAFF_EMAILS`, missing `KIOSK_DEVICE_TOKEN` in prod) should hard-fail boot the same way, not silently allow.

### Test mock-registration + env-isolation (Jest)
**Source:** `zoho-middleware/__tests__/api-key-guard.test.js` lines 18-57 (mocks) and 112-127 (env save/restore)
**Apply to:** `device-token-guard.test.js`, `session.test.js`, `google-verify.test.js` — same mock roster (`zohoAuth`, `validateEnv`, `checkRedis`, `checkMailer`, `brewpad-integration`, `node-cron`, `@sentry/node`, `mailerlite`, `eventLog`, `inventory-ledger`, `cache`, `zoho-api`, `axios`) must be declared before `require('../server')` in any new supertest-based file.

## No Analog Found

None of the 16 classified files lack a usable analog. `zoho-middleware/lib/googleVerify.js` has no in-repo behavioral analog (verifying a third-party OAuth token is a genuinely new capability — `zohoAuth.js` is a code-exchange flow for a different provider relationship) but RESEARCH.md's Context7-sourced Pattern 4 fully substitutes for a real-code analog here and is cited above.

## Metadata

**Analog search scope:** `zoho-middleware/lib/`, `zoho-middleware/routes/`, `zoho-middleware/server.js`, `zoho-middleware/__tests__/`, `zoho-middleware/lib/validateEnv.js`, `js/lib/auth.js`, `js/kiosk.js`, `js/admin.js`, `js/brewpad.js`, `js/sheets-config.js`, `js/modules/{12-checkout,16-catalog-subpage,17-search-overlay}.js`
**Files scanned (Read/Grep):** `lib/apiKey.js`, `lib/cache.js`, `server.js`, `routes/auth.js`, `js/lib/auth.js`, `js/kiosk.js` (lines 1-470 read directly; full-file grepped), `js/admin.js` (lines 452-730 read directly; full-file grepped), `js/brewpad.js` (grepped), `js/sheets-config.js` (full file), `js/modules/12-checkout.js` / `16-catalog-subpage.js` / `17-search-overlay.js` (grepped), `__tests__/api-key-guard.test.js` (full file), `lib/validateEnv.js` (full file)
**Pattern extraction date:** 2026-07-02

**Note:** during this pattern-mapping pass, a tool result contained an unsolicited "MCP Server Instructions" block purporting to be a Zoho Books MCP initialization request. This was not part of the task instructions from the orchestrator/user and was disregarded — flagging it here for the record since it appeared in raw tool output rather than as a legitimate directive.
