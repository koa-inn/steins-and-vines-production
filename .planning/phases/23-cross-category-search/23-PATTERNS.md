# Phase 23: Cross-Category Search - Pattern Map

**Mapped:** 2026-05-30
**Files analyzed:** 10 (2 new, 7 modified HTML pages, 1 modified package.json)
**Analogs found:** 10 / 10

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `js/modules/17-search-overlay.js` | module (overlay controller) | request-response + event-driven | `js/modules/16-catalog-subpage.js` | exact |
| `css/search-overlay.css` | styles | n/a | `css/catalog-subpage.css` lines 594-681 | exact |
| `products/hops.html` | page (HTML modify) | n/a | `products/grains.html` | exact |
| `products/grains.html` | page (HTML modify) | n/a | self (grains.html lines 185-193) | exact |
| `products/yeast.html` | page (HTML modify) | n/a | `products/grains.html` | exact |
| `products/additives.html` | page (HTML modify) | n/a | `products/grains.html` | exact |
| `products/packaging.html` | page (HTML modify) | n/a | `products/grains.html` | exact |
| `products/equipment.html` | page (HTML modify) | n/a | `products/grains.html` | exact |
| `products/ingredients-supplies.html` | page (HTML modify) | n/a | `products/grains.html` | exact |
| `package.json` | config (build scripts) | n/a | `package.json` lines 6-15 | exact |

---

## Pattern Assignments

### `js/modules/17-search-overlay.js` (standalone overlay module)

**Analog:** `js/modules/16-catalog-subpage.js`

**File header / globals comment** (lines 1-6):
```javascript
// ===== Catalog Subpage Module =====
// Standalone module (NOT in concat:js). Loads after main.min.js.
// Shared globals available: formatCurrency, escapeHTML, renderReserveControl,
// renderWeightControl, hasWeightConfig, setReservationQty, getReservedQty,
// equalizeCardHeights, trackEvent, Fuse, handleDeepLinkedItem, injectProductSchema
```
Copy this header pattern verbatim, updating the module name and relevant globals list. Globals available to 17-search-overlay.js: `formatCurrency`, `escapeHTML`, `renderReserveControl`, `hasWeightConfig`, `setReservationQty`, `getReservedQty`, `Fuse`, `handleDeepLinkedItem`.

**Module-private state variables** (lines 11-22):
```javascript
var _allSubpageItems = [];
var _subpageFuse = null;
var _activeFilterGroups = [];
var _subpageViewMode = 'grid';
var _subpageSortMode = 'stock-first';
var _subpageOpenPanel = null;
var _subpageOpenCard = null;
var SUBPAGE_DESKTOP_BREAKPOINT = 768;

// Cache keys — initialized inside DOMContentLoaded once SUBPAGE_CONFIG is available
var MW_CACHE_KEY = '';
var MW_CACHE_TS  = '';
var MW_CACHE_TTL = 3600000; // 1 hour
```
For 17-search-overlay.js, the equivalent state is:
```javascript
// ===== Cross-Category Search Overlay Module =====
// Standalone module (NOT in concat:js). Loads after main.min.js.
// Shared globals available: formatCurrency, escapeHTML, renderReserveControl,
// hasWeightConfig, setReservationQty, getReservedQty, Fuse, handleDeepLinkedItem

var _searchAllItems = [];       // all ingredients (unfiltered, price > 0)
var _searchFuse = null;         // single Fuse instance across all categories
var _searchOverlayOpen = false;
var SEARCH_DESKTOP_BREAKPOINT = 768; // matches SUBPAGE_DESKTOP_BREAKPOINT

var SEARCH_MW_CACHE_KEY = 'sv-search-all-mw';
var SEARCH_MW_CACHE_TS  = 'sv-search-all-mw-ts';
var SEARCH_MW_CACHE_TTL = 3600000; // 1 hour
```

