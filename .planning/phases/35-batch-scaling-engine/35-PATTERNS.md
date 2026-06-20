# Phase 35: Batch Scaling Engine - Pattern Map

**Mapped:** 2026-06-20
**Files analyzed:** 7 (1 new, 4 modified, 1 new test, 1 extended test)
**Analogs found:** 7 / 7

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `zoho-middleware/lib/recipe-scaling.js` | utility | transform | `zoho-middleware/lib/pricing.js` | role-match |
| `zoho-middleware/routes/pos-recipe.js` | route/handler | request-response | `zoho-middleware/routes/pos-recipe.js` | self (modify) |
| `zoho-middleware/lib/brewpad-integration.js` | service | event-driven | `zoho-middleware/lib/brewpad-integration.js` | self (modify, minimal) |
| `zoho-middleware/__tests__/recipe-scaling.test.js` | test | — | `zoho-middleware/__tests__/pricing.test.js` | exact |
| `zoho-middleware/__tests__/pos-recipe.test.js` | test | — | `zoho-middleware/__tests__/pos-recipe.test.js` | self (extend) |
| `admin.html` | config/markup | — | `admin.html` lines 625–642 | self (insert) |
| `js/admin.js` (kiosk section) | component | request-response | `js/admin.js` `kioskShowRecipePrompt` (line 10900) | self (modify) |

---

## Pattern Assignments

### `zoho-middleware/lib/recipe-scaling.js` (utility, transform)

**Analog:** `zoho-middleware/lib/pricing.js`

This is a NEW file. Copy the module skeleton, `'use strict'` header, JSDoc comment style, money-rounding idiom, and `module.exports` shape from `pricing.js`.

**Module skeleton pattern** (`zoho-middleware/lib/pricing.js` lines 1–15):
```javascript
'use strict';

/**
 * [Module description]
 *
 * Exports:
 *   functionName(args) → returnShape
 */
```

**Money-rounding idiom** (`zoho-middleware/lib/pricing.js` lines 62, 66–67, 113):
```javascript
// Round after each multiplication to prevent float drift:
var subtotal = Math.round(effectiveUnitPrice * qty * 100) / 100;
var taxAmount = Math.round(subtotal * taxRate * 100) / 100;
// Round after accumulation too:
subtotal = Math.round(subtotal * 100) / 100;
```

**module.exports shape** (`zoho-middleware/lib/pricing.js` lines 123–127):
```javascript
module.exports = {
  formatCurrency:    formatCurrency,
  computeLineItem:   computeLineItem,
  computeCartTotals: computeCartTotals
};
```

Apply the same named-export pattern for `recipe-scaling.js`:
```javascript
module.exports = {
  scaleIngredient:           scaleIngredient,
  scaleIngredients:          scaleIngredients,
  computeScaledRecipeTotal:  computeScaledRecipeTotal,
  checkScaledStock:          checkScaledStock,
  CONTINUOUS_UNITS:          CONTINUOUS_UNITS,
  DISCRETE_UNITS:            DISCRETE_UNITS
};
```

**Unit classification constants** (finalized from RESEARCH.md §1 — live catalog):
```javascript
// Continuous units — scale linearly (l/ml future-proof; not in live catalog today)
var CONTINUOUS_UNITS = ['kg', 'g', 'l', 'ml'];
// Discrete units — Math.max(1, Math.ceil(scaledQty))
// ft: [ASSUMED discrete] — 2 packaging items; confirm with owner before prod
var DISCRETE_UNITS   = ['pcs', 'each', 'unit', 'pkg', 'ft'];
// blank/unknown → linear (D-03)
```

**`Object.assign` shallow-clone pattern** (used throughout `pos-recipe.js` for body params):
```javascript
// Shallow-clone ingredient object with one field replaced — don't mutate the
// original Apps Script response
return Object.assign({}, ing, { quantity: scaledQty });
```

**`Array.prototype.forEach` / `map` ES5 style** (`pos-recipe.js` lines 86–88, 109–115):
```javascript
ingredientCatalog.forEach(function (item) {
  if (item && item.item_id) catalogMap[item.item_id] = item;
});
// and
for (var i = 0; i < ingredients.length; i++) {
  var ing = ingredients[i];
  // ...
}
```
Either `forEach`+`map` or `for` loops are acceptable — the codebase uses both. Prefer `map` for transforms that produce a new array (scaleIngredients).

