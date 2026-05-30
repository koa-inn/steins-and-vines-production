# Phase 23: Cross-Category Search - Research

**Researched:** 2026-05-30
**Domain:** Vanilla JS search overlay, Fuse.js integration, subpage module patterns
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Responsive overlay — dropdown panel on desktop (>=768px), full-screen overlay on mobile (<768px). Breakpoint matches `SUBPAGE_DESKTOP_BREAKPOINT`.
- **D-02:** Light semi-transparent backdrop behind the panel on both desktop and mobile.
- **D-03:** Results grouped under bold category headers (Grains, Yeast, Additives, etc.) with match count per group. Categories sorted by number of matches descending.
- **D-04:** Search overlay available on ALL 7 ingredient pages — every `.subnav-search-btn` gets wired up.
- **D-05:** Each result row shows: product name, price with unit, and a small in-stock/out-of-stock badge.
- **D-06:** Dynamic per-category cap — 5 rows per group when 5+ categories match, 7 rows for 3–4, 10 rows for 1–2. "View all X in [Category]" link when capped.
- **D-07:** Out-of-stock items appear in results but dimmed (`opacity: 0.5`), no cart controls on those rows.
- **D-08:** Dual interaction per row — clicking item name navigates to category subpage with `?item=SKU`. A small `+` button does inline add-to-cart without leaving the overlay.
- **D-09:** No-results state: "No ingredients match '{query}'" message. No suggestions or category links.
- **D-10:** Minimum 2 characters before search fires.

### Claude's Discretion

- Overlay open/close animation (slide, fade, or instant)
- ESC key and backdrop-click to close behavior
- Auto-focus behavior on the search input when overlay opens
- Search input placeholder text
- Exact styling of category group headers and result rows
- Whether "View all" link navigates to the category page or expands inline
- Cart button design (icon, size, hover state)
- How to handle weight-based items in inline cart (simplified +1 vs full weight input)
- Debounce timing for search input (existing pattern is 180ms)

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SRCH-01 | A cross-category search overlay shows results grouped by category when triggered from the sub-nav search icon | Fuse.js v7.1.0 already vendored; pattern from `16-catalog-subpage.js` directly applicable; overlay HTML/CSS pattern from cart drawer |
| SRCH-02 | Clicking a search result navigates to the item on its category subpage with the item's detail panel expanded | CRITICAL GAP: `buildItemCard()` does not set `data-sku` — see Pitfall 1. The planner must include a task to add `data-sku` to cards. |

</phase_requirements>

---

## Summary

Phase 23 adds a cross-category search overlay to all 7 ingredient subpages. The implementation is almost entirely pattern-reuse from existing code — Fuse.js is already vendored, the data pipeline is established, the cart system is wired, and a close analog module (`16-catalog-subpage.js`) provides copy-paste starting points for nearly every function.

The single most important discovery from this research is a **pre-existing gap in the deep-link integration** (SRCH-02): `buildItemCard()` in `16-catalog-subpage.js` does not set `data-sku` on its `.subpage-card` divs, but `handleDeepLinkedItem()` searches the DOM for `[data-sku="..."]`. Without fixing `buildItemCard()`, clicking a search result and navigating to a subpage will NOT open the item's detail panel. This gap must be closed in a Wave 0 or Wave 1 task before SRCH-02 can work.

The rest of the phase is straightforward mechanical work: create `js/modules/17-search-overlay.js` and `css/search-overlay.css`, update build scripts in `package.json`, and update all 7 HTML pages. The PATTERNS.md document already contains copy-ready code extracts for every function. The planner can reference it directly for implementation details.

**Primary recommendation:** Build `17-search-overlay.js` as a near-verbatim port of `16-catalog-subpage.js`'s data loading and Fuse init patterns, omit `filterItemsByConfig`, add `data-sku` to `buildItemCard()` in the same task wave, then build the overlay render and grouping logic on top.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Search index (Fuse.js) | Browser / Client | — | Client-side fuzzy search over already-fetched ingredient data; no server round-trip needed |
| Data fetch (all ingredients) | Browser / Client | CDN / Static (snapshot fallback) | Reuses existing stale-while-revalidate fetch from `/api/ingredients` middleware; snapshot fallback if middleware unavailable |
| Overlay UI (HTML/CSS) | Browser / Client | — | Static DOM injection; no SSR on GitHub Pages |
| Cart integration | Browser / Client | — | `_activeCartTab`, `getCartKey()`, `setReservationQty()` are all browser-side globals |
| Deep-link navigation | Browser / Client | — | URL construction only; destination page's own `handleDeepLinkedItem()` handles panel expansion |
| Build pipeline | CDN / Static | — | Terser + cleancss minification at deploy time; `stamp:pages` cache-busts version strings |

