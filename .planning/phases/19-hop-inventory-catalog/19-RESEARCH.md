# Phase 19: Hop Inventory Catalog - Research

**Researched:** 2026-05-18
**Domain:** Vanilla JS ES5 frontend — product catalog page with inline SVG radar charts, accordion expand, size-variant toggle, ingredients cart integration, middleware custom fields
**Confidence:** HIGH — all findings verified against actual codebase source files

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Hop data pulled from Zoho Inventory via middleware API (same pipeline as kits/ingredients)
- **D-02:** 6-axis radar chart: Citrus, Tropical, Floral, Spicy, Pine, Herbal — each scored 0–5 as Zoho custom fields
- **D-03:** Alpha acid % shown as text spec outside the radar chart (not a chart axis)
- **D-04:** Origin shown as text spec (country/region)
- **D-05:** Each hop has a brief notes field — origin story, history, or notoriety (Zoho description or custom field)
- **D-06:** Packaging SKUs excluded — only retail hop SKUs displayed
- **D-07:** Collapsed card shows: hop name, price, alpha acid %, and 2–3 top flavor note tags
- **D-08:** Expanded detail uses inline accordion (same pattern as wine label card notes toggle via `buildLabelNotesToggle` in `04-label-cards.js`)
- **D-09:** Expanded view contains: radar chart, origin, notes/history, size selector, and Add to Cart button
- **D-10:** Two size variants per hop (e.g. 1 oz / 4 oz) — both found in Zoho as separate SKUs
- **D-11:** Size selector rendered as toggle buttons on the expanded card (not dropdown). Price updates on toggle. One Add to Cart button.
- **D-12:** Reuse wine card expand/contract infrastructure to maintain site cohesion
- **D-13:** Render as inline SVG built in JS (no external library). Lightweight, scales perfectly, matches no-framework approach
- **D-14:** Brand green fill (semi-transparent `var(--color-green)`) with darker green stroke. All hops same color scheme
- **D-15:** 0–5 scale per axis, normalized consistently across all hops
- **D-16:** Dedicated page: `hops.html` with its own CSS. Ingredients page keeps basic hop listings too
- **D-17:** Linked from Products dropdown nav alongside Ferment in Store, Ingredients & Supplies, Custom Labels
- **D-18:** Full filtering like ingredients page — category filters (by primary flavor profile: citrus, floral, etc.), search box, sort options (alpha acid, name, price)
- **D-19:** Hops added to the ingredients cart (same `sv-cart-ingredients` storage key and checkout flow)

### Claude's Discretion
- Radar chart sizing and axis label positioning within the accordion expand area
- Grid vs list layout for the hop cards (recommend grid to match ingredients pattern)
- Specific filter categories (derive from the 6 radar axes — e.g. filter by dominant flavor)
- Mobile responsive breakpoints for the card grid and radar charts

### Deferred Ideas (OUT OF SCOPE)
- None — discussion stayed within phase scope
</user_constraints>

---

## Summary

Phase 19 adds a dedicated `hops.html` page that functions as both a brew-education resource and a shopping tool. The page shows hop product cards with inline accordion expand panels housing 6-axis SVG radar charts for sensory attributes (Citrus, Tropical, Floral, Spicy, Pine, Herbal scored 0–5), a size-variant toggle between two Zoho SKUs per hop (1 oz / 4 oz), and standard ingredients-cart integration.

The implementation follows the existing `custom-labels.html` architecture pattern: `hops.html` loads `main.min.js` (the shared concat build) plus a new standalone `js/modules/15-hops.js`, which is minified separately and stamped with a cache-busting query version. This gives `15-hops.js` access to all shared utilities from the main build (cart functions, formatCurrency, renderReserveControl, etc.) without being concatenated into main.js — keeping the shared build clean.

Data currently flows through `/api/ingredients` in the middleware, which already runs `fetchItemDetailsBulk` and flattens `custom_fields` into properties like `cf_citrus`, `cf_tropical`, etc. on the returned objects. The key new work is: (1) adding 6 new Zoho custom field entries per hop SKU with numeric 0–5 values for the radar axes; (2) new client-side grouping logic that merges two SKUs sharing a hop name into one card with a size toggle; (3) the inline SVG radar chart renderer written in ES5; and (4) the HTML page, CSS file, and nav updates across all 8+ public HTML files.

**Primary recommendation:** Build `15-hops.js` as a standalone module following the `14-labels.js` pattern. Reuse `buildLabelNotesToggle` directly (it is a top-level function available everywhere main.min.js loads). Build the SVG radar chart as a self-contained ES5 function `buildHopRadarChart(scores)` that returns an SVGElement.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Hop product data | Middleware (Express) | — | Zoho Inventory API access, Redis caching, custom field enrichment — all exist here |
| Custom field flattening | Middleware (Express) | — | Already done in `doRefreshIngredients()` for all ingredient items |
| Hop grouping (size variants) | Browser / Client | — | Client groups two SKUs into one card; middleware has no hop-specific grouping logic |
| Radar chart rendering | Browser / Client | — | Inline SVG built in JS in the browser — no server involvement |
| Cart integration | Browser / Client | — | `setReservationQty` + `getCartKey` are browser-side cart functions |
| Filter/search/sort | Browser / Client | — | Same pattern as `08-catalog-ingredients.js` — pure client-side |
| Nav updates | Browser / HTML | — | Static HTML in each public page header |
| CSS styling | Browser / Static | — | New `css/hops.css` + `hops.min.css`, linked from hops.html only |
| Page SEO / sitemap | Static | — | `hops.html` head meta, sitemap.xml, JSON-LD |

---

## Standard Stack

### Core — all already in project, zero new installs needed

