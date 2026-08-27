---
phase: 76-brewpad-session-expiry-hardening
verified: 2026-08-27T15:45:00Z
status: human_needed
score: 11/11 must-haves verified (all automated checks pass; live UAT remains)
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 10/11
  gaps_closed:
    - "A Google-token / Apps-Script failure no longer removes sv_session_token from localStorage (D-03) — the onTokenResponse else-branch clearSession() call was removed (commit d79084b3), test-first (RED commit fd5048c9)"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "iPad Safari long-idle / reload session survival — sign in to BrewPad, let the Google token expire (~1hr+) while sv_session is still valid, then force a page reload under Safari's default third-party-cookie restriction (so GIS silent refresh is likely to fail)."
    expected: "The app either silently re-establishes a Google token or shows the manual 'Sign in with Google' button — but NEVER wipes sv_session_token or shows a 'Session expired' full-login overlay while the durable session is still valid."
    why_human: "Requires real GIS behavior (third-party-cookie enforcement, actual popup/silent-auth timing) not fully simulable in Jest; this is the exact scenario diagnosed on staging in Phase 73."
  - test: "Staging (then prod) deploy + live BrewPad regression — deploy 76-02/76-03, then exercise a full BrewPad session: login, browse batches/dashboard, edit a batch, add a Plato reading, sign out, sign back in; then invalidate the server-side session and confirm the login modal appears."
    expected: "All reads/writes succeed via the new /api/batch/admin-proxy; only a real middleware 401 ever shows the login modal."
    why_human: "Live Railway middleware + Redis session store + live Apps Script not exercisable from the sandbox; STATE.md's 'green tests ≠ working system' anti-pattern applies (this is exactly the class of Apps-Script-crossing change that has silently broken in prod before)."
---

# Phase 76: BrewPad session-expiry hardening — Verification Report

**Phase Goal:** Stop a Google-OAuth/Apps-Script 401 (or an "unauthorized" response body) from destroying the still-valid durable `sv_session`, via a full single-credential migration (D-01..D-05): BrewPad authenticates every batch/dashboard/reading/schedule call via the middleware proxy using only `x-session-token`, the Google token is used only at login, dual-token machinery is deleted, and `sv_session` TTL slides on use.

**Verified:** 2026-08-27 (re-verified after gap closure)
**Status:** human_needed — all automated must-haves VERIFIED; the single blocker found in the initial pass is genuinely closed; live UAT + deploy remain as human-only steps.
**Re-verification:** Yes — after gap closure (blocker in the initial pass fixed test-first, commits fd5048c9 RED + d79084b3 GREEN)

## Re-Verification: Blocker Closure Confirmed

The initial verification found one BLOCKER: `onTokenResponse()`'s `else` branch called `clearSession()` on a Google-side (GIS) silent-refresh failure during page load, destroying a still-valid `sv_session_token` — a direct violation of D-03. This has now been fixed and independently re-verified:

| Check | Method | Result |
|-------|--------|--------|
| The `else` branch no longer calls `clearSession()` | Read `js/brewpad.js:1258-1266` at HEAD — branch now falls through to `showSignInButton()` with a D-03 comment | ✓ CLOSED |
| No remaining Google/GIS/Apps-Script failure path calls `clearSession()` | `grep -n clearSession js/brewpad.js` → only 3 hits: the definition (1050) + two callers (1404, 1448); each classified below | ✓ CONFIRMED |
| — `bpSignOut()` (`:1404`) | Explicit staff sign-out — legitimate | ✓ allowed |
| — `_enterLoggedOutState()` (`:1448`) | Reached ONLY by `_handleMiddlewareResponse` on a real middleware `response.status===401` (`:1464-1465`) or the multi-tab `storage` sign-out listener (`:1377-1381`) — both legitimate per D-03 | ✓ allowed |
| New regression test exercises the previously-failing path | Read test `(e)` (`tests/frontend/brewpad-auth-init.test.js:388-423`): seeds an expired `sv-brewpad-session` (forces `doSilentRefreshOnLoad`), seeds a valid `sv_session_token`, captures the GIS `initTokenClient` `callback`, drives it with `{error:'popup_closed_by_user'}` with no in-memory `accessToken`, asserts `sv_session_token` survives | ✓ exercises the exact path |
| Test was genuinely RED against pre-fix source | `git show d79084b3~1:js/brewpad.js` (== test commit fd5048c9) shows `clearSession()` present in the `else` branch at line 1260 | ✓ confirmed RED→GREEN |
| Test is GREEN now | `npx jest tests/frontend/brewpad-auth-init.test.js` — all pass incl. `(e)` | ✓ GREEN |
| `brewpad.min.js` reflects the fix | Re-ran `terser js/brewpad.js -o - -c -m` and byte-compared against committed `js/brewpad.min.js` — **identical** | ✓ rebuilt, not stale/hand-edited |
| Full frontend suite | `npx jest` → 85 suites, **1151/1151 pass** (was 1150; +1 for the new test) | ✓ green |

