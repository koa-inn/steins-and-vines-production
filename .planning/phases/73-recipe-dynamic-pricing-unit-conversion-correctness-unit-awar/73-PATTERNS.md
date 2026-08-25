# Phase 73: Recipe dynamic pricing unit-conversion correctness - Pattern Map

**Mapped:** 2026-08-25
**Files analyzed:** 8 (1 new helper, 5 sum-site call-sites across 3 route/lib files, 1 write-path validation site, 3 test files with mechanical fixture updates)
**Analogs found:** 8 / 8 (all files have a strong same-repo analog — this is a self-referential consolidation phase, not new-technology work)

All line numbers below were confirmed by directly reading the current source on 2026-08-25 (same day as RESEARCH.md) and match RESEARCH.md exactly, with one exception noted in the fail-closed pattern section (pos.js line numbers have drifted slightly from the 406-419 cited in CONTEXT.md/RESEARCH.md — corrected below to the current 51-62 / 531-544).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `zoho-middleware/lib/recipe-scaling.js` (NEW: `ingredientLineCost`/`classifyUnit` helper, added to existing file) | utility (pure function) | transform | `zoho-middleware/lib/recipe-scaling.js` itself — `computeScaledRecipeTotal`/`scaleIngredient` (existing pure-function conventions in the same file) | exact (self-file, extend existing pattern) |
| `zoho-middleware/routes/recipes.js` — `enrichWithComputedPrice` (~L106-141, sum @ L119) | controller (route handler helper) | CRUD (read/enrich) | itself — `enrichListPrices` (~L143-206, sum @ L197) in the same file, near-identical shape | exact (sibling function, same file) |
| `zoho-middleware/routes/recipes.js` — `enrichListPrices` (~L143-206, sum @ L197) | controller (route handler helper) | CRUD (read/enrich) | `enrichWithComputedPrice` (~L106-141) — same file, same pattern, inverse direction | exact |
| `zoho-middleware/lib/recipe-scaling.js` — `computeScaledRecipeTotal` (L127-153, sum @ L141) | utility (pure function) | transform | `computeModifiedRecipeTotal` (L232-276) in the same file — shares the exact `total += qty*rate` idiom | exact (sibling function, same file) |
| `zoho-middleware/lib/recipe-scaling.js` — `computeModifiedRecipeTotal` locked-mode ADDED sum (L232-276, sum @ L260) | utility (pure function) | transform | `computeScaledRecipeTotal` (L127-153) — same file | exact |
| `zoho-middleware/routes/pos-recipe.js` — `_runRecipeConfirm` invoice `lineItems` build (L651-667) | controller (route handler helper) | request-response + event-driven (drives real Zoho invoice/stock side-effect on submit) | `computeRecipeQuote`'s `ingredientList` build in the same file (L458-480, `line_total` @ L478) — same file, parallel per-line quantity×rate computation, but display-only vs this one's real-money/stock consequence | role-match (same file, higher stakes — must NOT be treated as display-only) |
| `zoho-middleware/routes/pos-recipe.js` — `computeRecipeQuote` `ingredientList.line_total` (L458-480, @ L478) | controller (route handler helper) | request-response (dry-run, no charge) | `_runRecipeConfirm`'s `lineItems` build (L651-667) — same file, same math, real-money counterpart | exact |
| `zoho-middleware/routes/recipes.js` — `POST /api/recipes` (L376-390) / `PUT /api/recipes/:id` (L396-427) save-time validation (D-03) | middleware (input validation, pre-flight guard) | request-response | `PUT /api/recipes/:id`'s own existing D-02 activation guardrail (L400-414, in the SAME function) | exact (extend the same function's existing guardrail block) |
| `zoho-middleware/routes/pos.js` — `resolveGstTaxId` (L51-62) + fail-closed call site (L531-544) | utility + controller guard | request-response | **THE fail-closed precedent to mirror for D-02** — not itself modified this phase | exact (pattern donor, not a target file) |
| `zoho-middleware/__tests__/recipe-scaling.test.js` — catalogMap fixtures (e.g. L266-269, L283, L297, L317) | test | transform (pure function tests) | itself — extend existing `describe('computeScaledRecipeTotal — dynamic pricing', ...)` block pattern | exact |
| `zoho-middleware/__tests__/pos-recipe.test.js` — `MOCK_INGREDIENTS_CATALOG` (L87-92) + ~17 other catalog-shaped fixtures | test | request-response (route handler tests via mocked Express) | itself — same file's existing recipe-ingredient fixtures (L110-113) which DO already carry `unit` | exact |
| `zoho-middleware/__tests__/recipes.test.js` — dynamic-mode ingredient fixtures + new `POST`/`PUT` D-03 validation tests | test | CRUD (route handler tests) | itself — existing `describe('PUT /api/recipes/:id', ...)` activation-guardrail tests (L366-386) are the exact shape for new D-03 reject tests | exact |

