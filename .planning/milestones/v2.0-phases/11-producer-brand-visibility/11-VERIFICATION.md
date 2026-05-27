---
phase: 11-producer-brand-visibility
verified: 2026-05-06T23:15:00Z
status: human_needed
score: 15/15 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Load the kit catalog page (products/ferment-in-store.html) with a Zoho item that has manufacturer_name set. Confirm the Producer filter dropdown appears and filters correctly."
    expected: "A 'Producer:' filter row appears in the catalog filter panel. Selecting a producer value shows only kits from that producer. Kits without manufacturer show with no producer line above the brand."
    why_human: "Cannot verify live Zoho data via code inspection — manufacturer_name must be set in Zoho Inventory for the feature to render visibly. SUMMARY acknowledges all products currently return manufacturer: '' until Zoho data is populated."
  - test: "Add a kit with manufacturer_name set to the cart. Open the cart sidebar. Verify the item name shows 'ProducerName — KitName' format."
    expected: "Name element reads 'ProducerName — Kit Name' (em dash separator). For a kit without manufacturer, name shows without any prefix or separator."
    why_human: "Cart sidebar rendering requires live product data with manufacturer_name populated in Zoho."
  - test: "Proceed to checkout review with a kit that has a manufacturer set. Verify the Producer column appears before Brand in the review table."
    expected: "Producer column header visible in checkout table. Cell shows the manufacturer value. Column is absent when no items have manufacturer."
    why_human: "End-to-end checkout flow requires live data."
  - test: "Open kiosk grid view with a kit item that has manufacturer set. Confirm producer text appears above the product name for kit items only."
    expected: "Kit cards show producer div above name. Ingredient items do not show producer."
    why_human: "Requires live kiosk session with Zoho items that have manufacturer_name populated."
  - test: "Open admin panel Kits tab. Confirm the Producer column appears between SKU and Brand for rows where zohoKitMap has manufacturer set."
    expected: "Producer column is present in the kit table header as 'Producer'. Rows for Zoho items with manufacturer show the value; rows without show empty cell."
    why_human: "Requires admin panel loaded with zohoKitMap populated from live Zoho API."
---

# Phase 11: Producer & Brand Visibility Verification Report

