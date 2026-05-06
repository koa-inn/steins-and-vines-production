---
phase: 11-producer-brand-visibility
reviewed: 2026-05-06T00:00:00Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - admin.html
  - css/styles.css
  - js/admin.js
  - js/kiosk.js
  - js/modules/06-featured.js
  - js/modules/07-catalog-kits.js
  - js/modules/11-cart.js
  - js/modules/12-checkout.js
  - products.html
  - products/ferment-in-store.html
  - tests/frontend/producer-compact.test.js
  - tests/frontend/producer.test.js
  - zoho-middleware/__tests__/catalog.test.js
  - zoho-middleware/routes/catalog.js
findings:
  critical: 1
  warning: 3
  info: 2
  total: 6
status: issues_found
---

# Phase 11: Code Review Report

**Reviewed:** 2026-05-06
**Depth:** standard
**Files Reviewed:** 14
**Status:** issues_found

## Summary

Phase 11 adds producer (manufacturer) brand visibility to product cards, catalog filters, cart sidebars, checkout table, and kiosk grid. The middleware catalog route correctly enriches `manufacturer` from `detail.manufacturer_name`. Display in card builders (06-featured.js, 07-catalog-kits.js), kiosk grid (kiosk.js), and checkout (12-checkout.js) is implemented correctly. Tests in `producer.test.js` and `producer-compact.test.js` exercise these display paths and pass by inspection.

Two defects undermine correctness: (1) the Producer filter UI is built and tracks state but is never applied in `applyFilters()`, making the filter a no-op, and (2) `manufacturer` is not persisted into cart items in `setReservationQty()`, causing the cart sidebar and cart drawer to silently show the wrong name format for items added after the cart is empty. One additional warning covers a leftover `console.log` in a hot path.

---

## Critical Issues

### CR-01: Producer filter has no effect — `activeFilters.manufacturer` is never checked in `applyFilters()`

**File:** `js/modules/07-catalog-kits.js:493-509`

**Issue:** `applyFilters()` checks `activeFilters.type`, `activeFilters.brand`, `activeFilters.subcategory`, `activeFilters.time`, `activeFilters.body`, `activeFilters.oak`, and `activeFilters.sweetness`, but does NOT check `activeFilters.manufacturer`. The filter row for Producer is built (`buildFilterRow('filter-manufacturer', 'manufacturer', 'Producer:')` at line 177), the state is tracked in `activeFilters.manufacturer`, and the button UI is toggled — but clicking a Producer filter button has zero effect on the displayed products. Users see the filter appear active with no products being filtered.

The same omission does not appear in `matchesFilters()` (line 437) which does include `manufacturer` in its field list — that function is used only by `updateFilterAvailability()`, not by the primary `applyFilters()` render path.

**Fix:** Add the manufacturer check inside the `filtered` callback in `applyFilters()`, immediately after the `brand` check (line 495):

```javascript
// After line 495:
if (activeFilters.brand.length > 0 && activeFilters.brand.indexOf(r.brand) === -1) return false;
// ADD THIS LINE:
if (activeFilters.manufacturer.length > 0 && activeFilters.manufacturer.indexOf(r.manufacturer) === -1) return false;
if (activeFilters.subcategory.length > 0 && activeFilters.subcategory.indexOf(r.subcategory) === -1) return false;
```

---

## Warnings

### WR-01: `manufacturer` not persisted to cart item — cart sidebar/drawer shows wrong name format for newly added items

**File:** `js/modules/11-cart.js:130-147`

**Issue:** `setReservationQty()` pushes a new cart item object to localStorage without including `manufacturer`. However, `renderCartSidebar()` (line 784) and `renderCartDrawer()` (line 973) both read `item.manufacturer` to format the display name as `"RJS Craft Winemaking — Pinot Noir Kit"`. Because `manufacturer` is never stored, the retrieved cart object always has `undefined` for this field, so the sidebar always falls back to showing only `item.name` without the producer prefix — silently breaking the feature for any item added after page load.

Note: The tests in `producer-compact.test.js` test the display logic against a mock `item` with `manufacturer` pre-populated; they do not exercise the round-trip through `setReservationQty` + localStorage, so they do not catch this regression.

