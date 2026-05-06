# Phase 11: Producer & Brand Visibility - Pattern Map

**Mapped:** 2026-05-06
**Files analyzed:** 9 modified files (no new files)
**Analogs found:** 9 / 9 (all modifications follow established patterns within same files)

---

## File Classification

| Modified File | Role | Data Flow | Closest Analog (within file) | Match Quality |
|---------------|------|-----------|-------------------------------|---------------|
| `zoho-middleware/routes/catalog.js` | service | request-response | `item.brand = detail.brand || ''` at lines 176, 543, 746 | exact — manufacturer follows brand in all 3 enrichment paths |
| `js/modules/06-featured.js` | component | request-response | `buildFeaturedWineCard` brand pattern lines 574-577; `buildFeaturedBeerCard` brand pattern lines 652-655; `buildFeaturedDefaultCard` brand pattern lines 718-720 | exact — producer element mirrors brand element structure |
| `js/modules/07-catalog-kits.js` | component | request-response | `buildWineCard` brand lines 698-701; `buildBeerCard` brand lines 797-800; `buildDefaultCard` brand lines 884-887; filter system lines 11, 168, 175-181, 435-446 | exact — producer filter mirrors brand filter pattern |
| `js/modules/11-cart.js` | component | event-driven | `item.brand` conditional render at lines 787-792 | exact — producer element mirrors brand element |
| `js/modules/12-checkout.js` | component | request-response | `hasBrand` column pattern at lines 566-631 | exact — producer column mirrors brand column pattern |
| `js/kiosk.js` | component | request-response | `kiosk-product-name` at line 1176; `kiosk-list-name` at line 1225; `kiosk-cart-line-name` at line 1587 | exact — producer inline display uses same `escapeHTML()` pattern |
| `js/admin.js` | component | request-response | `appendTd(tr, kit.brand || '')` at line 2291; `zohoEntry` lookup at line 2297 | exact — producer column uses same appendTd + zohoEntry pattern |
| `css/styles.css` | config | — | `.label-wine .brand` at lines 4352-4359; `.label-beer .brand` at line 4520; `.product-brand` at lines 1565-1573; `.cart-sidebar-item-brand` at lines 5584-5588 | exact — new `.producer` class mirrors existing brand class styles |
| `products.html` | config | — | `<div class="catalog-filter-row" id="filter-brand">` at line 141 | exact — new filter-manufacturer div mirrors filter-brand div |
| `admin.html` | config | — | `<th>Brand</th>` at line 202 | exact — new `<th>Producer</th>` mirrors Brand column header |

---

## Pattern Assignments

### `zoho-middleware/routes/catalog.js` — 3 enrichment paths + shapeProduct()

**Role:** service, request-response
**Analog within file:** `item.brand = detail.brand || ''` pattern (verified)

**Pattern 1 — Products enrichment** (lines 173-194, add after line 176):
```javascript
// EXISTING:
item.brand = detail.brand || '';
// ADD immediately after (same pattern):
item.manufacturer = detail.manufacturer || '';
```

**Pattern 2 — Ingredients enrichment** (lines 540-554, add after line 543):
```javascript
// EXISTING:
item.brand = detail.brand || '';
// ADD immediately after:
item.manufacturer = detail.manufacturer || '';
```

**Pattern 3 — Kiosk enrichment inline object** (lines 738-755, within the returned object):
```javascript
// EXISTING fields in the returned object:
image_name:    detail.image_name || item.image_name || '',
// ADD alongside other detail fields — note kiosk path uses detail.X || item.X pattern:
brand:         detail.brand || item.brand || '',          // if brand exists already
manufacturer:  detail.manufacturer || item.manufacturer || '',  // ADD
```
Note: The kiosk path (lines 738-755) builds an inline return object. The `brand` field is NOT currently in that object — both `brand` AND `manufacturer` need to be added to the kiosk return object.

**Pattern 4 — shapeProduct()** (lines 810-831, add after line 815):
```javascript
// EXISTING at line 815:
brand:          z.brand || '',
// ADD immediately after:
manufacturer:   z.manufacturer || '',
```

**Critical risk:** Verify actual Zoho field name. In Wave 0, add a debug log:
```javascript
// Temporary — in the products enrichment loop, log keys from one detail object:
if (items.length > 0) {
  var firstId = items[0].item_id;
  log.info('[debug] detail keys: ' + JSON.stringify(Object.keys(detailMap[firstId] || {})));
}
```
Use `detail.manufacturer` (not `detail.manufacturer_name`) per RESEARCH.md recommendation.

---

### `js/modules/06-featured.js` — 3 featured card builders

