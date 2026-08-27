# Phase 76: BrewPad session-expiry hardening — Research

**Researched:** 2026-08-27
**Domain:** Auth architecture migration (dual-credential → single-credential) for an existing Express/Google-Apps-Script/GIS stack
**Confidence:** HIGH (all claims below verified by direct code inspection — `gemini` CLI deep-research tool was unavailable this session, see Tooling Note)

## Tooling Note

Per `CLAUDE.md`, this research should have used the `gemini` CLI for whole-file/whole-repo analysis of the two large files in scope (`js/brewpad.js`, 9394 lines; `apps-script/adminApi.gs`, 4071 lines). `gemini -p` failed with `IneligibleTierError: This client is no longer supported for Gemini Code Assist for individuals` (the free tier was sunset in favor of "Antigravity"). **Fallback used instead: `grep -n` for exact line inventory + targeted `Read` of each hit region.** This is slower but produces the same exact-line-number fidelity gemini would have, and every finding below is anchored to a real line number I read directly (not summarized/inferred). Flag for the user: `gemini` CLI is currently non-functional in this environment and needs re-auth or a product migration before the next phase that wants to use it.

## Summary

The two-credential bug is real and precisely as CONTEXT.md describes, and the migration path is **easier than the phase framing suggests** on the read side and **requires one Apps-Script redeploy** on the write side — not zero, and not a full rewrite either.

**Read actions** (`get_batch`, `get_batches`, `get_batch_dashboard_summary`, `get_vessels`, `get_ferm_schedules`, `get_tasks_upcoming`) are **already reachable via the `server_token`** that the middleware holds (`APPS_SCRIPT_SERVER_TOKEN`) — `adminApi.gs`'s `doGet` has a generic server-token bypass (lines 95–120) that dispatches to the *same* `handleReadAction()` switch regardless of action, so **no `.gs` change is needed to proxy any BrewPad read through the middleware**.

**Write actions** are a different story: `adminApi.gs`'s `doPost` has a **hardcoded allowlist** of actions permitted under `server_token` auth (lines 251–321) — `create_batch`, `create_recipe`, `update_recipe`, `delete_recipe`, `get_recipes`, `get_recipe`, and the gift-card actions. It does **not** include `update_batch`, `delete_batch`, `bulk_add_plato_readings`, `bulk_update_batch_tasks`, `update_plato_reading`, `delete_plato_reading`, `create_ferm_schedule`, `update_ferm_schedule`, or `delete_ferm_schedule` — the write actions BrewPad's batch/task/reading/schedule editors actually call. Any `server_token` request for one of those actions today falls into the block's own catch-all and returns `{ok:false, error:'invalid_action'}` (it does **not** fall through to the Google-OAuth branch). **A `.gs` redeploy that adds these 9 actions to the `server_token` allowlist is required** before the middleware can proxy BrewPad's writes. This finding is independently corroborated by a **live latent bug**: `zoho-middleware/routes/pos.js`'s `stampBottlingInviteSent()` (line 3697) already fires an `action:'update_batch', server_token:...` request today and, per this code path, has been silently failing (advisory-only, so unnoticed) since it shipped.

The **KEY safety question is answered with HIGH confidence, verified in code**: `POST /auth/google` (`zoho-middleware/routes/auth.js:86`) already independently verifies the caller's Google identity server-side (`googleVerify.verifyStaffAccessToken`), checks it against the `STAFF_EMAILS` allowlist, and **only then** mints the `sv_session`/`x-session-token`. `authTiers.resolveTier()` resolves any presented `x-session-token` back to that same allowlisted `email` via `session.getSession(sid)`. **A valid `x-session-token` is therefore already cryptographic proof of allowlisted-staff identity — the middleware proxy is safe by construction. No new authz binding is needed.**

The **renewal question surfaces a real, separate gap**: `zoho-middleware/lib/session.js` already contains a sliding-expiry function, `touchSession()` (coarse, only re-writes if the session is >1hr stale) — but it is **defined, exported, and unit-tested, and has zero callers anywhere in the live request path** (verified via repo-wide grep). Today `sv_session`'s Redis TTL is set once at `createSession()` and never renewed; the frontend's own `loadSession()` 7-day check (`js/brewpad.js:1014`) is anchored to the *original* `login_at`, also never extended. **This means the "durable 7-day session" is currently a hard 7-day cliff, not a sliding window, on both server and client.** Once Google's silent-refresh masking is removed (D-02), staff who leave BrewPad open across a shift boundary will hit a hard, unrecoverable logout at exactly 7 days from first sign-in with no warning. The plan must wire `touchSession()` into the live request path (e.g., inside `authTiers.resolveTier()` when tier is `'session'`) and decide what the frontend's parallel `login_at` check should do (extend it too, or drop it and trust the server 401).