## Pattern Assignments

### `zoho-middleware/lib/recipe-scaling.js` — NEW `ingredientLineCost(item, line)` / `classifyUnit(raw)` helper

**Analog:** the file's own existing pure-function conventions (module doc comment, `scaleIngredient`, `computeScaledRecipeTotal`).

**Module contract to preserve** (doc comment, L1-21):
```javascript
/**
 * Pure, surface-agnostic scaling helpers for recipe batch scaling.
 *
 * This module is intentionally pure: no I/O, no requires. It is independently
 * testable and importable by any route or service that needs scaling math
 * ...
 */
'use strict';
```
The new helper MUST follow this same "pure, no I/O, no requires" contract — callers pass in the already-fetched `item` (catalog entry) and `line` (recipe ingredient), exactly like `computeScaledRecipeTotal` already receives `catalogMap` from its caller rather than fetching it itself.

**Existing unit-classification idiom to reuse the *shape* of, but NOT the *content* of** (L34-44 — `CONTINUOUS_UNITS`/`DISCRETE_UNITS`):
```javascript
var CONTINUOUS_UNITS = [
  'kg', 'g', 'mg', 'l', 'ml',
  'oz', 'lb', 'lbs', 'tsp', 'tbsp', 'cup', 'pt', 'qt', 'gal', 'floz', 'fl oz'
];
var DISCRETE_UNITS = ['pcs', 'each', 'unit', 'pkg', 'ft'];
```
**Do not reuse `DISCRETE_UNITS` directly as the new cost-helper's "count" family** (RESEARCH.md Anti-Pattern, confirmed correct on reading — `DISCRETE_UNITS` governs scale-rounding behavior, a different axis, and includes `'ft'` which is a length unit, not a count unit for cost purposes). Build a separate, smaller table/array scoped to D-02's three families: mass (`g`↔`kg`), volume (`ml`↔`L`), count (`pcs`/`ea`/`pack`/etc., pass-through).

**Case-insensitive normalization idiom to copy** (`scaleIngredient`, L67-68):
```javascript
var rawQty    = (Number(ing.quantity) || 0) * factor;
var unitLower = (ing.unit || '').toLowerCase().trim();
```
Use the identical `(x || '').toLowerCase().trim()` idiom for both `item.unit` and `line.unit` in the new `classifyUnit`.

**Existing sum-loop pattern to replace with a call to the new helper** (`computeScaledRecipeTotal`, L137-144 — the pattern EVERY sum-site currently duplicates):
```javascript
(scaledIngredients || []).forEach(function (ing) {
  var entry = catalogMap[ing.item_id];
  if (entry) {
    total += (Number(ing.quantity) || 0) * (Number(entry.rate) || 0);
  }
});
```

**Rounding convention to match** (L152, and repeated at every sum-site): `Math.round(total * 100) / 100` — 2dp for money totals. For the new helper's own per-line `cost`, RESEARCH.md's design sketch uses 4dp (`Math.round(convertedQty * rate * 10000) / 10000`) to avoid double-rounding before the final 2dp sum — this is a reasonable deviation, not a contradiction, since it's an intermediate value, not a displayed total.

**Security comment to preserve/extend** (`computeModifiedRecipeTotal` doc, L219-220 — must remain true after the fix):
```javascript
// Security (T-36-01): rate is always read from catalogMap[item_id].rate.
// Any rate/price field on the client-supplied ingredient object is ignored.
```
`ingredientLineCost(item, line)` must likewise only ever read `rate` from `item` (the server catalog entry), never from `line` (the client/recipe-supplied object).

**Exports pattern to extend** (L282-290):
```javascript
module.exports = {
  scaleIngredient:              scaleIngredient,
  scaleIngredients:             scaleIngredients,
  computeScaledRecipeTotal:     computeScaledRecipeTotal,
  computeModifiedRecipeTotal:   computeModifiedRecipeTotal,
  checkScaledStock:             checkScaledStock,
  CONTINUOUS_UNITS:             CONTINUOUS_UNITS,
  DISCRETE_UNITS:               DISCRETE_UNITS
};
```
Add `ingredientLineCost: ingredientLineCost, classifyUnit: classifyUnit` to this same object (both need to be exported — `classifyUnit` is reused by the D-03 save-time validator in `routes/recipes.js`, per RESEARCH.md).

---

### `zoho-middleware/routes/recipes.js` — sum-site 1: `enrichWithComputedPrice` (detail `computed_price`)

**Analog:** sibling function `enrichListPrices` in the same file (near-identical shape, confirming this is an established in-file pattern, not a one-off).

