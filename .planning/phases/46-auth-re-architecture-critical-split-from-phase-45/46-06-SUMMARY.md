---
phase: 46-auth-re-architecture-critical-split-from-phase-45
plan: 06
subsystem: admin-frontend-auth
tags: [auth, session-cookie, admin, kiosk-embedded, security]
dependency-graph:
  requires: []
  provides:
    - "js/admin.js: session-cookie authenticated admin surface"
  affects:
    - "js/admin.js"
    - "tests/frontend/admin-session-auth.test.js"
    - "tests/frontend/kiosk-recipe-quote.test.js"
tech-stack:
  added: []
  patterns:
    - "fetch(..., { credentials: 'include' }) for session-cookie transport"
key-files:
  created:
    - tests/frontend/admin-session-auth.test.js
    - .planning/phases/46-auth-re-architecture-critical-split-from-phase-45/deferred-items.md
  modified:
    - js/admin.js
    - tests/frontend/kiosk-recipe-quote.test.js
decisions:
  - "checkAuthorization() POSTs the unchanged GIS access_token to POST /auth/google (credentials:'include') and reads {authorized,email}; the client-side Config-sheet allowlist fallback is removed (T-46-22) — server STAFF_EMAILS allowlist is now the sole source of truth"
  - "getMwHeaders()/getRecipesMwHeaders() no longer accept a `mutating` param or attach X-API-Key; every migrated fetch call site adds credentials:'include' instead"
  - "Admin-embedded kiosk (#tab-kiosk) fetches ride the admin session per Finding #2 — same credentials:'include' migration applied there (gift-card issue/reload/lookup/void, recipe browse/quote/quick-edit/save-as-new/availability/sale/confirm)"
metrics:
  duration: "~35 min"
  completed: 2026-07-02
---

# Phase 46 Plan 06: Admin Session-Cookie Auth Migration Summary

Migrated `js/admin.js` off the shared `MW_API_KEY` header entirely — `checkAuthorization()` now exchanges the unchanged GIS access token for a server session via `POST /auth/google` (credentials:'include'), and all 36 admin + embedded-kiosk fetch call sites (purchase orders, batch/contact lookups, gift-card issue/reload/lookup/void/management, recipe CRUD, and the full #tab-kiosk recipe-sale flow) now transport the `sv_session` cookie instead of a bearer-style API key.

## What Was Built

**Task 1 — `checkAuthorization()` session exchange:** Replaced the Apps-Script `adminApiGet('check_auth')` round-trip and the client-side Config-sheet staff-email fallback with `fetch(getMwUrl() + '/auth/google', { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body: JSON.stringify({access_token: accessToken}) })`. Response `{authorized, email}` drives `showDashboard()`/`showDenied()`; network/parse errors fail closed to `showDenied()`. `onTokenResponse` and the GIS `initTokenClient` flow are untouched.

**Task 2 — credentials:'include' everywhere:** Removed all 36 `x-api-key`/`X-API-Key`/`MW_API_KEY`/`mwApiKey()` sites (verified via `grep -c "MW_API_KEY\|x-api-key" js/admin.js` == 0). This includes:
- `getMwHeaders()` / `getRecipesMwHeaders()` helpers — dropped the `mutating` param and the `X-API-Key` header entirely; every caller (4 + 7 call sites respectively) now passes `credentials: 'include'` alongside.
- Purchase orders, batch customer refresh/lookup/create, consignment report.
- Admin-embedded kiosk under `#tab-kiosk`: new-customer creation/search, gift-card issue (next-number)/reload (lookup)/management modal (lookup + void), and the full recipe-sale surface (browse list, quote, quick-edit, save-as-new, availability check, sale POST, recipe-sale/confirm, gift-card-only confirm) — all ride the admin session per Finding #2, not a device token.

**Task 3 — jsdom test coverage:** New `tests/frontend/admin-session-auth.test.js` proves: `authorized:true` → dashboard shown; `authorized:false` → denied state (no client allowlist fallback); the POST body/method/`credentials:'include'` shape sent to `/auth/google`; network/parse errors fail closed; and a representative `#tab-kiosk` fetch (gift-card lookup) sends `credentials:'include'` with no `headers` object at all (i.e., no `x-api-key`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Existing test enforced the exact obsolete behavior this plan removes**
- **Found during:** Task 2 (full frontend suite run after removing `x-api-key`)
- **Issue:** `tests/frontend/kiosk-recipe-quote.test.js` T1b asserted `opts.headers['x-api-key']).toBe('test-api-key')` — this is precisely the insecure transport the plan's acceptance criteria require removing (`grep -c "x-api-key" js/admin.js` == 0). Keeping this test passing was mathematically incompatible with completing the task.
- **Fix:** Updated the test to assert `opts.credentials === 'include'` and `opts.headers === undefined`, matching the new session-cookie transport on `kioskFetchRecipeQuote`.
- **Files modified:** `tests/frontend/kiosk-recipe-quote.test.js`
- **Commit:** `44083a3`

**2. [Rule 3 - Blocking] `checkAuthorization` was not exported for testing**
- **Found during:** Task 3 (writing the jsdom test per plan's acceptance criteria)
- **Issue:** `js/admin.js` had no way to invoke `checkAuthorization()` directly or seed `accessToken`/`userEmail` for a test, blocking the required test coverage.
- **Fix:** Added `checkAuthorization`, `_setAccessToken`, `_setUserEmail` to the existing `module.exports` block (mirrors the pre-existing `_kiosk*` test-hook pattern already used elsewhere in the file).
- **Files modified:** `js/admin.js`
- **Commit:** `0491ac4`

### Out-of-scope discovery (logged, not fixed)

`loadConsignmentReport()` (js/admin.js ~line 5444) references bare undeclared globals `MW_URL`/`MW_API_KEY` (not `SHEETS_CONFIG.MIDDLEWARE_URL`/`SHEETS_CONFIG.MW_API_KEY`) — a pre-existing bug unrelated to this auth migration (the panel was already broken before 46-06). Removed the `x-api-key` header per this plan's acceptance criteria but left the `MW_URL` base-URL bug for a future fix. Logged in `.planning/phases/46-auth-re-architecture-critical-split-from-phase-45/deferred-items.md`.

## Verification

- `grep -c "MW_API_KEY\|x-api-key" js/admin.js` → `0`
- `npx eslint js/admin.js` → 0 errors, 39 pre-existing warnings (eqeqeq/no-console), none introduced by this plan
- `npx jest tests/frontend` → 51 suites / 936 tests passed (was 931 before; +5 new, 0 broken)
- `npx jest tests/frontend/admin-session-auth.test.js` → 5/5 passed

## Known Stubs

None — no stub patterns introduced.

## Threat Flags

None — the plan's own `<threat_model>` (T-46-22, T-46-02b, T-46-04b) fully covers the surface touched here; no new endpoints, auth paths, or schema changes were introduced. `POST /auth/google` itself is server-side (46-02/46-03), not built in this plan.

## Self-Check: PASSED

- FOUND: js/admin.js
- FOUND: tests/frontend/admin-session-auth.test.js
- FOUND: tests/frontend/kiosk-recipe-quote.test.js
- FOUND: .planning/phases/46-auth-re-architecture-critical-split-from-phase-45/deferred-items.md
- FOUND commit a93f8c2 (Task 1)
- FOUND commit 44083a3 (Task 2 + test fix deviation)
- FOUND commit 0491ac4 (Task 3 + export hooks)
