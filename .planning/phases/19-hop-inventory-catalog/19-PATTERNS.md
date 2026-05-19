# Phase 19: Hop Inventory Catalog - Pattern Map

**Mapped:** 2026-05-18
**Files analyzed:** 5 new/modified files
**Analogs found:** 5 / 5

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `hops.html` | page | request-response | `custom-labels.html` | exact |
| `js/modules/15-hops.js` | module (standalone) | request-response + CRUD | `js/modules/08-catalog-ingredients.js` | role-match |
| `css/hops.css` | stylesheet | — | `css/labels.css` | exact |
| `package.json` (build scripts) | config | — | `package.json` (existing scripts) | exact |
| Nav updates (8 HTML pages) | page fragment | — | `custom-labels.html` nav | exact |

---

## Pattern Assignments

### `hops.html` (page, request-response)

**Analog:** `custom-labels.html`

**Head / meta pattern** (custom-labels.html lines 1–75):
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <!-- Google Tag Manager -->
  <script>(function(w,d,s,l,i){...})(window,document,'script','dataLayer','GTM-NHRCGLC5');</script>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="theme-color" content="#4a6f4b">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; ...">
  <meta name="description" content="...Squamish...">
  <meta property="og:title" content="...">
  <meta property="og:url" content="https://steinsandvines.ca/hops">
  <link rel="canonical" href="https://steinsandvines.ca/hops">
  <title>Hop Pellets in Squamish | Steins &amp; Vines</title>
  <script type="application/ld+json">{ "@type": "LocalBusiness", ... }</script>
  <link rel="stylesheet" href="css/styles.min.css?v=XXXXX">
  <link rel="stylesheet" href="css/hops.min.css?v=XXXXX">
</head>
<body data-page="hops">
```

**Script loading pattern** (custom-labels.html lines 238–242):
```html
  <script src="js/vendor/sentry.min.js"></script>
  <script src="js/sentry-init.js"></script>
  <script src="js/sheets-config.js" defer></script>
  <script src="js/main.min.js?v=XXXXX" defer></script>
  <script src="js/modules/15-hops.min.js?v=XXXXX" defer></script>
```

**Nav dropdown pattern** (custom-labels.html lines 101–112 and index.html lines 136–141):
```html
<li class="nav-dropdown">
  <a href="products/ferment-in-store.html">Products</a>
  <ul class="nav-dropdown-menu">
    <li><a href="products/ferment-in-store.html">Ferment in Store</a></li>
    <li><a href="products/ingredients-supplies.html">Ingredients &amp; Supplies</a></li>
    <li><a href="hops.html">Hops</a></li>
    <li><a href="custom-labels.html">Custom Labels</a></li>
  </ul>
</li>
```
Note: In `hops.html` itself, the Hops link gets `class="active"`. In `custom-labels.html` the Custom Labels link has `class="active"` — same pattern.

**Body page attribute:** `<body data-page="hops">` (analog: `data-page="labels"` on custom-labels.html line 76).

**Hero section pattern** (css/labels.css lines 1–23 for CSS structure):
```html
<section class="hops-hero">
  <div class="container">
    <h1>Hop Pellets</h1>
    <p>Browse our selection...</p>
  </div>
</section>
```

**Catalog container** (id matches what 15-hops.js targets):
```html
<div id="hops-catalog" class="container">
  <!-- Populated by renderHops() in 15-hops.js -->