| Library / Tool | Version | Purpose | How Used |
|----------------|---------|---------|----------|
| ES5 vanilla JS | — | All frontend JS | `var`, no arrow functions, no template literals — project mandate |
| `buildLabelNotesToggle` | (04-label-cards.js) | Accordion expand/collapse | Reuse directly — top-level function in main.min.js |
| `renderReserveControl` / `setReservationQty` | (11-cart.js) | Add to Cart button | Standard ingredient cart pattern |
| `formatCurrency` | (js/lib/utils.js) | Price display | Same shared utility used across all modules |
| `CART_KEYS`, `ITEM_TYPES` | (js/lib/constants.js) | Cart routing | `_item_type: 'ingredient'` routes to `sv-cart-ingredients` |
| Fuse.js | (already loaded in main.min.js via 08-catalog-ingredients.js) | Fuzzy search | Available globally as `Fuse` — use same pattern as ingredient catalog |
| `clean-css-cli` | ^5.6.3 | CSS minification | `hops.min.css` added to `minify:css` script |
| `terser` | ^5.31.0 | JS minification | `15-hops.js` added to `minify:js` script |

[VERIFIED: package.json, js/modules/]

### Supporting

| Library / Tool | Version | Purpose | When to Use |
|----------------|---------|---------|-------------|
| Zoho custom fields API | — | Sensory scores on hop SKUs | Zoho Inventory admin — staff adds 6 numeric CFs per hop: Citrus, Tropical, Floral, Spicy, Pine, Herbal (values 0–5) |
| `injectProductSchema` | (02-utils.js) | JSON-LD product schema | Call per hop card, same as ingredient catalog does |
| `trackEvent` | (03-events.js) | GA4 event tracking | Call on accordion open and Add to Cart |
| `handleDeepLinkedItem` | (02-utils.js) | URL hash deep-linking | Call after render, same pattern as `renderIngredients()` |
| `equalizeCardHeights` | (05-catalog-view.js) | Card grid uniformity | Call after rendering hop card grid |

[VERIFIED: js/modules/08-catalog-ingredients.js usage patterns]

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Inline SVG radar (JS-built) | Chart.js, D3 | External library = extra HTTP request, bundle weight, license check; D-13 locks inline SVG |
| `buildLabelNotesToggle` accordion | Custom accordion | D-12 locks reuse of wine card expand infrastructure for cohesion |
| Standalone `15-hops.js` | Adding to `concat:js` | hops.html is a standalone page like custom-labels.html — doesn't need to be in main build |

**Installation:** None required. All tooling already in devDependencies.

---

## Architecture Patterns

### System Architecture Diagram

```
Browser: hops.html
    |
    +-- loads main.min.js (concat of lib/constants + modules 01-13)
    +-- loads js/modules/15-hops.min.js (standalone, like 14-labels.min.js)
    |
    v
15-hops.js DOMContentLoaded
    |
    +-- fetch(MIDDLEWARE_URL + '/api/ingredients')  <-- reuses existing endpoint
    |       |
    |       v
    |   Middleware: /api/ingredients
    |       |-- fetchAllItemsCached() (raw items from Zoho)
    |       |-- fetchItemDetailsBulk() (enrichment: custom_fields, tax, brand)
    |       |-- filter: exclude kits, services, zero-price, consignment
    |       |-- flattenCF() maps custom_fields[] -> item.cf_citrus, item.cf_tropical, etc.
    |       +-- returns { items: [...] }
    |
    +-- client filters: keep only items where name contains "hop pellet" (or subcategory = "hops")
    +-- groupHopsByVariant(): group 2 SKUs by hop name stem -> [{name, variants:[sku1oz, sku4oz]}]
    |
    +-- buildHopFilters(): derive dominant-flavor categories from radar scores
    +-- wireHopEvents(): search, sort, filter buttons
    |
    +-- renderHops():
            |
            +-- for each hop group:
            |       buildHopCard(group)
            |           |-- collapsed: name, price, alpha acid %, top 2-3 flavor tags
            |           |-- buildLabelNotesToggle-pattern accordion trigger
            |           +-- expanded panel:
            |                   buildHopRadarChart(scores) -> <svg>
            |                   origin text, notes/history text
            |                   size toggle buttons (1 oz / 4 oz)
            |                   price display (updates on toggle)
            |                   .product-reserve-wrap -> renderReserveControl()
            |
            +-- equalizeCardHeights()
            +-- handleDeepLinkedItem()
```

### Recommended Project Structure

```
hops.html                   # New public page (root level, like custom-labels.html)
css/hops.css                # New stylesheet for hops page
css/hops.min.css            # Minified (added to minify:css script)
js/modules/15-hops.js       # Standalone JS module (NOT in concat:js)
js/modules/15-hops.min.js   # Minified (added to minify:js script)
```

**Build pipeline changes required in package.json:**

```
minify:css: add "cleancss -o css/hops.min.css css/hops.css"
minify:js: add "terser js/modules/15-hops.js -o js/modules/15-hops.min.js -c -m"
stamp:pages: add 'hops.html' to the list of pages with cache-busted asset URLs
```

[VERIFIED: package.json concat:js, minify:css, minify:js, stamp:pages scripts; custom-labels.html as reference for standalone page pattern]

### Pattern 1: Standalone Page Module (follows 14-labels.js)

**What:** A dedicated JS file that is NOT in the `concat:js` pipeline. It loads after `main.min.js` so it can call top-level functions from modules 01-13.

**When to use:** When a page needs custom behavior not shared with the main products/ingredients pages.

```javascript
// Source: package.json minify:js + custom-labels.html script tag pattern
// hops.html script loading order:
<script src="js/sheets-config.js" defer></script>
<script src="js/main.min.js?v=XXXXX" defer></script>
<script src="js/modules/15-hops.min.js?v=XXXXX" defer></script>
```

