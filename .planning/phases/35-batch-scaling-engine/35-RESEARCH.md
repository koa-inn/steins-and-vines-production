# Phase 35: Batch Scaling Engine — Research

**Researched:** 2026-06-20
**Domain:** Express middleware (scaling math, server-authoritative pricing), admin kiosk UI
**Confidence:** HIGH — all findings verified directly against codebase source code

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Classify scaling behavior by the ingredient's `unit` string. Continuous (`kg`, `g`, `l`, `ml`) scale linearly; discrete (`pcs`, `each`, `unit`, `pkg` and similar) round up to whole units.
- **D-02:** Discrete rounding: `Math.max(1, Math.ceil(scaledQty))`. Scaling down never drops an essential item to 0.
- **D-03:** Unknown/blank units default to linear (continuous) scaling. Researcher MUST enumerate actual unit values.
- **D-04:** Locked-price formula: `price = locked_price × scale_factor + service_fee + materials_fee`. `locked_price` is the scalable portion; fees are fixed add-ons.
- **D-05:** Same formula applied globally — base (1×) and scaled sales use identical formula (no price discontinuity).
- **D-06:** BEHAVIOR CHANGE — today locked recipes charge flat `locked_price` with NO fees. D-04/D-05 add service + materials on top. Owner-approved — surface in UAT.
- **D-07:** Dynamic recipes: `price = Σ(scaled_qty × catalog_rate) + service_fee + materials_fee`. Same fixed-fee treatment.
- **D-08:** Scaled quantity exceeds stock → hard-block + explicit manager override.
- **D-09:** Stock check uses same source as BrewPad editor and recipe detail view. Researcher confirms which endpoint/cache.
- **D-10:** Target-volume input pre-fills with `batch_size_l`; free numeric entry in litres with 0.5 L steps. Display computed factor before commit.
- **D-11:** Bounds: volume > 0, sane maximum (~10× base). If no `batch_size_l`, disable scaling with prompt.

### Claude's Discretion

- Unknown/blank ingredient units → linear scaling (D-03), pending researcher's unit enumeration.
- Exact discrete-unit token set (D-01) — finalize against live catalog.
- Scale-factor display string formatting and where "Target volume (L)" input sits in admin kiosk recipe UI.
- Whether scaled-quantity stock check is also re-run server-side at `/confirm` (belt-and-suspenders).

### Deferred Ideas (OUT OF SCOPE)

- Cross-surface batch-size control (kiosk + BrewPad recipe-attach) — Phase 36.
- One-off ingredient add/remove/substitute — Phase 36.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SCALE-01 | After recipe selected, staff sets target volume in L; system derives and displays scale factor relative to `batch_size_l` | D-10, D-11 locked; `batch_size_l` confirmed on recipe object; admin UI hook point identified in `#kiosk-recipe-prompt` |
| SCALE-02 | Weight ingredients (kg/g) scale linearly; discrete (pcs/unit) round up to whole units | Live unit catalog enumerated: `pcs`/`kg`/`g`/`ft` confirmed; D-01/D-02 locked; no `l`/`ml` found in current ingredient data |
| SCALE-03 | Scaled quantities priced server-authoritatively; locked recipes scale ingredient-cost portion; dynamic recipes price from scaled costs + fixed fees | Current pricing logic fully mapped at lines 96–128 (quote) and 285–299 (confirm); `lib/pricing.js` signatures confirmed for reuse |
| SCALE-04 | Zoho invoice line items and frozen `recipe_snapshot` reflect scaled quantities and `target_volume_l` | `recipe_snapshot` freeze point identified in `brewpad-integration.js` L349–365; exact shape documented below |
| SCALE-05 | Ingredient availability/stock check reflects scaled quantities before sale confirmation | Stock source confirmed: `GET /api/recipes/:id/availability` against `C.CACHE_KEYS.INGREDIENTS` Redis cache; `stock_on_hand` field; re-check at confirm time is feasible and recommended |
</phase_requirements>

---

## Summary

Phase 35 extends `zoho-middleware/routes/pos-recipe.js` with a `target_volume_l` parameter. The scale factor is computed server-side (`factor = target_volume_l / recipe.batch_size_l`), ingredient quantities are scaled in memory (linear for `kg`/`g`/`ft`, ceil-with-floor-1 for `pcs`), and the existing locked/dynamic pricing branches are extended to apply the new formula. A new scaled-quantity stock check (parallel to the `/availability` endpoint logic) gates the confirm step. The admin kiosk UI (`#kiosk-recipe-prompt` div in `admin.html`) gains a "Target volume (L)" input immediately above the existing sale-type buttons.

**Primary recommendation:** Add `target_volume_l` to the request body of both `/api/kiosk/recipe-sale` and `/api/kiosk/recipe-sale/confirm`. Keep scaling logic as a pure helper function in a new `zoho-middleware/lib/recipe-scaling.js` module — independently testable, importable by pos-recipe.js and (in Phase 36) by any other route that needs it.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Scale factor computation | API / Backend | — | Server is authoritative; client may display preview only |
| Quantity rounding (ceil/linear) | API / Backend | — | Server-authoritative; same rule must apply to invoice and snapshot |
| Locked/dynamic repricing | API / Backend | — | Hardened v4.2 money path; pricing.js is canonical |
| Scaled-quantity stock check | API / Backend | — | Stock data lives in middleware Redis; must re-check at confirm |
| Target-volume input + factor preview | Browser / Client | — | Admin kiosk UI only (this phase); preview only, charged price from server |
| Manager override flag | Browser / Client → API | — | Client sends override flag; server applies hard-block unless flag present |
| `recipe_snapshot` freeze with scaled data | API / Backend | — | In `brewpad-integration.detectRecipeSale`; runs fire-and-forget post-confirm |

---

## Standard Stack

No new external packages required. Phase 35 is pure logic wiring within the existing Express + Redis + Apps Script stack.

### Core (existing — no new installs)

| Library | Current Use | Phase 35 Role |
|---------|------------|---------------|
| `zoho-middleware/lib/pricing.js` | `computeLineItem`, `computeCartTotals`, `formatCurrency` | Reuse for scaled per-ingredient subtotals (dynamic mode) |
| `zoho-middleware/lib/cache.js` | Redis `get`/`set`/`acquireLock` | Read `C.CACHE_KEYS.INGREDIENTS` for stock-check at confirm |
| `zoho-middleware/lib/constants.js` | `CACHE_KEYS`, `LOCK_KEYS` | No changes expected |
| `zoho-middleware/routes/pos-recipe.js` | Recipe-sale quote + confirm handlers | Primary file modified |
| `zoho-middleware/lib/brewpad-integration.js` | `detectRecipeSale` + `recipe_snapshot` freeze | Inject `target_volume_l` + scaled ingredients |
| `js/admin.js` (kiosk section) | `#kiosk-recipe-prompt` UI | Add target-volume input, factor readout, stock-conflict block |

