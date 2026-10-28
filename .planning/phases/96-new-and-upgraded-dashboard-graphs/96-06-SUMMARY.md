---
phase: 96-new-and-upgraded-dashboard-graphs
plan: 06
subsystem: ui
tags: [brewpad, dashboard, chartjs, es5]
requires:
  - phase: 96-04
    provides: DASH_V2_WIDGETS registry, drill helpers, widget scaffold
  - phase: 96-05
    provides: dashV2ProdCtx, dashV2TableModel, dashV2ShowTable
provides:
  - G4 Products (buildG4Model, buildTop10Model, renderDashV2Products) in the bp-dash-v2-wine slot
  - G9 Source mix (dashSourceCat, DASH_SOURCE_CATS, buildG9Model, renderDashV2Source) in bp-dash-v2-source
key-files:
  created: [tests/frontend/brewpad-dashboard-v2-products.test.js]
  modified: [js/brewpad.js, js/brewpad.min.js, css/brewpad.css, css/brewpad.min.css, brewpad.html, tests/frontend/brewpad-dashboard-v2-widgets.test.js]
key-decisions:
  - "Registry keys are g4 and g9; the Top 10 toggle is data-dash-w 'g4:tview:...' so the one registry key re-renders both blocks"
  - "Charts drill through dashV2Go with a computed subject (no drill registry entries); table cells register drills via dashV2TableModel"
  - "G9 share values use largest-remainder rounding so each bucket sums to exactly 100.0"
duration: ~50min
completed: 2026-10-28
---

# Phase 96 Plan 06: G4 Products and G9 Source mix Summary

Products replaces the Wine breakdown (wine subcategory/brand/manufacturer, beer style/recipe, cider recipe, plus a Top 10 leaderboard) and Source mix adds started batches by Kiosk/Online/Manual/Zoho scan/Other/Unknown as Count or Share; both hide staff batches by default and say so.

## Commits
- 96a3eb56: builders, renderers, CSS, build artifacts, new products test, approved widgets-test edits

## Behaviour notes
- G4 base set = `cur.ids.startedByType[type]` minus staff (unless staff=1), so totals equal the Started tile when staff is included. Under global All a widget-local Type segment picks Wine/Cider/Beer (default Wine); a single global Type is used directly; seltzer/other shows the empty copy.
- Top 10 key = recipe_id || product_sku, labelled from batch meta recipe_name, ranked by Measure, one stacked series per type for colour.
- G9 uses `cur.periodBuckets` (same buckets as G1 Started); with staff on, bucket totals equal G1.
- `wineBreakdownBuckets` and v1 wine state are untouched; `_dashV2WineDimension`, `DASH_V2_WINE_DIMS`, `renderDashV2Wine`, the chips scaffold and the click branch are removed.

## Deviations from Plan
- Tasks 1 and 2 landed in one commit (builders, renderers and tests share files); tests written alongside code rather than a separate RED commit.
- The plan sketched `data-dash-w 'g4t:view:...'` for the Top 10 toggle; used `g4:tview:...` instead because the rerender hook resolves the registry by the first segment.
- Widgets-test edits per 96-TEST-DECISION (owner: approve), limited to items 2c (seeded a second non-staff Red batch inside that test), 4, 5, 6. Item 3 needed no further change.
- Middleware tests not run (no middleware changes; worktree has no zoho-middleware node_modules). Frontend: 228 suites / 3120 tests pass, lint clean. Unrelated build-stamped pages reverted.

## Known Stubs
None.

## Threat Flags
None. T-96-16 mitigated (all labels via escapeHTML helpers, chart labels are canvas text), T-96-18 mitigated (widget-local opts only; no hash, _dashV2State or v1 wine state written; covered by test).

## Self-Check: PASSED