**Fix:** Add `manufacturer` to the object pushed in `setReservationQty`:

```javascript
items.push({
  name: product.name,
  brand: product.brand || '',
  manufacturer: product.manufacturer || '',   // ADD THIS LINE
  price: product.retail_instore || product.retail_kit || product.price_per_unit || product.price || '',
  // ... rest of fields unchanged
});
```

### WR-02: `console.log` left in `refreshAllReserveControls()` — fires on every cart mutation

**File:** `js/modules/11-cart.js:172`

**Issue:** `console.log('[Cart] Refreshing ' + wraps.length + ' reserve controls')` is called every time `setReservationQty` runs (which calls `refreshAllReserveControls()`). On the products page with 50+ cards this fires on every click of every qty button, every "Add to Cart", and every "Reserve" press. This is a production debug artifact in a hot path.

**Fix:** Remove the `console.log` call.

```javascript
function refreshAllReserveControls() {
  var wraps = document.querySelectorAll('.product-reserve-wrap');
  // Remove: console.log('[Cart] Refreshing ' + wraps.length + ' reserve controls');
  wraps.forEach(function (wrap) {
```

### WR-03: `kiosk.js` local `escapeHTML` does not escape single quotes — inconsistent with `js/lib/utils.js`

**File:** `js/kiosk.js:526-532`

**Issue:** The kiosk module defines its own `escapeHTML` which escapes `&`, `<`, `>`, `"` but not single quotes (`'`). The shared `js/lib/utils.js` escapeHTML escapes `'` to `&#39;`. The kiosk escapeHTML is used in `innerHTML` assignments in `kioskRenderProductGrid` and `kioskRenderProductList`, including `manufacturer` and `name` values in HTML attribute contexts (e.g. `data-item-id` at line 1227: `escapeHTML(p.item_id)`). If an item ID or manufacturer name contains a single quote and is placed inside an HTML attribute value delimited by single quotes, the attribute could break. While current usage does not appear to construct single-quote-delimited attribute values with user data, the divergence creates a maintenance hazard and could produce rendering defects if a product name or manufacturer value contains an apostrophe.

**Fix:** Add single-quote escaping to the local `escapeHTML` in `kiosk.js`, matching `js/lib/utils.js`:

```javascript
function escapeHTML(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');   // ADD THIS LINE
}
```

Alternatively, remove the local definition and rely on the global `escapeHTML` from `js/lib/utils.js` which is already loaded before `kiosk.js` via `<script src="js/lib/utils.js" defer>`.

---

## Info

### IN-01: `producer-compact.test.js` does not test the `setReservationQty` → cart storage → display round-trip

**File:** `tests/frontend/producer-compact.test.js:24-28`

**Issue:** The test for cart sidebar name format (Tests 1-3) mirrors the display logic from `renderCartSidebar` / `renderCartDrawer` directly, constructing test `item` objects with `manufacturer` pre-set. There is no test that verifies `manufacturer` is present on a cart item after `setReservationQty` is called with a product that has `manufacturer`. This gap is what allowed WR-01 to ship undetected.

**Fix:** Add a test that calls `setReservationQty(product, 1)` with a product containing `manufacturer`, reads back from `getReservation()`, and asserts that the stored item has the `manufacturer` field.

### IN-02: `kiosk.js` `console.log` / `console.warn` in auth flow left in production code

**File:** `js/kiosk.js:134, 143, 171, 192, 196`

**Issue:** Several `console.log` and `console.warn` calls remain in the production kiosk auth flow, including logging `userEmail` to the browser console (`console.log('[Kiosk] Checking authorization for:', userEmail)` at line 192). While auth flows benefit from some debug logging, PII (email) should not appear in browser console logs in production per the project's PII policy.

**Fix:** Remove the `userEmail` value from the `console.log` at line 192, or remove the log entirely. The other `console.warn` calls for silent refresh failures are lower severity but should be reviewed for production removal.

```javascript
// Line 192 — remove userEmail from log:
console.log('[Kiosk] Checking authorization...');
```

---

_Reviewed: 2026-05-06_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
