# Phase 21: Shared Template & Build Infrastructure - Pattern Map

**Mapped:** 2026-05-28
**Files analyzed:** 5 new/modified files
**Analogs found:** 5 / 5

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `js/modules/16-catalog-subpage.js` | module (standalone) | request-response + CRUD | `js/modules/15-hops.js` | exact |
| `css/catalog-subpage.css` | style | — | `css/hops.css` | exact |
| `package.json` | config (build pipeline) | batch | `package.json` (existing scripts) | exact |
| `test-subpage.html` | test fixture (HTML) | — | `hops.html` | role-match |
| `tests/frontend/16-catalog-subpage.test.js` | test | — | `tests/frontend/15-hops.test.js` | exact |

---

## Pattern Assignments

### `js/modules/16-catalog-subpage.js` (standalone module, request-response + CRUD)

**Analog:** `js/modules/15-hops.js`

**Imports / module header pattern** (lines 1–28):
```javascript
// ===== Hop Catalog Module =====
// Standalone module (NOT in concat:js). Loads after main.min.js.
// Shared globals available: formatCurrency, escapeHTML, renderReserveControl,
// renderWeightControl, hasWeightConfig, setReservationQty, getReservedQty,
// trackEvent, Fuse, equalizeCardHeights, injectProductSchema, handleDeepLinkedItem

var _allHops = [];
var _hopsFuse = null;
var _activeFlavorFilters = [];
var _openPanel = null;
var _openCard = null;
var _hopsViewMode = 'cards';
var DESKTOP_BREAKPOINT = 768;

var MW_CACHE_KEY = 'sv-hops-mw';
var MW_CACHE_TS  = 'sv-hops-mw-ts';
var MW_CACHE_TTL = 3600000;
```

**Adaptation for 16-catalog-subpage.js:** Replace all hop-specific names with subpage-specific names. Use per-category cache keys derived from `SUBPAGE_CONFIG.categorySlug`. Add a `SUBPAGE_CONFIG` guard at the top of `DOMContentLoaded`. Avoid reusing `_openPanel`/`_openCard` — use `_subpageOpenPanel`/`_subpageOpenCard`.

```javascript
// ===== Catalog Subpage Module =====
// Standalone module (NOT in concat:js). Loads after main.min.js.
// Shared globals: formatCurrency, escapeHTML, renderReserveControl,
// renderWeightControl, hasWeightConfig, setReservationQty, getReservedQty,
// equalizeCardHeights, trackEvent, Fuse, handleDeepLinkedItem, injectProductSchema

var _allSubpageItems = [];
var _subpageFuse = null;
var _activeFilterGroups = [];
var _subpageViewMode = 'grid';
var _subpageSortMode = 'stock-first';
var _subpageOpenPanel = null;
var _subpageOpenCard = null;
var SUBPAGE_DESKTOP_BREAKPOINT = 768;
// Cache keys are set after SUBPAGE_CONFIG is available (inside DOMContentLoaded)
var MW_CACHE_KEY = '';
var MW_CACHE_TS  = '';
var MW_CACHE_TTL = 3600000;
```

**SUBPAGE_CONFIG guard** (insert at top of DOMContentLoaded handler):
```javascript
document.addEventListener('DOMContentLoaded', function () {
  if (typeof SUBPAGE_CONFIG === 'undefined') {
    console.error('[16-catalog-subpage] SUBPAGE_CONFIG not defined — module aborted.');
    return;
  }
  _activeCartTab = 'ingredients';  // MUST be first, before any render call
  MW_CACHE_KEY = 'sv-subpage-' + SUBPAGE_CONFIG.categorySlug + '-mw';
  MW_CACHE_TS  = 'sv-subpage-' + SUBPAGE_CONFIG.categorySlug + '-mw-ts';
  // ... rest of init
});
```

**localStorage cache pattern** (lines 210–223 of 15-hops.js):
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