---

### `zoho-middleware/routes/pos-recipe.js` (route/handler, request-response)

**Analog:** Self — this file is modified. The patterns below are the EXISTING code structures that the new scaling logic must slot into.

**Feature gate pattern** (lines 44–47, repeated at line 181–184):
```javascript
// Always first — feature gate before any other processing
if ((process.env.BEER_SALES_ENABLED || 'false').toLowerCase() !== 'true') {
  return res.status(403).json({ error: 'Recipe sales are not enabled' });
}
```

**Input validation pattern** (lines 57–63):
```javascript
if (!body.recipe_id || typeof body.recipe_id !== 'string' || !body.recipe_id.trim()) {
  return res.status(400).json({ error: 'Missing recipe_id' });
}
if (body.sale_type !== 'in-store' && body.sale_type !== 'take-out') {
  return res.status(400).json({ error: 'sale_type must be in-store or take-out' });
}
```

**New validation to add** (after existing checks, per RESEARCH.md §6):
```javascript
var targetVolumeL = Number(body.target_volume_l) || 0;
var baseVol = Number(recipe.batch_size_l) || 0;
// D-11: no base batch size → disable scaling with 400
if (baseVol <= 0) {
  return res.status(400).json({ error: 'Recipe has no base batch size set. Cannot scale.' });
}
if (targetVolumeL <= 0) {
  return res.status(400).json({ error: 'target_volume_l must be > 0' });
}
if (targetVolumeL > baseVol * 10) {
  return res.status(400).json({ error: 'target_volume_l exceeds maximum (10\xd7 base)' });
}
var scaleFactor = targetVolumeL / baseVol;
```

**catalogMap build pattern** (lines 85–88 — reuse exactly, unchanged):
```javascript
var catalogMap = {};
ingredientCatalog.forEach(function (item) {
  if (item && item.item_id) catalogMap[item.item_id] = item;
});
```

**Locked pricing branch that CHANGES** (lines 96–97 — current code; D-06 approved change):
```javascript
// CURRENT (lines 96–97) — flat locked_price only:
if (pricingMode === 'locked' && hasLockedPrice) {
  grandTotal = Number(recipe.locked_price);

// PHASE 35 CHANGE — scale ingredient portion + add fixed fees:
if (pricingMode === 'locked' && hasLockedPrice) {
  grandTotal = Number(recipe.locked_price) * scaleFactor;
  if (body.sale_type === 'in-store') {
    grandTotal += Number(recipe.service_fee) || 0;
    grandTotal += Number(recipe.materials_fee) || 0;
  }
```

**Dynamic pricing branch that CHANGES** (lines 107–128 — replace per-ingredient sum with scaled sum):
```javascript
// CURRENT: uses ingredients[i].quantity directly
// PHASE 35: call scaleIngredients() first, then sum scaledIngredients
var scaledIngredients = scaling.scaleIngredients(ingredients, scaleFactor);
for (var i = 0; i < scaledIngredients.length; i++) {
  var ing = scaledIngredients[i];
  var catalogEntry = catalogMap[ing.item_id];
  if (catalogEntry) {
    grandTotal += (Number(ing.quantity) || 0) * (Number(catalogEntry.rate) || 0);
  }
}
// service_fee / materials_fee blocks unchanged — still fixed, not scaled
```

**Stock conflict response pattern** (new — modeled on existing 503/400 patterns, lines 154–158):
```javascript
// 409 conflict — hard-block with conflict list, override escape hatch
var stockCheck = scaling.checkScaledStock(scaledIngredients, catalogMap);
if (!stockCheck.ok && !body.override) {
  return res.status(409).json({
    error: 'Insufficient stock for scaled batch',
    conflicts: stockCheck.conflicts
  });
}
```

**202 response shape** (lines 143–151 — add `scale_factor` and `target_volume_l`):
```javascript
// CURRENT:
res.status(202).json({
  pending: true,
  reference: refNumber,
  recipe_id: body.recipe_id,
  sale_type: body.sale_type,
  mill_grain: millGrain,
  total: grandTotal
});
// PHASE 35 ADDS:
//   scale_factor: scaleFactor,
//   target_volume_l: targetVolumeL
```