**Imports** (L1-10 — the shared route-file import convention to preserve, unchanged):
```javascript
'use strict';

var express = require('express');
var fs = require('fs');
var path = require('path');
var cache = require('../lib/cache');
var log = require('../lib/logger');
var C = require('../lib/constants');
var axios = require('axios');
var authTiers = require('../lib/authTiers');
```
**New import needed:** `var scaling = require('../lib/recipe-scaling');` (mirrors `pos-recipe.js` L13's `var scaling = require('../lib/recipe-scaling');`).

**Current buggy sum (L106-141, sum @ L119) — replace the `total +=` line with a call to `scaling.ingredientLineCost`:**
```javascript
function enrichWithComputedPrice(recipe, ingredients) {
  if (!recipe || recipe.pricing_mode !== 'dynamic') return Promise.resolve();
  return cache.get(C.CACHE_KEYS.INGREDIENTS_ALL).then(function (catalog) {
    if (!catalog || !Array.isArray(catalog)) return;
    var map = {};
    catalog.forEach(function (item) { if (item && item.item_id) map[item.item_id] = item; });
    var total = 0;
    (ingredients || []).forEach(function (ing) {
      var entry = map[ing.item_id];
      if (entry) {
        ing.rate = Number(entry.rate) || 0;
        ing.tax_percentage = Number(entry.tax_percentage) || 0;
        ing.tax_id = entry.sales_tax_rule_id || entry.tax_id || '';
        total += (Number(ing.quantity) || 0) * ing.rate;   // ← L119, replace with ingredientLineCost
      }
    });
    total += Number(recipe.service_fee) || 0;
    total += Number(recipe.materials_fee) || 0;
    recipe.computed_price = Math.round(total * 100) / 100;
    ...
```
**D-02 fail-closed consideration for this site:** this function currently has no error-return path — it silently resolves and lets `computed_price` stay whatever it was. Wiring `ingredientLineCost`'s discriminated result here means deciding what "fail closed" means for a *read* path (list/detail) vs a *write/charge* path (D-02's primary target). RESEARCH.md's AC-03 implies the detail view should surface the failure (e.g. `recipe.pricing_error` / a null `computed_price` with a named-line error), not silently produce a wrong number — but a 400/422 HTTP response is not appropriate for a GET that also returns non-price recipe data. Planner should decide the exact response shape for this specific read-path site.

---

### `zoho-middleware/routes/recipes.js` — sum-site 2: `enrichListPrices` (list `computed_price`)

**Analog:** `enrichWithComputedPrice` (immediately above, same file).

**Current buggy sum (L194-198, sum @ L197):**
```javascript
var total = 0;
detail.ingredients.forEach(function (ing) {
  var entry = map[ing.item_id];
  if (entry) total += (Number(ing.quantity) || 0) * (Number(entry.rate) || 0);  // ← L197
});
total += Number(recipe.service_fee) || 0;
total += Number(recipe.materials_fee) || 0;
recipe.computed_price = Math.round(total * 100) / 100;
```
Same replacement pattern and same read-path fail-closed-shape question as sum-site 1 — this runs across a whole list of recipes (`Promise.all(dynamicRecipes.map(...))`, L180), so a single un-priceable line must not throw and abort the whole list response; it should mark that one recipe's price as errored/null while the rest of the list still renders.

---

### `zoho-middleware/lib/recipe-scaling.js` — sum-site 3: `computeScaledRecipeTotal` (dynamic mode)

**Analog:** `computeModifiedRecipeTotal` in the same file (shares the identical `total += qty*rate` idiom at its own sum-site).

**Current buggy sum (L127-153, sum @ L141):**
```javascript
function computeScaledRecipeTotal(recipe, scaledIngredients, catalogMap, saleType) {
  var hasLockedPrice = Number(recipe.locked_price) > 0;
  var pricingMode    = recipe.pricing_mode || (hasLockedPrice ? 'locked' : 'dynamic');
  var factor         = (typeof recipe._scale_factor === 'number') ? recipe._scale_factor : 1;
  var total          = 0;

  if (pricingMode === 'locked' && hasLockedPrice) {
    total = Number(recipe.locked_price) * factor;
  } else {
    (scaledIngredients || []).forEach(function (ing) {
      var entry = catalogMap[ing.item_id];
      if (entry) {
        total += (Number(ing.quantity) || 0) * (Number(entry.rate) || 0);  // ← L141
      }
    });
  }
  ...
```
This is the highest-traffic sum-site — RESEARCH.md's diagram shows it feeds `grandTotal` for **quote, sale, AND confirm** paths (called from `pos-recipe.js` at L229, L710). This is the function whose D-02 fail-closed behavior has the most direct blast radius: if it throws/returns an error here, ALL THREE call sites in `pos-recipe.js` need to catch and translate it into the appropriate HTTP response (mirroring the `resolveGstTaxId` pattern below). Since this is a pure function (per the module contract), the cleanest signature change is to make `computeScaledRecipeTotal` itself return a discriminated result (or throw a typed error) that callers translate — do not have it silently produce `NaN`/`0`.

---