</div>
```

---

### `js/modules/15-hops.js` (standalone module, request-response + CRUD)

**Analog:** `js/modules/08-catalog-ingredients.js` (primary) + `js/modules/04-label-cards.js` (accordion) + `js/modules/11-cart.js` (cart integration)

#### Module-level state variables

Copy the state variable pattern from `08-catalog-ingredients.js` lines 1–4:
```javascript
var _allHops = [];          // flat list of hop items from middleware (after filter)
var _hopGroups = [];        // grouped pairs [{name, variants:[sku1oz, sku4oz]}]
var _hopsFuse = null;
var _hopFilters = { flavor: [] };  // 'flavor' derived from dominant radar axis
```

#### Data loading pattern

Copy `loadIngredients()` structure from `08-catalog-ingredients.js` lines 13–155. Key sections to preserve verbatim:

**Middleware URL resolution** (lines 13–16):
```javascript
function loadHops(callback) {
  var middlewareUrl = (typeof SHEETS_CONFIG !== 'undefined' && SHEETS_CONFIG.MIDDLEWARE_URL)
    ? SHEETS_CONFIG.MIDDLEWARE_URL : '';
```

**Snapshot fallback** (lines 18–30):
```javascript
  function loadFromSnapshot() {
    return fetch('/content/zoho-snapshot.json')
      .then(function (r) {
        if (!r.ok) throw new Error('Snapshot fetch failed: ' + r.status);
        return r.json();
      })
      .then(function (snap) {
        return (snap.ingredients || []);  // hops live in the ingredients array
      });
  }
```

**localStorage cache** (lines 31–50): Copy the MW_CACHE_KEY / MW_CACHE_TTL pattern exactly, using keys `'sv-hops-mw'` and `'sv-hops-mw-ts'` (distinct from `'sv-ingredients-mw'`).

**Custom field flattening in fetchFromMiddleware** (`08-catalog-ingredients.js` lines 57–85):
```javascript
  function fetchFromMiddleware() {
    return fetch(middlewareUrl + '/api/ingredients')   // same endpoint
      .then(function (r) {
        if (!r.ok) throw new Error('Middleware returned ' + r.status);
        return r.json();
      })
      .then(function (data) {
        var items = data.items || [];
        return items.map(function (z) {
          var obj = {
            name: z.name || '',
            unit: z.unit || '',
            price_per_unit: z.price_per_unit != null ? String(z.price_per_unit) : (z.rate != null ? String(z.rate) : ''),
            stock: z.stock != null ? String(z.stock) : (z.stock_on_hand != null ? String(z.stock_on_hand) : '0'),
            description: z.description || '',
            sku: z.sku || '',
            category: z.category || z.category_name || '',
            zoho_item_id: z.item_id || '',
            low_amount: '',
            high_amount: '',
            step: '',
            tax_percentage: z.tax_percentage != null ? z.tax_percentage : 0,
            tax_name: z.tax_name || ''
          };
          // Custom field flattening — produces item.citrus, item.tropical, etc.
          if (z.custom_fields && z.custom_fields.length) {
            z.custom_fields.forEach(function (cf) {
              var key = (cf.label || '').toLowerCase().replace(/\s+/g, '_');
              if (key && cf.value !== undefined && cf.value !== null) {
                obj[key] = String(cf.value);
              }
            });
          }
          return obj;
        });
      });
  }
```

**Post-load filtering for hops only** (after the items are fetched, insert a hop-specific filter before passing to `_allHops`):
```javascript
      _allHops = items.filter(function (r) {
        var p = parseFloat(r.price_per_unit || '0') || 0;
        if (p <= 0) return false;
        // Keep only hop pellet items (filter by name pattern until Zoho category is set)
        var nameLower = (r.name || '').toLowerCase();
        return nameLower.indexOf('hop') !== -1 && nameLower.indexOf('pellet') !== -1;
      });
      _hopGroups = groupHopsByVariant(_allHops);
```

**Error state with retry** (`08-catalog-ingredients.js` lines 133–154): Copy verbatim, targeting `document.getElementById('hops-catalog')` instead of `'product-catalog'`.

#### Fuse.js search initialization

Copy from `08-catalog-ingredients.js` lines 120–128:
```javascript
      if (typeof Fuse !== 'undefined') {
        _hopsFuse = new Fuse(_allHops, {
          keys: ['name', 'description'],
          threshold: 0.35,
          minMatchCharLength: 2,
          ignoreLocation: true
        });
      }
```

#### Filter builder pattern

Copy `buildIngredientFilterRow()` from `08-catalog-ingredients.js` lines 157–212 verbatim into 15-hops.js as `buildHopFilterRow()`. Change references from `renderIngredients` to `renderHops`.

Hop-specific filter builder (replaces `buildIngredientFilters()`):
```javascript
function buildHopFilters() {
  var HOP_AXES = ['Citrus', 'Tropical', 'Floral', 'Spicy', 'Pine', 'Herbal'];
  // Derive dominant flavor for each hop group: highest-scoring axis name
  var flavors = [];
  _hopGroups.forEach(function (group) {
    var rep = group.variants[0];  // use first variant for scores
    var dominant = getDominantFlavor(rep);
    if (dominant && flavors.indexOf(dominant) === -1) flavors.push(dominant);
  });
  flavors.sort();
  buildHopFilterRow('hops-filter-flavor', 'flavor', 'Flavor Profile:', flavors);
}
```

#### Event wiring pattern

Copy `wireIngredientEvents()` from `08-catalog-ingredients.js` lines 260–276, targeting `'hops-search'` and `'hops-sort'` elements, calling `renderHops()`:
```javascript
function wireHopEvents() {
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
}
```

#### Main render function pattern

Copy the filter + sort structure from `renderIngredients()` (`08-catalog-ingredients.js` lines 278–383). Key differences for hops:
- Target `document.getElementById('hops-catalog')` not `'product-catalog'`
- Remove `_activeCartTab !== 'ingredients'` guard — hop page is standalone
- Filter operates on `_hopGroups` not `_allIngredients`
- Sort options: `name-asc`, `name-desc`, `alpha-asc` (by alpha acid), `price-asc`, `price-desc`
- No section grouping by type — all hops in one flat grid
- Call `equalizeCardHeights()` and `handleDeepLinkedItem()` after render (lines 381–383)

**No-results pattern** (`08-catalog-ingredients.js` lines 342–349):
```javascript
  if (filtered.length === 0) {
    var msg = document.createElement('p');
    msg.className = 'catalog-no-results';
    msg.textContent = 'No hops found.';
    catalog.appendChild(msg);
    return;
  }
```

#### Accordion expand pattern

Copy `buildLabelNotesToggle()` from `04-label-cards.js` lines 15–91 as the structural template for `buildHopDetailToggle()`. Key differences:
- Button text: `'Details'` instead of `'Tasting Notes'`
- Body content: radar SVG + origin + notes text + size toggle + cart button (not image + tasting notes + traits)
- Add class `'hop-notes-body'` to the body div alongside `'notes-body'` for the `max-height` override in hops.css

**Toggle click handler** (exactly from `04-label-cards.js` lines 78–86):
```javascript
  toggle.addEventListener('click', function (w, t, prod) {
    return function () {
      var isOpen = w.classList.toggle('open');
      t.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      if (isOpen) {
        trackEvent('detail', prod.sku || '', prod.name || '');
      }
    };
  }(wrap, toggle, product));
```

#### Cart object shape pattern

Copy the `ingredientForCart` object from `08-catalog-ingredients.js` lines 680–701 verbatim. The `_item_type: 'ingredient'` field is the routing key — do not change it:
```javascript
        var hopForCart = {
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
          _item_type: 'ingredient',         // routes to sv-cart-ingredients via getCartKey()
          max_order_qty: item.max_order_qty || '',
          zoho_item_id: item.zoho_item_id || '',
          millable: '',
          tax_percentage: item.tax_percentage != null ? item.tax_percentage : 0,
          tax_name: item.tax_name || ''
        };
```

**Reserve wrap pattern** (`08-catalog-ingredients.js` lines 702–713):
```javascript
        var reserveWrap = document.createElement('div');
        reserveWrap.className = 'product-reserve-wrap';
        var productKey = item.name + '|';
        // For fixed-size SKUs (unit: 'pcs'/'ea'): use renderReserveControl
        // For kg-priced SKUs (unit: 'kg'): use renderWeightControl — hasWeightConfig() returns true
        var renderer = hasWeightConfig(item) ? renderWeightControl : renderReserveControl;
        reserveWrap._reserveProduct = hopForCart;
        reserveWrap._reserveKey = productKey;
        reserveWrap._reserveRenderer = renderer;
        renderer(reserveWrap, hopForCart, productKey);
```

#### CJS export block (mandatory)

Every module file must end with this block (`04-label-cards.js` lines 153–155 pattern):
```javascript
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    groupHopsByVariant: groupHopsByVariant,
    buildHopRadarChart: buildHopRadarChart,
    getTopFlavorTags: getTopFlavorTags,
    getDominantFlavor: getDominantFlavor
  };
}
```

#### DOMContentLoaded init pattern

```javascript
document.addEventListener('DOMContentLoaded', function () {
  loadHops(function () {
    buildHopFilters();
    wireHopEvents();
    renderHops();
  });
});
```

---

### `css/hops.css` (stylesheet)

**Analog:** `css/labels.css`

**File-level structure pattern** (labels.css lines 1–23):
```css
/* Hops page — hops.html */