**`recipe_snapshot` build site** (lines 349–364 — CHANGE `ingredients: ingredients` to scaled):
```javascript
// CURRENT (lines 349–357):
var snapshot = {
  name: recipe.name,
  style: recipe.style,
  abv: recipe.abv,
  locked_price: recipe.locked_price,
  service_fee: recipe.service_fee,
  materials_fee: recipe.materials_fee,
  ingredients: ingredients          // ← BASE quantities from Apps Script
};

// PHASE 35 CHANGE (SCALE-04):
var snapshot = {
  name: recipe.name,
  style: recipe.style,
  abv: recipe.abv,
  locked_price: recipe.locked_price,
  service_fee: recipe.service_fee,
  materials_fee: recipe.materials_fee,
  target_volume_l: targetVolumeL,   // NEW
  scale_factor: scaleFactor,        // NEW
  ingredients: scaledIngredients    // CHANGED: scaled, not base
};
```

**Error handling pattern** (lines 163–171, 433–443 — standard .catch chain):
```javascript
}).catch(function (cacheErr) {
  log.error('[pos-recipe/recipe-sale] Cache error: ' + cacheErr.message);
  res.status(503).json({ error: 'Ingredient catalog not available — try again shortly' });
});
// ...
.catch(function (appsErr) {
  log.error('[pos-recipe/recipe-sale] Apps Script error: ' + appsErr.message);
  res.status(502).json({ error: 'Failed to fetch recipe. Please try again.' });
});
```

**Require the new scaling module** (add at top with other requires, lines 1–13):
```javascript
var scaling = require('../lib/recipe-scaling');
```

---

### `zoho-middleware/lib/brewpad-integration.js` (service, event-driven)

**Analog:** Self — minimal change. Only the CALLER (`pos-recipe.js`) changes; `detectRecipeSale` itself is unchanged.

**`detectRecipeSale` signature** (lines 380–395 — read-only reference, do not modify):
```javascript
function detectRecipeSale(recipeId, recipeSnapshot, invoiceNumber, customerName, contactId) {
  // ...
  recipe_snapshot: JSON.stringify(recipeSnapshot || {})
  // ...
  callAppsScriptCreateBatch(batchPayload).catch(function () {});
}
```

The function serializes `recipeSnapshot` as JSON and passes it to Apps Script. No change needed here — the enriched snapshot (`target_volume_l`, `scale_factor`, `ingredients: scaledIngredients`) is constructed by `pos-recipe.js` before calling this function.

---

### `zoho-middleware/__tests__/recipe-scaling.test.js` (test)

**Analog:** `zoho-middleware/__tests__/pricing.test.js`

This is a NEW file. Copy the test file structure exactly from `pricing.test.js`.

**File header pattern** (`pricing.test.js` lines 1–7):
```javascript
'use strict';

var pricing = require('../lib/pricing');
var formatCurrency  = pricing.formatCurrency;
var computeLineItem = pricing.computeLineItem;
var computeCartTotals = pricing.computeCartTotals;
```

Apply to `recipe-scaling.test.js`:
```javascript
'use strict';

var scaling = require('../lib/recipe-scaling');
var scaleIngredient          = scaling.scaleIngredient;
var scaleIngredients         = scaling.scaleIngredients;
var computeScaledRecipeTotal = scaling.computeScaledRecipeTotal;
var checkScaledStock         = scaling.checkScaledStock;
```

**`describe` / `test` structure** (`pricing.test.js` lines 11–41):
```javascript
describe('formatCurrency', function () {
  test('formats a simple positive number', function () {
    expect(formatCurrency(12.5)).toBe('$12.50');
  });
  // ...
});
```

**No mocks needed** for `recipe-scaling.js` — it is a pure function module with no I/O or requires. Do NOT add `jest.mock(...)` calls.

