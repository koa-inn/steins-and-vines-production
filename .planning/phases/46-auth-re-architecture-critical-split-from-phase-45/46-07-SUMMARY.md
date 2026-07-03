---
phase: 46-auth-re-architecture-critical-split-from-phase-45
plan: 07
subsystem: auth
tags: [google-oauth, session-cookie, brewpad, credentials-include, jest]

# Dependency graph
requires:
  - phase: 46 (this phase, prior plans)
    provides: "POST /auth/google server-session endpoint + sv_session cookie contract (46-0X middleware plans)"
provides:
  - "js/brewpad.js authenticates via the server session cookie (D-46-09) instead of the leaked MW_API_KEY / Apps-Script check_auth round trip"
  - "All ~22 BrewPad-to-middleware staff fetches now transport credentials:'include' instead of x-api-key"
affects: [46-09 (rebuild main.js/main.min.js), 46-10 (rotation cutover), admin.js analog (46-06)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "checkAuthorization(onError) preserved signature, internals swapped from adminApiGet('check_auth') to fetch(POST /auth/google, credentials:'include')"
    - "getRecipesMwHeaders() simplified to a pure Content-Type builder now that the mutating-header (x-api-key) branch is gone"

key-files:
  created:
    - tests/frontend/brewpad-session-auth.test.js
  modified:
    - js/brewpad.js
    - tests/frontend/brewpad-auth-init.test.js

key-decisions:
  - "checkAuthorization's onError callback is invoked ONLY on a real fetch/network failure (not on a clean authorized:false 403 response), matching the original adminApiGet('check_auth') contract exactly — preserves the silent-refresh fallback (T-46-24)"
  - "mwApiKey() helper deleted entirely (not left as a returns-'' shim) since grep gates check for the literal string MW_API_KEY, which the shim's own body would have matched"

patterns-established:
  - "BrewPad staff-fetch credentials pattern: drop 'x-api-key' header, add credentials:'include' to the fetch options object — mirrors the equivalent admin.js migration (46-06)"

requirements-completed: [AUDIT-CRITICAL-AUTH, D-46-09, D-46-06]

# Metrics
duration: 12min
completed: 2026-07-02
---

# Phase 46 Plan 07: BrewPad Session-Cookie Auth Migration Summary

**BrewPad drops the leaked MW_API_KEY entirely — checkAuthorization now exchanges the Google access_token for a server session via POST /auth/google, and all ~22 staff fetches transport the sv_session cookie via credentials:'include'.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-07-02T17:20:00-07:00 (approx, first Read)
- **Completed:** 2026-07-02T17:29:26-07:00
- **Tasks:** 3
- **Files modified:** 2 (js/brewpad.js, tests/frontend/brewpad-auth-init.test.js) + 1 created (tests/frontend/brewpad-session-auth.test.js)

## Accomplishments
- `checkAuthorization(onError)` now POSTs `{access_token}` to `/auth/google` with `credentials:'include'`, replacing the Apps-Script `adminApiGet('check_auth')` round trip, while preserving the exact `onError` callback contract used by the stored-token silent-refresh fallback
- Removed `mwApiKey()` and every `x-api-key`/`MW_API_KEY` reference from BrewPad's ~22 middleware fetch call sites (recipe CRUD, batch pull/bulk-create, customer reassign/search, contacts, bottling invites, Zoho sync) — all now send `credentials:'include'`
- Simplified `getRecipesMwHeaders()` to a pure `{'Content-Type':'application/json'}` builder (its mutating/x-api-key branch is gone)
- New jsdom test suite (`brewpad-session-auth.test.js`) proves both `checkAuthorization` branches (authorized true/false) and the `onError` fallback, plus a representative staff fetch (`bpSaveAsNewRecipe`) sending `credentials:'include'` with no `x-api-key`

## Task Commits

Each task was committed atomically:

1. **Task 1: checkAuthorization(onError) → /auth/google, preserving signature** - `f27fcea` (feat)
2. **Task 2: Swap all BrewPad API calls to credentials:'include'** - `0f3acf4` (feat)
   - Deviation fix (Rule 1, existing test broke by design): `1c855f9` (fix)
3. **Task 3: Frontend test for BrewPad session transport** - `e5c50c2` (test)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified
- `js/brewpad.js` — checkAuthorization rewritten to hit `/auth/google`; mwApiKey() removed; all staff fetches now send `credentials:'include'`; `_checkAuthorization`/`_setAccessTokenForTest` test hooks exported
- `tests/frontend/brewpad-session-auth.test.js` — new: proves the session-cookie auth contract (Task 3)
- `tests/frontend/brewpad-auth-init.test.js` — updated one regression test (and one stale comment) that asserted the now-removed `check_auth` URL shape; see Deviations

## Decisions Made
- checkAuthorization treats a parsed `authorized:false` response (even from a 403) as a normal "denied" outcome (calls `showDenied()` directly, not `onError`) — only real fetch/network failures invoke `onError`. This exactly mirrors the pre-migration behavior of `adminApiGet('check_auth')`, so the silent-refresh fallback semantics are unchanged.
- `mwApiKey()` was deleted rather than left as a `return ''` shim, because the shim's own source line would still contain the literal string `MW_API_KEY` and fail the plan's grep verification gate.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug/regression] Updated brewpad-auth-init.test.js's now-incorrect check_auth assertion**
- **Found during:** Task 2 (running `npm test` before commit, per CLAUDE.md rule 1)
- **Issue:** `tests/frontend/brewpad-auth-init.test.js` had one test ("(a) valid stored session: calls fetch for checkAuthorization with stored token") that asserted the fetch URL contained `action=check_auth` and the raw token — this was pinned to the OLD Apps-Script implementation that Task 1 intentionally replaced (D-46-09 is the whole point of this plan). The test failed as a direct, expected consequence of the planned change, not a bug introduced elsewhere.
- **Fix:** Updated the assertion to check the new request shape (`POST /auth/google`, `credentials:'include'`, JSON body `{access_token}`) instead of the old query-string URL. Also corrected a stale comment in the neighboring "(d) network error → silent refresh" test that referenced the removed `adminApiGet`/`fetchWithRetry` retry path (the assertion itself was already correct, since it did not depend on retry-specific timing).
- **Files modified:** `tests/frontend/brewpad-auth-init.test.js`
- **Verification:** `npx jest tests/frontend/brewpad-auth-init.test.js` → 10/10 pass; full `npm test` → 51 suites / 937 tests pass
- **Committed in:** `1c855f9`

