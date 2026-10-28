---
phase: 96-new-and-upgraded-dashboard-graphs
plan: 08
subsystem: ui
tags: [brewpad, dashboard, chartjs, es5]
requires:
  - phase: 96-02
    provides: vessels, readings, batchMeta on get_dashboard_stats
  - phase: 96-07
    provides: floor test file, widget patterns
provides:
  - G6 Vessels (buildG6Model, renderDashV2Vessels) in bp-dash-v2-vessels
  - G8 Fermentation (buildG8Model, renderDashV2Ferment) in bp-dash-v2-ferment
key-files:
  modified: [js/brewpad.js, js/brewpad.min.js, css/brewpad.css, css/brewpad.min.css, brewpad.html, tests/frontend/brewpad-dashboard-v2-floor.test.js]
key-decisions:
  - "Registry keys g6 (needs vessels) and g8 (needs readings); batchMeta is optional for G8"
  - "chart() gained two opt-in options: series borderColour (G6 Available outline) and xMin (G8 linear x starts at 0)"
duration: ~40min
completed: 2026-10-28
---

# Phase 96 Plan 08: G6 Vessels and G8 Fermentation Summary

Floor today now shows vessel capacity in use vs available per stored vessel type (shared vessel counted once, archived excluded) with neutral Shared vessels and No vessel lists, and Plato fermentation curves for active beer and cider with an optional dashed expected line and a neutral No readings yet list.

## Commits
- 85ca21d2: pure builders and tests
- d492cb3f: renderers, registry entries, CSS, chart() opt-ins, build artifacts, renderer tests

## Behaviour notes
- G6 ignores every global filter; groups by stored `type` in DASH_VESSEL_TYPE_ORDER (others alphabetically); lists show 5 rows then Show all (aria-expanded). Shared rows open the Batches tab with the banner; No vessel rows open batch detail with no banner.
- G8 honours global Type (wine/seltzer/other shows "Fermentation curves cover beer and cider."), Source and Staff (included). Series data are {x,y} points; datasetIndex maps a click to its batch; the expected series is inert.
- Because og/target_fg are null in live data (96-02), the single-batch view shows the "No expected curve" note and dashes for OG/Target FG/Attenuation/ABV today.
- Chart region degrades to a loading/failed message while lists and tables still render.

## Deviations from Plan
- [Rule 3] chart() needed two small opt-in additions (borderColour, xMin); no existing behaviour changed.
- Tasks 1 and 2 followed tests-with-code per commit rather than separate RED/GREEN commits.
- Middleware tests not run (no middleware changes; worktree has no zoho-middleware node_modules). Frontend: 229 suites / 3174 tests pass, lint clean. Unrelated build-stamped pages reverted. No edits to any pre-phase test (widgets test unchanged).

## Known Stubs
None.

## Threat Flags
None. T-96-22: all list/select text via escapeHTML (tested with an injected product name); T-96-23: no write path, rows only call dashV2Go/openDashBatch.

## Self-Check: PASSED