**Role:** component, request-response
**Analog within file:** brand element pattern in each card builder

**buildFeaturedWineCard pattern** (lines 574-577 — brand is first child of label-body):
```javascript
// EXISTING (brand appended first):
var brand = document.createElement('div');
brand.className = 'brand';
brand.textContent = product.brand || '';
body.appendChild(brand);

// INSERT producer BEFORE brand (append producer first, then brand):
if (product.manufacturer) {
  var producer = document.createElement('div');
  producer.className = 'producer';
  producer.textContent = product.manufacturer;
  body.appendChild(producer);   // producer first
}
body.appendChild(brand);        // brand second
// (do NOT call body.appendChild(brand) at the original line — move it after producer block)
```

**buildFeaturedBeerCard pattern** (lines 648-655 — logo is first, then brand):
```javascript
// EXISTING order: logo → brand → goldRule → beerName
// Producer goes between logo and brand:
body.appendChild(logo);         // unchanged

if (product.manufacturer) {
  var producer = document.createElement('div');
  producer.className = 'producer';
  producer.textContent = product.manufacturer;
  body.appendChild(producer);   // between logo and brand
}

var brand = document.createElement('div');
brand.className = 'brand';
brand.textContent = product.brand || '';
body.appendChild(brand);        // brand after producer
```

**buildFeaturedDefaultCard pattern** (lines 718-720 — product-brand is first child of product-card-header):
```javascript
// EXISTING:
var cardBrand = document.createElement('p');
cardBrand.className = 'product-brand';
cardBrand.textContent = product.brand || '';
header.appendChild(cardBrand);

// INSERT producer BEFORE brand:
if (product.manufacturer) {
  var cardProducer = document.createElement('p');
  cardProducer.className = 'product-producer';
  cardProducer.textContent = product.manufacturer;
  header.appendChild(cardProducer);   // producer first
}
header.appendChild(cardBrand);         // then brand (move original appendChild here)
```

---

### `js/modules/07-catalog-kits.js` — 3 card builders + filter system

**Role:** component, request-response
**Analog within file:** brand pattern in each builder; `buildFilterRow('filter-brand', 'brand', 'Brand:')` pattern

**buildWineCard brand pattern** (lines 698-701) — same as featured wine card above.

**buildBeerCard brand pattern** (lines 797-800) — same as featured beer card above.

**buildDefaultCard brand pattern** (lines 884-887) — same as featured default card above.

**Filter system — activeFilters initialization** (line 11):
```javascript
// EXISTING:
var activeFilters = { type: [], brand: [], subcategory: [], time: [], body: [], oak: [], sweetness: [] };
// CHANGE TO:
var activeFilters = { type: [], brand: [], manufacturer: [], subcategory: [], time: [], body: [], oak: [], sweetness: [] };
```

**Fuse.js keys** (line 168):
```javascript
// EXISTING:
keys: ['name', 'brand', 'subcategory', 'tasting_notes'],
// CHANGE TO:
keys: ['name', 'brand', 'manufacturer', 'subcategory', 'tasting_notes'],
```

**buildFilterRow call** (lines 175-181 — add after line 176):
```javascript
// EXISTING:
buildFilterRow('filter-type', 'type', 'Type:');
buildFilterRow('filter-brand', 'brand', 'Brand:');
// ADD after brand filter:
buildFilterRow('filter-manufacturer', 'manufacturer', 'Producer:');
buildFilterRow('filter-subcategory', 'subcategory', 'Style:');
// ... rest unchanged
```

**matchesFilters fields array** (line 436):
```javascript
// EXISTING:
var fields = ['type', 'brand', 'subcategory', 'time', 'body', 'oak', 'sweetness'];
// CHANGE TO (add 'manufacturer'):
var fields = ['type', 'brand', 'manufacturer', 'subcategory', 'time', 'body', 'oak', 'sweetness'];
```

**updateFilterAvailability fields array** (line 446):
```javascript
// EXISTING:
var fields = ['type', 'brand', 'subcategory', 'time', 'body', 'oak', 'sweetness'];
// CHANGE TO (add 'manufacturer'):
var fields = ['type', 'brand', 'manufacturer', 'subcategory', 'time', 'body', 'oak', 'sweetness'];
```
Note: The `updateFilterAvailability` function derives the container ID as `'filter-' + field` for most fields (line 448 uses `field === 'subcategory' ? 'subcategory' : field`). For `manufacturer` this yields `filter-manufacturer` which matches the new HTML container ID — no special-casing needed.

---

### `js/modules/11-cart.js` — cart sidebar producer display