**The blocker is genuinely closed. No sibling D-03 violation remains.**

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | (76-01) The 10 added BrewPad write actions are reachable under `server_token` in the DEPLOYED Apps Script; `create_batch` already present | ✓ VERIFIED | `apps-script/adminApi.gs:261,321-364` — all 10 entries before the `invalid_action` catch-all; owner live-probed the deployed instance (76-01-SUMMARY.md) |
| 2 | (76-01) `server_token` GET for `get_batches` works on the deployed instance with no `.gs` change (A2) | ✓ VERIFIED | Owner live probe returned `{"ok":true,...}`; `doGet` unchanged |
| 3 | (76-01) `server_token` allowlist stays a hardcoded closed if-chain | ✓ VERIFIED | `adminApi.gs:252-366` closed if-chain + explicit catch-all |
| 4 | (76-02) Reads AND writes reachable through ONE `x-session-token`-authed route (`POST /api/batch/admin-proxy`) | ✓ VERIFIED | `zoho-middleware/routes/pos.js:3781-3833` — 17-key allow-list + `requireTiers(['legacy','session'])` |
| 5 | (76-02) Proxy rejects unknown actions 400 `invalid_action`; rejects no-credential 401 without calling Apps Script; strips client token; forwards `server_token` | ✓ VERIFIED | Code inspection + `batch-admin-proxy.test.js` (7 tests) + `auth-tiers-guard.test.js` pass (20/20 targeted; 1459/1459 full middleware suite) |
| 6 | (76-02) `touchSession` wired fire-and-forget into `resolveTier`'s session branch | ✓ VERIFIED | `zoho-middleware/lib/authTiers.js:136` — `session.touchSession(sid).catch(...)`, non-blocking, before `return 'session'` |
| 7 | (76-03) `adminApiGet`/`adminApiPost` hit the proxy with no Google token in the body | ✓ VERIFIED | `js/brewpad.js:1490-1530` — POST to `mwUrl()+'/api/batch/admin-proxy'`, no `token` field |
| 8 | (76-03) Full re-login fires ONLY on a real middleware `res.status===401`, never on an upstream body substring **and never on a Google/Apps-Script failure (D-03)** | ✓ VERIFIED (was PARTIAL) | `_handleMiddlewareResponse` (`:1461-1469`) keyed on `status===401` scoped to `MIDDLEWARE_URL`; **the previously-found Google-side `clearSession()` leak in `onTokenResponse` is now removed** — no non-middleware path clears `sv_session` |
| 9 | (76-03) Dual-token machinery deleted | ✓ VERIFIED | `grep -c` for `isUnauthorizedError`/`handleUnauthorized`/`_tokenRefreshTimer`/`_silentRefreshTimer` → 0 each |
| 10 | (76-03) `js/brewpad.min.js` regenerated from source | ✓ VERIFIED | Byte-identical to a fresh `terser` build of current (fixed) source; `?v=` stamp updated |
| 11 | (76-03) `bpSignOut`, multi-tab sign-out, login-time Google→`sv_session` exchange still work | ✓ VERIFIED | `bpSignOut` still calls `clearSession()` (explicit); multi-tab listener routes to `_enterLoggedOutState`; `/auth/google` mint unchanged in shape |

