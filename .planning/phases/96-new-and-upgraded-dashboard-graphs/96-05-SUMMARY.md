---
phase: 96-new-and-upgraded-dashboard-graphs
plan: 05
subsystem: ui
tags: [brewpad, dashboard, chartjs, es5]
requires:
  - phase: 96-04
    provides: DASH_V2_WIDGETS registry, drill registry, widget scaffold
provides:
  - G2 Pipeline (buildG2Model, renderDashV2Pipeline, DASH_PIPELINE_STAGES)
  - G3 Cycle time (dashP95, buildG3Model, renderDashV2Cycle)
key-files:
  modified: [js/brewpad.js, js/brewpad.min.js, brewpad.html, tests/frontend/brewpad-dashboard-v2-production.test.js, tests/frontend/brewpad-dashboard-v2-widgets.test.js]
key-decisions:
  - "Ready to bottle = active batch in summary.readyToBottle (fallback _dashSummary.readyToBottle); precedence over Primary/Secondary; none known means Primary/Secondary only"
  - "G3 histogram: nearest-rank p95, N = max(7, ceil(p95/7)*7), last open bin 'N+'; planned line at min(median,N)/7 - 0.5"
duration: ~40min
completed: 2026-10-28
---

# Phase 96 Plan 05: G2 Pipeline and G3 Cycle time Summary

Production section now has Pipeline (horizontal stacked stages by type, stage totals as data labels) and Cycle time (7-day-bin histogram capped at the 95th percentile, dashed per-type planned-length lines), each with Chart/Table toggle and drills; both agree with the Fermenting now, Completed and Days to complete tiles.

## Commits
- 0921f7c9: models, renderers, registry entries, tests, rebuilt min artifact
- 6c7ebfde: approved widgets-test item 3 edit (per 96-TEST-DECISION)

## Notes
- G3 Product select values are the product names (matched by string equality; text escaped by dashSelectHtml); an unknown stored choice falls back to All products.
- Pipeline body height is set inline on `.bp-chart` (48px x rows + 32px).
- No CSS change was needed.

## Deviations from Plan
- Tasks 1 and 2 landed in one feature commit (models and renderers share one file and the test file); tests were written alongside the code rather than as a separate RED commit.
- Middleware tests not run (no middleware changes; worktree has no zoho-middleware node_modules). Frontend: 227 suites / 3089 tests pass, lint clean. Unrelated build-stamped pages reverted.
- Widgets-test edit limited to item 3 (L353): now asserts one live instance per dashboard canvas.

## Known Stubs
None.

## Threat Flags
None. T-96-14 mitigated: select and table text go through dashSelectHtml/dashTableHtml (escapeHTML).

## Self-Check: PASSED