### New File (recommended)

| File | Purpose |
|------|---------|
| `zoho-middleware/lib/recipe-scaling.js` | Pure helper: `scaleIngredient(ing, factor)`, `scaleIngredients(ings, factor)`, `computeScaledRecipeTotal(recipe, scaledIngs, catalogMap, saleType)`, `checkScaledStock(scaledIngs, catalogMap)` |

---

## Package Legitimacy Audit

No external packages are being installed in this phase. All dependencies are already present in the project.

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

---

## Architecture Patterns

### System Architecture Diagram

```
Admin Kiosk UI (admin.html #kiosk-recipe-prompt)
  │
  │  POST /api/kiosk/recipe-sale
  │  { recipe_id, sale_type, target_volume_l, mill_grain }
  ▼
pos-recipe.js: recipe-sale handler
  │── fetch recipe from Apps Script (get_recipe)
  │── compute scale_factor = target_volume_l / recipe.batch_size_l
  │── scaleIngredients(ingredients, factor)   ← new lib/recipe-scaling.js
  │── checkScaledStock(scaledIngs, catalogMap) ← stock gate (D-08)
  │   │  oversell? → 409 with conflict list (unless override=true)
  │── computeScaledRecipeTotal(recipe, scaledIngs, catalogMap, saleType)
  │   │  locked: locked_price × factor + service_fee + materials_fee
  │   │  dynamic: Σ(scaledQty × rate) + service_fee + materials_fee
  │── push grandTotal to Helcim terminal → 202 pending
  ▼
pos-recipe.js: recipe-sale/confirm handler
  │  POST /api/kiosk/recipe-sale/confirm
  │  { recipe_id, transaction_id, reference, sale_type, target_volume_l, override }
  │── re-fetch recipe (server-side re-validate)
  │── re-scale ingredients (never trust client quantities)
  │── re-check stock server-side (belt-and-suspenders, D-09)
  │── build lineItems with scaled quantities (Zoho inventory deduction)
  │── determine grandTotal (locked or dynamic, same formula as quote)
  │── POST /invoices to Zoho (scaled line items)
  │── POST /customerpayments to Zoho
  │── bust caches
  │── detectRecipeSale(recipeId, snapshot, ...)   ← pass scaled data
  ▼
brewpad-integration.js: detectRecipeSale
  │── build batchPayload with recipe_snapshot
  │   snapshot now includes: target_volume_l, scale_factor, scaled ingredients
  └── callAppsScriptCreateBatch(batchPayload) — fire-and-forget
```

### Recommended New File Structure

```
zoho-middleware/
├── lib/
│   └── recipe-scaling.js        # NEW — pure scaling helpers
├── routes/
│   └── pos-recipe.js            # MODIFIED — accept target_volume_l, wire scaling
├── __tests__/
│   └── recipe-scaling.test.js   # NEW — unit tests for scaling math
```

### Pattern 1: Pure Scaling Helper Module

**What:** Extract all scaling math into `recipe-scaling.js`, imported by pos-recipe.js.

**Why:** Keeps handlers readable; makes math independently testable (required by SCALE-03 mandate); Phase 36 can import the same helper for kiosk/BrewPad surfaces without code duplication.

```javascript
// zoho-middleware/lib/recipe-scaling.js [ASSUMED — new file, pattern inferred from codebase style]
'use strict';

// Continuous units — scale linearly
var CONTINUOUS_UNITS = ['kg', 'g', 'l', 'ml'];
// Discrete units — ceil with floor of 1
// 'ft' found in live ingredients-cache.json but behaves like discrete (packaging material lengths)
var DISCRETE_UNITS = ['pcs', 'each', 'unit', 'pkg'];

/**
 * Scale a single ingredient quantity.
 * @param {Object} ing    - ingredient with { quantity, unit }
 * @param {number} factor - scale factor (target_volume_l / batch_size_l)
 * @returns {Object}      - shallow clone with scaled quantity
 */
function scaleIngredient(ing, factor) {
  var rawQty = (Number(ing.quantity) || 0) * factor;
  var unitLower = (ing.unit || '').toLowerCase().trim();
  var isDiscrete = DISCRETE_UNITS.indexOf(unitLower) !== -1
    || (CONTINUOUS_UNITS.indexOf(unitLower) === -1 && unitLower !== '');
  // D-03: blank/unknown → treat as continuous (linear)
  if (!unitLower) isDiscrete = false;
  var scaledQty = isDiscrete ? Math.max(1, Math.ceil(rawQty)) : Math.round(rawQty * 10000) / 10000;
  return Object.assign({}, ing, { quantity: scaledQty });
}

/**
 * Scale all ingredients in a recipe.
 */
function scaleIngredients(ingredients, factor) {
  return (ingredients || []).map(function (ing) { return scaleIngredient(ing, factor); });
}

/**
 * Compute grand total for a scaled recipe sale.
 * Locked: locked_price * factor + service_fee + materials_fee
 * Dynamic: Σ(scaledQty * rate) + service_fee + materials_fee
 */
function computeScaledRecipeTotal(recipe, scaledIngredients, catalogMap, saleType) {
  var hasLockedPrice = Number(recipe.locked_price) > 0;
  var pricingMode = recipe.pricing_mode || (hasLockedPrice ? 'locked' : 'dynamic');
  var factor = recipe._scale_factor || 1; // set by caller before passing in
  var total = 0;

  if (pricingMode === 'locked' && hasLockedPrice) {
    total = Number(recipe.locked_price) * factor;
  } else {
    scaledIngredients.forEach(function (ing) {
      var entry = catalogMap[ing.item_id];
      if (entry) total += (Number(ing.quantity) || 0) * (Number(entry.rate) || 0);
    });
  }

  if (saleType === 'in-store') {
    total += Number(recipe.service_fee) || 0;
    total += Number(recipe.materials_fee) || 0;
  }

  return Math.round(total * 100) / 100;
}

/**
 * Check scaled quantities against stock_on_hand.
 * Returns { ok: true } or { ok: false, conflicts: [{ item_id, item_name, needed, stock }] }
 */
function checkScaledStock(scaledIngredients, catalogMap) {
  var conflicts = [];
  (scaledIngredients || []).forEach(function (ing) {
    var entry = catalogMap[ing.item_id];
    if (!entry) return; // unknown item — skip
    var stock = Number(entry.stock_on_hand) || 0;
    var needed = Number(ing.quantity) || 0;
    if (needed > stock) {
      conflicts.push({ item_id: ing.item_id, item_name: ing.item_name, needed: needed, stock: stock, unit: ing.unit });
    }
  });
  return { ok: conflicts.length === 0, conflicts: conflicts };
}

module.exports = { scaleIngredient, scaleIngredients, computeScaledRecipeTotal, checkScaledStock, CONTINUOUS_UNITS, DISCRETE_UNITS };
```

