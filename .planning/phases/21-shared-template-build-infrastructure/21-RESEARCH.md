# Phase 21: Shared Template & Build Infrastructure - Research

**Researched:** 2026-05-28
**Domain:** Vanilla JS ES5 module authoring, CSS standalone patterns, build pipeline integration
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Card Design & Layout**
- D-01: Expandable detail cards — click to expand shows description, weight options, stock count. Not the radar-chart complexity of hops, but richer than plain product cards.
- D-02: Expanded card opens as a full-width detail row below the grid row. The original card position becomes a ghost/placeholder. Other cards remain visible and undisturbed.
- D-03: Responsive CSS grid with `auto-fill`, min card width ~250px, max 4 columns. Naturally drops to 3/2/1 as viewport narrows.
- D-04: List view uses compact table rows: Name | Price | Stock | Add to Cart. Dense and scannable.

**Hero & Accent Colors**
- D-05: Medium hero section (~150px) with category name, short visible description, and "Read more" toggle for SEO paragraph. Products visible immediately without scrolling.
- D-06: Colors derived from existing site palette but each category gets a unique undertone/accent color. Accent colors defined in `SUBPAGE_CONFIG`.

**Sort & Filter Controls**
- D-07: Three sort options: Name (A-Z / Z-A), Price (low-high / high-low), In Stock first. Universal across all categories.
- D-08: Basic sub-filter pills where natural groupings exist in the data. `SUBPAGE_CONFIG` can define optional `filterGroups` per category.

**Data Loading**
- D-09: Single fetch from `/api/ingredients`, filter client-side by category values in `SUBPAGE_CONFIG`. Cache in localStorage (same pattern as hops page).

### Claude's Discretion
- Category-to-filter mapping logic: exact `SUBPAGE_CONFIG` data structure
- Specific accent color hex values per category
- Build pipeline integration details (which npm scripts to add/modify)
- Out-of-stock indicator design (badge, opacity, label)
- Empty category message wording and layout

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TPL-01 | A shared standalone JS module renders product cards, filters, sort, search, and cart controls on any category subpage — parameterized by a per-page config object | SUBPAGE_CONFIG data structure design + 15-hops.js pattern |
| TPL-02 | Each subpage has a simple hero section with a unique accent color and category heading | CSS custom property injection pattern from SUBPAGE_CONFIG |
| TPL-03 | Users can toggle between grid and list view on any subpage | Established view toggle pattern from 05-catalog-view.js / 15-hops.js |
| TPL-04 | Out-of-stock items show a clear indicator; empty categories show a friendly message | Existing stock-badge pattern in 08-catalog-ingredients.js |
| BUILD-01 | All subpages are integrated into the build pipeline (minify CSS/JS, cache-bust stamps, sitemap entries) | package.json terser/cleancss/stamp patterns |
</phase_requirements>

---

## Summary

Phase 21 is a pure codebase addition — no new npm packages, no middleware changes. It creates one new standalone JS module (`js/modules/16-catalog-subpage.js`) and one new CSS file (`css/catalog-subpage.css`), then integrates both into the existing build pipeline.

The project already has a textbook analog in `js/modules/15-hops.js` and `css/hops.css`: a standalone ES5 module that loads after `main.min.js`, uses the `DOMContentLoaded` pattern, caches via localStorage, renders product cards with detail expansion panels, and supports grid/list view toggling. Phase 21 follows this pattern exactly, but instead of being hardcoded to hops it reads all behavior from a `window.SUBPAGE_CONFIG` object that each future category page will define.

The key design challenge is the detail panel: unlike hops (which opens a panel inline that can cover neighboring cards), the decision is to insert the expanded panel as a **full-width row below the grid row**, using `insertBefore(panel, rowEnd.nextSibling)` — the exact mechanism already in `15-hops.js` lines 1251-1257. The ghost placeholder approach (D-02) means the card stays in place visually and the panel grows below the row.