---

## Standard Stack

### Core (already in project — no installation needed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Fuse.js | v7.1.0 | Client-side fuzzy search | Already vendored at `js/vendor/fuse.js`; used by `16-catalog-subpage.js` and `15-hops.js` |
| Vanilla JS (ES5) | n/a | All overlay logic | Project-wide constraint; `var`, no arrow functions, no template literals |
| CSS Custom Properties | n/a | Color tokens (`--color-cream`, `--color-green`, `--color-muted`, `--color-text`) | Established in `css/styles.css :root` lines 118–129 |
| clean-css-cli | ^5.6.3 | CSS minification | Already in devDependencies, used by `npm run minify:css` |
| terser | ^5.31.0 | JS minification | Already in devDependencies, used by `npm run minify:js` |

[VERIFIED: project codebase — `js/vendor/fuse.js` confirmed present; `package.json` devDependencies confirmed]

### No New Packages Needed

This phase introduces zero new npm dependencies. All capabilities are met by vendored libraries and existing project infrastructure.

---

## Package Legitimacy Audit

No external packages are installed in this phase. Fuse.js is already vendored at `js/vendor/fuse.js`. This section is not applicable.

---

## Architecture Patterns

### System Architecture Diagram

```
User types in search input (subnav)
          |
          v (180ms debounce)
  _searchFuse.search(query)     <-- single Fuse instance over ALL ingredients
          |
          v
  groupResultsByCategory()      <-- groups by cf_subcategory, sorts by match count desc
          |
          v
  applyDynamicCap()             <-- 5/7/10 rows per group based on category count
          |
          v
  renderOverlayResults()        <-- builds DOM: group headers + result rows
          |
     +----+----+
     |         |
  Item name   Cart (+) button
  click         click
     |              |
     v              v
  Navigate to    setReservationQty()
  /products/     (inline, stays in overlay)
  {slug}.html    |
  ?item={SKU}    v
                 reservation-changed event
                 -> re-render product-reserve-wrap
```

**Data loading (one-time on page load, lazy):**
```
DOMContentLoaded
     |
     v
loadSearchItems()  -- stale-while-revalidate pattern
     |
  [cached?] --> YES --> use cache, refresh background if stale
     |
    NO
     |
  [middlewareUrl?] --> YES --> fetch /api/ingredients --> setCachedMW()
     |                            |
     |                         (catch)
     |                            v
    NO <---------------------> loadFromSnapshot()
     |
     v
  _searchAllItems = items.filter(price > 0)
     |
     v
  _searchFuse = new Fuse(_searchAllItems, {keys, threshold, minMatchCharLength})
```

### Recommended Project Structure

```
js/modules/
  17-search-overlay.js      # new — overlay controller
  17-search-overlay.min.js  # build artifact

css/
  search-overlay.css        # new — overlay styles
  search-overlay.min.css    # build artifact

products/
  grains.html               # modify: enable button, add CSS/JS refs
  yeast.html                # modify: enable button, add CSS/JS refs
  additives.html            # modify: enable button, add CSS/JS refs
  packaging.html            # modify: enable button, add CSS/JS refs
  equipment.html            # modify: enable button, add CSS/JS refs
  hops.html                 # modify: enable button, add CSS/JS refs (loads 15-hops, not 16)
  ingredients-supplies.html # modify: enable button, add CSS/JS refs (different script block)

package.json                # modify: minify:css, minify:js, stamp:pages
```

### Pattern 1: Fuse.js Initialization (cross-category instance)

**What:** Single Fuse instance over ALL ingredient items, initialized after data load. Separate from the per-page Fuse instance in `16-catalog-subpage.js`.

**When to use:** In `loadSearchItems()` callback, after `_searchAllItems` is populated.

```javascript
// Source: js/modules/16-catalog-subpage.js lines 216-224 (adapted)
if (typeof Fuse !== 'undefined') {
  _searchFuse = new Fuse(_searchAllItems, {
    keys: ['name', 'description', 'cf_subcategory'],
    threshold: 0.35,
    minMatchCharLength: 2,
    ignoreLocation: true
  });
}
```

[VERIFIED: project codebase — 16-catalog-subpage.js lines 216–224]

### Pattern 2: Stale-While-Revalidate Data Loading

**What:** Serve cached data immediately, refresh in background if stale. Falls back to snapshot if middleware unavailable.

**When to use:** In `loadSearchItems()` — the overlay needs all ingredients regardless of current page's `SUBPAGE_CONFIG`.

