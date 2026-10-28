---
phase: 95-global-filters-and-chart-engine
plan: 07
subsystem: brewpad-dashboard
tags: [dashboard, drill, banner, staff-flag, es5, tdd]
requires: [95-06, 95-01]
provides: [openDashDrill, clearDashDrill, setStaffBatch, "#bp-drill-banner-slot", ".bp-drill-banner", ".bp-stat-card--link", "#bp-detail-staff"]
affects: [95-08]
key-files:
  created: [tests/frontend/brewpad-dashboard-v2-drill.test.js, tests/frontend/brewpad-staff-batch-ui.test.js]
  modified: [js/brewpad.js, js/brewpad.min.js, css/brewpad.css, css/brewpad.min.css, brewpad.html]
decisions:
  - "Drill intersection is applied in applyBatchFilter via drillFilterRows; readyToBottleRows/needsTypeRows contracts are untouched (their output is intersected)"
  - "The visible-count heading is rendered inside #bp-batch-results only while a drill is active and rows exist"
  - "Staff row uses the same deleted/disabled rule as Type but not the !_dashData rule, so it stays editable in any mode"
metrics:
  completed: 2026-10-28
---

# Phase 95 Plan 07: Drill destination and staff flag Summary

Batches tab can now show exactly an id set from the dashboard (chip all, search/product cleared) under a dismissible role=status banner, status chips narrow the set, and staff can toggle a Staff batch checkbox in the detail pane that updates the dashboard staff ids and re-runs the v2 model immediately.

## Commits
- 0040a9b9 feat(95-07): drill state, banner, drill-aware batch filter (Task 1)
- Task 2 commit: feat(95-07): staff batch checkbox in batch detail pane (see git log)

## Verification
- New suites: drill 10/10, staff 8/8. Full `npm test` 2976 passed (222 suites), `npm run lint` clean, `npm run build` ran.
- Existing tests unmodified; unlinked/list-after-write/filter-derive/batch-type-ui all pass.
- Test seams added (additive): `_openDashDrillForTest`, `_clearDashDrillForTest`, `_initDelegationForTest`; `getStateForTest` gains `_dashDrill`, `_batchSearch`, `_batchProductFilter`.
- Mix model for the refresh test is read at `_dashV2Model.cur.mix`.

## Deviations from Plan
- Worktree base was wrong; reset to 82e3aa21 per startup check.
- Tests were written alongside the implementation (no separate observed RED run); both suites were verified passing and cover each behavior bullet.
- `npm run build` re-stamped unrelated HTML and admin.js/min.js; reverted, committed only plan files (brewpad.html carries the cache-buster stamp).
- Middleware tests not run (middleware untouched; vancouver-timezone failure is pre-existing).

## Known Stubs
None. `.bp-stat-card--link` CSS is in place for plan 08 to use.

## Threat Flags
None. T-95-26 (banner label escaped, tested with `<b>`) and T-95-27 (boolean-only, nested updates with batch_id) mitigated.

## Self-Check: PASSED
