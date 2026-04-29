---
phase: 05-auth-reliability
plan: 02
subsystem: auth
tags: [form-persistence, session-overlay, ipad, save-on-interrupt, unit-tests]

# Dependency graph
requires:
  - 05-01 (tryRefreshToken mutex, bp-session-overlay CSS, _refreshInFlight, _lastTokenTime)
provides:
  - _formSavers registry with save-on-interrupt for 5 form types
  - saveAllFormDrafts() / restoreAllFormDrafts() functions
  - showSessionExpiredOverlay() blocking D-09 overlay
  - isSessionStale() and isSessionExpired() pure helpers (exported, tested)
  - "Your in-progress work has been restored" toast per D-06
affects:
  - staff UX: no form data lost on auth interruption
  - tests/frontend/brewpad-auth.test.js: 10 new unit tests

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Form saver registry: _formSavers array with {key, save, restore} objects — uniform save-on-interrupt across all form types
    - Save-on-interrupt: saveAllFormDrafts() captures all open forms to sessionStorage on auth failure
    - Restore-on-login: restoreAllFormDrafts() replays all sessionStorage drafts after showApp() with 200ms delay
    - Session expired overlay: D-09 blocking centered overlay (role=dialog, aria-modal) with sign-in button — prevents interaction with stale data
    - Pure helper extraction: isSessionStale/isSessionExpired lifted to top-level for testability without IIFE coupling

key-files:
  created:
    - tests/frontend/brewpad-auth.test.js
  modified:
    - js/brewpad.js
    - js/brewpad.min.js
    - brewpad.html

key-decisions:
  - "D-09 implemented: showSessionExpiredOverlay() shows blocking overlay instead of showSignInButton() on auth failure"
  - "D-06 implemented: restoreAllFormDrafts() returns bool; showApp() shows toast when any draft was restored"
  - "D-05 implemented: all 5 form types (create-batch, measurements, batch detail, reading, schedule) registered in _formSavers"
  - "handleUnauthorized() simplified: inline create-batch save replaced by single saveAllFormDrafts() call"
  - "showApp() simplified: inline create-batch restore replaced by restoreAllFormDrafts() + generic toast"

requirements-completed:
  - AUTH-02

# Metrics
duration: 18min
completed: 2026-04-29
---

# Phase 5 Plan 02: Form State Protection + Session Expired Overlay Summary

**All five BrewPad form types now save to sessionStorage on auth interruption and restore with a toast after re-login; a blocking D-09 overlay replaces the old sign-in button on session expiry**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-04-29T21:43:00Z
- **Completed:** 2026-04-29T22:01:00Z
- **Tasks:** 2
- **Files modified/created:** 4 (js/brewpad.js, tests/frontend/brewpad-auth.test.js, js/brewpad.min.js, brewpad.html)

## Accomplishments

- `_formSavers` registry with 5 entries — create-batch form (14 fields), multi-batch measurements (`_measMultiData` + `_measSharedDate`), batch detail (vessel/shelf/bin/notes + `_detailBatchId`), single reading (5 fields + `_detailPlatoStaging`), schedule template editor (5 fields + `_schedSteps`)
- `saveAllFormDrafts()` iterates registry on auth failure — single call in `handleUnauthorized()` replaces 35-line inline create-batch save block
- `restoreAllFormDrafts()` iterates registry after re-login — returns `true` if any draft was restored; `showApp()` shows "Your in-progress work has been restored" toast per D-06
- `showSessionExpiredOverlay()` creates a blocking centered dialog (z-index 1000, role=dialog, aria-modal) with sign-in button — replaces `showSignInButton()` in `handleUnauthorized()` per D-09; button click calls `tokenClient.requestAccessToken()` (user gesture, Safari safe)
- `onTokenResponse()` already removes the overlay on success (Plan 01 wiring confirmed present)
- `isSessionStale(lastTokenTime, thresholdMs)` and `isSessionExpired(loginAt, maxAgeMs)` extracted as top-level pure helpers, exported, and used in-place to replace inline math
- 10 new unit tests in `tests/frontend/brewpad-auth.test.js` covering both helpers (0/null inputs, boundary conditions, normal cases)

## Task Commits

1. **Task 1: Form saver registry, session expired overlay, restore toast** - `0fc9044` (feat)
2. **Task 2: Pure helper extraction, unit tests, build** - `ca126d2` (feat)

## Files Created/Modified

- `js/brewpad.js` — Added `_formSavers`, `saveAllFormDrafts`, `restoreAllFormDrafts`, `showSessionExpiredOverlay`, `isSessionStale`, `isSessionExpired`; modified `handleUnauthorized`, `showApp`, `loadSession`, visibilitychange handler, module.exports
- `tests/frontend/brewpad-auth.test.js` — New: 10 tests for `isSessionStale` and `isSessionExpired`
- `js/brewpad.min.js` — Rebuilt from source
- `brewpad.html` — Cache version bumped by build stamp

## Decisions Made

- D-09: `handleUnauthorized()` now calls `showSessionExpiredOverlay()` rather than `showSignInButton()`. The overlay blocks interaction (pointer-events auto, z-index 1000, full viewport) so staff cannot interact with stale data.
- D-06: `restoreAllFormDrafts()` returns a boolean. The 200ms delay in `showApp()` (slightly longer than the 150ms field-restore delay) ensures all DOM elements exist before the toast appears.
- Form saver order: savers registered in the same order as they appear in the UI (batches → measurements → detail/reading → schedules). `forEach` restores in registration order which is correct.
- The create-batch saver preserves the extended field list (14 fields including sku/name/customerText/customerId etc.) matching the actual form state as it exists in the DOM.

## Deviations from Plan

None - plan executed exactly as written. The `showApp()` field list in the plan was abbreviated (showed only some fields); the actual restore uses the full 14-field list consistent with what `handleUnauthorized()` previously saved inline and what the form actually contains.

## Known Stubs

None — all 5 form savers wire directly to real DOM element IDs and state variables that exist in the codebase.

## Threat Flags

No new security surface introduced beyond the plan's threat model. T-05-07 (XSS on restore) mitigated: all restore functions use `el.value = draft[key]` (safe input value assignment, not innerHTML). T-05-09 (overlay bypass) mitigated: overlay is z-index 1000, pointer-events auto when visible, covers full viewport.

## Self-Check: PASSED

- `js/brewpad.js` — FOUND
- `tests/frontend/brewpad-auth.test.js` — FOUND
- commit `0fc9044` — FOUND
- commit `ca126d2` — FOUND
- `grep -c "_formSavers" js/brewpad.js` returns 8 (>= 7 required)
- `grep -c "sv-brewpad-meas-draft" js/brewpad.js` returns 1 (>= 1 required)
- `grep -c "sv-brewpad-detail-draft" js/brewpad.js` returns 1 (>= 1 required)
- `grep -c "sv-brewpad-reading-draft" js/brewpad.js` returns 1 (>= 1 required)
- `grep -c "sv-brewpad-sched-draft" js/brewpad.js` returns 1 (>= 1 required)
- `grep -c "showSessionExpiredOverlay" js/brewpad.js` returns 2 (>= 2 required)
- `grep -c "isSessionStale|isSessionExpired" js/brewpad.js` returns 6 (>= 4 required)
- npm test: 264 passed (11 suites, includes brewpad-auth suite)
- npm run lint: 0 errors (79 pre-existing warnings)
- npm run build: success

---
*Phase: 05-auth-reliability*
*Completed: 2026-04-29*