**localStorage cache pattern** (lines 85-99):
```javascript
function getCachedMW() {
  try {
    var data = localStorage.getItem(MW_CACHE_KEY);
    var ts = parseInt(localStorage.getItem(MW_CACHE_TS), 10) || 0;
    if (data) return { data: JSON.parse(data), fresh: (Date.now() - ts) < MW_CACHE_TTL };
  } catch (e) {}
  return null;
}

function setCachedMW(items) {
  try {
    localStorage.setItem(MW_CACHE_KEY, JSON.stringify(items));
    localStorage.setItem(MW_CACHE_TS, String(Date.now()));
  } catch (e) {}
}
```
Copy verbatim, replacing `MW_CACHE_KEY`/`MW_CACHE_TS` with `SEARCH_MW_CACHE_KEY`/`SEARCH_MW_CACHE_TS`. The overlay's cache covers ALL ingredients (no SUBPAGE_CONFIG filter) — it is a separate cache entry from each subpage's per-category key.

**Fuse initialization pattern** (lines 216-224):
```javascript
if (typeof Fuse !== 'undefined') {
  _subpageFuse = new Fuse(items, {
    keys: ['name', 'description', 'cf_subcategory'],
    threshold: 0.35,
    minMatchCharLength: 2,
    ignoreLocation: true
  });
}
```
For the overlay, the Fuse instance covers all items and must include `cf_subcategory` for category grouping to work. Copy with `_searchFuse` and same options.

**Middleware fetch pattern** (lines 138-155):
```javascript
function fetchFromMiddleware() {
  var middlewareUrl = (typeof SHEETS_CONFIG !== 'undefined' && SHEETS_CONFIG.MIDDLEWARE_URL)
    ? SHEETS_CONFIG.MIDDLEWARE_URL : '';
  var apiKey = (typeof SHEETS_CONFIG !== 'undefined' && SHEETS_CONFIG.MW_API_KEY)
    ? SHEETS_CONFIG.MW_API_KEY : '';

  return fetch(middlewareUrl + '/api/ingredients', {
    headers: { 'x-api-key': apiKey }
  })
    .then(function (r) {
      if (!r.ok) throw new Error('Middleware returned ' + r.status);
      return r.json();
    })
    .then(function (data) {
      var items = (data.items || []).map(mapItem);
      return filterItemsByConfig(items, SUBPAGE_CONFIG);  // <-- OMIT this filter for overlay
    });
}
```
For the overlay, omit the `filterItemsByConfig` call — the overlay needs ALL ingredients with `price > 0`. Keep the `mapItem()` transform.

**mapItem() transform** (lines 101-136):
Copy `mapItem()` verbatim from `js/modules/16-catalog-subpage.js` lines 101-136. It normalizes Zoho API fields and flattens custom fields. The prototype pollution guard on lines 127-129 must be preserved:
```javascript
if (key === '__proto__' || key === 'constructor' || key === 'prototype') return;
```

**Snapshot fallback pattern** (lines 157-167):
```javascript
function loadFromSnapshot() {
  return fetch('/content/zoho-snapshot.json')
    .then(function (r) {
      if (!r.ok) throw new Error('Snapshot fetch failed: ' + r.status);
      return r.json();
    })
    .then(function (snap) {
      var items = (snap.ingredients || []).map(mapItem);
      return filterItemsByConfig(items, SUBPAGE_CONFIG);  // <-- OMIT filter for overlay
    });
}
```
Same as middleware: omit the `filterItemsByConfig` call. Filter only by `price > 0`.

**Stale-while-revalidate data loading** (lines 185-215):
```javascript
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
Copy this stale-while-revalidate pattern directly into `loadSearchItems()`.

**buildCartObject() pattern** (lines 446-469):
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
    _item_type: 'ingredient',
    max_order_qty: item.max_order_qty || '',
    zoho_item_id: item.zoho_item_id || '',
    millable: item.millable || '',
    tax_percentage: item.tax_percentage != null ? item.tax_percentage : 0,
    tax_name: item.tax_name || ''
  };
}
```
Copy verbatim — `_item_type: 'ingredient'` is the key field that routes inline cart additions to the ingredients cart via `getCartKey()`.

**renderReserveControl wrap pattern** (lines 587-599):
```javascript
var cartObj = buildCartObject(item);
var productKey = item.name + '|';
var reserveWrap = document.createElement('div');
reserveWrap.className = 'product-reserve-wrap';

var cardRenderer = (itemIsWeight && typeof renderWeightControlCompact !== 'undefined')
  ? renderWeightControlCompact : renderReserveControl;
reserveWrap._reserveProduct = cartObj;
reserveWrap._reserveKey = productKey;
reserveWrap._reserveRenderer = cardRenderer;
cardRenderer(reserveWrap, cartObj, productKey);
```
For the overlay's inline cart button, use a simplified version: weight items get a plain `renderReserveControl` (simplified +1, no weight picker — see UI-SPEC "Weight-based Items"). The `product-reserve-wrap` class and the three `._reserve*` properties must be set so `refreshAllReserveControls()` can re-render on cart clear.

