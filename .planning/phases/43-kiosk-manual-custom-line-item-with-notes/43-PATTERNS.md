# Phase 43: Kiosk manual custom line item with notes - Pattern Map

**Mapped:** 2026-06-26
**Files analyzed:** 4 (zoho-middleware/routes/pos.js, js/kiosk.js, js/admin.js, new test file)
**Analogs found:** 4 / 4

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `zoho-middleware/routes/pos.js` | route/service | request-response, CRUD | self (extend existing) | exact — two handlers extended in place |
| `js/kiosk.js` | UI component / standalone bundle | event-driven, request-response | self (kiosk.js `kioskRenderCart`, `kioskCalcTotals`, `kioskProceedToPayment`) | exact — extend in place |
| `js/admin.js` | UI component / admin-embedded fork | event-driven, request-response | `js/kiosk.js` counterparts (admin has named-same functions at different line offsets) | exact fork — duplicate every kiosk.js change here |
| `zoho-middleware/__tests__/pos-custom-line.test.js` (new) | test | — | `zoho-middleware/__tests__/pos-tax.test.js` + `pos-discount.test.js` | exact — same mocking harness |

---

## Pattern Assignments

---

### `zoho-middleware/routes/pos.js` (route, request-response) — EXTEND IN PLACE

**Primary analogs (within the same file):**
- `computeTax` (lines 116–139) — will gain a custom-line branch
- `resolveDiscount` (lines 41–113) — will gain a custom-line skip guard
- `processSale` / `processSale` catalog-rejection loop (lines 217–302) — validation loop extended
- `/api/kiosk/sale/confirm` handler (lines 409–545) — lineItems builder extended
- `/api/pos/sale` Zoho line shape (lines 629–634) — proven ad-hoc line shape to copy

#### Imports pattern (lines 1–18):
```javascript
var express = require('express');
var helcimLib = require('../lib/helcim');
var zohoApi = require('../lib/zoho-api');
var cache = require('../lib/cache');
var log = require('../lib/logger');
var eventLog = require('../lib/eventLog');
var mailer = require('../lib/mailer');
var ledger = require('../lib/inventory-ledger');
var C = require('../lib/constants');
var brewpadIntegration = require('../lib/brewpad-integration');
var discountMatch = require('../lib/discount-match');

var KIOSK_PRODUCTS_CACHE_KEY = C.CACHE_KEYS.KIOSK_PRODUCTS;
```

#### Tax rule constants pattern (lines 26–30):
```javascript
var _TAX_RULE_PCT = {};
_TAX_RULE_PCT[process.env.ZOHO_TAX_STANDARD_RULE || '109900000000033423'] = 12;
_TAX_RULE_PCT[process.env.ZOHO_TAX_ZERO_RULE     || '109900000000033411'] = 0;
_TAX_RULE_PCT[process.env.ZOHO_TAX_SERVICES_RULE || '109900000000033417'] = 5;  // GST 5% — the target for custom taxable lines
_TAX_RULE_PCT[process.env.ZOHO_TAX_LIQUOR_RULE   || '109900000000033429'] = 15;
```
**Key insight:** `ZOHO_TAX_SERVICES_RULE` (5%) is the rule whose `tax_id` must be discovered for taxable custom lines (D-02). The catalog auto-discovery approach: scan `KIOSK_PRODUCTS_CACHE_KEY` for any item whose `sales_tax_rule_id === process.env.ZOHO_TAX_SERVICES_RULE` and reuse its `tax_id`.

#### `computeTax` — current pattern (lines 116–139):
```javascript
function computeTax(lineItems, catalogMap) {
  var taxTotal = 0;
  var defaultTaxRate = parseFloat(process.env.KIOSK_TAX_RATE) || 0.05;
  lineItems.forEach(function (li) {
    var catalogItem = catalogMap[li.item_id];  // <-- crashes when item_id absent (custom line)
    var lineTotal = li.quantity * li.rate;
    if (li.discount) {
      if (typeof li.discount === 'string' && li.discount.indexOf('%') !== -1) {
        lineTotal = lineTotal * (1 - parseFloat(li.discount) / 100);
      } else {
        lineTotal = lineTotal - Number(li.discount);
      }
    }
    lineTotal = Math.max(lineTotal, 0);
    var pct = catalogItem.tax_percentage || 0;
    if (catalogItem.sales_tax_rule_id && _TAX_RULE_PCT[catalogItem.sales_tax_rule_id] !== undefined) {
      pct = _TAX_RULE_PCT[catalogItem.sales_tax_rule_id];
    } else if (!pct && !catalogItem.tax_id) {
      pct = defaultTaxRate * 100;
    }
    taxTotal += lineTotal * ((pct || 0) / 100);
  });
  return Math.round(taxTotal * 100) / 100;
}
```
**Guard to add:** At the top of the `forEach` loop, before accessing `catalogMap[li.item_id]`:
```javascript
if (li.custom) {
  // Custom line: use line's own taxable flag (pct already set on li when built)
  var lineTotal = li.quantity * li.rate;
  // ... apply discount same way ...
  taxTotal += lineTotal * ((li.tax_percentage || 0) / 100);
  return; // skip catalog lookup
}
```

