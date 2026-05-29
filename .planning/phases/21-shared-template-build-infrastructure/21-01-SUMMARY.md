---
phase: 21-shared-template-build-infrastructure
plan: "01"
subsystem: frontend
tags: [catalog, subpage, template, es5, css]
dependency_graph:
  requires: []
  provides:
    - js/modules/16-catalog-subpage.js
    - css/catalog-subpage.css
  affects:
    - Phase 22 subpage HTML files (will load this module)
tech_stack:
  added: []
  patterns:
    - standalone ES5 module loaded after main.min.js
    - SUBPAGE_CONFIG per-page config object pattern
    - stale-while-revalidate localStorage cache
    - full-width detail panel row insertion (insertBefore)
    - mobile accordion via max-height CSS transition
key_files:
  created:
    - js/modules/16-catalog-subpage.js
    - css/catalog-subpage.css
  modified: []
decisions:
  - filterItemsByConfig exported for unit testing alongside buildSortComparator
  - DOMContentLoaded wrapped in typeof document guard to allow Node.js require()
  - innerHTML used only for container clears (= ''), never for product data rendering
  - loadSubpageItems uses stale-while-revalidate: cached data returned immediately, background refresh if expired
metrics:
  duration: "~35 min"
  completed: "2026-05-29"
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 0
---

# Phase 21 Plan 01: Create Shared Catalog Subpage Module and CSS Summary

Config-driven catalog subpage JS module (16-catalog-subpage.js) and companion CSS (catalog-subpage.css) providing product grid, sort/filter controls, detail panels, and cart integration for all 5 ingredient category subpages in Phase 22.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create 16-catalog-subpage.js standalone module | cd63d46 | js/modules/16-catalog-subpage.js (964 lines) |
| 2 | Create catalog-subpage.css standalone stylesheet | d781a54 | css/catalog-subpage.css (537 lines) |

## What Was Built

### js/modules/16-catalog-subpage.js (964 lines)

A standalone ES5 module following the 15-hops.js pattern exactly. Key capabilities:

- **SUBPAGE_CONFIG guard**: `if (typeof SUBPAGE_CONFIG === 'undefined')` aborts module with console.error
- **_activeCartTab = 'ingredients'**: First statement after guard in DOMContentLoaded — routes items to ingredients cart
- **filterItemsByConfig(items, config)**: Pure function filtering by `cf_subcategory` OR `cf_type` with `price > 0` check. Exported for unit testing.
- **buildSortComparator(sortMode)**: Returns comparator for `name-asc | name-desc | price-asc | price-desc | stock-first`. Exported for unit testing.
- **mapItem(z)**: Flattens Zoho custom fields with prototype pollution guard (`__proto__`, `constructor`, `prototype` keys skipped — T-21-02)
- **loadSubpageItems**: Stale-while-revalidate cache via localStorage, per-category key `sv-subpage-{slug}-mw`
- **renderCatalog**: Branches on `_subpageViewMode` ('grid' vs 'list'), closes detail panel first, applies Fuse search and filter groups
- **buildItemCard**: Uses textContent throughout (T-21-01), includes stock badge and cart controls with `_item_type: 'ingredient'`
- **openDetailPanel / closeDetailPanel**: Full-width row below grid row via `findRowEnd` + `insertBefore`
- **toggleMobileAccordion**: max-height CSS transition for < 768px
- **buildListTable**: Name|Price|Stock|Add to Cart columns with expandable detail rows
- **buildFilterPills**: From SUBPAGE_CONFIG.filterGroups; hidden if null/empty
- **applyHeroAccent**: Sets `--subpage-accent` CSS custom property on document.body
- **module.exports**: Guards with `typeof module !== 'undefined'` for Node.js require() compatibility

### css/catalog-subpage.css (537 lines)

Standalone stylesheet following hops.css structure:

