---
phase: 46-auth-re-architecture-critical-split-from-phase-45
plan: 08
subsystem: auth
tags: [security, secret-removal, checkout, catalog, search, sheets-config]

# Dependency graph
requires:
  - phase: 46 (plan 03, parallel)
    provides: server-side keyless exemptions for /api/bookings, /api/contacts, /api/payment/initialize (Pitfall 4 companion — must land before cutover or these checkout POSTs would 403)
provides:
  - Removal of the leaked MW_API_KEY value from js/sheets-config.js (the CRITICAL exposure, D-46-10)
  - x-api-key header stripped from all public bundles that sent it (checkout POSTs, catalog GET, search GET)
affects: [46-09 (build + full-suite gate), 46-10 (staging live-checkout verify + API_SECRET_KEY rotation)]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Public JS bundles never send x-api-key; server-side referer/CORS guards + keyless exemptions replace client-carried secrets"]

key-files:
  created: []
  modified:
    - js/modules/12-checkout.js
    - js/modules/16-catalog-subpage.js
    - js/modules/17-search-overlay.js
    - js/sheets-config.js

key-decisions:
  - "No test files required updates — existing test suites mock their own SHEETS_CONFIG fixtures (with a stub MW_API_KEY) and none assert the removed header/property in the real config or in 12/16/17 modules, so the plan's conditional test-fix step was a no-op"

patterns-established:
  - "Public GET/POST fetches from browser-shipped modules carry no auth header; trust boundary moves entirely to server-side referer/CORS + keyless route exemptions"

requirements-completed: [AUDIT-CRITICAL-AUTH, D-46-10]

# Metrics
duration: ~10min
completed: 2026-07-03
---

# Phase 46 Plan 08: Remove leaked MW_API_KEY + strip x-api-key from public bundles Summary

**Deleted the leaked `MW_API_KEY` value from `js/sheets-config.js` and removed the `x-api-key` header from all 8 call sites across `12-checkout.js` (6 POSTs), `16-catalog-subpage.js`, and `17-search-overlay.js` (2 GETs) — the CRITICAL public-secret-exposure fix (D-46-10).**

## Performance

- **Duration:** ~10 min
- **Completed:** 2026-07-03T00:20:08Z
- **Tasks:** 2 completed
- **Files modified:** 4

## Accomplishments
- Leaked admin/middleware API key value permanently removed from the public, git-tracked `js/sheets-config.js` (public `CLIENT_ID` OAuth id retained unchanged)
- No public bundle (checkout, catalog subpage, search overlay) sends an `x-api-key` header anymore — 6 checkout POST call sites (`/api/bookings` x2, `/api/contacts` x2, `/api/payment/initialize` x2) and both catalog/search GET fetchers cleaned
- Removed now-dead `apiKey` local derivations in `16-catalog-subpage.js` and `17-search-overlay.js` alongside the header removal
- Full frontend suite (931 tests, 50 suites) passes unchanged; `npm run lint` reports 0 errors (pre-existing warning count unchanged)

## Task Commits

Each task was committed atomically:

1. **Task 1: Strip x-api-key from public bundles (checkout POSTs + catalog/search GETs)** - `6398e21` (fix)
2. **Task 2: Delete MW_API_KEY from sheets-config.js + fix any test asserting it** - `337c610` (fix)

_No plan-metadata commit in this wave — worktree mode defers STATE.md/ROADMAP.md updates to the orchestrator._

## Files Created/Modified
- `js/modules/12-checkout.js` - Removed `'x-api-key': MW_API_KEY` from all 6 fetch header objects (kept `Content-Type`); no URL/body/flow changes
- `js/modules/16-catalog-subpage.js` - Removed `x-api-key` header + unused `apiKey` local var from `fetchFromMiddleware()`
- `js/modules/17-search-overlay.js` - Removed `x-api-key` header + unused `apiKey` local var from both `fetchAllProducts()` and `fetchFromMiddleware()`
- `js/sheets-config.js` - Deleted `MW_API_KEY` property (line 65) and its rotation-instructions comment (lines 62-64); `CLIENT_ID` untouched

## Decisions Made
- Confirmed via grep that no existing test (`tests/frontend/*.test.js`) references the real `js/sheets-config.js` file or asserts the presence of its `MW_API_KEY` value — all `MW_API_KEY` references in the test suite are self-contained mock fixtures (`global.SHEETS_CONFIG = { MW_API_KEY: 'test-key', ... }`) used by unrelated admin/BrewPad/kiosk tests, unaffected by this removal. No test modifications were needed.
- Did not run `npm run build` per explicit plan instruction — rebuild + full-suite gate is reserved for 46-09.

## Deviations from Plan

None - plan executed exactly as written. Both tasks matched the plan's stated call-site counts and line numbers exactly (6 sites in 12-checkout.js; 2 sites each in 16/17; MW_API_KEY at sheets-config.js:65 with comment at 62-64).

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required. (Note: rotation of the corresponding Railway `API_SECRET_KEY` — the actual neutralization of the leaked value in git history — is tracked separately in 46-10, not this plan.)

## Next Phase Readiness
- This plan's removal is safe only in combination with 46-03's server-side keyless exemptions for `/api/bookings`, `/api/contacts`, `/api/payment/initialize` (Pitfall 4) — both must ship together before cutover, or public checkout POSTs would 403. 46-03 is a separate parallel plan in this wave; verify it has also landed before merging this wave.
- Ready for 46-09 (rebuild `main.js`/`main.min.js` + full test-suite gate) and 46-10 (staging live-checkout verification + `API_SECRET_KEY` rotation, which is what actually neutralizes the value still present in git history).
- No blockers.

---
*Phase: 46-auth-re-architecture-critical-split-from-phase-45*
*Completed: 2026-07-03*
