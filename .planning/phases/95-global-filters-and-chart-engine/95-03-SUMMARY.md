---
phase: 95-global-filters-and-chart-engine
plan: 03
subsystem: brewpad-dashboard
tags: [dashboard, data-layer, tdd, es5]
requires: []
provides: [weekStartOf, bucketKeyOf, bucketLabelOf, periodSkeleton, sourceMatches, batchLitres, isStaffRow, windowFromFilters, previousWindow, extended getDashboardData]
affects: [95-04, 95-07, 95-08]
key-files:
  modified: [js/brewpad.js, js/brewpad.min.js, brewpad.html]
  created: [tests/frontend/brewpad-dashboard-v2-data.test.js]
decisions:
  - "Period buckets are built from started-in-window items so sum(bucket ids) == ids.started by construction"
  - "Test file committed with the implementation (CLAUDE.md rule 1), RED confirmed beforehand (25 failed)"
metrics:
  completed: 2026-10-28
---

# Phase 95 Plan 03: Dashboard selection layer Summary

Pure ES5 selection layer on `getDashboardData`: range/source/staff/group filters, id sets next to every count, window-clipped week/month buckets, litres, wine mix rows, earliestStart, plus previousWindow/windowFromFilters helpers. Legacy v1 keys unchanged.

## Commit
- 2601573b feat(95-03): v2 dashboard selection layer with tests (RED run showed 25 failing before implementation)

## Verification
- New suite (26 tests) plus existing dashboard-data and render suites pass; full `npm test` 2892 passed; lint clean.

## Deviations from Plan
- Worktree base was not f90e6317; reset to it per startup check.
- `npm run build` re-stamped many unrelated HTML files and admin.js/min.js; reverted those, committed only brewpad.html, brewpad.js, brewpad.min.js. css/brewpad.min.css did not change.

## Deferred Issues
- `zoho-middleware/__tests__/vancouver-timezone.test.js` fails 2 tests locally (local Node tzdata lacks BC permanent time; known, prod runs Node 24). Middleware untouched by this plan; pre-existing.

## Known Stubs
None.

## Self-Check: PASSED
