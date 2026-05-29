---
phase: 21-shared-template-build-infrastructure
plan: "02"
subsystem: frontend
tags: [catalog, subpage, template, build, tests, es5]
dependency_graph:
  requires:
    - js/modules/16-catalog-subpage.js (from plan 01)
    - css/catalog-subpage.css (from plan 01)
  provides:
    - test-subpage.html
    - tests/frontend/16-catalog-subpage.test.js
    - css/catalog-subpage.min.css
    - js/modules/16-catalog-subpage.min.js
  affects:
    - package.json (build pipeline)
    - All pages stamped by stamp:pages (cache-bust token refresh)
tech_stack:
  added: []
  patterns:
    - Jest unit tests for exported pure functions (no DOM, no fetch mocks)
    - Cache-bust stamping via Date.now().toString(36) in stamp:pages
    - cleancss + terser minification for standalone CSS/JS modules
key_files:
  created:
    - test-subpage.html
    - tests/frontend/16-catalog-subpage.test.js
    - css/catalog-subpage.min.css
    - js/modules/16-catalog-subpage.min.js
  modified:
    - package.json
decisions:
  - test-subpage.html uses ?v=dev tokens in source; stamp:pages overwrites them on each build
  - All 9 existing pages plus test-subpage.html share the same stamp:pages script and cache-bust token
  - Unit tests cover only filterItemsByConfig and buildSortComparator (exported pure functions); DOM-dependent render functions are not tested at unit level per project convention
metrics:
  duration: "~4 min"
  completed: "2026-05-29"
  tasks_completed: 2
  tasks_total: 2
  files_created: 4
  files_modified: 1
---

# Phase 21 Plan 02: Test HTML Page, Unit Tests, and Build Pipeline Integration Summary

Integration of the catalog-subpage module into the build pipeline: test-subpage.html integration page, 16 unit tests for exported pure functions, minified CSS and JS build artifacts, and stamp:pages support for cache-busting.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create test-subpage.html and unit tests | 8c3d18a | test-subpage.html, tests/frontend/16-catalog-subpage.test.js |
| 2 | Integrate build pipeline for new CSS and JS files | 7eb82fb | package.json, css/catalog-subpage.min.css, js/modules/16-catalog-subpage.min.js, stamped HTML files |

## What Was Built

### test-subpage.html

Integration test page at project root. Key properties:
- `data-page="test-subpage"` on body
- Standard site header, cart drawer, and footer (copied from hops.html)
- No Google Tag Manager snippet (test page only)
- `window.SUBPAGE_CONFIG` script block with grains config (categorySlug: 'grains', subcategories: ['Grain', 'Malt Extract'], filterGroups: 3 groups) positioned before `main.min.js`
- Required hero DOM structure: `.subpage-hero > h1, p.subpage-hero-desc, button.subpage-hero-toggle, div.subpage-hero-full`
- Required toolbar DOM structure: `#subpage-search, #subpage-sort, .subpage-view-toggle, #subpage-filter-row`
- Required catalog container: `#subpage-catalog.subpage-catalog-section`
- Script load order: sheets-config.js → main.min.js → 16-catalog-subpage.min.js

### tests/frontend/16-catalog-subpage.test.js

16 unit tests across two describe blocks:

**filterItemsByConfig (9 tests):**
- Includes items matching subcategory (cf_subcategory field)
- Includes items matching types (cf_type field)
- Excludes items with price <= 0
- Excludes items with empty string price
- Matches either subcategory OR type
- Returns empty for no matches
- Returns empty for empty items array
- Handles items with subcategory field (not cf_subcategory)
- Handles items with type field (not cf_type)

**buildSortComparator (7 tests):**
- name-asc sorts alphabetically
- name-desc sorts reverse alphabetically
- price-asc sorts by price ascending
- price-desc sorts by price descending
- stock-first puts in-stock items before out-of-stock
- stock-first then name-asc within groups
- Returns function for unknown sort mode (falls through to stock-first default)

### package.json Build Pipeline Updates

Four targeted edits to existing scripts:
1. `minify:css`: appended `&& cleancss -o css/catalog-subpage.min.css css/catalog-subpage.css`
2. `minify:js`: appended `&& terser js/modules/16-catalog-subpage.js -o js/modules/16-catalog-subpage.min.js -c -m`
3. `stamp:pages` files array: added `'test-subpage.html'` after `'hops.html'`
4. `stamp:pages` forEach body: added two regex replacements for `catalog-subpage.min.css` and `16-catalog-subpage.min.js`

### Build Artifacts

- `css/catalog-subpage.min.css`: 8151 bytes (minified from 537-line source)
- `js/modules/16-catalog-subpage.min.js`: 17336 bytes (minified from 964-line source)

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — test-subpage.html is a fully wired integration test page with real SUBPAGE_CONFIG. No placeholder data or hardcoded mock values.

## Threat Surface Scan

No new network endpoints, auth paths, or schema changes. `test-subpage.html` contains no secrets — only product category config. Not indexed (no SEO meta, no GTM). Can be removed after Phase 22 confirms the real category pages work.

## Verification Results

- `npm run build` exits 0
- `test -f css/catalog-subpage.min.css`: OK (8151 bytes)
- `test -f js/modules/16-catalog-subpage.min.js`: OK (17336 bytes)
- `npm test` exits 0: 417/417 tests pass (401 existing + 16 new)
- `npm run lint` exits 0: 0 errors, 109 warnings (all pre-existing, same pattern as 15-hops.js)
- `grep "catalog-subpage" package.json | wc -l`: 3 lines (minify:css on line 6, minify:js on line 8, stamp:pages with both CSS+JS regexes on line 15)
- test-subpage.html version tokens updated from `?v=dev` to `?v=mpqj8lma` by build

## Self-Check: PASSED

- test-subpage.html: EXISTS
- tests/frontend/16-catalog-subpage.test.js: EXISTS
- css/catalog-subpage.min.css: EXISTS (8151 bytes)
- js/modules/16-catalog-subpage.min.js: EXISTS (17336 bytes)
- package.json: modified (catalog-subpage entries verified)
- Commit 8c3d18a: EXISTS
- Commit 7eb82fb: EXISTS