.hops-hero {
  background-color: var(--color-green);
  color: var(--color-cream);
  text-align: center;
  padding: 5rem 0;
}
.hops-hero h1 {
  font-family: var(--font-display);
  font-weight: 700;
  color: var(--color-cream);
  margin-bottom: 0.75rem;
}
```

**CSS variables to use** (styles.css lines 118–132 — do NOT redefine, just reference):
```css
/* All of these are defined in styles.css :root and available in hops.css: */
/* --color-green: #4a6f4b    */
/* --color-burgundy: #370e13 */
/* --color-cream: #e5dec1    */
/* --color-text: #2c2c2c     */
/* --color-muted: #5f5f5f    */
/* --font-display: Playfair Display */
/* --font-body: Lato         */
```

**Reused CSS classes from styles.css** (no need to redeclare in hops.css):
- `.product-grid` (styles.css line 1505) — grid layout, `minmax(280px, 1fr)`
- `.product-card` (styles.css line 1512) — white card with burgundy top border
- `.product-detail-row` (styles.css line 1582) — price/unit row
- `.notes-toggle`, `.notes-body`, `.notes-wrap.open .notes-body` (styles.css lines 4246–4293) — accordion animation
- `.catalog-filter-btn`, `.catalog-filter-btn.active` (styles.css lines 2038–2064) — filter buttons
- `.product-reserve-wrap`, `.product-reserve-btn`, `.product-qty-controls` — cart controls

**New rules required in hops.css:**

`max-height` override for expanded hop panel (the default 600px in styles.css line 4272 is insufficient):
```css
.hop-notes-body {
  max-height: 900px;
}
```

Radar chart SVG rules:
```css
.hop-radar {
  width: 130px;
  height: 130px;
  flex-shrink: 0;
}
.radar-bg {
  fill: none;
  stroke: var(--color-green);
  stroke-width: 1;
  opacity: 0.2;
}
.radar-axis {
  stroke: var(--color-green);
  stroke-width: 1;
  opacity: 0.4;
}
.radar-fill {
  fill: rgba(74, 111, 75, 0.25);
  stroke: var(--color-green);
  stroke-width: 1.5;
}
.radar-label {
  font-size: 8px;
  fill: var(--color-text);
  font-family: var(--font-body);
}
```

Hop-specific card elements:
```css
.hop-flavor-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  justify-content: center;
  margin: 0.4rem 0;
}
.hop-flavor-tag {
  font-size: 0.7rem;
  padding: 0.15rem 0.5rem;
  background: var(--color-green);
  color: var(--color-cream);
  border-radius: 99px;
  font-family: var(--font-body);
}
.hop-alpha-acid {
  font-size: 0.8rem;
  color: var(--color-muted);
  margin: 0.25rem 0;
}
.hop-size-toggle {
  display: flex;
  gap: 0.5rem;
  justify-content: center;
  margin: 0.75rem 0;
}
.hop-size-btn {
  padding: 0.4rem 1rem;
  border: 2px solid var(--color-green);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-green);
  cursor: pointer;
  font-family: var(--font-body);
  font-size: 0.875rem;
}
.hop-size-btn.active {
  background: var(--color-green);
  color: var(--color-cream);
}
.hop-detail-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
}
.hop-specs {
  text-align: center;
  font-size: 0.85rem;
  color: var(--color-muted);
}
.hop-notes-text {
  font-size: 0.875rem;
  color: var(--color-text);
  text-align: left;
  max-width: 360px;
}
```

---

### `package.json` build script updates

**Analog:** Existing `package.json` scripts (lines 6–16)

**minify:css** — append `hops.css` entry (same pattern as labels.css):
```
"minify:css": "cleancss -o css/styles.min.css css/styles.css && ... && cleancss -o css/labels.min.css css/labels.css && cleancss -o css/hops.min.css css/hops.css"
```

**minify:js** — append `15-hops.js` entry (same pattern as `14-labels.js`):
```
"minify:js": "npm run concat:js && terser js/main.js -o js/main.min.js -c -m && ... && terser js/modules/14-labels.js -o js/modules/14-labels.min.js -c -m && terser js/modules/15-hops.js -o js/modules/15-hops.min.js -c -m"
```

**stamp:pages** — add `'hops.html'` to the filenames array. The replacements to include:
- `styles.min.css?v=` pattern (already handled by existing replace)
- `main.min.js?v=` pattern (already handled)
- `hops.min.css?v=` (new pattern, like `labels.min.css?v=`)
- `15-hops.min.js?v=` (new pattern, like `14-labels.min.js?v=`)

Important: `concat:js` does NOT change — `15-hops.js` is NOT added there. Standalone module only.

---

### Nav updates to 8 public HTML pages

**Analog:** `custom-labels.html` nav (lines 101–112), `index.html` nav (lines 136–141)

All 8 public pages require the same nav dropdown insertion. Current nav:
```html
<ul class="nav-dropdown-menu">
  <li><a href="products/ferment-in-store.html">Ferment in Store</a></li>
  <li><a href="products/ingredients-supplies.html">Ingredients &amp; Supplies</a></li>
  <li><a href="custom-labels.html">Custom Labels</a></li>
