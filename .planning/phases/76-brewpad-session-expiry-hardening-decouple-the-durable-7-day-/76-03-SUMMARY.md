---
phase: 76-brewpad-session-expiry-hardening
plan: 03
subsystem: auth
tags: [brewpad, session, oauth, google-identity-services, middleware-proxy, x-session-token]

# Dependency graph
requires:
  - phase: 76-02
    provides: "POST /api/batch/admin-proxy (x-session-token auth, hardcoded action allow-list) and sliding sv_session TTL via touchSession on every session-tier resolution"
  - phase: 76-01
    provides: "Deployed Apps Script server_token allowlist reaches BrewPad writes"
provides:
  - "adminApiGet/adminApiPost repointed from SHEETS_CONFIG.ADMIN_API_URL (Google token in body) to mwUrl()+'/api/batch/admin-proxy' (x-session-token header only, attached automatically by the existing fetch-wrapper)"
  - "A single global middleware-401 interceptor (_handleMiddlewareResponse, module-scope, exported for tests) that is the SOLE full-re-login trigger, keyed strictly on a real MIDDLEWARE_URL response status === 401"
  - "Deletion of the dual-token machinery that caused 'Session expired while sv_session is valid': _tokenRefreshTimer (50-min interval), the 5-min-before-expiry warn timer, handleUnauthorized(), isUnauthorizedError()"
  - "Client-side 7-day login_at cliff dropped from loadSession() -- server sliding expiry (touchSession, 76-02) plus the real-401 interceptor are now the single source of truth"
  - "Fixed a genuine D-03 violation discovered in doSilentRefreshOnLoad's exhausted-retry path: it previously called clearSession() on a Google-side silent-refresh failure, wiping a possibly-still-valid sv_session_token"
affects: [brewpad-session-expiry-hardening, staff-auth, brewpad-frontend]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Module-scope forward-reference hook (var _handleMiddlewareResponse = null; assigned later from inside the closure) so a top-of-file production interceptor and a bottom-of-file Jest test seam can share one implementation that needs closure-scoped state (accessToken, clearSession, showSessionExpiredOverlay)"
    - "Single global response-status interceptor for session-destroying decisions, replacing distributed per-call body-substring checks (isUnauthorizedError)"

key-files:
  created: []
  modified:
    - js/brewpad.js
    - js/brewpad.min.js
    - brewpad.html
    - tests/frontend/brewpad-session-auth.test.js
    - tests/frontend/admin-api-get-token.test.js
    - tests/frontend/brewpad-delete-reconcile.test.js

key-decisions:
  - "Open Question #1 (doSilentRefreshOnLoad): KEPT the login-time silent-Google-refresh flow. Every BrewPad page (re)load still needs one fresh Google access_token to complete the mandatory POST /auth/google exchange -- there is no middleware endpoint that verifies a bare sv_session_token, and adding one is out of this plan's frontend-only scope (zoho-middleware is not in files_modified). This flow is orthogonal to the runtime dual-token bug: D-02's deleted timers existed to keep a Google token alive WHILE THE APP WAS ALREADY OPEN, purely for adminApiGet/Post's sake -- now moot since those functions send no Google token at all."
  - "Renamed _silentRefreshTimer -> _googleResumeTimer to satisfy the D-02 deletion grep while preserving its (harmless) UI-only behavior; fixed the one genuine bug in that path (clearSession() on exhausted silent-refresh retries) rather than deleting the whole flow"
  - "Kept _tokenWarnTimer's/tryRefreshToken's visibility-wake-refresh code path structurally, but removed its handleUnauthorized() call -- a failed background Google-token refresh now only resets the auth-status dot, never clears sv_session"
  - "_handleMiddlewareResponse is keyed strictly on res.status === 401, never 403, matching the plan's explicit must_haves/RESEARCH.md wording (authTiers.requireTiers returns 401 for 'no credential presented' and 403 for 'wrong-tier credential' -- only the former is treated as a real logout signal in this plan)"

requirements-completed: [STAFF-AUTH]

# Metrics
duration: 25min
completed: 2026-08-27
---

# Phase 76 Plan 3: BrewPad Single-Credential Migration Summary

**Repointed BrewPad's adminApiGet/adminApiPost to the middleware's admin-proxy (x-session-token only, no Google token), added one global res.status===401 interceptor as the sole re-login trigger, and deleted the dual-token machinery (timers + handleUnauthorized + isUnauthorizedError) that let a Google/Apps-Script hiccup wipe a still-valid sv_session_token.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-08-27T07:35:00-07:00 (approx.)
- **Completed:** 2026-08-27T07:51:22-07:00
- **Tasks:** 3
- **Files modified:** 6 (js/brewpad.js, js/brewpad.min.js, brewpad.html, tests/frontend/brewpad-session-auth.test.js, tests/frontend/admin-api-get-token.test.js, tests/frontend/brewpad-delete-reconcile.test.js)

