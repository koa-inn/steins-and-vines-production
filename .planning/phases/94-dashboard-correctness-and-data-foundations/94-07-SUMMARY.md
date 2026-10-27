---
phase: 94-dashboard-correctness-and-data-foundations
plan: 07
subsystem: brewpad-frontend
tags: [dashboard, cycle-time, aggregate, es5, tdd]
requires: [94-02, 94-05]
provides: [corrected dashboard tiles, fetchDashboardAggregate, _dashData state, render seams]
affects: [js/brewpad.js, js/brewpad.min.js, css/brewpad.css, css/brewpad.min.css, brewpad.html]
key-files:
  created: [tests/frontend/brewpad-dashboard-render.test.js]
  modified: [js/brewpad.js, css/brewpad.css, js/brewpad.min.js, css/brewpad.min.css, brewpad.html]
decisions:
  - "Wine breakdown rows are filtered with the data layer's own helpers (inWindow/dashboardWindow/effectiveBatchType/started statuses) because getDashboardData().started is a count, not rows"
  - "eagerLoad keeps a literal settle(adminApiGet('get_dashboard_stats')) in slot 0 (a structural test in brewpad-pull-from-zoho counts exactly 5 settle(adminApiGet( wraps) and falls back to the summary in a following then()"
requirements-completed: [B1, D1, S1]
metrics:
  completed: 2026-10-27
---

# Phase 94 Plan 07: Dashboard wiring Summary

The live BrewPad dashboard now renders every tile, the month chart and the wine breakdown from one `getDashboardData` result, shows a full-width "Days to complete (median)" tile (B1), and loads from the single `get_dashboard_stats` aggregate with a sheets-mode fallback (S1).

## Commits
- 56b6613c `fix(94-07)`: seams (`_renderDashboardForTest`, `_dashData`), render rewiring, CSS, regression tests (Tasks 1+2 together, per plan, because a red test must not be committed)
- a06ec01c `feat(94-07)`: `fetchDashboardAggregate`, eagerLoad/loadDashboard rewiring, UI-SPEC error copy, rebuilt min files + brewpad.html cache-bust

## RED run (Task 1, recorded)
`brewpad-dashboard-render.test.js`: all 10 render tests failed against the old code; the wide tile `.bp-stat-card--wide` did not exist (`expect(received).not.toBeNull()` / `Cannot read properties of null`), and the old tile read "Avg days to complete" computed as now minus start_date. GREEN: 15 tests pass after the fix.

## Verification (Node 24)
Root `npm test` 212 suites / 2845 tests, `npm run lint` clean, middleware `npm test` 249 suites / 3657 tests. Existing chart, wine-breakdown, bottled-refetch, read-retry and after-batch-write tests pass unedited.

## Deviations from Plan
1. **[Rule 3] Worktree base reset** to 5b2598b5 (HEAD was 8dbfa2ac); `npm ci` run in both package roots.
2. **[Rule 1] `getDashboardData().started` is a count** (plan assumed rows). Wine rows are built in renderDashboard with the same helpers instead; the test asserts the wine total equals `getDashboardData(rows, asOf, {window:'6mo', type:'wine'}).totals.all`. Consequently `getDashboardData(` appears twice in brewpad.js (definition + one render use), not >= 4 as the acceptance grep expected; the shared-layer guarantee is covered by the agreement tests.
3. **[Rule 3] eagerLoad structure** differs from the plan text (see decisions): a pre-existing structural test pins five `settle(adminApiGet(` wraps in eagerLoad, so slot 0 stays `settle(adminApiGet('get_dashboard_stats'))` and the summary fallback runs in a following `.then()`. `grep -c "adminApiGet('get_dashboard_stats')"` is therefore 2 (eagerLoad + fetchDashboardAggregate).
4. Added test seams beyond the plan: `_dashWineSkuLookup` in `_setStateForTest`, and `_loadDashboardForTest` / `_eagerLoadForTest`, needed for the wine-total and load tests.
5. `npm run build` restamped many unrelated HTML/admin files; reverted with `git checkout`, only brewpad.html kept.
6. Acceptance grep for `Date.now() - new Date(b.start_date)` still matches two lines (~5102, ~5140) in the batch list/detail age views; these are unrelated to the dashboard and were left alone (out of scope). Candidate follow-up for the same drift class.
- No existing tests modified.

## Known Stubs
None.

## Self-Check: PASSED
- tests/frontend/brewpad-dashboard-render.test.js: FOUND
- commits 56b6613c, a06ec01c: FOUND