The build pipeline requires four concrete edits to `package.json`: add `catalog-subpage.css` to `minify:css`, add `16-catalog-subpage.js` to `minify:js` (terser), and extend `stamp:pages` to also stamp the test subpage HTML file that Phase 21 delivers.

**Primary recommendation:** Clone the 15-hops.js + hops.css pattern. Replace all hop-specific logic with config-driven dispatch from `SUBPAGE_CONFIG`. Use `insertBefore` after row-end for the detail panel. Ship one test HTML page alongside the module.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Data loading / caching | Browser / Client | — | localStorage cache + fetch to middleware, no SSR |
| Product grid rendering | Browser / Client | — | DOM manipulation from JS, not server-rendered |
| Cart integration | Browser / Client | — | Shared globals from main.min.js (renderReserveControl, etc.) |
| Sort / filter state | Browser / Client | — | All in-memory, re-renders on change |
| Hero accent color | Browser / Client | — | CSS custom property set via JS at init from SUBPAGE_CONFIG |
| Build minification | Build pipeline | — | terser (JS) + cleancss (CSS) in package.json scripts |
| Cache-bust stamping | Build pipeline | — | `stamp:pages` inline Node.js script in package.json |

---

## Standard Stack

### Core (no new packages needed)

| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| terser | ^5.31.0 | Minify JS | Already in devDependencies [VERIFIED: package.json] |
| clean-css-cli | ^5.6.3 | Minify CSS | Already in devDependencies [VERIFIED: package.json] |
| Node.js inline script | stdlib | Stamp cache-bust tokens | Pattern already used in all stamp:* scripts [VERIFIED: package.json] |

No new npm packages are required for Phase 21. All functionality uses:
- Shared globals already exposed by `main.min.js` at runtime (`renderReserveControl`, `renderWeightControl`, `hasWeightConfig`, `formatCurrency`, `escapeHTML`, `equalizeCardHeights`, `trackEvent`, `handleDeepLinkedItem`, `injectProductSchema`, `Fuse`)
- Existing localStorage caching pattern
- Existing CSS custom properties (`--color-green`, `--color-brown`, `--color-burgundy`, `--color-cream`, `--color-gold`, `--color-text`) [VERIFIED: css/styles.css line 118-129]

### Supporting (already vendored)

| Library | Source | Purpose | Note |
|---------|--------|---------|------|
| Fuse.js v7.1.0 | Vendored in project | Fuzzy search | Available as global `Fuse` after main.min.js loads [ASSUMED — version from CONTEXT.md/STATE.md; not re-verified in this session] |

---

## Package Legitimacy Audit

> No new external packages are installed in this phase. All tooling is already in `devDependencies`.

| Package | Registry | Status | Disposition |
|---------|----------|--------|-------------|
| terser | npm | Already installed | Approved — in use |
| clean-css-cli | npm | Already installed | Approved — in use |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

---

## Architecture Patterns

### System Architecture Diagram

```
HTML subpage (e.g. products/grains.html)
   |
   +-- <script> window.SUBPAGE_CONFIG = { ... }  (inline, before module)
   |
   +-- <script src="js/main.min.js">              (shared globals loaded)
   |
   +-- <script src="js/modules/16-catalog-subpage.min.js">
            |
            DOMContentLoaded
            |
            +-- loadSubpageItems()
            |       |
            |       +-- localStorage cache hit? --> resolve items immediately
            |       |                               (stale-while-revalidate if expired)
            |       |
            |       +-- No cache: fetch /api/ingredients
            |       |       |
            |       |       +-- success: filter by SUBPAGE_CONFIG.subcategories / types
            |       |       |           save to localStorage
            |       |       |
            |       |       +-- fail: loadFromSnapshot() [/content/zoho-snapshot.json]
            |       |
            |       +-- items ready --> buildFilters() + wireEvents() + renderCatalog()
            |
            renderCatalog()
            |
            +-- viewMode === 'grid' --> renderGridView(items)
            |       |
            |       +-- for each item: buildItemCard(item)
            |               |
            |               +-- [in-stock]: renderReserveControl / renderWeightControl
            |               +-- [out-of-stock]: stock-badge--out indicator
            |               +-- [detail toggle click] --> insertDetailPanelAfterRow()
            |
            +-- viewMode === 'list' --> buildListTable(items)
                    |
                    +-- compact rows: Name | Price | Stock | Add to Cart
                    +-- row click (not on cart control) --> toggle .table-detail-row
```