### `zoho-middleware/lib/recipe-scaling.js` — sum-site 4: `computeModifiedRecipeTotal` locked-mode ADDED-ingredient sub-sum

**Analog:** `computeScaledRecipeTotal` (same file, immediately above).

**Current buggy sum (L249-263, sum @ L260) — the "easy to miss" second sum-site in the same file:**
```javascript
// D-07: charge each ADDED ingredient at its scaled quantity × catalog rate
// D-08: REMOVED items are not in modifiedBaseIngredients, so they simply
//       don't appear here — the locked base total is unchanged (no credit)
(modifiedBaseIngredients || []).forEach(function (ing) {
  if (!originalIds[ing.item_id]) {
    // This item was ADDED by staff
    var catalogEntry = catalogMap[ing.item_id];
    if (catalogEntry) {
      // Scale the added ingredient the same way as base ingredients (D-04)
      var scaled = scaleIngredient(ing, factor);
      // Use ONLY the server catalog rate — never the client-supplied rate (T-36-01)
      total += (Number(scaled.quantity) || 0) * (Number(catalogEntry.rate) || 0);  // ← L260
    }
  }
});
```
Same helper call replaces this line. Note this only fires in locked-mode when staff have added ingredients not on the original recipe (MOD-02) — a smaller surface than sum-site 3, but structurally identical.

---

### `zoho-middleware/routes/pos-recipe.js` — sum-site 5 (THE CRITICAL ONE): `_runRecipeConfirm` invoice `lineItems` build

**Analog:** `computeRecipeQuote`'s `ingredientList` build in the same file (L458-480) — same per-line math, but that one is a **dry-run/display-only** counterpart; this one drives the actual Zoho invoice + real inventory deduction on submit.

**Imports** (L1-14, unchanged, already has what's needed):
```javascript
'use strict';

var express = require('express');
var axios = require('axios');
var helcimLib = require('../lib/helcim');
var zohoApi = require('../lib/zoho-api');
var cache = require('../lib/cache');
var log = require('../lib/logger');
var eventLog = require('../lib/eventLog');
var mailer = require('../lib/mailer');
var C = require('../lib/constants');
var brewpadIntegration = require('../lib/brewpad-integration');
var scaling = require('../lib/recipe-scaling');
var moneyPath = require('../lib/money-path');
```
`scaling` is already imported — no new import needed here, just a new call into it.

**Current buggy build (L650-667) — the critical fix site, confirmed unchanged from RESEARCH.md's citation:**
```javascript
// Build invoice line items — use SCALED quantities for Zoho inventory deduction (SCALE-04, INV-01)
var lineItems = [];
for (var i = 0; i < scaledIngredients.length; i++) {
  var ing = scaledIngredients[i];
  var catalogEntry = catalogMap[ing.item_id];
  var ingredientRate = catalogEntry ? (Number(catalogEntry.rate) || 0) : 0;
  var ingredientQty = Number(ing.quantity) || 0;   // ← MUST become the converted qty (ingredientLineCost().convertedQty)
  var li = {
    item_id: ing.item_id,
    name: ing.item_name,
    quantity: ingredientQty,   // ← this becomes the Zoho invoice line quantity,
    rate: ingredientRate       //   used for BOTH invoice total AND stock deduction
  };
  if (catalogEntry && catalogEntry.tax_id) {
    li.tax_id = catalogEntry.tax_id;
  }
  lineItems.push(li);
}
```
**Critical, RESEARCH.md-confirmed finding: no `unit` field is sent in the Zoho invoice payload** (`li` has only `item_id, name, quantity, rate, tax_id`). The fix MUST replace `ingredientQty` with the helper's `convertedQty` (already converted to the item's own stock unit) — Zoho will interpret whatever raw number is sent here in the item's own unit, so this is the site that actually determines the real stock draw-down, independent of the `computed_price`/`grandTotal` display fix at sum-sites 1-4.

**Loop precedes** the invoice-total recompute at L706-711 (`scaling.computeScaledRecipeTotal(...)` / `scaling.computeModifiedRecipeTotal(...)`) — once sum-sites 3/4 use the shared helper, this loop's per-line `quantity`/`rate` MUST be derived the same way (same `convertedQty`) so the invoice line total sum and the `grandTotal` never diverge (AC-03).