**Data load with stale-while-revalidate** (lines 270–308 of 15-hops.js):
```javascript
function loadFromMiddleware() {
  var cached = getCachedMW();
  if (cached) {
    var promise = Promise.resolve(cached.data);
    if (!cached.fresh) {
      fetchFromMiddleware().then(setCachedMW).catch(function () {});
    }
    return promise;
  }
  return fetchFromMiddleware().then(function (items) {
    setCachedMW(items);
    return items;
  });
}

// Top-level: prefer middleware, fall back to snapshot
var dataPromise = middlewareUrl
  ? loadFromMiddleware().catch(function () { return loadFromSnapshot(); })
  : loadFromSnapshot();
```

**Prototype pollution guard in mapItem()** (lines 244–254 of 15-hops.js) — MUST be copied exactly:
```javascript
if (z.custom_fields && z.custom_fields.length) {
  z.custom_fields.forEach(function (cf) {
    var key = (cf.label || '').toLowerCase().replace(/\s+/g, '_');
    if (!key) return;
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') return;
    if (cf.value !== undefined && cf.value !== null) {
      obj[key] = String(cf.value);
    }
  });
}
```

**Error state with retry button** (lines 285–303 of 15-hops.js):
```javascript
function showError() {
  var catalog = document.getElementById('hops-catalog');
  if (catalog) {
    catalog.innerHTML = '';
    var errorDiv = document.createElement('div');
    errorDiv.className = 'catalog-error';
    var errorMsg = document.createElement('p');
    errorMsg.textContent = "Couldn't load hops right now. Refresh to try again.";
    var retryBtn = document.createElement('button');
    retryBtn.className = 'catalog-retry-btn btn-outline';
    retryBtn.type = 'button';
    retryBtn.textContent = 'Try again';
    retryBtn.addEventListener('click', function () { loadHops(callback); });
    errorDiv.appendChild(errorMsg);
    errorDiv.appendChild(retryBtn);
    catalog.appendChild(errorDiv);
  }
}
```
Adapt: replace `'hops-catalog'` with `SUBPAGE_CONFIG.catalogContainerId || 'subpage-catalog'` and the retry callback with `loadSubpageItems(callback)`.

**View toggle event wiring** (lines 424–445 of 15-hops.js):
```javascript
var viewBtns = document.querySelectorAll('.hops-toolbar .view-toggle-btn');
viewBtns.forEach(function (btn) {
  btn.addEventListener('click', function () {
    var view = btn.getAttribute('data-view');
    if (view === _hopsViewMode) return;
    _hopsViewMode = view;
    try { localStorage.setItem('hopsViewMode', view); } catch (e) {}
    viewBtns.forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-view') === view);
    });
    renderHops();
  });
});
```
Adapt: use `.subpage-toolbar .view-toggle-btn` selector, `_subpageViewMode`, and `renderCatalog()`.

**Sort + search wiring** (lines 411–422 of 15-hops.js):
```javascript
var searchInput = document.getElementById('hops-search');
if (searchInput) {
  var timer;
  searchInput.addEventListener('input', function () {
    clearTimeout(timer);
    timer = setTimeout(renderHops, 180);
  });
}
var sortSelect = document.getElementById('hops-sort');
if (sortSelect) {
  sortSelect.addEventListener('change', function () { renderHops(); });
}
```

