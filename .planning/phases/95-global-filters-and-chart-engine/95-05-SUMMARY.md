---
phase: 95-global-filters-and-chart-engine
plan: 05
subsystem: brewpad-dashboard
tags: [chartjs, vendor, lazy-load, es5]
requires: [95-04]
provides: [loadChartJs, readChartTheme, chart, --chart-wine, --chart-cider, --chart-beer, --chart-other]
affects: [95-08]
key-files:
  created: [js/vendor/chart.umd.min.js, js/vendor/README.md, tests/frontend/brewpad-dashboard-v2-chart.test.js]
  modified: [js/brewpad.js, js/brewpad.min.js, css/brewpad.css, css/brewpad.min.css, brewpad.html]
decisions:
  - "Helpers sit at file top level next to the other dashboard helpers and are exported directly (plus the _loadChartJsForTest/_chartForTest/_resetChartJsForTest seams)"
  - "A failed script tag is removed from document.head on error, so a retry leaves exactly one tag"
metrics:
  completed: 2026-10-28
---

# Phase 95 Plan 05: Chart.js engine Summary

Chart.js 4.5.1 vendored (self-hosted, hash-verified) with a lazy loader, theme reader and a shared `chart(canvas, cfg)` helper with brand colour tokens.

## Commits
- 446267a2 chore(95-05): vendor Chart.js 4.5.1 (SHA-256 48444a82d4edcb5bec0f1965faacdde18d9c17db3063d042abada2f705c9f54a)
- 86d23cd9 feat(95-05): lazy loader, readChartTheme, chart() helper, 14 tests

## Verification
- Tarball SHA-256 matched f540d984...; file SHA-256 matched 48444a82...; size 208,522 bytes; header `Chart.js v4.5.1`; grep for XMLHttpRequest/sendBeacon/fetch( returned 0.
- Chart tests 14/14; full `npm test` 2938 passed (219 suites); `npm run lint` clean; `npm run build` ran.
- No static chart script tag in brewpad.html (`grep -c chart.umd` = 0). package.json untouched.

## CSP (rule 12)
brewpad.html has no CSP meta tag; the script is same-origin. No CSP change and no public page touched.

## Deviations from Plan
- Worktree base was not 545f15cc; reset to it per startup check.
- Test adjusted during GREEN: after onerror the failed tag is removed, so the retry test expects one script, not two (my own new test, not an existing one).
- `npm run build` re-stamped unrelated HTML files and admin.js/min.js; reverted them. brewpad.html changed only by the cache-buster stamp.
- Plan said inside the IIFE; placed at top level beside the other dashboard helpers (same as 95-03/04) so they export directly.

## Deferred Issues
- `zoho-middleware/__tests__/vancouver-timezone.test.js` fails locally (Node 20 vs prod Node 24); pre-existing. Middleware not run beyond that and untouched.

## Known Stubs
None.

## Self-Check: PASSED