**Role:** component, event-driven
**Analog within file:** `item.brand` conditional block at lines 787-792

**Brand element pattern** (lines 787-792):
```javascript
// EXISTING:
if (item.brand) {
  var brandEl = document.createElement('div');
  brandEl.className = 'cart-sidebar-item-brand';
  brandEl.textContent = item.brand;
  info.appendChild(brandEl);
}
```

**New producer element — insert BEFORE brand block** (same structure):
```javascript
// ADD before the brand block:
if (item.manufacturer) {
  var producerEl = document.createElement('div');
  producerEl.className = 'cart-sidebar-item-producer';
  producerEl.textContent = item.manufacturer;
  info.appendChild(producerEl);
}
// then existing brand block follows unchanged
if (item.brand) {
  var brandEl = document.createElement('div');
  brandEl.className = 'cart-sidebar-item-brand';
  brandEl.textContent = item.brand;
  info.appendChild(brandEl);
}
```
Note: Per RESEARCH.md pitfall #5 and reconciliation, cart sidebar renders producer as a separate element (not inline) — this is within Claude's discretion per CONTEXT.md. `nameEl.textContent = item.name` is left untouched.

---

### `js/modules/12-checkout.js` — checkout review table

**Role:** component, request-response
**Analog within file:** `hasBrand` + Brand column conditional pattern at lines 566-631

**hasBrand conditional pattern** (lines 566, 568-570):
```javascript
// EXISTING:
var hasTime = items.some(function (it) { return (it.time || '').trim() !== ''; });
var hasBrand = items.some(function (it) { return (it.brand || '').trim() !== ''; });
// ADD after hasBrand:
var hasManufacturer = items.some(function (it) { return (it.manufacturer || '').trim() !== ''; });
```

**Column header** (line 568 — the array passed to `forEach`):
```javascript
// EXISTING:
['Name', 'Type', 'Brand', 'Time', 'Price', 'Status', 'Qty', ''].forEach(function (label) {
  if (label === 'Time' && !hasTime) return;
  if (label === 'Brand' && !hasBrand) return;
  // ...
});
// CHANGE TO — add Producer column header and its guard:
['Name', 'Type', 'Producer', 'Brand', 'Time', 'Price', 'Status', 'Qty', ''].forEach(function (label) {
  if (label === 'Time' && !hasTime) return;
  if (label === 'Brand' && !hasBrand) return;
  if (label === 'Producer' && !hasManufacturer) return;
  // ...
});
```

**Producer cell in tbody** (after line 625 Brand cell — same pattern as Brand):
```javascript
// EXISTING Brand cell (lines 627-632):
if (hasBrand) {
  var tdBrand = document.createElement('td');
  tdBrand.setAttribute('data-label', 'Brand');
  tdBrand.textContent = item.brand || '';
  tr.appendChild(tdBrand);
}
// ADD Producer cell BEFORE Brand cell (same pattern):
if (hasManufacturer) {
  var tdManufacturer = document.createElement('td');
  tdManufacturer.setAttribute('data-label', 'Producer');
  tdManufacturer.textContent = item.manufacturer || '';
  tr.appendChild(tdManufacturer);
}
```

---

### `js/kiosk.js` — kiosk grid card, list view, cart line

**Role:** component, request-response
**Analog within file:** `escapeHTML(p.name || '')` pattern at lines 1176, 1225, 1587

**Grid card** (line 1176 — template string):
```javascript
// EXISTING:
html += '<div class="kiosk-product-name">' + escapeHTML(p.name || '') + '</div>';
// ADD producer line before name (only for kit-type items with manufacturer):
if (p.manufacturer && kioskGetItemType(p) === 'kit') {
  html += '<div class="kiosk-product-producer">' + escapeHTML(p.manufacturer) + '</div>';
}
html += '<div class="kiosk-product-name">' + escapeHTML(p.name || '') + '</div>';
```

**List view** (line 1225 — template string):
```javascript
// EXISTING:
html += '<td><div class="kiosk-list-name">' + escapeHTML(p.name || '') + '</div>';
// ADD producer inline in the name cell (compact format for list view):
var kioskListName = p.manufacturer && kioskGetItemType(p) === 'kit'
  ? escapeHTML(p.manufacturer) + ' — ' + escapeHTML(p.name || '')
  : escapeHTML(p.name || '');
html += '<td><div class="kiosk-list-name">' + kioskListName + '</div>';
```
Note: `—` is the em dash character — matches separator style used in existing kiosk source (line 558 of 12-checkout.js uses `—` for em dash in cart cross-note text).