**Required test cases** (from CONTEXT.md §Specific Ideas and RESEARCH.md §8):
```javascript
// Continuous scaling
describe('scaleIngredient — continuous units', function () {
  test('kg × 1.5 = linear', function () {
    var result = scaleIngredient({ item_id: 'm1', quantity: 5, unit: 'kg' }, 1.5);
    expect(result.quantity).toBe(7.5);
  });
  test('g × 1.5 = linear', function () {
    var result = scaleIngredient({ item_id: 'h1', quantity: 100, unit: 'g' }, 1.5);
    expect(result.quantity).toBe(150);
  });
});

// Discrete rounding (D-01/D-02)
describe('scaleIngredient — discrete units', function () {
  test('pcs ceil: 2 × 1.15 = 2.3 → 3', function () {
    var result = scaleIngredient({ item_id: 'h1', quantity: 2, unit: 'pcs' }, 1.15);
    expect(result.quantity).toBe(3);
  });
  test('floor-of-1: 0.5× of 1 pcs yeast stays 1 (D-02)', function () {
    var result = scaleIngredient({ item_id: 'y1', quantity: 1, unit: 'pcs' }, 0.5);
    expect(result.quantity).toBe(1); // Math.max(1, Math.ceil(0.5)) = 1
  });
});

// Blank/unknown unit → linear (D-03)
describe('scaleIngredient — blank/unknown unit', function () {
  test('blank unit → linear scaling', function () {
    var result = scaleIngredient({ item_id: 'x1', quantity: 4, unit: '' }, 1.5);
    expect(result.quantity).toBe(6);
  });
});

// Locked pricing (D-04/D-05 — worked example from CONTEXT.md)
describe('computeScaledRecipeTotal — locked pricing', function () {
  test('locked 1.0× = locked_price + fees ($95)', function () {
    expect(computeScaledRecipeTotal(
      { locked_price: 45, service_fee: 45, materials_fee: 5, pricing_mode: 'locked', _scale_factor: 1 },
      [], {}, 'in-store'
    )).toBe(95.00);
  });
  test('locked 1.5× = locked_price × 1.5 + fees ($117.50)', function () {
    expect(computeScaledRecipeTotal(
      { locked_price: 45, service_fee: 45, materials_fee: 5, pricing_mode: 'locked', _scale_factor: 1.5 },
      [], {}, 'in-store'
    )).toBe(117.50);
  });
});

// Stock check (D-08)
describe('checkScaledStock', function () {
  test('ok when all scaled quantities within stock', function () {
    var result = checkScaledStock(
      [{ item_id: 'a', item_name: 'Malt', quantity: 5, unit: 'kg' }],
      { a: { stock_on_hand: 10 } }
    );
    expect(result.ok).toBe(true);
    expect(result.conflicts).toHaveLength(0);
  });
  test('conflict when scaled quantity exceeds stock', function () {
    var result = checkScaledStock(
      [{ item_id: 'a', item_name: 'Hops', quantity: 7, unit: 'kg' }],
      { a: { stock_on_hand: 5 } }
    );
    expect(result.ok).toBe(false);
    expect(result.conflicts[0].item_id).toBe('a');
  });
});
```

---

### `zoho-middleware/__tests__/pos-recipe.test.js` (test, extended)

**Analog:** Self — extend existing file. Read the full mock setup above (lines 1–148) before adding tests.

**Existing `beforeEach` pattern** (lines 154–172) — extend with `batch_size_l` in the mock recipe fixture:
```javascript
// In MOCK_RECIPE_RESPONSE.data.data.recipe, add:
batch_size_l: 20

// Or add a new fixture for scaling tests:
var MOCK_RECIPE_RESPONSE_WITH_BATCH_SIZE = {
  data: {
    ok: true,
    data: {
      recipe: {
        recipe_id: 'RCP-001',
        name: 'Cascade Pale Ale',
        style: 'American Pale Ale',
        abv: 5.2,
        batch_size_l: 20,          // ← enables scaling
        locked_price: 195.00,
        service_fee: 45.00,
        materials_fee: 5.00,
        status: 'active'
      },
      ingredients: [
        { ingredient_id: 'ING-001', item_id: 'ing-malt-1', item_name: 'Pale Malt 2-Row', quantity: 5.5, unit: 'kg' },
        { ingredient_id: 'ING-002', item_id: 'ing-hops-1', item_name: 'Cascade Hops', quantity: 0.1, unit: 'kg' },
        { ingredient_id: 'ING-003', item_id: 'ing-yeast-1', item_name: 'US-05 Yeast', quantity: 1, unit: 'pcs' }
      ]
    }
  }
};
```