```javascript
// Source: js/modules/16-catalog-subpage.js lines 185-215 (adapted)
// KEY DIFFERENCE: omit filterItemsByConfig(); filter only by price > 0
var cached = getCachedMW();
var dataPromise;
if (cached) {
  dataPromise = Promise.resolve(cached.data);
  if (!cached.fresh) {
    fetchFromMiddleware()
      .then(function (items) { setCachedMW(items); })
      .catch(function () {});
  }
} else if (middlewareUrl) {
  dataPromise = fetchFromMiddleware()
    .then(function (items) { setCachedMW(items); return items; })
    .catch(function () { return loadFromSnapshot(); });
} else {
  dataPromise = loadFromSnapshot();
}
```

[VERIFIED: project codebase — 16-catalog-subpage.js lines 185–215]

### Pattern 3: Group Results by Category

**What:** After Fuse search returns results, group them by `cf_subcategory`. Sort groups by match count descending. Apply dynamic cap per group.

```javascript
// Source: PATTERNS.md + UI-SPEC D-03, D-06 — implementation pattern (not yet in codebase)
function groupResultsByCategory(fuseResults) {
  var groups = {};
  fuseResults.forEach(function (r) {
    var item = r.item || r;  // Fuse v6 vs v7 guard
    var cat = item.cf_subcategory || 'Other';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(item);
  });
  // Sort categories by match count desc
  var sorted = Object.keys(groups).sort(function (a, b) {
    return groups[b].length - groups[a].length;
  });
  return sorted.map(function (cat) {
    return { category: cat, items: groups[cat] };
  });
}

function computeResultCap(categoryCount) {
  if (categoryCount <= 2) return 10;
  if (categoryCount <= 4) return 7;
  return 5;
}
```

[ASSUMED — pure logic pattern, not yet in codebase; based on UI-SPEC and D-06]

### Pattern 4: Product Reserve Wrap (inline cart)

**What:** Every in-stock result row gets a `.product-reserve-wrap` div with three private properties. Required for `refreshAllReserveControls()` to re-render on cart clear.

```javascript
// Source: js/modules/16-catalog-subpage.js lines 587-599
var cartObj = buildCartObject(item);  // _item_type: 'ingredient' is key
var productKey = item.name + '|';
var reserveWrap = document.createElement('div');
reserveWrap.className = 'product-reserve-wrap';
reserveWrap._reserveProduct = cartObj;
reserveWrap._reserveKey = productKey;
reserveWrap._reserveRenderer = renderReserveControl;  // simplified: no weight picker in overlay
renderReserveControl(reserveWrap, cartObj, productKey);
```

[VERIFIED: project codebase — 16-catalog-subpage.js lines 587–599]

### Pattern 5: Deep-Link URL Construction

**What:** Item name click navigates to the category subpage with `?item={encodedSKU}`. The destination page's `handleDeepLinkedItem()` finds `[data-sku]` and opens the detail panel.

```javascript
// Source: js/modules/02-utils.js lines 5-38; PATTERNS.md Category-to-URL Mapping
var CATEGORY_PAGE_MAP = {
  'Hops': 'hops.html',
  'Grains': 'grains.html',
  'Yeast': 'yeast.html',
  'Additives': 'additives.html',
  'Packaging': 'packaging.html',
  'Equipment': 'equipment.html'
};

function buildDeepLinkUrl(item) {
  var slug = CATEGORY_PAGE_MAP[item.cf_subcategory];
  if (!slug) slug = 'ingredients-supplies.html';
  var base = '../products/' + slug;  // path relative to current page
  return base + '?item=' + encodeURIComponent(item.sku || item.name);
}
```

**CRITICAL:** For this URL to work, the destination page's `buildItemCard()` MUST set `data-sku` on the card element. This is NOT currently done — see Pitfall 1.

[VERIFIED: project codebase — 02-utils.js line 9 confirms `[data-sku]` selector; PATTERNS.md confirmed CATEGORY_PAGE_MAP]

### Pattern 6: 180ms Debounce on Search Input

```javascript
// Source: js/modules/16-catalog-subpage.js lines 886-890
var searchTimer;
searchInput.addEventListener('input', function () {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runOverlaySearch, 180);
});
```

[VERIFIED: project codebase — 16-catalog-subpage.js line 887]

### Pattern 7: ESC Key Close + Focus Return

```javascript
// Source: js/modules/16-catalog-subpage.js lines 922-931 (adapted)
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && _searchOverlayOpen) {
    closeSearchOverlay();
    // Return focus to the button that opened the overlay
    var btn = document.querySelector('.subnav-search-btn');
    if (btn) btn.focus();
  }
});
```

[VERIFIED: project codebase — 16-catalog-subpage.js lines 922–931]

### Pattern 8: Module Exports for Testability

**What:** Export pure functions at module bottom so Jest can test them without the DOM.