**Primary recommendation:** A **single authenticated Apps-Script proxy endpoint** (allow-listed `{action, params}` forwarded server-side with `APPS_SCRIPT_SERVER_TOKEN`), not one middleware route per action. `adminApi.gs`'s own dispatch is already action-string-keyed (`handleReadAction`'s `switch`, `doPost`'s `if`/`switch` chains) — mirroring that with a thin middleware proxy that (a) requires `authTiers.requireTiers(['legacy','session'])` (BrewPad is session-scoped, device tier excluded — matches every existing `/api/batch/*` route in `pos.js`), (b) allow-lists the ~11 BrewPad action strings inventoried below, and (c) forwards `{action, ...params, server_token}` to Apps Script is dramatically less code than 11 bespoke routes, is exactly the shape `stampBottlingInviteSent`/`callAppsScriptPost` already use, and keeps the allow-list (not free-form action passthrough) as the security boundary CONTEXT.md asked for.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Staff login (Google OAuth → session mint) | Browser (GIS token) → API/Backend (`POST /auth/google`) | — | Google token used exactly once, at login, to derive a verified email; backend mints the durable credential |
| `x-session-token` verification | API/Backend (`authTiers.resolveTier`, `lib/session.js`) | — | Already the sole admin-grade credential path for every other staff surface (admin.js, kiosk session tier) |
| Batch/dashboard/reading/schedule reads | API/Backend (new middleware proxy) → external Apps-Script service | Browser (fetch caller) | Currently Browser→Apps-Script directly (Google token in body); migrating to Browser→Middleware→Apps-Script (server_token) |
| Batch/dashboard/reading/schedule writes | API/Backend (new middleware proxy) → external Apps-Script service | Browser (fetch caller) | Same shift; additionally requires the `.gs` `server_token` allowlist extension (write actions only) |
| Session sliding-expiry / renewal | API/Backend (`lib/session.js: touchSession`) | — | Exists but unwired — must be called from the authenticated request path, not the browser |
| Recipe CRUD (`/api/recipes`) | API/Backend (`zoho-middleware/routes/recipes.js`) | — | Already fully migrated in a prior phase (64-03/OPS-03) — the template to copy |
| Bottling-invite email | API/Backend (`/api/batch/bottling-invite`, Resend) | External Apps-Script (`update_batch` stamp, best-effort) | Already migrated; the fire-and-forget stamp call is the latent bug evidencing the write-allowlist gap |

## User Constraints (from CONTEXT.md)

<user_constraints>

### Locked Decisions

- **D-01:** Fold roadmap fix #4 IN — do the full single-credential migration, not the frontend-only patch (#1–3 alone). Target end state: BrewPad runs on `x-session-token` end-to-end; the Google token is used only at login to mint `sv_session`.
- **D-02:** Once the migration is total, **DELETE** the dual-token machinery rather than hardening it: the ~1hr Google-token silent-refresh timers (`_tokenRefreshTimer`, `_silentRefreshTimer`), the `handleUnauthorized()`-on-Apps-Script-401 code paths, and `isUnauthorizedError`. Keep only what the login-time Google exchange (`/auth/google`) genuinely needs.
- **D-03:** A full re-login (wipe `sv_session` + show the login modal) must be triggered **ONLY** by a **middleware `x-session-token` rejection** (a 401 from Railway). No Google/Apps-Script failure may ever clear `sv_session`.
- **D-04:** Preferred behavior was "silent auto-refresh, non-blocking reconnect banner only on failure" — BUT this is expected to be **largely MOOT** under the full migration (D-01), since the browser no longer holds a runtime Google token to expire. Keep a reconnect affordance ONLY if research finds a residual runtime Google-token dependency; otherwise it is not needed.
- **D-05:** `isUnauthorizedError` tightening is expected to be **MOOT** under D-02 (the Apps-Script-401 path is deleted). If research finds any path still keys on it, replace the loose substring match with an explicit status/flag. Do NOT preserve the loose match.

### Claude's Discretion

- **Middleware shape:** per-action middleware endpoints vs a single authenticated Apps-Script proxy endpoint (forwarding allow-listed `{action, params}` with the server token) — researcher/planner decides, weighing code volume vs security allow-listing. **Research recommends: single proxy endpoint, allow-listed action set (see Primary recommendation + Architecture Patterns below).**
- **Apps-Script redeploy:** whether any Apps-Script change is needed (vs a pure middleware-proxy that reuses the existing server token) — researcher determines from `apps-script/adminApi.gs` and the current response shapes. **Research finding: YES for writes (9 actions need adding to the `server_token` allowlist in `doPost`), NO for reads (already generic).**

### Deferred Ideas (OUT OF SCOPE)