**Phase Goal:** Kit product cards and all product name displays show the producer (Zoho Manufacturer field) and brand in a consistent "Producer Brand - Product Name" format, so customers can distinguish kits from multiple producers
**Verified:** 2026-05-06T23:15:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | The /api/products response includes a 'manufacturer' field for each product | VERIFIED | `catalog.js` line 177: `item.manufacturer = detail.manufacturer_name \|\| ''`; `shapeProduct()` line 820: `manufacturer: z.manufacturer \|\| ''` |
| 2 | The /api/kiosk/products response includes a 'manufacturer' field for each product | VERIFIED | `catalog.js` line 750: `manufacturer: detail.manufacturer_name \|\| item.manufacturer \|\| ''` in kiosk inline return object |
| 3 | Products with manufacturer set in Zoho show the value; products without show empty string | VERIFIED | Catalog test line 252 verifies 'RJS Craft Winemaking' flows; test line 281 verifies fallback to `''` when absent |
| 4 | Wine label cards on homepage and catalog show producer text above the brand element | VERIFIED | `06-featured.js` line 578-582, `07-catalog-kits.js` line 704-708: conditional block creates `.producer` div before `body.appendChild(brand)` |
| 5 | Beer label cards on homepage and catalog show producer text above the brand element | VERIFIED | `06-featured.js` line 659-663, `07-catalog-kits.js` line 806-810: conditional block before brand append |
| 6 | Default product cards on homepage and catalog show producer text above the brand element | VERIFIED | `06-featured.js` line 736-741, `07-catalog-kits.js` line 904-907: `.product-producer` class, `header.appendChild(cardProducer)` before `header.appendChild(cardBrand)` |
| 7 | Producer line is hidden entirely when manufacturer is blank — card looks the same as before | VERIFIED | All 6 card builders use `if (product.manufacturer)` conditional — no element created when falsy |
| 8 | Catalog page has a working Producer filter that filters kits by manufacturer | VERIFIED | `07-catalog-kits.js` line 11: `manufacturer: []` in activeFilters; line 177: `buildFilterRow('filter-manufacturer', 'manufacturer', 'Producer:')`; line 496: `activeFilters.manufacturer.indexOf(r.manufacturer)` in applyFilters; `products/ferment-in-store.html` line 182 has `id="filter-manufacturer"` container |
| 9 | Fuse.js search includes manufacturer in searchable fields | VERIFIED | `07-catalog-kits.js` line 168: `keys: ['name', 'brand', 'manufacturer', 'subcategory', 'tasting_notes']` |
| 10 | Cart sidebar shows producer inline as 'Producer — Name' format for kit items with manufacturer set | VERIFIED | `11-cart.js` lines 784-786 and 973-975: `nameEl.textContent = item.manufacturer ? item.manufacturer + ' — ' + item.name : item.name` in both sidebar renderers |
| 11 | Checkout review table has a Producer column that shows when any item has manufacturer | VERIFIED | `12-checkout.js` line 567: `var hasManufacturer = items.some(...)`; line 569: `'Producer'` in headers array; line 572: guard `label === 'Producer' && !hasManufacturer`; lines 628-633: `tdManufacturer` cell with `data-label='Producer'` |
| 12 | Kiosk grid card shows producer text above product name for kits | VERIFIED | `kiosk.js` lines 1177-1179: conditional `kiosk-product-producer` div using `escapeHTML(p.manufacturer)` gated on `kioskGetItemType(p) === 'kit'` |
| 13 | Kiosk list view shows producer inline as 'Producer — Name' format | VERIFIED | `kiosk.js` lines 1229-1231: `kioskListName` ternary with em dash, kit-type gated |
| 14 | Admin kit inventory table has a Producer column sourced from zohoKitMap | VERIFIED | `admin.js` line 2293: `zohoEntry` declared before use; line 2296: `appendTd(tr, (zohoEntry && zohoEntry.manufacturer) ? zohoEntry.manufacturer : '')`; `admin.html` line 202: `<th>Producer</th>` before `<th>Brand</th>` |
| 15 | All compact views hide producer gracefully when manufacturer is blank | VERIFIED | Cart sidebar fallback to `item.name`; checkout table conditional on `hasManufacturer`; kiosk conditional on `p.manufacturer`; admin uses `? zohoEntry.manufacturer : ''` guard |