```javascript
// Source: js/modules/16-catalog-subpage.js lines 992-997
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    groupResultsByCategory: groupResultsByCategory,
    computeResultCap: computeResultCap
  };
}
```

[VERIFIED: project codebase — pattern from 16-catalog-subpage.js line 992]

### Pattern 9: Build Script Additions

**minify:css** — append to existing chain in `package.json` line 6:
```
&& cleancss -o css/search-overlay.min.css css/search-overlay.css
```

**minify:js** — append to existing chain in `package.json` line 8:
```
&& terser js/modules/17-search-overlay.js -o js/modules/17-search-overlay.min.js -c -m
```

**stamp:pages** — two new regex replacements in the `.forEach()` body (line 15):
```javascript
f=f.replace(/search-overlay\\.min\\.css\\?v=[^\\\"]+/g,'search-overlay.min.css?v='+v);
f=f.replace(/17-search-overlay\\.min\\.js\\?v=[^\\\"]+/g,'17-search-overlay.min.js?v='+v);
```

Also add `17-search-overlay.min.js` references to all 7 HTML pages listed in the `stamp:pages` file array — the files are already listed so no change needed to the array.

[VERIFIED: project codebase — package.json lines 6, 8, 15 read directly]

### Anti-Patterns to Avoid

- **`let`/`const`/arrow functions:** Project is strictly ES5. Use `var` and `function` declarations only.
- **Calling `filterItemsByConfig()` in the overlay:** The overlay needs ALL ingredients (price > 0), not filtered to a subcategory. The per-page Fuse instance filters; the overlay Fuse instance does not.
- **`innerHTML` for product data:** Use `el.textContent = item.name`. Use `escapeHTML()` only when building full HTML strings for wrapper `.innerHTML` — never for untrusted product values.
- **Sharing the Fuse instance with `16-catalog-subpage.js`:** The overlay's `_searchFuse` is over all items; the subpage `_subpageFuse` is over filtered items. They are separate instances with different data sets.
- **Modifying `catalog-subpage.css`:** Overlay styles go in the new `search-overlay.css`. Override the `.subnav-search-btn` disabled state there — do not edit the base file.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Fuzzy search | Custom string distance algorithm | `Fuse.js v7.1.0` (already vendored) | Handles threshold, ignoreLocation, multi-key search; tested across the codebase |
| Focus trap | Manual tab-index management | Simple approach: `tabindex="-1"` on backdrop, listen to `focusout` of panel | Phase scope doesn't warrant a full focus-trap library; existing modals use this pattern |
| CSS animation | JS-based animation | CSS `opacity + visibility + transform` with `transition` | Matches cart drawer pattern; avoids JS layout thrashing |
| `encodeURIComponent` | Custom URL encoding | Native `encodeURIComponent()` | Already used in `buildProductLinkBtn()` in `02-utils.js` |
| localStorage cache | IndexedDB or complex caching | Simple `localStorage.getItem/setItem` with TTL | Matches existing `getCachedMW()` pattern; handles QuotaExceededError with try/catch |

**Key insight:** Every non-trivial piece of this phase has an already-working analog in `16-catalog-subpage.js`. The planner should frame tasks as "port this section from 16-catalog-subpage.js and make these specific changes" rather than "build from scratch."

---

## Critical Integration Gap: data-sku Missing from Subpage Cards

### The Problem (SRCH-02 Blocker)

`handleDeepLinkedItem()` in `js/modules/02-utils.js` works by:
1. Reading `?item=SKU` from the URL
2. Running `document.querySelector('[data-sku="' + sku + '"]')` to find the card
3. Highlighting and scrolling to it; opening its detail panel

`buildItemCard()` in `js/modules/16-catalog-subpage.js` creates a `.subpage-card` div but **does not call `card.setAttribute('data-sku', item.sku)`**.

When a user clicks a search result and lands on the category subpage, `handleDeepLinkedItem()` will find no element and exit silently — the detail panel will not open, and SRCH-02 will be unmet.

### The Fix

In `buildItemCard()`, add immediately after `card.className = 'product-card subpage-card'`:
```javascript
if (item.sku) {
  card.setAttribute('data-sku', item.sku);
}
```

This is a one-line change to `16-catalog-subpage.js` that unblocks SRCH-02. The existing call to `handleDeepLinkedItem()` at line 952 will then work correctly.

The planner must include this as a task in Phase 23. It is a modification to `16-catalog-subpage.js` (not a new file), so it requires running `npm run build` after the change.

[VERIFIED: project codebase — 02-utils.js line 9 uses `[data-sku]`; 16-catalog-subpage.js buildItemCard() scanned, no `setAttribute('data-sku')` found]

---