### Recommended File Structure

```
js/modules/
├── 16-catalog-subpage.js       # new — source
├── 16-catalog-subpage.min.js   # new — build artifact (terser)
css/
├── catalog-subpage.css         # new — source
├── catalog-subpage.min.css     # new — build artifact (cleancss)
products/
├── grains.html                 # Phase 22 (out of scope here)
tests/
└── frontend/
    └── 16-catalog-subpage.test.js  # new — pure function tests
```

The test HTML page for Phase 21's success criterion SC-1 is a throwaway integration test, not a permanent page. It can be `test-subpage.html` at the project root (excluded from sitemap, not stamped in pages list by default).

### Pattern 1: SUBPAGE_CONFIG Object Structure

**What:** Each HTML category page defines this before loading the module. The module reads it at init.
**When to use:** Every page that uses `16-catalog-subpage.js`.

```javascript
// Source: designed from CONTEXT.md D-09 + existing hops pattern [ASSUMED - new design]
window.SUBPAGE_CONFIG = {
  // Category identity
  categorySlug: 'grains',        // used for localStorage key uniqueness
  categoryName: 'Grains',        // displayed in hero h1

  // Hero content
  heroDescription: 'Short visible description here.',  // always shown
  heroDescriptionFull: 'Longer SEO paragraph...',      // hidden, toggled by "Read more"

  // Accent color: CSS custom property injected on <body> or hero element
  accentColor: '#6b4c2a',        // ASSUMED hex — Claude discretion per D-06

  // Item filtering: items from /api/ingredients are included if their
  // cf_subcategory matches any entry in subcategories[] OR
  // their cf_type (for Equipment/Packaging items) matches any entry in types[]
  // At least one array must be non-empty.
  subcategories: ['Grain', 'Malt Extract'],   // matches cf_subcategory field
  types: [],                                  // matches cf_type field (Equipment, Packaging, etc.)

  // Optional sub-filter pills (D-08)
  // If null or empty, filter pills are not rendered
  filterGroups: [
    { label: 'Base Malts',      values: ['Base Malt'] },
    { label: 'Specialty Malts', values: ['Specialty Malt', 'Roasted Malt'] }
  ],

  // Optional: container element ID override (defaults to 'subpage-catalog')
  catalogContainerId: 'subpage-catalog'
};
```

**Field notes:**
- `subcategories` maps to `cf_subcategory` on item objects (set during Phase 20)
- `types` maps to `cf_type` on item objects (Equipment, Packaging, Cleaning/Sanitization)
- Both arrays are OR-matched: an item passes if it matches any subcategory OR any type
- `filterGroups` further sub-divides the already-filtered set — values are still `cf_subcategory` values
- Accent color is injected as a CSS custom property: `document.body.style.setProperty('--subpage-accent', config.accentColor)`

### Pattern 2: localStorage Cache Key Convention

**What:** Each subpage has its own cache key to avoid cross-contamination.
**When to use:** In `loadSubpageItems()` function.

```javascript
// Source: adapted from 15-hops.js lines 27-28 and 08-catalog-ingredients.js lines 31-33 [VERIFIED: codebase]
var MW_CACHE_KEY = 'sv-subpage-' + SUBPAGE_CONFIG.categorySlug + '-mw';
var MW_CACHE_TS  = 'sv-subpage-' + SUBPAGE_CONFIG.categorySlug + '-mw-ts';
var MW_CACHE_TTL = 3600000; // 1 hour, same as hops
```