**`callHandler` helper** (lines 131–145) — reuse as-is for new test cases:
```javascript
function callHandler(method, path, req) {
  return new Promise(function (resolve, reject) {
    var key = method + ':' + path;
    var handler = mockRouteHandlers[key];
    if (!handler) return reject(new Error('No handler registered for ' + key));
    var res = { /* ... */ };
    try { handler(req || {}, res); } catch (e) { reject(e); }
  });
}
```

**New test cases to add** (after existing tests, as new `describe` block):
```javascript
describe('POST /api/kiosk/recipe-sale — scaling (SCALE-01, SCALE-03, SCALE-05)', function () {
  // batch_size_l=0 → 400
  test('returns 400 when recipe has no batch_size_l', ...)
  // target_volume_l > 10x → 400
  test('returns 400 when target_volume_l exceeds 10x base', ...)
  // stock conflict → 409 with conflicts
  test('returns 409 with conflict list when scaled qty exceeds stock', ...)
  // override bypasses stock block
  test('override=true bypasses stock conflict and returns 202', ...)
  // locked 1.5x charges correct amount
  test('locked recipe at 1.5x charges locked_price * 1.5 + fees', ...)
  // dynamic 1.5x charges scaled ingredient sum + fees
  test('dynamic recipe at 1.5x charges scaled ingredient sum + fees', ...)
});

describe('POST /api/kiosk/recipe-sale/confirm — scaling (SCALE-04, SCALE-05)', function () {
  // invoice line items use scaled qty
  test('invoice line items use scaled quantities at 1.5x', ...)
  // snapshot includes target_volume_l + scale_factor
  test('recipe_snapshot passed to detectRecipeSale includes target_volume_l and scale_factor', ...)
  // confirm re-runs stock check server-side
  test('returns 409 at confirm time if stock depleted between quote and confirm', ...)
});
```

---

### `admin.html` (markup, insert)

**Analog:** Self — insert into existing `#kiosk-recipe-prompt` block.

**Insertion point** (lines 625–642 — insert between `#kiosk-recipe-summary` div and `#kiosk-avail-banner` div):
```html
<!-- Current structure (lines 628–629): -->
<div id="kiosk-recipe-summary"></div>
<!-- INSERT: target-volume input here (Phase 35) -->
<div id="kiosk-avail-banner"></div>
```

**What to insert** (from RESEARCH.md §2 pattern, styled to match existing inputs):
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
<!-- SCALE-05: Stock conflict block — Phase 35 -->
<div id="kiosk-stock-conflict" style="display:none;">
  <div class="kiosk-stock-conflict-msg"></div>
  <button type="button" class="btn-secondary" id="kiosk-stock-override-btn">
    Manager Override — Proceed Anyway
  </button>
</div>
```

**Existing checkbox pattern to copy for `mill-grain`** (lines 634–637):
```html
<div id="kiosk-milling-toggle" class="kiosk-milling-toggle" style="display:none;">
  <label>
    <input type="checkbox" id="kiosk-mill-grain" /> Mill grain?
  </label>
</div>
```

---

### `js/admin.js` (kiosk section, component/request-response)

**Analog:** Self — modify existing functions. ES5 `var` / `function` style throughout. No arrow functions, no `const`/`let`.

**New state variables to add** (after existing vars at line 9782):
```javascript
var _kioskTargetVolumeL = null;   // number: target volume in litres, or null = use base
var _kioskScaleFactor   = 1.0;    // display preview only; server recomputes authoritative value
var _kioskStockOverride = false;  // true when manager override button was clicked
```

**`kioskShowRecipePrompt` modifications** (around line 10900 — after existing setup):
```javascript
// After line 10909 (prompt shown, name set):
var volWrap     = document.getElementById('kiosk-recipe-volume-wrap');
var volInput    = document.getElementById('kiosk-target-volume');
var factorRdout = document.getElementById('kiosk-scale-factor-readout');
var conflictEl  = document.getElementById('kiosk-stock-conflict');
var baseVol     = Number(recipe.batch_size_l) || 0;