**Filter pill rendering** (lines 340–393 of 15-hops.js — `buildHopFilterRow`):
```javascript
// Called once with container ID, field name, label, and values array
function buildHopFilterRow(containerId, field, label, values) {
  var container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  if (values.length === 0) { container.classList.add('hidden'); return; }
  container.classList.remove('hidden');

  // "All" button
  var allBtn = document.createElement('button');
  allBtn.className = 'catalog-filter-btn active';
  allBtn.type = 'button';
  allBtn.textContent = 'All';
  allBtn.setAttribute('data-value', 'All');
  allBtn.addEventListener('click', function () {
    _activeFlavorFilters = [];
    container.querySelectorAll('.catalog-filter-btn').forEach(function (b) { b.classList.remove('active'); });
    allBtn.classList.add('active');
    renderHops();
  });
  container.appendChild(allBtn);

  // Per-value buttons
  values.forEach(function (val) {
    var btn = document.createElement('button');
    btn.className = 'catalog-filter-btn';
    btn.type = 'button';
    btn.textContent = val;
    btn.setAttribute('data-value', val);
    btn.addEventListener('click', function () {
      var idx = _activeFlavorFilters.indexOf(val);
      if (idx !== -1) { _activeFlavorFilters.splice(idx, 1); }
      else { _activeFlavorFilters.push(val); }
      // update active states...
      renderHops();
    });
    container.appendChild(btn);
  });
}
```
Adapt: use `_activeFilterGroups` instead of `_activeFlavorFilters`; `values` come from `SUBPAGE_CONFIG.filterGroups[n].values`. If `SUBPAGE_CONFIG.filterGroups` is null or empty, skip pill rendering entirely.

**Render function core** (lines 1497–1595 of 15-hops.js):
```javascript
function renderHops() {
  closeHopPanel();
  var catalog = document.getElementById('hops-catalog');
  if (!catalog) return;

  // 1. Collect query + sort from DOM
  var query = document.getElementById('hops-search').value.trim();
  var sortVal = document.getElementById('hops-sort').value;

  // 2. Apply flavor filter
  var filtered = _hopGroups.slice();
  if (_activeFlavorFilters.length > 0) { /* filter */ }

  // 3. Apply search (Fuse or substring fallback)
  if (query && _hopsFuse) { /* fuse search */ }

  // 4. Sort (switch on sortVal)
  filtered.sort(function (a, b) { /* ... */ });

  // 5. Empty state
  catalog.innerHTML = '';
  if (filtered.length === 0) {
    var msg = document.createElement('p');
    msg.className = 'catalog-no-results';
    msg.textContent = 'No hops match your filters';
    /* ... */
    return;
  }

  // 6. Branch by view mode
  if (_hopsViewMode === 'table') {
    catalog.classList.remove('product-grid');
    catalog.appendChild(buildHopTable(filtered));
  } else {
    catalog.classList.add('product-grid');
    filtered.forEach(function (group) { catalog.appendChild(buildHopCard(group)); });
  }

  // 7. Equalize heights (always last)
  if (typeof equalizeCardHeights !== 'undefined') { equalizeCardHeights(); }
}
```

**Detail panel row insertion** (lines 493–513 of 15-hops.js):
```javascript
function findRowEnd(card, grid) {
  var cards = grid.querySelectorAll('.product-card');
  var top = card.offsetTop;
  var last = card;
  for (var i = 0; i < cards.length; i++) {
    if (cards[i].offsetTop === top) last = cards[i];
  }
  return last;
}

function getRowHeight(card, grid) {
  var cards = grid.querySelectorAll('.product-card');
  var top = card.offsetTop;
  var maxH = 0;
  for (var i = 0; i < cards.length; i++) {
    if (cards[i].offsetTop === top && cards[i].offsetHeight > maxH) {
      maxH = cards[i].offsetHeight;
    }
  }
  return maxH;
}
```
Used with `insertBefore(panel, rowEnd.nextSibling)` to place the detail panel below the grid row containing the clicked card. D-02 decision: use these functions unchanged, but the ghost-placeholder approach means the card stays in the grid while the panel is inserted as a full-span row after the row end.