**Note:** The underlying data (all ingredients) can be fetched once and stored under a shared key if desired, but using per-category keys is simpler and prevents one category's stale cache from affecting another.

### Pattern 3: Detail Panel Row Insertion

**What:** When a card's "Details" button is clicked on desktop, insert a full-width panel after the last card in the same grid row.
**When to use:** On desktop (>= 768px), in grid view.

```javascript
// Source: 15-hops.js lines 1242-1258 [VERIFIED: codebase]
function openDetailPanel(card, item) {
  closeDetailPanel();
  var grid = card.parentNode;
  var rowEnd = findRowEnd(card, grid);      // last card in same grid row by offsetTop
  var rowHeight = getRowHeight(card, grid);
  var gap = parseFloat(getComputedStyle(grid).rowGap) || 0;
  var panel = buildDetailPanel(item);
  panel.style.marginTop = '-' + (rowHeight + gap) + 'px';
  panel.style.minHeight = rowHeight + 'px';
  rowEnd.parentNode.insertBefore(panel, rowEnd.nextSibling);
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  _openPanel = panel;
  _openCard = card;
  card.classList.add('subpage-card--active');
}
```

**Mobile behavior:** On mobile (< 768px), use an accordion inside the card instead (same as hops mobile pattern with `max-height` CSS transition).

### Pattern 4: Cart Object Construction

**What:** The cart integration functions (`renderReserveControl`, `renderWeightControl`) require a specific object shape. This is identical across hops and ingredients modules.
**When to use:** When building any product card with cart controls.

```javascript
// Source: 08-catalog-ingredients.js lines 679-713, 15-hops.js lines 1341-1363 [VERIFIED: codebase]
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
    _item_type: 'ingredient',    // REQUIRED: routes to ingredients cart
    max_order_qty: item.max_order_qty || '',
    zoho_item_id: item.zoho_item_id || '',
    millable: item.millable || '',
    tax_percentage: item.tax_percentage != null ? item.tax_percentage : 0,
    tax_name: item.tax_name || ''
  };
}
```

**Critical:** `_item_type: 'ingredient'` must be set or the item will route to the ferment cart.

### Pattern 5: Build Pipeline Integration

**What:** Adding new standalone CSS/JS files to the existing `npm run build` chain.
**When to use:** Once per new standalone module.

```json
// Source: package.json — existing patterns [VERIFIED: package.json]
// Additions needed in each script:

// minify:css — add at end:
"&& cleancss -o css/catalog-subpage.min.css css/catalog-subpage.css"

// minify:js — add at end of terser chain:
"&& terser js/modules/16-catalog-subpage.js -o js/modules/16-catalog-subpage.min.js -c -m"

// stamp:pages — add the test HTML page to the files array.
// Phase 22 will add actual subpages (grains.html, yeast.html, etc.) to this list.
// stamp:pages also needs to handle the new file patterns:
//   catalog-subpage.min.css?v=
//   16-catalog-subpage.min.js?v=
```

**Note:** `stamp:pages` uses `Date.now().toString(36)` as the version token and replaces `?v=<old>` with `?v=<new>` via regex on each file in the array. Phase 21 adds only the test page to the files array. Phase 22 adds the real subpages.

### Pattern 6: Module Init Footer (export for tests)

**What:** Every standalone module ends with a Node.js module.exports guard so pure functions can be unit tested.
**When to use:** End of every standalone module.

```javascript
// Source: 15-hops.js lines 1644-1651 [VERIFIED: codebase]
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    filterItemsByConfig: filterItemsByConfig,
    buildSortComparator: buildSortComparator,
    // ... other pure functions
  };
}
```

### Anti-Patterns to Avoid