### Pattern 2: Admin UI Target-Volume Input (ES5 IIFE style)

**What:** Insert a `<div>` with a number input for "Target volume (L)" inside `#kiosk-recipe-prompt`, between `#kiosk-recipe-summary` and `#kiosk-avail-banner`. Wire JS to compute and display the factor readout.

**Example HTML addition** (inside `#kiosk-recipe-prompt`, after `#kiosk-recipe-summary`):

```html
<!-- SCALE-01: Target volume input — Phase 35 -->
<div id="kiosk-recipe-volume-wrap" style="display:none;">
  <label class="kiosk-volume-label">
    Target volume (L):
    <input type="number" id="kiosk-target-volume" class="kiosk-volume-input"
           min="0.5" step="0.5" inputmode="decimal" />
  </label>
  <div id="kiosk-scale-factor-readout" class="kiosk-scale-readout"></div>
</div>
```

**JS pattern** (inside the existing `_kioskRecipeContext` setup in `kioskAddRecipeToCart`):

```javascript
// After _kioskSelectedRecipe is set, show volume input and set default
var volWrap = document.getElementById('kiosk-recipe-volume-wrap');
var volInput = document.getElementById('kiosk-target-volume');
var factorReadout = document.getElementById('kiosk-scale-factor-readout');
var baseVol = Number(recipe.batch_size_l) || 0;

if (baseVol > 0) {
  if (volWrap) volWrap.style.display = '';
  if (volInput) { volInput.value = baseVol; volInput.max = baseVol * 10; }
  if (factorReadout) factorReadout.textContent = '1.0× base ' + baseVol.toFixed(1) + ' L';
} else {
  // D-11: no base batch size — disable scaling with prompt
  if (volWrap) volWrap.style.display = '';
  if (volInput) volInput.disabled = true;
  if (factorReadout) factorReadout.textContent = 'Scaling disabled — set base batch size in recipe editor first.';
}
```

### Anti-Patterns to Avoid