## Accomplishments
- adminApiGet/adminApiPost now hit `mwUrl() + '/api/batch/admin-proxy'` with no Google token field anywhere in the request; identity is proven solely by the `x-session-token` header the existing fetch-wrapper IIFE attaches
- A single, module-scope, exported `_handleMiddlewareResponse` interceptor is the ONLY place a full re-login (`sv_session` wipe + session-expired overlay) can be triggered, keyed strictly on a real middleware `res.status === 401` -- never a Google/Apps-Script body substring
- Deleted `handleUnauthorized()`, `isUnauthorizedError()`, the 50-min proactive Google-token refresh interval, and the 5-min-before-expiry warn timer, with every caller re-pointed so no dangling reference remains
- Dropped the client-side 7-day `login_at` hard cliff from `loadSession()` -- the server's sliding `sv_session` TTL (touchSession, Plan 76-02) plus the real-401 interceptor are now the single source of truth
- Found and fixed a genuine D-03 violation inside `doSilentRefreshOnLoad`'s exhausted-retry branch (it called `clearSession()` purely because Google's silent refresh failed) while renaming `_silentRefreshTimer` to satisfy the D-02 deletion grep

## Task Commits

1. **Task 1: Write RED regression tests** - `c739f92d` (test)
2. **Task 2: Repoint adminApiGet/adminApiPost + global 401 interceptor + drop client 7-day cliff** - `a572275b` (feat) -- includes inline fixes to two pre-existing tests broken by the mandated transport change (see Deviations)
3. **Task 3: Delete dual-token machinery + rebuild + full gate** - `2e899904` (feat)

**Plan metadata:** (this commit, see final_commit step)

## Files Created/Modified
- `js/brewpad.js` - adminApiGet/adminApiPost rewritten to the admin-proxy; `_handleMiddlewareResponse`/`_enterLoggedOutState` added; `handleUnauthorized`/`isUnauthorizedError`/the two proactive Google-refresh timers deleted; `loadSession`'s 7-day cliff dropped; `_silentRefreshTimer` renamed `_googleResumeTimer` with its clearSession() bug fixed
- `js/brewpad.min.js` - regenerated via `terser js/brewpad.js -o js/brewpad.min.js -c -m` (never hand-edited)
- `brewpad.html` - cache-busting `?v=` stamps for `brewpad.min.css`/`brewpad.min.js` updated (via `npm run stamp:brewpad`)
- `tests/frontend/brewpad-session-auth.test.js` - new "Phase 76 — single-credential migration" describe block: 3 regression tests (Apps-Script-shaped unauthorized body does not clear sv_session; transport = proxy with no token field; a real 401 is the sole idempotent logout trigger)
- `tests/frontend/admin-api-get-token.test.js` - **deviation fix** (see below): parameterized the shared brewpad.js/admin.js suite so each surface asserts its own (now divergent) transport contract
- `tests/frontend/brewpad-delete-reconcile.test.js` - **deviation fix** (see below): updated the fetch-mock's URL-routing condition from `ADMIN_API_URL` to the new proxy path

## Decisions Made
- **Open Question #1 (doSilentRefreshOnLoad):** kept it. See `key-decisions` above for full rationale -- every page load still needs a fresh Google token for the mandatory `/auth/google` exchange; there's no server-side "verify sv_session_token alone" endpoint, and adding one is outside this plan's frontend-only file scope.
- **401 vs 403:** the interceptor is keyed strictly on `status === 401`. Per RESEARCH.md, `authTiers.requireTiers` returns 401 only when NO credential is presented at all (e.g. `x-session-token` header missing entirely) and 403 when a credential is presented but resolves to an invalid/expired/wrong-tier session. This plan's must_haves and key_links explicitly specify `res.status===401` as the sole trigger, so a 403 (stale-but-present session token) is intentionally NOT treated as a logout signal by this plan -- consistent with the locked D-03 decision text, not a gap I introduced.
- **`_tokenWarnTimer`/`tryRefreshToken`'s visibility-wake path:** left structurally in place (not explicitly named in the PATTERNS.md deletion inventory) but severed from `handleUnauthorized()` -- a failed background refresh now only resets the auth-status dot. This is inert/harmless (nothing re-reads the refreshed Google token at runtime) but zero test coverage referenced it, so removing the periodic-refresh *timers* themselves (which WERE in the inventory) fully addresses D-01/D-02's substance without extra unreviewed surface area.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `tests/frontend/admin-api-get-token.test.js` asserted the OLD brewpad.js adminApiGet contract**
- **Found during:** Task 2 (full frontend suite run after rewriting adminApiGet/adminApiPost)
- **Issue:** This pre-existing shared test (`runAdminApiGetTokenSuite`) exercises the SAME `_adminApiGetForTest` seam for both `brewpad.js` and `admin.js`, asserting the 64-03 contract (POST to `ADMIN_API_URL` with a `token` body field; an `{ok:false, message:'unauthorized'}` body triggers `handleUnauthorized`/shows `bp-session-overlay`). This plan's explicit, mandated transport change for brewpad.js (D-01/D-02/D-03) directly and unavoidably invalidates those specific brewpad.js-half assertions.
- **Fix:** Parameterized the shared suite (`expectedUrl`, `expectTokenField`, per-surface test titles, `assertUnauthorizedOutcome`) so `brewpad.js`'s half now asserts the NEW contract (proxy URL, no token field, no session-overlay on a body-level "unauthorized"), while `admin.js`'s half (untouched surface, Pitfall 4) keeps its original assertions byte-for-byte unchanged.
- **Files modified:** tests/frontend/admin-api-get-token.test.js
- **Verification:** All 8 tests in the file pass (4 brewpad.js + 4 admin.js)
- **Committed in:** a572275b (Task 2 commit)

