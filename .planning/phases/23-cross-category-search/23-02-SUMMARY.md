---
phase: 23-cross-category-search
plan: "02"
subsystem: frontend-search
tags: [search, overlay, html-wiring, build-pipeline, unit-tests, ES5, vanilla-js]
dependency_graph:
  requires: [23-01]
  provides: [search-overlay-wired, search-overlay-tests, build-pipeline-updated]
  affects: [products/grains.html, products/yeast.html, products/additives.html, products/packaging.html, products/equipment.html, products/hops.html, products/ingredients-supplies.html, package.json]
tech_stack:
  added: []
  patterns: [stamp-pages-versioning, cleancss-minify, terser-minify, jest-unit-tests]
key_files:
  created:
    - tests/frontend/17-search-overlay.test.js
    - css/search-overlay.min.css
  modified:
    - products/grains.html
    - products/yeast.html
    - products/additives.html
    - products/packaging.html
    - products/equipment.html
    - products/hops.html
    - products/ingredients-supplies.html
    - package.json
    - js/modules/17-search-overlay.min.js
decisions:
  - All 7 HTML pages: search-overlay.min.css inserted after catalog-subpage.min.css (or after hops.min.css on hops.html); JS inserted after the page-specific module (16- for 5 subpages, 15- for hops, after main.min.js for ingredients-supplies)
  - subnav-search-btn: removed disabled attribute, removed title="Search coming soon", updated aria-label to "Open ingredient search" on all 7 pages
  - stamp:pages updated with two new regex replacements for search-overlay.min.css and 17-search-overlay.min.js
  - Test count: 14 tests (8 for groupResultsByCategory, 6 for computeResultCap)
metrics:
  duration: "~20m"
  completed_date: "2026-05-30"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 9
---

# Phase 23 Plan 02: HTML Page Wiring and Build Updates Summary

Search overlay wired into all 7 ingredient subpages with correct script loading order, build pipeline updated to produce and version-stamp minified overlay CSS/JS, and unit tests covering groupResultsByCategory and computeResultCap pass alongside all 432 existing tests.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Wire 7 HTML pages and update package.json build scripts | 2238735 | 7 HTML pages, package.json, css/search-overlay.min.css, js/modules/17-search-overlay.min.js |
| 2 | Unit tests for search overlay pure functions | bb29f93 | tests/frontend/17-search-overlay.test.js |

## What Was Built

### Task 1: HTML Page Wiring + Build Pipeline

**7 HTML pages updated** — each page received:
- `<link rel="stylesheet" href="../css/search-overlay.min.css?v=...">` after `catalog-subpage.min.css`
- `<script src="../js/modules/17-search-overlay.min.js?v=..." defer></script>` at page-appropriate insertion point
- `.subnav-search-btn`: removed `disabled` attribute, removed `title="Search coming soon"`, changed `aria-label` to `"Open ingredient search"`

**Script insertion order by page:**
- grains.html, yeast.html, additives.html, packaging.html, equipment.html: after `16-catalog-subpage.min.js`
- hops.html: after `15-hops.min.js` (this page does not use 16-)
- ingredients-supplies.html: after `main.min.js` (this page uses neither 15- nor 16-)

**package.json build scripts updated:**
- `minify:css`: appended `cleancss -o css/search-overlay.min.css css/search-overlay.css`
- `minify:js`: appended `terser js/modules/17-search-overlay.js -o js/modules/17-search-overlay.min.js -c -m`
- `stamp:pages`: added two regex replacements for `search-overlay\.min\.css\?v=` and `17-search-overlay\.min\.js\?v=`

**`npm run build` completes with exit code 0** — produces `css/search-overlay.min.css` (4.3KB) and refreshes `js/modules/17-search-overlay.min.js` (11KB).

### Task 2: Unit Tests

**`tests/frontend/17-search-overlay.test.js`** (130 lines, 14 tests):

`groupResultsByCategory` (8 tests):
- empty input returns []
- groups items by display category name (Grain -> "Grains", Hops -> "Hops")
- sorts groups by match count descending
- collapses Bottle+Bag subcategories into single "Packaging" group
- collapses Fermenter+Tubing subcategories into single "Equipment" group
- handles items with no cf_subcategory (falls back gracefully)
- handles empty string cf_subcategory
- assigns correct page slug via CATEGORY_PAGE_MAP
- assigns ingredients-supplies.html for unmapped subcategory

`computeResultCap` (6 tests):
- 1 category -> 10
- 2 categories -> 10
- 3 categories -> 7
- 4 categories -> 7
- 5 categories -> 5
- 7 categories -> 5

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all 7 pages are fully wired. The search overlay is now functional on every ingredient page.

## Threat Flags

None — all changes are static HTML references to local files and build pipeline updates. No new network endpoints or trust boundaries introduced (consistent with T-23-06 and T-23-07 dispositions: accept).

## Self-Check

- [x] `tests/frontend/17-search-overlay.test.js` exists (130 lines, 14 tests)
- [x] `css/search-overlay.min.css` exists (4.3KB)
- [x] `js/modules/17-search-overlay.min.js` exists (11KB)
- [x] All 7 pages contain `17-search-overlay.min.js` script tag with `defer`
- [x] All 7 pages contain `search-overlay.min.css` link tag
- [x] Zero pages contain `disabled` on `.subnav-search-btn`
- [x] All 7 pages have `aria-label="Open ingredient search"` on search button
- [x] grains/yeast/additives/packaging/equipment: overlay script after 16-catalog-subpage.min.js
- [x] hops.html: overlay script after 15-hops.min.js
- [x] ingredients-supplies.html: overlay script after main.min.js
- [x] package.json minify:css contains `search-overlay.min.css css/search-overlay.css`
- [x] package.json minify:js contains `17-search-overlay.js -o js/modules/17-search-overlay.min.js`
- [x] package.json stamp:pages contains both search-overlay.min.css and 17-search-overlay.min.js regex entries
- [x] `npm run build` exits 0
- [x] `npm test` exits 0 (432 tests, 0 failures)
- [x] `npm run lint` exits 0 (0 errors, 115 warnings — pre-existing warnings only)
- [x] Task 1 commit 2238735 exists
- [x] Task 2 commit bb29f93 exists

## Self-Check: PASSED