**Cart object construction** (lines 679–714 of 08-catalog-ingredients.js):
```javascript
var ingredientForCart = {
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
  _item_type: 'ingredient',           // REQUIRED — routes to ingredients cart
  max_order_qty: item.max_order_qty || '',
  zoho_item_id: item.zoho_item_id || '',
  millable: item.millable || '',
  tax_percentage: item.tax_percentage != null ? item.tax_percentage : 0,
  tax_name: item.tax_name || ''
};
var reserveWrap = document.createElement('div');
reserveWrap.className = 'product-reserve-wrap';
var productKey = item.name + '|';
var renderer = hasWeightConfig(item) ? renderWeightControl : renderReserveControl;
reserveWrap._reserveProduct = ingredientForCart;
reserveWrap._reserveKey = productKey;
reserveWrap._reserveRenderer = renderer;
renderer(reserveWrap, ingredientForCart, productKey);
card.appendChild(reserveWrap);
```

**Stock badge pattern** (lines 667–677 of 08-catalog-ingredients.js):
```javascript
var stockVal = parseInt(item.stock, 10) || 0;
var badge = document.createElement('span');
badge.className = 'stock-badge';
if (stockVal > 0) {
  badge.classList.add('stock-badge--in');
  badge.textContent = 'In Stock';
} else {
  badge.classList.add('stock-badge--out');
  badge.textContent = 'Out of Stock';
}
card.appendChild(badge);
// Cart controls only appended when stockVal > 0
```

**Module.exports footer** (lines 1644–1651 of 15-hops.js):
```javascript
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    filterItemsByConfig: filterItemsByConfig,
    buildSortComparator: buildSortComparator,
    // ... other pure functions to be tested
  };
}
```

---

### `css/catalog-subpage.css` (standalone CSS, no data flow)

**Analog:** `css/hops.css`

**File header comment pattern** (line 1 of hops.css):
```css
/* Hops page -- hops.html */
```
Adapt: `/* Catalog Subpage -- 16-catalog-subpage.js, used by all category subpages */`

**Hero section pattern** (lines 84–119 of hops.css):
```css
.hops-hero {
  background: var(--color-green);
  color: var(--color-cream);
  text-align: center;
  padding: 5rem 0;
  margin-bottom: 0;
  position: relative;
  z-index: 2;
}
.hops-hero h1 { /* ... */ }
.hops-hero p  { /* ... */ }
```
Adapt: rename `.hops-hero` → `.subpage-hero`. Add support for `--subpage-accent` CSS custom property (injected via JS at init from `SUBPAGE_CONFIG.accentColor`). Reduce padding to ~150px total for D-05 medium hero.

**Toolbar / controls area** (lines 121–127 of hops.css):
```css
.hops-toolbar {
  background: var(--color-cream);
  padding: 1.5rem 2rem;
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  margin: 2rem 0 1.5rem;
}
```
Adapt: rename `.hops-toolbar` → `.subpage-toolbar`.

**Retry / error button** (lines 193–210 of hops.css):
```css
.catalog-retry-btn {
  display: inline-block;
  padding: 10px 24px;
  min-height: 44px;
  border: 2px solid var(--color-green);
  border-radius: 4px;
  background: transparent;
  color: var(--color-green);
  cursor: pointer;
  font-family: var(--font-body);
  font-size: 1rem;
  font-weight: 700;
  margin-top: 0.75rem;
}
.catalog-retry-btn:hover {
  background: var(--color-green);
  color: #fff;
}
```
Copy directly — `.catalog-retry-btn` is already namespaced to avoid conflict with `styles.css`.

**Loading placeholder** (lines 216–222 of hops.css):
```css
.hops-loading {
  grid-column: 1 / -1;
  text-align: center;
  padding: 3rem 1rem;
  color: var(--color-cream);
  font-size: 1rem;
}
```
Adapt: rename `.hops-loading` → `.subpage-loading`.

**Detail panel** (lines 447–482 of hops.css):
```css
.hop-detail-panel {
  grid-column: 1 / -1;
  background: var(--color-cream);
  border-top: 3px solid var(--color-burgundy);
  border-radius: 4px;
  box-shadow: 0 2px 16px rgba(0, 0, 0, 0.4);
  position: relative;
  z-index: 5;
  overflow: hidden;
  padding: 2rem;
}
```
Adapt: rename `.hop-detail-panel` → `.subpage-detail-panel`. Use `--subpage-accent` for border color instead of hardcoded `--color-burgundy`.

