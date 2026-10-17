---
phase: 93-kiosk-ledger-week-and-month-views
plan: 04
subsystem: ui
tags: [kiosk, past-sales, ledger, drill-in, jest]

requires:
  - phase: 93-03
    provides: "Range UI (mode chips, _kioskPsRange, kioskPsRenderRange, hidden #kiosk-ps-backlink)"
provides:
  - "Drill-in from a range day row to the Phase 92 day ledger, with Back link restoring the range from memory and the ledger panel scroll position"
  - "Mode-aware refresh (range bust by range_start, day bust when drilled in)"
  - "D-11 clearing of drill-in state via kioskPastSalesClear"
affects: [93-05]

key-files:
  created: [tests/frontend/kiosk-past-sales-range-drill.test.js]
  modified: [js/kiosk-core.js, js/kiosk.js, js/kiosk-core.min.js, js/kiosk.min.js, kiosk.html]

key-decisions:
  - "Reload anchors use range_start only, never period_start (floor week 2019-12-30 would 400)"
  - "Drilled-in Day chip tap keeps the shown day ledger, nulls _kioskPsRange and clears origin without a fetch"

requirements-completed: [PSL-12, PSL-13, PSL-15]

duration: 20min
completed: 2026-10-17
---

# Phase 93 Plan 04: Range Drill-in and Back Summary

Tapping a week/month day row with sales opens that day's ledger; a Back link restores the range from memory with the same scroll position, and refresh and view-change clearing are drill-in aware.

## Tasks

1. RED 31dc2ad8 (failing tests), GREEN c1192bba (kiosk-core.js: kioskPsOpenDay, kioskPsBackToRange, kioskPsWireDayRows, _kioskPsOrigin, mode-aware kioskPsRefresh, exports, state `origin`)
2. 08c096a9: #kiosk-ps-backlink click in js/kiosk.js, kioskPastSalesClear resets origin and hides link, rebuilt kiosk min files and kiosk.html stamp

## Verification

- New suite 17 tests pass (drill-in, inert zero rows, Back with no fetch + scrollTop 240, late responses both directions, refresh branching, floor week, CV exit / lock / new-sale clearing).
- Full `npm test`: 204 suites, 2676 tests pass. `npm run lint`: 0 warnings.
- Existing test files untouched. Middleware suite not run (no middleware changes).

## Deviations from Plan

- Worktree base was not the expected commit; reset to 85f581d3 per the startup check.
- Tests call `mod._initKioskSaleTab()` after injecting markup so the real js/kiosk.js listener wiring is exercised.
- The "Back with null _kioskPsRange reloads via /range" path is implemented (range_start anchor) but not directly testable: no public setter nulls the range while an origin is set.
- Drill-in explicitly removes `active` from all chips after kioskPsSyncModeUi (sync would otherwise mark Day).

## Build churn

`npm run build` restamped unrelated HTML and rebuilt js/admin*.js; all reverted with `git checkout --`. links.html untouched.

## Known Stubs

None.

## Self-Check: PASSED
