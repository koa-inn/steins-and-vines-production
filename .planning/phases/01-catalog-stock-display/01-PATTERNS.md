# Phase 1: Catalog & Stock Display - Pattern Map

**Mapped:** 2026-04-27
**Files analyzed:** 2 (1 modified, 1 verify-only)
**Analogs found:** 2 / 2

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `js/kiosk.js` (modify multiple functions) | component | event-driven | Self-analog (patterns within same file) | exact |
| `zoho-middleware/routes/pos.js` (verify only) | controller | request-response | N/A (no code change) | N/A |

---

## Pattern Assignments

### `js/kiosk.js` — Category Fix (CAT-01, CAT-02)

All changes are within the existing `js/kiosk.js` file. The analog patterns are functions already in this file.

**Function to modify: `kioskItemCategory()`** (line 761-763)

Current implementation:
```javascript
// Source: js/kiosk.js lines 761-763
function kioskItemCategory(p) {
  return p.category_name || p.cf_type || p.product_type || '';
}
```

Change: Remove `cf_type` and `product_type` fallbacks per D-05/D-08. New body: `return p.category_name || '';`

---

**Function to modify: `kioskPopulateCategories()`** (lines 941-975)

Analog pattern — how existing categories are built:
```javascript
// Source: js/kiosk.js lines 941-975
function kioskPopulateCategories() {
  var sel = document.getElementById('kiosk-category-filter');
  if (!sel) return;

  var typeFilter = _kioskFilters.type;
  var cats = {};
  _kioskProducts.forEach(function (p) {
    // Filter categories based on selected type
    if (typeFilter === 'consignment') {
      if (!kioskIsConsignment(p)) return;
    } else if (typeFilter) {
      if ((p.product_type || '').toLowerCase() !== typeFilter) return;
    }
    var cat = kioskItemCategory(p);
    if (cat) cats[cat] = true;
  });

  var prev = sel.value;
  while (sel.options.length > 1) sel.remove(1);

  Object.keys(cats).sort().forEach(function (cat) {
    var opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    sel.appendChild(opt);
  });

  // Restore previous selection if still valid
  if (cats[prev]) {
    sel.value = prev;
  } else {
    sel.value = '';
    _kioskFilters.category = '';
  }
}
```

Change: After the `Object.keys(cats).sort().forEach(...)` block, check if any filtered product has empty `category_name` and append an "Other" `<option>` with sentinel value `__other__`. Preserve the `prev` restore logic — also check `prev === '__other__'`.

---

**Function to modify: `kioskGetFilteredProducts()`** (lines 979-1012)

Analog pattern — current category filter logic (lines 994-996):
```javascript
// Source: js/kiosk.js lines 994-996
// Category filter
var itemCat = kioskItemCategory(p);
if (cat && itemCat.toLowerCase() !== cat.toLowerCase()) return false;
```

Change: Add branch for `__other__` sentinel: `if (cat === '__other__') { if (itemCat !== '') return false; }` before the existing comparison.

---

**Functions to verify/modify for category badge suppression (D-07):**

Grid view — `kioskRenderProductGrid()` (lines 1053-1122):
```javascript
// Source: js/kiosk.js lines 1091-1095
// Grid cards show consignment/service badges, NOT category badges
if (itemType === 'consignment') {
  html += '<div class="kiosk-consignment-badge">Consignment</div>';
} else if (isService) {
  html += '<div class="kiosk-service-badge">Service</div>';
}
```
No category badge rendered in grid view. No change needed for D-07 here.

List view — `kioskRenderProductList()` (lines 1125-1201):
```javascript
// Source: js/kiosk.js line 1157
html += '<td>' + escapeHTML(cat) + '</td>';
```
This renders `cat` (from `kioskItemCategory(p)`) in a table cell. After the category fix, `cat` will be `''` for uncategorized items, which renders as an empty cell. Acceptable — no change needed.

Customer browse wine card — `kioskCbRenderWineCard()` (lines 1250-1271):
```javascript
// Source: js/kiosk.js line 1260
if (cat) html += '<div class="cb-product-category">' + escapeHTML(cat) + '</div>';
```
Already guarded with `if (cat)` — suppresses badge when category is empty. No change needed.