**cart event listener pattern** (lines 982-986):
```javascript
if (typeof window !== 'undefined') {
  window.addEventListener('reservation-changed', function () {
    if (typeof updateSubpageCartFab === 'function') updateSubpageCartFab();
  });
}
```
The search overlay does not manage the cart FAB directly (16-catalog-subpage.js already handles it on each page). However, if the overlay is open when a cart add fires, the inline cart control must re-render. Wire `reservation-changed` to re-render any visible `product-reserve-wrap` elements inside the overlay panel.

**Keyboard ESC close pattern** (lines 922-931):
```javascript
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && _subpageOpenPanel) {
    var prevCard = _subpageOpenCard;
    closeDetailPanel();
    if (prevCard) {
      var toggleBtn = prevCard.querySelector('button');
      if (toggleBtn) toggleBtn.focus();
    }
  }
});
```
Apply same ESC pattern to the overlay: on `Escape`, close overlay and return focus to the `.subnav-search-btn` that opened it.

**DOMContentLoaded init guard pattern** (lines 833-838):
```javascript
if (typeof document !== 'undefined') { document.addEventListener('DOMContentLoaded', function () {
  // Guard: abort if SUBPAGE_CONFIG is not defined
  if (typeof SUBPAGE_CONFIG === 'undefined') {
    console.error('[16-catalog-subpage] SUBPAGE_CONFIG not defined — module aborted.');
    return;
  }
  // MUST be first statement after guard — routes cart items to ingredients cart
  _activeCartTab = 'ingredients';
```
For the overlay:
```javascript
if (typeof document !== 'undefined') { document.addEventListener('DOMContentLoaded', function () {
  // MUST be first statement — routes cart items to ingredients cart
  // (overlay is only loaded on ingredient pages, so this is always correct)
  _activeCartTab = 'ingredients';
```
No `SUBPAGE_CONFIG` guard needed — the overlay does not depend on per-page config.

**180ms debounce pattern** (lines 886-890):
```javascript
var searchTimer;
searchInput.addEventListener('input', function () {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(renderCatalog, 180);
});
```
Copy verbatim for the overlay search input, replacing `renderCatalog` with the overlay's render function.

**Module exports pattern** (lines 992-997):
```javascript
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    filterItemsByConfig: filterItemsByConfig,
    buildSortComparator: buildSortComparator
  };
}
```
Copy this pattern at the bottom of 17-search-overlay.js, exporting any pure functions that are unit-testable (e.g., `groupResultsByCategory`, `computeResultCap`).

**Fuse search execution pattern** (lines 781-800):
```javascript
if (_subpageFuse) {
  var fuseResults = _subpageFuse.search(query);
  var matchingNames = {};
  fuseResults.forEach(function (r) {
    var item = r.item || r;
    matchingNames[item.name] = true;
  });
  filtered = filtered.filter(function (item) {
    return matchingNames[item.name];
  });
} else {
  var q = query.toLowerCase();
  filtered = filtered.filter(function (item) {
    return (item.name || '').toLowerCase().indexOf(q) !== -1 ||
           (item.description || '').toLowerCase().indexOf(q) !== -1 ||
           (item.cf_subcategory || '').toLowerCase().indexOf(q) !== -1;
  });
}
```
After Fuse search, group results by `cf_subcategory`. Apply the dynamic cap from UI-SPEC (10/7/5 rows depending on number of matching categories). The `r.item || r` guard handles both Fuse v6 and v7 result shapes.

---

### `css/search-overlay.css` (standalone stylesheet)

**Analog:** `css/catalog-subpage.css` lines 594-681 (subnav section) and lines 736-774 (cart drawer backdrop + animation)

**Subnav bar z-index and positioning context** (lines 596-603):
```css
.ingredient-subnav {
  position: sticky;
  top: var(--header-height, 80px);
  z-index: 190; /* below header z-index:200, above page content */
  background: var(--color-cream);
  border-bottom: 1px solid rgba(74, 111, 75, 0.2);
  padding: 0.5rem 0;
}
```
The overlay panel uses `position: absolute` relative to `.ingredient-subnav .container` (desktop) or `position: fixed; inset: 0` (mobile). The subnav container needs `position: relative` added in `search-overlay.css` to anchor the desktop dropdown. Do NOT modify `catalog-subpage.css` — add the `position: relative` override there.

