---
phase: 94-dashboard-correctness-and-data-foundations
plan: 02
subsystem: brewpad-frontend
tags: [dashboard, data-layer, tdd, es5]
requires: []
provides: [getDashboardData, dashboardWindow, cycleDays, effectiveBatchType, toDashRows, filterBatchesByNeedsType]
affects: [js/brewpad.js, js/brewpad.min.js]
tech-stack:
  added: []
  patterns: [pure ES5 helpers, asOf-driven (no wall clock), single classify-once data layer]
key-files:
  created: [tests/frontend/brewpad-dashboard-data.test.js]
  modified: [js/brewpad.js, js/brewpad.min.js]
decisions:
  - "needsType is a worklist and ignores the type filter; returns the row objects (not ids)"
  - "cycle.byType entries are {n, median, mean} (whole days, Math.round)"
  - "completed counts require a started status plus completed_day in window"
metrics:
  completed: 2026-10-27
---

# Phase 94 Plan 02: Dashboard data layer Summary

Pure ES5 `getDashboardData` layer in `js/brewpad.js` (dayNumber/addDays/cycleDays/median/mean, dashboardWindow/inWindow, effectiveBatchType, toDashRows, filterBatchesByNeedsType), driven solely by `asOf.today`, so the B1 clock drift cannot recur; not yet wired into renderDashboard (plan 07).

D-01 precondition satisfied (Phase 87 cutover recorded; per orchestrator notes).

## RED run (recorded, not committed)

`brewpad-dashboard-data.test.js`: suite failed to run, `TypeError: bp.getDashboardData is not a function` (0 tests executed because the describe-level fixture call threw). Helpers were undefined.

## GREEN

114 tests pass in the new file. Full gate: root `npm test` 211 suites / 2830 tests, middleware 240 suites / 3578 tests, `npm run lint` clean. Existing tests unedited.

Commit: 6046b37f `feat(94-02): dashboard data layer helpers + tests`.

## Deviations from Plan

**1. [Rule 3 - Blocking/scope] Build side effects reverted.** `npm run build` also restamped cache-bust versions in many HTML files and `js/admin.js`/`admin.min.js`. Only `js/brewpad.min.js` belongs to this plan, so the unrelated restamps were reverted with `git checkout` before committing. The orchestrator may want to run a build at merge time.

**2. Worktree base reset.** HEAD was one commit behind the expected base d5f4731b; reset --hard to it per the startup check (clean tree, no work lost).

No other deviations. TDD note: RED and GREEN went into one commit by plan design (never commit failing tests), so there is no separate `test(...)` commit.

## Known Stubs

None.

## Self-Check: PASSED
- tests/frontend/brewpad-dashboard-data.test.js: FOUND
- commit 6046b37f: FOUND