**Responsive breakpoints** (lines 808–846 of hops.css):
```css
@media (max-width: 768px) {
  .hops-hero { padding: 3rem 0; }
}
@media (max-width: 640px) {
  .hops-catalog-section .product-grid { grid-template-columns: 1fr; }
}
```
Adapt with `.subpage-hero` and `.subpage-catalog-section`. D-03 grid uses `auto-fill, minmax(250px, 1fr)` — override `styles.css` `.product-grid` within the subpage section.

**Product grid override** (lines 1505–1510 of styles.css — base rule):
```css
.product-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  align-items: start;
  gap: 2rem;
}
```
In `catalog-subpage.css`, scope a narrower override:
```css
.subpage-catalog-section .product-grid {
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  /* D-03: max 4 columns, falls back naturally via auto-fill */
}
```

**D-04 List view table pattern** (lines 848–922 of hops.css — `.hops-table`):
```css
.hops-table {
  border-collapse: collapse;
  width: 100%;
  font-size: 0.85rem;
  line-height: 1.3;
}
.hops-table th {
  text-align: left;
  text-transform: uppercase;
  /* ... */
}
```
Adapt: rename `.hops-table` → `.subpage-list-table`. D-04 columns: Name | Price | Stock | Add to Cart.

---

### `package.json` (build config, batch data flow)

**Analog:** `package.json` (existing scripts — no external analog needed)

**Current `minify:css` script** (line 6 of package.json):
```json
"minify:css": "cleancss -o css/styles.min.css css/styles.css && cleancss -o css/admin.min.css css/admin.css && ... && cleancss -o css/hops.min.css css/hops.css"
```
**Addition needed** — append at end of `minify:css`:
```
&& cleancss -o css/catalog-subpage.min.css css/catalog-subpage.css
```

**Current `minify:js` script** (line 8 of package.json):
```json
"minify:js": "npm run concat:js && terser js/main.js -o js/main.min.js -c -m && ... && terser js/modules/15-hops.js -o js/modules/15-hops.min.js -c -m"
```
**Addition needed** — append at end of `minify:js`:
```
&& terser js/modules/16-catalog-subpage.js -o js/modules/16-catalog-subpage.min.js -c -m
```

**Current `stamp:pages` script** (line 15 of package.json):
```json
"stamp:pages": "node -e \"const fs=require('fs');const v=Date.now().toString(36);['products.html',...,'hops.html'].forEach(function(p){let f=fs.readFileSync(p,'utf8');f=f.replace(/styles\\.min\\.css\\?v=[^\\\"]+/g,'styles.min.css?v='+v);...;f=f.replace(/15-hops\\.min\\.js\\?v=[^\\\"]+/g,'15-hops.min.js?v='+v);fs.writeFileSync(p,f);});console.log('...');\"",
```
**Additions needed:**
1. Add `'test-subpage.html'` to the files array
2. Add two new regex replacements inside the `.forEach` loop:
   - `f=f.replace(/catalog-subpage\\.min\\.css\\?v=[^\\"]+/g,'catalog-subpage.min.css?v='+v);`
   - `f=f.replace(/16-catalog-subpage\\.min\\.js\\?v=[^\\"]+/g,'16-catalog-subpage.min.js?v='+v);`

**Stamp pattern convention** (from existing scripts — `stamp:admin` line 11, `stamp:kiosk` line 12):
- Token: `Date.now().toString(36)` — base-36 timestamp
- Regex per pattern: `/filename\\.min\\.ext\\?v=[^\\"]+/g`
- Replacement: `'filename.min.ext?v='+v`

---

### `test-subpage.html` (test fixture HTML, no data flow)