## Common Pitfalls

### Pitfall 1: data-sku Missing (SRCH-02 Blocker)

**What goes wrong:** SRCH-02 deep-link silently fails. User clicks result, lands on subpage, sees all products but none highlighted or expanded.
**Why it happens:** `buildItemCard()` in `16-catalog-subpage.js` was written before deep-link navigation was relevant to subpages.
**How to avoid:** Add `if (item.sku) card.setAttribute('data-sku', item.sku);` to `buildItemCard()` as a separate task before any SRCH-02 testing.
**Warning signs:** Navigate to `products/grains.html?item=SomeGrainSKU` manually — no highlight, no panel open = bug confirmed.

### Pitfall 2: Separate Cache Keys Required

**What goes wrong:** The overlay writes to the same localStorage key as the per-page subpage cache, corrupting the subpage's filtered data with all-items data.
**Why it happens:** Both modules call `setCachedMW()`, and if they use the same key, whichever runs last wins.
**How to avoid:** Use distinct cache keys: `SEARCH_MW_CACHE_KEY = 'sv-search-all-mw'` and `SEARCH_MW_CACHE_TS = 'sv-search-all-mw-ts'`. Per-page keys use `'sv-subpage-{categorySlug}-mw'`. These never collide.
**Warning signs:** After opening the search overlay on Grains, the grains catalog shows unrelated items (packaging, equipment).

### Pitfall 3: _activeCartTab Not Set Before Cart Operations

**What goes wrong:** Inline cart additions from the overlay go to the wrong cart (`sv-cart-ferment` instead of `sv-cart-ingredients`), breaking checkout.
**Why it happens:** `_activeCartTab` defaults to `'kits'` in `11-cart.js`; each subpage module must override it.
**How to avoid:** First statement in `DOMContentLoaded` handler: `_activeCartTab = 'ingredients';` — before any cart render call.
**Warning signs:** Items added via search overlay appear in the Ferment in Store checkout, not the Ingredients checkout.

### Pitfall 4: Hops Page Has Different Script Stack

**What goes wrong:** Adding `17-search-overlay.min.js` after `16-catalog-subpage.min.js` works for 6 pages but `hops.html` loads `15-hops.min.js` instead.
**Why it happens:** Hops has a unique module because it groups items by variant, has separate Fuse keys (alpha_acid, origin), and doesn't use `SUBPAGE_CONFIG`.
**How to avoid:** Treat `hops.html` as a separate HTML modification task. The insertion point is after `15-hops.min.js`, not after `16-catalog-subpage.min.js`.
**Warning signs:** Search overlay does not initialize on the Hops page, or `SUBPAGE_CONFIG is not defined` error appears.

### Pitfall 5: ingredients-supplies.html Has Different Script Block

**What goes wrong:** `ingredients-supplies.html` loads scripts differently — no `16-catalog-subpage.min.js` at all (it uses the main catalog `08-catalog-ingredients.js` already bundled in `main.min.js`).
**Why it happens:** `ingredients-supplies.html` was built in an earlier phase before the subpage module existed. Its script block ends at `main.min.js`.
**How to avoid:** For `ingredients-supplies.html`, add `17-search-overlay.min.js` directly after `main.min.js`. The overlay module does not depend on `16-catalog-subpage.min.js`.
**Warning signs:** `17-search-overlay.min.js` loads fine on 6 pages but not on `ingredients-supplies.html`.

### Pitfall 6: stamp:pages Array Must List All 7 Pages

**What goes wrong:** New `search-overlay.min.css?v=...` and `17-search-overlay.min.js?v=...` references in HTML are not cache-busted by `npm run build`.
**Why it happens:** The `stamp:pages` script only processes files listed in its array. The 7 ingredient pages are already in the array, but the regex patterns for the new file references are not yet registered.
**How to avoid:** Add two regex replacement lines to the `stamp:pages` node script body (after the existing `16-catalog-subpage.min.js` replacement):
```javascript
f=f.replace(/search-overlay\\.min\\.css\\?v=[^\\\"]+/g,'search-overlay.min.css?v='+v);
f=f.replace(/17-search-overlay\\.min\\.js\\?v=[^\\\"]+/g,'17-search-overlay.min.js?v='+v);
```
**Warning signs:** After `npm run build`, version suffix on `search-overlay.min.css` does not match other versioned files.

### Pitfall 7: ingredients-supplies.html Has No catalog-subpage.min.css

