---
phase: 73-recipe-dynamic-pricing-unit-conversion-correctness-unit-awar
reviewed: 2026-08-25T00:00:00Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - zoho-middleware/lib/recipe-scaling.js
  - zoho-middleware/routes/recipes.js
  - zoho-middleware/routes/pos-recipe.js
  - js/brewpad.js
  - zoho-middleware/__tests__/recipe-scaling.test.js
  - zoho-middleware/__tests__/recipes.test.js
  - zoho-middleware/__tests__/pos-recipe.test.js
  - tests/frontend/brewpad-recipe-save-resilience.test.js
findings:
  critical: 2
  warning: 4
  info: 2
  total: 8
status: issues_found
---

# Phase 73: Code Review Report

**Reviewed:** 2026-08-25
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found

## Summary

This phase adds a shared unit-aware pricing helper (`ingredientLineCost`/`classifyUnit`) to
`recipe-scaling.js` and wires it into every read-path pricing sum-site (`recipes.js`), the
critical POS quote/confirm sum-sites (`pos-recipe.js`), save-time validation, and BrewPad's
save-resilience UX. The new helper itself is well-designed: pure, fail-closed, unit-tested with
a real production-incident regression case (`SV-R-000004` / "Magnum Bulk"), and correctly
converts mass (g↔kg) and volume (ml↔L) before multiplying by rate. `computeScaledRecipeTotal`,
`computeModifiedRecipeTotal`, `enrichWithComputedPrice`, `enrichListPrices`,
`validateIngredientUnits`, and the `pos-recipe.js` pre-charge/post-charge tiers all correctly
route through the new helper instead of hand-rolling `qty * rate`. All 182 middleware tests and
12 frontend tests for the changed files pass.

However, the stated goal of this phase — "quote = displayed `computed_price` = actual sale
invoice = **stock draw-down** can never diverge" (73-CONTEXT.md) — is not fully met:
`checkScaledStock` (both the quote-time and confirm-time stock gate in `pos-recipe.js`) still
compares a scaled ingredient's raw quantity directly against `catalogMap[item].stock_on_hand`
with **no unit conversion**, even though this phase establishes that a recipe line's unit and
its catalog item's stocking unit can legitimately differ. This is the exact same bug class
(unconverted `qty` vs a differently-scaled reference number) that the phase was created to fix,
left un-fixed in the inventory-integrity check that runs on the same request path as the newly
hardened pricing logic. A second, related gap exists in `js/brewpad.js`'s recipe editor: the
ingredient Cost/Retail columns and Totals footer that staff use to decide a recipe's
`locked_price` are still computed with unconverted `qty * rate`, client-side, bypassing the
server's new unit-aware helper entirely.

## Critical Issues

### CR-01: `checkScaledStock` compares unconverted quantities against catalog stock — stock gate can both falsely block sales and falsely allow overselling

**File:** `zoho-middleware/lib/recipe-scaling.js:181-206` (called from `zoho-middleware/routes/pos-recipe.js:240` and `zoho-middleware/routes/pos-recipe.js:665`)

**Issue:** `checkScaledStock` computes `needed = Number(ing.quantity) || 0` — the scaled
ingredient quantity in the **recipe line's own unit** — and compares it directly against
`entry.stock_on_hand`, which `routes/catalog.js` populates straight from Zoho's
`item.stock_on_hand` in the **item's own unit** (`entry.unit`). This phase's entire premise
(and its regression test, "Magnum Bulk", g-vs-kg) is that a recipe ingredient line's unit and
its catalog item's stocking unit can differ. `ingredientLineCost` was built specifically to
convert between them before any arithmetic — but `checkScaledStock` was never updated to use it,
so the stock check still performs the un-converted `qty` vs `stock_on_hand` comparison that the
pricing sum-sites were just fixed to stop doing.