**Cart line** (line 1587):
```javascript
// EXISTING:
html += '<div class="kiosk-cart-line-name" title="' + escapeHTML(item.name || '') + '">' + escapeHTML(item.name || '') + '</div>';
// Cart is space-constrained — keep name clean, no producer inline in cart line.
// Producer shown in grid/list only. Cart line is unchanged.
```
Note: Cart line is the most space-constrained surface. Grid and list views are better candidates for producer display. This is within Claude's discretion.

---

### `js/admin.js` — kit inventory table

**Role:** component, request-response
**Analog within file:** `appendTd(tr, kit.brand || '')` at line 2291; `zohoEntry` lookup at line 2297

**Table row rendering** (lines 2287-2297):
```javascript
// EXISTING (lines 2288-2292):
filtered.forEach(function (kit) {
  var tr = document.createElement('tr');
  appendTd(tr, kit.sku || '');
  appendTd(tr, kit.brand || '');  // line 2291
  appendTd(tr, kit.name || '');

  // Zoho data for this kit (line 2297):
  var zohoEntry = (kit.sku && zohoKitMap.hasOwnProperty(kit.sku)) ? zohoKitMap[kit.sku] : null;
```

**ADD Producer column before Brand** (after SKU, before Brand):
```javascript
filtered.forEach(function (kit) {
  var tr = document.createElement('tr');
  appendTd(tr, kit.sku || '');

  // Zoho entry needed for manufacturer (comes from Zoho API, not Sheets kitsData)
  var zohoEntry = (kit.sku && zohoKitMap.hasOwnProperty(kit.sku)) ? zohoKitMap[kit.sku] : null;
  // Producer from Zoho side (zohoEntry), not Sheets side (kit)
  appendTd(tr, (zohoEntry && zohoEntry.manufacturer) ? zohoEntry.manufacturer : '');

  appendTd(tr, kit.brand || '');
  appendTd(tr, kit.name || '');
  // NOTE: move the zohoEntry var declaration to before the appendTd calls
```
Critical: `kit.manufacturer` will always be empty (manufacturer is a Zoho field, not in Sheets kitsData). Use `zohoEntry.manufacturer` instead. The `zohoEntry` lookup (line 2297) must be moved earlier in the `forEach` body to be available for the new column. See RESEARCH.md Pitfall 3.

---

### `css/styles.css` — new .producer class

**Role:** config (stylesheet)
**Analog within file:** `.label-wine .brand` (lines 4352-4360), `.label-beer .brand` (line 4520), `.product-brand` (lines 1565-1573), `.cart-sidebar-item-brand` (lines 5584-5588)

**Existing brand styles to mirror:**
```css
/* label-wine .brand — lines 4352-4359 */
.label-wine .brand {
  font-family: var(--font-body);
  font-size: 0.625rem;         /* producer should be smaller: 0.55rem */
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.2em;
  color: var(--color-brown);   /* producer should be muted: var(--color-muted) */
  margin-bottom: 0.5rem;
}

/* label-beer .brand — line 4520 */
.label-beer .brand { font-size: 0.6875rem; font-weight: 700; color: var(--color-gold-dark); letter-spacing: 0.1em; margin-bottom: 0.25rem; }

/* product-brand — lines 1565-1573 */
.product-brand {
  font-size: 0.6875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-brown);
  margin-bottom: 0.2rem;
  opacity: 0.7;
}

/* cart-sidebar-item-brand — lines 5584-5588 */
.cart-sidebar-item-brand {
  font-size: 0.72rem;
  color: var(--color-muted);
  margin-top: 0.1rem;
}
```

**New CSS to add** (add near existing `.label-wine .brand` block, around line 4360):
```css
/* Producer line — appears above brand on label and product cards */
.label-wine .producer,
.label-beer .producer {
  font-family: var(--font-body);
  font-size: 0.55rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  color: var(--color-muted);
  margin-bottom: 0.2rem;
}

/* For default product cards */
.product-producer {
  font-size: 0.6rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-muted);
  margin-bottom: 0.1rem;
  opacity: 0.85;
}

/* For cart sidebar */
.cart-sidebar-item-producer {
  font-size: 0.65rem;
  color: var(--color-muted);
  margin-top: 0.1rem;
}

/* For kiosk grid card */
.kiosk-product-producer {
  font-size: 0.65rem;
  color: var(--color-muted, #5f5f5f);
  margin-bottom: 0.15rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
```

---

### `products.html` — new filter-manufacturer container

**Role:** config (HTML template)
**Analog within file:** `<div class="catalog-filter-row" id="filter-brand">` at line 141