- **Reconnect-banner UX (D-04) / isUnauthorizedError tightening (D-05)** — only resurface if research finds a residual runtime Google-token dependency after migration; otherwise dropped by deletion. **Research finding: no residual runtime Google-token dependency survives the migration — see Open Questions for the one exception (the GIS silent-refresh-on-load path, which only matters for stored-token page-load, not runtime API calls).**
- `beer-cider-launch-pages.md`, `brewpad-bottled-status-stale-ui.md`, `brewpad-ready-to-bottle-filter.md` — unrelated to session auth. Not folded.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| STAFF-AUTH | BrewPad session resilience — a silent-refresh/Apps-Script 401 no longer forces a full re-login while `sv_session` is still valid | Full auth-flow trace (`js/brewpad.js` lines 895–1488), middleware session-mint/verify trace (`zoho-middleware/routes/auth.js`, `lib/authTiers.js`, `lib/session.js`), Apps-Script action-inventory + authz-model trace (`apps-script/adminApi.gs` lines 1–520) — see Architecture Patterns, Don't Hand-Roll, Common Pitfalls, Runtime State Inventory below |

</phase_requirements>

## Project Constraints (from CLAUDE.md)

- ES5-only vanilla JS in `js/brewpad.js` — no arrow functions, `let`/`const`, template literals, classes, etc. (`npm run lint` enforces this).
- **Never edit `js/brewpad.min.js` directly** — it is a build artifact. `brewpad.js` has its **own** separate build path (`terser js/brewpad.js -o js/brewpad.min.js`, `stamp:brewpad` cache-busts `brewpad.html`'s `?v=` query strings) — it is **not** part of the numbered `js/modules/01–13` → `js/main.js` concatenation pipeline CLAUDE.md's general prose describes. Run `npm run build` after any `js/brewpad.js` change (it runs `stamp:brewpad` + the full `minify:js` chain, which includes `terser js/brewpad.js`).
- Regression test FIRST (rule #3): a test reproducing "Google-token/Apps-Script 401 wipes `sv_session`" must exist and go RED before the fix, then GREEN after.
- After changing `js/lib/auth.js` (shared by `admin.js`, `kiosk.js`, `brewpad.js`) or any `zoho-middleware/lib/*.js`, run the FULL suite for both frontend (`npm test`) and middleware (`cd zoho-middleware && npm test`) — not just BrewPad's tests.
- `npm run lint` (frontend, `--max-warnings 0`) and `cd zoho-middleware && npm run lint` (`eslint routes/ lib/ server.js --max-warnings 0`) must both pass before commit.
- Middleware has its own `node_modules` — always `cd zoho-middleware` first for its commands.
- Apps Script (`apps-script/*.gs`) changes require a **manual owner redeploy** (not in CI, not automatic) — every prior phase that touched `adminApi.gs` (e.g. 64-03) flagged this as an explicit human checkpoint before dependent code could ship. This phase's write-side migration needs exactly this pattern again.
- No new CSP concern: `brewpad.html` has **no CSP `<meta>` tag at all** (`noindex`, staff-only page) — rule #12 (CSP domain sync across public pages) does not apply here.

## Standard Stack

This phase is a refactor of existing first-party code, not a new-library adoption. No new packages are introduced on either the frontend or middleware. All "stack" here is the existing, already-approved project stack (Express 4, axios, Redis-backed `lib/cache.js`/`lib/session.js`, Jest, ESLint ES5 config).

### Core (existing, reused)
| Component | Location | Purpose | Why reused, not new |
|-----------|----------|---------|----------------------|
| `authTiers.requireTiers(['legacy','session'])` | `zoho-middleware/lib/authTiers.js` | Gate new proxy route(s) to admin-grade session credential, device-token excluded | Exact pattern used by every existing `/api/batch/*` route (`pos.js:2712`, `2921`, `3038`) — BrewPad is explicitly session-scoped there already |
| `callAppsScriptPost`-style helper | `zoho-middleware/routes/recipes.js:25`, mirrored in `pos.js` (`stampBottlingInviteSent`, `brewpad-integration.js`) | Server→Apps-Script call with `server_token` | Already the established, tested pattern for exactly this kind of proxy |
| `lib/cache.js` read-through TTL | `zoho-middleware/lib/cache.js`, pattern demonstrated in `recipes.js` `_cachedGet`-equivalent and `__tests__/appsscript-proxy-auth-cache.test.js` | Avoid re-hammering Apps Script's own script-cache/quota on every poll | M8 (Phase 52-05) established this exact pattern for recipe-availability + gift-card-lookup GET proxies — batch/dashboard reads should follow it too |
| `lib/session.js: touchSession` | `zoho-middleware/lib/session.js:55` | Sliding-expiry renewal of the sole surviving credential | Already written and unit-tested — just needs to be *called* from the live request path (currently zero callers) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Single allow-listed `{action,params}` proxy endpoint | 11 bespoke per-action middleware routes (`/api/batch/get`, `/api/batch/vessels`, etc., mirroring `/api/recipes` CRUD style) | More routes = more files/tests to maintain, but each gets its own explicit validation/shape; the phase's own decision text explicitly asks the researcher to weigh this. Given `adminApi.gs`'s dispatch is already action-string-keyed and the allow-list is the security boundary either way, the single-proxy shape adds materially less code for equivalent security posture. Recommend single proxy for the read side (thin passthrough) but keep purpose-built routes for anything needing bespoke request validation (e.g. `bulk_add_plato_readings`, which BrewPad already builds a nontrivial payload for) — see Architecture Patterns. |

**Installation:** N/A — no new dependencies.

## Package Legitimacy Audit

Not applicable — this phase installs no new packages (frontend or middleware). Skipping the slopcheck/registry-verification gate.

## Architecture Patterns

### System Architecture Diagram — current (buggy) state

```
BrewPad (browser)
  |
  |-- Google OAuth token (~1hr, GIS silent refresh) ------------------+
  |                                                                    |
  |-- sv_session_token (7-day, localStorage) --> x-session-token       |
  |         header on every fetch() to MIDDLEWARE_URL                 |
  |                                                                    v
  |                                                          Apps-Script "admin API"
  v                                                          (adminApi.gs doGet/doPost)
Railway middleware (x-session-token verified)                checkAuthorization():
  |-- /auth/google  (mints sv_session from Google token,             Google tokeninfo
  |    ONE-TIME at login)                                            lookup, staff_emails
  |-- /api/recipes  (already migrated, server_token)                 allowlist check
  |-- /api/batch/*  (search/scan/reassign — already migrated)
                                                                       ^
                                                                       | Google token
                                                          adminApiGet/Post()
                                                          batches / dashboard /
                                                          vessels / schedules /
                                                          plato readings / tasks
                                                          <---- STILL direct from
                                                                browser, bypasses
                                                                middleware entirely
```

**The bug:** when the Google-token leg (bottom loop) 401s or GIS silent-refresh fails, `handleUnauthorized()` (`js/brewpad.js:1406`) unconditionally calls `clearSession()` (`:1023`), which deletes `sv_session_token` — the credential for the *unrelated, still-valid* top loop. One leg's failure poisons the other.

### System Architecture Diagram — target (post-migration) state

```
BrewPad (browser)
  |
  |-- Google OAuth token: login-time ONLY, via /auth/google -----+
  |                                                               v
  |-- sv_session_token (7-day) --> x-session-token header  Railway middleware
  |    on EVERY fetch (recipes, batches, dashboard,        /auth/google:
  |    vessels, schedules, plato readings, tasks)            googleVerify.verifyStaffAccessToken()
  v                                                           -> STAFF_EMAILS allowlist check
Railway middleware (authTiers.requireTiers(['legacy','session']))
  |                                                           -> session.createSession(email)
  |-- /api/recipes/*        (existing, unchanged)             -> sv_session cookie + token body
  |-- /api/batch/admin-proxy  (NEW: allow-listed action,       -> [MUST ADD] touchSession(sid)
  |    forwards {action, ...params, server_token})                on every resolveTier() session hit
  |         |
  |         v
  |    Apps-Script (adminApi.gs) -- server_token branch
  |    doGet: already generic (any handleReadAction action)
  |    doPost: [MUST ADD] update_batch, delete_batch,
  |            bulk_add_plato_readings, bulk_update_batch_tasks,
  |            update_plato_reading, delete_plato_reading,
  |            create_ferm_schedule, update_ferm_schedule,
  |            delete_ferm_schedule  to the server_token allowlist
  |            (owner manual redeploy checkpoint)
  v
handleUnauthorized() fires ONLY on a middleware 401
  (x-session-token rejected) -- never on an Apps-Script response
```

### Recommended Project Structure

No new files are strictly required — extend existing files:

```
zoho-middleware/
├── routes/
│   └── pos.js                    # add the new /api/batch/admin-proxy (or similarly
│                                  # named) route here, next to the other /api/batch/*
│                                  # routes (search-invoices, scan-invoices, etc.) —
│                                  # matches existing file organization; do NOT create
│                                  # a new route file for one endpoint
├── lib/
│   ├── authTiers.js               # unchanged — reuse requireTiers(['legacy','session'])
│   └── session.js                 # ADD a call site for touchSession() — see Pitfall below
apps-script/
└── adminApi.gs                    # extend doPost's server_token allowlist (9 actions);
                                    # doGet needs NO change (already generic)
js/
├── brewpad.js                     # rewrite adminApiGet/adminApiPost to call the new
│                                  # middleware proxy instead of ADMIN_API_URL directly;
│                                  # DELETE _tokenRefreshTimer/_silentRefreshTimer/
│                                  # handleUnauthorized-on-401/isUnauthorizedError;
│                                  # keep initGoogleAuth/checkAuthorization/onTokenResponse
│                                  # (login-time Google exchange, unchanged in shape)
tests/frontend/
├── brewpad-session-auth.test.js   # existing D-46-09 pattern to extend, NOT replace
zoho-middleware/__tests__/
└── appsscript-proxy-auth-cache.test.js  # existing M8 pattern (mock-express-router +
                                          # mock-axios + real in-memory cache double) —
                                          # copy this shape for the new proxy's tests
```

### Pattern 1: Single allow-listed proxy for read actions (thin passthrough)

**What:** One middleware route, `POST /api/batch/admin-proxy` (name TBD by planner), that accepts `{action, ...params}`, checks `action` against a hardcoded allow-list (the exact ~11 BrewPad action strings inventoried below — never a free-form pass-through), and forwards to Apps Script with `server_token` substituted for whatever the browser sent.

**When to use:** All BrewPad read actions (`get_batch`, `get_batches`, `get_batch_dashboard_summary`, `get_vessels`, `get_ferm_schedules`, `get_tasks_upcoming`) — these already work via `server_token` today with zero `.gs` changes, so a thin allow-listed passthrough is safe and low-code.

**Example (based on `recipes.js:25` `callAppsScriptPost`, adapted):**
```javascript
// Source: pattern mirrors zoho-middleware/routes/recipes.js:25 callAppsScriptPost
// and zoho-middleware/routes/pos.js:3038 requireTiers usage
var ADMIN_PROXY_ACTIONS = {
  get_batch: true, get_batches: true, get_batch_dashboard_summary: true,
  get_vessels: true, get_ferm_schedules: true, get_tasks_upcoming: true,
  update_batch: true, update_batch_schedule: true, delete_batch: true,
  bulk_add_plato_readings: true, bulk_update_batch_tasks: true,
  delete_ferm_schedule: true, delete_plato_reading: true,
  update_plato_reading: true, create_ferm_schedule: true,
  update_ferm_schedule: true
};

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

### Pattern 2: Frontend `adminApiGet`/`adminApiPost` repoint (minimal-diff)

**What:** Keep the `adminApiGet(action, params)` / `adminApiPost(action, payload)` function *signatures* in `js/brewpad.js` exactly as-is (they are called from ~50 sites across the file — see inventory below) — only change their internals to call the new middleware proxy instead of `SHEETS_CONFIG.ADMIN_API_URL` directly, and drop the `token: accessToken` body field (the global `x-session-token` fetch-wrapper at `js/brewpad.js:9-38` already attaches the header automatically once the URL matches `MIDDLEWARE_URL`).

**When to use:** This is the minimal-diff way to satisfy D-01 without touching ~50 call sites — only the two helper function bodies change.

**Example:**
```javascript
// Source: adapted from existing js/brewpad.js:1443-1469 adminApiGet
function adminApiGet(action, params) {
  var body = { action: action };
  if (params) {
    Object.keys(params).forEach(function (key) { body[key] = params[key]; });
  }
  return fetchWithRetry(mwUrl() + '/api/batch/admin-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
    // x-session-token attached automatically by the global fetch wrapper (lines 9-38)
    // because this URL now starts with SHEETS_CONFIG.MIDDLEWARE_URL
  })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (!data.ok) { throw new Error(data.message || data.error || 'API error'); }
      return data;
    });
  // NOTE: no more isUnauthorizedError/handleUnauthorized branch here (D-02/D-05) --
  // a middleware 401 is now handled by a single global response interceptor (see
  // Pitfall: "where does the 401 check move to?" below), not per-call-site.
}
```

### Anti-Patterns to Avoid

- **Free-form action passthrough with no allow-list:** forwarding `req.body.action` to Apps Script unchecked would let any authenticated session (or, if the global `/api` guard is ever loosened, any caller) invoke *any* `doPost`/`doGet` action Apps Script exposes, including recipe/gift-card mutation actions this proxy was never meant to cover. CONTEXT.md explicitly calls for weighing this — the allow-list is the security boundary; keep it hardcoded and short.
- **Trusting `req.body.token` (the Google token) as a fallback identity source in the new proxy:** don't accept-and-forward a client-supplied Google token as an alternative to `x-session-token` "just in case" — that reintroduces the exact dual-credential surface this phase exists to remove.
- **Clearing `sv_session` from inside a `.catch()` that doesn't distinguish HTTP status:** the current bug's root cause is exactly this — `isUnauthorizedError()` does a substring match on ANY error message, not a real status check. The single global 401 handler (wherever it lives post-refactor) must check the actual HTTP status code from the middleware response, not a message substring from an upstream (Apps-Script) body.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| Server→Apps-Script auth call shape | A new axios wrapper / new env var scheme | `process.env.APPS_SCRIPT_URL` + `process.env.APPS_SCRIPT_SERVER_TOKEN`, exact `axios.post(url, JSON.stringify(Object.assign({}, payload, {action, server_token})), {headers:{'Content-Type':'application/json'}, timeout, maxRedirects:5})` shape | Already the pattern in 3 places (`recipes.js:25`, `pos.js:3697` `stampBottlingInviteSent`, `brewpad-integration.js:117`) — a 4th slightly-different variant is pure drift risk |
| Session credential tier gating | A new "is this BrewPad" check | `authTiers.requireTiers(['legacy','session'])` | Exact tier set already used by every sibling `/api/batch/*` route; device-token deliberately excluded (BrewPad is never kiosk-scoped) |
| Read-through caching for Apps-Script-backed GETs | A new cache-key scheme | Mirror `zoho-middleware/__tests__/appsscript-proxy-auth-cache.test.js`'s M8 pattern (Redis-backed `lib/cache.js`, TTL keyed by action+params) | M8 (Phase 52-05) exists specifically because unauth'd/uncached Apps-Script-backed GETs were an audit finding (quota exhaustion risk) — don't reintroduce that class of bug for the new batch/dashboard proxy |
| Sliding session expiry | A new renewal timestamp/field | `lib/session.js: touchSession(sid)` — already written, already unit-tested | It exists, it's correct, it's just never called — wire it in, don't reinvent it |

**Key insight:** Every piece of infrastructure this migration needs (server-token proxy pattern, session-tier gating, read-through caching, sliding-expiry renewal) **already exists in the codebase** from prior phases (46, 52, 64). This phase is almost entirely "wire existing pieces together, extend one allow-list, redeploy one Apps-Script action set" — not new infrastructure design.

## Runtime State Inventory

Not applicable in the strict "rename/refactor/migration" sense this section targets (no data keys, external service names, or OS-registered state are being renamed). However, one item below is directly analogous and must be treated with the same rigor:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Live service config (analogous) | `apps-script/adminApi.gs`'s `doPost` `server_token` action allowlist (lines 251–321) lives in the **deployed Apps-Script code**, not in this git repo's runtime — a `.gs` file edit in this repo does nothing until the owner manually redeploys via the Apps Script editor (Deploy → Manage deployments → New version). | Code edit (add 9 actions to the allowlist) + **mandatory human checkpoint**: owner redeploy, verified BEFORE the middleware proxy route is allowed to reach those actions in any environment (staging or prod) — exact precedent: ROADMAP 64-03 ("owner redeploy first"). |
| Secrets/env vars | `APPS_SCRIPT_SERVER_TOKEN` / `APPS_SCRIPT_URL` — used unchanged; no new secret needed. | None — reuse existing. |
| Stored data | `sv_session` Redis-backed session records (`session:` prefix) — no schema change; `touchSession` already writes the same shape. | None — code-path wiring only, not a data migration. |
| Build artifacts | `js/brewpad.min.js` becomes stale immediately after any `js/brewpad.js` edit (own build path — `terser js/brewpad.js -o js/brewpad.min.js`, triggered by `npm run build`'s `minify:js` step). | `npm run build` after every `js/brewpad.js` change, before commit. |
| OS-registered state | None found — no cron/scheduler/task-runner references this credential. | None. |

## Common Pitfalls

### Pitfall 1: Forgetting the write-side Apps-Script allowlist is a hardcoded, closed `if` chain (not a generic dispatch like `doGet`)

**What goes wrong:** A middleware proxy is built and deployed assuming `server_token` + any action string works uniformly (because `doGet` and `handleReadAction` genuinely are generic) — then every BrewPad batch/task/reading/schedule *write* silently 400s with `invalid_action` in production, because `doPost`'s `server_token` branch (`adminApi.gs:251-321`) is a **closed if-chain**, not a passthrough to the OAuth-authenticated switch below it, and does not include those actions.
**Why it happens:** `doGet`'s server-token bypass (added later, per the code's own 2026-07-12 comment at line 97) is structurally different from `doPost`'s original server_token block — they look parallel but aren't.
**How to avoid:** Before writing the middleware proxy, get the `.gs` allowlist extension redeployed and verified (owner checkpoint) FIRST, exactly per the existing 64-03 precedent. Test the extension directly against the live Apps-Script endpoint (not just via the middleware) before wiring the middleware route.
**Warning signs:** `{ok:false, error:'invalid_action', message:'Unknown server action: update_batch'}` from Apps Script — this is EXACTLY what `stampBottlingInviteSent` is silently receiving today (see Summary); reproduce this call manually to confirm before assuming the allowlist covers everything.

### Pitfall 2: `sv_session`'s "durable 7 days" is currently a hard cliff, not a sliding window, on BOTH tiers

**What goes wrong:** After D-02 deletes the Google-token machinery, nothing else in the system extends session life. Staff who leave BrewPad open will get a hard, silent 7-day logout with no warning banner and no server-side renewal — trading one bug (spurious early logout) for a different one (an un-signaled hard logout exactly 7 days after first sign-in, even mid-shift).
**Why it happens:** `touchSession()` (`lib/session.js:55`) exists and is correct but has zero callers (verified: `grep -rn touchSession` across the entire `zoho-middleware` tree, excluding its own definition/export and its unit test, returns nothing). The frontend's parallel `loadSession()` check (`js/brewpad.js:1014`, `isSessionExpired(data.login_at, 7*24*60*60*1000)`) is ALSO anchored to the original `login_at`, preserved-not-extended across every token refresh (`saveSession(accessToken, expiresIn, userEmail, prevLoginAt)`).
**How to avoid:** Wire `touchSession(sid)` into `authTiers.resolveTier()` (fire-and-forget, on every successful session lookup) so the Redis TTL actually slides. Decide explicitly what the frontend's local `login_at` gate should become — either (a) also extend it (defeats "durable but bounded" intent, may not be desired) or (b) remove the client-side 7-day check entirely and rely solely on the server 401 (simpler, single source of truth, matches D-03's "ONLY a middleware rejection triggers logout" principle more cleanly).
**Warning signs:** A staff member reports being logged out "for no reason" after leaving BrewPad open overnight across a multi-day shift pattern, with no prior warning — this is the exact same class of complaint the phase exists to fix, just relocated.

### Pitfall 3: Deleting `_tokenRefreshTimer`/`isUnauthorizedError`/`handleUnauthorized` breaks OTHER call sites that assume they exist

**What goes wrong:** `handleUnauthorized()` is called from 4 distinct sites beyond `adminApiGet`/`adminApiPost` — the GIS `error_callback` (`:1086`), `onTokenResponse`'s refresh-failure branch (`:1221`), `tryRefreshToken`'s catch (`:1210`), and the multi-tab `storage` event listener (`:1344`, fires `handleUnauthorized()` when another tab signs out). `isUnauthorizedError` is checked at exactly 2 sites (`:1464`, `:1483`), both inside `adminApiGet`/`adminApiPost` which are being rewritten anyway. `clearSession()` is called from `bpSignOut()` (`:1371`, legitimate — explicit staff sign-out must still work) in addition to the buggy paths.
**Why it happens:** These functions are small and look independent but are wired into several different trigger paths (GIS callback errors, storage events, explicit sign-out) that all need DIFFERENT post-migration behavior — not all of them should simply be deleted.
**How to avoid:** Full inventory before deleting (already done — see table below). `bpSignOut()`'s `clearSession()` call must be KEPT (explicit staff action). The multi-tab storage listener's `handleUnauthorized()` call at `:1344` needs re-examination — post-migration it should probably still fire (another tab genuinely signing out should still sign this tab out), just via whatever the new "real 401 happened" handler becomes, not the deleted one. The GIS `error_callback` (`:1086`) and `tryRefreshToken` catch (`:1210`) both only fire during the login-time Google exchange (still needed) — these become dead/irrelevant once BrewPad's runtime API calls no longer depend on a live Google token, but the *login-time* refresh-on-load path (`doSilentRefreshOnLoad`, `:1098-1131`) may still be worth keeping in some reduced form since `checkAuthorization`'s fast-path (`:1141`) still calls it as a fallback when a stored token is present but the server round-trip fails — decide explicitly whether that fallback path still makes sense once Google is login-only, or whether `initGoogleAuth` should be simplified to "have a stored `sv_session_token`? verify it. No? show the Google sign-in button." with no silent-refresh-on-load branch at all.
**Warning signs:** Multi-tab sign-out stops propagating; the GIS `initTokenClient`'s `error_callback` throws because it references a deleted function; `npm run lint`/`npm test` failures on dangling references.

### Pitfall 4: `admin-config.js`/`ADMIN_API_URL`/`adminApi.gs`'s Google-OAuth `checkAuthorization()` path is shared with `admin.js` (73 call sites) — do not delete or restructure it

**What goes wrong:** It's tempting, once BrewPad no longer calls Apps Script directly, to "clean up" `adminApi.gs`'s Google-OAuth branch or `js/admin-config.js`/`ADMIN_API_URL`. `admin.js` uses `adminApiGet`/`adminApiPost`/`ADMIN_API_URL` at **73 call sites** (verified via grep) and is explicitly OUT OF SCOPE per CONTEXT.md ("any non-BrewPad surface's auth").
**Why it happens:** `admin-config.js` is loaded on 4 pages (`admin.html`, `brewpad.html`, `kiosk.html`, `batch.html`) — it's easy to assume it's BrewPad-specific because this phase is BrewPad-scoped.
**How to avoid:** Only change `js/brewpad.js`'s internal `adminApiGet`/`adminApiPost` implementations and BrewPad-local state/timers. Never touch `adminApi.gs`'s `checkAuthorization()` function itself (only ADD to the `server_token` allowlist inside `doPost`, don't modify the OAuth branch), `js/admin-config.js`, or any `js/admin.js`/`js/kiosk.js` code.
**Warning signs:** `admin.js`'s test suite (or `kiosk.js`'s) breaks after a BrewPad-scoped change — immediate signal of scope leakage.

## Code Examples

### Existing exact `x-session-token` fetch-wrapper (reuse unmodified)
```javascript
// Source: js/brewpad.js:9-38 (already correct, no change needed)
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
        if (tok) { /* attach x-session-token header */ }
      }
    } catch (e) {}
    return origFetch.call(this, input, init);
  };
})();
```
This is why Pattern 2's rewritten `adminApiGet`/`adminApiPost` don't need to manually attach `x-session-token` — pointing their `fetch()` calls at a `MIDDLEWARE_URL`-prefixed path is sufficient; the header is added transparently.

### Existing session-mint + tier resolution (reuse unmodified, verified)
```javascript
// Source: zoho-middleware/routes/auth.js:86-119 (POST /auth/google)
googleVerify.verifyStaffAccessToken(accessToken)
  .then(function (email) {
    var allowlist = (process.env.STAFF_EMAILS || '').split(',').map(function (e) {
      return e.trim().toLowerCase();
    });
    if (allowlist.indexOf(email) === -1) {
      return res.status(403).json({ authorized: false });
    }
    return session.createSession(email).then(function (sid) {
      res.cookie('sv_session', sid, { httpOnly: true, /* ... */ });
      res.json({ authorized: true, email: email, token: sid });
    });
  });