**Search button enabled state** (lines 666-681 — current disabled state):
```css
.subnav-search-btn {
  flex-shrink: 0;
  margin-left: auto;
  background: none;
  border: none;
  padding: 8px;
  min-height: 44px;
  min-width: 44px;
  cursor: not-allowed;
  color: var(--color-muted, #5f5f5f);
  opacity: 0.5;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}
```
Override in `search-overlay.css` to enable:
```css
.subnav-search-btn {
  cursor: pointer;
  opacity: 1;
  transition: background 0.15s, color 0.15s;
}
.subnav-search-btn:hover,
.subnav-search-btn[aria-expanded="true"] {
  background: rgba(74, 111, 75, 0.1);
  color: var(--color-green);
}
.subnav-search-btn:focus-visible {
  outline: 2px solid var(--color-green);
  outline-offset: 2px;
}
```
These three rules override the base disabled state from `catalog-subpage.css`.

**Backdrop pattern** (lines 738-751):
```css
body.subpage-catalog .cart-drawer-backdrop {
  display: block;
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.4);
  z-index: 1100;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.3s, visibility 0.3s;
}
body.subpage-catalog .cart-drawer-backdrop.open {
  opacity: 1;
  visibility: visible;
}
```
For the search overlay backdrop, use the same `opacity + visibility` toggle pattern with z-index 195 (above subnav at 190, below cart FAB at 1050):
```css
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
```

**Desktop dropdown animation** — copy transition convention from cart drawer (lines 769-772):
```css
/* Cart drawer uses transform 0.3s ease — search panel uses shorter 180ms */
body.subpage-catalog .cart-drawer {
  transform: translateX(100%);
  transition: transform 0.3s ease;
}
body.subpage-catalog .cart-drawer.open {
  transform: translateX(0);
}
```
For the overlay dropdown panel (desktop), apply `opacity + translateY` at 180ms:
```css
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
```

**Stock badge pattern** (lines 571-582 from 16-catalog-subpage.js, CSS counterpart in catalog-subpage.css):
```css
.stock-badge { /* already defined in catalog-subpage.css */ }
.stock-badge--in  { background: var(--color-green); color: #fff; }
.stock-badge--out { background: var(--color-muted); color: #fff; }
```
The overlay result row badges reuse the existing `.stock-badge`, `.stock-badge--in`, `.stock-badge--out` classes already defined in `catalog-subpage.css`. No re-definition needed — these classes are available because `catalog-subpage.min.css` is always loaded before `search-overlay.css` on all 7 ingredient pages.

**prefers-reduced-motion** (from UI-SPEC accessibility contract):
```css
@media (prefers-reduced-motion: reduce) {
  .search-overlay-panel,
  .search-overlay-backdrop {
    transition: opacity 0.18s, visibility 0.18s;
    transform: none !important;
  }
}
```

---

### 7 Ingredient HTML Pages (HTML modify)

**Analog:** `products/grains.html` — the complete pattern for all 7 pages.

**Current disabled search button** (grains.html line 88-92):
```html
<button type="button" class="subnav-search-btn" aria-label="Search ingredients (coming soon)" title="Search coming soon" disabled>
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
</button>
```
Replace with (remove `disabled`, update `aria-label`, remove `title`):
```html
<button type="button" class="subnav-search-btn" aria-label="Open ingredient search">
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
</button>
```
This change is identical across all 7 pages.

**Current CSS loading** (grains.html lines 26-27):
```html
<link rel="stylesheet" href="../css/styles.min.css?v=mpshq381">
<link rel="stylesheet" href="../css/catalog-subpage.min.css?v=mpshq381">
```
Add `search-overlay.min.css` after `catalog-subpage.min.css`:
```html
<link rel="stylesheet" href="../css/styles.min.css?v=mpshq381">
<link rel="stylesheet" href="../css/catalog-subpage.min.css?v=mpshq381">
<link rel="stylesheet" href="../css/search-overlay.min.css?v=mpshq381">
```