Customer browse beer card — `kioskCbRenderBeerCard()` (lines 1273-1293):
```javascript
// Source: js/kiosk.js line 1281
html += '<div class="cb-product-category">' + escapeHTML(cat || 'Beer') + '</div>';
```
Uses `cat || 'Beer'` intentional fallback (Pitfall 5). No change needed — this is display-only for a specific card type.

Customer browse generic card — `kioskCbRenderCard()` (lines 1296-1323):
```javascript
// Source: js/kiosk.js line 1314
if (cat) html += '<div class="cb-card-category">' + escapeHTML(cat) + '</div>';
```
Already guarded with `if (cat)` — suppresses badge when category is empty. No change needed.

---

### `js/kiosk.js` — Stock Overflow Warning (STOCK-02)

**Analog pattern — existing out-of-stock confirm dialog** (lines 1115-1118):
```javascript
// Source: js/kiosk.js lines 1115-1118 (grid card click handler)
var isService = (product.product_type || '').toLowerCase() === 'service';
var stock = parseFloat(product.stock_on_hand) || 0;
if (!isService && stock <= 0) {
  if (!confirm('"' + (product.name || 'This item') + '" is out of stock. Add to cart anyway (special order)?')) return;
}
```

Same pattern repeated at lines 1193-1197 (list row click handler):
```javascript
// Source: js/kiosk.js lines 1193-1197
var isService = (product.product_type || '').toLowerCase() === 'service';
var stock = parseFloat(product.stock_on_hand) || 0;
if (!isService && stock <= 0) {
  if (!confirm('"' + (product.name || 'This item') + '" is out of stock. Add to cart anyway (special order)?')) return;
}
```

New helper follows the same `confirm()` + early-return pattern. Must mirror:
- `parseFloat(product.stock_on_hand) || 0` for stock parsing
- `(product.product_type || '').toLowerCase() === 'service'` for service check
- `(product.name || 'This item')` for name display
- `confirm(...)` with `return` on cancel
- `kioskIsWeightItem(product)` exemption (analog: line 1207 branch in `kioskAddToCart`)

---

**Function to modify: `kioskAddToCart()`** (lines 1205-1228)

Analog pattern — current entry points:
```javascript
// Source: js/kiosk.js lines 1205-1228
function kioskAddToCart(product) {
  var id = product.item_id;
  if (kioskIsWeightItem(product)) {
    var input = prompt('Enter quantity in kg for "' + (product.name || '') + '":', _kioskCart[id] ? _kioskCart[id].qty : '1');
    if (input === null) return;
    var qty = parseFloat(input);
    if (!isFinite(qty) || qty <= 0) return;
    qty = Math.round(qty * 1000) / 1000;
    _kioskCart[id] = { item: product, qty: qty };
  } else if (_kioskCart[id]) {
    _kioskCart[id].qty += 1;
  } else {
    _kioskCart[id] = { item: product, qty: 1 };
  }

  // If adding a kit, reset waiver and sync maker's fee
  if (kioskGetItemType(product) === 'kit') {
    _kioskMakersFeeWaived = false;
    kioskSyncMakersFee();
  }

  kioskRenderCart();
  kioskRenderProducts();
}
```

Stock overflow check insertion point: After the weight-item branch (weight items exempt per A1), before the `else if (_kioskCart[id])` branch. Compute `newQty` = existing cart qty + 1 (or 1 if not in cart), then call the overflow check helper. If the user cancels the confirm, `return` without modifying `_kioskCart`.

---

**Function to modify: `kioskSetQty()`** (lines 1419-1431)

```javascript
// Source: js/kiosk.js lines 1419-1431
function kioskSetQty(itemId, qty) {
  var wasKit = _kioskCart[itemId] && kioskGetItemType(_kioskCart[itemId].item) === 'kit';
  if (qty <= 0) {
    delete _kioskCart[itemId];
  } else {
    if (_kioskCart[itemId]) {
      _kioskCart[itemId].qty = qty;
    }
  }
  if (wasKit) kioskSyncMakersFee();
  kioskRenderCart();
  kioskRenderProducts();
}
```

Stock overflow check insertion point: At the top of the `else` branch (when `qty > 0`), before `_kioskCart[itemId].qty = qty`. The `qty` argument IS the new total (not a delta — see Pitfall 2). Check `qty > stock` using the product from `_kioskCart[itemId].item`. Skip check for weight items and services. Skip check if qty is decreasing (i.e., `qty <= _kioskCart[itemId].qty`).

---

