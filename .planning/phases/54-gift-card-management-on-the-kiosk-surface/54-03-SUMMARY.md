---
phase: 54-gift-card-management-on-the-kiosk-surface
plan: 03
subsystem: testing
tags: [jest, jsdom, kiosk, gift-cards, regression-test, device-token]

# Dependency graph
requires:
  - phase: 54-02
    provides: "The kgcm- lookup+void panel shipped in js/kiosk-core.js + kiosk.html markup"
  - phase: 54-01
    provides: "Device-token void scope (KIOSK_ROUTES allowlist) that makes the kiosk panel's void call legal"
provides:
  - "Frontend regression coverage locking in the kiosk kgcm- panel's device-token auth path (x-device-token, never credentials:'include')"
  - "Client-side reason-required gate coverage — proves an empty reason cannot fire a void POST"
affects: [kiosk-core, gift-cards]

# Tech tracking
tech-stack:
  added: []
  patterns: ["loadSurface() harness (jest.resetModules + fresh window.KioskCore) to drive the real js/kiosk-core.js panel through js/kiosk.js's device-token env injection, per tests/frontend/kiosk-core-parity.test.js"]

key-files:
  created: [tests/frontend/kiosk-gift-card-mgmt.test.js]
  modified: []

key-decisions:
  - "Used real timers (no setTimeout mock) so flushPromises()'s macrotask setTimeout(0) fully drains the fetch(...).then().then() microtask chain before assertions run, matching admin-gift-card-mgmt.test.js's proven pattern rather than kiosk-device-token.test.js's synchronous-setTimeout mock (which broke the flush for this panel's nested .then() chain)."

patterns-established:
  - "Kiosk-surface regression tests for shared kiosk-core.js panels should use loadSurface('../../js/kiosk.js') + real timers, not the synchronous-setTimeout debounce-collapsing mock, whenever the panel under test has a multi-hop fetch(...).then(r => r.json().then(...)).then(...) chain."

requirements-completed: [KIOSK-GC-54]

# Metrics
duration: 12min
completed: 2026-07-08
---

# Phase 54 Plan 3: Kiosk Gift Card Management Regression Test Summary

**Added `tests/frontend/kiosk-gift-card-mgmt.test.js`, driving the real kgcm- panel through the device-token auth path and proving the void confirmation gate blocks an empty reason.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-08T20:48:00Z
- **Completed:** 2026-07-08T21:00:38Z
- **Tasks:** 1 completed
- **Files modified:** 1

## Accomplishments
- New regression test proves the kiosk `kgcm-` lookup + void fetches carry `x-device-token` and never `credentials:'include'` (D-54-03) — the client-side half of the auth-scope safety story for D-54-GC.
- New negative-case test proves an empty void reason blocks Confirm Void client-side with no second fetch fired (D-54-02 reason-required gate) — a case the admin analog test file lacked.
- Also asserts the void POST body and rendered result-card fields (cert #, status, face value, current balance), mirroring `admin-gift-card-mgmt.test.js`'s existing coverage for the kiosk surface.

## Task Commits

Each task was committed atomically:

1. **Task 1: Write kiosk-gift-card-mgmt.test.js — device-token lookup+void + reason-required gate** - `43f5cd6` (test)

**Plan metadata:** (this commit)

## Files Created/Modified
- `tests/frontend/kiosk-gift-card-mgmt.test.js` - New regression test file (4 tests) exercising the kiosk `kgcm-` panel via `js/kiosk-core.js`'s `showGiftCardMgmt()` entry, driven through `js/kiosk.js`'s real device-token `buildAuthOptions()` using the `loadSurface()` isolation harness.

## Decisions Made
- Chose real (unmocked) timers for `flushPromises()` rather than the synchronous-setTimeout mock used in `kiosk-device-token.test.js`. The synchronous mock resolves `flushPromises()`'s promise before the fetch chain's microtasks drain, which caused two of the four tests to fail (empty `innerHTML`, fetch call count off by one) until removed — no debounce logic in the kgcm- panel needed the synchronous mock anyway.

## Deviations from Plan

None - plan executed exactly as written. One in-flight bug (the synchronous-setTimeout mock breaking `flushPromises()`) was caught and fixed during initial TDD iteration on the same task, before the first commit — not a deviation from the plan's scope, just normal test-authoring debugging.

## Issues Encountered
- Initial draft of the test file mocked `setTimeout`/`setInterval` to fire synchronously (copied from `kiosk-device-token.test.js`'s debounce-collapsing pattern). This caused `flushPromises()` (which relies on a real macrotask `setTimeout(0)` to let the fetch promise chain's microtasks fully drain first) to resolve prematurely, breaking 2 of 4 assertions. Fixed by removing the timer mocks and using real timers, matching `admin-gift-card-mgmt.test.js`'s proven approach. Resolved before the task commit; no separate fix commit needed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Phase 54 (gift-card-management-on-the-kiosk-surface) is now fully complete across all three plans:
- 54-01: backend void scope (device-token allowlist)
- 54-02: kiosk-native `kgcm-` panel (js/kiosk-core.js + kiosk.html)
- 54-03: regression test coverage (this plan)

Full frontend suite (55 suites / 959 tests) and `npm run lint` are green. Phase 54 lands before the pending Phase 48 iPad UAT so both can be verified together in one session, per the ROADMAP note.

---
*Phase: 54-gift-card-management-on-the-kiosk-surface*
*Completed: 2026-07-08*

## Self-Check: PASSED

- FOUND: tests/frontend/kiosk-gift-card-mgmt.test.js
- FOUND: .planning/phases/54-gift-card-management-on-the-kiosk-surface/54-03-SUMMARY.md
- FOUND: commit 43f5cd6