**Score:** 15/15 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `zoho-middleware/routes/catalog.js` | Manufacturer enrichment in all 3 paths + shapeProduct() | VERIFIED | 4 manufacturer references at lines 177, 545, 750, 820 |
| `zoho-middleware/__tests__/catalog.test.js` | Tests verifying manufacturer flows through enrichment | VERIFIED | 8 manufacturer references; 3 tests: products path, fallback, kiosk path |
| `js/modules/06-featured.js` | Producer element in 3 featured card builders | VERIFIED | 6 `product.manufacturer` references; 3 conditional producer blocks; correct class names |
| `js/modules/07-catalog-kits.js` | Producer element in 3 catalog card builders + producer filter + Fuse key | VERIFIED | 5 `'manufacturer'` filter system entries; 3 producer card blocks at lines 704, 806, 904 |
| `css/styles.css` | CSS for all producer classes | VERIFIED | 5 rules at lines 4362-4407: `.label-wine .producer`, `.label-beer .producer`, `.product-producer`, `.cart-sidebar-item-producer`, `.kiosk-product-producer` |
| `products.html` | HTML container for producer filter | VERIFIED | Line 142: `<div class="catalog-filter-row" id="filter-manufacturer"></div>` between brand and subcategory |
| `products/ferment-in-store.html` | HTML container for producer filter (actual catalog page) | VERIFIED | Line 182: `<div class="catalog-filter-row" id="filter-manufacturer"></div>` |
| `tests/frontend/producer.test.js` | Frontend unit tests for producer display logic | VERIFIED | 17 test cases; passes: 36 tests across both producer test files |
| `js/modules/11-cart.js` | Inline producer display in cart sidebar | VERIFIED | 4 manufacturer references; both sidebar renderers at lines 784 and 973 |
| `js/modules/12-checkout.js` | Producer column in checkout review table | VERIFIED | `hasManufacturer`, `'Producer'` header, guard clause, `tdManufacturer` cell |
| `js/kiosk.js` | Producer display in kiosk grid and list | VERIFIED | 4 manufacturer references; grid at line 1177, list at 1229; `escapeHTML()` used throughout |
| `js/admin.js` | Producer column in admin kit inventory table | VERIFIED | `zohoEntry.manufacturer` at line 2296; zohoEntry declared first at line 2293 |
| `admin.html` | Producer column header in admin kits table | VERIFIED | `<th>Producer</th>` at line 202 before `<th>Brand</th>` |
| `tests/frontend/producer-compact.test.js` | Frontend unit tests for compact view producer display | VERIFIED | 19 test cases; all passing |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `catalog.js` | Zoho /itemdetails API | `detail.manufacturer_name` in enrichment loops | WIRED | Line 177: `item.manufacturer = detail.manufacturer_name \|\| ''`; correct Zoho field name per D-05/D-06 |
| `catalog.js shapeProduct()` | API response JSON | `z.manufacturer` mapping | WIRED | Line 820: `manufacturer: z.manufacturer \|\| ''` |
| `06-featured.js` | `product.manufacturer` | `createElement + textContent` | WIRED | Lines 578, 659, 736: all use `el.textContent = product.manufacturer`; no innerHTML |
| `07-catalog-kits.js` | `activeFilters.manufacturer` | `buildFilterRow + matchesFilters + updateFilterAvailability` | WIRED | 5 synchronization points present; `applyFilters` at line 496 has its own explicit manufacturer check |
| `products/ferment-in-store.html` | `07-catalog-kits.js` | `id='filter-manufacturer'` | WIRED | Line 182 in ferment-in-store.html (actual catalog page, not redirect) |
| `11-cart.js` | `item.manufacturer + item.name` | inline em dash format | WIRED | Both renderers use ternary; manufacturer stored in cart object at line 133 |
| `admin.js` | `zohoKitMap` | `zohoEntry.manufacturer` | WIRED | `zohoEntry` declared before producer appendTd; never uses `kit.manufacturer` |
| `kiosk.js` | `escapeHTML` | `escapeHTML(p.manufacturer)` | WIRED | Line 1178 and 1230: escapeHTML wraps manufacturer in both grid and list template strings |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `catalog.js enrichment` | `item.manufacturer` | `detail.manufacturer_name` from Zoho `/itemdetails` bulk API | Conditional — depends on Zoho Inventory data being populated | STATIC (expected) — fallback `''` when Zoho field absent; feature invisible until Zoho data set |
| `06-featured.js / 07-catalog-kits.js` | `product.manufacturer` | API response from `/api/products` | Flows from middleware when Zoho data present | FLOWING (code path complete; live data required for visible output) |
| `11-cart.js` | `item.manufacturer` | Cart object built from `product.manufacturer \|\| ''` at line 133 | Flows from product data | FLOWING |
| `12-checkout.js` | `item.manufacturer` | Cart items passed to review renderer | Flows from cart state | FLOWING |
| `kiosk.js` | `p.manufacturer` | `/api/kiosk/products` response | Flows from middleware kiosk enrichment | FLOWING |
| `admin.js` | `zohoEntry.manufacturer` | `zohoKitMap` populated from Zoho API | Separate from kitsData (Sheets); requires live Zoho kiosk products fetch | FLOWING (correct data source identified and used) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Middleware catalog tests pass (manufacturer enrichment) | `cd zoho-middleware && npm test --testPathPattern=catalog` | 23 tests passed, 0 failed | PASS |
| Frontend producer tests pass | `npm test --testPathPattern=producer` | 36 tests passed, 0 failed (both producer.test.js and producer-compact.test.js) | PASS |
| catalog.js has 4 manufacturer locations | `grep -c 'manufacturer' catalog.js` | 4 | PASS |
| build artifact includes manufacturer | `grep -c 'manufacturer' js/main.js` | 25 | PASS |
| All 8 phase commits exist | `git log --oneline` | All 8 commits verified (7c5f6e9 through 18eb878) | PASS |
| applyFilters includes manufacturer check | `grep 'activeFilters.manufacturer' 07-catalog-kits.js` | Line 496 explicit check present | PASS |
| XSS safety — no innerHTML with manufacturer | `grep 'innerHTML.*manufacturer'` in DOM modules | 0 matches; all use textContent or escapeHTML() | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| PROD-VIS-01 | 11-01-PLAN.md | Middleware pipes Zoho manufacturer field through catalog enrichment and returns it in product API response | SATISFIED | `catalog.js` enrichment at 3 paths + `shapeProduct()`; 3 middleware tests verify flow |
| PROD-VIS-02 | 11-02-PLAN.md | All kit card types (wine label, beer label, default) display producer and brand above or before the product name | SATISFIED | All 6 card builders wired; conditional on truthy manufacturer; correct class names and DOM order |
| PROD-VIS-03 | 11-02-PLAN.md, 11-03-PLAN.md | Checkout review, cart sidebar, kiosk cards, and admin views show producer/brand context where space allows | SATISFIED | 4 surfaces implemented: cart sidebar inline format, checkout table Producer column, kiosk grid+list, admin kits table |

