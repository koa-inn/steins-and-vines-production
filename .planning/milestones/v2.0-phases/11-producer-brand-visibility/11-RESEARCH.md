# Phase 11: Producer & Brand Visibility - Research

**Researched:** 2026-05-06
**Domain:** Zoho Inventory API field mapping, frontend card DOM patterns, catalog filter system
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Producer appears as a new line above the existing brand element on all card types (wine label, beer label, default product card). Visual hierarchy: producer (context) -> brand (identity) -> product name (what you're buying).
- **D-02:** Producer line uses smaller font size and lighter/muted color compared to brand — establishes clear visual hierarchy, mirrors how wine bottles show vineyard above label name.
- **D-03:** On product cards (homepage featured + catalog), producer is a separate DOM element above brand. In compact views (checkout table, cart sidebar, kiosk list), producer is shown inline as "Producer — Name" format.
- **D-04:** Kit-only — producer does not show on ingredient/supply cards.
- **D-05:** Source is the standard Zoho Inventory `manufacturer_name` field from the item detail API. Not a custom field.
- **D-06:** Follows the exact same enrichment pattern as `brand` — add `manufacturer: detail.manufacturer_name || ''` in all 3 enrichment paths in catalog.js, and `manufacturer: z.manufacturer_name || ''` in `shapeProduct()`.
- **D-07:** Data is mostly populated in Zoho but some gaps exist. Feature ships with fallback handling rather than requiring a data cleanup prerequisite.
- **D-08:** Producer shows on ALL surfaces: homepage featured cards, catalog kit cards, checkout review table, cart sidebar, kiosk product cards, and admin kit inventory views.
- **D-09:** Add a new Producer filter dropdown on the catalog page alongside the existing Brand filter.
- **D-10:** No admin panel indicator for missing manufacturer data — data completeness managed in Zoho directly.
- **D-11:** When manufacturer is blank, hide the producer line entirely. Card looks exactly like today.
- **D-12:** Graceful degradation in inline format — if no manufacturer, show just name (or brand + name) without the "Producer —" prefix.

### Claude's Discretion

- Inline separator choice (em dash, pipe, or other) — pick what matches the site's existing typography
- Exact CSS for producer line (font-size, color, letter-spacing) — match existing label card design language
- Whether producer line appears above or below the ornament/gold-rule decorative element on label cards
- Producer filter position relative to existing filters on the catalog page
- Test file organization (new file vs extending existing)
- How kiosk grid vs list views handle the producer display differently

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PROD-VIS-01 | Middleware pipes the Zoho `manufacturer` field through catalog enrichment and returns it in the product API response | D-05/D-06: `manufacturer_name` (or `manufacturer`) from `/itemdetails` detail object — see Zoho API field name risk below |
| PROD-VIS-02 | All kit card types (wine label, beer label, default) display producer and brand above or before the product name | D-01/D-02/D-03: New DOM element inserted before `.brand` in all 6 card builder functions |
| PROD-VIS-03 | Checkout review, cart sidebar, kiosk cards, and admin views show producer/brand context where space allows | D-03/D-08: Inline "Producer — Name" format in compact views; producer column in admin table |
</phase_requirements>

---

## Summary

Phase 11 adds producer (Zoho Manufacturer) display to kit product cards across all surfaces. The implementation has two layers: a middleware data pipeline change (catalog.js enrichment) and a set of frontend DOM changes (card builders, filters, compact views).

The middleware change is low-risk and mechanical: `manufacturer` follows the exact same enrichment pattern as `brand` already does, which is proven to work. The frontend changes are also mechanical — six card builder functions, catalog filter system, cart sidebar, checkout table, kiosk, and admin table — each following existing patterns.

**Critical risk to resolve before implementation:** The CONTEXT.md decision D-05/D-06 uses `detail.manufacturer_name`, but the Zoho Inventory API documentation shows the field on item groups is named `manufacturer` (not `manufacturer_name`). The `/itemdetails` bulk endpoint is not fully documented for this field. Since `brand` is confirmed returned by `/itemdetails` (proven by working code), `manufacturer` is very likely returned too — but the exact field name needs verification. The plan must include a verification step (log the raw detail object from a live response, or test against a Zoho sandbox item with manufacturer set).

**Primary recommendation:** Implement the enrichment using `detail.manufacturer || ''` (matching the Zoho item group field name `manufacturer`, not `manufacturer_name`). Add a regression test that verifies the field flows through to the API response.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Manufacturer field from Zoho | API / Backend | — | `/itemdetails` endpoint called by middleware; frontend never calls Zoho directly |
| Product API response shape | API / Backend | — | `shapeProduct()` in catalog.js is the single mapping point |
| Product card DOM rendering | Browser / Client | — | All card builders run in the browser via vanilla JS |
| Catalog filter UI | Browser / Client | — | `buildFilterRow()` runs client-side, reads from `allProducts` array |
| Cart sidebar producer display | Browser / Client | — | `11-cart.js` renders in-browser; already handles `item.brand` conditionally |
| Checkout review table | Browser / Client | — | `12-checkout.js` renders server-fetched cart items in the DOM |
| Kiosk product display | Browser / Client | — | `kiosk.js` renders via template strings in browser |
| Admin kit inventory table | Browser / Client | — | `admin.js` renders from fetched data in browser |

---

## Standard Stack

This phase uses no new libraries. All work uses the existing tech stack.

| Component | Existing Pattern | This Phase Adds |
|-----------|-----------------|-----------------|
| Middleware enrichment | `item.brand = detail.brand \|\| ''` in 3 enrichment loops | `item.manufacturer = detail.manufacturer \|\| ''` (same pattern) |
| `shapeProduct()` | Maps Zoho fields to frontend shape | Add `manufacturer: z.manufacturer \|\| ''` |
| Card builder DOM | `var el = document.createElement('div'); el.className = ...; el.textContent = ...; body.insertBefore(el, brandEl)` | New `.producer` element inserted before `.brand` |
| Filter system | `buildFilterRow('filter-brand', 'brand', 'Brand:')` | `buildFilterRow('filter-manufacturer', 'manufacturer', 'Producer:')` |
| Cart sidebar | `if (item.brand) { brandEl.textContent = item.brand; }` | `if (item.manufacturer) { producerEl.textContent = item.manufacturer; }` |
| Inline compact format | Not used yet | `item.manufacturer ? item.manufacturer + ' — ' + item.name : item.name` |

**No new npm packages required.**

---

## Architecture Patterns

### System Architecture Diagram

```
Zoho /itemdetails
      |
      v
fetchItemDetailsBulk()  [zoho-api.js]
      |
      v
3 enrichment loops in catalog.js
  (products, ingredients, kiosk)
      |
      | item.manufacturer = detail.manufacturer || ''
      v
shapeProduct()  [catalog.js line 810]
      |
      | manufacturer: z.manufacturer || ''
      v
/api/products  /api/kiosk/products  API responses
      |
      +--------> 06-featured.js  (homepage cards)
      |          07-catalog-kits.js  (catalog cards + filter)
      |          11-cart.js  (cart sidebar)
      |          12-checkout.js  (checkout table)
      |          kiosk.js  (kiosk grid + list + cart)
      |          admin.js  (admin kit table)
      v
User sees "Producer" above brand on all kit surfaces
```

### Recommended Project Structure

No new files required for the core feature. Changes are in-place edits to existing files:

```
zoho-middleware/
  routes/catalog.js          -- 3 enrichment paths + shapeProduct()
js/modules/
  06-featured.js             -- 3 card builders (wine, beer, default)
  07-catalog-kits.js         -- 3 card builders + filter system + Fuse keys
  11-cart.js                 -- cart sidebar brand display
  12-checkout.js             -- checkout review table
js/
  kiosk.js                   -- kiosk grid + list + cart line
  admin.js                   -- admin kits table + filter
css/
  styles.css                 -- new .producer CSS class
products.html                -- new <div id="filter-manufacturer"> container
tests/
  frontend/label-cards.test.js  OR  new producer.test.js
zoho-middleware/__tests__/
  catalog.test.js            -- extend enrichment tests to include manufacturer
```

### Pattern 1: Middleware Enrichment (identical to brand)

**What:** Add `manufacturer` to all 3 enrichment paths in catalog.js.
**When to use:** Any new Zoho field that comes from the `/itemdetails` detail object.

```javascript
// Source: catalog.js lines 172-194 (products enrichment path)
// EXISTING pattern for brand:
item.brand = detail.brand || '';
// NEW pattern (same structure):
item.manufacturer = detail.manufacturer || '';
```

Three locations to add this:
1. Line ~176 — products enrichment (`/api/products`)
2. Line ~543 — ingredients enrichment (`/api/ingredients`) — not strictly needed (kit-only) but consistent
3. Line ~754 region — kiosk enrichment (inline object, add `manufacturer: detail.manufacturer || item.manufacturer || ''`)

### Pattern 2: shapeProduct() Field Mapping

```javascript
// Source: catalog.js line 810-831
// EXISTING:
brand: z.brand || '',
// ADD:
manufacturer: z.manufacturer || '',
```

### Pattern 3: Card Builder DOM Insertion

**What:** Insert a `.producer` div before the `.brand` div in card builders.
**When to use:** All 6 card builder functions (3 in featured, 3 in catalog-kits).

```javascript
// Source: js/modules/07-catalog-kits.js buildWineCard(), line 698+
// EXISTING brand pattern:
var brand = document.createElement('div');
brand.className = 'brand';
brand.textContent = product.brand || '';
body.appendChild(brand);

// NEW producer element (inserted BEFORE brand):
if (product.manufacturer) {
  var producer = document.createElement('div');
  producer.className = 'producer';
  producer.textContent = product.manufacturer;
  body.insertBefore(producer, brand);  // or appendChild(producer) before brand appendChild
}
```

For beer label cards, the structure is: `sv-logo -> brand -> gold-rule -> beer-name`. The producer line goes between `sv-logo` and `brand` (above brand per D-01).

For wine label cards, the structure is: `brand -> ornament -> wine-name`. The producer line goes before brand.

For default product cards (`.product-card-header`), the structure is: `product-brand -> h4`. The producer line (using class `product-producer` or similar) goes before `product-brand`.

### Pattern 4: Catalog Filter System

**What:** Add a new `filter-manufacturer` filter row alongside `filter-brand`.
**When to use:** Any new field that should be filterable in the catalog.

```javascript
// Source: js/modules/07-catalog-kits.js line 11 and 175-181
// EXISTING:
var activeFilters = { type: [], brand: [], subcategory: [], time: [], body: [], oak: [], sweetness: [] };
buildFilterRow('filter-brand', 'brand', 'Brand:');

// NEW (add manufacturer to activeFilters object AND buildFilterRow call):
var activeFilters = { type: [], brand: [], manufacturer: [], subcategory: [], time: [], body: [], oak: [], sweetness: [] };
buildFilterRow('filter-manufacturer', 'manufacturer', 'Producer:');
```

The `matchesFilters()` function (line 435), `updateFilterAvailability()` (line 445), and `applyFilters()` (line 492) all iterate over the `fields` array — add `'manufacturer'` to each `fields` array. The `applyFilters()` already checks `activeFilters[f]` generically so it just needs the field added.

Also update Fuse.js search keys (line 168) to include `'manufacturer'` so search works across producer names.

**products.html** needs a new container div added inside `.catalog-collapsible`:
```html
<div class="catalog-filter-row" id="filter-manufacturer"></div>
```
Position: between `filter-brand` and `filter-subcategory` (per D-09: alongside existing brand filter).

### Pattern 5: Inline Compact Format

**What:** In compact views (checkout table, cart sidebar, kiosk), show producer inline as "Producer — Name".
**When to use:** Where vertical space is limited and a separate producer line would be awkward.

```javascript
// Inline format using em dash (matches existing site separator style)
var displayName = item.manufacturer
  ? escapeHTML(item.manufacturer) + ' — ' + escapeHTML(item.name)
  : escapeHTML(item.name || '');
// OR for textContent-only contexts:
nameEl.textContent = item.manufacturer
  ? item.manufacturer + ' — ' + item.name
  : item.name;
```

The existing `.cart-sidebar-item-brand` CSS at line 5584 of styles.css uses `var(--color-muted)` and `font-size: 0.72rem`. This pattern already exists for `item.brand` in `11-cart.js` at lines 787-792. The producer display in the cart sidebar should follow the same structure — a new `.cart-sidebar-item-producer` div above the existing `.cart-sidebar-item-brand` div — rather than the inline format (D-03 specifies inline only for checkout table and kiosk list, not the cart sidebar... but D-03 says "compact views (checkout table, cart sidebar, kiosk list)"). Clarification: D-03 says inline for all compact views including cart sidebar.

**Reconciliation of D-03 vs. existing cart sidebar pattern:** The cart sidebar already renders `item.brand` as a separate styled element (not inline). For consistency, render `item.manufacturer` as a similar element above brand in the sidebar, rather than prepending it to the name. This is within Claude's discretion for the cart sidebar.

### Pattern 6: Admin Table Column

**What:** Add a Producer column to the admin kits table.
**When to use:** Following the exact same pattern as the Brand column.

```javascript
// Source: admin.js line 2291 (existing brand column)
appendTd(tr, kit.brand || '');
// ADD before the brand column:
appendTd(tr, kit.manufacturer || '');
```

Admin HTML (`admin.html` line 202-203) needs a new `<th>Producer</th>` before `<th>Brand</th>`.

The admin brand filter (`populateKitBrandFilter()` at line 2201) uses a `<select>` element pattern — different from the catalog filter's button pattern. D-09 specifies a producer filter for the catalog page only. No producer filter is needed in admin (D-10 says no admin indicator needed). However, adding the producer column to the admin table IS in scope per D-08.

**Note:** The admin kit data (`kitsData`) comes from Google Sheets, not from the Zoho middleware API. The kits sheet may not have a manufacturer column. Check how `zohoKitMap` (from the Zoho API call) merges with `kitsData` — manufacturer would need to come from the Zoho side, not the sheets side.

### Anti-Patterns to Avoid

- **Using innerHTML for producer text:** All existing card builders use `textContent` for user-controlled strings. Never use `innerHTML` for `product.manufacturer` — it comes from Zoho data and must be treated as untrusted text. [VERIFIED: all existing brand/name rendering uses `.textContent`]
- **Hardcoding producer filter position in JS:** `buildFilterRow` uses a pre-existing DOM container. The position is controlled by the HTML, not JS order. Add the `<div id="filter-manufacturer">` in the right place in `products.html`.
- **Breaking the product key:** The product cart key is `name + '|' + brand`. Do not add manufacturer to the key — it is display-only per CONTEXT.md D-06 notes ("Product key is `name + '|' + brand` — no change needed").
- **Showing producer on ingredient cards:** D-04 says kit-only. In `08-catalog-ingredients.js` and the ingredients enrichment path, no producer display is added.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Filter button system | Custom filter UI | `buildFilterRow()` with new `filter-manufacturer` container | Already handles unique values, active state, availability, and URL param sync |
| XSS sanitization for producer text | Custom escaper | `el.textContent = value` (DOM API) or `escapeHTML()` for innerHTML contexts | `textContent` is inherently safe; `escapeHTML` is in `js/lib/utils.js` [VERIFIED] |
| Fuzzy search across producer | Custom search | Add `'manufacturer'` to Fuse.js keys array | Fuse.js already configured at line 166 of `07-catalog-kits.js` |

---

## Critical Risk: Zoho API Field Name

**This is the most important research finding.**

The CONTEXT.md decisions (D-05, D-06) reference `detail.manufacturer_name` as the field to read from the Zoho item detail API response. Research shows:

- The Zoho Inventory Item Groups API returns a field called `manufacturer` (not `manufacturer_name`) [CITED: zoho.com/inventory/api/v1/itemgroups/]
- The standard Zoho Inventory Item API (GET /items/{id}) does NOT include manufacturer in its documented response schema [CITED: zoho.com/inventory/api/v1/items/]
- The `/itemdetails` bulk endpoint (used by the middleware) is not separately documented but is known to return `brand` (proven by working code at catalog.js line 176)
- `manufacturer` is documented as a sibling field to `brand` in item groups — it likely appears in item detail responses too, but as `manufacturer` not `manufacturer_name`

**Recommendation:** Use `detail.manufacturer || ''` (not `detail.manufacturer_name`). If the field comes back as something different (e.g., `manufacturer_name`), the value will silently be empty and the fallback behavior (D-11: hide producer line) will apply harmlessly. A one-time verification step against a live Zoho item that has manufacturer set is the safest approach.

**What to do in the plan:** Include a Wave 0 verification task — log `JSON.stringify(Object.keys(detailMap[someItemId]))` in the enrichment loop during local development to confirm the exact field name before writing the final enrichment code.

---

## Common Pitfalls

### Pitfall 1: manufacturer_name vs. manufacturer
**What goes wrong:** Using `detail.manufacturer_name` (as stated in CONTEXT.md) when the actual Zoho field is `detail.manufacturer`. Producer line stays blank for all products.
**Why it happens:** CONTEXT.md was written based on assumed field name, not verified against Zoho API docs.
**How to avoid:** Verify the field name against a live response before writing enrichment code. The fallback `|| ''` means the feature degrades silently rather than breaking.
**Warning signs:** All products have empty producer line in staging; no JS errors.

### Pitfall 2: Filter fields array not updated in all 3 places
**What goes wrong:** `buildFilterRow` is called, but `matchesFilters()`, `updateFilterAvailability()`, and `applyFilters()` each have a hardcoded `fields` array that does not include `'manufacturer'`. Filtering works visually but products are not filtered.
**Why it happens:** The fields array is repeated 3 times in `07-catalog-kits.js` (lines 11, 436, 446).
**How to avoid:** Search for all `fields = [` occurrences in the file and add `'manufacturer'` to each, including `activeFilters` initialization at line 11.
**Warning signs:** Clicking a producer filter button appears to select but products do not filter.

### Pitfall 3: admin.js kit data comes from Google Sheets, not Zoho middleware
**What goes wrong:** Adding a manufacturer column to the admin kits table but `kitsData` (loaded from Google Sheets) has no `manufacturer` field. Column renders empty for all rows.
**Why it happens:** The admin panel has a dual data source — `kitsData` from Sheets and `zohoKitMap` from the Zoho API. Manufacturer is a Zoho field, not a Sheets field.
**How to avoid:** Render producer from `zohoEntry.manufacturer` (the `zohoKitMap` entry), not from `kit.manufacturer`. The `zohoEntry` at admin.js line 2297 is `(kit.sku && zohoKitMap.hasOwnProperty(kit.sku)) ? zohoKitMap[kit.sku] : null`. The kiosk products API response (`/api/kiosk/products`) is what populates `zohoKitMap`.
**Warning signs:** Producer column is empty for all kits in admin panel even when manufacturer is set in Zoho.

### Pitfall 4: Beer label card has different DOM order from wine label card
**What goes wrong:** Assuming producer goes "before brand" and placing it in the wrong position in the beer card. Beer cards have `sv-logo -> brand -> gold-rule -> beer-name`; wine cards have `brand -> ornament -> wine-name`.
**Why it happens:** The two label card types have different structures.
**How to avoid:** In beer cards, producer goes between `sv-logo` and `brand`. In wine cards, producer goes before `brand` (first child of `label-body`). Read each card builder function individually.
**Warning signs:** Producer appears below brand or after the gold rule on beer cards.

### Pitfall 5: Cart sidebar uses separate element, not inline format (reconcile D-03)
**What goes wrong:** Implementing inline `"Producer — Name"` in the cart sidebar `nameEl.textContent` field, which overwrites the existing clean name display and conflicts with how `item.name` is used in other calculations.
**Why it happens:** D-03 says "compact views" use inline format. The cart sidebar item name DOM is used for display only, but the cart data (localStorage) stores `item.name` separately — changing the DOM display doesn't affect the data.
**How to avoid:** Keep `nameEl.textContent = item.name` untouched. Add a separate `.cart-sidebar-item-producer` element above the name element. This is within Claude's discretion per CONTEXT.md.

### Pitfall 6: products.html missing filter-manufacturer container
**What goes wrong:** `buildFilterRow('filter-manufacturer', ...)` is called in JS but there is no `<div id="filter-manufacturer">` in the HTML. The filter silently does nothing (`container` is null, function returns early at line 299).
**Why it happens:** The filter system requires the HTML container to pre-exist.
**How to avoid:** Add `<div class="catalog-filter-row" id="filter-manufacturer"></div>` to `products.html` in the correct position within `.catalog-collapsible`.

---

## Code Examples

### Middleware enrichment (3 locations in catalog.js)

```javascript
// Source: catalog.js lines 172-194 pattern (verified in codebase)
// Location 1: Products enrichment (~line 176)
item.brand = detail.brand || '';
item.manufacturer = detail.manufacturer || '';  // ADD THIS LINE

// Location 2: Ingredients enrichment (~line 543) — for completeness
item.brand = detail.brand || '';
item.manufacturer = detail.manufacturer || '';  // ADD

// Location 3: Kiosk inline object (~line 738-755) — add to the return object
return {
  // ... existing fields ...
  brand: detail.brand || item.brand || '',  // note: already uses detail.brand not item.brand
  manufacturer: detail.manufacturer || item.manufacturer || '',  // ADD
  // ... more fields
};
```

### shapeProduct() addition

```javascript
// Source: catalog.js shapeProduct() line 810 (verified in codebase)
var obj = {
  name:           z.name || '',
  sku:            z.sku || '',
  item_id:        z.item_id || '',
  brand:          z.brand || '',
  manufacturer:   z.manufacturer || '',   // ADD THIS LINE
  // ... rest of fields
};
```

### Card builder producer element (wine card example)

```javascript
// Source: js/modules/07-catalog-kits.js buildWineCard() line 698 (verified in codebase)
// Insert BEFORE brand element (brand is appended first to body, producer goes before)
var brand = document.createElement('div');
brand.className = 'brand';
brand.textContent = product.brand || '';
// body.appendChild(brand); -- defer this

// ADD: producer above brand
if (product.manufacturer) {
  var producer = document.createElement('div');
  producer.className = 'producer';
  producer.textContent = product.manufacturer;
  body.appendChild(producer);  // append producer first
}
body.appendChild(brand);  // then brand
```

### Filter system additions (07-catalog-kits.js)

```javascript
// Source: 07-catalog-kits.js line 11 (verified)
// Change:
var activeFilters = { type: [], brand: [], subcategory: [], time: [], body: [], oak: [], sweetness: [] };
// To:
var activeFilters = { type: [], brand: [], manufacturer: [], subcategory: [], time: [], body: [], oak: [], sweetness: [] };

// Source: line 175-182 (verified)
// Add alongside existing brand filter:
buildFilterRow('filter-brand', 'brand', 'Brand:');
buildFilterRow('filter-manufacturer', 'manufacturer', 'Producer:');  // ADD

// Source: matchesFilters() line 436 and updateFilterAvailability() line 446 (verified)
// In each function, change:
var fields = ['type', 'brand', 'subcategory', 'time', 'body', 'oak', 'sweetness'];
// To:
var fields = ['type', 'brand', 'manufacturer', 'subcategory', 'time', 'body', 'oak', 'sweetness'];

// Source: applyFilters() line 492-500 (verified)
// Add manufacturer filter check:
if (activeFilters.manufacturer.length > 0 && activeFilters.manufacturer.indexOf(r.manufacturer) === -1) return false;

// Source: Fuse.js keys line 168 (verified)
_kitsFuse = new Fuse(allProducts, {
  keys: ['name', 'brand', 'manufacturer', 'subcategory', 'tasting_notes'],  // ADD manufacturer
  // ...
});
```

### Cart sidebar producer (11-cart.js)

```javascript
// Source: js/modules/11-cart.js line 787 (verified)
// EXISTING brand display:
if (item.brand) {
  var brandEl = document.createElement('div');
  brandEl.className = 'cart-sidebar-item-brand';
  brandEl.textContent = item.brand;
  info.appendChild(brandEl);
}
// ADD producer BEFORE brand (same structure):
if (item.manufacturer) {
  var producerEl = document.createElement('div');
  producerEl.className = 'cart-sidebar-item-producer';
  producerEl.textContent = item.manufacturer;
  info.insertBefore(producerEl, brandEl || null);
}
```

### CSS for producer element

```css
/* Source: css/styles.css — new class to add */

/* For label cards (wine/beer) — sits above brand, smaller and muted */
.label-wine .producer,
.label-beer .producer {
  font-family: var(--font-body);
  font-size: 0.55rem;         /* smaller than .brand which is 0.625rem */
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  color: var(--color-muted);  /* muted vs brand's var(--color-brown) */
  margin-bottom: 0.15rem;
}

/* For default product cards */
.product-producer {
  font-size: 0.6rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-muted);
  margin-bottom: 0.1rem;
}

/* For cart sidebar */
.cart-sidebar-item-producer {
  font-size: 0.65rem;
  color: var(--color-muted);
  margin-bottom: 0.05rem;
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No producer display | Producer shown above brand on all kit surfaces | Phase 11 | Customers can distinguish RJS vs Winexpert vs Mangrove Jack's kits |
| Brand filter only | Brand + Producer filters | Phase 11 | Customers can browse by producer |

---

## Runtime State Inventory

**Not applicable** — this phase is a feature addition, not a rename/refactor/migration. No existing stored data references `manufacturer` (confirmed: zero occurrences of `manufacturer` in `content/zoho-snapshot.json`).

---

## Environment Availability

Step 2.6: SKIPPED — this phase requires no external tools, services, or CLI utilities beyond the project's own code. Node.js, npm, and the Zoho API are already in use by the project.

---

## Validation Architecture

`nyquist_validation` is `false` in `.planning/config.json`. This section is omitted per configuration.

---

## Security Domain

`security_enforcement` is enabled in `.planning/config.json`.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | — |
| V3 Session Management | No | — |
| V4 Access Control | No | — |
| V5 Input Validation | Yes | `textContent` for all producer display; `escapeHTML()` for any innerHTML contexts |
| V6 Cryptography | No | — |

### Known Threat Patterns for this Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| XSS via Zoho manufacturer field | Tampering | All card builders use `.textContent = value` (inherently safe). Kiosk uses `escapeHTML()` for template string HTML. Admin table uses `appendTd()` which uses `.textContent`. [VERIFIED: existing brand/name rendering in all target files uses textContent] |
| Prototype pollution via activeFilters | Tampering | `activeFilters` is a plain object with known keys; manufacturer is added to the initialization literal, not dynamically. No `Object.assign` or `for..in` loops operate on user input. |

**Security assessment:** This phase introduces no new security surface. The `manufacturer` field flows from Zoho (trusted data source) through middleware to the frontend. Display uses `.textContent` exclusively. No new input fields, no new API endpoints, no auth changes. Security risk is LOW.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The Zoho `/itemdetails` bulk endpoint returns a `manufacturer` field (not `manufacturer_name`) for items that have a manufacturer set in Zoho | Critical Risk section | Producer line stays blank for all products until corrected. Fallback (D-11) hides the line gracefully, so no regression — but the feature simply doesn't display anything. |
| A2 | The admin `zohoKitMap` (populated from `/api/kiosk/products`) will include `manufacturer` once the enrichment is added | Admin section | Producer column in admin table is empty. Fix: ensure kiosk enrichment loop also adds manufacturer. |
| A3 | The `shapeProduct()` function at line 810 is the right place to add manufacturer for the snapshot flow | Architecture section | If snapshot is used as a fallback and doesn't include manufacturer, some products show no producer on cache miss recovery. Low impact — snapshot is a fallback for custom fields, manufacturer comes from direct API. |

---

## Open Questions (RESOLVED)

1. **Exact Zoho field name for manufacturer in item detail response** -- RESOLVED
   - What we know: Item Groups API returns `manufacturer`. The `/itemdetails` endpoint returns `brand` (proven). Both are item-level Zoho fields.
   - **Resolution:** The Zoho API field is `manufacturer_name` (per user decisions D-05 and D-06). The enrichment code reads `detail.manufacturer_name` from the Zoho detail object and stores it as `item.manufacturer` on the enriched item, following the same pattern as `detail.brand` -> `item.brand`. The `|| ''` fallback ensures graceful degradation if the field name differs.

2. **Admin kits table data source for manufacturer** -- RESOLVED
   - What we know: `kitsData` comes from Google Sheets; `zohoKitMap` comes from `/api/kiosk/products` (Zoho API).
   - **Resolution:** The kiosk enrichment path (Location 3 in catalog.js) adds `manufacturer: detail.manufacturer_name || item.manufacturer || ''` to the returned object. The admin table renders from `zohoEntry.manufacturer` (the `zohoKitMap` entry populated from the enriched kiosk products API response), NOT from `kit.manufacturer` (which does not exist in Google Sheets data).

---

## Sources

### Primary (HIGH confidence)
- Codebase direct read — `zoho-middleware/routes/catalog.js` lines 172-194, 538-558, 720-756, 810-831 [VERIFIED]
- Codebase direct read — `js/modules/06-featured.js` lines 557-708 [VERIFIED]
- Codebase direct read — `js/modules/07-catalog-kits.js` lines 11, 165-186, 297-432, 481-508, 681-873 [VERIFIED]
- Codebase direct read — `js/modules/11-cart.js` lines 778-801 [VERIFIED]
- Codebase direct read — `js/modules/12-checkout.js` lines 555-641 [VERIFIED]
- Codebase direct read — `js/kiosk.js` lines 1170-1245, 1580-1603 [VERIFIED]
- Codebase direct read — `js/admin.js` lines 2165-2383 [VERIFIED]
- Codebase direct read — `css/styles.css` brand/producer-related selectors [VERIFIED]
- Codebase direct read — `products.html` filter container structure [VERIFIED]
- Codebase direct read — `admin.html` kits table and filter HTML [VERIFIED]

### Secondary (MEDIUM confidence)
- [Zoho Inventory Item Groups API](https://www.zoho.com/inventory/api/v1/itemgroups/) — confirms `manufacturer` field name (not `manufacturer_name`) [CITED]
- [Zoho Inventory Items API](https://www.zoho.com/inventory/api/v1/items/) — confirms individual items do not explicitly list manufacturer in documented schema [CITED]

### Tertiary (LOW confidence — needs verification)
- `detail.manufacturer` field availability in `/itemdetails` bulk response — [ASSUMED] based on: (a) item groups have the field, (b) items are instances of groups, (c) `brand` is a peer field that IS confirmed to work. Cannot verify without a live Zoho API call against an item with manufacturer set.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries, existing patterns are well-understood
- Architecture: HIGH — all 6 card builder functions, filter system, and compact view locations are verified in codebase
- Pitfalls: HIGH — field name risk is documented; all other pitfalls are verified against code
- Zoho API field name: LOW — `manufacturer` vs `manufacturer_name` requires live verification

**Research date:** 2026-05-06
**Valid until:** 2026-06-06 (30 days — stable codebase, no fast-moving dependencies)
