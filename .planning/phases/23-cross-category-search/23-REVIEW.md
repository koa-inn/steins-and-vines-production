---
phase: 23-cross-category-search
reviewed: 2026-05-30T00:00:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - css/search-overlay.css
  - js/modules/15-hops.js
  - js/modules/16-catalog-subpage.js
  - js/modules/17-search-overlay.js
  - tests/frontend/17-search-overlay.test.js
findings:
  critical: 1
  warning: 3
  info: 3
  total: 7
status: issues_found
---

# Phase 23: Code Review Report

**Reviewed:** 2026-05-30
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

This phase implements a cross-category ingredient search overlay (module 17) alongside a hops module (module 15) and a generic catalog subpage module (module 16). The overlay is generally well-structured with good security hygiene (textContent throughout, prototype pollution guard, encodeURIComponent on URLs). However, there is one **critical correctness bug**: module 17 declares top-level functions with the same names as module 16, and both modules are loaded on the same pages. When module 17 executes after module 16, it overwrites module 16's `fetchFromMiddleware`, `loadFromSnapshot`, `mapItem`, and `buildCartObject` in the global scope. This causes module 16's data-loading pipeline to use module 17's unfiltered fetch function, meaning all ingredient subpages (grains, yeast, additives, packaging, equipment) will show all items from every category instead of the configured subcategory.

Three warnings follow: the backdrop fade-out is broken by `display: none` cutting off the CSS transition, the deep-link URL falls back to item name when SKU is absent but the resolver only searches `data-sku` attributes (so the link silently fails), and the clear button does not cancel the pending debounce timer. Three informational issues are also noted.

---

## Critical Issues

### CR-01: Global Function Name Collision Corrupts Module 16 Data Loading

**File:** `js/modules/17-search-overlay.js:133,174,200,334`
**Also affects:** `js/modules/16-catalog-subpage.js:101,138,157,446`

**Issue:** Module 17 declares four top-level functions — `mapItem`, `fetchFromMiddleware`, `loadFromSnapshot`, and `buildCartObject` — with the same names as top-level functions in module 16. All non-hops ingredient subpages (grains, yeast, additives, packaging, equipment) load both modules via `<script>` tags in order: module 16 first, then module 17. Because both files execute in the same global scope (ES5 `var` / function declarations, not IIFE-wrapped), module 17's declarations overwrite module 16's when it executes.

The critical consequence is `fetchFromMiddleware`. Module 16's version calls `filterItemsByConfig(items, SUBPAGE_CONFIG)` to restrict results to the configured subcategory. Module 17's version returns all items with `price > 0` regardless of subcategory. After module 17 loads, when module 16's `loadSubpageItems()` calls `fetchFromMiddleware()`, it now calls the module 17 version — returning all ~N items from every ingredient category instead of the ~10-30 items for grains/yeast/etc. The subpage catalog renders every ingredient from every category, defeating the per-category subpage purpose.

The same collision affects `mapItem` (both are identical, so no behavioral difference here), `loadFromSnapshot` (same consequence as `fetchFromMiddleware` — no SUBPAGE_CONFIG filter), and `buildCartObject` (both are identical, no behavioral difference).

**Fix:** Wrap all module-private helpers in a namespace or IIFE to prevent global pollution. Since the project uses ES5 style, the simplest fix is renaming the functions with module-specific prefixes in module 17:

```js
// js/modules/17-search-overlay.js — rename to avoid collision with module 16

function _searchMapItem(z) { /* ... */ }        // was: mapItem
function _searchFetchFromMW() { /* ... */ }     // was: fetchFromMiddleware
function _searchLoadFromSnapshot() { /* ... */ } // was: loadFromSnapshot
function _searchBuildCartObject(item) { /* ... */ } // was: buildCartObject

// Update all callers within module 17 to use the new names.
```

Alternatively, wrap the entire module body in an IIFE:
```js
(function () {
  // all module 17 code here — nothing leaks to global scope
  // only expose: openSearchOverlay / closeSearchOverlay if needed externally
})();
```

---

## Warnings

### WR-01: Deep-link URL Falls Back to Item Name But Resolver Only Reads data-sku

**File:** `js/modules/17-search-overlay.js:379`

**Issue:** The result row link is built as:
```js
nameLink.href = '../products/' + pageSlug + '?item=' + encodeURIComponent(item.sku || item.name);
```
When `item.sku` is empty (falsy), `item.name` is used. However, `handleDeepLinkedItem()` in `js/modules/02-utils.js:9` resolves the `?item=` parameter by looking up `document.querySelector('[data-sku="' + sku + '"]')`. The `data-sku` attribute is only set on cards when the SKU is truthy (module 15 line 1125: `if (variant && variant.sku)`; module 16 line 548: `if (item.sku)`). A name-based `?item=` value will never match any `data-sku` attribute, so the deep-link silently lands on the category page with no item highlighted or expanded.

This is a silent UX failure: the user clicks a search result, navigates to the subpage, but the target item is not highlighted or scrolled to.

