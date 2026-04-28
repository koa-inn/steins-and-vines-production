# Phase 1: Catalog & Stock Display - Research

**Researched:** 2026-04-27
**Domain:** Vanilla JS kiosk frontend (`js/kiosk.js`) + Express middleware (`zoho-middleware/routes/catalog.js`, `routes/pos.js`)
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Warn on EVERY add that would push cart qty past `stock_on_hand` — applies to: product grid click, cart +/- buttons, and manual qty input in the cart box.
- **D-02:** Confirm dialog shows stock + cart qty context. Example: `"Merlot" — only 2 in stock, cart has 3. Add anyway?`
- **D-03:** User can override (staff may know about incoming shipments or floor samples). Same `confirm()` pattern as the existing out-of-stock dialog at line 1117-1118 of `js/kiosk.js`.
- **D-04:** The existing out-of-stock warning (stock <= 0) remains as-is — this new check covers the partial-stock case (stock > 0 but qty > stock).
- **D-05:** `kioskItemCategory()` should return `category_name` only. If `category_name` is empty/missing, treat the item as uncategorized.
- **D-06:** Uncategorized items appear under an "Other" option in the category filter dropdown.
- **D-07:** Product cards for uncategorized items should NOT display a category badge — hide it rather than showing "Other" or "goods".
- **D-08:** The Zoho `product_type` values ("goods", "services") and `cf_type` fallback should never appear as category labels or filter options.
- **D-09:** After a successful kiosk sale, bust the Redis product cache (`zoho:kiosk-products`) so the next product load gets fresh stock from Zoho.
- **D-10:** Cross-channel stock changes (online checkout, admin) rely on the existing 5-minute cache TTL — no change needed.

### Claude's Discretion

- Exact wording of the stock overflow confirm dialog (D-02 gives the pattern, Claude refines copy)
- Whether to consolidate the stock <= 0 and stock < cart qty checks into a single function or keep them separate

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| STOCK-01 | Kiosk displays current stock levels for each product from Zoho Inventory | `stock_on_hand` already returned by `/api/kiosk/products` and used throughout `kiosk.js` for card labels — already satisfied; verify behavior rather than build |
| STOCK-02 | When cart quantity exceeds available stock, user sees a warning with option to override or reduce quantity | New check needed in `kioskAddToCart()` and `kioskSetQty()` using `confirm()` pattern from line 1117-1118 |
| STOCK-04 | Out-of-stock items show a warning when added to cart with option to override (existing behavior — verify working) | Existing `confirm()` at lines 1117-1118 and 1195-1197 handles this; confirmed working via code read |
| CAT-01 | Category filter dropdown only shows actual product categories, not Zoho item types ("goods", "services") | `kioskPopulateCategories()` calls `kioskItemCategory()` which returns `category_name || cf_type || product_type` — fix the fallback chain in `kioskItemCategory()` |
| CAT-02 | Products display correct category labels derived from `category_name`, not fallback to `product_type` | Same fix as CAT-01 plus update card rendering to suppress badge when category is empty |
</phase_requirements>

---

## Summary

Phase 1 is a targeted patch to `js/kiosk.js` with a single verification task in `zoho-middleware/routes/pos.js`. The codebase already delivers `stock_on_hand` and `category_name` from Zoho via `/api/kiosk/products`; the frontend bugs are: (1) `kioskItemCategory()` falls back to `cf_type` and `product_type` polluting the category filter with values like "goods" and "services", and (2) `kioskAddToCart()` and `kioskSetQty()` lack a partial-stock overflow warning.

The two areas of work are independent:
- **Category fix** (CAT-01, CAT-02): One-line change to `kioskItemCategory()` + guard in `kioskPopulateCategories()` to add "Other" option + suppress badge in card renderers when category is empty.
- **Stock overflow warning** (STOCK-01, STOCK-02, STOCK-04): Add a `kioskCheckStockOverflow(product, incomingQty)` helper called from `kioskAddToCart()` and `kioskSetQty()`, using the same `confirm()` pattern as the existing out-of-stock dialog.

Cache bust after sale (D-09) is already implemented: `cache.del(KIOSK_PRODUCTS_CACHE_KEY)` fires at lines 343 and 661 of `pos.js` — D-09 is already satisfied, requiring only a verification task to confirm it is working correctly.