- **Computing grandTotal client-side from scaled quantities.** The client sends `target_volume_l`; the server recomputes everything. Never trust `total` from the client body.
- **Changing the ingredient array shape in the API response.** Phase 34 explicitly locked this (D-08 in 34-CONTEXT.md). Scaling is computed in-memory in the handler, not stored back to the recipe.
- **Re-using the kiosk `/availability` HTTP round-trip inside `/confirm`.** Instead, mirror the stock-check logic directly in the handler using the already-fetched `catalogMap` — cheaper and consistent.
- **Assuming `ft` is continuous.** `ft` (2 items in ingredients-cache.json) is packaging material — it behaves discretely (you can't use 0.5 ft of tubing for most uses). Treat it like `pcs` unless the owner confirms otherwise. Flag as `[ASSUMED]` decision point.

---

## Must-Resolve Items — Concrete Findings

### 1. Live Ingredient `unit` Token Values (D-01/D-02/D-03)

**Source:** Direct read of `/Users/koa/dev/steins-and-vines-website/zoho-middleware/ingredients-cache.json` [VERIFIED: local codebase file cache]

**Actual unit distribution in the live ingredients catalog:**

| Unit token | Count | Classification |
|------------|-------|----------------|
| `pcs` | 162 | DISCRETE — ceil with floor 1 |
| `kg` | 27 | CONTINUOUS — linear |
| `g` | 8 | CONTINUOUS — linear |
| `ft` | 2 | DISCRETE (packaging — see note) |
| *(blank/missing)* | 0 seen in cache | DEFAULT → linear per D-03 |

**Key finding:** There are NO `l`, `ml`, `each`, `unit`, `pkg` tokens in the live ingredient catalog today. The test fixtures in `brewpad-recipe.test.js` use `'pkg'` (line 79) — this is a test artifact, not a live unit. However, D-01 lists `pkg`, `each`, `unit` as discrete — these should remain in the discrete set as future-proof entries since they may appear in new recipes.

**`ft` note:** [ASSUMED] Two packaging items use `ft` (likely tubing lengths). Treating as discrete (integral feet) is safer. Confirm with owner before implementing — if linear scaling is desired (e.g. "1.5× the recipe needs 1.5× the hose length"), it should be continuous. Current recommendation: discrete (ceil).

**Planner can hard-code this exact set:**
```javascript
var CONTINUOUS_UNITS = ['kg', 'g', 'l', 'ml']; // l/ml future-proof
var DISCRETE_UNITS   = ['pcs', 'each', 'unit', 'pkg', 'ft']; // ft tentative
// blank/unknown → linear (D-03)
```

**Recipe test fixtures** also show `kg` only — `pos-recipe.test.js` lines 106–107, 274–275, 486–487. No `pcs`-unit ingredients currently appear in recipe test fixtures; the planner must add a test fixture with `pcs` to cover the discrete-rounding path.

---

### 2. Current Locked-Recipe Pricing — Exact Behavior (D-04/D-05/D-06)

**Source:** `zoho-middleware/routes/pos-recipe.js` [VERIFIED: local codebase]

**Quote path (`POST /api/kiosk/recipe-sale`), lines 96–128:**

```javascript
// Line 96 — LOCKED branch:
if (pricingMode === 'locked' && hasLockedPrice) {
  grandTotal = Number(recipe.locked_price);  // ← FLAT locked_price ONLY
  // only milling fee added for take-out (lines 98–105)
  // service_fee and materials_fee are NOT added
}
// Line 107 — DYNAMIC branch:
} else {
  // Σ(ing.quantity * catalogEntry.rate)
  if (body.sale_type === 'in-store') {
    grandTotal += Number(recipe.service_fee) || 0;    // ← fees ONLY in dynamic
    grandTotal += Number(recipe.materials_fee) || 0;
  }
}
```

**Confirm path (`POST /api/kiosk/recipe-sale/confirm`), lines 287–299:**

```javascript
// Line 290 — LOCKED grand total:
if (pricingMode === 'locked' && hasLockedPrice) {
  grandTotal = Number(recipe.locked_price);           // ← FLAT locked_price ONLY
  // + milling if take-out + mill_grain (lines 292–296)
  // service_fee and materials_fee NOT added
}
// Note: lineItems DO include ingredient lines + fee lines for inventory deduction
// but grandTotal for payment recording = locked_price only
```

**CONFIRMED BEHAVIOR CHANGE (D-06):** Today, a locked recipe with `locked_price=45`, `service_fee=45`, `materials_fee=5` charges exactly `$45.00`. After Phase 35, it will charge `$45×1.0 + $45 + $5 = $95.00` at base batch size. This is a **significant price change for all existing locked recipes**. UAT note: inform owner that every existing locked recipe price will effectively increase by `service_fee + materials_fee` at 1× scale.

**Lines that must change in the quote path:**
- Line 97: `grandTotal = Number(recipe.locked_price);` → `grandTotal = Number(recipe.locked_price) * scale_factor;`
- After line 97: add `if (body.sale_type === 'in-store') { grandTotal += Number(recipe.service_fee) || 0; grandTotal += Number(recipe.materials_fee) || 0; }`

**Lines that must change in the confirm path:**
- Line 291: `grandTotal = Number(recipe.locked_price);` → `grandTotal = Number(recipe.locked_price) * scale_factor;`
- After line 291: add same in-store fee addition

---

### 3. Stock / Availability Source (D-08/D-09)

**Source:** `zoho-middleware/routes/recipes.js` lines 303–367 [VERIFIED: local codebase]

**Endpoint:** `GET /api/recipes/:id/availability`

**Stock data field:** `item.stock_on_hand` on each entry in the ingredients catalog cache.

**Cache key:** `C.CACHE_KEYS.INGREDIENTS` (Redis key `'zoho:ingredients'` per constants mock in tests). This is the SAME cache used by:
- `enrichIngredientGroups` in `recipes.js` (Phase 34 enrichment)
- `pos-recipe.js` confirm handler (ingredient catalog lookup for pricing)

**Availability response shape** (lines 342–361):
```javascript
{
  item_id: ing.item_id,
  item_name: ing.item_name,
  unit: ing.unit,
  quantity_per_batch: ing.quantity || 0,   // ← BASE recipe qty (not scaled)
  stock_on_hand: stockMap[String(ing.item_id)] || 0,
  batches_possible: Math.floor(stock / needed),
  status: 'out' | 'low' | 'ok'
}
```

**Critical: the current `/availability` endpoint uses BASE quantities (not scaled).** For Phase 35, the stock check must compare SCALED quantities against `stock_on_hand`. The planner should NOT call `/availability` for the scaled check — instead, implement the check inline in the handler using the same `catalogMap` already fetched.

**Re-run at `/confirm` (belt-and-suspenders, D-09):** Yes — recommended. The `catalogMap` is already fetched at confirm time for pricing. Adding the stock check costs zero extra round-trips. The cache may have been busted by a concurrent sale in the ~30 seconds between quote and confirm, so a confirm-time re-check catches edge cases. Return 409 if stock check fails at confirm with an appropriate message.

**Cold cache:** If `C.CACHE_KEYS.INGREDIENTS` is cold, the current `/availability` endpoint returns `status: 'unknown'`. The scaled stock check should follow the same degradation: return a soft warning but do NOT hard-block if cache is unavailable (availability check is advisory when cache is cold; the hard-block only applies when stock data is available and confirms oversell).

---

### 4. `recipe_snapshot` Freeze Point (SCALE-04)

**Source:** `zoho-middleware/lib/brewpad-integration.js` lines 380–395 [VERIFIED: local codebase]

**Function:** `detectRecipeSale(recipeId, recipeSnapshot, invoiceNumber, customerName, contactId)`

**Called from:** `pos-recipe.js` confirm handler, lines 348–365:

```javascript
// Lines 349–357 — CURRENT snapshot shape:
var snapshot = {
  name: recipe.name,
  style: recipe.style,
  abv: recipe.abv,
  locked_price: recipe.locked_price,
  service_fee: recipe.service_fee,
  materials_fee: recipe.materials_fee,
  ingredients: ingredients  // ← CURRENTLY BASE quantities from Apps Script
};
brewpadIntegration.detectRecipeSale(
  body.recipe_id,
  snapshot,
  invoiceNumber,
  body.customer_name,
  body.contact_id
);
```

**The `ingredients` array passed to the snapshot is the RAW ingredients from Apps Script** (base quantities). To implement SCALE-04, the planner must:

1. Compute `scaledIngredients` before building the snapshot.
2. Change `ingredients: ingredients` → `ingredients: scaledIngredients` in the snapshot object.
3. Add `target_volume_l: Number(body.target_volume_l)` and `scale_factor: scale_factor` to the snapshot.

**Proposed SCALE-04 snapshot shape:**
```javascript
var snapshot = {
  name: recipe.name,
  style: recipe.style,
  abv: recipe.abv,
  locked_price: recipe.locked_price,
  service_fee: recipe.service_fee,
  materials_fee: recipe.materials_fee,
  target_volume_l: targetVolumeL,           // NEW
  scale_factor: scaleFactor,               // NEW
  ingredients: scaledIngredients           // CHANGED: scaled, not base
};
```

The `detectRecipeSale` function itself passes `recipe_snapshot: JSON.stringify(recipeSnapshot || {})` to Apps Script (line 393). No change to `brewpad-integration.js` is required — only the caller (`pos-recipe.js`) needs to build the richer snapshot.

---

### 5. Pricing Primitives (SCALE-03)

**Source:** `zoho-middleware/lib/pricing.js` [VERIFIED: local codebase]

**Signatures:**

```javascript
// computeLineItem(product, qty, options?) → { unitPrice, qty, subtotal, taxRate, taxAmount, total }
// product must have: { rate }
// options: { discountPct?: number, taxRate?: number }
computeLineItem({ rate: 10 }, 1.5, { taxRate: 0.05 })
// → { unitPrice: 10, qty: 1.5, subtotal: 15, taxRate: 0.05, taxAmount: 0.75, total: 15.75 }

// computeCartTotals(lineItems, makersFee?) → { subtotal, taxTotal, makersFee, grandTotal }
// lineItems: array of computeLineItem() outputs (each has { subtotal, taxAmount })
computeCartTotals([li1, li2], 45)

// formatCurrency(amount) → '$12.50'
formatCurrency(95)  // → '$95.00'
```

**Usage pattern for scaled dynamic recipe pricing:**
```javascript
// For each scaled ingredient:
var li = computeLineItem({ rate: catalogEntry.rate }, scaledIng.quantity, { taxRate: taxRate });
// Sum via computeCartTotals — but recipe pricing doesn't use tax at the grandTotal level
// (Zoho computes tax on the invoice); use simpler direct sum as current code does
```

**Note:** The current `pos-recipe.js` does NOT use `computeLineItem`/`computeCartTotals` — it does its own sum loop. The SCALE-03 mandate says "server-authoritative pricing," which is already satisfied. Reusing `computeLineItem` would improve consistency but is optional — the planner may stick with the existing direct-sum pattern for minimal diff.

---

### 6. `batch_size_l` Source (SCALE-01/D-10/D-11)

**Source:** `js/admin.js` lines 8707, 9004, 9435 [VERIFIED: local codebase]; Apps Script recipe schema

**Where it lives:** `batch_size_l` is a top-level field on the recipe object returned by `get_recipe` from Apps Script. It is populated from the `BATCH_SIZE` custom field in BeerXML imports (line 9239) and the `recipe-batch-size` form input (lines 8707, 9004).

**Admin form populates from recipe:** `document.getElementById('recipe-batch-size').value = r.batch_size_l || '';` (line 8707)

**How a recipe with no `batch_size_l` presents:** The field will be `undefined`, `null`, `0`, or `''` (empty string). `parseFloat(r.batch_size_l) || 0` evaluates to `0`. The planner must treat `batch_size_l <= 0` as "not set" and disable scaling per D-11.

**Validation for scale factor:**
```javascript
var baseVol = Number(recipe.batch_size_l) || 0;
if (baseVol <= 0) {
  return res.status(400).json({ error: 'Recipe has no base batch size set. Cannot scale.' });
}
var targetVol = Number(body.target_volume_l) || 0;
if (targetVol <= 0) {
  return res.status(400).json({ error: 'target_volume_l must be > 0' });
}
if (targetVol > baseVol * 10) {
  return res.status(400).json({ error: 'target_volume_l exceeds maximum (10× base)' });
}
var scaleFactor = targetVol / baseVol;
```

**Note:** `batch_size_l` is not explicitly enriched by the middleware — it comes raw from the Apps Script `get_recipe` response. It is already present in the admin recipe editor form and the BeerXML import path, so it should be present on all properly-created recipes.

---

### 7. Admin Recipe-Sale UI Surface (SCALE-01)

**Source:** `admin.html` lines 601–642; `js/admin.js` lines 9775–11331 [VERIFIED: local codebase]

**The "Kiosk Sale" tab** (`data-tab="kiosk"`) is the admin surface for recipe sales. The relevant panel is `#tab-kiosk` → `#kiosk-view-browse` → `#kiosk-product-pane`.

**Recipe prompt HTML block** (lines 625–642 of `admin.html`):
```html
<div id="kiosk-recipe-prompt" style="display:none;">
  <button type="button" class="btn-secondary" id="kiosk-recipe-back">← Back</button>
  <div class="kiosk-recipe-selected-name" id="kiosk-recipe-selected-name"></div>
  <div id="kiosk-recipe-summary"></div>
  <!-- INSERT: target-volume input here (Phase 35) -->
  <div id="kiosk-avail-banner"></div>
  <!-- INSERT: stock-conflict block here (Phase 35, D-08 manager override) -->
  <div class="kiosk-sale-type-btns">
    <button ... id="kiosk-btn-in-store">Ferment in Store</button>
    <button ... id="kiosk-btn-take-out">Take Out</button>
  </div>
  <div id="kiosk-milling-toggle" ...>...</div>
  <button ... id="kiosk-add-recipe-to-cart" style="display:none;">Add to Cart</button>
</div>
```

**Key JS state variables** (admin.js lines 9775–9782):
```javascript
var _kioskRecipes = [];
var _kioskRecipesLoaded = false;
var _kioskRecipesLoading = false;
var _kioskSelectedRecipe = null;      // set when recipe card clicked
var _kioskRecipeAvailability = null;  // availability response from API
var _kioskRecipeContext = null;       // { recipe_id, recipe_name, sale_type, mill_grain, locked_price, ingredients }
```

**Phase 35 adds:**
```javascript
var _kioskTargetVolumeL = null;  // number or null — set from input
var _kioskScaleFactor = 1.0;     // display only; authoritative value computed server-side
```

**`_kioskRecipeContext`** (line 11235–11242) must be extended to include `target_volume_l` so `recipeSaleBody` (line 10391–10399) can pass it to the server:
```javascript
// Current recipeSaleBody (lines 10391–10399):
var recipeSaleBody = {
  recipe_id: _kioskRecipeContext.recipe_id,
  sale_type: _kioskRecipeContext.sale_type,
  mill_grain: _kioskRecipeContext.mill_grain,
  customer_name: ...,
  contact_id: ...,
  reference_number: refNumber,
  idempotency_key: idempotencyKey
};
// Phase 35 adds:
//   target_volume_l: _kioskTargetVolumeL || recipe.batch_size_l
//   override: _kioskStockOverride || false
```

**`confirmBody`** (lines 10415–10423) must also pass `target_volume_l` to the confirm endpoint.

**`kioskShowRecipePrompt`** function (around line 10924) is where the target-volume input div should be shown/populated with the recipe's `batch_size_l` default.

**`kioskUpdateAddToCartButton`** (line 11140) and **`kioskUpdateSummaryPrice`** (line 11093) should also update based on scale factor, using a preview price from the server response to `/recipe-sale` (the 202 response includes `total`).

---

### 8. Test Patterns (SCALE-03 Mandate)

**Source:** `zoho-middleware/__tests__/pos-recipe.test.js`, `zoho-middleware/__tests__/pricing.test.js` [VERIFIED: local codebase]

**Established pattern for pos-recipe tests:**

```javascript
// 1. Mock express to capture route handlers
// 2. jest.resetModules() + require('../routes/pos-recipe') in beforeEach
// 3. callHandler(method, path, { body: {...} }) returns Promise<res>
// 4. Check res._status and res._body
```

**New test file: `zoho-middleware/__tests__/recipe-scaling.test.js`**

Required test cases from CONTEXT.md worked example and SCALE-03:

```javascript
// Worked example from CONTEXT.md (locked_price=45, service=45, materials=5):
// 1.0× → grandTotal = 45×1 + 45 + 5 = $95.00
// 1.5× → grandTotal = 45×1.5 + 45 + 5 = $117.50

test('locked 1.0× base = locked_price + fees', function () {
  // scaleIngredients with factor=1 → quantities unchanged
  // computeScaledRecipeTotal: 45 * 1 + 45 + 5 = 95
  expect(computeScaledRecipeTotal(
    { locked_price: 45, service_fee: 45, materials_fee: 5, pricing_mode: 'locked', _scale_factor: 1 },
    [],  // scaled ingredients not used in locked mode
    {},
    'in-store'
  )).toBe(95.00);
});

test('locked 1.5× = locked_price * 1.5 + fees', function () {
  expect(computeScaledRecipeTotal(
    { locked_price: 45, service_fee: 45, materials_fee: 5, pricing_mode: 'locked', _scale_factor: 1.5 },
    [], {}, 'in-store'
  )).toBe(117.50);
});

test('discrete ceil with floor-of-1: 0.5× of 1 pkg yeast stays 1', function () {
  var result = scaleIngredient({ item_id: 'y1', quantity: 1, unit: 'pcs' }, 0.5);
  expect(result.quantity).toBe(1);  // Math.max(1, Math.ceil(0.5)) = 1
});

test('discrete ceil: 2.3 pcs → 3', function () {
  var result = scaleIngredient({ item_id: 'h1', quantity: 2, unit: 'pcs' }, 1.15);
  // 2 * 1.15 = 2.3 → ceil = 3
  expect(result.quantity).toBe(3);
});

test('continuous: 5 kg × 1.5 = 7.5 kg', function () {
  var result = scaleIngredient({ item_id: 'm1', quantity: 5, unit: 'kg' }, 1.5);
  expect(result.quantity).toBe(7.5);
});

test('blank unit defaults to linear (D-03)', function () {
  var result = scaleIngredient({ item_id: 'x1', quantity: 4, unit: '' }, 1.5);
  expect(result.quantity).toBe(6);  // linear: 4 * 1.5
});
```

**For `pos-recipe.test.js` extensions:** Add test fixtures with `batch_size_l` and `target_volume_l` in request body. Add tests for:
- Missing `batch_size_l` → 400 "no base batch size set"
- `target_volume_l > baseVol * 10` → 400 validation error
- Stock conflict → 409 with `conflicts` array
- Override flag bypasses stock block
- Locked recipe at 1.5× charges `locked_price * 1.5 + fees`
- Dynamic recipe at 1.5× charges `Σ(scaledQty * rate) + fees`

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Money rounding | Custom round logic | `Math.round(x * 100) / 100` (already in pricing.js) | Existing pattern; avoid float drift |
| Cache read for stock | New cache module | `cache.get(C.CACHE_KEYS.INGREDIENTS)` | Already fetched for pricing in same handler |
| Ingredient catalog lookup | Another Zoho fetch | Re-use the `catalogMap` built in the same handler | Same map already contains `stock_on_hand` |
| Feature gate | New env var | Re-use `BEER_SALES_ENABLED` gate | Already at top of both handlers (line 45/185) |

---

## Common Pitfalls

### Pitfall 1: Trusting Client-Supplied `target_volume_l` at Confirm

**What goes wrong:** Handler re-fetches recipe from Apps Script at confirm time (correct) but uses client-supplied `target_volume_l` and client-supplied scaled quantities without re-computing.

**Why it happens:** The handler's "never trust client data" discipline is already applied to the recipe object, but `target_volume_l` is a new body param that might slip through.

**How to avoid:** Re-compute `scaleFactor = targetVolumeL / recipe.batch_size_l` and `scaledIngredients = scaleIngredients(ingredients, scaleFactor)` server-side at BOTH the quote handler AND the confirm handler. Never use client-supplied ingredient quantities.

**Warning signs:** If the confirm handler skips `scaleIngredients` and uses `ingredients` from Apps Script directly, scaled invoices will use base quantities.

### Pitfall 2: Forgetting to Pass `target_volume_l` in `confirmBody`

**What goes wrong:** The quote step (`/recipe-sale` → 202) receives `target_volume_l` and returns a correct preview total. But the client's `confirmBody` (line 10415–10423 in admin.js) does not include `target_volume_l`, so the confirm handler defaults to `scale_factor = 1.0`.

**Why it happens:** The confirm body is assembled separately from the sale body; `target_volume_l` is easy to forget.

**How to avoid:** Add `target_volume_l` explicitly to `confirmBody`. Add a test that verifies the confirm step uses the same scale factor as the quote step.

### Pitfall 3: Invoice `grandTotal` Mismatch Between Quote and Confirm

**What goes wrong:** The terminal is charged `grandTotal` from the quote step. If the confirm step re-computes a different `grandTotal` (e.g. due to catalog price change in the 30-second window), the payment amount and invoice amount diverge.

**Why it happens:** Catalog rates can change between quote and confirm.

**How to avoid:** The existing code has this issue for dynamic recipes too — it's a known accepted trade-off (the terminal charge is authoritative). No special handling needed for scaling beyond what already exists.

### Pitfall 4: `batch_size_l` Not Available in Quote Handler

**What goes wrong:** The quote handler fetches the recipe from Apps Script, but `batch_size_l` is not included in the Apps Script `get_recipe` response.

**Why it happens:** The Apps Script `get_recipe` action must include `batch_size_l` in its return payload. If it was added to the recipe schema but not to the return shape, the field will be undefined.

**How to avoid:** Verify that `batch_size_l` appears in the Apps Script `get_recipe` response by testing against staging before implementing the scale-factor computation. If missing, an Apps Script change is required (human-action checkpoint).

**Warning signs:** `recipe.batch_size_l` is `undefined` or `0` for recipes that clearly have a batch size set in the editor.

### Pitfall 5: Stock Check Using Base Quantities

**What goes wrong:** The scaled stock check calls the existing `/availability` endpoint, which uses BASE recipe quantities. A 1.5× batch that would oversell passes the check because the endpoint checks 1× needs.

**Why it happens:** The existing `/availability` endpoint is useful for pre-sale display but isn't designed for scaled checks.

**How to avoid:** Implement the scaled stock check inline in the handler — compare `scaledIng.quantity` against `catalogMap[ing.item_id].stock_on_hand` directly. Do not call `/availability`.

### Pitfall 6: Apps Script Manual Redeploy Required

**What goes wrong:** If `batch_size_l` is not already in the Apps Script `get_recipe` response, it must be added there. Apps Script changes require a manual `Deploy > Manage Deployments > New Deployment` in the Google Apps Script editor — not in CI. Forgetting this leaves staging broken.

**How to avoid:** Flag as a human-action checkpoint in the plan. The planner should make this a Wave 0 item if Apps Script changes are needed.

---

## Runtime State Inventory

> Omitted — this is a greenfield feature addition, not a rename/refactor/migration phase. No stored data uses a string that needs updating.

---

## Environment Availability

No new external dependencies required. All tools, services, and environment variables already present.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Redis | `C.CACHE_KEYS.INGREDIENTS` stock check | ✓ | Configured in Railway | Cold-cache degradation: skip stock check (soft warning) |
| Apps Script (`get_recipe`) | recipe + `batch_size_l` source | ✓ | Deployed | None — scaling disabled if recipe fetch fails |
| `BEER_SALES_ENABLED` env var | Feature gate | ✓ | Set in Railway (currently 'false' for beer) | Hard-blocked at 403 if false |
| `MAKERS_FEE_ITEM_ID`, `MATERIALS_FEE_ITEM_ID` | Fee line items on invoice | ✓ | Set in Railway | Fee lines skipped if unset (existing behavior) |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** Cold Redis → stock check degrades to "unknown" (soft warn, don't hard-block).

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Jest (Node environment) |
| Config file | `zoho-middleware/jest.config.js` |
| Quick run command | `cd zoho-middleware && npm test -- --testPathPattern recipe-scaling` |
| Full suite command | `cd zoho-middleware && npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SCALE-01 | `batch_size_l=0` → 400 from quote endpoint | unit | `npm test -- --testPathPattern pos-recipe` | ✅ (extend existing) |
| SCALE-01 | Factor display readout in admin UI | manual | iPad/desktop browser UAT | N/A |
| SCALE-02 | `kg` ingredient × 1.5 → linear quantity | unit | `npm test -- --testPathPattern recipe-scaling` | ❌ Wave 0 |
| SCALE-02 | `pcs` ingredient × 0.5 → ceil with floor 1 | unit | `npm test -- --testPathPattern recipe-scaling` | ❌ Wave 0 |
| SCALE-02 | blank unit → linear scaling (D-03) | unit | `npm test -- --testPathPattern recipe-scaling` | ❌ Wave 0 |
| SCALE-03 | Locked 1.0× = locked_price + fees ($95) | unit | `npm test -- --testPathPattern recipe-scaling` | ❌ Wave 0 |
| SCALE-03 | Locked 1.5× = locked_price×1.5 + fees ($117.50) | unit | `npm test -- --testPathPattern recipe-scaling` | ❌ Wave 0 |
| SCALE-03 | Dynamic 1.5× = Σ(scaledQty × rate) + fees | unit | `npm test -- --testPathPattern pos-recipe` | ❌ Wave 0 |
| SCALE-04 | Zoho invoice line items use scaled qty | unit (mock zohoPost) | `npm test -- --testPathPattern pos-recipe` | ❌ Wave 0 |
| SCALE-04 | `recipe_snapshot` includes `target_volume_l` + scaled ings | unit | `npm test -- --testPathPattern pos-recipe` | ❌ Wave 0 |
| SCALE-05 | Stock conflict → 409 with conflicts list | unit | `npm test -- --testPathPattern pos-recipe` | ❌ Wave 0 |
| SCALE-05 | Override flag bypasses stock block | unit | `npm test -- --testPathPattern pos-recipe` | ❌ Wave 0 |
| SCALE-05 | Cold cache → soft warning, no hard-block | unit | `npm test -- --testPathPattern pos-recipe` | ❌ Wave 0 |

### Wave 0 Gaps

- [ ] `zoho-middleware/__tests__/recipe-scaling.test.js` — new file covering SCALE-02, SCALE-03 pure math (scaleIngredient, scaleIngredients, computeScaledRecipeTotal, checkScaledStock)
- [ ] Extend `zoho-middleware/__tests__/pos-recipe.test.js` — SCALE-01 validation, SCALE-03 route-level, SCALE-04 invoice shape, SCALE-05 stock gate + override

---

## Security Domain

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V5 Input Validation | yes | Validate `target_volume_l > 0` and `<= base * 10`; `recipe_id` already validated |
| V2 Authentication | no (admin-only feature, existing auth) | — |
| V4 Access Control | no (existing BEER_SALES_ENABLED gate) | — |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Client sends inflated `target_volume_l` to get a discount via rounding | Tampering | Server recomputes price from `target_volume_l`; client cannot lower price by choosing odd volume |
| Client sends `override: true` without manager knowledge | Tampering | This is a known risk accepted by D-08 design; document in UAT. No cryptographic guard in scope. |
| Client supplies `scale_factor` directly instead of `target_volume_l` | Tampering | Server MUST compute `scale_factor = target_volume_l / batch_size_l` internally; never accept `scale_factor` as a body param |

---

## State of the Art

| Old Approach | Current Approach | Phase 35 Change |
|--------------|------------------|-----------------|
| Locked recipe: flat `locked_price` | Locked recipe: flat `locked_price` | Locked recipe: `locked_price × factor + fees` |
| Dynamic recipe: `Σ(qty × rate) + fees` | Dynamic recipe: `Σ(qty × rate) + fees` | Dynamic recipe: `Σ(scaledQty × rate) + fees` |
| Invoice: base quantities | Invoice: base quantities | Invoice: scaled quantities |
| Snapshot: base quantities | Snapshot: base quantities | Snapshot: scaled quantities + `target_volume_l` |
| Stock check: 1× (base qty) | Stock check: 1× | Stock check: scaled qty (new hard-block) |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `ft` (2 items in ingredients-cache.json) should be treated as discrete (ceil) | Standard Stack / Unit Token Values | If owner wants linear `ft` scaling, change `DISCRETE_UNITS` to exclude `ft` before implementation |
| A2 | `batch_size_l` is already returned by the Apps Script `get_recipe` action | `batch_size_l` Source | If not in `get_recipe` response, an Apps Script change + manual redeploy is needed (human-action checkpoint) |
| A3 | The admin Kiosk Sale tab (data-tab="kiosk") is the only admin surface wired in Phase 35 (not the Recipes tab) | Admin UI Surface | Phase 35 CONTEXT is explicit — admin kiosk surface only. Correct as stated. LOW risk. |
| A4 | `l` and `ml` do not appear in the live ingredient catalog but should be in `CONTINUOUS_UNITS` for future-proofing | Unit Token Values | If a recipe uses `l` or `ml` and they are missing from the set, they'd fall through as "discrete" — wrong behavior |
| A5 | Manager override is a simple boolean flag in the request body with no additional authentication | D-08 / Pitfall 3 | If owner decides override needs a PIN or manager-level auth, this is a scope change for Phase 35 |

**If this table is empty:** Not empty — 5 assumptions logged.

---

## Open Questions (RESOLVED)

1. **Does Apps Script `get_recipe` return `batch_size_l`?**
   - What we know: `batch_size_l` is stored in the Apps Script Google Sheet and is populated via the admin recipe editor form and BeerXML import.
   - What's unclear: Whether the Apps Script `get_recipe` action explicitly includes `batch_size_l` in its return payload, or whether it only returns the fields used before Phase 35.
   - Recommendation: Test on staging (call `GET /api/recipes/:id` and check the recipe object) before writing the scaling handler. If absent, add an Apps Script update as Wave 0 (human-action checkpoint).
   - **Resolution: GATED — resolved at execution time by Plan 35-01 blocking checkpoint.** Plan 35-01 probes the live `get_recipe` response and remediates + redeploys the Apps Script if `batch_size_l` is absent before any scaling code runs.

2. **Is `ft` discrete or continuous for scaling?**
   - What we know: 2 ingredient items use `ft` units (likely tubing/hose material lengths).
   - What's unclear: Does the owner want 1.5× of a 10 ft hose to be 15 ft (continuous) or 1 unit (discrete)? The context of "packaging material" suggests continuous, but physical tubing cuts as integer lengths in practice.
   - Recommendation: Default to discrete (ceil) as the safer choice; confirm with owner before first staging deploy.
   - **Resolution: ASSUMED-RESOLVED — `ft` is treated as discrete (ceil) per the recommendation, owner-confirmable.** Carried into `DISCRETE_UNITS` in Plan 35-02 with an `[ASSUMED]` code comment; flip to continuous only if the owner requests it.

3. **Does the manager override need authentication beyond the UI?**
   - What we know: D-08 specifies "explicit manager override" — a UI gate to proceed despite stock conflicts.
   - What's unclear: Whether the override should require a separate manager PIN, or whether pressing a button is sufficient (any logged-in admin can override).
   - Recommendation: Simple button confirmation (same as existing confirm patterns in the admin UI) unless owner specifies otherwise.
   - **Resolution: RESOLVED — a simple UI confirm within the existing Google-OAuth admin session per D-08.** No separate PIN/manager auth in scope; the override is a boolean flag the server honors only when present (T-35-03-03 accepted).

---

## Sources

### Primary (HIGH confidence)
- `zoho-middleware/routes/pos-recipe.js` — locked/dynamic pricing branches; exact line numbers cited above
- `zoho-middleware/lib/brewpad-integration.js` — `detectRecipeSale` and `recipe_snapshot` freeze; exact code cited
- `zoho-middleware/routes/recipes.js` — `/availability` endpoint implementation and stock field
- `zoho-middleware/lib/pricing.js` — `computeLineItem`/`computeCartTotals`/`formatCurrency` signatures
- `zoho-middleware/ingredients-cache.json` — live unit distribution (`pcs`/`kg`/`g`/`ft`)
- `js/admin.js` — `#kiosk-recipe-prompt` UI, `_kioskRecipeContext`, `recipeSaleBody`/`confirmBody`
- `admin.html` — `#kiosk-recipe-prompt` HTML, `#tab-kiosk` panel
- `zoho-middleware/__tests__/pos-recipe.test.js` — test patterns (mocking, callHandler, fixtures)
- `zoho-middleware/__tests__/pricing.test.js` — pricing test patterns
- `.planning/phases/35-batch-scaling-engine/35-CONTEXT.md` — all locked decisions

### Secondary (MEDIUM confidence)
- `zoho-middleware/__tests__/brewpad-recipe.test.js` — unit fixtures (`kg`, `g`, `pkg`) confirming test patterns
- `.planning/phases/34-ingredient-display-server-enrichment/34-CONTEXT.md` — ingredient array shape constraints (D-08 in that phase)

### Tertiary (LOW confidence — assumed)
- `recipe-scaling.js` module design — inferred from codebase patterns; no existing file to verify against
- Apps Script `get_recipe` response includes `batch_size_l` — must be verified against staging

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — verified against live codebase files
- Architecture: HIGH — exact line numbers and function signatures from source
- Pitfalls: HIGH — derived from reading both handlers in full
- Unit token values: HIGH — read directly from live ingredients-cache.json
- Current locked-pricing behavior: HIGH — code cited verbatim
- Apps Script `get_recipe` response shape: LOW — not directly readable; must verify on staging

**Research date:** 2026-06-20
**Valid until:** 2026-07-20 (stable codebase; invalidated if Apps Script schema changes)

---

## RESEARCH COMPLETE

**Phase:** 35 — Batch Scaling Engine
**Confidence:** HIGH

### Key Findings

1. **Live unit tokens:** Only `pcs` (162), `kg` (27), `g` (8), and `ft` (2) appear in the live ingredients catalog. No `l`, `ml`, `each`, `unit`, or `pkg` in live data — but these should remain in the discrete/continuous sets for future-proofing. No blank units found in the cache.

2. **CONFIRMED BEHAVIOR CHANGE (D-06):** Current locked-price path (pos-recipe.js lines 96–97 and 290–291) charges EXACTLY `locked_price` — no fees added. The D-04 formula adds `service_fee + materials_fee` on top, which means all existing locked recipes will increase in price at 1× scale. Must be surfaced in UAT.

3. **Stock source:** `GET /api/recipes/:id/availability` uses `C.CACHE_KEYS.INGREDIENTS` Redis cache, field `stock_on_hand`. The confirm handler ALREADY fetches this same cache for pricing — the scaled stock check can be done inline with zero extra round-trips. Re-checking at confirm is recommended and cheap.

4. **`recipe_snapshot` freeze point:** `pos-recipe.js` lines 349–365 build the snapshot with base `ingredients` from Apps Script. Change `ingredients: ingredients` to `ingredients: scaledIngredients` and add `target_volume_l` + `scale_factor`. No changes to `brewpad-integration.js`.

5. **Admin UI hook:** The target-volume input inserts between `#kiosk-recipe-summary` and `#kiosk-avail-banner` in `#kiosk-recipe-prompt`. JS state: extend `_kioskRecipeContext` with `target_volume_l`; pass it in both `recipeSaleBody` and `confirmBody`.

6. **Open question to verify before Wave 1:** Confirm `batch_size_l` is returned by the Apps Script `get_recipe` action. If not, an Apps Script update (human-action) is needed before the middleware scaling handler can compute the factor.

### File Created
`.planning/phases/35-batch-scaling-engine/35-RESEARCH.md`

### Confidence Assessment

| Area | Level | Reason |
|------|-------|--------|
| Current locked pricing behavior | HIGH | Verbatim code cited from pos-recipe.js |
| Unit token values | HIGH | Read from live ingredients-cache.json |
| Admin UI hook points | HIGH | admin.html + admin.js read directly |
| `recipe_snapshot` shape | HIGH | brewpad-integration.js read directly |
| pricing.js signatures | HIGH | pricing.js read directly |
| Apps Script `get_recipe` includes `batch_size_l` | LOW | Not directly verifiable without staging call |

### Open Questions (RESOLVED)

1. Does `batch_size_l` appear in the Apps Script `get_recipe` response? — **GATED — resolved at execution time by Plan 35-01 blocking checkpoint** (probe + remediate/redeploy before Wave 1).
2. Should `ft` units scale discretely (ceil) or continuously (linear)? — **ASSUMED-RESOLVED — discrete (ceil) per recommendation, owner-confirmable** (in `DISCRETE_UNITS`, flagged `[ASSUMED]`).
3. Does the manager override need any authentication beyond a UI button? — **RESOLVED — simple UI confirm within the existing Google-OAuth admin session per D-08** (no separate PIN; boolean flag honored server-side).

### Ready for Planning

Research complete. Planner can now create PLAN.md files for Phase 35.