```javascript
// js/modules/15-hops.js — top-level structure (ES5)
// Source: verified against 08-catalog-ingredients.js and 14-labels.js patterns

var _allHops = [];           // flat list of all hop items from middleware
var _hopGroups = [];         // grouped by variant (2 SKUs per hop)
var _hopsFuse = null;
var _hopFilters = { flavor: [] };  // filter by dominant flavor (derived from radar scores)

function loadHops(callback) { /* fetch /api/ingredients, filter hops, group */ }
function groupHopsByVariant(items) { /* group 1oz/4oz SKUs into pairs */ }
function buildHopRadarChart(scores) { /* returns SVGElement */ }
function buildHopCard(group) { /* returns DOM element */ }
function buildHopFilters() { /* derive flavor categories */ }
function wireHopEvents() { /* search input, sort select, filter buttons */ }
function renderHops() { /* main render loop */ }

document.addEventListener('DOMContentLoaded', function () {
  loadHops(function () {
    buildHopFilters();
    wireHopEvents();
    renderHops();
  });
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { groupHopsByVariant: groupHopsByVariant, buildHopRadarChart: buildHopRadarChart };
}
```

### Pattern 2: Inline SVG Radar Chart (ES5, no library)

**What:** A regular polygon (hexagon) SVG built entirely in JS. Axes drawn as lines from center; a filled polygon traces the hop's score on each axis.

**When to use:** Always — D-13 locks this approach.

```javascript
// Source: [ASSUMED] — standard SVG polygon/radar chart math, verified against
// D-13 (no external library) and D-14 (brand green fill, --color-green)

function buildHopRadarChart(scores) {
  // scores: { citrus: 3, tropical: 2, floral: 4, spicy: 1, pine: 3, herbal: 2 }
  var SIZE = 120;          // SVG viewBox dimension (Claude's discretion)
  var CENTER = SIZE / 2;
  var RADIUS = SIZE * 0.38;
  var AXES = ['Citrus', 'Tropical', 'Floral', 'Spicy', 'Pine', 'Herbal'];
  var MAX = 5;
  var NS = 'http://www.w3.org/2000/svg';

  var svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 ' + SIZE + ' ' + SIZE);
  svg.setAttribute('class', 'hop-radar');

  // Draw axis lines (from center to each vertex)
  AXES.forEach(function (axis, i) {
    var angle = (Math.PI * 2 * i / AXES.length) - Math.PI / 2;
    var x = CENTER + RADIUS * Math.cos(angle);
    var y = CENTER + RADIUS * Math.sin(angle);
    var line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', CENTER);
    line.setAttribute('y1', CENTER);
    line.setAttribute('x2', x.toFixed(1));
    line.setAttribute('y2', y.toFixed(1));
    line.setAttribute('class', 'radar-axis');
    svg.appendChild(line);
    // Axis label
    var label = document.createElementNS(NS, 'text');
    var lx = CENTER + (RADIUS + 12) * Math.cos(angle);
    var ly = CENTER + (RADIUS + 12) * Math.sin(angle);
    label.setAttribute('x', lx.toFixed(1));
    label.setAttribute('y', ly.toFixed(1));
    label.setAttribute('class', 'radar-label');
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('dominant-baseline', 'middle');
    label.textContent = axis;
    svg.appendChild(label);
  });

  // Draw score polygon
  var points = AXES.map(function (axis, i) {
    var key = axis.toLowerCase();
    var score = parseFloat(scores[key]) || 0;
    var frac = Math.min(score, MAX) / MAX;
    var angle = (Math.PI * 2 * i / AXES.length) - Math.PI / 2;
    var x = CENTER + RADIUS * frac * Math.cos(angle);
    var y = CENTER + RADIUS * frac * Math.sin(angle);
    return x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');

  var polygon = document.createElementNS(NS, 'polygon');
  polygon.setAttribute('points', points);
  polygon.setAttribute('class', 'radar-fill');
  svg.appendChild(polygon);

  return svg;
}
```

CSS for radar SVG (in hops.css):
```css
.hop-radar { width: 120px; height: 120px; }
.radar-axis { stroke: var(--color-green); stroke-width: 1; opacity: 0.4; }
.radar-fill { fill: rgba(74,111,75,0.3); stroke: var(--color-green); stroke-width: 1.5; }
.radar-label { font-size: 8px; fill: var(--color-text); font-family: var(--font-body); }
```

### Pattern 3: SKU Grouping (size variants)

**What:** Two Zoho SKUs for the same hop (e.g. `amarillo-1oz` and `amarillo-4oz`) must be merged into a single card with a toggle. The middleware returns them as flat separate items. Client-side grouping by name stem is required.

**When to use:** Always for hops — D-10 and D-11 are locked decisions.

```javascript
// Source: verified against snapshot data structure; SKU naming convention TBD
// (current snapshot has one SKU per hop sold by kg — size variants may be new Zoho entries)
// [ASSUMED] grouping by name stem (strip " - 1 oz" / " - 4 oz" suffix) is the right approach

function groupHopsByVariant(items) {
  var groups = {};
  var order = [];
  items.forEach(function (item) {
    // Stem: "Amarillo® T90 Hop Pellets" (remove trailing " - 1 oz" / " - 4 oz")
    var stem = item.name.replace(/\s*[-–]\s*\d+\s*oz\s*$/i, '').trim();
    if (!groups[stem]) {
      groups[stem] = { name: stem, variants: [] };
      order.push(stem);
    }
    groups[stem].variants.push(item);
  });
  // Sort variants within each group by price ascending (smaller size = lower price)
  order.forEach(function (stem) {
    groups[stem].variants.sort(function (a, b) {
      return (parseFloat(a.price_per_unit) || 0) - (parseFloat(b.price_per_unit) || 0);
    });
  });
  return order.map(function (stem) { return groups[stem]; });
}
```