**Primary recommendation:** All changes go directly to `js/kiosk.js`. No middleware changes are required. Run `npm run build` after editing to regenerate `kiosk.min.js`.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Stock level display | Frontend (kiosk.js) | API (catalog.js delivers stock_on_hand) | Display logic is client-side; data sourced from Zoho via existing API |
| Stock overflow warning | Frontend (kiosk.js) | — | Cart state lives in `_kioskCart` in the browser; check must happen at the add/set point |
| Category filter population | Frontend (kiosk.js) | — | Filter built from loaded product data; fix is in the category extraction function |
| Category label on product card | Frontend (kiosk.js) | — | Rendering is entirely client-side |
| Post-sale cache invalidation | API (pos.js) | — | Redis cache lives on the server; already implemented at two sale completion paths |

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Vanilla JS (ES5) | — | All kiosk frontend logic | Project constraint — no framework; ES5 for broadest compatibility [VERIFIED: CLAUDE.md] |
| Express.js | see zoho-middleware/package.json | Middleware routes | Existing stack [VERIFIED: codebase] |
| Redis (via `lib/cache`) | — | Product cache (`zoho:kiosk-products`) | Existing caching layer [VERIFIED: catalog.js line 697] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `confirm()` (browser native) | — | Override dialog for out-of-stock and stock overflow | Existing pattern in kiosk.js — replicate for consistency [VERIFIED: kiosk.js line 1118] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Native `confirm()` | Custom modal | Custom modal is more on-brand but conflicts with D-03 (same pattern as existing) and adds scope |

**No install step required** — all changes are in existing files using existing dependencies.

---

## Architecture Patterns

### System Architecture Diagram

```
User action (grid click / cart +/- / qty input)
        |
        v
[kioskAddToCart(product)] ─── weight item? ──> prompt() for kg, skip stock check
        |                                                          (weight items are bulk)
        | non-weight
        v
[kioskCheckStockOverflow(product, newCartQty)]
        |
        |── stock === 0? ──> handled by EXISTING confirm() at click handler (D-04)
        |
        |── newCartQty > stock_on_hand && stock > 0?
        |       |
        |       |── confirm("...only N in stock, cart has M. Add anyway?")
        |       |       |── cancel ──> abort add
        |       |       └── ok ──> proceed
        |       |
        |       └── no overflow ──> proceed
        |
        v
[_kioskCart updated] ──> kioskRenderCart() + kioskRenderProducts()

─────────────────────────────────────────────────────
kioskSetQty(itemId, qty) path (cart +/- buttons, typed input .change)
        |
        v
[kioskCheckStockOverflow(product, qty)]  <── same helper
        |── overflow? confirm / abort
        └── proceed ──> _kioskCart[itemId].qty = qty

─────────────────────────────────────────────────────
Category data flow:

Zoho Inventory
        |
        v (every 5 min or on bust)
GET /api/kiosk/products (catalog.js)
        |── returns: {item_id, name, category_name, product_type, cf_type, stock_on_hand, ...}
        v
_kioskProducts (browser array)
        |
        |── kioskItemCategory(p)  [FIXED: return p.category_name || '']
        |
        |── kioskPopulateCategories()
        |       |── collects unique non-empty category_name values
        |       |── adds "Other" option if any item has empty category_name
        |       └── builds <select> options
        |
        └── card renderers
                |── if category empty ──> suppress badge (D-07)
                └── if category non-empty ──> show badge
```

### Recommended File Touch Map

```
js/kiosk.js
├── kioskItemCategory()        # CAT-01, CAT-02 — strip fallbacks
├── kioskPopulateCategories()  # CAT-01 — add "Other" slot for empty-category items
├── kioskRenderProductGrid()   # CAT-02 — no category badge when category empty
├── kioskRenderProductList()   # CAT-02 — no category text when category empty
├── kioskCbRenderWineCard()    # CAT-02 — already guards with `if (cat)` — verify
├── kioskCbRenderBeerCard()    # CAT-02 — uses fallback 'Beer' — review
├── kioskCbRenderCard()        # CAT-02 — already guards with `if (cat)` — verify
├── kioskAddToCart()           # STOCK-02 — add overflow check (non-weight items)
└── kioskSetQty()              # STOCK-02 — add overflow check

zoho-middleware/routes/pos.js
└── (verify only) cache.del at lines 343 + 661 — D-09 already implemented
```

### Pattern: Existing Out-of-Stock Confirm (replicate for overflow)

```javascript
// Source: js/kiosk.js lines 1117-1118 [VERIFIED: codebase read]
// Grid card click handler (existing)
if (!isService && stock <= 0) {
  if (!confirm('"' + (product.name || 'This item') + '" is out of stock. Add to cart anyway (special order)?')) return;
}
```