#### `resolveDiscount` type-scope — catalog lookup pattern (lines 72–76):
```javascript
var matchFlags = lineItems.map(function (li) {
  var tokens = discountMatch.classifyCatalogItem(catalogMap[li.item_id]);  // crashes on custom line
  var m = discountMatch.matches(tokens, preset.applies_to);
  if (m) matchedSubtotal += li.quantity * li.rate;
  return m;
});
```
**Guard to add (D-08):** `if (li.custom) return false;` before the `classifyCatalogItem` call. Custom lines are never discounted. Same guard needed for cart-scope `lineItems.forEach` — custom lines receive no discount share.

#### Catalog-rejection loop in `processSale` (lines 251–258):
```javascript
for (var ci = 0; ci < body.items.length; ci++) {
  var cItem = body.items[ci];
  if (catalogMap[cItem.item_id] === undefined) {
    return res.status(400).json({
      error: 'Item not found in current catalog: ' + cItem.item_id +
        '. Refresh the product list and try again.'
    });
  }
}
```
**Guard to add:** `if (cItem.custom) continue;` at the top of this loop — custom lines have no `item_id` and must bypass the catalog check.

#### Structural validation loop in `processSale` (lines 227–236):
```javascript
for (var v = 0; v < body.items.length; v++) {
  var vi = body.items[v];
  if (!vi.item_id || typeof vi.item_id !== 'string' || vi.item_id.length > 64) {
    return res.status(400).json({ error: 'Invalid item_id for item ' + v });
  }
  var vQty = Number(vi.quantity);
  if (!isFinite(vQty) || vQty <= 0 || vQty > 100) {
    return res.status(400).json({ error: 'Invalid quantity for item ' + v });
  }
}
```
**Guard to add:** branch at top — `if (vi.custom) { /* validate custom-line fields instead */ continue; }`. Custom-line validation: description required 1–100 chars, rate numeric, rate magnitude `<= 10000` (server-side cap), quantity integer 1–100.

#### lineItems builder in `processSale` (lines 264–280):
```javascript
var lineItems = body.items.map(function (item) {
  var qty = Number(item.quantity) || 1;
  var catalogItem = catalogMap[item.item_id];
  var rate = catalogItem.rate; // authoritative price from catalog
  subtotal += qty * rate;
  var li = {
    item_id: item.item_id,
    name: item.name || '',
    sku: catalogItem.sku || '',
    quantity: qty,
    rate: rate
  };
  if (catalogItem.tax_id) {
    li.tax_id = catalogItem.tax_id;
  }
  return li;
});
```
**Custom-line branch to add:** `if (item.custom) { /* build from item fields directly; attach resolved GST tax_id when taxable */ }`. The `rate` comes from the client (D-03 — the one place client price is trusted, but server caps magnitude). Tax_id resolution order per D-02: `process.env.KIOSK_GST_TAX_ID` → auto-discover from catalog → fail-closed.

#### `/api/kiosk/sale/confirm` — lineItems builder (lines 430–440):
```javascript
var lineItems = body.items.map(function (item) {
  var qty = Number(item.quantity) || 1;
  var catalogItem = catalogMap[item.item_id];
  var rate = catalogItem.rate;
  subtotal += qty * rate;
  var li = { item_id: item.item_id, name: item.name || '', sku: catalogItem.sku || '', quantity: qty, rate: rate };
  if (catalogItem.tax_id) {
    li.tax_id = catalogItem.tax_id;
  }
  return li;
});
```
**Identical custom-line branch needed here** — confirm also rejects items not in catalog (line 424), so the same `if (body.items[ci].custom) continue;` guard applies.