**What goes wrong:** The `search-overlay.css` relies on `.stock-badge` classes defined in `catalog-subpage.css`. If `catalog-subpage.min.css` is not loaded, badges have no styles.
**Why it happens:** `ingredients-supplies.html` loads `catalog-subpage.min.css` (confirmed at line 74), so this is NOT actually a problem — but it must be verified before assuming `stock-badge` classes are available.
**How to avoid:** Verify `catalog-subpage.min.css` is loaded before `search-overlay.min.css` on all 7 pages. If any page is missing it, define `.stock-badge` classes directly in `search-overlay.css` as a fallback.
**Warning signs:** Stock badges in the overlay are unstyled (white text on transparent background).

### Pitfall 8: Overlay z-index Conflicts

**What goes wrong:** On desktop, the dropdown panel appears behind the cart FAB (z-index: 1050) or behind the cart drawer (z-index: 1200).
**Why it happens:** Default z-index stacking.
**How to avoid:** Set `z-index: 196` on `.search-overlay-panel`, `z-index: 195` on `.search-overlay-backdrop`. This places the overlay above the sub-nav (190) but below the cart FAB (1050).
**Warning signs:** Clicking the cart FAB while overlay is open shows the cart drawer overlapping the search panel.

---

## Code Examples

### Module State Block (copy-ready)

```javascript
// Source: js/modules/16-catalog-subpage.js lines 11-23 (adapted)
var _searchAllItems = [];
var _searchFuse = null;
var _searchOverlayOpen = false;
var _searchOpenBtn = null;   // stores ref to .subnav-search-btn that opened overlay
var SEARCH_DESKTOP_BREAKPOINT = 768;

var SEARCH_MW_CACHE_KEY = 'sv-search-all-mw';
var SEARCH_MW_CACHE_TS  = 'sv-search-all-mw-ts';
var SEARCH_MW_CACHE_TTL = 3600000; // 1 hour
```

### DOMContentLoaded Init Guard (copy-ready)

```javascript
// Source: js/modules/16-catalog-subpage.js lines 833-841 (adapted)
if (typeof document !== 'undefined') { document.addEventListener('DOMContentLoaded', function () {
  // MUST be first statement — routes cart items to ingredients cart
  _activeCartTab = 'ingredients';

  // No SUBPAGE_CONFIG guard needed — overlay does not depend on per-page config

  var btn = document.querySelector('.subnav-search-btn');
  if (!btn) return; // no search button on this page — abort silently

  btn.addEventListener('click', openSearchOverlay);
  // ... rest of init
}); }
```

### buildCartObject() (verbatim copy from 16-catalog-subpage.js lines 446-469)

```javascript
function buildCartObject(item) {
  return {
    name: item.name,
    brand: '',
    retail_instore: '',
    retail_kit: '',
    price_per_unit: item.price_per_unit || '',
    price: item.price_per_unit || '',
    discount: '',
    stock: item.stock,
    time: '',
    sku: item.sku || '',
    unit: item.unit || '',
    low_amount: item.low_amount || '',
    high_amount: item.high_amount || '',
    step: item.step || '',
    _item_type: 'ingredient',   // <-- critical: routes to sv-cart-ingredients
    max_order_qty: item.max_order_qty || '',
    zoho_item_id: item.zoho_item_id || '',
    millable: item.millable || '',
    tax_percentage: item.tax_percentage != null ? item.tax_percentage : 0,
    tax_name: item.tax_name || ''
  };
}
```

### Overlay Open/Close CSS (copy-ready)

```css
/* Source: css/catalog-subpage.css lines 738-774 (adapted) */
.search-overlay-backdrop {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.45);
  z-index: 195;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.2s, visibility 0.2s;
}
.search-overlay-backdrop.open {
  display: block;
  opacity: 1;
  visibility: visible;
}

/* Desktop dropdown panel */
.ingredient-subnav .container {
  position: relative; /* anchors dropdown panel */
}
.search-overlay-panel {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  width: 480px;
  max-width: calc(100vw - 32px);
  max-height: 60vh;
  overflow-y: auto;
  background: var(--color-cream);
  border-radius: 4px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.2);
  z-index: 196;
  opacity: 0;
  visibility: hidden;
  transform: translateY(-8px);
  transition: opacity 0.18s ease-out, visibility 0.18s, transform 0.18s ease-out;
}
.search-overlay-panel.open {
  opacity: 1;
  visibility: visible;
  transform: translateY(0);
}

/* Mobile full-screen */
@media (max-width: 767px) {
  .search-overlay-panel {
    position: fixed;
    inset: 0;
    width: 100%;
    max-width: 100%;
    max-height: 100%;
    border-radius: 0;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .search-overlay-panel,
  .search-overlay-backdrop {
    transition: opacity 0.18s, visibility 0.18s;
    transform: none !important;
  }
}
```

### HTML Button Change (all 7 pages, same change)