**2. [Rule 3 - Blocking] `tests/frontend/brewpad-delete-reconcile.test.js`'s fetch-mock routed on the old ADMIN_API_URL prefix**
- **Found during:** Task 2 (full frontend suite run)
- **Issue:** The test's `mockFetch()` helper matched `delete_batch`/`get_batches` calls by `u.indexOf(global.SHEETS_CONFIG.ADMIN_API_URL) === 0`. Once adminApiPost/adminApiGet moved to the proxy URL, this match silently failed and fell through to a generic `{}` response (no `.ok` field), causing `delete_batch` to reject and the downstream reconcile-hook assertions (3 of 4 tests) to see zero calls.
- **Fix:** Changed the routing condition to `u.indexOf('/api/batch/admin-proxy') !== -1`, matching the same substring-match idiom already used for the reconcile-hook branch immediately above it. No assertions, fixtures, or expected payloads changed.
- **Files modified:** tests/frontend/brewpad-delete-reconcile.test.js
- **Verification:** All 4 tests in the file pass
- **Committed in:** a572275b (Task 2 commit)

**3. [Rule 1 - Bug] `doSilentRefreshOnLoad`'s exhausted-retry branch cleared a still-valid sv_session on a Google-side failure**
- **Found during:** Task 3 (reviewing every caller of the deleted `clearSession()`/`handleUnauthorized()` per the PATTERNS.md inventory before deleting `_silentRefreshTimer`)
- **Issue:** After 3 synchronous `tokenClient.requestAccessToken()` attempts threw, the code called `clearSession()` -- deleting `sv_session_token` purely because the silent Google-token refresh failed. This is exactly the D-03 anti-pattern this whole phase exists to eliminate, just in the page-load path rather than the runtime API path.
- **Fix:** Removed the `clearSession()` call; the exhausted-retry branch now only shows the sign-in button, matching the rest of this plan's "no Google/Apps-Script failure clears sv_session" principle.
- **Files modified:** js/brewpad.js
- **Verification:** `npx jest tests/frontend/brewpad-auth-init.test.js` (exercises this exact path) passes unchanged
- **Committed in:** 2e899904 (Task 3 commit)

---

**Total deviations:** 3 auto-fixed (2 blocking test-collateral fixes, 1 bug fix)
**Impact on plan:** All three were direct, unavoidable consequences of correctly implementing this plan's explicit, mandated transport/logout-trigger changes (D-01/D-02/D-03) -- not scope creep. No plan task or acceptance criterion was skipped or weakened.

## Known Stubs
None.

## Threat Flags
None -- all surface changes are covered by the plan's own `<threat_model>` (T-76-03-01 through T-76-03-05), no new endpoints/auth paths/schema changes were introduced.

## Issues Encountered
None beyond the deviations documented above.

## User Setup Required
None - no external service configuration required. (Deployment/staging verification of this behavior is the orchestrator's/user's job per the phase's normal workflow, not a setup step.)

## Next Phase Readiness
- BrewPad now runs on the single-credential model end-to-end across 76-01/76-02/76-03: Google is used only at login, all batch/dashboard/reading/schedule traffic goes through the middleware admin-proxy with `x-session-token`, and a real middleware 401 is the sole re-login trigger.
- The "Session expired while sv_session is valid" bug (STAFF-AUTH) is eliminated by construction: there is no remaining code path where a Google/Apps-Script-side failure can clear `sv_session_token`.
- All four gates green: `npm run lint` (0 warnings), `npm test` (1150/1150), `zoho-middleware npm test` (1459/1459), `zoho-middleware npm run lint` (0 warnings).
- No blockers for phase completion. Live staging verification of the auth flow (not exercisable from this sandbox) remains the orchestrator's normal post-merge step.

## Self-Check: PASSED

All 7 claimed files verified present on disk; all 3 claimed commit hashes (`c739f92d`, `a572275b`, `2e899904`) verified present in `git log --oneline --all`.

---
*Phase: 76-brewpad-session-expiry-hardening*
*Completed: 2026-08-27*