Overflow check follows the same pattern but fires when `stock > 0` and new cart qty would exceed `stock_on_hand`. Example wording (Claude's discretion):

```javascript
// Proposed — mirrors existing confirm() style
function kioskCheckStockOverflow(product, newQty) {
  var stock = parseFloat(product.stock_on_hand) || 0;
  var isService = (product.product_type || '').toLowerCase() === 'service';
  if (isService || stock <= 0) return true; // handled elsewhere
  if (newQty > stock) {
    var name = product.name || 'This item';
    return confirm('"' + name + '" — only ' + stock + ' in stock, cart would have ' + newQty + '. Add anyway?');
  }
  return true;
}
```

### Pattern: Category Fix

```javascript
// BEFORE (js/kiosk.js line 762) [VERIFIED: codebase read]
function kioskItemCategory(p) {
  return p.category_name || p.cf_type || p.product_type || '';
}

// AFTER (D-05, D-08)
function kioskItemCategory(p) {
  return p.category_name || '';
}
```

```javascript
// kioskPopulateCategories() — add "Other" if any item has empty category_name (D-06)
// After building the cats object, check:
var hasUncategorized = _kioskProducts.some(function (p) {
  // Apply same type filter as above
  return !p.category_name;
});
if (hasUncategorized) {
  var otherOpt = document.createElement('option');
  otherOpt.value = '__other__';
  otherOpt.textContent = 'Other';
  sel.appendChild(otherOpt);
}
// And in kioskGetFilteredProducts, handle cat === '__other__' to show items with empty category_name
```

### Anti-Patterns to Avoid

- **Modifying `js/main.js` directly:** `kiosk.js` is a standalone file, but `main.js` is a build artifact — do not edit it. [VERIFIED: CLAUDE.md rule 8]
- **Skipping `npm run build`:** Edits to `js/kiosk.js` must be followed by `npm run build` to regenerate `kiosk.min.js` — the HTML loads the minified version. [VERIFIED: package.json minify:js script]
- **Committing without running both test suites:** `npm test` + `cd zoho-middleware && npm test` are mandatory before any commit. [VERIFIED: CLAUDE.md rules 1-2]
- **Hard-blocking the overflow:** D-03 explicitly allows override — never throw an error or block the cart update without a confirm dialog.
- **Removing the existing out-of-stock check:** D-04 says the stock <= 0 check stays as-is. The new overflow check is additive.
- **Using a `__other__` sentinel in the filter without updating `kioskGetFilteredProducts`:** If "Other" is added to the category dropdown with a sentinel value, the filter function must be updated to interpret it as `category_name === ''`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Override dialog | Custom modal component | Native `confirm()` | Matches existing pattern (D-03), zero scope increase |
| Cache invalidation after sale | New bust mechanism | Existing `cache.del(KIOSK_PRODUCTS_CACHE_KEY)` in pos.js | Already fires at lines 343 and 661 |
| Category data transformation | New middleware filter | Fix `kioskItemCategory()` on the frontend | Data is already correct in the API response — `category_name` is already populated from Zoho |

**Key insight:** Both bugs are purely client-side data consumption errors. The API returns correct `category_name` and `stock_on_hand` values — the fixes are in how `kiosk.js` reads and displays them.

---

## Common Pitfalls

### Pitfall 1: Weight Items and Stock Overflow
**What goes wrong:** Weight items (kg) use `prompt()` for quantity entry and set qty directly. Applying the stock overflow check to weight items will trigger on every kg entry.
**Why it happens:** `kioskAddToCart()` has a special branch for `kioskIsWeightItem(product)` that bypasses the +1 increment.
**How to avoid:** Gate `kioskCheckStockOverflow` with `!kioskIsWeightItem(product)`. Services are also exempt (already handled by `isService` check).
**Warning signs:** QA finds the overflow dialog firing for ingredient items sold by weight (hops, grain, etc.).

### Pitfall 2: `kioskSetQty` Receives the New Qty, Not the Delta
**What goes wrong:** The inc button calls `kioskSetQty(id, _kioskCart[id].qty + 1)` — the new total, not "+1". If you add the overflow check inside `kioskSetQty` using the raw `qty` parameter, the logic is correct. If you accidentally use `_kioskCart[id].qty` as the "before" state, you may already be reading the updated value.
**Why it happens:** `kioskRenderCart()` event listener: `var newQty = _kioskCart[id].qty + (action === 'inc' ? 1 : -1); kioskSetQty(id, newQty)` — the new total is computed before calling `kioskSetQty`.
**How to avoid:** The `qty` argument to `kioskSetQty` is already the new total — compare it directly against `stock_on_hand`. No delta calculation needed.
**Warning signs:** Overflow dialog fires on decrement (−) button press.

### Pitfall 3: `kioskRenderCart` Input Handler Fires on Every Keystroke
**What goes wrong:** The `input` event listener on `kiosk-qty-input` (line 1515) updates `_kioskCart[id].qty` on every character. If the overflow `confirm()` fires on `input`, the user sees a dialog after typing each digit of "12".
**Why it happens:** There are two listeners — `input` (incremental, fires while typing) and `change` (fires on blur/enter, calls `kioskSetQty`).
**How to avoid:** Attach the stock overflow check to the `change` handler (which calls `kioskSetQty`) — not the `input` handler. The `input` handler updates totals display only and should remain non-blocking.
**Warning signs:** QA sees overflow dialog interrupting as they type a two-digit quantity.

### Pitfall 4: Category Filter "Other" Option — Sentinel vs. Empty String
**What goes wrong:** The `kioskGetFilteredProducts()` function compares `itemCat.toLowerCase()` against `_kioskFilters.category`. If "Other" in the dropdown uses value `""` (empty string), it will match the "show all" state and not filter.
**Why it happens:** Empty string is the "no filter selected" sentinel (`sel.value = ''` resets the filter).
**How to avoid:** Use a distinct sentinel value (e.g., `__other__`) for "Other" in the dropdown, and add a branch in `kioskGetFilteredProducts`: `if (cat === '__other__' && itemCat !== '') return false`.
**Warning signs:** Selecting "Other" in the filter shows all products instead of only uncategorized ones.

### Pitfall 5: Customer Browse View (`kioskRenderCbGrid`) Also Calls `kioskItemCategory`
**What goes wrong:** The customer browse view (wine/beer/card renderers at lines 1250-1323) also calls `kioskItemCategory(p)` and renders the result. After the fix, category will be empty for uncategorized items — these views use `if (cat)` guards except `kioskCbRenderBeerCard` which falls back to `'Beer'` (line 1281).
**Why it happens:** The beer card uses `escapeHTML(cat || 'Beer')` — this is intentional UX (beer kits always display a beer category), not a category bug.
**How to avoid:** Leave the `|| 'Beer'` fallback in `kioskCbRenderBeerCard` as-is — it is a display fallback for a specific card type, not a category filter value. The filter only runs through `kioskItemCategory()` in `kioskPopulateCategories()` and `kioskGetFilteredProducts()`.
**Warning signs:** Removing the `|| 'Beer'` fallback causes beer cards to show no category label.

---

## Code Examples

### Existing Out-of-Stock Dialog (reference pattern)
```javascript
// Source: js/kiosk.js lines 1115-1121 [VERIFIED: codebase read]
var isService = (product.product_type || '').toLowerCase() === 'service';
var stock = parseFloat(product.stock_on_hand) || 0;
if (!isService && stock <= 0) {
  if (!confirm('"' + (product.name || 'This item') + '" is out of stock. Add to cart anyway (special order)?')) return;
}
kioskAddToCart(product);
```

### Existing Cache Bust After Sale (D-09 already satisfied)
```javascript
// Source: zoho-middleware/routes/pos.js lines 341-343 [VERIFIED: codebase read]
return paymentChain.then(function () {
  // Invalidate kiosk product cache so stock counts refresh
  cache.del(KIOSK_PRODUCTS_CACHE_KEY);
  // ...
```
Second occurrence at line 660-661 in the confirm-payment path.

### `kioskSetQty` Entry Point (where overflow check plugs in)
```javascript
// Source: js/kiosk.js lines 1419-1431 [VERIFIED: codebase read]
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
// Overflow check should be inserted at the top of the else branch before setting qty
```

### Cart Inc/Dec Button Event Wiring (shows how newQty is computed before setQty)
```javascript
// Source: js/kiosk.js lines 1505-1512 [VERIFIED: codebase read]
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

### `kioskPopulateCategories` (current state — where "Other" needs to be added)
```javascript
// Source: js/kiosk.js lines 941-975 [VERIFIED: codebase read]
function kioskPopulateCategories() {
  var sel = document.getElementById('kiosk-category-filter');
  if (!sel) return;
  var typeFilter = _kioskFilters.type;
  var cats = {};
  _kioskProducts.forEach(function (p) {
    if (typeFilter === 'consignment') {
      if (!kioskIsConsignment(p)) return;
    } else if (typeFilter) {
      if ((p.product_type || '').toLowerCase() !== typeFilter) return;
    }
    var cat = kioskItemCategory(p);  // after fix: returns category_name || ''
    if (cat) cats[cat] = true;       // only adds non-empty categories
  });
  // ... builds <option> elements from cats
}
// After fix: also check if any filtered product has empty category_name, add "Other" option
```

---

## Runtime State Inventory

Phase 1 is not a rename/refactor phase. This section is not applicable.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `category_name \|\| cf_type \|\| product_type` | `category_name` only (D-05) | Phase 1 (this work) | Eliminates "goods"/"services" polluting the category filter |
| No stock overflow check | Confirm dialog when cart qty > stock_on_hand | Phase 1 (this work) | Staff warned before adding more than available stock |

**Currently working (verify only, no code change):**
- STOCK-01: `stock_on_hand` already in API response and displayed in card labels
- STOCK-04: Out-of-stock confirm already in grid and list click handlers at lines 1117-1118 and 1195-1197
- D-09: Cache bust after sale already at pos.js lines 343 and 661

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Weight items (kg) should be exempt from the stock overflow check | Pitfall 1 | If wrong, the dialog fires during every kg quantity prompt — easily fixed if discovered in QA |
| A2 | `kioskCbRenderBeerCard`'s `cat \|\| 'Beer'` fallback is intentional UX and should be preserved | Pitfall 5 | If wrong, beer cards in customer browse mode would show no category — cosmetic only |

---

## Open Questions

1. **"Other" filter — should it show in all type-filter contexts or only when type filter is "all"?**
   - What we know: `kioskPopulateCategories()` already scopes its category list to the active type filter (kits, ingredients, services, consignment).
   - What's unclear: Should "Other" appear as a category option when filtered to a specific type (e.g., only showing kits)?
   - Recommendation: Apply the same type-filter scoping — "Other" only appears if there are uncategorized items within the currently selected type filter. This is consistent with how other category options work.

2. **Does `kioskAddToCart` for weight items need any stock check at all?**
   - What we know: Weight items use `prompt()` and can be set to arbitrary kg values. CONTEXT.md D-01 says to check "every add". However, weight items are bulk ingredients (hops, grain) where stock tracking in Zoho may not be precise.
   - What's unclear: Whether the user expects overflow confirmation for, say, 500g of hops when Zoho shows 400g in stock.
   - Recommendation: Exempt weight items from the overflow check (consistent with Pitfall 1 analysis). If wrong, this is a one-line change.

---

## Environment Availability

Step 2.6: SKIPPED — Phase 1 is purely code changes to existing files. No new external dependencies are introduced.

---

## Security Domain

**security_enforcement: true, asvs_level: 1**

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Phase touches no auth paths |
| V3 Session Management | no | Phase touches no session paths |
| V4 Access Control | no | No new endpoints or permission gates |
| V5 Input Validation | yes (minor) | `parseFloat(product.stock_on_hand) \|\| 0` pattern already used — continue using it |
| V6 Cryptography | no | No crypto involved |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Client-side stock bypass | Tampering | The stock overflow check is advisory only (staff can override) — server-side Zoho invoice creation is the authoritative gate; no server-side change needed for this phase |
| XSS via category_name | Tampering | `escapeHTML()` already applied to all rendered product fields in kiosk.js — new category rendering paths must also use `escapeHTML()` |

**Security note:** The confirm-or-override pattern does not introduce a security gap. Kiosk staff already have access to add out-of-stock items via the existing dialog; the overflow check adds the same override capability for partial-stock situations. Server-side validation of sold quantities is outside Phase 1 scope.

---

## Sources

### Primary (HIGH confidence)
- `js/kiosk.js` (full read, lines 745-1545) — all function implementations verified directly
- `zoho-middleware/routes/catalog.js` (lines 684-757) — kiosk products endpoint, `category_name` field confirmed in response
- `zoho-middleware/routes/pos.js` (lines 340-345, 660-661) — cache bust after sale confirmed at two locations
- `zoho-middleware/lib/constants.js` — `CACHE_KEYS.KIOSK_PRODUCTS = 'zoho:kiosk-products'` confirmed
- `CLAUDE.md` — build rules, test requirements, no-edit-main-js constraint verified
- `package.json` — build script confirmed: terser runs on `kiosk.js` → `kiosk.min.js`

### Secondary (MEDIUM confidence)
- `.planning/phases/01-catalog-stock-display/01-CONTEXT.md` — locked decisions
- `.planning/REQUIREMENTS.md` — requirement IDs and descriptions

### Tertiary (LOW confidence)
None — all claims verified from codebase or official project config.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — verified from CLAUDE.md and package.json
- Architecture: HIGH — verified from direct code reads of all canonical ref locations
- Pitfalls: HIGH — derived from reading the actual function implementations, not assumed
- Security: HIGH — ASVS L1 applied; no new attack surface introduced

**Research date:** 2026-04-27
**Valid until:** 90 days (vanilla JS codebase with no framework churn)