// Source: zoho-middleware/lib/authTiers.js:116-136 (resolveTier)
var sid = (req.cookies && req.cookies.sv_session) ||
  (typeof headers['x-session-token'] === 'string' ? headers['x-session-token'] : '');
if (sid) {
  var payload = await session.getSession(sid);
  if (payload) { req.staffEmail = payload.email; return 'session'; }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|-------------------|---------------|--------|
| Browser→Apps-Script direct, Google-token auth (`adminApiGet`/`adminApiPost`, `ADMIN_API_URL`) | Browser→Middleware→Apps-Script, `x-session-token`/`server_token` auth | This phase (target state) | Removes the dual-credential race condition entirely; BrewPad joins recipes/batch-search/reassign/bottling-invite, which already made this exact transition in earlier phases (46, 64) |
| Google access token in URL query string for `adminApiGet` | Google access token (soon: nothing) in POST body | Phase 64-03 (OPS-03), 2026-07 | Precedent already set for BrewPad transport-shape changes without touching call-site signatures |
| `sv_session` hard 7-day expiry (both tiers) | (recommended, not yet implemented) sliding-expiry via `touchSession` | N/A — gap identified this phase, not yet closed | See Pitfall 2 |

**Deprecated/outdated:**
- `js/brewpad.js`'s `_tokenRefreshTimer`/`_silentRefreshTimer`/`handleUnauthorized`-on-Apps-Script-401/`isUnauthorizedError`: per D-02, deleted outright, not hardened. See Pitfall 3 for exactly what else references them.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|----------------|
| A1 | The recommended proxy route path (`/api/batch/admin-proxy`) and its exact name are a suggestion, not a verified requirement — the planner/owner may prefer per-action routes or a different path/namespace. | Architecture Patterns, Pattern 1 | Low — purely a naming/shape choice, does not affect correctness, easily changed in planning |
| A2 | `doGet`'s server-token bypass is described as "generic for any action in `handleReadAction`'s switch" based on reading the dispatch code, but was not tested live against the actual deployed Apps-Script instance (deployed code may differ from what's in this git repo if a prior manual edit wasn't committed). | Summary, Pitfall 1 | Medium — if the deployed `.gs` differs from the repo's `adminApi.gs`, the "no redeploy needed for reads" claim could be wrong; planner should verify with a live probe (e.g. a manual `curl` with `server_token` for `get_batches`) before finalizing the plan around this assumption |

## Open Questions

1. **Should `doSilentRefreshOnLoad`'s login-time fallback survive the migration?**
   - What we know: `checkAuthorization`'s stored-token fast path (`:1141`) calls `doSilentRefreshOnLoad()` as an `onError` fallback when the backend round-trip to `/auth/google` fails for a stored (but not yet `sv_session_token`-holding) Google token. This is a login-time-only path — it does not run during normal BrewPad API usage.
   - What's unclear: whether this fallback still makes sense once BrewPad's *runtime* API traffic no longer needs a live Google token at all — arguably `initGoogleAuth` could simplify to "have `sv_session_token`? verify once via `/auth/google`. Fails? show sign-in button" with no silent-refresh branch, since a stale-but-present Google access token isn't needed for anything except the one-time mint call, and a failed mint call just means "sign in again," not "lose your still-good session."
   - Recommendation: planner should decide during plan-writing whether to simplify `initGoogleAuth`/`doSilentRefreshOnLoad` or leave the login-page-load path as-is (lower risk, more code kept) — this is a design call within D-01/D-02's scope, not a blocking unknown.

2. **Exact final shape of the "middleware 401 → logout" trigger after `adminApiGet`/`adminApiPost` no longer live-check `isUnauthorizedError` per-call.**
   - What we know: D-03 requires logout ONLY on a middleware `x-session-token` rejection. The middleware's `authTiers.requireTiers` returns HTTP 401 (no credential) or 403 (wrong-tier credential) — never a body-level "unauthorized" string the way Apps Script does.
   - What's unclear: whether the plan centralizes this as a single global fetch-response interceptor (checking `res.status === 401` for any `MIDDLEWARE_URL` request) or keeps a per-call `.then(res => ...)` check at each of the ~50 `adminApiGet`/`adminApiPost`/direct-`fetch` call sites.
   - Recommendation: a global interceptor (extending the existing fetch-wrapper IIFE at `js/brewpad.js:9-38`, which already inspects every `MIDDLEWARE_URL` request) is the lower-risk, single-source-of-truth choice and avoids re-introducing 50 scattered "did I remember the check" call sites — flag as a planning decision, not a research gap.