**Analog:** `hops.html` (structure) — not read in full; pattern derived from CONTEXT.md and RESEARCH.md

**Load order pattern** (canonical from CONTEXT.md code_context):
```html
<!-- 1. Inline config — BEFORE main.min.js -->
<script>
window.SUBPAGE_CONFIG = {
  categorySlug: 'test',
  categoryName: 'Test Category',
  heroDescription: 'Short description.',
  heroDescriptionFull: 'Longer SEO paragraph.',
  accentColor: '#3d6b2c',
  subcategories: ['Grain'],
  types: [],
  filterGroups: null
};
</script>

<!-- 2. Shared globals -->
<script src="js/sheets-config.js?v=..."></script>
<script src="js/main.min.js?v=..."></script>

<!-- 3. Standalone module CSS -->
<link rel="stylesheet" href="css/catalog-subpage.min.css?v=...">

<!-- 4. Standalone module JS — last -->
<script src="js/modules/16-catalog-subpage.min.js?v=..."></script>
```

**Required HTML structure** (minimum for module to initialize):
```html
<div class="subpage-hero">
  <h1><!-- populated by JS from SUBPAGE_CONFIG.categoryName --></h1>
  <p class="subpage-hero-desc"><!-- SUBPAGE_CONFIG.heroDescription --></p>
  <!-- "Read more" toggle for heroDescriptionFull -->
</div>

<div class="subpage-toolbar">
  <!-- search input, sort select, view toggle buttons -->
  <div id="subpage-filter-row"><!-- filter pills injected here --></div>
</div>

<div id="subpage-catalog" class="subpage-catalog-section">
  <!-- product grid rendered here by JS -->
</div>
```

---

### `tests/frontend/16-catalog-subpage.test.js` (Jest unit test)

**Analog:** `tests/frontend/15-hops.test.js`

**File structure pattern** (lines 1–10 of 15-hops.test.js):
```javascript
var hops = require('../../js/modules/15-hops.js');

describe('groupHopsByVariant', function () {
  test('groups two size variants by name stem', function () {
    var items = [ /* ... */ ];
    var groups = hops.groupHopsByVariant(items);
    expect(groups).toHaveLength(2);
    // ...
  });
});
```
Adapt:
```javascript
var subpage = require('../../js/modules/16-catalog-subpage.js');

describe('filterItemsByConfig', function () {
  test('includes items matching subcategory', function () {
    var items = [{ price_per_unit: '10.00', cf_subcategory: 'Grain', cf_type: '' }];
    var config = { subcategories: ['Grain'], types: [] };
    expect(subpage.filterItemsByConfig(items, config)).toHaveLength(1);
  });

  test('excludes items with price <= 0', function () { /* ... */ });
  test('includes items matching types[] when subcategories miss', function () { /* ... */ });
  test('returns empty array when no items match', function () { /* ... */ });
  test('returns empty for empty items array', function () { /* ... */ });
});

describe('buildSortComparator', function () { /* ... */ });
```

**Test convention:** Pure functions only — no DOM, no fetch mocks, no `document`. Functions that require DOM (render functions) are not exported and not tested at unit level. The exports block in the module determines what is testable.

---

## Shared Patterns

### `_activeCartTab` Initialization
**Source:** `js/modules/11-cart.js` (global variable), pattern from `js/modules/08-catalog-ingredients.js` line 280
**Apply to:** `js/modules/16-catalog-subpage.js` — first statement inside `DOMContentLoaded`
```javascript
document.addEventListener('DOMContentLoaded', function () {
  _activeCartTab = 'ingredients';  // Must be first — before any render
  // ...
});
```