**Analog pattern — cart qty button wiring** (lines 1505-1512):
```javascript
// Source: js/kiosk.js lines 1505-1512
container.querySelectorAll('.kiosk-qty-btn').forEach(function (btn) {
  btn.addEventListener('click', function () {
    var id = btn.getAttribute('data-id');
    var action = btn.getAttribute('data-action');
    if (!_kioskCart[id]) return;
    var newQty = _kioskCart[id].qty + (action === 'inc' ? 1 : -1);
    kioskSetQty(id, newQty);
  });
});
```

No change needed here — the overflow check goes inside `kioskSetQty`, which this code already calls with the computed `newQty`.

**Analog pattern — cart qty input handlers** (lines 1515-1546):
```javascript
// Source: js/kiosk.js lines 1515-1546
// 'input' event (fires on every keystroke — DO NOT add confirm here, Pitfall 3)
input.addEventListener('input', function () {
  var id = input.getAttribute('data-id');
  var val = parseFloat(input.value);
  if (!_kioskCart[id] || !isFinite(val) || val <= 0) return;
  _kioskCart[id].qty = Math.round(val * 1000) / 1000;
  // ... updates totals display inline (non-blocking)
});
// 'change' event (fires on blur/enter — calls kioskSetQty, where overflow check runs)
input.addEventListener('change', function () {
  var id = input.getAttribute('data-id');
  var val = parseFloat(input.value);
  if (!isFinite(val) || val <= 0) {
    kioskRemoveFromCart(id);
  } else {
    kioskSetQty(id, Math.round(val * 1000) / 1000);
  }
});
```

No change needed here — the `change` handler calls `kioskSetQty`, which is where the overflow check runs. The `input` handler must remain non-blocking (no `confirm()` dialog on every keystroke).

---

### `zoho-middleware/routes/pos.js` — Cache Bust Verification (D-09)

**Already implemented at two locations:**

```javascript
// Source: zoho-middleware/routes/pos.js lines 341-343 (main sale path)
return paymentChain.then(function () {
  // Invalidate kiosk product cache so stock counts refresh
  cache.del(KIOSK_PRODUCTS_CACHE_KEY);
```

```javascript
// Source: zoho-middleware/routes/pos.js lines 660-661 (confirm-payment path)
return paymentChain.then(function () {
  cache.del(KIOSK_PRODUCTS_CACHE_KEY);
```

No code change required. Verify-only task: confirm `KIOSK_PRODUCTS_CACHE_KEY` resolves to `'zoho:kiosk-products'` (defined in `zoho-middleware/lib/constants.js`).

---

## Shared Patterns

### Stock Parsing
**Source:** `js/kiosk.js` (used throughout)
**Apply to:** All stock-related logic in this phase
```javascript
var stock = parseFloat(product.stock_on_hand) || 0;
```

### Service Detection
**Source:** `js/kiosk.js` lines 1115, 1193
**Apply to:** The new `kioskCheckStockOverflow()` helper
```javascript
var isService = (product.product_type || '').toLowerCase() === 'service';
```

### Weight Item Detection
**Source:** `js/kiosk.js` lines 765-767
**Apply to:** The new overflow helper (exempt weight items)
```javascript
function kioskIsWeightItem(p) {
  return (p.unit || '').toLowerCase() === 'kg';
}
```

### Confirm Dialog Pattern
**Source:** `js/kiosk.js` line 1118
**Apply to:** New stock overflow confirm
```javascript
if (!confirm('"' + (product.name || 'This item') + '" is out of stock. Add to cart anyway (special order)?')) return;
```

### HTML Escaping
**Source:** `js/lib/utils.js`
**Apply to:** Any new rendered text (category labels, dialog messages in DOM)
```javascript
escapeHTML(value)
```

### ES5 Style
**Source:** Entire `js/kiosk.js` file
**Apply to:** All new code
- Use `var`, not `let`/`const`
- Use `function` declarations, not arrow functions
- Use `.forEach(function(x) {...})`, not `.forEach(x => ...)`
- Use string concatenation with `+`, not template literals

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| (none) | — | — | All changes are within existing files with exact self-analog patterns |

---

## Metadata

**Analog search scope:** `js/kiosk.js`, `zoho-middleware/routes/pos.js`, `zoho-middleware/lib/constants.js`
**Files scanned:** 3
**Pattern extraction date:** 2026-04-27