</ul>
```

Updated nav (insert Hops before Custom Labels):
```html
<ul class="nav-dropdown-menu">
  <li><a href="products/ferment-in-store.html">Ferment in Store</a></li>
  <li><a href="products/ingredients-supplies.html">Ingredients &amp; Supplies</a></li>
  <li><a href="/hops.html">Hops</a></li>
  <li><a href="custom-labels.html">Custom Labels</a></li>
</ul>
```

Note: Pages in subdirectories (`products/ferment-in-store.html`, `products/ingredients-supplies.html`) must use root-relative paths `/hops.html` — same convention as they currently use for `custom-labels.html` (check each file for current relative vs. root-relative usage).

Files to update (all 8 + hops.html itself):
1. `index.html`
2. `products.html` (if it exists as a redirect/landing)
3. `products/ferment-in-store.html`
4. `products/ingredients-supplies.html`
5. `custom-labels.html`
6. `reservation.html`
7. `about.html`
8. `contact.html`
9. `hops.html` (the new file itself, with `class="active"` on the Hops link)

---

## Shared Patterns

### Custom Field Flattening (middleware → client)
**Source:** `js/modules/08-catalog-ingredients.js` lines 75–80
**Apply to:** `15-hops.js` `fetchFromMiddleware()` function

After the flat Zoho item is mapped, custom fields are applied:
```javascript
if (z.custom_fields && z.custom_fields.length) {
  z.custom_fields.forEach(function (cf) {
    var key = (cf.label || '').toLowerCase().replace(/\s+/g, '_');
    if (key && cf.value !== undefined && cf.value !== null) {
      obj[key] = String(cf.value);
    }
  });
}
```
A Zoho field labelled "Citrus" with value "3" becomes `item.citrus = "3"`. Alpha Acid "12.5%" becomes `item.alpha_acid = "12.5%"`. Read scores with `parseFloat(item.citrus || 0)`.

### Cart Integration (`_item_type: 'ingredient'`)
**Source:** `js/modules/11-cart.js` lines 41–46, `js/modules/08-catalog-ingredients.js` lines 680–713
**Apply to:** All cart button rendering in `15-hops.js`

`getCartKey()` routes any product with `_item_type: 'ingredient'` to `INGREDIENT_CART_KEY` (`sv-cart-ingredients`). Always set `_item_type: 'ingredient'` on hop products. Never call `renderIngredients()` or set `_activeCartTab` from the hops page.

### `.textContent` Security Rule
**Source:** `js/modules/04-label-cards.js` line 44 (`p.textContent = product.tasting_notes`)
**Apply to:** All Zoho-sourced strings in `15-hops.js`

Use `.textContent` not `.innerHTML` for all Zoho data: hop name, description/notes, origin, alpha acid. Only use `escapeHTML()` from `js/lib/utils.js` if HTML is ever needed inside a Zoho-sourced string.

### Accordion Animation
**Source:** `css/styles.css` lines 4246–4293
**Apply to:** `buildHopDetailToggle()` in `15-hops.js`

The full animation lives in `styles.min.css` (already loaded). Apply class `'notes-wrap'` to the container, `'notes-toggle'` to the button, `'notes-body hop-notes-body'` to the body (two classes — the second overrides `max-height` in `hops.css`). No animation CSS needed in hops.css beyond the `max-height` override.

### SVG Namespace Requirement
**Source:** MDN SVG DOM API (verified; `document.createElement('svg')` produces HTMLUnknownElement)
**Apply to:** `buildHopRadarChart()` in `15-hops.js`

Every SVG element must use `document.createElementNS('http://www.w3.org/2000/svg', tagName)`. This applies to `svg`, `polygon`, `line`, `text`, `circle`. Non-namespaced elements are silent failures that don't render.

### CJS Export Block
**Source:** `js/modules/04-label-cards.js` lines 153–155, CLAUDE.md "Export pattern"
**Apply to:** End of `js/modules/15-hops.js`

All testable pure functions must be exported:
```javascript
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { groupHopsByVariant: groupHopsByVariant, buildHopRadarChart: buildHopRadarChart, getTopFlavorTags: getTopFlavorTags, getDominantFlavor: getDominantFlavor };
}
```

### Snapshot Fallback
**Source:** `js/modules/08-catalog-ingredients.js` lines 18–30
**Apply to:** `loadHops()` in `15-hops.js`

Hops live in `snap.ingredients` in the snapshot — same array as all other ingredients. The hop-specific filter (`name.indexOf('hop') !== -1 && name.indexOf('pellet') !== -1`) runs client-side after loading.

---

## No Analog Found

None — all files have close analogs in the codebase.

---

## Critical Implementation Notes for Planner

1. **`15-hops.js` is NOT in `concat:js`** — it is standalone like `14-labels.js`. The planner must not add it to the concat pipeline.

2. **`hasWeightConfig()` controls renderer selection** — existing hops in Zoho are sold by kg (`unit: 'kg'`), so `hasWeightConfig()` returns `true` and `renderWeightControl` is selected. If staff creates fixed-size SKUs (unit: `pcs`), `renderReserveControl` is selected instead. The code should call `hasWeightConfig()` dynamically, not hardcode either renderer.

3. **`renderIngredients()` must not be called from hops.html** — it has an `_activeCartTab !== 'ingredients'` guard that would silently exit.

4. **`notes-body` `max-height: 600px` must be overridden** — the expanded hop panel with radar + text + size toggle + cart button exceeds the 600px cap in styles.css line 4272. Add `.hop-notes-body { max-height: 900px; }` in hops.css.

5. **All 8 public pages + hops.html itself need nav updates** — this is 9 file edits total.

6. **`stamp:pages` must include `hops.html`** and the new `hops.min.css?v=` and `15-hops.min.js?v=` replacement patterns.

---

## Metadata

**Analog search scope:** `js/modules/`, `css/`, root HTML files
**Files scanned:** `04-label-cards.js` (156 lines), `08-catalog-ingredients.js` (812 lines), `11-cart.js` (1250+ lines, targeted reads), `custom-labels.html` (242 lines), `css/labels.css` (partial), `css/styles.css` (targeted reads at lines 1505–1545 and 4246–4293), `index.html` (targeted), `package.json`
**Pattern extraction date:** 2026-05-18