Concretely: if a catalog item is stocked in `g` (e.g. `stock_on_hand: 400`) and a recipe line
specifies `0.5 kg` (scaled `needed: 0.5`), `0.5 > 400` is `false` — **no conflict is reported**
even though 500 g is needed against only 400 g on hand. This allows a sale to proceed ("stock
OK") that will actually oversell physical inventory. In the opposite unit-magnitude direction
(recipe line in a smaller unit than the catalog's), the same missing conversion produces false
conflicts that block valid, in-stock sales.

This function runs on **both** money-adjacent paths reviewed in this phase:
`computeRecipeQuote` (shared by `GET /api/kiosk/recipe-quote` and `POST /api/kiosk/recipe-sale`)
and `_runRecipeConfirm` (`POST /api/kiosk/recipe-sale/confirm`, the belt-and-suspenders re-check
that runs *after* the card has already been charged). No test in
`zoho-middleware/__tests__/recipe-scaling.test.js` exercises a recipe-unit-vs-catalog-unit
mismatch for `checkScaledStock` (all fixtures use matching units), which is why this gap is
untested and unnoticed.

**Fix:**
```javascript
// In checkScaledStock (recipe-scaling.js), convert `needed` into the catalog
// item's unit before comparing to stock_on_hand — reuse ingredientLineCost's
// convertedQty (or classifyUnit directly) instead of raw ing.quantity:
(scaledIngredients || []).forEach(function (ing) {
  var entry = catalogMap[ing.item_id];
  if (!entry) return;

  var stock = Number(entry.stock_on_hand) || 0;
  var lineCost = ingredientLineCost(entry, ing);
  // Fail closed the same way the pricing sum-sites do, or skip the stock
  // check for that line and let the pre-charge D-02 pass catch it —
  // executor's judgment, but do NOT compare raw ing.quantity to stock.
  var needed = lineCost.ok ? lineCost.convertedQty : (Number(ing.quantity) || 0);

  if (needed > stock) {
    conflicts.push({ item_id: ing.item_id, item_name: ing.item_name, needed: needed, stock: stock, unit: entry.unit });
  }
});
```
Add a regression test with mismatched-but-convertible units (e.g. recipe line `500 g`, catalog
`stock_on_hand: 0.4` at `unit: 'kg'`) asserting a conflict IS reported, and the inverse case
asserting a valid sale is NOT blocked.

### CR-02: BrewPad recipe editor ingredient totals bypass the new unit-aware helper — same unconverted `qty * rate` bug the phase exists to fix, feeding the number staff use to set `locked_price`

**File:** `js/brewpad.js:2387-2390`, `js/brewpad.js:2456-2459`, `js/brewpad.js:2548-2551`

**Issue:** The recipe editor's per-row Cost/Retail columns (`renderIngredientRows`) and the
Totals footer (recomputed on quantity change and on ingredient selection) all compute
`qty * rate` / `qty * purchase_rate` directly, with no unit conversion:

```javascript
var qty = parseFloat(ing.quantity) || 0;
var costEach = parseFloat(ing.purchase_rate) || 0;
var retailEach = parseFloat(ing.rate) || 0;
var lineCost = qty * costEach;      // line 2387
var lineRetail = qty * retailEach;  // line 2388
```

`ing.rate`/`ing.purchase_rate` are populated from the catalog item (priced per the catalog
item's unit — `enrichIngredientsWithCatalogRates`, line 233-247), while `ing.quantity` is
entered in the recipe line's own unit. `enrichIngredientsWithCatalogRates` only backfills
`ing.unit` when the line's unit is **blank** (`if (!ing.unit && match.unit) ing.unit = match.unit;`,
line 243) — it never reconciles an existing, differing unit. This is precisely the scenario
this phase's own test fixtures document as a real production incident (`SV-R-000004`, a per-kg
item costed against a gram-quantity recipe line, "Magnum Bulk").

The consequence: when editing an existing recipe whose ingredient line unit differs from its
catalog item's unit, the editor's displayed Cost/Retail per-line values and the Totals footer
can be off by 3+ orders of magnitude (e.g. g vs kg). This total is the number staff look at
when deciding what `locked_price` to set for the recipe — i.e. it can directly cause the exact
kind of mispriced `locked_price` this phase was commissioned to eliminate, even though the
server-side `computed_price` (used elsewhere, e.g. the recipe list via `recipeRowPrice`) is
correctly unit-aware after this phase's changes.

**Fix:** Port a JS mirror of `ingredientLineCost`/`classifyUnit` (there is already a client-side
`bpScaleIngredient` mirroring `scaleIngredient` for exactly this reason — module-scope, testable)
and route all three totals sites through it instead of raw `qty * rate`:
```javascript
// module scope, mirrors zoho-middleware/lib/recipe-scaling.js ingredientLineCost
function bpIngredientLineCost(item, line) { /* same conversion table + fail-closed shape */ }
```
Then in `renderIngredientRows`/`attachIngredientRowListeners`/`selectIngredientFromAutocompleteBp`,
compute `lineCost`/`lineRetail` via `bpIngredientLineCost(ing, ing)` (rate/purchase_rate/unit are
already merged onto the ingredient object) instead of `qty * costEach`/`qty * retailEach`, and
render a visible indicator (not just silently wrong totals) when a line is non-convertible —
consistent with the D-02 fail-closed pattern already applied server-side.

## Warnings

### WR-01: `checkScaledStock`-style unconverted comparison also present in `GET /api/recipes/:id/availability`

**File:** `zoho-middleware/routes/recipes.js:383-385`

**Issue:** `var needed = ing.quantity || 0; var batches = needed > 0 ? Math.floor(stock / needed) : 999;`
compares the recipe line's raw quantity against `stockMap[item_id]` (catalog `stock_on_hand`,
in the catalog item's unit) with no unit conversion — the same class of bug as CR-01, on the
per-ingredient availability endpoint the BrewPad recipe detail view uses to render its stock
status dots. This route wasn't touched by this phase's diff, but it's the same "un-converted
cost/stock-sum site" the phase context asked reviewers to check for. Lower severity than CR-01
because this endpoint only drives an informational status badge (`ok`/`low`/`out`), not an
actual sale-blocking gate or a charge.

**Fix:** Route `needed` through `scaling.ingredientLineCost`/`classifyUnit` (or a
convertedQty-only variant) the same way `checkScaledStock` should be fixed in CR-01.

### WR-02: `MASS_FACTORS`/`VOLUME_FACTORS` omit `mg`, inconsistent with `CONTINUOUS_UNITS` already treating it as a valid metric scaling unit

**File:** `zoho-middleware/lib/recipe-scaling.js:36-39` vs `zoho-middleware/lib/recipe-scaling.js:319-321`

**Issue:** `CONTINUOUS_UNITS` (pre-existing, governs `scaleIngredient`'s linear-vs-ceil rounding)
already lists `'mg'` as a first-class continuous unit. The new `MASS_FACTORS` cost-conversion
table added by this phase (`{ kg: 1, g: 0.001 }`) does not include `mg`, even though `mg` is a
plain metric unit (not one of the imperial units D-06 explicitly audited-and-excluded). An
ingredient line using `mg` (plausible for a fining/nutrient additive dosed in milligrams) will
scale correctly via `scaleIngredient` but then fail closed on every pricing/validation call via
`ingredientLineCost`/`classifyUnit` (`family: null`), blocking dynamic pricing and save-time
validation for that recipe — not because it's genuinely non-convertible, but because the
conversion table has a gap the audit didn't specifically consider (the audit's stated scope was
imperial units, not metric sub-units already recognized elsewhere in the same file).

**Fix:** Add `mg: 0.000001` to `MASS_FACTORS` (and consider `mcg`/`µg` only if actually present
in the catalog), or explicitly document in the D-06 decision record that `mg` is intentionally
out of scope and confirm via the same live-recipe audit method used for imperial units.

### WR-03: `.finally()` used once in `js/brewpad.js`, not used anywhere else in the frontend codebase

**File:** `js/brewpad.js:2817`

**Issue:** `submitRecipeSave`'s promise chain ends with `.finally(function () {...})` to
re-enable the Save button. `Promise.prototype.finally` is not used anywhere else in
`js/brewpad.js`, `js/modules/`, or `js/lib/` (confirmed via repo-wide grep) — every other
promise chain in this codebase re-enables UI state in both the success `.then()` and the
`.catch()` branches instead. Given CLAUDE.md's stated "vanilla JS (ES5)" target and this being
the only ES2018+ Promise method in the file, this is a minor consistency/compat outlier worth
flagging even though `.finally()` is unlikely to be a practical problem on the kiosk iPad's
Safari version.

**Fix:** Either accept `.finally()` as the new house style going forward (and note it), or
replace with duplicate `saveBtn` reset calls in both the success and `.catch()` branches to
match the rest of the file's convention.

### WR-04: `bpScaleIngredient`'s unknown-unit classification silently diverges from server `scaleIngredient`, despite a comment claiming exact parity

**File:** `js/brewpad.js:717-742` vs `zoho-middleware/lib/recipe-scaling.js:55-86`

**Issue:** The doc comment above `bpScaleIngredient` states "Unit classification mirrors
zoho-middleware/lib/recipe-scaling.js EXACTLY," but the two diverge on unrecognised, non-blank
unit tokens:
- Server `scaleIngredient` (recipe-scaling.js:74-80): unknown non-blank unit → **linear**
  (continuous) scaling — explicitly revised 2026-06-27 specifically so unmapped/imperial units
  never lose decimals via unwanted ceiling.
- Client `bpScaleIngredient` (brewpad.js:739-742): unknown non-blank unit → **discrete**
  (`Math.max(1, Math.ceil(rawQty))`) — the opposite default, still using the pre-2026-06-27
  server behavior.

For any ingredient with a unit token not in either list (e.g. an imperial unit, or a future new
unit token), BrewPad's client-side scaled-quantity preview will show a ceiled integer while the
server (which is authoritative for pricing/stock/invoice quantity) computes and uses the true
linear value — a display/expectation mismatch for staff, and stale/misleading documentation.
Not introduced by this phase's diff (pre-existing from Phase 36), but directly adjacent to this
phase's "unit-aware" theme and worth fixing alongside it.

**Fix:** Align `bpScaleIngredient`'s unknown-unit branch with the server's 2026-06-27 revision
(unknown non-blank → continuous/linear), and update the doc comment, or explicitly document why
the two intentionally differ if there's a UX reason to keep client-side conservative rounding.

## Info

### IN-01: `validateIngredientUnits` save-time pre-flight is best-effort, not truly fail-closed, when the ingredient cache is cold

**File:** `zoho-middleware/routes/recipes.js:435-480`

**Issue:** When both the Redis `INGREDIENTS_ALL` cache and the on-disk fallback file are
unavailable, `validateIngredientUnits` resolves `null` (no rejection) — i.e. a save with a
genuinely non-convertible unit can go through unvalidated during that infrastructure outage.
This mirrors the documented "degrade gracefully" idiom used elsewhere in the same file
(`enrichWithComputedPrice`/`enrichListPrices`) and downstream pricing calls (`ingredientLineCost`
via `computeScaledRecipeTotal`) will still fail closed the next time the recipe is priced/sold —
so this is not a silent, permanent hole, just a documented gap in the D-03 "closes the loop
end-to-end" claim during a cache-cold window. Flagging for awareness, not requesting a change.

### IN-02: `GET /api/kiosk/recipe-quote`'s `ingredientList` map calls `ingredientLineCost(...).cost` without checking `.ok`, relying on an un-enforced invariant

**File:** `zoho-middleware/routes/pos-recipe.js:493`

**Issue:** The comment states "the pre-charge validation pass above already guaranteed every
catalog-matched line converts cleanly, so this call cannot ok:false here" — true today because
`computeRecipeQuote`'s new pre-charge loop (pos-recipe.js:229-237) iterates the exact same
`scaledIngredients` array with the same `catalogMap`. This is correct as written, but it's an
implicit cross-function invariant enforced only by both call sites staying in sync, with no
local defensive check. A future edit to either the pre-charge loop's iteration source or this
map's inputs (e.g. if `ingredientList` is ever built from a different/filtered array) would
silently reintroduce an unguarded `.cost` read on a `{ok:false}` result (`.cost` is `undefined`
in that shape, so `line_total` would render as `NaN`/`undefined` rather than throwing).

**Fix:** No functional change required now; consider a defensive `lineTotal = catalogEntry && result.ok ? result.cost : 0` for robustness against future refactors, since the cost of the extra check is negligible.

---

_Reviewed: 2026-08-25_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
