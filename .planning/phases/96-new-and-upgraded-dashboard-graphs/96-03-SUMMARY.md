---
phase: 96-new-and-upgraded-dashboard-graphs
plan: 03
subsystem: ui
tags: [brewpad, dashboard, chartjs, es5, css]
requires:
  - phase: 95
    provides: chart() helper, effectiveBatchType/sourceMatches, v2 widgets
provides:
  - Shared pure helpers (dashDrillSubject, dashClassifyRows, dashTaskKind, DASH_TASK_KINDS, dashBreakdownBuckets, dashSegHtml, dashSelectHtml, dashViewToggleHtml, dashTableHtml, dashListHtml)
  - chart() extensions (unit, percent, titles, dataLabels, vLines, xType linear, line series props, inertKeys, tooltipLabel/Footer, hitDatasetIndex)
  - Theme cat1..cat6 plus ink/ledger tokens, --chart-cat-1..6 CSS and Phase 96 layout classes
affects: [96-04, 96-05, 96-06, 96-07, 96-08, 96-09]
key-files:
  created: [tests/frontend/brewpad-dashboard-v2-foundations.test.js]
  modified: [js/brewpad.js, js/brewpad.min.js, css/brewpad.css, css/brewpad.min.css, brewpad.html]
key-decisions:
  - "datasetIndex on onClick is opt-in via cfg.hitDatasetIndex so locked Phase 95 chart tests (toHaveBeenCalledWith({index,key})) stay green and unedited"
  - "Widget controls use data-dash-w / data-dash-wsel / data-dash-row / data-dash-showall, never data-dash-ctl"
duration: ~25min
completed: 2026-10-28
---

# Phase 96 Plan 03: Shared dashboard helpers, chart() extensions, CSS Summary

Pure ES5 helpers (one model, two renderers), a backward-compatible chart() with inline plugins only, and the UI-SPEC tokens and classes.

## Commits
- 004bd797: shared data and markup helpers + tests
- 245aaa60: chart() extensions, theme tokens, CSS, rebuilt min artifacts

## Deviations from Plan

**1. [Rule 3 - Blocking conflict] datasetIndex on onClick made opt-in**
- **Issue:** Plan wants onClick to always receive `{index, key, datasetIndex}`, but existing tests in brewpad-dashboard-v2-chart.test.js assert `toHaveBeenCalledWith({ index: 2, key: 'beer' })` and must stay unchanged (plan acceptance + CLAUDE.md rule 10). Always adding the field fails them.
- **Fix:** datasetIndex (null for column hits) is only sent when `cfg.hitDatasetIndex` is true. Later plans that need it must set that flag. If the owner later approves editing the Phase 95 tests, the flag can be made default.
- **Commit:** 245aaa60

Otherwise none; plan executed as written. Middleware tests were not run (no middleware changes; this worktree has no zoho-middleware node_modules). Frontend: 226 suites / 3036 tests pass, lint clean. The 9 unrelated pages re-stamped by `npm run build` were reverted; only brewpad.html stamp kept.

## Known Stubs
None.

## Threat Flags
None. T-96-07/08/09 mitigated: all dynamic text through escapeHTML, keys restricted to [a-z0-9_], no vendor plugin files.

## Self-Check: PASSED