_kioskTargetVolumeL = baseVol > 0 ? baseVol : null;
_kioskScaleFactor   = 1.0;
_kioskStockOverride = false;
if (conflictEl) conflictEl.style.display = 'none';

if (volWrap) volWrap.style.display = '';
if (baseVol > 0) {
  if (volInput) { volInput.value = baseVol; volInput.max = baseVol * 10; volInput.disabled = false; }
  if (factorRdout) factorRdout.textContent = '1.0\xd7 base ' + baseVol.toFixed(1) + ' L';
} else {
  // D-11: no batch_size_l — disable scaling with prompt
  if (volInput) volInput.disabled = true;
  if (factorRdout) factorRdout.textContent = 'Scaling disabled — set base batch size in recipe editor first.';
}
```

**Volume input change handler** (wire inside `kioskShowRecipePrompt` after DOM elements are set):
```javascript
if (volInput) {
  volInput.oninput = function () {
    var val = parseFloat(volInput.value) || 0;
    _kioskTargetVolumeL = val > 0 ? val : null;
    var factor = (val > 0 && baseVol > 0) ? val / baseVol : 1;
    _kioskScaleFactor = factor;
    if (factorRdout) {
      factorRdout.textContent = factor.toFixed(2) + '\xd7 base ' + baseVol.toFixed(1) + ' L';
    }
    // Reset stock conflict state on volume change
    _kioskStockOverride = false;
    if (conflictEl) conflictEl.style.display = 'none';
  };
}
```

**`recipeSaleBody` modification** (lines 10391–10399 — add `target_volume_l` and `override`):
```javascript
// CURRENT (lines 10391–10399):
var recipeSaleBody = isRecipeSale ? {
  recipe_id: _kioskRecipeContext.recipe_id,
  sale_type: _kioskRecipeContext.sale_type,
  mill_grain: _kioskRecipeContext.mill_grain,
  customer_name: ...,
  contact_id: ...,
  reference_number: refNumber,
  idempotency_key: idempotencyKey
} : null;

// PHASE 35 ADDS (before closing brace):
//   target_volume_l: _kioskTargetVolumeL || (Number(_kioskSelectedRecipe && _kioskSelectedRecipe.batch_size_l) || null),
//   override: _kioskStockOverride || false
```

**`confirmBody` modification** (lines 10415–10423 — add same fields):
```javascript
// CURRENT (lines 10415–10423):
var confirmBody = {
  recipe_id: saleBody.recipe_id,
  sale_type: saleBody.sale_type,
  mill_grain: saleBody.mill_grain,
  customer_name: saleBody.customer_name || '',
  contact_id: saleBody.contact_id || '',
  reference: result.data.reference,
  transaction_id: result.data.transaction_id || ''
};
// PHASE 35 ADDS (before closing brace):
//   target_volume_l: saleBody.target_volume_l,
//   override: saleBody.override || false
```

**409 conflict handling** (after the existing 202 result.data.pending check, around line 10413):
```javascript
// After checking for 202 pending, add:
if (isRecipeSale && result.status === 409 && result.data && result.data.conflicts) {
  if (spinnerEl) spinnerEl.style.display = 'none';
  var conflictEl2 = document.getElementById('kiosk-stock-conflict');
  var conflictMsg = document.querySelector('#kiosk-stock-conflict .kiosk-stock-conflict-msg');
  if (conflictMsg) {
    var lines = ['Insufficient stock for scaled batch:'];
    result.data.conflicts.forEach(function (c) {
      lines.push('• ' + (c.item_name || c.item_id) + ': need ' + c.needed + ' ' + (c.unit || '') + ', have ' + c.stock);
    });
    conflictMsg.textContent = lines.join('\n');
  }
  if (conflictEl2) conflictEl2.style.display = '';
  var overrideBtn = document.getElementById('kiosk-stock-override-btn');
  if (overrideBtn) {
    overrideBtn.onclick = function () {
      _kioskStockOverride = true;
      if (conflictEl2) conflictEl2.style.display = 'none';
      // Re-trigger the sale with override=true
      kioskProcessSale();
    };
  }
  return;
}
```

**`_kioskRecipeContext` extension** (lines 11235–11243 — add `target_volume_l`):
```javascript
// CURRENT:
_kioskRecipeContext = {
  recipe_id: recipe.recipe_id,
  recipe_name: recipe.name,
  sale_type: _kioskSaleType,
  mill_grain: _kioskMillGrain,
  locked_price: recipe.locked_price,
  pricing_mode: pricingMode,
  ingredients: ingredients
};
// PHASE 35 ADDS:
//   target_volume_l: _kioskTargetVolumeL
```

**ES5 style enforcement** — all new JS in admin.js must use `var`, no arrow functions, no template literals, no `const`/`let`. Follow the existing `var result = ...` pattern throughout.

---

## Shared Patterns

### `'use strict'` + module require pattern
**Source:** `zoho-middleware/lib/pricing.js` lines 15, and `zoho-middleware/routes/pos-recipe.js` lines 1–16
**Apply to:** `recipe-scaling.js` (new file)
```javascript
'use strict';