**Fail-closed error propagation for this site:** unlike sum-sites 1-4, this is deep inside `_runRecipeConfirm`, AFTER the terminal charge has already succeeded (per the function's own later comment, L773: `// Submit invoice (triggers inventory deduction per INV-01)`). If `ingredientLineCost` returns `{ ok: false }` here, this is a **money-already-taken** failure mode — the existing pattern for that in this exact file is the void-on-invoice-failure block (L850-895, `helcimLib.voidTransaction(txnId)`), NOT a bare `res.status(400)`. **This should ideally never trigger at this stage** if D-03 (save-time validation) and the earlier `computeRecipeQuote` fail-closed check (which runs before any charge) both work — this site is defense-in-depth, and if it fires, it should void the transaction like any other post-charge invoice failure, not just 400.

---

### `zoho-middleware/routes/pos-recipe.js` — secondary/display site: `computeRecipeQuote` `ingredientList.line_total`

**Analog:** sum-site 5 above (same file, same math, no real-money consequence).

**Current (L458-480, @ L478):**
```javascript
var ingredientList = quote.scaledIngredients.map(function (scaled) {
  var baseEntry = null;
  for (var i = 0; i < baseList.length; i++) {
    if (baseList[i].item_id === scaled.item_id) { baseEntry = baseList[i]; break; }
  }
  var baseQty = baseEntry ? (Number(baseEntry.quantity) || 0) : 0;
  var catalogEntry = catalogMap[scaled.item_id];
  var rate = catalogEntry ? (Number(catalogEntry.rate) || 0) : 0;
  var scaledQty = Number(scaled.quantity) || 0;
  return {
    item_id: scaled.item_id,
    item_name: scaled.item_name,
    unit: scaled.unit,
    base_quantity: baseQty,
    quantity: scaledQty,
    rate: rate,
    line_total: Math.round(scaledQty * rate * 100) / 100   // ← replace with ingredientLineCost().cost
  };
});
```
Not authoritative for charging, but per AC-03 must show the SAME number sum-site 5 will eventually charge — wire it too, using the same helper call.

---

### `zoho-middleware/routes/recipes.js` — D-03 save-time validation: `POST /api/recipes` / `PUT /api/recipes/:id`

**Analog: the SAME function's own existing D-02 activation guardrail** — this is the strongest possible analog since it's the identical fail-closed-422-with-message idiom already live in this exact route, just needs the same treatment applied to unit-convertibility instead of locked-price/ingredient-count.

**Existing guardrail to extend (`PUT /api/recipes/:id`, L396-427, guardrail @ L400-414):**
```javascript
router.put('/api/recipes/:id', function (req, res) {
  var payload = req.body || {};
  payload.recipe_id = req.params.id;

  // D-02 activation guardrail — enforce server-side (Pitfall 7, T-13-04)
  if (payload.status === 'active') {
    var ingCount = parseInt(payload.ingredient_count, 10) || 0;
    var lockedPrice = parseFloat(payload.locked_price) || 0;
    if (lockedPrice <= 0) {
      return res.status(422).json({
        error: 'Cannot activate recipe: a valid locked price must be set'
      });
    }
    if (ingCount < 1) {
      return res.status(422).json({
        error: 'Cannot activate recipe: at least one ingredient must exist'
      });
    }
  }

  callAppsScriptPost('update_recipe', payload).then(function (data) {
    ...
```
**D-03 implementation shape (mirroring this exact idiom):** BEFORE the `callAppsScriptPost('update_recipe', ...)` / `callAppsScriptPost('create_recipe', ...)` call, read `cache.get(C.CACHE_KEYS.INGREDIENTS_ALL)`, build the `map` (same idiom as `enrichWithComputedPrice`/`enrichListPrices`, L110-111/L165-166), run each incoming `payload.ingredients` line through `scaling.classifyUnit`/`scaling.ingredientLineCost`, and `return res.status(422).json({ error: 'Cannot save recipe: "<item>" unit "<X>" is not convertible to catalog unit "<Y>"' })` on the first non-convertible line — naming the item, per D-02/D-03's shared "name the offending line" requirement.

**Note:** `POST /api/recipes` (L376-390) currently has NO guardrail block at all (unlike `PUT`) — this is a synchronous, un-mocked-async-friendly location to add the same check, but since `POST`'s payload shape for ingredients was not fully confirmed in this session (only `PUT`'s activation payload shape was directly observed in the test fixtures), the planner/executor should confirm the create-payload's ingredient array shape against `apps-script/adminApi.gs`'s `createRecipe` handler before wiring.