- **Global variable collision:** Don't reuse `_openPanel` / `_openCard` — give the module its own `_subpageOpenPanel` / `_subpageOpenCard` to prevent conflicts if the module is ever loaded alongside hops.js (unlikely but clean).
- **Re-using `catalogViewMode` global:** The `05-catalog-view.js` `catalogViewMode` variable is scoped to the main tab catalog. The subpage module should use its own `_subpageViewMode` variable.
- **Modifying `_activeCartTab` late:** Must set `_activeCartTab = 'ingredients'` at the TOP of the DOMContentLoaded handler, before any render call. If a render runs before this is set, the main catalog's guard (`if (_activeCartTab !== 'ingredients') return;`) won't help the subpage.
- **Using `renderIngredients()` global:** The subpage module must NOT call `renderIngredients()` from 08-catalog-ingredients.js — that function has its own catalog container ID (`product-catalog`) and filter state. Use the subpage module's own render function.
- **Hardcoding category values:** All filtering must route through `SUBPAGE_CONFIG` — no fallback hardcoded subcategory names in 16-catalog-subpage.js.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Grid/list view toggle | Custom toggle logic | Pattern from `05-catalog-view.js` `syncToggleButtons()` | Identical behavior needed, same HTML structure |
| Card height equalization | Custom row height scan | `equalizeCardHeights()` shared global | Already handles rAF batching, resize events |
| Deep-link scrolling | Custom URL param parser | `handleDeepLinkedItem()` shared global | Already handles `?item=SKU`, table rows, cards |
| Product schema injection | Custom JSON-LD | `injectProductSchema(item, 'ingredient')` shared global | Already handles Product schema, avoids duplicates |
| Weight-based cart control | Custom weight input | `hasWeightConfig(item)` + `renderWeightControl()` | Already handles kg/g, float drift prevention |
| Fuzzy search | Custom substring search | `new Fuse(items, { keys: [...] })` global Fuse instance | Already vendored, threshold tuned for product names |
| LocalStorage error handling | Custom try/catch | Pattern from `11-cart.js` memory fallback | Already handles iOS private browsing quota errors |
| Cart routing | Check `_item_type` manually | Set `_item_type: 'ingredient'` on cart object | `getCartKey()` in 11-cart.js handles routing |

**Key insight:** Virtually every helper the subpage needs already exists as a shared global in `main.min.js`. The subpage module is "just" wiring these helpers together with a config object, not building new infrastructure.

---

## Common Pitfalls

### Pitfall 1: `_activeCartTab` Must Be Set First

**What goes wrong:** If any cart-related global function runs before `_activeCartTab = 'ingredients'` is set, the item will route to the ferment cart (FERMENT_CART_KEY). On page reload with items in cart, the sidebar will show the wrong cart.
**Why it happens:** `_activeCartTab` defaults to `'kits'` in `11-cart.js`. The subpage module loads after main.min.js but DOMContentLoaded fires once — the order of statements matters.
**How to avoid:** First statement inside `document.addEventListener('DOMContentLoaded', function () { _activeCartTab = 'ingredients'; ... })`.
**Warning signs:** Cart sidebar shows 0 items even after adding ingredients; items appear in ferment cart instead.

### Pitfall 2: Stale `rowEnd` After DOM Mutation

**What goes wrong:** If `openDetailPanel()` is called while another panel is still open (i.e., `closeDetailPanel()` runs and removes a DOM node), `findRowEnd()` may return a stale reference.
**Why it happens:** `findRowEnd()` queries `grid.querySelectorAll('.product-card')` — if the grid has orphaned nodes during panel close animation, the query may miss cards.
**How to avoid:** Always call `closeDetailPanel()` before `findRowEnd()`, synchronously, with no animation delay. Confirm the panel is removed from the DOM (check `_openPanel.parentNode`) before querying row ends.
**Warning signs:** Panel inserted at wrong position; double panels appearing.