```html
<!-- BEFORE (e.g. grains.html line 88) -->
<button type="button" class="subnav-search-btn" aria-label="Search ingredients (coming soon)" title="Search coming soon" disabled>

<!-- AFTER -->
<button type="button" class="subnav-search-btn" aria-label="Open ingredient search">
```

---

## Per-Page Script Loading Variations

This is a critical implementation detail — the 7 ingredient pages are NOT identical:

| Page | Loads | Add After | CSS Loads catalog-subpage.min.css? |
|------|-------|-----------|-------------------------------------|
| `grains.html` | `16-catalog-subpage.min.js` | after 16- | YES (line 27) |
| `yeast.html` | `16-catalog-subpage.min.js` | after 16- | YES |
| `additives.html` | `16-catalog-subpage.min.js` | after 16- | YES |
| `packaging.html` | `16-catalog-subpage.min.js` | after 16- | YES |
| `equipment.html` | `16-catalog-subpage.min.js` | after 16- | YES |
| `hops.html` | `15-hops.min.js` (NOT 16-) | after 15- | YES (line 75) |
| `ingredients-supplies.html` | Only `main.min.js` | after main.min.js | YES (line 74) |

[VERIFIED: project codebase — script tags grep confirmed for all 7 pages]

The `search-overlay.min.css` link must be added after `catalog-subpage.min.css` on all 7 pages. Version string format must match existing: `?v=mpshq381` (will be auto-updated by `stamp:pages`).

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No cross-category search | Cross-category Fuse.js overlay | Phase 23 | Customers can find ingredients without knowing which category they're in |
| `handleDeepLinkedItem()` assumes product pages | Same function reused for subpages | Phase 23 (requires `data-sku` fix) | Deep-link from search to category subpage |
| `.subnav-search-btn` disabled | `.subnav-search-btn` enabled with click handler | Phase 23 | Placeholder button becomes functional |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `groupResultsByCategory()` and `computeResultCap()` are not yet written anywhere in the codebase | Architecture Patterns, Pattern 3 | Low — confirmed by codebase scan; these are new logic in this phase |
| A2 | `ingredients-supplies.html` does NOT load `16-catalog-subpage.min.js` and the overlay module needs to be self-sufficient on that page | Per-Page Script Loading Variations | HIGH — if wrong, there could be double-initialization. Confirmed by grep: only `main.min.js` is loaded there |
| A3 | All 7 ingredient pages include `catalog-subpage.min.css` (needed for `.stock-badge` classes) | Pitfall 7 | Medium — confirmed for grains (line 27), hops (line 75), ingredients-supplies (line 74); others presumed same |
| A4 | `15-hops.js` calls `handleDeepLinkedItem()` (line 1600) but `buildHopCard()` does NOT set `data-sku` — deep-link will fail on hops.html without the fix | Critical Integration Gap | RESOLVED — confirmed by code inspection. `buildHopCard()` at line 1121 sets `card.className = 'product-card hop-card'` but has no `setAttribute('data-sku', ...)`. Fix needed: add `data-sku` using `variant.sku` (default variant = `group.variants[0]`). Plan 01 Task 1 addresses this. |

---

## Open Questions (RESOLVED)

1. **How does handleDeepLinkedItem() interact with hops.html?**
   - **RESOLVED:** `15-hops.js` DOES call `handleDeepLinkedItem()` at line 1600 (correcting assumption A4 which originally stated it did not). However, `buildHopCard()` at line 1121 does NOT set `data-sku` on hop cards. The hops card is built from a `group` object with `group.variants[0]` as the default variant, and `variant.sku` contains the SKU string. The fix is identical to the one for `16-catalog-subpage.js`: add `if (variant.sku) { card.setAttribute('data-sku', variant.sku); }` after `card.className = 'product-card hop-card'` in `buildHopCard()`. Plan 01 Task 1 already includes this fix.

2. **Does `ingredients-supplies.html` use `16-catalog-subpage.js` at all, and will SRCH-02 work there for uncategorized items?**
   - **RESOLVED:** `ingredients-supplies.html` uses `08-catalog-ingredients.js` (bundled in `main.min.js`), NOT `16-catalog-subpage.js`. Crucially, `08-catalog-ingredients.js` ALREADY sets `data-sku` on both table rows (line 456: `tr.setAttribute('data-sku', item.sku)`) and product cards (line 593: `card.setAttribute('data-sku', item.sku)`). It also calls `handleDeepLinkedItem()` at line 1601. Therefore, SRCH-02 deep-link already works on `ingredients-supplies.html` with no additional fix needed. Items with unmapped subcategories (falling through to `ingredients-supplies.html` in `CATEGORY_PAGE_MAP`) will correctly deep-link because that page already has `data-sku` attributes on its cards.

---

## Environment Availability