### Pattern 4: Accordion Expand — Reuse buildLabelNotesToggle Pattern

**What:** The hop card's "Details" toggle uses the same `.notes-wrap`/`.notes-toggle`/`.notes-body`/`.notes-wrap.open` CSS classes and toggle logic as `buildLabelNotesToggle`. This reuses all existing CSS rules in styles.css (`.notes-toggle`, `.notes-body`, `.notes-wrap.open .notes-body`).

**When to use:** Always — D-08 and D-12 lock this approach.

```javascript
// Source: verified against js/modules/04-label-cards.js and css/styles.css line 4246+

function buildHopDetailToggle(group, selectedVariant) {
  var wrap = document.createElement('div');
  wrap.className = 'notes-wrap';        // reuses existing CSS

  var toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'notes-toggle';   // reuses existing CSS
  toggle.setAttribute('aria-expanded', 'false');
  toggle.innerHTML = 'Details <span class="chevron">&#9660;</span>';

  var body = document.createElement('div');
  body.className = 'notes-body';       // reuses existing CSS (max-height transition)

  // NOTE: notes-body uses flex layout — radar chart, specs, size toggle, cart button
  // will need explicit block/column direction layout inside .notes-body
  // Recommend adding .hop-detail-body child div with flex-direction: column

  toggle.addEventListener('click', (function (w, t) {
    return function () {
      var isOpen = w.classList.toggle('open');
      t.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      if (isOpen) {
        trackEvent('detail', selectedVariant.sku || '', group.name || '');
      }
    };
  })(wrap, toggle));

  wrap.appendChild(toggle);
  wrap.appendChild(body);
  return wrap;
}
```

**Important:** `.notes-body` has `max-height: 0` → `max-height: 600px` on `.open`. The expanded hop panel contains a radar chart + text + size toggle + button, which may need a taller `max-height`. Add `.hop-notes-body { max-height: 800px; }` override in hops.css if needed. [VERIFIED: styles.css line 4271-4274 shows 600px limit]

### Pattern 5: Collapsed Card Structure

**What:** Collapsed hop card shows name, price (of selected size variant), alpha acid %, and 2–3 top flavor tags derived from the 6 radar axis scores.

```javascript
// Source: [ASSUMED] pattern derived from D-07 requirements + existing product-card CSS

function getTopFlavorTags(scores, count) {
  var axes = ['Citrus', 'Tropical', 'Floral', 'Spicy', 'Pine', 'Herbal'];
  var scored = axes.map(function (axis) {
    return { label: axis, value: parseFloat(scores[axis.toLowerCase()]) || 0 };
  });
  scored.sort(function (a, b) { return b.value - a.value; });
  return scored.slice(0, count || 3).filter(function (s) { return s.value > 0; });
}

// Collapsed card DOM:
// .product-card (reuse existing CSS)
//   h4 (hop name stem)
//   .product-detail-row (price of active variant)
//   .hop-alpha-acid (alpha acid % spec)
//   .hop-flavor-tags (2-3 top flavor badges)
//   .notes-wrap (accordion trigger)
//     .notes-body (expanded panel — radar, origin, notes, size toggle, cart)
```

### Pattern 6: Nav Dropdown Update

**What:** Add "Hops" link to the Products dropdown nav in all 8+ public HTML files.

```html
<!-- Source: verified against index.html, custom-labels.html nav structure -->
<ul class="nav-dropdown-menu">
  <li><a href="products/ferment-in-store.html">Ferment in Store</a></li>
  <li><a href="products/ingredients-supplies.html">Ingredients &amp; Supplies</a></li>
  <li><a href="hops.html">Hops</a></li>
  <li><a href="custom-labels.html">Custom Labels</a></li>
</ul>
```

Files requiring nav update: `index.html`, `products.html`, `products/ferment-in-store.html`, `products/ingredients-supplies.html`, `custom-labels.html`, `reservation.html`, `about.html`, `contact.html` (all 8 public pages plus `hops.html` itself). [VERIFIED: robots.txt excludes only 4 non-public pages; all 8 public pages listed in stamp:pages]

### Anti-Patterns to Avoid

- **Putting 15-hops.js in concat:js:** The hops page is standalone like custom-labels.html; adding to concat would force every page to load hop-specific code. [VERIFIED: 14-labels.js precedent]
- **Using `var` hoisting across modules carelessly:** All shared helpers (formatCurrency, renderReserveControl, etc.) are already globals via main.min.js — do not re-declare them in 15-hops.js. [VERIFIED: 04-label-cards.js exports formatCurrency separately but it is also in js/lib/utils.js]
- **Calling `renderIngredients()` from hops.html:** The ingredients catalog guards against non-ingredient tabs (`if (_activeCartTab !== 'ingredients') return`). The hops page should not set `_activeCartTab` or call ingredients catalog functions — it has its own render pipeline.
- **Assuming size variants already exist in Zoho:** The current snapshot shows ONE SKU per hop sold by the kg. The size variant 1 oz / 4 oz structure per D-10 requires NEW Zoho SKUs to be created by staff, OR a reinterpretation using the existing kg-based weight control. This is a critical open question (see Open Questions).
- **Radar chart `max-height: 600px` truncation:** The `.notes-body` max-height on `.open` is 600px. The expanded hop panel with radar chart + text + size toggle + cart button may exceed this. Override in hops.css.
- **Ignoring CJS export block:** Every module needs `if (typeof module !== 'undefined' && module.exports)` block for Jest tests. [VERIFIED: CLAUDE.md requirement]

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Accordion expand/collapse | Custom toggle with animation | `buildLabelNotesToggle` pattern (`.notes-wrap`, `.notes-body`, `.notes-toggle` + `.notes-wrap.open`) | All CSS already exists; reuse provides cohesion (D-12) |
| Add to Cart button | Custom cart button | `renderReserveControl(wrap, product, productKey)` | Handles qty controls, stock limits, cart sync, GA4 tracking |
| Cart routing for hops | Custom cart key logic | `setReservationQty(product, qty)` with `_item_type: 'ingredient'` | Auto-routes to `sv-cart-ingredients` via `getCartKey()` |
| Fuzzy search | Custom search | `new Fuse(_allHops, {...})` — Fuse is already loaded globally via main.min.js | Already handles fuzzy matching with correct thresholds |
| Price formatting | Custom formatter | `formatCurrency(val)` from js/lib/utils.js | Handles NaN, strips non-numeric, 2 decimal places |
| Product schema injection | Custom JSON-LD | `injectProductSchema(item, 'ingredient')` from 02-utils.js | Consistent schema markup |
| Middleware caching | Custom caching | Hops come from `/api/ingredients` — Redis caching already implemented | 1-hour TTL, stale-while-revalidate, file fallback |

