---
phase: 96-new-and-upgraded-dashboard-graphs
plan: 04
subsystem: ui
tags: [brewpad, dashboard, chartjs, es5]
requires:
  - phase: 96-03
    provides: dash* markup helpers, chart() extensions, Phase 96 CSS
provides:
  - completedBuckets in getDashboardData
  - four-section v2 dashboard shell and DASH_V2_WIDGETS registry
  - per-widget options/view state, drill registry, openDashBatch, missing-data guard
  - G1 Production over time (buildG1Model, renderDashV2Production)
affects: [96-05, 96-06, 96-07, 96-08, 96-09]
key-files:
  created: [tests/frontend/brewpad-dashboard-v2-production.test.js]
  modified: [js/brewpad.js, js/brewpad.min.js, css/brewpad.css, css/brewpad.min.css, brewpad.html, tests/frontend/brewpad-dashboard-v2-widgets.test.js]
key-decisions:
  - "Widget state (_dashV2WidgetOpts) lives in memory only; never hash or localStorage"
  - "Test seam _dashV2FrameForTest exposes the registry and helpers so tests mount throwaway widgets"
duration: ~45min
completed: 2026-10-28
---

# Phase 96 Plan 04: Sections, widget framework and G1 Summary

Four headed dashboard sections, a widget registry with options/Chart-Table toggle/drill registry/missing-data guard, and G1 Production over time (Started | Completed, chart and table) replacing Batches per period.

## Commits
- ef9fb9d7: completedBuckets twin in getDashboardData
- 07134d71: section shell and per-widget framework
- ffe8caa4: G1 Production over time, build artifacts, approved widgets-test edits

## Notes for later plans
- Register widgets by pushing `{key, slot, title, chart, needs, render(model, chartState)}` to DASH_V2_WIDGETS. The runner resets that widget's drills, applies the `needs` guard and per-widget try/catch.
- Use `dashV2ChartBlocked(slot, chartKey, title, chartState)` for chart bodies; tables need no Chart.js.
- Chart onClick: set `hitDatasetIndex: true` in the chart() config to receive datasetIndex.
- Slots exist for all later widgets (pipeline, cycle, workload, vessels, tasks, ferment, source, health) but are empty until their plans land.
- Wine widget still uses the old chips scaffold (`.bp-widget-chips`) until plan 06.

## Deviations from Plan
- **[Rule 3] Chart present at render:** when window.Chart already exists, widgets render once synchronously in 'ready' state instead of rendering then re-rendering after loadChartJs resolves. No behavioural change; avoids a duplicate pass.
- **Existing test edits:** only widgets-test title (L274) and single-batch drills 2a/2b, per 96-TEST-DECISION (owner: approve). Fixture and all other assertions untouched.
- TDD ordering for Task 1 was test-and-code in one commit rather than separate RED/GREEN commits.
- Middleware tests not run (no middleware changes; worktree has no zoho-middleware node_modules, same as 96-03). Frontend: 227 suites / 3070 tests pass, lint clean. Unrelated build-stamped HTML/admin files reverted.

## Known Stubs
None; empty section slots are intentional placeholders filled by plans 05-09.

## Threat Flags
None. T-96-10 (all text via escapeHTML/textContent), T-96-11 (data-dash-row holds widget:index only, unknown keys ignored), T-96-13 (per-widget try/catch, seq guard) mitigated.

## Self-Check: PASSED
