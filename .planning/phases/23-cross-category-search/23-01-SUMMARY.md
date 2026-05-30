---
phase: 23-cross-category-search
plan: "01"
subsystem: frontend-search
tags: [search, fuse.js, overlay, ES5, vanilla-js, deep-link, ingredient-catalog]
dependency_graph:
  requires: []
  provides: [search-overlay-module, search-overlay-css, data-sku-fix]
  affects: [js/modules/16-catalog-subpage.js, js/modules/15-hops.js, ingredient-subpages]
tech_stack:
  added: []
  patterns: [stale-while-revalidate-cache, fuse-search-overlay, product-reserve-wrap, ES5-module]
key_files:
  created:
    - js/modules/17-search-overlay.js
    - js/modules/17-search-overlay.min.js
    - css/search-overlay.css
  modified:
    - js/modules/16-catalog-subpage.js
    - js/modules/15-hops.js
    - js/modules/16-catalog-subpage.min.js
    - js/modules/15-hops.min.js
decisions:
  - CATEGORY_PAGE_MAP maps cf_subcategory values to page slugs; unmapped categories fall back to ingredients-supplies.html (deep-link already works there via 08-catalog-ingredients.js)
  - CATEGORY_DISPLAY_NAMES collapses subcategory variants (Bottle+Bag -> Packaging, Fermenter+Hose+Tubing -> Equipment) for clean group headers
  - buildResultRow() uses product-reserve-wrap pattern with renderReserveControl for consistent cart state management and refreshAllReserveControls() compatibility
  - Separate SEARCH_MW_CACHE_KEY (sv-search-all-mw) prevents localStorage collision with per-page subpage cache keys
metrics:
  duration: "1026s (17m)"
  completed_date: "2026-05-30"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 5
---

# Phase 23 Plan 01: Cross-Category Search Overlay Module Summary

Cross-category Fuse.js search overlay with product-reserve-wrap inline cart controls, grouped results (10/7/5 dynamic cap), deep-link navigation, and data-sku fix enabling handleDeepLinkedItem() on subpage cards.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Fix data-sku gap and create search-overlay.css | ca4107d | 16-catalog-subpage.js, 15-hops.js, css/search-overlay.css |
| 2 | Create 17-search-overlay.js module | a0ff971 | js/modules/17-search-overlay.js |

## What Was Built

### Task 1: data-sku fix + CSS

**`js/modules/16-catalog-subpage.js`:** Added `if (item.sku) { card.setAttribute('data-sku', item.sku); }` in `buildItemCard()` immediately after `card.className = 'product-card subpage-card'`. This enables `handleDeepLinkedItem()` in `02-utils.js` to find subpage cards by `[data-sku]` selector — unblocks SRCH-02 for all subpages using this module.

**`js/modules/15-hops.js`:** Added `if (variant && variant.sku) { card.setAttribute('data-sku', variant.sku); }` in `buildHopCard()` after the `variant` declaration. Uses `variant.sku` (not `group.sku`) because hops items are grouped by name and each variant has its own SKU.

**`css/search-overlay.css`:** 373-line standalone stylesheet covering:
- `.subnav-search-btn` overrides: enables cursor/opacity from disabled state, adds hover + focus-visible styles
- `.ingredient-subnav .container { position: relative }` — anchors desktop dropdown panel
- `.search-overlay-backdrop` (z-index 195) — fixed, opacity+visibility toggle
- `.search-overlay-panel` (z-index 196) — desktop absolute + opacity/translateY animation; mobile fixed inset:0
- All result component styles: group headers, result rows, name links, prices, badges, cart controls, view-all links
- No-results and error state layouts
- `@media (max-width: 767px)` — full-screen mobile breakpoint
- `@media (prefers-reduced-motion: reduce)` — opacity-only transition

### Task 2: Search Overlay Module

**`js/modules/17-search-overlay.js`** (674 lines, ES5 throughout):

- **State variables:** `_searchAllItems`, `_searchFuse`, `_searchOverlayOpen`, `_searchOpenBtn`, `SEARCH_MW_CACHE_KEY/TS/TTL`
- **Constants:** `CATEGORY_PAGE_MAP` (cf_subcategory → page slug), `CATEGORY_DISPLAY_NAMES` (collapsed display labels)
- **Pure functions (exported):** `groupResultsByCategory(fuseResults)` — groups by display category, sorts by match count descending; `computeResultCap(n)` — returns 10/7/5
- **Data loading:** `getCachedSearch/setCachedSearch` (localStorage TTL cache, separate from per-page cache), `mapItem` (verbatim from 16-catalog-subpage.js with `__proto__` guard), `fetchFromMiddleware` (returns ALL items, no filterItemsByConfig), `loadFromSnapshot` (fallback), `loadSearchItems` (stale-while-revalidate pattern)
- **DOM construction:** `buildOverlayDOM()` — injects backdrop + panel with header/input/buttons/results into `.ingredient-subnav .container`; `buildCartObject(item)` (verbatim copy, `_item_type: 'ingredient'`); `buildResultRow(item, pageSlug)` — name link with `?item=SKU`, price/unit (textContent only), stock badge, product-reserve-wrap inline cart
- **Rendering:** `renderSearchResults(query)` — D-10 (2-char min), grouped results with caps, "View all N in Category" links, no-results state (textContent, T-23-01)
- **Lifecycle:** `openSearchOverlay` (shows panel, focuses input, lazy loads items), `closeSearchOverlay` (hides, restores scroll, returns focus)
- **Event wiring:** click on `.subnav-search-btn`, 180ms debounce on input, clear/close buttons, backdrop click, ESC key handler, `reservation-changed` re-renders visible product-reserve-wrap elements

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — the module is complete. Integration into HTML pages and `package.json` build pipeline is in a subsequent plan (Plan 02: HTML page wiring and build updates).

## Threat Flags

None — all STRIDE mitigations from threat register implemented:
- T-23-01: All query echoing uses textContent (renderSearchResults no-results state)
- T-23-02: `__proto__/constructor/prototype` guard in mapItem() copied verbatim
- T-23-03: All product name/price rendering uses textContent throughout buildResultRow()
- T-23-04: setCachedSearch() wrapped in try/catch
- T-23-05: Search query is client-side only, not transmitted to server

## Self-Check

- [x] `js/modules/17-search-overlay.js` exists (674 lines)
- [x] `js/modules/17-search-overlay.min.js` exists (build artifact)
- [x] `css/search-overlay.css` exists (373 lines)
- [x] `16-catalog-subpage.js` contains exactly 1 `setAttribute('data-sku'`
- [x] `15-hops.js` contains 1 `setAttribute('data-sku'` using `variant.sku`
- [x] `node -e "require('./js/modules/17-search-overlay.js').groupResultsByCategory"` → function
- [x] `computeResultCap(1)` → 10, `computeResultCap(4)` → 7, `computeResultCap(6)` → 5
- [x] No let/const/arrow functions in 17-search-overlay.js
- [x] filterItemsByConfig count = 0
- [x] All 417 frontend tests pass
- [x] Commits ca4107d and a0ff971 exist

## Self-Check: PASSED