### Pitfall 3: `SUBPAGE_CONFIG` Not Defined

**What goes wrong:** If the HTML page loads `16-catalog-subpage.min.js` without a preceding `<script>` block defining `window.SUBPAGE_CONFIG`, the module will throw a ReferenceError silently swallowed by the DOMContentLoaded wrapper.
**Why it happens:** Config is expected as a global before the module initializes.
**How to avoid:** Guard at module top: `if (typeof SUBPAGE_CONFIG === 'undefined') { console.error('SUBPAGE_CONFIG not defined'); return; }`. Load order in HTML: config script → main.min.js → 16-catalog-subpage.min.js.
**Warning signs:** Blank catalog container with no error message visible.

### Pitfall 4: Build Script Regex Doesn't Match New File Patterns

**What goes wrong:** `stamp:pages` script uses literal regex patterns like `/catalog-subpage\.min\.css\?v=[^"]+/g` — if the file is added to the HTML but the stamp script regex doesn't cover it, the cache-bust token never updates.
**Why it happens:** The stamp scripts are regex-per-pattern (not generic), as seen in the existing `stamp:pages` script that has separate replacements for `styles.min.css`, `main.min.js`, `labels.min.css`, etc.
**How to avoid:** After adding the HTML `<link>` and `<script>` tags, immediately add the corresponding regex replacements to `stamp:pages`.
**Warning signs:** `npm run build` completes without error but the version token in the HTML never changes.

### Pitfall 5: `equalizeCardHeights()` Called Before Layout

**What goes wrong:** If called synchronously during or immediately after DOM insertion, the function reads `offsetTop` values before the browser has laid out the grid, producing incorrect row groupings.
**Why it happens:** The function internally uses `requestAnimationFrame` to batch writes, but the initial read pass (`offsetTop`) must happen after layout.
**How to avoid:** Call `equalizeCardHeights()` at the end of the render function (same as existing usage in `renderIngredients()` and `renderHops()`). Never call it inside a `forEach` loop on individual cards.
**Warning signs:** Card heights not equalized; cards in the same row have different heights.

### Pitfall 6: Subcategory Filtering Includes Items from Wrong Category

**What goes wrong:** Because the API returns ALL ingredients, filtering `cf_subcategory === 'Grain'` will also pick up any item whose subcategory was set incorrectly in Zoho. Phase 20 verified 100% coverage — but new items added after Phase 20 may lack subcategory assignment.
**Why it happens:** Data quality depends on ongoing Zoho data hygiene.
**How to avoid:** In `filterItemsByConfig()`, also require price > 0 (already done in 08-catalog-ingredients.js line 112). Consider logging a console.warn for items in the API response that have no subcategory and no type.
**Warning signs:** Items from other categories appearing on the Grains page.

---

## Code Examples

### Module Header (standalone ES5 pattern)

```javascript
// Source: 15-hops.js lines 1-6 [VERIFIED: codebase]
// ===== Catalog Subpage Module =====
// Standalone module (NOT in concat:js). Loads after main.min.js.
// Shared globals available: formatCurrency, escapeHTML, renderReserveControl,
// renderWeightControl, hasWeightConfig, setReservationQty, getReservedQty,
// equalizeCardHeights, trackEvent, Fuse, handleDeepLinkedItem, injectProductSchema

var _allSubpageItems = [];
var _subpageFuse = null;
var _activeFilterGroups = [];  // currently active sub-filter values
var _subpageViewMode = 'grid'; // 'grid' or 'list'
var _subpageSortMode = 'stock-first'; // default sort
var _subpageOpenPanel = null;
var _subpageOpenCard = null;
var SUBPAGE_DESKTOP_BREAKPOINT = 768;
```

### filterItemsByConfig (pure function, exportable for tests)

