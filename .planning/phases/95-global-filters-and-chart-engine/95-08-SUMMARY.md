---
phase: 95-global-filters-and-chart-engine
plan: 08
subsystem: brewpad-dashboard
tags: [dashboard, chartjs, widgets, drill, deltas, es5, tdd]
requires: [95-07]
provides: [renderDashV2Tiles, renderDashV2PeriodChart, renderDashV2Wine, renderDashV2Widgets, resizeDashV2Charts, _switchTabForTest]
affects: [96]
key-files:
  modified: [js/brewpad.js, js/brewpad.min.js, css/brewpad.css, css/brewpad.min.css, brewpad.html]
  created: [tests/frontend/brewpad-dashboard-v2-widgets.test.js]
decisions:
  - "Widget scaffold (title, subtitle, body) is built once per slot; the canvas persists across refreshes and is removed only for loading/empty/failure messages, so there is one live Chart per slot"
  - "A render sequence number drops stale loadChartJs resolutions; 'Loading charts…' shows only while window.Chart is absent (no flicker on later refreshes)"
  - "Wine breakdown is wine-only: hidden for Beer/Cider Type, always batches (wineBreakdownBuckets carries counts, not litres)"
  - "Wine dimension is widget-local (_dashV2WineDimension); v1 _dashWinePeriod/_dashWineDimension/_dashChartHiddenTypes are never written"
metrics:
  completed: 2026-10-28
---

# Phase 95 Plan 08: Re-hosted v2 widgets Summary

v2 now shows four KPI tile buttons with trend deltas, a stacked Batches-per-period bar and a horizontal Wine breakdown, all read from `_dashV2Model` and drawn through `chart()`, each tile/segment/bar clicking through to the exact batch ids via `openDashDrill`.

## Commit
- 397f8d06 feat(95-08): v2 KPI tiles with deltas, stacked period chart, wine breakdown via chart() (both tasks together: same files and build artifacts)

## Verification
- New widgets suite 24/24; full `npm test` 3000 passed (223 suites); `npm run lint` clean; `npm run build` ran.
- Grep of added lines for `_dashWinePeriod =`, `_dashWineDimension =`, `_dashChartHiddenTypes =` returns 0.
- Chart data sum equals Started tile; staff toggle leaves tiles and period chart identical; ticking Staff batch in the detail pane re-renders the wine chart.

## Deviations from Plan
- Worktree base was aef21a36; reset to 23125a02 per startup check.
- Tasks 1 and 2 committed together (shared files and build artifacts).
- Added one additive test seam `_switchTabForTest` (switchTab was not exported).
- Wine breakdown also shows catalog-error ("Unable to load catalog data - wine breakdown unavailable.") and "Loading…" states, reusing v1 copy, and the zero-bucket case reuses "No batches match these filters." with Reset (staff-hidden-only wine falls here; toggling staff restores it).
- `npm run build` re-stamped unrelated HTML and admin.js/min.js; reverted, committed only plan files.
- Middleware untouched, middleware tests not run (vancouver-timezone failure is pre-existing).

## Known Stubs
None.

## Threat Flags
None. T-95-30 (dimension labels reach canvas via Chart.js, legend via escapeHTML, aria via setAttribute; tested with an `<img onerror>` subcategory), T-95-31 (no customer text in tiles, tested), T-95-32 (one live instance per slot, tested) mitigated.

## Self-Check: PASSED