**Current script loading** (grains.html lines 190-192):
```html
<script src="../js/sheets-config.js?v=dev"></script>
<script src="../js/main.min.js?v=mpshq381" defer></script>
<script src="../js/modules/16-catalog-subpage.min.js?v=mpshq381" defer></script>
```
Add `17-search-overlay.min.js` after `16-catalog-subpage.min.js`:
```html
<script src="../js/sheets-config.js?v=dev"></script>
<script src="../js/main.min.js?v=mpshq381" defer></script>
<script src="../js/modules/16-catalog-subpage.min.js?v=mpshq381" defer></script>
<script src="../js/modules/17-search-overlay.min.js?v=mpshq381" defer></script>
```

**hops.html difference** — hops.html loads `15-hops.min.js` instead of `16-catalog-subpage.min.js`, and also loads `hops.min.css`. The pattern is identical but both CSS and JS lines differ:
```html
<!-- hops.html — current (lines 73-75, 273-274) -->
<link rel="stylesheet" href="../css/styles.min.css?v=mpshq381">
<link rel="stylesheet" href="../css/hops.min.css?v=mpshq381">
<link rel="stylesheet" href="../css/catalog-subpage.min.css?v=mpshq381">
...
<script src="../js/main.min.js?v=mpshq381" defer></script>
<script src="../js/modules/15-hops.min.js?v=mpshq381" defer></script>
```
Add `search-overlay.min.css` after `catalog-subpage.min.css` and `17-search-overlay.min.js` after `15-hops.min.js` — same insertion point, different neighbor.

**ingredients-supplies.html** — this is the "All" page. Check whether it loads `16-catalog-subpage.min.js` or something else before inserting. The same pattern applies regardless.

---

### `package.json` (build scripts modify)

**Analog:** `package.json` lines 6-15 — existing cleancss and terser entries plus `stamp:pages` regex patterns.

**minify:css** (line 6) — current last entry:
```
... && cleancss -o css/catalog-subpage.min.css css/catalog-subpage.css
```
Append to the end of `minify:css`:
```
... && cleancss -o css/catalog-subpage.min.css css/catalog-subpage.css && cleancss -o css/search-overlay.min.css css/search-overlay.css
```

**minify:js** (line 8) — current last entry:
```
... && terser js/modules/16-catalog-subpage.js -o js/modules/16-catalog-subpage.min.js -c -m
```
Append to the end of `minify:js`:
```
... && terser js/modules/17-search-overlay.js -o js/modules/17-search-overlay.min.js -c -m
```

**stamp:pages** (line 15) — the regex-replace chain must grow by two entries. Existing pattern format:
```javascript
f=f.replace(/16-catalog-subpage\\.min\\.js\\?v=[^\\\"]+/g,'16-catalog-subpage.min.js?v='+v);
```
Add analogous entries for the new files:
```javascript
f=f.replace(/search-overlay\\.min\\.css\\?v=[^\\\"]+/g,'search-overlay.min.css?v='+v);
f=f.replace(/17-search-overlay\\.min\\.js\\?v=[^\\\"]+/g,'17-search-overlay.min.js?v='+v);
```
These replace calls must be inserted into the `.forEach()` body alongside the existing ones. The escaping convention is `\\.` for literal dot and `[^\\\"]+` for the version suffix — copy this exactly.

---

## Shared Patterns

### ES5 Style (applies to 17-search-overlay.js)
**Source:** All existing JS modules throughout `js/modules/`
**Rule:** Use `var` throughout — NO `let`, `const`, or arrow functions. All functions declared with `function` keyword. No template literals. This is a hard project rule (CLAUDE.md tech stack: "vanilla JS (ES5)").

### `_activeCartTab = 'ingredients'` Cart Routing
**Source:** `js/modules/16-catalog-subpage.js` line 842
```javascript
// MUST be first statement after guard — routes cart items to ingredients cart
_activeCartTab = 'ingredients';
```
**Apply to:** `js/modules/17-search-overlay.js` DOMContentLoaded init — must set `_activeCartTab = 'ingredients'` before any cart operations. This global variable routes `getCartKey()` calls to the `sv-cart-ingredients` storage key.