```javascript
// Source: designed from 15-hops.js filter logic and CONTEXT.md D-09 [ASSUMED - new design]
function filterItemsByConfig(items, config) {
  return items.filter(function (item) {
    var price = parseFloat(item.price_per_unit || '0') || 0;
    if (price <= 0) return false;
    var subcat = (item.subcategory || item.cf_subcategory || '').trim();
    var type = (item.type || item.cf_type || '').trim();
    if (config.subcategories && config.subcategories.length > 0) {
      if (config.subcategories.indexOf(subcat) !== -1) return true;
    }
    if (config.types && config.types.length > 0) {
      if (config.types.indexOf(type) !== -1) return true;
    }
    return false;
  });
}
```

### Hero accent color injection

```javascript
// Source: designed from CONTEXT.md D-06 [ASSUMED - new design]
function applyHeroAccent(config) {
  if (config.accentColor) {
    document.body.style.setProperty('--subpage-accent', config.accentColor);
  }
  var heroEl = document.querySelector('.subpage-hero');
  if (heroEl) {
    heroEl.setAttribute('data-category', config.categorySlug || '');
  }
}
```

### Empty state message

```javascript
// Source: adapted from 15-hops.js lines 1572-1581 [VERIFIED: codebase]
function renderEmptyState(container, config) {
  var msg = document.createElement('p');
  msg.className = 'catalog-no-results';
  msg.textContent = 'No ' + (config.categoryName || 'items') + ' are currently available.';
  var sub = document.createElement('p');
  sub.className = 'catalog-no-results-sub';
  sub.textContent = 'Check back soon or contact us if you need something specific.';
  container.appendChild(msg);
  container.appendChild(sub);
}
```

### Out-of-stock indicator on grid card

```javascript
// Source: 08-catalog-ingredients.js lines 666-677 [VERIFIED: codebase]
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
// Out-of-stock cards still render but cart controls are omitted (stockVal <= 0)
```

---

## State of the Art

| Old Approach | Current Approach | Notes |
|--------------|------------------|-------|
| Hardcoded module per category | One module + SUBPAGE_CONFIG | Phase 21 decision |
| Per-tab view mode in main catalog | Per-module view mode variable | `_subpageViewMode` vs `catalogViewMode` |
| Hops expand panel covers cards | Full-width row insert, ghost placeholder | D-02 decision |

**Deprecated/outdated:**
- None for this phase.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Fuse.js v7.1.0 is vendored and available as global `Fuse` | Standard Stack | Module would fail to initialize search; mitigate with `typeof Fuse !== 'undefined'` guard |
| A2 | `SUBPAGE_CONFIG` data structure as designed (subcategories[], types[], filterGroups[], etc.) | Pattern 1 | Structure is Claude's discretion — planner can adjust without user re-review |
| A3 | Accent color hex values per category | Pattern 1 | Purely aesthetic; can be changed anytime without code changes |
| A4 | Test HTML page is `test-subpage.html` at project root | Architecture | Throwaway; location is flexible |

---

## Open Questions

1. **Shared ingredient cache key vs. per-category cache**
   - What we know: Both hops.js and 08-catalog-ingredients.js fetch `/api/ingredients` separately with their own cache keys. There is no shared cross-module cache.
   - What's unclear: If 5 subpages all use the same API, the user could hit `/api/ingredients` 5 times (once per page visit). A shared cache key (`sv-all-ingredients-mw`) would reduce this.
   - Recommendation: Use per-category cache keys for Phase 21 (simpler, safer). Note the shared-cache optimization as a future improvement. The TTL of 1 hour means this is rarely a real problem.

2. **`stamp:pages` — test HTML file vs. production subpages**
   - What we know: `stamp:pages` currently stamps 9 files. Phase 22 will add 5 more (one per category subpage). Phase 21 only needs to stamp the test page.
   - What's unclear: Should Phase 21's test page be added to `stamp:pages` at all, or should it just be manually tested without stamping?
   - Recommendation: Add the test page to `stamp:pages` for the sake of BUILD-01 verification (proves the build pipeline handles the new asset patterns). Document that Phase 22 will extend the file list.