**Existing filter structure** (lines 139-147):
```html
<div class="catalog-collapsible" id="catalog-collapsible">
  <div class="catalog-filter-row" id="filter-type"></div>
  <div class="catalog-filter-row" id="filter-brand"></div>
  <div class="catalog-filter-row" id="filter-subcategory"></div>
  ...
```

**New div to add** (between filter-brand and filter-subcategory):
```html
<div class="catalog-filter-row" id="filter-brand"></div>
<div class="catalog-filter-row" id="filter-manufacturer"></div>   <!-- ADD HERE -->
<div class="catalog-filter-row" id="filter-subcategory"></div>
```
Position: immediately after `filter-brand` per D-09 ("alongside existing brand filter").

---

### `admin.html` — Producer column header in kits table

**Role:** config (HTML template)
**Analog within file:** `<th>Brand</th>` at line 202

**Existing header** (lines 201-203):
```html
<th>SKU</th>
<th>Brand</th>
<th>Name</th>
```

**Change to** (add Producer before Brand):
```html
<th>SKU</th>
<th>Producer</th>   <!-- ADD -->
<th>Brand</th>
<th>Name</th>
```

---

## Shared Patterns

### `textContent` for all producer display — XSS safety
**Source:** All card builders in `06-featured.js`, `07-catalog-kits.js`, `admin.js`; kiosk uses `escapeHTML()`
**Apply to:** Every surface that renders `manufacturer`
```javascript
// DOM API (card builders, cart sidebar, checkout table):
el.textContent = product.manufacturer;  // inherently XSS-safe, no escapeHTML needed

// Template string contexts (kiosk.js only — uses innerHTML):
escapeHTML(p.manufacturer)  // use escapeHTML from js/lib/utils.js
```
Never use `el.innerHTML = product.manufacturer` — manufacturer is Zoho data, treat as untrusted.

### Conditional display — hide when empty
**Source:** `if (item.brand)` pattern in `11-cart.js` line 787; `hasBrand` in `12-checkout.js` line 566
**Apply to:** All surfaces
```javascript
// Card builders — only add element if value exists:
if (product.manufacturer) { /* create and append producer element */ }

// Table columns — compute hasManufacturer before rendering:
var hasManufacturer = items.some(function (it) { return (it.manufacturer || '').trim() !== ''; });
```

### `|| ''` fallback in enrichment
**Source:** `item.brand = detail.brand || ''` pattern (catalog.js lines 176, 543, 746)
**Apply to:** All 3 enrichment paths in catalog.js and shapeProduct()
```javascript
item.manufacturer = detail.manufacturer || '';
// In shapeProduct():
manufacturer: z.manufacturer || '',
```

### zohoEntry data source for admin
**Source:** `var zohoEntry = (kit.sku && zohoKitMap.hasOwnProperty(kit.sku)) ? zohoKitMap[kit.sku] : null;` at admin.js line 2297
**Apply to:** Admin producer column only
```javascript
// manufacturer is a Zoho field — comes from zohoKitMap, NOT from kitsData (Sheets)
appendTd(tr, (zohoEntry && zohoEntry.manufacturer) ? zohoEntry.manufacturer : '');
```

---

## No Analog Found

None — all patterns in this phase have exact analogs in the existing codebase.

---

## Key Observations for Planner

1. **All modifications are in-place edits — no new files.** The only "new" artifact is the `.producer` CSS class and the `filter-manufacturer` HTML div.

2. **Beer card DOM order differs from wine card.** Beer: `sv-logo → [producer] → brand → gold-rule → beer-name`. Wine: `[producer] → brand → ornament → wine-name`. Read each builder individually (verified in code above).

3. **Admin manufacturer must come from `zohoEntry`, not `kit`.** `kitsData` from Sheets has no manufacturer field. The `zohoEntry` var lookup (currently at line 2297) must be moved before the first `appendTd` call that uses it.

4. **Three `fields` arrays in `07-catalog-kits.js` must ALL be updated** — `activeFilters` init (line 11), `matchesFilters` (line 436), `updateFilterAvailability` (line 446). Pitfall: only updating one or two causes silent filter failure.

5. **Kiosk enrichment path currently lacks `brand` in returned object** — both `brand` and `manufacturer` need to be added to the inline return object at lines 738-755.

6. **Wave 0 verification required** — log `Object.keys(detailMap[firstItemId])` to confirm exact Zoho field name (`manufacturer` vs `manufacturer_name`) before writing enrichment code.

---

## Metadata

**Analog search scope:** `zoho-middleware/routes/`, `js/modules/`, `js/`, `css/`, root HTML files
**Files scanned:** 9 source files read directly
**Pattern extraction date:** 2026-05-06