#### `/api/kiosk/sale/confirm` — catalog-rejection guard (lines 423–426):
```javascript
for (var ci = 0; ci < body.items.length; ci++) {
  if (catalogMap[body.items[ci].item_id] === undefined) {
    return res.status(400).json({ error: 'Item not found in catalog. Refresh and try again.' });
  }
}
```
Same skip-if-custom guard required.

#### Proven ad-hoc Zoho invoice line shape from `/api/pos/sale` (lines 629–634):
```javascript
line_items: [{
  // Zoho Books accepts a description-only line item when no item_id is available.
  description: soNumber ? ('POS sale — ' + soNumber) : 'In-store POS sale',
  rate: amount,
  quantity: 1
}]
```
**This is the canonical shape for custom lines.** For a taxable custom line, add `tax_id: resolvedGstTaxId`. For D-04, `description` becomes `"<Description> — <Note>"` (or just `<Description>` when note is blank). No `item_id`, no `sku`.

#### `decrementStock` — already self-guards (line 118):
```javascript
lineItems.forEach(function (line) {
  if (!line || !line.item_id || !line.quantity) return;  // already skips missing item_id
  ...
});
```
**No change needed** — custom lines (no `item_id`) are silently skipped by the existing guard.

#### `createBatchesFromSale` — already self-guards via `detectKitItems`:
```javascript
function detectKitItems(lineItems) {
  var feeItem = checkoutHelpers.findMakersFeeItem(lineItems, makersFeeItemId);
  if (!feeItem) return [];  // No Maker's Fee = not a ferment-in-store sale — returns [] immediately
  ...
}
```
**No change needed** — custom lines have no Maker's Fee item, so `detectKitItems` returns `[]` for any cart without a Maker's Fee. (A cart WITH a Maker's Fee that also has custom lines: `detectKitItems` returns non-fee items, but custom lines have no `product_sku`/`item_id` so the batch payload will just have blank `product_sku` — fire-and-forget, acceptable. The planner should confirm whether an explicit `if (item.custom) return;` guard is needed inside `detectKitItems` to be safe.)

#### Module exports (lines 2207–2210):
```javascript
module.exports = router;
module.exports.resolveDiscount = resolveDiscount;
module.exports.computeTax = computeTax;
```
Add `module.exports.resolveGstTaxId = resolveGstTaxId;` if a standalone helper is extracted (enables unit testing).

---

### `js/kiosk.js` (UI component, standalone bundle, event-driven)

**Note:** kiosk.js is NOT part of the `concat:js` build — it is a standalone file. Do not run `npm run build` for kiosk.js changes; the file IS the artifact. However, kiosk.min.js IS built from it, so after edits run `npm run build` (or the relevant terser step) to regenerate the minified version.

#### `escapeHTML` — canonical kiosk.js copy (lines 527–535):
```javascript
// escapeHTML — canonical apostrophe-escaping implementation (mirrors js/lib/utils.js).
// kiosk.js is a standalone bundle (not part of concat:js) so carries its own copy.
function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
```
Use `escapeHTML()` on every user-entered field (description, note) before injecting into HTML. Use `encodeURIComponent` for URL parameters. Do NOT pass raw user input to `innerHTML`.

#### `_kioskCart` state and key scheme (lines 686–749):
```javascript
var _kioskCart = {};   // keyed object: { [key]: { item: <product-like-object>, qty: <number> } }
```
Existing synthetic keys for non-catalog entries: `'recipe-fee-brewing'`, `'recipe-fee-materials'`, `'recipe-fee-milling'`, `'recipe-total'`. Custom lines will use keys like `'custom-1'`, `'custom-2'` (auto-incrementing counter). The `item` object for a custom line must carry `{ custom: true, description, note, name (= description for display), rate, tax_percentage (5 or 0), quantity }`. The `name` field in the cart entry's `item` drives the display in `kioskRenderCart`.

#### `kioskCalcTotals` — per-line tax pattern (lines 1187–1285):
```javascript
function kioskCalcTotals() {
  var ids = Object.keys(_kioskCart);
  var subtotal = 0;
  ids.forEach(function (id) {
    var entry = _kioskCart[id];
    if (!entry || !entry.item) return; // skip non-item entries (defensive guard)
    subtotal += (parseFloat(entry.item.rate) || 0) * entry.qty;
  });
  subtotal = kioskR2(subtotal);
  // ... discount handling ...
  var taxTotal = 0;
  ids.forEach(function (id) {
    var entry = _kioskCart[id];
    if (!entry || !entry.item) return;
    var lt = (parseFloat(entry.item.rate) || 0) * entry.qty;
    var d = lineDiscount[id] || 0;
    var taxable = Math.max(lt - d, 0);
    var pct = parseFloat(entry.item.tax_percentage);
    if (isNaN(pct)) pct = KIOSK_TAX_RATE_DEFAULT * 100;
    taxTotal += taxable * (pct / 100);
  });
  ...
}
```
**Custom lines need no change to this function** — they carry `tax_percentage` (5 or 0) on `entry.item`, so the existing per-line tax math works unchanged. The discount guard for custom lines (D-08): in the discount-resolution block, skip lines where `entry.item.custom === true` (parallel to the server guard in `resolveDiscount`).

**`KIOSK_TAX_RATE_DEFAULT`** is defined earlier in kiosk.js — search for it to confirm the constant name and value before using it.

#### `kioskProceedToPayment` — items array mapper (lines 2958–2968):
```javascript
var items = Object.keys(_kioskCart).map(function (id) {
  var entry = _kioskCart[id];
  return {
    item_id: entry.item.item_id,
    name: entry.item.name || '',
    sku: entry.item.sku || '',
    quantity: entry.qty,
    rate: parseFloat(entry.item.rate) || 0,
    product_type: entry.item.product_type || '',
    cf_type: entry.item.cf_type || ''
  };
});
```
**Extend with custom-line branch:**
```javascript
var items = Object.keys(_kioskCart).map(function (id) {
  var entry = _kioskCart[id];
  if (entry.item.custom) {
    return {
      custom: true,
      description: entry.item.description || '',
      note: entry.item.note || '',
      quantity: entry.qty,
      rate: parseFloat(entry.item.rate) || 0,
      taxable: entry.item.taxable !== false  // default true
    };
  }
  return {
    item_id: entry.item.item_id,
    name: entry.item.name || '',
    sku: entry.item.sku || '',
    quantity: entry.qty,
    rate: parseFloat(entry.item.rate) || 0,
    product_type: entry.item.product_type || '',
    cf_type: entry.item.cf_type || ''
  };
});
```

#### `kioskRenderCart` — cart line HTML pattern (lines 2618–2743):
```javascript
html += '<div class="kiosk-cart-line">';
// ...weight vs integer qty control...
html += '<div class="kiosk-cart-line-name" title="' + escapeHTML(item.name || '') + '">' + escapeHTML(item.name || '') + '</div>';
html += '<div class="kiosk-cart-qty">';
html += '<button class="kiosk-qty-btn" data-action="dec" data-id="' + id + '">-</button>';
html += '<input type="number" class="kiosk-qty-input" data-id="' + id + '" value="' + qty + '" step="1" min="1" inputmode="numeric">';
html += '<button class="kiosk-qty-btn" data-action="inc" data-id="' + id + '">+</button>';
html += '</div>';
html += '<div class="kiosk-cart-line-total">' + kioskFmt(lineTotal) + '</div>';
html += '<button class="kiosk-cart-remove-btn" data-id="' + id + '">&times;</button>';
html += '</div>';
```
Custom lines reuse these exact controls — `data-id` is the synthetic `custom-N` key. The `kioskSetQty` and `kioskRemoveFromCart` functions already key off the cart-entry key and will work for custom lines without modification.

#### Modal / overlay pattern — `kioskShowRecipePrompt` (lines 1544–1724):
```javascript
// Pattern: show an in-kiosk panel (not admin-modal) by manipulating display on DOM elements.
var grid = document.getElementById('kiosk-recipe-grid');
var prompt = document.getElementById('kiosk-recipe-prompt');
if (grid) grid.style.display = 'none';
if (prompt) {
  prompt.style.display = '';
  prompt.classList.add('kiosk-recipe-prompt-view'); // bounds scroll on iPad
}
// ... populate fields, wire event handlers ...
```
**For the custom-item modal**, the pattern choice (per context D-06) is to match existing kiosk modal style. There is no `<dialog>` or `admin-modal` in kiosk.js — kiosk.js uses either `kioskShowView()` or direct `element.style.display` toggles. The cleanest analog is a fixed-position overlay div (similar to how the recipe prompt panel works) injected into the kiosk DOM tree, toggled with `style.display`. The overlay must sit above the kiosk sidebar and product grid but not obscure the existing view-layer.

#### `kioskShowView` — view pattern (lines 1289–1300):
```javascript
function kioskShowView(name) {
  var views = ['browse', 'browse-customer', 'customer', 'payment', 'review-batches', 'receipt', 'error', 'collect', 'create-so'];
  views.forEach(function (v) {
    var el = document.getElementById('kiosk-view-' + v);
    if (el) el.style.display = (v === name) ? '' : 'none';
  });
  _kioskCurrentView = name;
}
```
The custom-item modal does NOT add a new view — it overlays the `browse` view. Do not add a `'custom-item'` view to this list.

#### `kioskAddToCart` — cart entry pattern (lines 2349–2375):
```javascript
function kioskAddToCart(product) {
  var id = product.item_id;  // for custom lines: synthetic 'custom-N'
  // weight items use prompt(); integer items increment
  var currentQty = _kioskCart[id] ? _kioskCart[id].qty : 0;
  var newQty = currentQty + 1;
  if (_kioskCart[id]) {
    _kioskCart[id].qty = newQty;
  } else {
    _kioskCart[id] = { item: product, qty: 1 };
  }
  // ...
  kioskRenderCart();
}
```
Custom-item modal submit adds a new entry directly: `_kioskCart['custom-' + (++_kioskCustomCounter)] = { item: customItem, qty: qty };` then calls `kioskRenderCart()`.

---

### `js/admin.js` — admin-embedded kiosk fork (EXACT DUPLICATE required)

**CRITICAL: every change to `js/kiosk.js` must be duplicated in `js/admin.js`. The prod kiosk is the admin surface.**

The admin.js kiosk section begins at approximately line 9783 (`// ===== KIOSK SALE (In-Store POS) =====`).

#### admin.js state variables (lines 9785–9793):
```javascript
var _kioskProducts = [];       // all products loaded from backend
var _kioskCart = {};           // keyed by item_id: { item, qty }
var _kioskProductsLoaded = false;
var _kioskProductsLoading = false;
var _kioskCurrentView = 'browse'; // browse | customer | payment | receipt | error
var _kioskSaleData = null;
var _kioskSearchTimer = null;
var _kioskTerminalReady = false;
var _kioskCustomer = null;     // { contact_id, name, email } or null (walk-in)
```
Add `var _kioskCustomCounter = 0;` here (parallel to kiosk.js).

#### admin.js `escapeHTML` (lines 5318–5325):
```javascript
function escapeHTML(str) {
  return String(str === null || str === undefined ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
```
Note the slight null-guard difference from kiosk.js (`str === null || str === undefined` vs `!str`). Both produce the same output for the inputs that matter. Use the already-available `escapeHTML` function — it is defined within admin.js scope.

#### admin.js `kioskCalcTotals` (lines 9847–9863):
```javascript
function kioskCalcTotals() {
  var subtotal = 0;
  var taxTotal = 0;
  Object.keys(_kioskCart).forEach(function (id) {
    var entry = _kioskCart[id];
    if (!entry || !entry.item) return;
    var qty = entry.qty;
    var rate = parseFloat(entry.item.rate) || 0;
    subtotal += rate * qty;
    taxTotal += kioskItemTax(entry.item, qty);  // uses entry.item.tax_percentage
  });
  return {
    subtotal: parseFloat(subtotal.toFixed(2)),
    tax: parseFloat(taxTotal.toFixed(2)),
    total: parseFloat((subtotal + taxTotal).toFixed(2))
  };
}
```
`kioskItemTax` (lines 9829–9833):
```javascript
function kioskItemTax(item, qty) {
  var rate = parseFloat(item.rate) || 0;
  var pct = parseFloat(item.tax_percentage) || 0;
  return parseFloat((rate * qty * pct / 100).toFixed(2));
}
```
Custom lines in admin.js also carry `tax_percentage` (5 or 0) — totals math needs no change. Discount skip guard (D-08) needed in the discount resolution block, same as kiosk.js.

#### admin.js `kioskProceedToPayment` (lines 10352–10436):
```javascript
var items = Object.keys(_kioskCart).map(function (id) {
  var entry = _kioskCart[id];
  return {
    item_id: entry.item.item_id,
    name: entry.item.name || '',
    quantity: entry.qty,
    rate: parseFloat(entry.item.rate) || 0,
    product_type: entry.item.product_type || ''
  };
});
```
Note: admin.js `items` mapper omits `sku` and `cf_type` (kiosk.js includes them). Add the same custom-line branch as kiosk.js — the structure is otherwise identical.

#### admin.js `kioskRenderCart` (lines 10099–10159):
```javascript
keys.forEach(function (id) {
  var entry = _kioskCart[id];
  if (!entry || !entry.item) return;
  var item = entry.item;
  var qty = entry.qty;
  var lineTotal = (parseFloat(item.rate) || 0) * qty;
  html += '<div class="kiosk-cart-line">';
  html += '<div class="kiosk-cart-line-name" title="' + (item.name || '') + '">' + (item.name || '') + '</div>';
  html += '<div class="kiosk-cart-qty">';
  html += '<button class="kiosk-qty-btn" data-action="dec" data-id="' + id + '">-</button>';
  html += '<span class="kiosk-qty-val">' + qty + '</span>';
  html += '<button class="kiosk-qty-btn" data-action="inc" data-id="' + id + '">+</button>';
  html += '</div>';
  html += '<div class="kiosk-cart-line-total">' + kioskFmt(lineTotal) + '</div>';
  html += '</div>';
});
```
Note: admin.js cart renderer uses `<span class="kiosk-qty-val">` (not `<input>`), and has no remove button — the qty-dec to zero removes. Custom lines use the same rendering — no special case needed in the HTML, but `kioskSetQty` must be extended to handle `custom-N` keys (delete from `_kioskCart` at qty <= 0, same as catalog items).

#### admin.js modal system (lines 1282–1323):
```javascript
function openModal(title, bodyHTML) {
  _runModalCleanup();
  document.getElementById('admin-modal-title').textContent = title;
  document.getElementById('admin-modal-body').innerHTML = bodyHTML;
  document.getElementById('admin-modal').style.display = '';
}

function closeModal() {
  document.getElementById('admin-modal').style.display = 'none';
  _runModalCleanup();
}
```
**The admin surface HAS a global `openModal` / `closeModal` system.** The custom-item modal in admin.js should use `openModal('Add custom item', html)` / `closeModal()` — this matches every other admin.js modal (batch detail, add kit, etc.) and avoids building a second overlay. This is the key structural difference from kiosk.js (which has no `openModal`).

Example usage from admin.js (lines 2421–2422):
```javascript
var html = '<form id="manual-hold-form" class="admin-modal-form">';
html += '<div class="form-group"><label>Product</label><input type="text" value="' + escapeHTML(...) + '" disabled></div>';
```

---

### `zoho-middleware/__tests__/pos-custom-line.test.js` (new test file)

**Primary analog:** `zoho-middleware/__tests__/pos-tax.test.js` (full file, lines 1–491)

#### Mock harness pattern (pos-tax.test.js lines 1–141):
```javascript
'use strict';

jest.mock('express', function () {
  var router = { get: jest.fn(), post: jest.fn(), put: jest.fn() };
  var express = function () {};
  express.Router = function () { return router; };
  return express;
});
jest.mock('../lib/helcim', function () {
  return {
    isTerminalEnabled: jest.fn().mockReturnValue(true),
    terminalPurchase: jest.fn().mockResolvedValue({ idempotencyKey: 'idem-1' }),
    pollTerminalResult: jest.fn().mockResolvedValue({ approved: true, transactionId: 'txn-test-123' }),
    voidTransaction: jest.fn().mockResolvedValue({}),
    getTerminalDiagnostics: jest.fn().mockReturnValue({}),
    generateIdempotencyKey: jest.fn().mockReturnValue('idem-so-1')
  };
});
jest.mock('../lib/zoho-api', function () {
  return {
    zohoGet: jest.fn(),
    zohoPost: jest.fn().mockResolvedValue({ invoice: { invoice_id: 'inv-1', invoice_number: 'INV-001' } }),
    zohoPut: jest.fn()
  };
});
jest.mock('../lib/cache', function () {
  return {
    get: jest.fn(),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1)
  };
});
jest.mock('../lib/logger', function () {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
});
jest.mock('../lib/eventLog', function () { return { logEvent: jest.fn() }; });
jest.mock('../lib/mailer', function () { return { sendVoidFailureAlert: jest.fn() }; });
jest.mock('../lib/inventory-ledger', function () {
  return { decrementStock: jest.fn().mockResolvedValue({}), reconcileFromZoho: jest.fn() };
});
jest.mock('../lib/constants', function () {
  return {
    CACHE_KEYS: {
      KIOSK_PRODUCTS: 'test:kiosk-products',
      RECENT_ORDERS: 'test:recent-orders',
      KIOSK_IDEM_PREFIX: 'test:idem:',
      KIOSK_SALESORDERS: 'test:kiosk-salesorders',
      KIOSK_DISCOUNT_PRESETS: 'test:kiosk-discount-presets',
      CONSIGNMENT_REPORT_PREFIX: 'test:consignment:report:'
    },
    LEDGER_KEYS: {},
    RATE_LIMIT_PREFIX: 'test:rl:'
  };
});
```

#### Handler extraction pattern (pos-tax.test.js lines 107–124):
```javascript
function getHandlers() {
  jest.resetModules();
  cache = require('../lib/cache');
  zohoApi = require('../lib/zoho-api');
  helcimLib = require('../lib/helcim');
  require('../routes/pos');
  router = require('express').Router();
  handlers = {};
  router.post.mock.calls.forEach(function (call) {
    handlers[call[0]] = call[call.length - 1];
  });
  router.get.mock.calls.forEach(function (call) {
    handlers[call[0]] = call[call.length - 1];
  });
  router.put.mock.calls.forEach(function (call) {
    handlers[call[0]] = call[call.length - 1];
  });
}
```

#### `mockRes` helper (pos-tax.test.js lines 126–130):
```javascript
function mockRes() {
  var res = { json: jest.fn(), status: jest.fn(), headersSent: false };
  res.status.mockReturnValue(res);
  return res;
}
```

#### `beforeEach` / `afterEach` env pattern (pos-tax.test.js lines 132–141):
```javascript
beforeEach(function () {
  getHandlers();
  process.env.KIOSK_TAX_RATE = '0.05';
  process.env.KIOSK_CONTACT_ID = 'contact-walkin';
});
afterEach(function () {
  delete process.env.KIOSK_TAX_RATE;
  delete process.env.KIOSK_CONTACT_ID;
});
```
For custom-line tests, also set `process.env.ZOHO_TAX_SERVICES_RULE` and optionally `process.env.KIOSK_GST_TAX_ID` in `beforeEach`, and delete them in `afterEach`.

#### Terminal-push assertion pattern (pos-tax.test.js lines 147–174):
```javascript
res.json.mockImplementation(function (body) {
  try {
    expect(body.pending).toBe(true);
    expect(body.reference).toBeTruthy();
    var termCall = helcimLib.terminalPurchase.mock.calls[0];
    expect(termCall[0]).toBe(105); // grandTotal: rate + tax
    done();
  } catch (e) { done(e); }
});
res.status.mockImplementation(function (code) {
  if (code >= 400) {
    return { json: function (body) { done(new Error('Got status ' + code + ': ' + JSON.stringify(body))); } };
  }
  return res;
});
handlers['/api/kiosk/sale'](req, res);
```

#### `resolveDiscount` direct unit test pattern (pos-discount.test.js lines 28–44):
```javascript
var cache = require('../lib/cache');
var pos = require('../routes/pos');
var resolveDiscount = pos.resolveDiscount;

function lines() {
  return [
    { item_id: 'w', quantity: 1, rate: 100 },
    { item_id: 'h', quantity: 1, rate: 50 }
  ];
}
// Test: custom lines are not discounted
test('custom lines are excluded from type-scope discount', function () {
  cache.get.mockResolvedValue([{ id: 'd1', ... scope: 'type', ... }]);
  var li = [
    { item_id: 'w', quantity: 1, rate: 100 },
    { custom: true, description: 'Repair', quantity: 1, rate: 50, taxable: true }
  ];
  return resolveDiscount({ discount: { preset_id: 'd1' } }, li, 150, CATALOG).then(function (r) {
    expect(li[1].discount).toBeUndefined(); // custom line never discounted
  });
});
```

#### Catalog used in tests for GST tax_id discovery:
```javascript
// Include at least one catalog item with ZOHO_TAX_SERVICES_RULE so auto-discovery can find it
var CATALOG_WITH_GST = [
  {
    item_id: 'item-gst',
    name: 'Wine Kit',
    rate: 100.00,
    stock_on_hand: 10,
    tax_id: 'tax-gst-5',
    sales_tax_rule_id: process.env.ZOHO_TAX_SERVICES_RULE || '109900000000033417',
    tax_percentage: 5,
    custom_fields: []
  }
];
```

---

## Shared Patterns

### ES5 / `var` style
**Source:** All existing kiosk.js and admin.js code
**Apply to:** All new functions in kiosk.js, admin.js, pos.js
- Use `var`, not `let`/`const`
- Use named `function` declarations, not arrow functions
- Use `forEach` not `for...of`
- Use `String(x)`, not template literals

### Error handling in route handlers
**Source:** `zoho-middleware/routes/pos.js` lines 298–301
```javascript
}).catch(function (cacheErr) {
  log.error('[pos/kiosk/sale] Catalog cache read failed: ' + cacheErr.message);
  res.status(503).json({ error: 'Unable to verify item prices. Please try again.' });
});
```
All new catch blocks use `log.error('[pos/<route>] <context>: ' + err.message)` and return a user-readable JSON error.

### `grandTotal` guard (server money-path invariant)
**Source:** `zoho-middleware/routes/pos.js` lines 307–312
```javascript
if (grandTotal <= 0) {
  return res.status(400).json({ error: 'Sale total must be greater than zero' });
}
if (grandTotal > 10000) {
  return res.status(400).json({ error: 'Sale total exceeds maximum' });
}
```
These guards must remain unchanged — custom lines with negative rates do NOT get an exemption from `grandTotal > 0`.

### `fetch` + `.then` XHR pattern (kiosk surfaces)
**Source:** `js/kiosk.js` lines 2982–3010 (SO update), `js/admin.js` lines 10439–10444
```javascript
fetch(mwUrl + '/api/kiosk/sale', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-api-key': SHEETS_CONFIG.MW_API_KEY || '' },
  body: JSON.stringify(saleBody)
})
.then(function (r) { return r.json().then(function (d) { return { status: r.status, data: d }; }); })
.then(function (result) { ... })
.catch(function () { ... });
```
Note: kiosk.js includes `'x-api-key': SHEETS_CONFIG.MW_API_KEY || ''`; admin.js omits it in some calls (check individual call sites). New fetch calls should match the surrounding pattern at the call site.

---

## No Analog Found

No files in scope lack a codebase analog. All patterns have direct precedents.

---

## Fork Parity Checklist (Mandatory for Executor)

For every kiosk.js function added or modified, confirm the parallel admin.js change:

| kiosk.js (standalone) | admin.js (admin-embedded) | Line offset diff |
|---|---|---|
| `_kioskCart = {}` (L689) | `_kioskCart = {}` (L9786) | ~9097 lines |
| `kioskCalcTotals` (L1187) | `kioskCalcTotals` (L9847) | ~8660 lines |
| `kioskRenderCart` (L2618) | `kioskRenderCart` (L10099) | ~7481 lines |
| `kioskProceedToPayment` (L2950) | `kioskProceedToPayment` (L10352) | ~7402 lines |
| `kioskShowView` (L1289) | `kioskShowView` (L9867) | ~8578 lines |
| `kioskAddToCart` (L2349) | `kioskAddToCart` (L10060) | ~7711 lines |
| `kioskSetQty` / `kioskRemoveFromCart` (L2569) | `kioskSetQty` (L10071) | varies |
| `escapeHTML` (L527) | `escapeHTML` (L5318) | admin uses `openModal`; kiosk uses inline overlay |

**Modal divergence:** kiosk.js custom-item modal = standalone DOM overlay (pattern: `element.style.display = ''`). admin.js custom-item modal = `openModal('Add custom item', html)` / `closeModal()` (pattern: lines 1297–1308). This is the ONE intentional structural difference between the two surfaces.

---

## Metadata

**Analog search scope:** `zoho-middleware/routes/pos.js`, `js/kiosk.js`, `js/admin.js`, `zoho-middleware/__tests__/pos-tax.test.js`, `zoho-middleware/__tests__/pos-discount.test.js`, `zoho-middleware/lib/inventory-ledger.js`, `zoho-middleware/lib/brewpad-integration.js`
**Files scanned:** 9
**Pattern extraction date:** 2026-06-26