---

## Data Pipeline — Critical Findings

### Current State (Verified Against Snapshot)

The existing snapshot (`content/zoho-snapshot.json`) contains 13 hop items as ingredients. They are sold by the **kilogram** (unit: "kg"), using the weight control (`renderWeightControl`) pattern. They currently have NO custom fields for sensory scores — `cf_citrus`, `cf_tropical`, etc. do not exist yet. [VERIFIED: snapshot analysis of Amarillo, Falconer's, Hallertau items]

### Custom Field Flattening (Already Works)

The middleware's `doRefreshIngredients()` already calls `fetchItemDetailsBulk()` and assigns `item.custom_fields = detail.custom_fields || []`. The frontend `08-catalog-ingredients.js` then flattens these using:

```javascript
// Source: verified js/modules/08-catalog-ingredients.js lines 75-80
if (z.custom_fields && z.custom_fields.length) {
  z.custom_fields.forEach(function (cf) {
    var key = (cf.label || '').toLowerCase().replace(/\s+/g, '_');
    if (key && cf.value !== undefined && cf.value !== null) {
      obj[key] = String(cf.value);
    }
  });
}
```

So a Zoho custom field labelled "Citrus" with value "3" becomes `item.citrus = "3"` on the ingredient object. The hop card can read `parseFloat(item.citrus || 0)` etc.

**No middleware changes needed** for the custom field pipeline — it already works generically. Staff must add the 6 custom fields per hop in Zoho Inventory admin.

### Size Variant Grouping — Critical Decision Point

D-10 specifies "two size variants per hop (e.g. 1 oz / 4 oz) — both found in Zoho as separate SKUs." However, the existing Zoho data has hops sold by the **kg** using a weight slider (low_amount/high_amount/step). Two interpretations:

**Option A — New discrete SKUs (what D-10 describes):** Staff creates new Zoho items: `amarillo-1oz` ($X) and `amarillo-4oz` ($Y). Client groups them by name stem. This eliminates the weight slider entirely for hops on the hops page.

**Option B — Reuse existing kg-weight pattern:** The hops page renders the weight control (like `renderWeightControl`) instead of fixed size buttons. Price is continuous.

The CONTEXT.md decision D-11 ("toggle buttons... Price updates on toggle. One Add to Cart button") strongly implies Option A — discrete fixed sizes, not a continuous weight slider. **But the existing Zoho inventory uses kg.** This requires a staff action in Zoho (create new SKUs) before the frontend can group them correctly. [ASSUMED: staff must create size-variant SKUs in Zoho; this was not explicitly confirmed as already done]

If size-variant SKUs do NOT exist yet, grouping logic will find only 1 item per hop and the toggle will show a single size.

### Snapshot / Fallback Considerations

The `content/zoho-snapshot.json` snapshot does NOT have sensory score fields. After staff adds custom fields in Zoho and the middleware cache refreshes, hops will start returning sensory data. The hops page must gracefully degrade when scores are all 0 (either render an empty radar or hide it). [VERIFIED: snapshot shows empty custom fields on hop items]

---

## Common Pitfalls

### Pitfall 1: `.notes-body` max-height truncation

**What goes wrong:** Expanded hop detail panel is cut off — radar chart, notes, and cart button are not all visible.
**Why it happens:** `.notes-wrap.open .notes-body { max-height: 600px }` in styles.css. The hop expand panel is taller than a wine tasting notes panel.
**How to avoid:** Add `.hop-notes-body { max-height: 900px; }` override in `hops.css`, or use a different class for the hop body element.
**Warning signs:** Content visible but cart button hidden below fold.

### Pitfall 2: Weight control vs. fixed-size control confusion

**What goes wrong:** Hops currently use `renderWeightControl` (kg slider). If the hops page passes these items to `renderReserveControl` expecting integer qty, the weight control semantics break (prices based on kg × rate).
**Why it happens:** Ingredient items with `unit: "kg"` trigger `hasWeightConfig(item)` which returns true — `renderWeightControl` is selected in ingredient catalog.
**How to avoid:** On the hops page, if size-variant SKUs are discrete (unit: "pcs" or "ea"), use `renderReserveControl`. If still kg, decide explicitly whether to use weight control or override. Don't let `hasWeightConfig` silently select the wrong renderer.
**Warning signs:** Price calculation shows "X kg × $70/kg = $Y" instead of per-unit price.

### Pitfall 3: Scope — `_activeCartTab` guard in `renderIngredients()`

**What goes wrong:** If hops.html loads main.min.js and somehow triggers `renderIngredients()`, the `if (_activeCartTab !== 'ingredients') return` guard exits early because `_activeCartTab` defaults to `'kits'`.
**Why it happens:** main.min.js initializes `_activeCartTab = 'kits'` at line 11 of 11-cart.js.
**How to avoid:** The hops page must NOT call `renderIngredients()` or `renderKits()`. It has its own separate render pipeline in 15-hops.js.
**Warning signs:** Product catalog shows empty even though data loaded.

### Pitfall 4: Duplicate `formatCurrency` declaration

**What goes wrong:** ESLint `no-redeclare` error or silent override if `15-hops.js` declares `function formatCurrency()` — because it is already declared in `04-label-cards.js` (which is in main.min.js, loaded first).
**Why it happens:** `formatCurrency` is declared at top-level scope in `04-label-cards.js` and also in `js/lib/utils.js`. On a page that loads `main.min.js`, it is already a global.
**How to avoid:** Never redeclare `formatCurrency` or other helpers from the shared build in 15-hops.js. Call them directly.

### Pitfall 5: SVG namespace required

**What goes wrong:** SVG elements created with `document.createElement('svg')` instead of `document.createElementNS('http://www.w3.org/2000/svg', 'svg')` don't render.
**Why it happens:** SVG is an XML namespace — `createElement` creates HTMLUnknownElement, not SVGElement.
**How to avoid:** Always use `document.createElementNS('http://www.w3.org/2000/svg', tagName)` for every SVG element (svg, polygon, line, text, circle).

### Pitfall 6: CJS export block omission

**What goes wrong:** Jest tests for 15-hops.js cannot import pure functions.
**Why it happens:** Missing `if (typeof module !== 'undefined' && module.exports) { module.exports = {...}; }` at bottom of file.
**How to avoid:** Always add CJS export block. [VERIFIED: CLAUDE.md "Export pattern: append if (typeof module !== 'undefined' && module.exports)"]

### Pitfall 7: Nav update missed on some pages

**What goes wrong:** Hops nav link missing on some public pages but present on others — inconsistent user experience.
**Why it happens:** Nav HTML is duplicated in every page — 8 separate files to update manually.
**How to avoid:** Update ALL 8 public pages + `hops.html` itself in a single wave. Pages: `index.html`, `products.html`, `products/ferment-in-store.html`, `products/ingredients-supplies.html`, `custom-labels.html`, `reservation.html`, `about.html`, `contact.html`. [VERIFIED: robots.txt and stamp:pages list]

### Pitfall 8: `stamp:pages` misses hops.html

**What goes wrong:** After deploy, hops.html serves stale cached `main.min.js` and `15-hops.min.js` because the cache-bust version stamp was not applied.
**Why it happens:** `stamp:pages` in package.json has a hardcoded list of filenames — `hops.html` must be added.
**How to avoid:** Add `hops.html` to the array in `stamp:pages` script. [VERIFIED: stamp:pages script in package.json]

---

## Code Examples

### Radar Chart — Complete ES5 Builder

```javascript
// Source: design derived from D-13/D-14/D-15; SVG namespace verified against MDN spec
// All scores 0-5; six axes; brand green fill

var HOP_AXES = ['citrus', 'tropical', 'floral', 'spicy', 'pine', 'herbal'];
var HOP_AXIS_LABELS = ['Citrus', 'Tropical', 'Floral', 'Spicy', 'Pine', 'Herbal'];
var RADAR_NS = 'http://www.w3.org/2000/svg';
var RADAR_SIZE = 130;
var RADAR_CENTER = RADAR_SIZE / 2;
var RADAR_RADIUS = RADAR_SIZE * 0.36;
var RADAR_LABEL_OFFSET = RADAR_SIZE * 0.12;

function buildHopRadarChart(item) {
  var svg = document.createElementNS(RADAR_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 ' + RADAR_SIZE + ' ' + RADAR_SIZE);
  svg.setAttribute('class', 'hop-radar');
  svg.setAttribute('aria-label', 'Hop sensory profile radar chart');
  svg.setAttribute('role', 'img');

  // Background ring (visual reference)
  var bgPoly = document.createElementNS(RADAR_NS, 'polygon');
  var bgPoints = HOP_AXES.map(function (_, i) {
    var angle = (Math.PI * 2 * i / 6) - Math.PI / 2;
    return (RADAR_CENTER + RADAR_RADIUS * Math.cos(angle)).toFixed(1) + ',' +
           (RADAR_CENTER + RADAR_RADIUS * Math.sin(angle)).toFixed(1);
  }).join(' ');
  bgPoly.setAttribute('points', bgPoints);
  bgPoly.setAttribute('class', 'radar-bg');
  svg.appendChild(bgPoly);

  // Axis lines + labels
  HOP_AXES.forEach(function (axis, i) {
    var angle = (Math.PI * 2 * i / 6) - Math.PI / 2;
    var ex = RADAR_CENTER + RADAR_RADIUS * Math.cos(angle);
    var ey = RADAR_CENTER + RADAR_RADIUS * Math.sin(angle);

    var line = document.createElementNS(RADAR_NS, 'line');
    line.setAttribute('x1', RADAR_CENTER);
    line.setAttribute('y1', RADAR_CENTER);
    line.setAttribute('x2', ex.toFixed(1));
    line.setAttribute('y2', ey.toFixed(1));
    line.setAttribute('class', 'radar-axis');
    svg.appendChild(line);

    var lx = RADAR_CENTER + (RADAR_RADIUS + RADAR_LABEL_OFFSET) * Math.cos(angle);
    var ly = RADAR_CENTER + (RADAR_RADIUS + RADAR_LABEL_OFFSET) * Math.sin(angle);
    var label = document.createElementNS(RADAR_NS, 'text');
    label.setAttribute('x', lx.toFixed(1));
    label.setAttribute('y', ly.toFixed(1));
    label.setAttribute('class', 'radar-label');
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('dominant-baseline', 'middle');
    label.textContent = HOP_AXIS_LABELS[i];
    svg.appendChild(label);
  });

  // Score polygon
  var hasAnyScore = HOP_AXES.some(function (axis) {
    return parseFloat(item[axis] || 0) > 0;
  });

  if (hasAnyScore) {
    var points = HOP_AXES.map(function (axis, i) {
      var score = Math.min(parseFloat(item[axis] || 0), 5);
      var frac = score / 5;
      var angle = (Math.PI * 2 * i / 6) - Math.PI / 2;
      var x = RADAR_CENTER + RADAR_RADIUS * frac * Math.cos(angle);
      var y = RADAR_CENTER + RADAR_RADIUS * frac * Math.sin(angle);
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');

    var polygon = document.createElementNS(RADAR_NS, 'polygon');
    polygon.setAttribute('points', points);
    polygon.setAttribute('class', 'radar-fill');
    svg.appendChild(polygon);
  }

  return svg;
}
```

### Middleware Custom Field Access

```javascript
// Source: verified against js/modules/08-catalog-ingredients.js lines 75-80
// Custom fields on hop items after flattenCF():
// item.citrus     -> String "0"-"5" or undefined
// item.tropical   -> String "0"-"5" or undefined
// item.floral     -> String "0"-"5" or undefined
// item.spicy      -> String "0"-"5" or undefined
// item.pine       -> String "0"-"5" or undefined
// item.herbal     -> String "0"-"5" or undefined
// item.alpha_acid -> String e.g. "12.5%" or undefined (D-03: shown as text, not radar axis)
// item.origin     -> String e.g. "United States" or undefined (D-04)

// Reading scores in JS:
var scores = {
  citrus:   parseFloat(item.citrus   || 0),
  tropical: parseFloat(item.tropical || 0),
  floral:   parseFloat(item.floral   || 0),
  spicy:    parseFloat(item.spicy    || 0),
  pine:     parseFloat(item.pine     || 0),
  herbal:   parseFloat(item.herbal   || 0)
};
```

### Cart Integration for Hops (ingredients cart)

```javascript
// Source: verified against js/modules/08-catalog-ingredients.js lines 680-714
// and js/modules/11-cart.js getCartKey() logic

var hopForCart = {
  name: item.name,
  brand: item.brand || '',
  retail_instore: '',
  retail_kit: '',
  price_per_unit: item.price_per_unit || String(item.rate || ''),
  price: item.price_per_unit || String(item.rate || ''),
  discount: '',
  stock: item.stock || String(item.stock_on_hand || 0),
  time: '',
  sku: item.sku || '',
  unit: item.unit || '',
  low_amount: item.low_amount || '',
  high_amount: item.high_amount || '',
  step: item.step || '',
  _item_type: 'ingredient',         // routes to sv-cart-ingredients
  max_order_qty: item.max_order_qty || '',
  zoho_item_id: item.zoho_item_id || item.item_id || '',
  millable: '',
  tax_percentage: parseFloat(item.tax_percentage) || 0,
  tax_name: item.tax_name || ''
};

var reserveWrap = document.createElement('div');
reserveWrap.className = 'product-reserve-wrap';
var productKey = item.name + '|';
// Hops sold by kg use renderWeightControl; fixed-size SKUs use renderReserveControl
var renderer = hasWeightConfig(item) ? renderWeightControl : renderReserveControl;
reserveWrap._reserveProduct = hopForCart;
reserveWrap._reserveKey = productKey;
reserveWrap._reserveRenderer = renderer;
renderer(reserveWrap, hopForCart, productKey);
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single SKU per hop sold by kg | Potentially two fixed-size SKUs per hop (1 oz / 4 oz) | Phase 19 (new) | Requires new Zoho SKUs; changes cart control from weight slider to qty buttons |
| No dedicated hops page | Hops browsable on hops.html with radar charts | Phase 19 (new) | Better discovery, educational value |
| Hops only on ingredients tab | Hops on ingredients tab AND hops.html (D-16) | Phase 19 (new) | Two paths to find hops |

**Existing but relevant:** The weight control (`renderWeightControl`) pattern in 11-cart.js is the current way hops are added to cart (by kg). If size variants are fixed-size SKUs, this changes to `renderReserveControl` with integer qty.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Size-variant 1 oz / 4 oz SKUs need to be created in Zoho by staff — they don't exist yet (current: all hops are sold by kg) | Data Pipeline | If staff already created them, grouping logic must match their actual naming convention |
| A2 | Name-stem grouping uses suffix stripping (remove " - 1 oz" / " - 4 oz") to match variants | Pattern 3 (SKU Grouping) | If Zoho SKU naming is different (e.g. a `group_name` field is used), grouping logic changes |
| A3 | Zoho custom field labels are exactly "Citrus", "Tropical", "Floral", "Spicy", "Pine", "Herbal" — these flatten to `item.citrus`, `item.tropical`, etc. | Data Pipeline | If labels use different casing/spacing, the flattened keys will differ (e.g. "Alpha Acid" -> `item.alpha_acid`) |
| A4 | Alpha acid % label in Zoho is "Alpha Acid" (flattens to `item.alpha_acid`) | Data Pipeline | If differently named, reading the field in JS will return undefined |
| A5 | Origin label in Zoho is "Origin" (flattens to `item.origin`) | Data Pipeline | Same — undefined if different name |
| A6 | The `hops.html` page will show only hop pellet items (filtered by name containing "hop pellet" or subcategory = "hops") — exact filter criterion depends on how staff categorizes hops in Zoho | Standard Stack | If not all hops have "hop pellet" in name, some may be excluded from the page |
| A7 | Radar chart SVG viewBox of 130×130 with radius 36% and label offset 12% will fit cleanly in the expanded card at mobile breakpoints | Architecture Patterns | Sizing may need adjustment after visual testing |

**Table is not empty — A1 and A2 are the highest-risk assumptions and should be confirmed with staff before implementation begins.**

---

## Open Questions (RESOLVED)

1. **Size variant SKU structure (HIGHEST PRIORITY)**
   - What we know: Current Zoho data has one kg-priced SKU per hop. D-10 says "two size variants per hop... as separate Zoho SKUs."
   - What's unclear: (a) Have these SKUs already been created in Zoho? (b) If so, what naming convention do they use? (c) If not yet created, does the implementation proceed with a single-size version first?
   - Recommendation: Staff confirms Zoho SKU state before Wave 1 implementation. If not yet created, implement with single-size fallback and a `// TODO: size toggle` comment, then add grouping when SKUs are ready.
   - RESOLVED: Implement `groupHopsByVariant` with single-variant fallback — size toggle is omitted when only 1 SKU exists. Staff can add size-variant SKUs in Zoho at any time; the code handles 1 or 2 variants gracefully.

2. **Hop identification filter (how to separate hops from other ingredients)**
   - What we know: Hops currently have no Zoho `category` field set (snapshot shows empty). Name contains "Hop Pellets" for most items.
   - What's unclear: Will staff add a Zoho category/subcategory for hops? Or do we filter by name pattern?
   - Recommendation: Add a Zoho custom field `cf_type = "hop"` OR use the name pattern `item.name.toLowerCase().indexOf('hop pellet') !== -1` as a reliable filter. Confirm with staff whether a structured category is preferred.
   - RESOLVED: Filter by `name.indexOf('hop') !== -1 && name.indexOf('pellet') !== -1` (name pattern). Falls back cleanly if staff later adds a structured category.

3. **Radar chart display when all scores are 0**
   - What we know: Existing hops have no sensory data yet.
   - What's unclear: Should the accordion show an empty radar (just axes, no fill) or hide the chart entirely?
   - Recommendation: Hide the radar SVG and show a placeholder "Sensory scores coming soon" text when all scores are 0. Avoids visual confusion.
   - RESOLVED: Show `.hop-radar-placeholder` with "Sensory data coming soon" text when all 6 scores are 0. Radar chart is hidden entirely until staff populates Zoho custom fields.

---

## Environment Availability

Step 2.6: SKIPPED (no new external dependencies — hops page uses only existing middleware endpoint `/api/ingredients`, existing Zoho API, and existing build tools already confirmed in devDependencies)

---

## Security Domain

security_enforcement is enabled (config.json). ASVS Level 1 applies.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | hops.html is a public page, no auth required |
| V3 Session Management | No | No session state beyond localStorage cart |
| V4 Access Control | No | Public catalog page |
| V5 Input Validation | Yes | Search input, filter values — sanitize before rendering to DOM |
| V6 Cryptography | No | No secrets handled on hops page |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| XSS via hop name/description rendered to DOM | Tampering | Use `.textContent` not `.innerHTML` for all Zoho-supplied strings; use `escapeHTML()` from js/lib/utils.js if HTML is ever needed |
| XSS via search input reflected to DOM | Tampering | Search query used only as Fuse.js input, never rendered directly to HTML |
| Prototype pollution via custom field flattening | Tampering | Middleware flattenCF already uses `(cf.label || '').toLowerCase().replace(/\s+/g, '_')` — verify no `__proto__` injection possible |

**Key constraint:** All Zoho-supplied data (hop names, descriptions, origin, notes) must be rendered with `.textContent`, not `.innerHTML`. The `buildLabelNotesToggle` pattern already uses `.textContent` for tasting notes — maintain this. [VERIFIED: 04-label-cards.js line 45: `p.textContent = product.tasting_notes`]

---

## Sources

### Primary (HIGH confidence)
- `js/modules/04-label-cards.js` — `buildLabelNotesToggle` accordion pattern, CSS class names
- `js/modules/08-catalog-ingredients.js` — full filter/search/sort/render pipeline, custom field flattening pattern, ingredient cart object shape
- `js/modules/11-cart.js` — `getCartKey`, `setReservationQty`, `renderReserveControl`, `renderWeightControl`, `hasWeightConfig`
- `js/lib/constants.js` — `CART_KEYS`, `ITEM_TYPES`, `KIT_CATEGORIES`
- `css/styles.css` — CSS variables, `.notes-*` classes, `.product-card`, `.product-grid`
- `zoho-middleware/routes/catalog.js` — `doRefreshIngredients`, custom field enrichment pipeline, `flattenCF`
- `content/zoho-snapshot.json` — confirmed 13 hop items, all sold by kg, no sensory custom fields
- `package.json` — build scripts (`minify:css`, `minify:js`, `concat:js`, `stamp:pages`), confirmed `terser` and `clean-css-cli` available
- `custom-labels.html` — confirmed standalone page pattern (loads main.min.js + 14-labels.min.js)
- `CLAUDE.md` — ES5 mandate, CJS export pattern, test requirements, lint requirements

### Secondary (MEDIUM confidence)
- MDN Web Docs on SVG elements: `createElementNS`, `polygon`, `line`, `text` — standard SVG DOM API confirmed

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries verified as already in project
- Architecture: HIGH — standalone page pattern verified from custom-labels.html precedent
- Pitfalls: HIGH — all verified against actual source code
- Custom fields pipeline: HIGH — verified in middleware source
- Size variant grouping: MEDIUM — D-10 specifies it but current Zoho data has no variants yet (A1/A2)
- Radar chart sizing: MEDIUM — math is correct but visual fit at mobile breakpoints is unconfirmed

**Research date:** 2026-05-18
**Valid until:** 2026-06-18 (stable stack; Zoho custom field availability is the only changing variable)
