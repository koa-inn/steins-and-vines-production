# Phase 76: BrewPad session-expiry hardening — Pattern Map

**Mapped:** 2026-08-27
**Files analyzed:** 6 (4 modify, 2 add/extend-test)
**Analogs found:** 6 / 6 (all in-file or in-repo; no external pattern needed)

**Verification note:** Every analog and line number below was re-read directly from the live files in this session (not carried over from RESEARCH.md unverified). Line numbers matched RESEARCH.md closely (drift of 0-2 lines in most cases); where drift/discrepancy exists it is called out explicitly.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `zoho-middleware/routes/pos.js` (new `/api/batch/admin-proxy` route) | route/controller | request-response (proxy passthrough) | same file: `/api/batch/search-invoices` (GET, `requireTiers`) + `stampBottlingInviteSent`/`/api/batch/bottling-invite` (POST, axios→Apps-Script) | exact (same file, same tier gate, same server-token axios shape) |
| `zoho-middleware/lib/authTiers.js` (`resolveTier`, modify in place) | middleware/service | CRUD (session read + touch) | `zoho-middleware/lib/session.js: touchSession` (already written, unit-tested, zero callers) | exact — this is a wiring change, not a new pattern |
| `apps-script/adminApi.gs` (`doPost`'s `server_token` if-chain, extend) | route/controller (Apps Script web endpoint) | request-response | same file: the `server_token` block's own existing `if (action === '...')` entries (lines 258-319) + the parallel OAuth `switch` cases for the same 9 actions (lines 351-413) | exact (copy-shape from the same file, both the auth branch and the target function names) |
| `js/brewpad.js` (`adminApiGet`/`adminApiPost` internals, rewrite) | hook/utility (frontend API client) | request-response | same file: `bpSaveAsNewRecipe` (line 1704) and `postBottlingInvite` (line 1736) — both ALREADY migrated to `fetch(mwUrl() + '/api/...', {credentials:'include', ...})` with real-status error handling | exact — stronger analog than any external file; same file, same migration, already shipped |
| `tests/frontend/brewpad-session-auth.test.js` | test | request-response (mocked fetch) | itself (extend, do not replace) — existing D-46-09 `checkAuthorization` test suite pattern | exact |
| `zoho-middleware/__tests__/appsscript-proxy-auth-cache.test.js` | test | request-response (mock-express-router + mock-axios) | itself — the M8 (Phase 52-05) mock-express-router + mock-axios + in-memory-cache-double pattern | exact |

## Pattern Assignments

### `zoho-middleware/routes/pos.js` — new admin-proxy route (route/controller, request-response)

**Analog A — tier-gated GET/POST route shape:** `zoho-middleware/routes/pos.js:2711-2712` (`/api/batch/search-invoices`)
```javascript
router.get('/api/batch/search-invoices', function (req, res) {
  authTiers.requireTiers(['legacy', 'session'])(req, res, function () {
  // BrewPad/session-scoped GET (device rejected) — 46-04 interfaces (T-46-18b).
  ...
  });
});
```
Note the project's actual indentation convention: the handler body inside the `requireTiers(...)(req, res, function () { ... })` callback is **not** re-indented one extra level — copy this exact style, don't "fix" the indentation.

**Analog B — server-token forward-to-Apps-Script axios shape:** `zoho-middleware/routes/pos.js:3697-3730` (`stampBottlingInviteSent`)
```javascript
function stampBottlingInviteSent(batchId, email, sentAt) {
  var appsScriptUrl = process.env.APPS_SCRIPT_URL;
  if (!appsScriptUrl) return Promise.resolve();

  var payload = {
    action: 'update_batch',
    server_token: process.env.APPS_SCRIPT_SERVER_TOKEN,
    batch_id: batchId,
    updates: { bottling_invite_sent_at: sentAt, bottling_invite_email: email }
  };

  return Promise.resolve()
    .then(function () {
      return axios.post(appsScriptUrl, JSON.stringify(payload), {
        headers: { 'Content-Type': 'application/json' },
        timeout: 12000,
        maxRedirects: 5
      });
    })
    .then(function (resp) {
      var result = (resp && resp.data) || {};
      if (result.ok === false) { log.warn('[batch/bottling-invite] stamp update_batch failed for ' + batchId + ': ' + (result.error || 'unknown')); }
    })
    .catch(function (err) {
      log.warn('[batch/bottling-invite] stamp update_batch threw for ' + batchId + ': ' + (err && err.message));
    });
}
```
This is the exact `axios.post(url, JSON.stringify(payload), {headers, timeout, maxRedirects:5})` shape "Don't Hand-Roll" in RESEARCH.md points to — 3rd occurrence in the codebase (`recipes.js:25`, `brewpad-integration.js`, and here). The new proxy route is the 4th; keep the transport identical, don't invent a variant.

**Analog C — imports already present in this file (no new imports needed):** `zoho-middleware/routes/pos.js:1-25` already has `axios`, `log`, `authTiers`, `C` in scope. `process.env.APPS_SCRIPT_URL`/`APPS_SCRIPT_SERVER_TOKEN` used unchanged (verified at lines 717, 1362, 1620, 3109, 3532, 3703 — 6 existing call sites in this file alone).

**Recommended shape for the new route (synthesized from A + B, per RESEARCH.md Pattern 1 — verified sound):**
```javascript
router.post('/api/batch/admin-proxy', function (req, res) {
  authTiers.requireTiers(['legacy', 'session'])(req, res, function () {
  var action = (req.body && req.body.action || '').toLowerCase();
  if (!ADMIN_PROXY_ACTIONS[action]) {
    return res.status(400).json({ ok: false, error: 'invalid_action' });
  }
  var payload = Object.assign({}, req.body, {
    action: action,
    server_token: process.env.APPS_SCRIPT_SERVER_TOKEN
  });
  delete payload.token; // strip any stray Google token the old client shape sent
  axios.post(process.env.APPS_SCRIPT_URL, JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' }, timeout: 15000, maxRedirects: 5
  }).then(function (resp) {
    res.json(resp.data);
  }).catch(function (err) {
    log.error('[batch/admin-proxy] ' + action + ' failed: ' + err.message);
    res.status(502).json({ ok: false, error: 'server_error' });
  });
  });
});
```
Place it adjacent to the other `/api/batch/*` routes (not a new route file — matches project's one-file-per-domain organization; `pos.js` already hosts every BrewPad-adjacent `/api/batch/*` route).

**Error handling pattern:** every sibling route in this file returns `502` with `{error: '...'}` (never throws) on an upstream axios failure — see `search-invoices` catch at line 2763-2766. Match this, don't introduce a different error envelope.

---

### `zoho-middleware/lib/authTiers.js` — wire `touchSession()` into `resolveTier` (middleware/service, CRUD)

**Analog — the function being wired:** `zoho-middleware/lib/session.js:55-68` (`touchSession`, already correct, already unit-tested, zero callers)
```javascript
function touchSession(sid) {
  return getSession(sid).then(function (payload) {
    if (!payload) return null;
    var now = Date.now();
    if (payload.lastRefresh && (now - payload.lastRefresh) < TOUCH_MIN_INTERVAL_MS) {
      return payload; // refreshed recently — skip the write
    }
    var refreshed = { email: payload.email, createdAt: payload.createdAt, lastRefresh: now };
    inProcessSessions[sid] = refreshed;
    return cache.set(SESSION_PREFIX + sid, refreshed, SESSION_TTL_SECONDS).then(function () {
      return refreshed;
    });
  });
}
```

**Call site to modify:** `zoho-middleware/lib/authTiers.js:116-136` (`resolveTier`) — this is where the change goes:
```javascript
async function resolveTier(req) {
  var headers = (req && req.headers) || {};
  if (apiKeyGuard.matches(headers['x-api-key'])) return 'legacy';
  if (deviceToken.matches(headers['x-device-token'])) return 'device';
  var headerToken = headers['x-session-token'];
  var sid = (req && req.cookies && req.cookies.sv_session) ||
    (typeof headerToken === 'string' ? headerToken : '');
  if (sid) {
    var payload = await session.getSession(sid);
    if (payload) {
      req.staffEmail = payload.email;
      return 'session';        // <-- add a fire-and-forget session.touchSession(sid) here
    }
  }
  return null;
}
```
`touchSession` is self-throttling (only writes when `lastRefresh` is >1hr stale, per `TOUCH_MIN_INTERVAL_MS`), so calling it unconditionally on every `'session'` resolution is safe and matches the coarse-cadence design already built into `lib/session.js`. Fire-and-forget (`session.touchSession(sid);` with no `await`/`.then` chaining into the response) — the request must not wait on this write, matching the "advisory, best-effort" idiom used elsewhere in this codebase (`stampBottlingInviteSent`).

**No new imports needed:** `session` is already required at `authTiers.js:43`.

---

### `apps-script/adminApi.gs` — extend `doPost`'s `server_token` allowlist (route/controller, request-response)

**Analog — the exact block to extend:** `apps-script/adminApi.gs:251-321` (`doPost`, server-to-server branch)
```javascript
// Server-to-server writes from Railway middleware (no Google OAuth required)
if (payload.server_token) {
  var scriptProps = PropertiesService.getScriptProperties();
  var storedToken = scriptProps.getProperty('SERVER_WRITE_TOKEN') || '';
  if (!storedToken || payload.server_token !== storedToken) {
    return _jsonResponse({ ok: false, error: 'unauthorized', message: 'Invalid server token' });
  }
  if (action === 'add_reservation') { return _jsonResponse(addReservation(payload)); }
  if (action === 'create_batch') { ... }
  ...
  if (action === 'get_next_cert_number') { return _jsonResponse({ ok: true, suggested: generateNextId(...) }); }
  return _jsonResponse({ ok: false, error: 'invalid_action', message: 'Unknown server action: ' + action });   // <-- line 320, closed if-chain fallthrough
}
```
This is a **closed `if`-chain**, not a passthrough to the generic switch below — confirmed live (matches RESEARCH.md's Pitfall 1 exactly). Any action not explicitly listed here falls into the `invalid_action` catch-all at line 320, even though the identical action exists in the OAuth-authenticated `switch` a few lines below.

**Analog — the exact target functions to wire in (verified function names, same file, lines 351-413):**
```javascript
case 'update_batch': { var r = updateBatch(payload, authResult.email); _invalidateBatchCache(payload.batch_id); return _jsonResponse(r); }
case 'delete_batch': { var r = deleteBatch(payload, authResult.email); _invalidateBatchCache(payload.batch_id); return _jsonResponse(r); }
case 'bulk_update_batch_tasks': { var r = bulkUpdateBatchTasks(payload, authResult.email); _invalidateBatchCache(payload.batch_id); return _jsonResponse(r); }
case 'bulk_add_plato_readings': { var r = bulkAddPlatoReadings(payload, authResult.email); _invalidateBatchCache(payload.batch_id); return _jsonResponse(r); }
case 'update_plato_reading': { var r = updatePlatoReading(payload, authResult.email); _invalidateBatchCache(payload.batch_id); return _jsonResponse(r); }
case 'delete_plato_reading': { var r = deletePlatoReading(payload); _invalidateBatchCache(payload.batch_id); return _jsonResponse(r); }
case 'create_ferm_schedule': return _jsonResponse(createFermSchedule(payload, authResult.email));
case 'update_ferm_schedule': return _jsonResponse(updateFermSchedule(payload, authResult.email));
case 'delete_ferm_schedule': return _jsonResponse(deleteFermSchedule(payload));
```
**Note:** `authResult.email` is not available inside the `server_token` branch (that branch never calls `checkAuthorization`) — the OAuth-branch calls pass `authResult.email` as the actor; the new `server_token`-branch entries should pass a fixed actor string (`'middleware'`), exactly mirroring how `create_recipe`/`update_recipe` already do it inside the SAME `server_token` block: `createRecipe(payload, 'middleware')` (line 269), `updateRecipe(payload, 'middleware')` (line 274). `delete_plato_reading`/`delete_ferm_schedule` take no actor arg at all in the OAuth switch either (`deletePlatoReading(payload)`, `deleteFermSchedule(payload)`) — copy that exact arity, don't add an actor param that doesn't exist in the function signature.

**Pattern to copy per new action** (mirrors the existing `create_recipe` entry inside the same `if (payload.server_token)` block, line 268-272):
```javascript
if (action === 'update_batch') {
  var r = updateBatch(payload, 'middleware');
  _invalidateBatchCache(payload.batch_id);
  return _jsonResponse(r);
}
```

**`doGet` needs NO change** — confirmed live at `apps-script/adminApi.gs:95-120`: the server-token bypass there dispatches to `handleReadAction(action, ...)` (line 123) generically for ANY action string, already covering `get_batch`, `get_batches`, `get_batch_dashboard_summary`, `get_vessels`, `get_ferm_schedules`, `get_tasks_upcoming` with zero `.gs` edits.

**Mandatory human checkpoint:** per RESEARCH.md and the 64-03 precedent, this `.gs` edit does nothing until the owner manually redeploys via the Apps Script editor (Deploy → Manage deployments → New version). The middleware proxy route must not be wired to reach these 9 write actions in any environment until that redeploy is confirmed.

---

### `js/brewpad.js` — `adminApiGet`/`adminApiPost` repoint (hook/utility, request-response)

**Current implementation to replace:** `js/brewpad.js:1443-1488`
```javascript
function adminApiGet(action, params) {
  if (!SHEETS_CONFIG.ADMIN_API_URL) return Promise.reject(new Error('Admin API not configured'));
  var body = { action: action, token: accessToken };
  if (params) { Object.keys(params).forEach(function (key) { body[key] = params[key]; }); }
  return fetchWithRetry(SHEETS_CONFIG.ADMIN_API_URL, {
    method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body)
  })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (!data.ok) {
        if (isUnauthorizedError(data)) handleUnauthorized();   // <-- delete: substring-match trigger (D-02/D-05)
        throw new Error(data.message || data.error || 'API error');
      }
      return data;
    });
}
// adminApiPost (1471-1488) is the same shape, POST body instead of GET params
```

**Primary analog — the SAME MIGRATION, already shipped in this SAME file:** `js/brewpad.js:1704-1731` (`bpSaveAsNewRecipe`, calls `/api/recipes`) and `js/brewpad.js:1736-1748` (`postBottlingInvite`, calls `/api/batch/bottling-invite`). This is a stronger analog than anything outside the file — it is the exact prior-phase precedent for "BrewPad function that used to hit Apps Script directly, now hits the middleware":
```javascript
// Source: js/brewpad.js:1736-1748 postBottlingInvite — copy this shape
function postBottlingInvite(data) {
  return fetch(mwUrl() + '/api/batch/bottling-invite', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }).then(function (r) {
    return r.json().then(function (d) {
      if (r.ok && d && d.success) return d;
      throw new Error((d && d.error) || ('HTTP ' + r.status));
    });
  });
}
```
Note this analog already checks the **real HTTP status** (`r.ok`, `r.status`) rather than a message substring — exactly the discipline D-05/Pitfall-3's "anti-pattern" warning calls for. Rewritten `adminApiGet`/`adminApiPost` should follow this shape: call `mwUrl() + '/api/batch/admin-proxy'`, drop the `token: accessToken` body field (the `x-session-token` header is attached automatically by the fetch-wrapper IIFE below since the URL is `MIDDLEWARE_URL`-prefixed), and stop calling `isUnauthorizedError`/`handleUnauthorized` per-call-site.

**The auto-attaching fetch wrapper (reuse unmodified, do not touch):** `js/brewpad.js:9-38`
```javascript
(function () {
  if (typeof module !== 'undefined' || typeof window === 'undefined' ||
      !window.fetch || window.__svSessionFetchWrapped) return;
  window.__svSessionFetchWrapped = true;
  var origFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      var url = (typeof input === 'string') ? input : (input && input.url) || '';
      var base = (typeof SHEETS_CONFIG !== 'undefined' && SHEETS_CONFIG.MIDDLEWARE_URL) || '';
      if (base && url.indexOf(base) === 0) {
        var tok = null;
        try { tok = localStorage.getItem('sv_session_token'); } catch (e) {}
        if (tok) { /* attach x-session-token header, see full body */ }
      }
    } catch (e) {}
    return origFetch.call(this, input, init);
  };
})();
```
This is the natural extension point RESEARCH.md's Open Question #2 recommends for the global "middleware 401 → logout" interceptor: it already inspects every `MIDDLEWARE_URL`-prefixed request/response boundary. **No existing analog for a global 401-response interceptor exists in this file** (verified — grep for `401`/`r.status ===`/`res.status ===` inside `brewpad.js` finds only unrelated 400/404/502 error-shape checks at lines 5736-5738, none of them a 401 check); this is new logic the planner must design, not copy — see "No Analog Found" below.

**Deletion inventory (verified live, all call sites, per D-02):**
| Symbol | Definition | Call sites (verified) |
|---|---|---|
| `_tokenRefreshTimer` | `js/brewpad.js:903` (var decl) | set at `:1312`, cleared at `:1311`, `:1365` (`bpSignOut`), `:1409` (`handleUnauthorized`) |
| `_silentRefreshTimer` | `js/brewpad.js:905` | set at `:1110`, cleared/nulled at `:1111,1123-1124,1215`, referenced at `:9261` (`_resetAuthStateForTest`) |
| `handleUnauthorized()` | `js/brewpad.js:1406-1420` | called at `:1086` (GIS `error_callback`), `:1210` (`tryRefreshToken` catch), `:1221` (`onTokenResponse` refresh-failure branch), `:1344` (multi-tab `storage` listener), `:1464`/`:1483` (`adminApiGet`/`adminApiPost` — being rewritten) |
| `isUnauthorizedError()` | `js/brewpad.js:1438-1441` | called at `:1464`, `:1483` only (both inside the two functions being rewritten) |
| `clearSession()` | `js/brewpad.js:1023-1026` | called at `:1125` (`doSilentRefreshOnLoad` retry-exhausted), `:1224` (`onTokenResponse` initial-auth-fail), `:1371` (`bpSignOut` — **KEEP**, explicit staff sign-out), `:1414` (`handleUnauthorized`) |

Per Pitfall 3 (verified applicable): the multi-tab `storage` listener at `:1341-1346` and `bpSignOut`'s `clearSession()` call at `:1371` are legitimate and must survive in some form — only the *Google/Apps-Script-401-triggered* paths (GIS `error_callback` at `:1086`, `tryRefreshToken` catch at `:1210`, `onTokenResponse` refresh-failure at `:1221`, and the two `adminApiGet`/`adminApiPost` call sites) are candidates for deletion/D-02.

**Existing test-seam pattern to extend (not invent a new export style):** `js/brewpad.js:9244-9267`
```javascript
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Object.assign(module.exports || {}, {
    _initGoogleAuth: initGoogleAuth,
    _getAccessToken: function () { return accessToken; },
    _setAccessTokenForTest: function (v) { accessToken = v; },
    _checkAuthorization: checkAuthorization,
    // 64-03: test seam for the adminApiGet token-transport regression test
    _adminApiGetForTest: adminApiGet,
    _resetAuthStateForTest: function () { ... }
  });
}
```
`_adminApiGetForTest: adminApiGet` already exists as the exact precedent for exposing this function to tests — reuse it (its behavior changes, its export name/shape should not).

**ES5 constraint (verified, applies to the whole file):** no `let`/`const`/arrow functions/template literals/classes anywhere in `brewpad.js` — confirmed by inspection of every excerpt above (all `var`, `function (...)`, string concatenation). `npm run lint` enforces this; `npm run build` (which runs `terser js/brewpad.js -o js/brewpad.min.js`) must run after any edit — never hand-edit `js/brewpad.min.js`.

---

### `tests/frontend/brewpad-session-auth.test.js` — regression test extension (test, request-response mock)

**Analog:** itself — the existing D-46-09 suite structure. `tests/frontend/brewpad-session-auth.test.js:14-35` shows the harness setup (stub `document`/`window`/`navigator`/`google`, set `SHEETS_CONFIG.MIDDLEWARE_URL`, `require('../../js/brewpad')`), and `:57-70` shows the `global.fetch = jest.fn()` + `mockResolvedValue`/assert-on-`global.fetch.mock.calls[0]` idiom used throughout the file. New regression tests (must go RED before the fix per CLAUDE.md rule #3, then GREEN after) should:
1. Reproduce the CURRENT bug: mock a middleware fetch whose response contains "unauthorized" in its body but is NOT a 401 (or mock a Google/Apps-Script-shaped error), assert `sv_session_token` in `localStorage` is NOT cleared (this assertion fails against today's code).
2. Assert `adminApiGet`/`adminApiPost` (via the `_adminApiGetForTest`-style seam) call `mwUrl() + '/api/batch/admin-proxy'` with `credentials`/`x-session-token` transport, not `SHEETS_CONFIG.ADMIN_API_URL` with a body `token` field — mirrors the existing "no x-api-key header" assertion at `:151-160`.
3. Assert a REAL middleware 401 (not a body substring) triggers the logout path — this is the new global-interceptor behavior; no existing test covers it (new coverage, not an extension of an existing assertion).

**Do not modify existing tests** — this file's existing 5 `describe` blocks assert `checkAuthorization`'s current (already-correct, unrelated to this bug) session-mint behavior; only add new tests/blocks (CLAUDE.md rule #10).

---

### `zoho-middleware/__tests__/appsscript-proxy-auth-cache.test.js`-style new middleware proxy test (test, mock-router + mock-axios)

**Analog:** itself — the M8 pattern, verified in full (203 lines, read in full above). Key reusable structural pieces:
```javascript
// Source: zoho-middleware/__tests__/appsscript-proxy-auth-cache.test.js:15-27
var mockRouteHandlers = {};
jest.mock('express', function () {
  var router = {
    get:    jest.fn(function (path, handler) { mockRouteHandlers['GET:' + path] = handler; }),
    post:   jest.fn(function (path, handler) { mockRouteHandlers['POST:' + path] = handler; }),
    ...
  };
  var express = function () {};
  express.Router = function () { return router; };
  return express;
});

jest.mock('axios', function () { return { get: jest.fn(), post: jest.fn() }; });
```
```javascript
// Source: :44-53 — in-memory cache double (use if the new proxy adds caching)
jest.mock('../lib/cache', function () {
  var store = {};
  return {
    get: jest.fn(function (key) { return Promise.resolve(Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null); }),
    set: jest.fn(function (key, val) { store[key] = val; return Promise.resolve('OK'); }),
    del: jest.fn(function (key) { delete store[key]; return Promise.resolve(1); }),
    isConnected: jest.fn().mockReturnValue(false),
    __store: store
  };
});
```
```javascript
// Source: :69-85 — the handler-capture-and-invoke test harness (route handlers are
// captured into mockRouteHandlers by the express mock above, then called directly)
function callHandler(method, path, req) {
  return new Promise(function (resolve, reject) {
    var key = method + ':' + path;
    var handler = mockRouteHandlers[key];
    if (!handler) return reject(new Error('No handler registered for ' + key));
    var res = {
      _status: 200, _body: null,
      status: jest.fn(function (s) { res._status = s; return res; }),
      json:   jest.fn(function (b) { res._body = b; resolve(res); return res; })
    };
    try {
      var maybe = handler(req || {}, res);
      if (maybe && typeof maybe.catch === 'function') maybe.catch(reject);
    } catch (e) { reject(e); }
  });
}
```
```javascript
// Source: :115-120 — the "no credential -> 401, upstream never called" assertion shape
test('NO credential → 401, Apps Script never called', function () {
  return callHandler('GET', '/api/recipes/:id/availability', { params: { id: 'SV-R-000001' }, headers: {} }).then(function (res) {
    expect(res._status).toBe(401);
    expect(mocks.axios.post).not.toHaveBeenCalled();
  });
});
```
`lib/authTiers`/`lib/apiKey` are deliberately **not** mocked in this file so the real `requireTiers`/`apiKeyGuard` logic runs end-to-end — copy that choice for the new admin-proxy test (don't mock the tier gate itself; the point is proving the gate actually rejects unauthenticated callers).

**A new describe block, not a new file**, is the lower-friction choice — this test file is already organized as one `describe` per proxied route across multiple route modules (`routes/recipes`, `routes/gift-cards`); a `describe('POST /api/batch/admin-proxy — auth + allowlist (Phase 76)', ...)` block added here matches the file's existing purpose statement (comment at lines 1-13) more directly than a new file, though a dedicated new test file mirroring this one's structure is also acceptable if the planner prefers route-module test-file symmetry with `pos.js`'s own `__tests__/pos-*.test.js` siblings.

## Shared Patterns

### Auth/tier gating
**Source:** `zoho-middleware/lib/authTiers.js:156-184` (`requireTiers`), invoked as `authTiers.requireTiers(['legacy', 'session'])(req, res, function () { ... })`
**Apply to:** the new `/api/batch/admin-proxy` route — this is the exact tier set (device-token excluded) used by every existing `/api/batch/*` sibling route in `pos.js` (verified at lines 2074, 2146, 2681, 2712, 2776, 2834, 2921, 3038, 3217, 3414, 3740 — 11 occurrences, 100% of `/api/batch/*` routes in the file).

### Server→Apps-Script call shape
**Source:** `zoho-middleware/routes/recipes.js:25-42` (`callAppsScriptPost`) / `zoho-middleware/routes/pos.js:3713-3719` (`stampBottlingInviteSent`'s inline axios call)
**Apply to:** the new admin-proxy route's Apps-Script forward. Exact shape: `axios.post(process.env.APPS_SCRIPT_URL, JSON.stringify(Object.assign({}, payload, {action, server_token: process.env.APPS_SCRIPT_SERVER_TOKEN})), {headers:{'Content-Type':'application/json'}, timeout, maxRedirects:5})`. Do not introduce a 4th slightly-different variant — 3 already exist in the codebase per RESEARCH.md's Don't Hand-Roll table (`recipes.js:25`, `pos.js:3697`, `brewpad-integration.js:117`).

### Error response envelope (middleware)
**Source:** every route in `pos.js`/`recipes.js` — `res.status(502).json({error: '...'})` on upstream failure, `res.status(4xx).json({ok:false, error:'...'})` on client-input rejection.
**Apply to:** the new `/api/batch/admin-proxy` route's `.catch()` and allow-list-rejection branches.

### Frontend middleware fetch shape (post-migration)
**Source:** `js/brewpad.js:1704-1731` (`bpSaveAsNewRecipe`), `js/brewpad.js:1736-1748` (`postBottlingInvite`)
**Apply to:** the rewritten `adminApiGet`/`adminApiPost`. `fetch(mwUrl() + '/api/...', {method, credentials:'include' or rely on x-session-token header via the fetch-wrapper, headers:{'Content-Type':'application/json'}, body})`, then check `data.ok` (body-level) AND `r.ok`/`r.status` (transport-level) — never a message-substring match.

## No Analog Found

| File/Concern | Role | Data Flow | Reason |
|---|---|---|---|
| Global "middleware 401 → single logout trigger" interceptor (D-03's core requirement) | event-driven / fetch-response interceptor | request-response | No existing code in `brewpad.js` checks `response.status === 401` globally; the closest structural analog is the fetch-wrapper IIFE at `js/brewpad.js:9-38` (which already intercepts every `MIDDLEWARE_URL` request on the way OUT) — the response-side (401-detection) half of that wrapper does not yet exist anywhere in the codebase and must be designed fresh by the planner. RESEARCH.md's Open Question #2 flags this as a planning decision, not a research gap — confirmed still true after live verification. |
| `sv_session`'s frontend `login_at` hard-cliff decision (extend vs. drop, per Pitfall 2 / Open Question 1) | — | — | This is a design decision (keep `js/brewpad.js:1014`'s `isSessionExpired(data.login_at, 7*24*60*60*1000)` check as a hard client-side cliff, or remove it and trust the server 401 exclusively) with no existing precedent either way in this codebase — the planner must choose, not copy. |

## Metadata

**Analog search scope:** `zoho-middleware/routes/` (pos.js, recipes.js, auth.js), `zoho-middleware/lib/` (session.js, authTiers.js), `apps-script/adminApi.gs`, `js/brewpad.js`, `tests/frontend/brewpad-session-auth.test.js`, `zoho-middleware/__tests__/appsscript-proxy-auth-cache.test.js`
**Files scanned:** 8 read in full or via targeted non-overlapping offset reads; line numbers for every excerpt above were re-verified live in this session (not copied unverified from RESEARCH.md)
**Pattern extraction date:** 2026-08-27