**Async consideration:** the existing D-02 guardrail is fully synchronous (`parseInt`/`parseFloat` on the payload, no I/O). The new D-03 check requires an async `cache.get(...)` call, so it cannot be a simple synchronous `if` block like D-02 — it must be a `.then()` chain inserted before `callAppsScriptPost(...)`, following the same async style already used elsewhere in this file (e.g. `enrichWithComputedPrice`'s `cache.get(...).then(...)`).

---

### Fail-closed error-shape precedent (Phase 67) — mirror for D-02/D-03

**Source:** `zoho-middleware/routes/pos.js:51-62` (`resolveGstTaxId`, the resolver) + `zoho-middleware/routes/pos.js:531-544` (the call site that fails closed).

**Note on line numbers:** CONTEXT.md/RESEARCH.md cited `pos.js:406-419`; as of this session (2026-08-25) the actual function lives at **L51-62** and its fail-closed call site at **L531-544** (file has grown since RESEARCH.md was written, or the citation was to a different revision). Content and pattern shape are unchanged and fully confirmed — only the line numbers moved.

**The resolver (a "resolve-or-null" pure-ish helper, given a lookup map):**
```javascript
// Resolve the 5% GST tax_id needed for taxable custom lines (D-02).
// Resolution order: (1) process.env.KIOSK_GST_TAX_ID; (2) auto-discover from
// KIOSK_PRODUCTS_CACHE_KEY catalog — find an item whose sales_tax_rule_id ===
// ZOHO_TAX_SERVICES_RULE and reuse its tax_id; (3) return null (caller fail-closes).
function resolveGstTaxId(catalogMap) {
  if (process.env.KIOSK_GST_TAX_ID) return process.env.KIOSK_GST_TAX_ID;
  var serviceRule = process.env.ZOHO_TAX_SERVICES_RULE || '109900000000033417';
  var ids = Object.keys(catalogMap || {});
  for (var i = 0; i < ids.length; i++) {
    var item = catalogMap[ids[i]];
    if (item && item.sales_tax_rule_id === serviceRule && item.tax_id) {
      return item.tax_id;
    }
  }
  return null;
}
```

**The fail-closed call site (checked BEFORE any charge/invoice action, exact shape D-02 should replicate):**
```javascript
// Pre-resolve GST tax_id for any taxable custom lines (D-02 fail-closed).
// Must happen before the lineItems builder to avoid returning inside .map().
var needGstTaxId = body.items.some(function (item) {
  return item.custom && item.taxable !== false;
});
var gstTaxId = null;
if (needGstTaxId) {
  gstTaxId = resolveGstTaxId(catalogMap);
  if (!gstTaxId) {
    return res.status(400).json({
      error: 'Cannot tax this custom line: no GST tax rate configured. Mark the line tax-exempt or set KIOSK_GST_TAX_ID.'
    });
  }
}
```
**The exact shape to replicate for `ingredientLineCost`'s fail-closed case:**
1. Resolve/attempt BEFORE building the line-items array / making any charge/invoice call (the comment explicitly calls out "avoid returning inside `.map()`" — do the check in a separate pass first, matching sum-site 5's `for` loop structure).
2. On failure: `res.status(400)` (or `422`, matching the D-02 recipe-activation precedent in `recipes.js`) with an `error` string that **names the specific offending thing** — here, `"Cannot tax this custom line: ..."`; for D-02 it should be `"Cannot price '<item name>': recipe unit '<X>' is not convertible to item unit '<Y>'"`.
3. Never silently substitute a default/zero value — the `if (!gstTaxId) return ...` guard is the fail-closed gate itself.

---

### Test analogs

**Harness skeleton — identical across `recipes.test.js` / `pos-recipe.test.js` / `recipe-scaling.test.js`:**

`zoho-middleware/__tests__/recipes.test.js:1-72` (route-handler test harness):
```javascript
'use strict';
var mockRouteHandlers = {};
jest.mock('express', function () {
  var router = {
    get:    jest.fn(function (path, handler) { mockRouteHandlers['GET:' + path] = handler; }),
    post:   jest.fn(function (path, handler) { mockRouteHandlers['POST:' + path] = handler; }),
    put:    jest.fn(function (path, handler) { mockRouteHandlers['PUT:' + path] = handler; }),
    delete: jest.fn(function (path, handler) { mockRouteHandlers['DELETE:' + path] = handler; })
  };
  var express = function () {};
  express.Router = function () { return router; };
  return express;
});
jest.mock('axios', function () { return { get: jest.fn(), post: jest.fn() }; });
jest.mock('../lib/cache', function () { return { get: jest.fn(), set: jest.fn(), del: jest.fn() }; });
jest.mock('../lib/constants', function () {
  return { CACHE_KEYS: { RECIPES: 'sv:recipes', RECIPES_TS: 'sv:recipes:ts',
    INGREDIENTS: 'zoho:ingredients', INGREDIENTS_ALL: 'zoho:ingredients:all',
    RECIPE_AVAILABILITY: 'sv:recipe-availability' } };
});
function resetAndLoadRecipes() {
  mockRouteHandlers = {};
  jest.resetModules();
  require('../routes/recipes');
  return { axios: require('axios'), cache: require('../lib/cache') };
}
function callHandler(method, path, req) {
  return new Promise(function (resolve, reject) {
    var key = method + ':' + path;
    var handler = mockRouteHandlers[key];
    if (!handler) return reject(new Error('No handler registered for ' + key));
    var res = { _status: 200, _body: null,
      status: jest.fn(function (s) { res._status = s; return res; }),
      json:   jest.fn(function (b) { res._body = b; resolve(res); return res; }) };
    try { handler(req || {}, res); } catch (e) { reject(e); }
  });
}
```
`pos-recipe.test.js` uses the identical skeleton (confirmed L1-82) with extra mocks for `helcim`/`zoho-api`/`eventLog`/`mailer`/`brewpad-integration`.
`recipe-scaling.test.js` needs NO Express/route mocking — it imports the pure functions directly (confirmed structurally by RESEARCH.md and by the `describe('computeScaledRecipeTotal — dynamic pricing', ...)` block read in this session) — **this is the cheapest place to add the new `ingredientLineCost`/`classifyUnit` unit-cost regression cases** (per-kg $54×12g→$0.65 etc.), matching e.g.:
```javascript
// zoho-middleware/__tests__/recipe-scaling.test.js:260-277 — exact shape to copy for new tests
describe('computeScaledRecipeTotal — dynamic pricing', function () {
  test('dynamic in-store: sum of scaled qty × rate + fees', function () {
    var scaledIngs = [
      { item_id: 'a1', quantity: 7.5, unit: 'kg' },
      { item_id: 'b1', quantity: 2,   unit: 'pcs' }
    ];
    var catalogMap = {
      a1: { rate: 2.00 },  // 7.5 × 2.00 = 15.00
      b1: { rate: 5.00 }   // 2   × 5.00 = 10.00
    };
    expect(computeScaledRecipeTotal(
      { pricing_mode: 'dynamic', service_fee: 10, materials_fee: 5 },
      scaledIngs, catalogMap, 'in-store'
    )).toBe(40.00);
  });
  ...
```

**Confirmed fixture gap (Pitfall 2 — mechanically verified in this session, not just asserted by RESEARCH.md):**

`recipe-scaling.test.js` catalogMap literals at L266-269 (`{ a1: { rate: 2.00 }, b1: { rate: 5.00 } }`), L283 (`{ a1: { rate: 3.00 } }`), L297 (`{ a1: { rate: 2.00 } }`), L317 (`{ a1: { rate: 14.999 } }`) — **none carry a `unit` key**, while the paired `scaledIngs`/ingredient-line fixtures right above them DO (`{ item_id: 'a1', quantity: 7.5, unit: 'kg' }`). Once `computeScaledRecipeTotal` calls `ingredientLineCost` internally, every one of these ~7+ catalogMap literals (grep found the pattern repeating through at least L432/L453 for `computeModifiedRecipeTotal` tests too) needs a matching `unit: 'kg'`/`'pcs'` etc. added, or the test will start failing closed for the wrong reason (missing unit, not a real bug being tested).

`pos-recipe.test.js`'s `MOCK_INGREDIENTS_CATALOG` (L87-92) confirmed with NO `unit` field on any of its 4 entries:
```javascript
var MOCK_INGREDIENTS_CATALOG = [
  { item_id: 'ing-malt-1', name: 'Pale Malt 2-Row', rate: 3.50, tax_id: 'tax-gst', stock_on_hand: 50 },
  { item_id: 'ing-hops-1', name: 'Cascade Hops', rate: 8.00, tax_id: 'tax-gst', stock_on_hand: 2 },
  { item_id: 'ing-yeast-1', name: 'US-05 Yeast', rate: 5.00, tax_id: 'tax-gst', stock_on_hand: 10 },
  { item_id: 'ing-dry-hop-1', name: 'Centennial Hops (Dry Hop)', rate: 10.00, tax_id: 'tax-gst', stock_on_hand: 5 }
];
```
...while its paired recipe-ingredient fixtures (L110-113) already have `unit: 'kg'`/`'pcs'`:
```javascript
{ ingredient_id: 'ING-001', recipe_id: 'RCP-001', item_id: 'ing-malt-1', item_name: 'Pale Malt 2-Row', quantity: 5.5, unit: 'kg' },
{ ingredient_id: 'ING-002', recipe_id: 'RCP-001', item_id: 'ing-hops-1', item_name: 'Cascade Hops', quantity: 0.1, unit: 'kg' },
{ ingredient_id: 'ING-003', recipe_id: 'RCP-001', item_id: 'ing-yeast-1', item_name: 'US-05 Yeast', quantity: 1, unit: 'pcs' }
```
Adding `unit: 'kg'`/`unit: 'pcs'` (matching each item's recipe-line unit — currently all same-family, no conversion actually exercised by existing tests) to each `MOCK_INGREDIENTS_CATALOG` entry is required just to keep the existing ~18 tests passing once the helper is wired in.

**D-03 write-path validation test analog — exact shape to copy** (`recipes.test.js` L366-386, the existing D-02 activation-guardrail tests):
```javascript
test('rejects activation without locked_price', function () {
  return callHandler('PUT', '/api/recipes/:id', {
    params: { id: 'SV-R-000001' },
    body: { status: 'active', locked_price: 0, ingredient_count: 3 }
  }).then(function (res) {
    expect(res._status).toBe(422);
    expect(res._body.error).toContain('Cannot activate recipe');
    expect(mocks.axios.post).not.toHaveBeenCalled();
  });
});

test('rejects activation without ingredients', function () {
  return callHandler('PUT', '/api/recipes/:id', {
    params: { id: 'SV-R-000001' },
    body: { status: 'active', locked_price: 50, ingredient_count: 0 }
  }).then(function (res) {
    expect(res._status).toBe(422);
    expect(res._body.error).toContain('Cannot activate recipe');
    expect(mocks.axios.post).not.toHaveBeenCalled();
  });
});
```
New D-03 tests should follow this EXACT shape: `expect(res._status).toBe(422)`, `expect(res._body.error).toContain(...)`, and critically `expect(mocks.axios.post).not.toHaveBeenCalled()` — proving the guardrail fires BEFORE `callAppsScriptPost` runs (i.e., a rejected save never reaches Apps Script). Since D-03 needs `cache.get(INGREDIENTS_ALL)`, the `beforeEach` will additionally need `mocks.cache.get.mockResolvedValue(<fixture catalog with units>)` (the existing `beforeEach` at L308-315 currently sets `mocks.cache.get.mockResolvedValue(null)` for POST and similarly for PUT — new D-03 tests need a non-null catalog fixture with `unit` fields to exercise both the pass and reject branches).

## Shared Patterns

### Fail-closed, name-the-item validation (D-02, D-03)
**Source:** `zoho-middleware/routes/pos.js:51-62` + `:531-544` (`resolveGstTaxId`)
**Apply to:** `lib/recipe-scaling.js` `ingredientLineCost` (the resolver itself), all 5 sum-sites (the call/check), and `routes/recipes.js` POST/PUT (D-03 write-time check).
**Shape:** resolve → `null`/`{ ok: false, error }` on failure, checked BEFORE any charge/invoice/save action, HTTP response names the specific item + units, never a silent zero/default substitution.

### Pure-function, no-I/O helper convention
**Source:** `zoho-middleware/lib/recipe-scaling.js` module doc comment (L1-21) and existing exports.
**Apply to:** the new `ingredientLineCost`/`classifyUnit` helper — callers (route files) do the `cache.get(INGREDIENTS_ALL)` fetch and pass in `item`/`line` objects; the helper itself never touches `cache`/`axios`.

### `item_id`-keyed catalog map build idiom
**Source:** repeated verbatim across `recipes.js` (`enrichWithComputedPrice` L110-111, `enrichListPrices` L165-166) and `pos-recipe.js` (`computeRecipeQuote` L212-215, `_runRecipeConfirm` L628-631):
```javascript
var map = {};
catalog.forEach(function (item) { if (item && item.item_id) map[item.item_id] = item; });
```
**Apply to:** the new D-03 validation block in `routes/recipes.js` — reuse this exact idiom when building the lookup map from `INGREDIENTS_ALL` before running each ingredient line through `classifyUnit`/`ingredientLineCost`.

### 2dp money rounding
**Source:** `Math.round(total * 100) / 100`, repeated identically in `recipe-scaling.js` L152/L265/L152(dup ref), `recipes.js` L124/L201, `pos-recipe.js` L242/L478/L718.
**Apply to:** any new aggregate total the helper feeds into; the helper's own per-line `cost` may use a finer intermediate rounding (4dp, per RESEARCH.md's design sketch) to avoid compounding rounding error before the final 2dp sum.

## No Analog Found

None. This phase is a pure internal-consolidation bug fix within an already-mature module (`recipe-scaling.js`) and its established route-file conventions — every target file has a same-file or same-repo sibling analog, confirmed by direct source reads.

## Metadata

**Analog search scope:** `zoho-middleware/lib/`, `zoho-middleware/routes/`, `zoho-middleware/__tests__/` (files named in CONTEXT.md/RESEARCH.md); `apps-script/adminApi.gs` referenced but not modified (D-03 lands in middleware per RESEARCH.md's architectural finding — GAS has no catalog access).
**Files scanned (read directly this session):** `zoho-middleware/lib/recipe-scaling.js` (full, 291 lines), `zoho-middleware/routes/recipes.js` (full, 464 lines), `zoho-middleware/routes/pos-recipe.js` (full, 918 lines), `zoho-middleware/routes/pos.js` (targeted: L40-70, L525-555), `zoho-middleware/__tests__/recipe-scaling.test.js` (targeted: L255-335), `zoho-middleware/__tests__/pos-recipe.test.js` (targeted: L1-100 + grep), `zoho-middleware/__tests__/recipes.test.js` (targeted: L1-78, L306-395 + grep).
**Line-number drift note:** all RESEARCH.md-cited line numbers in `recipe-scaling.js`, `recipes.js`, and `pos-recipe.js` were confirmed EXACT on re-read. Only `pos.js`'s `resolveGstTaxId` citation had drifted (406-419 cited → actually 51-62 definition / 531-544 call site as of this read) — corrected above.
**Pattern extraction date:** 2026-08-25
