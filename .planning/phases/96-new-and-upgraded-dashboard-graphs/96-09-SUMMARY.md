---
phase: 96-new-and-upgraded-dashboard-graphs
plan: 09
subsystem: ui
tags: [brewpad, dashboard, es5, data-health]
requires:
  - phase: 96-02
    provides: batchMeta has_invoice_link
  - phase: 96-08
    provides: widget registry, list/drill helpers
provides:
  - G10 Data health (DASH_HEALTH_CATS, buildG10Model, renderDashV2Health) in bp-dash-v2-health
  - Cross-widget agreement and whole-page copy-guard tests
key-files:
  created: [tests/frontend/brewpad-dashboard-v2-health.test.js, tests/frontend/brewpad-dashboard-v2-agreement.test.js]
  modified: [js/brewpad.js, js/brewpad.min.js, css/brewpad.css, css/brewpad.min.css, brewpad.html]
key-decisions:
  - "Registry key g10 needs batchMeta; category keys are lowercase (dashKey lowercases data attributes)"
  - "Accordion open state lives in _dashV2Expanded['acc:g10:<cat>'], separate from Show all ('g10:all<cat>')"
  - "Open these batches reuses the data-dash-row drill registry; data-dash-acc keys validated against DASH_HEALTH_CATS"
duration: ~35min
completed: 2026-10-28
---

# Phase 96 Plan 09: G10 Data health and agreement tests Summary

G10 lists No vessel, Missing completion date, No invoice link, Blank source and Stale active batches (over 90 days) as neutral accordions, and the whole phase is now locked by a filter-matrix agreement test plus a whole-page banned-word guard.

## Commits
- 44d14282: G10 builder, renderer, registry entry, accordion click branch, CSS, health tests
- 6c8a04b3: agreement + copy-guard tests, rebuilt min artifacts

## Behaviour notes
- All categories ignore global filters and exclude disabled/deleted batches. No invoice link = `has_invoice_link === false` and source not internal (same population rule as the Unlinked set); staff batches stay in and are tagged "Staff batch". Shared vessels never produce a row.
- Zero categories render "0 ✓" (not expandable); all zero shows "No data issues found." Missing batchMeta shows "Not available yet. Reopen the Dashboard tab to refresh."
- Agreement test (4 types x 3 periods x 3 sources x 2 measures x 2 groups, staff 0 and 1) found no disagreements, so no builder fixes were needed.

## Deviations from Plan
- Header chevron comes from the existing `.bp-accordion-head::after` CSS rather than a literal "▾" in the markup.
- Tasks followed tests-with-code per commit, not separate RED/GREEN commits.
- Middleware tests not run (no middleware changes; worktree has no zoho-middleware node_modules). Frontend: 231 suites / 3198 tests pass, lint clean. Unrelated build-stamped pages reverted; no pre-phase test edited.

## Observation (not changed)
- `DASH_TYPE_LABELS` is declared twice in js/brewpad.js (lines ~360 and ~1083); the later one wins and lacks seltzer/other. Seltzer rows in G6/G10 secondary text therefore show an empty type label. Surfaced for a separate issue.

## Known Stubs
None.

## Threat Flags
None. T-96-25: escaping via dashListHtml (tested), accordion keys validated; T-96-26: only the boolean reaches the browser; T-96-27: agreement tests added.

## Self-Check: PASSED