### Anti-Patterns Found

None found in phase-modified files. Specific checks performed:

- No TODO/FIXME/placeholder comments adjacent to producer/manufacturer code
- No `return null` or empty implementations in producer-related functions
- No hardcoded empty arrays passed as manufacturer values at call sites
- No `.innerHTML` used with manufacturer values in DOM-based modules (kiosk.js correctly uses `escapeHTML()`)
- No duplicate `zohoEntry` declaration in admin.js foreach loop (SUMMARY confirms it was moved and deduped)

### Human Verification Required

The automated code-level verification is complete and all 15 must-haves are wired. The following tests require a live environment because the feature is invisible until Zoho Inventory items have `manufacturer_name` populated — all code paths fall back to empty string gracefully when Zoho data is absent.

#### 1. Catalog Producer Filter — Live Data

**Test:** Open `products/ferment-in-store.html` in a browser. The catalog must be loaded from the live middleware (or staging). Find a kit that has `manufacturer_name` set in Zoho Inventory.
**Expected:** A "Producer:" filter row appears in the catalog sidebar filter panel. Selecting a producer value filters the kit list to only matching kits. Kits without manufacturer show no producer line and are not excluded.
**Why human:** No static test data exists for manufacturer_name in Zoho. The `buildFilterRow` dynamically populates from distinct product values — empty when all products return `manufacturer: ''`.

#### 2. Kit Card Producer Display — Live Data

**Test:** On the homepage or catalog page, find a kit where `manufacturer_name` is set in Zoho. Inspect the card DOM.
**Expected:** A `.producer` div (or `.product-producer` for default cards) appears above the `.brand` element. Text reads the manufacturer name. Font is smaller and muted compared to brand text.
**Why human:** Requires a Zoho item with manufacturer_name set to validate the visual hierarchy matches 11-UI-SPEC.md.

#### 3. Cart Sidebar Inline Format — Live Data

**Test:** Add a kit with manufacturer set to the ferment-in-store cart. Open the cart sidebar.
**Expected:** The item name line reads "ManufacturerName — Kit Name" with an em dash separator. The brand renders separately below as usual.
**Why human:** Cart item data requires a live product with manufacturer_name set to flow through to the sidebar display.

#### 4. Checkout Review Table Producer Column — Live Data

**Test:** Proceed to checkout with a kit that has manufacturer set. View the order review table.
**Expected:** A "Producer" column appears to the left of "Brand." The cell shows the manufacturer name. For a cart with no items having manufacturer, the column is absent.
**Why human:** Requires a populated cart with live Zoho product data.

#### 5. Kiosk Grid and Admin Kit Table — Live Admin Session

**Test:** (a) Open the kiosk grid view with a Zoho kit that has manufacturer_name set. (b) Open the admin panel Kits tab.
**Expected:** (a) Kiosk kit cards show a small producer line above the kit name. Ingredient items do not show producer. (b) Admin kits table has a "Producer" column header; rows with Zoho manufacturer show the value.
**Why human:** Kiosk and admin both require authenticated sessions with live zohoKitMap data.

### Gaps Summary

No code-level gaps found. All 15 must-haves verified at all four levels (exists, substantive, wired, data-flow path complete).

The only pending items are live-environment validations that confirm the feature renders correctly once Zoho Inventory items have `manufacturer_name` populated. These are flagged as human verification items, not code gaps.

---

_Verified: 2026-05-06T23:15:00Z_
_Verifier: Claude (gsd-verifier)_