**Score:** 11/11 truths VERIFIED.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps-script/adminApi.gs` | Extended `doPost` server_token allowlist | ✓ VERIFIED | 10 actions, correct actor args + cache invalidation; `doGet`/OAuth switch untouched |
| `zoho-middleware/routes/pos.js` | `POST /api/batch/admin-proxy` | ✓ VERIFIED | Tier-gated, allow-listed, token-stripping, canonical axios shape |
| `zoho-middleware/lib/authTiers.js` | `touchSession` in `resolveTier` | ✓ VERIFIED | Fire-and-forget, self-throttled, non-blocking |
| `zoho-middleware/__tests__/batch-admin-proxy.test.js` | Proxy coverage | ✓ VERIFIED | 7 tests pass |
| `js/brewpad.js` | Repointed helpers + interceptor + deletions + **no Google-side session wipe** | ✓ VERIFIED | All confirmed; the residual `clearSession()` leak is now removed |
| `js/brewpad.min.js` | Rebuilt artifact | ✓ VERIFIED | Byte-identical to fresh build |
| `tests/frontend/brewpad-session-auth.test.js` | Regression coverage (3 mandated behaviors) | ✓ VERIFIED | Present + passing |
| `tests/frontend/brewpad-auth-init.test.js` | **New** gap-closure regression `(e)` | ✓ VERIFIED | Drives GIS `callback({error})` on the page-load silent-refresh path; asserts `sv_session_token` survives |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| adminApiGet/adminApiPost | middleware `/api/batch/admin-proxy` | `fetch(mwUrl()+'/api/batch/admin-proxy')` | ✓ WIRED | Confirmed |
| fetch-wrapper IIFE | `clearSession()`/login modal | `_handleMiddlewareResponse` (status===401) | ✓ WIRED | Sole automated logout trigger; confirmed |
| admin-proxy | `process.env.APPS_SCRIPT_URL` | `axios.post` with `server_token` | ✓ WIRED | Confirmed |
| resolveTier | session.touchSession | fire-and-forget on 'session' tier | ✓ WIRED | Confirmed |
| GIS silent-refresh (page load) | `sv_session_token` | `onTokenResponse` → `clearSession()` | ✓ **REMOVED** | The forbidden link is gone — `else` branch now only calls `showSignInButton()` |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `brewpad.min.js` matches fresh build | `terser js/brewpad.js -o - -c -m` byte-compare | Identical | ✓ PASS |
| Apps Script allowlist has all 10 new actions | `grep -n "action === '<name>'" adminApi.gs` | All present | ✓ PASS |
| Middleware admin-proxy tests | `npx jest __tests__/batch-admin-proxy.test.js __tests__/auth-tiers-guard.test.js` | 20/20 | ✓ PASS |
| **GIS silent-refresh error during page load does NOT wipe `sv_session_token`** (the former blocker) | `npx jest tests/frontend/brewpad-auth-init.test.js` test `(e)` | `sv_session_token` survives; GREEN | ✓ PASS (was FAIL in initial pass) |
| Full frontend suite | `npx jest` | 1151/1151, 85 suites | ✓ PASS |

### Probe Execution

Not applicable in the `scripts/*/tests/probe-*.sh` sense. The 76-01 "probes" were the owner's manual live Apps-Script curl checks (already owner-run, documented in 76-01-SUMMARY.md; not re-run per instructions).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| STAFF-AUTH | 76-01, 76-02, 76-03 | BrewPad session resilience — a silent-refresh/Apps-Script 401 no longer forces a full re-login while `sv_session` is valid | ✓ SATISFIED (pending live UAT) | Infrastructure (76-01/76-02) solid + owner-verified live; frontend migration (76-03) complete; the one reachable Google-side session-wipe path is now closed and regression-tested. The requirement's core promise is met in code; live iPad/staging UAT (human items below) confirms real-world behavior. |

### Anti-Patterns Found

None remaining. The initial pass's single blocker anti-pattern (`clearSession()` in a Google-only failure branch) is removed. No `TBD`/`FIXME`/`XXX`/`HACK`/`PLACEHOLDER` markers in any file touched by this phase.

### Human Verification Required

Both items are legitimate live-environment checks that cannot be exercised from the sandbox. They do not indicate any known defect — all automated checks pass — but per the "green tests ≠ working system" principle (STATE.md) they should be run before the phase is considered fully closed in production.

### 1. iPad Safari long-idle / reload session survival

**Test:** On a real iPad in BrewPad, sign in, let the Google token expire (~1hr+) while `sv_session` is still within its (now sliding) window, then force a page reload under Safari's default third-party-cookie restriction so GIS silent refresh is likely to fail.
**Expected:** The app either silently re-establishes a Google token or shows the manual "Sign in with Google" button — but in NEITHER case wipes `sv_session_token` or shows a "Session expired" full-login overlay while the durable session is still valid.
**Why human:** Requires real GIS behavior (third-party-cookie enforcement, popup/silent-auth timing) not fully simulable in Jest; this is the exact scenario diagnosed on staging in Phase 73.

### 2. Staging/production deploy + live BrewPad regression

**Test:** Deploy 76-02/76-03 to staging (middleware auto-deploys on `git push origin main`; frontend via the normal Pages flow), then exercise a full BrewPad session: login, browse batches/dashboard, edit a batch, add a Plato reading, sign out, sign back in, and verify that a genuinely-invalid `x-session-token` triggers the login modal.
**Expected:** All reads/writes succeed via the new proxy; only a real middleware rejection ever shows the login modal.
**Why human:** Live Railway middleware + Redis + live Apps Script not exercisable from the sandbox; STATE.md's "green tests ≠ working system" anti-pattern applies directly (this is exactly the class of Apps-Script-crossing change that has silently broken in prod before).

### Assessment of Executor-Reported Deviations (carried forward from initial pass — unchanged)

**1. Modification of two existing frontend test files (`admin-api-get-token.test.js`, `brewpad-delete-reconcile.test.js`) — CLAUDE.md rule 10.** ACCEPTABLE — both are minimal, mechanical consequences of the plan's mandated transport change (D-01), not scope creep; `admin.js`'s assertions remain substantively unchanged (parameterized, not weakened), and the delete-reconcile change is a one-line fetch-mock routing update. Coverage preserved.

**2. Fixing a D-03 violation in `doSilentRefreshOnLoad`'s exhausted-retry branch + renaming `_silentRefreshTimer` → `_googleResumeTimer`.** ALIGNED and correct. (Note: the initial pass observed this same review missed the sibling `onTokenResponse` else-branch occurrence — that omission is exactly the blocker that has now been closed by the coordinator's follow-up fix.)

### Gaps Summary

**No gaps remain.** The phase is executed to a high standard across all three plans:
- 76-01 (Apps-Script allowlist) — owner-verified live on the deployed instance.
- 76-02 (middleware proxy + sliding session expiry) — cleanly implemented, fully tested, verified in code.
- 76-03 (frontend single-credential migration) — transport repointing, the global 401 interceptor, deletion of the dual-token machinery, preservation of explicit/multi-tab sign-out and the login-time exchange, and the rebuilt minified artifact all verified against the actual codebase.

The one blocker found in the initial pass — a residual `clearSession()` call in `onTokenResponse`'s `else` branch that let a Google-side GIS silent-refresh failure destroy a still-valid `sv_session` (a direct D-03 violation) — has been fixed test-first and independently re-verified: the offending call is removed, no other Google/Apps-Script failure path reaches `clearSession()`, the new regression test truly exercises the previously-failing path (RED against pre-fix source, GREEN now), and `brewpad.min.js` is byte-identical to a fresh build of the fixed source.

The phase's central promise — "a Google-OAuth/Apps-Script failure no longer forces a full re-login while `sv_session` is still valid" — is now delivered in code. Status is **human_needed** (not `passed`) solely because two live-environment UAT steps (iPad Safari session survival + staging/prod deploy regression) remain, per the standard requirement that human verification items keep the status at `human_needed` even when all automated checks pass.

---

*Verified: 2026-08-27 (initial) / re-verified 2026-08-27 (gap closure)*
*Verifier: Claude (gsd-verifier)*
