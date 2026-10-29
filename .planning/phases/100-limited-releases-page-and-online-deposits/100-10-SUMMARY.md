---
phase: 100-limited-releases-page-and-online-deposits
plan: 10
subsystem: frontend
tags: [limited-releases, static-page, css, holdback]
requires: ["100-01"]
provides: ["limited-releases.html DOM contract", "css/limited-releases.css", "hold-back test"]
affects: [package.json]
key-files:
  created: [limited-releases.html, css/limited-releases.css, css/limited-releases.min.css, tests/frontend/limited-releases-holdback.test.js]
  modified: [package.json, tests/frontend/cookie-consent.test.js, tests/frontend/legal-pages.test.js, tests/frontend/page-search-consistency.test.js]
metrics:
  completed: 2026-10-29
---

# Phase 100 Plan 10: Limited releases page shell Summary

Held-back (noindex, unlinked, not in sitemap) limited-releases.html with the reservation.html CSP verbatim, the full module-18 DOM contract, `.lr-` page CSS, and build/test wiring.

## Commits
- ede23f22: static shell
- 8f966949: CSS and package.json wiring (minify:css, stamp:pages page list + limited-releases.min.css / 18-limited-releases.min.js tokens)
- 1f97096a: hold-back test and page-list additions (commit message contains "Test list additions")

## Verification
Shell checks (CSP byte-equal, all ids), `npm run build`, full frontend (3212) and middleware (3754) suites, lint: all pass.

## Deviations from Plan
- Build stamps every other page and js/admin*; those unrelated stamp changes were reverted so only plan files are committed. Only limited-releases.html carries fresh ?v= tokens.
- Three commits (one per task) rather than the single one named in the Task 3 text; the final carries the required message paragraph.
- The module 18 script tag is intentionally absent (Plan 11 adds it).
- Active calendar cell class assumed `.lr-calendar__month--active` (not named in the contract); Plan 11 should use it.

## Known Stubs
Empty containers (#lr-collections, #lr-how-steps, etc.) are filled by module 18 in Plans 11-12.

## Self-Check: PASSED