**Fix:** Remove the name fallback from the URL construction. If no SKU exists, skip the `?item=` parameter entirely, or set a placeholder that signals "no deep-link":
```js
var itemParam = item.sku ? ('?item=' + encodeURIComponent(item.sku)) : '';
nameLink.href = '../products/' + pageSlug + itemParam;
```

### WR-02: Backdrop Fade-out Transition Is Cut Off by display:none

**File:** `css/search-overlay.css:38-53`

**Issue:** The backdrop uses `display: none` (default) and `display: block` (`.open`). The CSS `transition` on `opacity` and `visibility` only fires on properties that are interpolable. When the `.open` class is removed, `display` reverts from `block` to `none` immediately (at the start of the transition frame), which removes the element from the paint tree before the `opacity` can animate to 0. The result is the backdrop vanishes instantly on close — no fade-out.

The fade-in direction works because `display: none → block` happens at frame 0 and the `opacity: 0 → 1` transition then runs on the now-visible element. The reverse (close) does not work.

**Fix:** Remove `display: none` from the default rule and use only `visibility: hidden` + `pointer-events: none` for the hidden state. The `visibility` property is interpolable (it transitions at the end of the transition duration rather than cutting off):
```css
.search-overlay-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 195;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: opacity 0.2s, visibility 0.2s;
}

.search-overlay-backdrop.open {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
}
```

### WR-03: Clear Button Does Not Cancel the Pending Debounce Timer

**File:** `js/modules/17-search-overlay.js:626-631`

**Issue:** The clear button handler clears the input value and empties the results immediately, but does not call `clearTimeout(searchTimer)`:
```js
_overlayElements.clearBtn.addEventListener('click', function () {
  _overlayElements.input.value = '';
  _overlayElements.clearBtn.style.display = 'none';
  _overlayElements.results.innerHTML = '';
  _overlayElements.input.focus();
  // missing: clearTimeout(searchTimer);
});
```
If the user typed characters and quickly clicked clear within the 180ms debounce window, the pending timer will fire after the clear and call `renderSearchResults('')` — which calls `resultsEl.innerHTML = ''` again (a no-op since the results are already cleared). In the current implementation the secondary effect is benign. However, if `renderSearchResults` is later extended (e.g., to log analytics on render or to show a loading indicator), the stale timer firing after clear becomes a correctness bug.

**Fix:**
```js
_overlayElements.clearBtn.addEventListener('click', function () {
  _overlayElements.input.value = '';
  _overlayElements.clearBtn.style.display = 'none';
  _overlayElements.results.innerHTML = '';
  clearTimeout(searchTimer);
  _overlayElements.input.focus();
});
```

---

## Info

### IN-01: Redundant display:none + visibility:hidden on Backdrop Default State

**File:** `css/search-overlay.css:39,45`

**Issue:** The backdrop's default state sets both `display: none` (line 39) and `visibility: hidden` (line 45). These are redundant — `display: none` already removes the element from rendering and interaction; `visibility: hidden` adds no further effect when `display: none` is set. The combination contributes to the WR-02 fade-out bug (see above).

**Fix:** After applying the WR-02 fix (removing `display: none`), this becomes moot. No separate action needed.

### IN-02: mapItem, buildCartObject Are Duplicated Verbatim Across All Three Modules

**File:** `js/modules/17-search-overlay.js:133,334` / `js/modules/16-catalog-subpage.js:101,446` / `js/modules/15-hops.js:226,1342`

**Issue:** `mapItem` and `buildCartObject` are copy-pasted identically (or near-identically) into all three modules. The comment in 17 even says "Copies verbatim from 16-catalog-subpage.js". This means any future change to the mapping logic must be applied in three places. A divergence has already occurred: module 15's `mapItem` does not initialize `cf_subcategory`, `cf_type`, or `millable` fields, while modules 16 and 17 do.

**Fix:** Extract both functions to `js/lib/utils.js` or a new `js/lib/ingredient-utils.js` shared module and import via the global export pattern (`if (typeof module !== 'undefined' && module.exports) { ... }`). This is the existing pattern for shared helpers.

### IN-03: Module 17 Missing Test Coverage for buildResultRow and Overlay Lifecycle

**File:** `tests/frontend/17-search-overlay.test.js`

**Issue:** The test file covers only `groupResultsByCategory` (8 cases) and `computeResultCap` (6 cases), both of which are pure functions with no DOM dependencies. The module also exports nothing else for testing — `buildResultRow`, `openSearchOverlay`, `closeSearchOverlay`, `renderSearchResults`, and `loadSearchItems` are untested. Notable untested behaviors include: out-of-stock items render with `.out-of-stock` class, cart control rendered only for in-stock items, `?item=` URL construction, the `aria-expanded` lifecycle on the trigger button, and overlay close restoring `document.body.style.overflow`.

**Fix:** Extend module exports and add jsdom-based tests for the DOM-constructing functions. At minimum, add tests for `buildResultRow` (in-stock vs out-of-stock) and the `aria-expanded` toggle. Example:
```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    groupResultsByCategory: groupResultsByCategory,
    computeResultCap: computeResultCap,
    buildResultRow: buildResultRow  // add this
  };
}
```

---

_Reviewed: 2026-05-30_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