### Error / Loading State
**Source:** `js/modules/15-hops.js` lines 285–303; `css/hops.css` lines 193–222
**Apply to:** `js/modules/16-catalog-subpage.js` + `css/catalog-subpage.css`
- Loading: set `catalog.innerHTML = '<div class="subpage-loading"><p>Loading...</p></div>'` at top of `DOMContentLoaded`
- Error: `catalog-error` div + `catalog-retry-btn` button with retry callback
- Empty results: `.catalog-no-results` + `.catalog-no-results-sub` paragraphs (class names already in `styles.css` line 2070)

### Cart Object Shape (ingredient routing)
**Source:** `js/modules/08-catalog-ingredients.js` lines 679–713
**Apply to:** `js/modules/16-catalog-subpage.js` card builder
- `_item_type: 'ingredient'` is mandatory — routes to `sv-cart-ingredients` via `getCartKey()`
- `reserveWrap._reserveProduct`, `._reserveKey`, `._reserveRenderer` must all be set for `refreshAllReserveControls()` to work

### Prototype Pollution Guard
**Source:** `js/modules/15-hops.js` lines 244–254
**Apply to:** `js/modules/16-catalog-subpage.js` `mapItem()` function
```javascript
if (key === '__proto__' || key === 'constructor' || key === 'prototype') return;
```

### Build Script Stamp Regex Convention
**Source:** `package.json` lines 11–15 (`stamp:admin`, `stamp:kiosk`, `stamp:pages`)
**Apply to:** `package.json` `stamp:pages` additions
- Token: `Date.now().toString(36)`
- Pattern: `/filename\\.min\\.ext\\?v=[^\\"]+/g`
- New patterns needed: `catalog-subpage\\.min\\.css` and `16-catalog-subpage\\.min\\.js`

### CSS Custom Property Palette
**Source:** `css/styles.css` (`:root`, approximate lines 118–129 per RESEARCH.md)
**Apply to:** `css/catalog-subpage.css`
Available variables: `--color-green`, `--color-brown`, `--color-burgundy`, `--color-cream`, `--color-gold`, `--color-text`
New variable injected by JS: `--subpage-accent` (set on `document.body` via `style.setProperty`)

### `equalizeCardHeights()` Call Order
**Source:** `js/modules/15-hops.js` line 1594–1595; `js/modules/08-catalog-ingredients.js` line 381
**Apply to:** `js/modules/16-catalog-subpage.js` `renderCatalog()` — always call last, after all cards are in DOM
```javascript
if (typeof equalizeCardHeights !== 'undefined') {
  equalizeCardHeights();
}
```

---

## No Analog Found

All files have close analogs. No entries in this section.

---

## Anti-Patterns (from RESEARCH.md — planner must enforce)

| Anti-Pattern | Risk | Mitigation |
|---|---|---|
| Reusing `_openPanel` / `_openCard` global names | Conflict if hops.js is ever co-loaded | Use `_subpageOpenPanel` / `_subpageOpenCard` |
| Reusing `catalogViewMode` from 05-catalog-view.js | Cross-contamination with main tab catalog | Use `_subpageViewMode` |
| Setting `_activeCartTab` after any render call | Items route to ferment cart | First line of DOMContentLoaded |
| Calling `renderIngredients()` global | Wrong container ID (`product-catalog`), wrong filter state | Use module's own `renderCatalog()` |
| Hardcoding subcategory names in 16-catalog-subpage.js | All filtering must go through `SUBPAGE_CONFIG` | `filterItemsByConfig(items, SUBPAGE_CONFIG)` |
| Calling `equalizeCardHeights()` inside forEach loop | Reads offsetTop before layout is complete | Call once at end of render function |
| Stamp regex missing new file patterns | Cache token never updates on build | Add both CSS and JS patterns to `stamp:pages` |

---

## Metadata

**Analog search scope:** `js/modules/`, `css/`, `tests/frontend/`, `package.json`
**Files scanned:** 6 source files read (`15-hops.js`, `08-catalog-ingredients.js`, `hops.css`, `styles.css`, `package.json`, `15-hops.test.js`)
**Pattern extraction date:** 2026-05-28