Step 2.6: No new external tools or services required. Build tools (`cleancss`, `terser`) are confirmed present in `package.json` devDependencies. No runtime environment audit needed.

---

## Validation Architecture

`nyquist_validation` is explicitly `false` in `.planning/config.json`. This section is skipped.

However, the existing test infrastructure is relevant:
- `tests/frontend/16-catalog-subpage.test.js` — tests `filterItemsByConfig` and `buildSortComparator` using the module exports pattern
- New pure functions `groupResultsByCategory` and `computeResultCap` are testable with the same module exports pattern
- The planner should include a task to write `tests/frontend/17-search-overlay.test.js` covering at minimum `groupResultsByCategory` and `computeResultCap`

---

## Security Domain

`security_enforcement: true` in `.planning/config.json` (ASVS level 1).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Search overlay is public-facing, no auth required |
| V3 Session Management | No | No session state in this phase |
| V4 Access Control | No | All ingredient data is public |
| V5 Input Validation | Yes | Search query input — see below |
| V6 Cryptography | No | No cryptographic operations |

### V5 — Input Validation

The search input value is used only as a Fuse.js search query (string passed to `_searchFuse.search(query)`) and never injected into the DOM directly or sent to the server. The existing pattern in `16-catalog-subpage.js` (T-21-03 comment: "query used only in Fuse.search() and textContent comparison") applies here.

No sanitization is needed for the Fuse query itself. However, the error state message `No ingredients match "{query}"` must use `textContent`, not `innerHTML`, or must call `escapeHTML()` if building as an HTML string — to prevent XSS if a user types `<script>alert(1)</script>`.

**Standard control:** Use `el.textContent = 'No ingredients match "' + query + '"'` — never `el.innerHTML`.

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| XSS via search query reflection | Tampering | Use `textContent` for query echoing; `escapeHTML()` for any HTML-string injection |
| Prototype pollution via Zoho custom fields | Tampering | Already mitigated — `mapItem()` prototype pollution guard (key === `__proto__` check) copied verbatim from `16-catalog-subpage.js` |
| localStorage quota exhaustion | Denial of Service | `try/catch` in `setCachedMW()` — already in pattern |

---

## Sources

### Primary (HIGH confidence — verified in project codebase)

- `js/modules/16-catalog-subpage.js` — Fuse init (lines 216–224), data loading (lines 85–238), buildCartObject (lines 446–469), debounce (lines 883–891), ESC handler (lines 921–931), module exports (lines 992–997)
- `js/modules/02-utils.js` — `handleDeepLinkedItem()` (lines 1–38), `[data-sku]` selector (line 9)
- `js/modules/15-hops.js` — Hops Fuse init (lines 319–326), `buildHopCard()` (line 1121), `handleDeepLinkedItem()` call (line 1600)
- `js/modules/08-catalog-ingredients.js` — `data-sku` on table rows (line 456), `data-sku` on product cards (line 593), `handleDeepLinkedItem()` call (line 1601)
- `css/catalog-subpage.css` — subnav styles (lines 594–681), cart drawer backdrop pattern (lines 736–774)
- `products/grains.html` — search button HTML (lines 88–92), script loading (lines 190–192), CSS loading (lines 26–27)
- `products/hops.html` — script loading (lines 272–274), CSS loading (line 75)
- `products/ingredients-supplies.html` — script loading (line 306), CSS loading (line 74)
- `package.json` — full build pipeline (lines 6–16)
- `.planning/phases/23-cross-category-search/23-CONTEXT.md` — all locked decisions
- `.planning/phases/23-cross-category-search/23-UI-SPEC.md` — visual/interaction contract
- `.planning/phases/23-cross-category-search/23-PATTERNS.md` — copy-ready code extracts

### Secondary (MEDIUM confidence — derived from code analysis)

- Per-page script variations confirmed via `grep` across all 7 pages
- `data-sku` gap confirmed by searching all source modules
- `08-catalog-ingredients.js` data-sku and handleDeepLinkedItem presence confirmed via grep

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries are vendored or in devDependencies; no external lookups needed
- Architecture: HIGH — 16-catalog-subpage.js is a direct and near-complete analog; all patterns verified in source
- Pitfalls: HIGH — data-sku gap discovered by direct code inspection; cache key collision confirmed by reading MW_CACHE_KEY initialization; script variations confirmed by grep
- SRCH-02 deep-link: HIGH — all three card-building modules inspected: 16-catalog-subpage.js (gap, needs fix), 15-hops.js (gap, needs fix), 08-catalog-ingredients.js (already has data-sku, no fix needed)

**Research date:** 2026-05-30
**Valid until:** 2026-06-30 (stable codebase, no external dependencies)