---

**Total deviations:** 1 auto-fixed (1 test-update-for-intentional-behavior-change, filed under Rule 1)
**Impact on plan:** Necessary to keep the test suite green after the plan's own required implementation change (Task 1). No unrelated tests were touched — grepped for `check_auth`/`checkAuthorization`/`mwApiKey`/`MW_API_KEY`/`x-api-key` across all `tests/frontend/brewpad*.test.js` first to confirm this was the only affected assertion (two other files reference `MW_API_KEY` in their `SHEETS_CONFIG` mock but never assert on it being sent).

## Issues Encountered

- `zoho-middleware/node_modules` is not installed in this worktree, so `cd zoho-middleware && npm test` could not be run (fails immediately on `Cannot find module 'axios'` for every suite). This plan's `files_modified` is scoped to `js/brewpad.js` and `tests/frontend/*` only — no `zoho-middleware/` files were touched, so there is no regression risk from this plan. Flagging as a pre-existing worktree-provisioning gap, out of scope to fix here (installing dependencies is excluded from auto-fix per Rule 3's package-manager-install exclusion, and this worktree's `zoho-middleware` was never provisioned to begin with, not a package-legitimacy question).
- The plan's `<verification>` block command `npx jest tests/frontend/brewpad-session-auth.test.js -x` uses an unrecognized Jest CLI flag (`-x` is not a valid `jest` option in the installed Jest version). Ran the equivalent `npx jest tests/frontend/brewpad-session-auth.test.js` instead (6/6 pass). Note: any single-file `npx jest <file>` invocation in this repo exits 1 due to the global coverage threshold (5% lines) not being met when only one file's code is exercised — this is a pre-existing property of the repo's Jest config, reproduced identically against an untouched test file (`brewpad-auth.test.js`), not something introduced by this plan. The authoritative gate is `npm test` (full suite), which exits 0.

## User Setup Required

None - no external service configuration required. (The `/auth/google` server endpoint this plan's `checkAuthorization` now calls is delivered by other plans in this phase — 46-01 through 46-06/46-08 — this plan only changes the BrewPad client to call it.)

## Next Phase Readiness

- `js/brewpad.js` is ready for the 46-09 rebuild (`npm run build` was intentionally NOT run per this plan's objective — that step belongs to 46-09) and for the 46-10 MW_API_KEY rotation cutover, since BrewPad no longer sends the leaked key at all.
- No blockers. This plan's scope (BrewPad only) is independent of the admin.js analog (46-06), which had not yet landed in this worktree at time of execution — verified admin.js still uses the old `adminApiGet('check_auth')`/`x-api-key` pattern, confirming no cross-plan interference occurred.

---
*Phase: 46-auth-re-architecture-critical-split-from-phase-45*
*Completed: 2026-07-02*

## Self-Check: PASSED

- FOUND: js/brewpad.js
- FOUND: tests/frontend/brewpad-session-auth.test.js
- FOUND: tests/frontend/brewpad-auth-init.test.js
- FOUND commit: f27fcea (Task 1)
- FOUND commit: 0f3acf4 (Task 2)
- FOUND commit: 1c855f9 (deviation fix)
- FOUND commit: e5c50c2 (Task 3)