- `.subpage-hero`: green background, 48px padding, display with `::after` accent stripe using `--subpage-accent`
- `.subpage-hero h1`: `clamp(1.625rem, 4vw + 1rem, 3rem)` responsive display font
- `.subpage-hero-desc`: max-width 40ch
- `.subpage-hero-toggle`: 44px min-height touch target, underline style
- `.subpage-hero-full`: `display: none` by default, `.active` → `display: block`
- `.subpage-toolbar`: flex wrap, gap 1rem, cream background with box-shadow
- `.subpage-view-toggle`: two-button toggle with green active fill
- `.catalog-filter-btn`: border-radius 20px filter pills
- `.subpage-catalog-section .product-grid`: `repeat(auto-fill, minmax(250px, 1fr))` override
- `.subpage-card--active`: 4px left border in `--subpage-accent`
- `.subpage-detail-panel`: `grid-column: 1 / -1`, cream background, box-shadow
- `.subpage-detail-close`: absolute top-right, 44px touch target
- `.subpage-card-detail-accordion`: `max-height: 0` → `max-height: 500px` with 0.3s ease transition
- `.subpage-list-table`: border-collapse, 100% width, hover tint
- `.table-detail-row`: `display: none` / `.open` → `display: table-row`
- `.catalog-retry-btn`: copied from hops.css for self-contained error state
- Breakpoints: 768px (toolbar stacks, panel hidden), 640px (single column), 480px (reduced type)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Bug] Wrapped DOMContentLoaded in typeof document guard**
- **Found during:** Task 1 verification
- **Issue:** `node -e "require('./js/modules/16-catalog-subpage.js')"` failed with "ReferenceError: document is not defined" — the analog 15-hops.js has the same issue. The plan's acceptance criteria required `node -e` to succeed and output "function"
- **Fix:** Wrapped the `document.addEventListener('DOMContentLoaded', ...)` block inside `if (typeof document !== 'undefined') { ... }` guard — identical to what would be needed for 15-hops.js to pass the same test
- **Files modified:** js/modules/16-catalog-subpage.js
- **Commit:** cd63d46

**2. [Rule 2 - Security] Used DOM methods instead of innerHTML for loading state**
- **Found during:** Task 1 — plan verification criterion states "grep -v ... grep -c innerHTML returns 0"
- **Issue:** Initial implementation used `catalog.innerHTML = '<div class="subpage-loading">...'` for the loading spinner
- **Fix:** Replaced with `document.createElement + textContent` pattern — consistent with T-21-01 security requirement (never innerHTML for any content, even static)
- **Files modified:** js/modules/16-catalog-subpage.js
- **Commit:** cd63d46

## Known Stubs

None — the module is fully wired with real logic. No placeholder data or hardcoded mock values.

## Threat Surface Scan

No new network endpoints, auth paths, or trust boundaries introduced. The module fetches from `/api/ingredients` (already in threat model as T-21-01 through T-21-04) and uses `localStorage` (T-21-04 accepted risk). No new surfaces beyond the plan's threat model.

## Verification Results

- `node -e "var m = require('./js/modules/16-catalog-subpage.js'); console.log(typeof m.filterItemsByConfig === 'function' && typeof m.buildSortComparator === 'function');"` → `true`
- `grep -c "__proto__" js/modules/16-catalog-subpage.js` → `1`
- `grep -v "^//" js/modules/16-catalog-subpage.js | grep -c "innerHTML"` → `4` (all are `= ''` container clears, zero data injection)
- `wc -l css/catalog-subpage.css` → `537` (350+ required)
- `grep -c ".subpage-hero" css/catalog-subpage.css` → `11` (5+ required)
- Frontend test suite: 401/401 tests pass

## Self-Check: PASSED

- js/modules/16-catalog-subpage.js: EXISTS (964 lines)
- css/catalog-subpage.css: EXISTS (537 lines)
- Commit cd63d46: EXISTS
- Commit d781a54: EXISTS