var C = require('../lib/constants');
// (recipe-scaling.js has NO requires — pure functions)
```

### `log.error` prefix convention
**Source:** `zoho-middleware/routes/pos-recipe.js` lines 154, 165, 170
**Apply to:** Any `log.error` added to `pos-recipe.js` for new scaling/stock paths
```javascript
log.error('[pos-recipe/recipe-sale] Stock check error: ' + err.message);
log.info('[pos-recipe/recipe-sale] scale_factor=' + scaleFactor + ' target_volume_l=' + targetVolumeL);
```

### Jest mock setup for route tests
**Source:** `zoho-middleware/__tests__/pos-recipe.test.js` lines 1–80
**Apply to:** `recipe-scaling.test.js` has NO mocks (pure functions). Any new describe block added to `pos-recipe.test.js` reuses the existing `jest.mock(...)` declarations at the top and the `resetAndLoadPosRecipe()` + `callHandler()` helpers — do NOT duplicate them.

To mock the new `recipe-scaling` module in pos-recipe tests if needed:
```javascript
jest.mock('../lib/recipe-scaling', function () {
  return {
    scaleIngredients:         jest.fn(function (ings) { return ings; }),
    computeScaledRecipeTotal: jest.fn().mockReturnValue(95),
    checkScaledStock:         jest.fn().mockReturnValue({ ok: true, conflicts: [] }),
    CONTINUOUS_UNITS: ['kg', 'g', 'l', 'ml'],
    DISCRETE_UNITS:   ['pcs', 'each', 'unit', 'pkg', 'ft']
  };
});
```

### `process.env` guard pattern
**Source:** `zoho-middleware/routes/pos-recipe.js` lines 98–106
**Apply to:** Any new env var reads in `pos-recipe.js` (none expected for Phase 35)
```javascript
if (!process.env.MILLING_FEE_ITEM_ID) {
  return res.status(400).json({ error: 'Milling fee not configured. Contact admin.' });
}
```

### Cold-cache degradation pattern
**Source:** `zoho-middleware/routes/recipes.js` lines 319–333 (availability endpoint)
**Apply to:** Scaled stock check when `ingredientCatalog` is null/missing
```javascript
// If ingredients cache is cold, return unknown status (soft warn, no hard-block)
if (!catalog) {
  // current code returns 503 for recipe-sale; for stock check, return soft warning
  // (the hard-block only applies when stock data is available and confirms oversell)
  // log and continue — do not block the sale on cold cache
  log.warn('[pos-recipe/recipe-sale] Ingredient cache cold — stock check skipped');
}
```

---

## No Analog Found

All files in Phase 35 have close analogs in the existing codebase. The new `recipe-scaling.js` has no exact role match (no prior pure math helper module for recipes), but `pricing.js` is an exact structural analog.

---

## Metadata

**Analog search scope:** `zoho-middleware/lib/`, `zoho-middleware/routes/`, `zoho-middleware/__tests__/`, `js/admin.js`, `admin.html`
**Files scanned:** 9 source files read directly
**Key constraint:** All middleware JS uses `'use strict'`; all frontend JS uses ES5 (`var`, function declarations, no arrow functions)
**Pattern extraction date:** 2026-06-20