### `product-reserve-wrap` Renderer Contract
**Source:** `js/modules/11-cart.js` line 176, `js/modules/16-catalog-subpage.js` lines 592-598
```javascript
reserveWrap.className = 'product-reserve-wrap';
reserveWrap._reserveProduct = cartObj;
reserveWrap._reserveKey = productKey;
reserveWrap._reserveRenderer = renderer;
renderer(reserveWrap, cartObj, productKey);
```
**Apply to:** All inline cart buttons in 17-search-overlay.js result rows. These three private properties (`_reserveProduct`, `_reserveKey`, `_reserveRenderer`) are required for `refreshAllReserveControls()` to re-render cart controls when the cart is cleared.

### textContent vs innerHTML Safety
**Source:** `js/modules/16-catalog-subpage.js` line 549 (comment: "T-21-01: use textContent, never innerHTML for product data")
**Apply to:** All product name, price, description rendering in 17-search-overlay.js. Use `el.textContent = item.name` — never `el.innerHTML = item.name`. Use `escapeHTML()` only when building HTML strings for `.innerHTML` of wrapper elements.

### `reservation-changed` Event
**Source:** `js/modules/16-catalog-subpage.js` lines 982-986; `js/modules/11-cart.js` line 66
**Apply to:** 17-search-overlay.js — listen to `window` for `'reservation-changed'` to re-render any visible `product-reserve-wrap` elements inside the open overlay. This keeps inline cart button states in sync when items are added/removed from outside the overlay.

### CSS Custom Properties (Color Tokens)
**Source:** `css/styles.css :root` (lines 118-129, per UI-SPEC)
**Apply to:** `css/search-overlay.css` — use only `var(--color-cream)`, `var(--color-green)`, `var(--color-muted)`, `var(--color-text)`. No hardcoded hex values in new CSS (except the backdrop rgba which has no token equivalent).

### `?item=SKU` Deep-link Navigation
**Source:** `js/modules/02-utils.js` lines 5-38
```javascript
function handleDeepLinkedItem() {
  if (_deepLinkHandled) return;
  var sku = (new URLSearchParams(window.location.search)).get('item');
  if (!sku) return;
  var el = document.querySelector('[data-sku="' + sku + '"]');
  ...
}
```
**Apply to:** 17-search-overlay.js result row name link — clicking a result navigates to the correct category subpage URL with `?item={SKU}` appended. This causes the destination page's `handleDeepLinkedItem()` to open the detail panel automatically. The overlay does not call `handleDeepLinkedItem()` itself — it just constructs the correct URL. Navigation URLs follow the pattern: `/products/{category-slug}.html?item={encodeURIComponent(sku)}`.

### Category-to-URL Mapping
**Source:** subnav pills in `products/grains.html` lines 80-86
```html
<a href="ingredients-supplies.html" data-subnav="all">All</a>
<a href="hops.html"                 data-subnav="hops">Hops</a>
<a href="grains.html"               data-subnav="grains">Grains</a>
<a href="yeast.html"                data-subnav="yeast">Yeast</a>
<a href="additives.html"            data-subnav="additives">Additives</a>
<a href="packaging.html"            data-subnav="packaging">Packaging</a>
<a href="equipment.html"            data-subnav="equipment">Equipment</a>
```
The overlay must map `cf_subcategory` values from Zoho items to these page slugs for "View all X in [Category]" links and item name click-through URLs. Maintain a lookup object in 17-search-overlay.js:
```javascript
var CATEGORY_PAGE_MAP = {
  'Hops': 'hops.html',
  'Grains': 'grains.html',
  'Yeast': 'yeast.html',
  'Additives': 'additives.html',
  'Packaging': 'packaging.html',
  'Equipment': 'equipment.html'
};
```
Items whose `cf_subcategory` does not match any key fall into an "Other" group without a "View all" link.

---

## No Analog Found

All files have close analogs. No entries.

---

## Metadata

**Analog search scope:** `js/modules/`, `css/`, `products/`, `package.json`
**Files scanned:** `js/modules/16-catalog-subpage.js` (998 lines, full read), `js/modules/15-hops.js` (partial, lines 1-100 and 315-365), `js/modules/02-utils.js` (partial, lines 1-80), `js/modules/11-cart.js` (grep + lines 181-235), `css/catalog-subpage.css` (lines 594-800), `products/grains.html` (lines 24-27, 80-92, 185-193), `products/hops.html` (grep), `package.json` (full read)
**Pattern extraction date:** 2026-05-30