---

## Environment Availability

| Dependency | Required By | Available | Notes |
|------------|------------|-----------|-------|
| Node.js / npm | Build pipeline | Yes (confirmed by existing build working) | [ASSUMED — not probed in this session] |
| terser | Minify JS | Yes | In devDependencies, already in use |
| clean-css-cli | Minify CSS | Yes | In devDependencies, already in use |
| /api/ingredients endpoint | Data loading at test time | Yes (Phase 20 complete) | Middleware running on Railway |
| /content/zoho-snapshot.json | Fallback data | Yes (committed to repo) | Always available as GitHub Pages static file |

**Missing dependencies with no fallback:** None.

---

## Security Domain

Security enforcement is enabled (ASVS Level 1).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | No auth on catalog subpages |
| V3 Session Management | No | No session on these pages |
| V4 Access Control | No | Public product catalog, no restricted data |
| V5 Input Validation | Yes | User-provided sort/filter/search inputs must not be injected into DOM as HTML |
| V6 Cryptography | No | No sensitive data |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| XSS via product names in textContent | Tampering | Use `el.textContent = item.name` — never `innerHTML` for data from API. `escapeHTML()` available as shared global if innerHTML is needed |
| XSS via search query reflected in DOM | Tampering | Search query value only used in Fuse.search() — never set as innerHTML |
| localStorage prototype pollution | Tampering | Custom field flattening in 15-hops.js lines 245-250 guards against `__proto__`, `constructor`, `prototype` keys — replicate this guard in the new module's `mapItem()` |
| Stale cache serving malicious data | Spoofing | TTL-based cache invalidation already implemented; localStorage is same-origin only |

**Key security note:** The prototype pollution guard from 15-hops.js (`if (key === '__proto__' || key === 'constructor' || key === 'prototype') return;`) MUST be copied into 16-catalog-subpage.js if the module does its own custom field flattening. If it delegates to a shared mapping utility, the guard is already there.

---

## Sources

### Primary (HIGH confidence)
- `js/modules/15-hops.js` — standalone module pattern, data loading, detail panel insertion, cart object construction, DOMContentLoaded init, module.exports footer
- `js/modules/08-catalog-ingredients.js` — ingredient render pattern, stock badge, table view, cart control wiring, filterByConfig logic
- `js/modules/05-catalog-view.js` — view toggle pattern, `equalizeCardHeights()`, `getCatalogViewMode()`
- `js/modules/11-cart.js` — `_activeCartTab`, `getCartKey()`, `renderReserveControl()`, `renderWeightControl()`, `hasWeightConfig()`
- `js/modules/02-utils.js` — `handleDeepLinkedItem()`, `buildProductLinkBtn()`, `injectProductSchema()`, `escapeHTML()`
- `package.json` — build scripts, devDependencies, stamp patterns
- `css/styles.css` — CSS custom property palette, `.product-grid`, `.product-card` base rules
- `css/hops.css` — standalone CSS hero + card patterns

### Secondary (MEDIUM confidence)
- `21-CONTEXT.md` — decisions D-01 through D-09, `SUBPAGE_CONFIG` design intent
- `21-DISCUSSION-LOG.md` — not read but referenced as background context
- `.planning/REQUIREMENTS.md` — TPL-01 through TPL-04, BUILD-01

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — everything verified from package.json and codebase
- Architecture: HIGH — directly traced from existing 15-hops.js and 08-catalog-ingredients.js patterns
- Pitfalls: HIGH — all derived from actual code behavior observed in the codebase
- SUBPAGE_CONFIG design: MEDIUM — Claude's discretion per CONTEXT.md; structure is logical but not verified against user intent

**Research date:** 2026-05-28
**Valid until:** 2026-07-28 (stable codebase, no external dependencies)
