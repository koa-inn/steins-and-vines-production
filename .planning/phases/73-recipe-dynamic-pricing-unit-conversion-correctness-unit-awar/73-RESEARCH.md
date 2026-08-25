# Phase 73: Recipe dynamic pricing unit-conversion correctness - Research

**Researched:** 2026-08-25
**Domain:** Internal Node.js/Express middleware (BrewPad recipe pricing) + Google Apps Script (Sheet-backed recipe storage)
**Confidence:** HIGH — every sum-site, cache key, and test fixture pattern below was located by reading the actual source, not inferred.

## Summary

The bug is real and structurally confirmed: **three independent, hand-rolled implementations** of `Σ(rate × quantity)` exist in the codebase, plus a **fourth site that builds the actual Zoho invoice line items and therefore drives the real inventory deduction**. None of the four convert `recipe_line.unit` to `item.unit` before multiplying. All four read `item.rate`/`item.unit` from the same Redis-cached catalog (`C.CACHE_KEYS.INGREDIENTS_ALL` = `'zoho:ingredients:all'`), so a single shared helper reading from that same shape can plug into all four without new data plumbing.

The most important finding beyond the handoff's own diagnosis: **the sale-confirm invoice-line build (`pos-recipe.js` `_runRecipeConfirm`, ~L651-667) is NOT the same code path as the pricing helper (`lib/recipe-scaling.js`)** — it independently re-reads `catalogEntry.rate` and uses the already-scaled-but-unit-unconverted `ing.quantity` as the Zoho invoice line's `quantity`. Because no per-line `unit` override is sent to Zoho, **this is also the code that determines the real stock deduction amount** when the invoice is submitted (comment at L773: "Submit invoice (triggers inventory deduction per INV-01)"). Fixing only `lib/recipe-scaling.js`'s cost math would fix `computed_price` and the customer-facing `grandTotal` but would **NOT** fix the actual Zoho stock draw-down — that requires converting quantity at this fifth site too, independently.

A second high-value finding: **apps-script (`createRecipe`/`updateRecipe` in `adminApi.gs`) has no access to the Zoho item catalog at all** — there is no Ingredients/Items sheet in Apps Script; unit/rate data lives only in the middleware's Redis cache. D-03's "apps-script save-time validation" therefore cannot be implemented as pure GAS logic without duplicating the catalog into the Sheet. The practical, single, already-tested entry point for ALL recipe writes is `zoho-middleware/routes/recipes.js`'s `POST /api/recipes` / `PUT /api/recipes/:id` (confirmed: BrewPad's frontend (`js/brewpad.js`) calls `mwUrl() + '/api/recipes'` exclusively, never Apps Script directly) — which already has `INGREDIENTS_ALL` catalog access and Jest coverage. GAS itself has zero test infrastructure (no clasp, no test framework), reinforcing that validation logic belongs in the already-testable middleware layer, not the untestable `.gs` layer.

Third finding, a landmine for test-fixture sizing: **none of the existing catalog/`catalogMap` test fixtures across `recipe-scaling.test.js`, `pos-recipe.test.js`, and `recipes.test.js` include a `unit` field on catalog items** (only recipe-line fixtures have `unit`). Once the shared helper enforces fail-closed on missing/mismatched units, every existing dynamic-pricing test that currently passes with an implicit "same unit" assumption will need its catalog fixture completed with a matching `unit` field, or it will start failing closed. This is a large, mechanical, but non-optional part of the phase.

**Primary recommendation:** Add one pure helper `ingredientLineCost(item, line)` to `zoho-middleware/lib/recipe-scaling.js` (or a new `zoho-middleware/lib/unit-conversion.js` required by it) returning a discriminated result (`{ ok: true, convertedQty, cost }` or `{ ok: false, error }`, mirroring the `pos.js` CR-02 `{ state }` idiom). Call it from all five identified sum-sites. Fail closed (reject, name the item) per D-02, mirroring the Phase 67 `resolveGstTaxId`-style guard. Add the same conversion check as a pre-flight validation in `routes/recipes.js` `POST /api/recipes` / `PUT /api/recipes/:id` before proxying to Apps Script (D-03).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Pack-granularity model (root cause B)**
- **D-01:** Resolve multi-unit pack items by **redefining the sellable/recipe item per-unit in Zoho** (Whirlfloc → unit `pcs` = 1 tablet, rate ≈ $0.32; purchases received in packs of 25 via a purchase-side conversion). Once per-unit, the item prices correctly as `pcs × pcs` with no engine special-case. The **invalid `L` unit on the Whirlfloc recipe line must be fixed regardless** (a tablet is a count, not a volume). Note: the Zoho item redefinition + purchase-receiving conversion is an **owner data action**; the code side must (a) not assume pack semantics and (b) let the save-time validator (D-03) reject the `L`-on-a-count mismatch.

**Non-convertible unit/rate pairs (root cause A safety)**
- **D-02:** **Fail closed.** When a recipe line's unit cannot be converted to the item's stock unit (e.g. recipe `g` vs item `pcs`), the engine must **refuse to produce a price** for that line — flag/error, never a silent best-effort product. A recipe with any un-priceable line cannot be quoted or sold until fixed. Follow the **Phase 67 tax fail-closed precedent**: the error must **name the offending ingredient line** (item + units) so staff/owner can fix it, mirroring how unresolvable tax fails closed naming the item. This applies identically on the kiosk quote, the displayed `computed_price`, and the pos-recipe sale path.

**apps-script save-time validation (scope)**
- **D-03:** **In scope for this phase.** Add unit validation/normalization to `apps-script` `createRecipe`/`updateRecipe` so an un-convertible unit/rate mismatch (a per-kg item saved with a raw-gram quantity, or a tablet counted as `L`) is **caught or auto-normalized to the item's unit at write time**, closing the loop end-to-end rather than only fixing the read/compute path.

**Interim mitigation**
- **D-04:** **Leave `SV-R-000004` as `draft`** (its current state) — no interim data edits. Draft recipes can't be sold, so the exposure is contained; the fix will recompute it to ~$88–95. Do NOT set `locked_price` or hand-edit BrewPad line units as a workaround.

### Claude's Discretion
- Exact home/signature of the shared helper (`ingredientLineCost(item, line)` in `lib/recipe-scaling.js` is the strong candidate — it already sums recipe cost) and the conversion table structure — planner/executor decide, provided all sum-sites call the one helper.
- Whether save-time validation (D-03) **rejects** vs **auto-normalizes** per case — executor's judgment, but it must never let an un-priceable recipe be saved as sellable.

### Deferred Ideas (OUT OF SCOPE)
- **Catalog-wide Zoho unit normalization** — hop/additive units are inconsistent across the catalog (some 100 g packs are `pcs`, some `g`, bulk is `kg`, one tablet pack is `pcs`). Normalizing reduces this whole bug class but is a broader data-hygiene effort; owner data action, not this code phase.
- **SafLager sale-price confirmation** — owner to confirm intended retail per sachet in Zoho; the "too cheap yeast" is catalog pricing, not the engine.
- The Kits-sheet negative `retail_instore` row — separate pricing-*data* bug, not the recipe unit-conversion engine.
</user_constraints>

<phase_requirements>
## Phase Requirements

This phase has no formal REQ-ID set (it is a bug-driven phase, not a milestone-requirements phase). The authoritative spec is `73-PRICING-BUG-HANDOFF.md`'s **Acceptance criteria**, decomposed below for planner traceability:

| ID (derived) | Description | Research Support |
|----|-------------|------------------|
| AC-01 | Dynamic pricing multiplies each ingredient by a unit-converted quantity | `ingredientLineCost` helper design (Code Examples); exact sum-sites 1-4 below |
| AC-02 | `SV-R-000004` recomputes to ~$88–95 | Evidence table reproduced below (Common Pitfalls); regression test target |
| AC-03 | Kiosk quote, displayed `computed_price`, and the actual sale invoice + stock draw-down all agree | All 5 sum-sites must call the same helper (Architecture Patterns); sum-site 5 (invoice/stock) is the landmine — currently NOT wired to the same math as sum-sites 1-2 |
| AC-04 | Multi-unit pack items handled correctly (Whirlfloc) | D-01 is an owner Zoho data action; code must not hard-code pack math (confirmed: no pack-fraction logic exists in `recipe-scaling.js` today) — only the invalid `L` unit needs save-time rejection |
| AC-05 | Recipes can't be saved with an un-convertible unit/rate mismatch | D-03 — validation must live in `routes/recipes.js` (middleware), not `.gs`, per apps-script's catalog-access gap (Runtime State / Architecture sections) |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Unit-aware ingredient cost computation (`ingredientLineCost`) | API/Backend (`zoho-middleware/lib/`) | — | Pure function, no I/O; consumed by all read/write sum-sites; this tier already owns `recipe-scaling.js` |
| Recipe `computed_price` (list + detail display) | API/Backend (`routes/recipes.js`) | — | Reads Redis-cached Zoho catalog + Apps-Script-sourced recipe/ingredient data; joins them |
| Kiosk quote (`GET /api/kiosk/recipe-quote`) | API/Backend (`routes/pos-recipe.js`) | — | Dry-run pricing, no charge; must match sale total exactly (AC-03) |
| Sale invoice line-item build + Zoho stock draw-down | API/Backend (`routes/pos-recipe.js` `_runRecipeConfirm`) | Database/Storage (Zoho Inventory, external) | Middleware builds the invoice payload; Zoho itself performs the stock deduction on invoice submit, trusting the `quantity` we send — this is why the conversion MUST happen before the payload is built, not after |
| Recipe save-time unit validation (D-03) | API/Backend (`routes/recipes.js` POST/PUT, pre-proxy) | — | Apps Script (GAS) tier has **no** Zoho catalog access — cannot validate independently (see Common Pitfalls). Middleware is the only tier with both the recipe payload and the catalog in scope at write time. |
| Recipe/ingredient persistence | Database/Storage (Google Sheets via `apps-script/adminApi.gs`) | — | Sheet-backed; `RECIPES_SHEET_NAME`, `RECIPE_INGREDIENTS_SHEET_NAME`; no unit-conversion logic belongs here, only raw storage (optionally a redundant defense-in-depth reject, discretionary) |

## Standard Stack

No new external packages. This is a pure internal-logic fix across existing Node.js (ES5, per CLAUDE.md) and Google Apps Script code. **Package Legitimacy Audit: N/A — no packages installed.**

### Existing Reusable Assets (verified by reading source)

| Asset | Location | Role |
|---|---|---|
| `recipe-scaling.js` | `zoho-middleware/lib/recipe-scaling.js` | Pure scaling + cost-summing helpers; strong candidate home for `ingredientLineCost` |
| `INGREDIENTS_ALL` catalog cache | Redis key `zoho:ingredients:all`; file fallback `zoho-middleware/ingredients-all-cache.json` | Single source of truth for `item.rate` + `item.unit`, already read by all 3 read-path sum-sites |
| `money-path.js` discriminated-result idiom | `zoho-middleware/routes/pos.js` `gcRealBalanceLookup` → `{ state: 'ok'|'invalid'|'unavailable' }` | Pattern to mirror for `ingredientLineCost`'s return shape |
| Phase 67 fail-closed guard | `zoho-middleware/routes/pos.js:406-419` (`resolveGstTaxId`) | Exact shape to mirror for D-02: resolution fails → `res.status(400).json({ error: '<names the cause>' })`, checked BEFORE any charge/invoice action |

## Architecture Patterns

### System Architecture Diagram — current (buggy) data flow

```
                         ┌─────────────────────────────┐
                         │  INGREDIENTS_ALL (Redis)     │
                         │  { item_id, rate, unit, ... }│  ← Zoho item catalog, refreshed by catalog.js
                         └───────────────┬───────────────┘
                                         │ read (item.rate; item.unit currently IGNORED)
        ┌────────────────────────────────┼────────────────────────────────────┐
        │                                │                                    │
        ▼                                ▼                                    ▼
┌───────────────────┐          ┌──────────────────────┐          ┌─────────────────────────┐
│ routes/recipes.js  │          │ lib/recipe-scaling.js │          │ routes/pos-recipe.js     │
│ enrichWithComputed  │          │ computeScaledRecipe   │          │ computeRecipeQuote()      │
│ Price (L106-141)   │          │ Total (L127-153)      │          │  → GET recipe-quote (422)│
│  sum @ L119        │          │  sum @ L141           │          │  → POST recipe-sale (295)│
│                     │          │ computeModifiedRecipe │          │                           │
│ enrichListPrices    │          │ Total (L198-276)      │          │ _runRecipeConfirm()       │
│ (L143-206)          │          │  sum @ L260 (ADDED    │          │  invoice lineItems build  │
│  sum @ L197         │          │  ingredients, locked  │          │  (L651-667) ← ALSO drives │
│                     │          │  mode)                │          │  Zoho STOCK DRAW-DOWN on  │
│ → computed_price    │          │                        │          │  invoice submit (L773)    │
│   (list + detail)   │          │ → grandTotal (quote,   │          │  ← NOT wired to           │
└─────────────────────┘          │   sale, confirm)       │          │    recipe-scaling.js's    │
                                  └───────────────────────┘          │    cost math — independent│
                                                                      │    re-read of rate/qty    │
                                                                      └───────────────────────────┘

ALL FOUR sums do: total += (Number(line.quantity)||0) * (Number(item.rate)||0)
                          — NO unit conversion between line.unit and item.unit anywhere.

Fifth site (pos-recipe.js L651-667) additionally sends the UNCONVERTED quantity as the
Zoho invoice line's `quantity` with NO per-line unit override → Zoho decrements stock by
that raw number, interpreted in the item's own unit. This is the stock-integrity half of
the bug, not just a display/charge bug.
```

### Recommended Project Structure (no new files strictly required)

```
zoho-middleware/
├── lib/
│   ├── recipe-scaling.js        # ADD: ingredientLineCost(item, line) here (or require a new sibling)
│   └── unit-conversion.js       # OPTIONAL new file: pure conversion table + classifyUnit(), required by recipe-scaling.js
├── routes/
│   ├── recipes.js                # UPDATE: enrichWithComputedPrice, enrichListPrices (call helper); POST/PUT (call helper as pre-flight validation, D-03)
│   └── pos-recipe.js             # UPDATE: computeRecipeQuote's ingredientList line_total (L478); _runRecipeConfirm's lineItems build (L651-667)
└── __tests__/
    ├── recipe-scaling.test.js    # UPDATE: ~32 catalogMap fixtures need `unit` added
    ├── pos-recipe.test.js        # UPDATE: ~18 catalog fixtures (incl. MOCK_INGREDIENTS_CATALOG) need `unit` added
    └── recipes.test.js           # UPDATE: dynamic-mode catalog fixtures need `unit` added
```

### Pattern 1: Discriminated-result unit-aware line cost (mirrors CR-02 / Phase 67 fail-closed idiom)

**What:** A pure function taking `(item, line)` and returning either a converted cost or a named error — never a silently-wrong number.
**When to use:** Every site that currently does `qty * rate` for an ingredient line.
**Example (design sketch — [ASSUMED], not yet in the codebase; conversion factors and family boundaries are internal design decisions, not externally sourced facts):**
```javascript
// Source: design derived from CONTEXT.md decisions D-01/D-02 + existing
// zoho-middleware/routes/pos.js CR-02 discriminated-result idiom (verified pattern)
'use strict';

var MASS_TO_KG   = { kg: 1, g: 0.001 };
var VOLUME_TO_L  = { l: 1, ml: 0.001 };
// Count family: union of CONTEXT.md's "pcs/ea/pack" with recipe-scaling.js's existing
// DISCRETE_UNITS (minus 'ft', which is a LENGTH unit ceil-rounded for scaling purposes,
// not a count/pass-through unit for cost — do not fold 'ft' into this family).
var COUNT_UNITS  = ['pcs', 'ea', 'each', 'unit', 'pkg', 'pack'];

function classifyUnit(raw) {
  var norm = (raw || '').toLowerCase().trim();
  if (MASS_TO_KG.hasOwnProperty(norm))        return { family: 'mass',   norm: norm };
  if (VOLUME_TO_L.hasOwnProperty(norm))       return { family: 'volume', norm: norm };
  if (COUNT_UNITS.indexOf(norm) !== -1)       return { family: 'count',  norm: norm };
  return { family: null, norm: norm };
}

// Returns { ok: true, convertedQty, cost } or { ok: false, error }
function ingredientLineCost(item, line) {
  var itemU = classifyUnit(item && item.unit);
  var lineU = classifyUnit(line && line.unit);
  var qty   = Number(line && line.quantity) || 0;
  var rate  = Number(item && item.rate) || 0;
  var name  = (line && (line.item_name || line.item_id)) || 'ingredient';

  if (!itemU.family || !lineU.family || itemU.family !== lineU.family) {
    return {
      ok: false,
      error: 'Cannot price "' + name + '": recipe unit "' + (line && line.unit) +
        '" is not convertible to item unit "' + (item && item.unit) + '"'
    };
  }

  var convertedQty;
  if (itemU.family === 'mass')        convertedQty = (qty * MASS_TO_KG[lineU.norm])   / MASS_TO_KG[itemU.norm];
  else if (itemU.family === 'volume') convertedQty = (qty * VOLUME_TO_L[lineU.norm])  / VOLUME_TO_L[itemU.norm];
  else                                 convertedQty = qty; // count: pass-through, no numeric conversion

  return { ok: true, convertedQty: convertedQty, cost: Math.round(convertedQty * rate * 10000) / 10000 };
}

module.exports.ingredientLineCost = ingredientLineCost;
module.exports.classifyUnit = classifyUnit; // exposed for validation reuse (D-03)
```

### Anti-Patterns to Avoid
- **Converting after summing, or converting only in the display path:** the fifth sum-site (`pos-recipe.js` invoice line-item build) is easy to miss because it doesn't call `lib/recipe-scaling.js` at all — it independently rebuilds `li.quantity`/`li.rate`. Fixing only `recipe-scaling.js` leaves `computed_price` and `grandTotal` correct but the **actual Zoho invoice + stock deduction still wrong**.
- **Assuming DISCRETE_UNITS (existing scaling constant) == the new "count" family:** `recipe-scaling.js`'s `DISCRETE_UNITS` (`['pcs','each','unit','pkg','ft']`) governs whether a recipe-scale multiplication rounds up or stays linear — a *different* axis from unit-conversion. `'ft'` is a length unit ceil-rounded for scaling reasons (cut tubing/hose), not a count-family pass-through for cost purposes. Do not reuse `DISCRETE_UNITS` directly as the cost helper's count-family list.
- **Silent 0-cost or 0-quantity fallback on non-convertible pairs:** D-02 requires an explicit named error, not `|| 0`.
- **Validating in `.gs` only:** Apps Script has no Zoho catalog data (see Runtime State Inventory below) — a `.gs`-only validator cannot resolve `item.unit` and will either always pass or need the caller to also send the item's unit (redundant, unverified, and untestable — GAS has no test harness at all).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Duplicate cost-summing logic per route | A second/third/fourth inline `total += qty*rate` loop | The one shared `ingredientLineCost(item, line)` | This is the entire point of D-02/AC-03 — divergence between sum-sites is the root failure mode being fixed |
| Pack-fraction math for multi-unit items | Code-side "1 pack = 25 units" divisor logic | D-01's Zoho item redefinition (owner data action) | Explicitly out of scope per CONTEXT.md — the code must not assume pack semantics |
| GAS-side catalog mirror | A new "Ingredients" sheet in Apps Script synced from Zoho | Validate in the middleware (`routes/recipes.js`), which already has the catalog | Building a catalog-sync mechanism into Apps Script is a much larger, untested, unscoped change than this phase calls for |

**Key insight:** The bug is fundamentally about **divergence** (4+ independent implementations of the same formula), not about the formula being hard. The fix's value comes entirely from consolidation to one call site pattern, not from clever conversion math (the math itself is trivial ÷/×1000).

## Runtime State Inventory

Not a rename/refactor/migration phase in the classic sense, but D-03 and the "recipe save" data flow warrant the same rigor since a save-time validator's *reach* depends on which write paths actually exist.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Recipe ingredient lines live in the `RecipeIngredients` Google Sheet tab (`RECIPE_INGREDIENTS_SHEET_NAME`), columns: `ingredient_id, recipe_id, item_id, item_name, quantity, unit` (confirmed at `apps-script/adminApi.gs` L3505-3512, L3616-3623). **No `rate` or item-unit column exists in this sheet** — rate/unit are always joined at read time from the middleware's Redis cache, never persisted alongside the recipe line. | Code edit only — no data migration needed (rate/unit are always live-joined, never stale-cached in the Sheet itself) |
| Live service config | None — no external service config (n8n/Datadog-style) references recipe units | None |
| OS-registered state | None | None |
| Secrets/env vars | `MILLING_FEE_ITEM_ID`, `MAKERS_FEE_ITEM_ID`, `MATERIALS_FEE_ITEM_ID` (fee items, NOT ingredient lines — no unit conversion needed on these, they are always `quantity: 1 × flat rate`) | None — out of scope, fee lines are unaffected by this bug |
| Build artifacts | None | None |
| **Write-path topology (critical for D-03 reach)** | Two `create_recipe`/`update_recipe` dispatch branches exist in `apps-script/adminApi.gs` `doPost`: (1) `server_token`-gated (L268-277), called by `zoho-middleware/routes/recipes.js` via `callAppsScriptPost` — **confirmed the only path BrewPad's frontend actually exercises** (`js/brewpad.js` calls `mwUrl() + '/api/recipes'` exclusively, verified by grep — no direct Apps-Script-URL calls from BrewPad); (2) Google-OAuth staff-auth `case 'create_recipe'`/`'update_recipe'` (L416-425) — present in the dispatcher but **no current frontend caller was found**; likely vestigial/defensive. | Validate at the middleware entry point (path 1) — this covers 100% of the currently-exercised write surface. Flag path 2 to the planner as a discretionary defense-in-depth target only if the executor wants belt-and-suspenders coverage of a currently-unused code path. |

**Nothing found in category:** Live service config, OS-registered state, build artifacts — verified by grep across the phase's file set; none apply to this bug-fix phase.

## Common Pitfalls

### Pitfall 1: Fixing `lib/recipe-scaling.js` alone leaves the actual sale/stock path wrong
**What goes wrong:** `computed_price` and the kiosk-displayed `grandTotal` become correct, but the Zoho invoice + inventory deduction stay broken, because `pos-recipe.js` `_runRecipeConfirm`'s `lineItems` build (L651-667) independently re-derives `li.quantity`/`li.rate` from `catalogEntry`/`scaledIngredients` — it does not call any function in `lib/recipe-scaling.js` for the per-line values, only for the aggregate `grandTotal` sanity figure.
**Why it happens:** The code has two parallel concerns that look like one — "what's the total price" (uses the helper) vs. "what quantity/rate do we put on each Zoho invoice line" (does not).
**How to avoid:** Explicitly wire `ingredientLineCost` (or at minimum its `convertedQty`) into the `lineItems` build loop (L651-667), using `convertedQty` as `li.quantity` — this is what makes the Zoho-side stock deduction correct, since no per-line unit override is sent to Zoho (invoice payload has `item_id, name, quantity, rate, tax_id` only — no `unit` field, confirmed by reading L657-666).
**Warning signs:** A regression test that only checks `computed_price` or `grandTotal` numerically equal ~$88-95 will NOT catch this — a test must additionally assert the invoice `lineItems` array's `quantity` values are the converted (small) numbers, not the raw recipe-unit numbers.

### Pitfall 2: Existing test fixtures universally lack `item.unit`, so the fail-closed helper will break dozens of passing tests unless fixtures are completed
**What goes wrong:** `recipe-scaling.test.js` has ~32 `catalogMap` literal declarations (e.g. `var catalogMap = { a1: { rate: 3.00 } };`, confirmed at L266/283/297/317) with **no `unit` key**. `pos-recipe.test.js` has ~18 catalog-shaped fixtures including `MOCK_INGREDIENTS_CATALOG` (L87-92, confirmed no `unit` field on any of its 4 entries, while the paired recipe-ingredient fixtures at L109-113 DO carry `unit: 'kg'`/`'pcs'`). `recipes.test.js` has a handful of dynamic-mode ingredient fixtures similarly missing item-side `unit`.
**Why it happens:** Because the current code never reads `item.unit`, no test author had a reason to set it.
**How to avoid:** Treat "add a matching `unit` to every catalog-map/catalog-item test fixture used by a *dynamic-mode* test" as a required, mechanical, in-scope task — not a violation of CLAUDE.md rule 10 ("do not modify existing tests"), analogous to Phase 67's flagged precedent where two tests asserting old fallback behavior had to be updated because the fixtures encoded the bug, not a legitimate spec. This is fixture *completion*, not assertion-weakening.
**Warning signs:** Running the full middleware suite immediately after wiring the helper in (before touching fixtures) — expect a large wave of new failures across all three files; this is the sizing signal for how big this task actually is (potentially the single largest line-count item in the phase).

### Pitfall 3: Imperial units (`oz`, `lb`, `tsp`, `tbsp`, `cup`, `pt`, `qt`, `gal`, `floz`) are real, in-use scaling units but are NOT covered by D-02's stated mass/volume conversion table
**What goes wrong:** `recipe-scaling.js`'s existing `CONTINUOUS_UNITS` constant (L34-37) already recognizes these as legitimate recipe units (comment: "imperial weight/volume used by BeerSmith/BeerXML recipes"), meaning real recipes may already use `oz` hops, `lb` grain, etc. CONTEXT.md's decisions only specify `g↔kg`, `ml↔L`, and count pass-through — nothing about imperial-to-metric conversion. Under strict D-02 fail-closed, an `oz` recipe line against a `kg` item would (correctly, per the letter of the decision) refuse to price — but this may be a **false positive** blocking real recipes that were working fine before (if the item unit also happens to be imperial, e.g. `oz`-priced items, no conversion is even needed; the failure mode is specifically imperial-recipe-unit vs metric-item-unit or vice versa).
**Why it happens:** BeerXML import (mentioned in `recipe-scaling.js` comments) is a known ingestion path for imperial-unit recipes; the phase's decisions were scoped narrowly to the diagnosed bug (metric bulk-vs-retail mismatch), not to a full unit-system audit.
**How to avoid:** Flagged as an **Open Question** below — the planner should decide whether to (a) extend the conversion table to imperial↔metric (adds real conversion factors, e.g. 1 lb = 453.592 g) or (b) explicitly accept that imperial-vs-metric mismatches fail closed and treat any resulting friction as a follow-up data-normalization item (same spirit as the deferred "catalog-wide Zoho unit normalization" idea).
**Warning signs:** A previously-working recipe using `oz`/`lb` starts failing closed after this phase ships, with no clear owner-facing explanation of why (mitigated by D-02's requirement to name the item + units in the error).

### Pitfall 4: GAS-side validation cannot be self-sufficient — do not let the plan silently drop D-03 into a no-op
**What goes wrong:** If a plan literally interprets "add validation to `apps-script` `createRecipe`/`updateRecipe`" and tries to write it as pure `.gs` logic without passing in catalog data, it either can't run (no `item.unit`/`item.rate` in scope) or must be stubbed as a no-op that always passes.
**Why it happens:** CONTEXT.md's wording says "apps-script `createRecipe`/`updateRecipe`" — but the underlying architectural fact (no catalog access in GAS) wasn't visible until reading both `adminApi.gs` (confirmed: `RECIPE_INGREDIENTS_SHEET_NAME` columns are `ingredient_id, recipe_id, item_id, item_name, quantity, unit` — no rate, no item-unit) and confirming no Ingredients-mirror sheet exists (`grep -n "SHEET_NAME\s*="` returned no ingredients/catalog sheet).
**How to avoid:** Implement D-03 in `zoho-middleware/routes/recipes.js` (`POST /api/recipes` at L376-390 and `PUT /api/recipes/:id` at L396-427) — read `INGREDIENTS_ALL` from cache, run each incoming ingredient line through `ingredientLineCost`/`classifyUnit`, and reject (422, matching the existing D-02 activation-guardrail pattern already at L400-414 in this same route) BEFORE calling `callAppsScriptPost('create_recipe'/'update_recipe', payload)`. This satisfies the *spirit* of D-03 (closing the write-time loop end-to-end) at the only tier that can actually do it, and is fully covered by the existing Jest harness (`recipes.test.js` already has `describe('POST /api/recipes')` and `describe('PUT /api/recipes/:id')` blocks, L306-388, to extend).

## Code Examples

### Exact sum-sites to wire (all verified by reading source; line numbers current as of 2026-08-25)

**1. `zoho-middleware/routes/recipes.js:119`** — `enrichWithComputedPrice` (recipe DETAIL `computed_price`):
```javascript
// Source: zoho-middleware/routes/recipes.js:106-141 (current, buggy)
    (ingredients || []).forEach(function (ing) {
      var entry = map[ing.item_id];
      if (entry) {
        ing.rate = Number(entry.rate) || 0;
        ing.tax_percentage = Number(entry.tax_percentage) || 0;
        ing.tax_id = entry.sales_tax_rule_id || entry.tax_id || '';
        total += (Number(ing.quantity) || 0) * ing.rate;   // ← L119, no unit conversion
      }
    });
```

**2. `zoho-middleware/routes/recipes.js:197`** — `enrichListPrices` (recipe LIST `computed_price`):
```javascript
// Source: zoho-middleware/routes/recipes.js:194-198 (current, buggy)
        var total = 0;
        detail.ingredients.forEach(function (ing) {
          var entry = map[ing.item_id];
          if (entry) total += (Number(ing.quantity) || 0) * (Number(entry.rate) || 0);  // ← L197
        });
```

**3. `zoho-middleware/lib/recipe-scaling.js:141`** — `computeScaledRecipeTotal` (dynamic-mode; feeds `grandTotal` for quote AND sale AND confirm):
```javascript
// Source: zoho-middleware/lib/recipe-scaling.js:137-144 (current, buggy)
    (scaledIngredients || []).forEach(function (ing) {
      var entry = catalogMap[ing.item_id];
      if (entry) {
        total += (Number(ing.quantity) || 0) * (Number(entry.rate) || 0);  // ← L141
      }
    });
```

**4. `zoho-middleware/lib/recipe-scaling.js:260`** — `computeModifiedRecipeTotal` (locked-mode, ADDED-ingredient sub-sum — a second, easy-to-miss sum-site in the SAME file):
```javascript
// Source: zoho-middleware/lib/recipe-scaling.js:252-263 (current, buggy)
    (modifiedBaseIngredients || []).forEach(function (ing) {
      if (!originalIds[ing.item_id]) {
        var catalogEntry = catalogMap[ing.item_id];
        if (catalogEntry) {
          var scaled = scaleIngredient(ing, factor);
          total += (Number(scaled.quantity) || 0) * (Number(catalogEntry.rate) || 0);  // ← L260
        }
      }
    });
```

**5. `zoho-middleware/routes/pos-recipe.js:651-667`** — `_runRecipeConfirm` invoice line-item build (**the actual Zoho charge + stock draw-down path — independent of sites 3/4 above**):
```javascript
// Source: zoho-middleware/routes/pos-recipe.js:650-667 (current, buggy)
        var lineItems = [];
        for (var i = 0; i < scaledIngredients.length; i++) {
          var ing = scaledIngredients[i];
          var catalogEntry = catalogMap[ing.item_id];
          var ingredientRate = catalogEntry ? (Number(catalogEntry.rate) || 0) : 0;
          var ingredientQty = Number(ing.quantity) || 0;   // ← scaled but NOT unit-converted
          var li = {
            item_id: ing.item_id,
            name: ing.item_name,
            quantity: ingredientQty,   // ← this becomes the Zoho invoice line quantity,
            rate: ingredientRate       //   which Zoho uses BOTH for the invoice total AND
          };                           //   for inventory deduction on submit (L773) — no
          if (catalogEntry && catalogEntry.tax_id) {                 // per-line unit override is sent to Zoho.
            li.tax_id = catalogEntry.tax_id;
          }
          lineItems.push(li);
        }
```

**Secondary (display-only, should still be consistent):** `zoho-middleware/routes/pos-recipe.js:478` — the `GET /api/kiosk/recipe-quote` response's per-ingredient `line_total` (inside the `ingredientList` map at L458-480) is currently `Math.round(scaledQty * rate * 100) / 100` with no conversion. Not authoritative for charging, but should show the SAME number the sale will eventually charge (AC-03) — wire it too.

### Existing fail-closed precedent to mirror (Phase 67)
```javascript
// Source: zoho-middleware/routes/pos.js:406-419 (resolveGstTaxId guard — the pattern to copy)
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
This is the exact shape D-02 should replicate: resolve → on failure, `400` naming the cause, checked BEFORE any Helcim/terminal/invoice action. `zoho-middleware/routes/pos.js:637-646` (WR-03) is the companion lock-release pattern — for the recipe sale path this is `cache.releaseLock(C.LOCK_KEYS.RECIPE_SALE)`, already used identically at `pos-recipe.js:399,738,797,889,899,905` for other failure branches.

### Existing test harness to extend (all three files use this exact skeleton)
```javascript
// Source: zoho-middleware/__tests__/pos-recipe.test.js:1-74 (mock/harness skeleton, reused near-verbatim
// across recipe-scaling.test.js / recipes.test.js / pos-recipe.test.js)
var mockRouteHandlers = {};
jest.mock('express', function () { /* captures GET/POST/PUT handlers by path */ });
jest.mock('../lib/cache', function () { return { get: jest.fn(), set: jest.fn().mockResolvedValue('OK'), ... }; });
jest.mock('../lib/constants', function () { return { CACHE_KEYS: { INGREDIENTS_ALL: 'zoho:ingredients:all', ... } }; });
function resetAndLoadPosRecipe() { mockRouteHandlers = {}; jest.resetModules(); require('../routes/pos-recipe'); ... }
function callHandler(method, path, req) { /* resolves { _status, _body } via mocked res.json */ }
```
`recipe-scaling.test.js` needs no Express/route mocking at all — it imports the pure functions directly (`var scaling = require('../lib/recipe-scaling');`), making it the cheapest place to add the new `ingredientLineCost`/`classifyUnit` unit-cost regression cases (per-kg $54×12g→$0.65 etc.).

## State of the Art

Not applicable in the traditional "library changed" sense — this is a single-repo internal bug. The one relevant "state of the art" note: recipe-scaling.js already establishes the project's convention for pure, I/O-free, independently-testable helper modules (its own doc comment: "This module is intentionally pure: no I/O, no requires."). `ingredientLineCost` should follow the same convention — do not have it read `cache`/`axios` itself; callers pass in the already-fetched `item`/`line` objects, exactly like `computeScaledRecipeTotal` already does with `catalogMap`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The proposed `ingredientLineCost`/`classifyUnit` function signatures and conversion-table shape (Code Examples, Pattern 1) | Architecture Patterns / Code Examples | Low — explicitly marked as a design sketch, not a claim about existing code; CONTEXT.md leaves the exact signature to planner/executor discretion |
| A2 | The Google-OAuth `create_recipe`/`update_recipe` dispatch branch in `adminApi.gs` (L416-425) is currently unused by any live frontend | Runtime State Inventory | Medium — if some other, unfound caller (e.g. a script, a Postman collection, an old admin-panel code path) hits Apps Script directly with a Google session, D-03 validation placed only in the middleware would not cover it. Confirmed by grep across `js/*.js` (excluding minified) for direct Apps-Script-URL calls — none found — but grep coverage of all consumers (e.g. `.claude/worktrees/`, external scripts) was not exhaustive. |
| A3 | Imperial units (oz/lb/tsp/etc.) are out of scope for the new conversion table per CONTEXT.md's literal wording | Common Pitfalls #3 / Open Questions | Medium — if real active recipes use imperial units against mismatched-family items, D-02 fail-closed will block them; this needs an explicit owner/planner decision, not a silent researcher assumption |
| A4 | `item.unit` strings on the live Zoho catalog are already lowercase, unambiguous abbreviations (`kg`,`g`,`l`,`ml`,`pcs`) with no synonyms beyond what's shown in the handoff's evidence table | Common Pitfalls / Standard Stack | Low-Medium — the handoff's own evidence table shows one uppercase outlier (`L` on the Whirlfloc recipe LINE, not the item) and the STATE.md accumulated-context notes flag catalog-wide unit inconsistency as a known, deferred issue — `classifyUnit`'s case-insensitive `.toLowerCase().trim()` (mirroring `recipe-scaling.js`'s existing normalization idiom) mitigates this, but exotic Zoho unit strings not seen in this research (e.g. "Kilograms" spelled out) would still fail closed, which is safe but could be surprising |

## Open Questions

1. **Should the conversion table include imperial↔metric (oz/lb/tsp/tbsp/cup/pt/qt/gal/floz)?**
   - What we know: `recipe-scaling.js`'s existing `CONTINUOUS_UNITS` list already treats these as legitimate recipe units (BeerXML import path); CONTEXT.md's decisions only name `g↔kg`/`ml↔L`/count.
   - What's unclear: whether any *currently active* recipe actually uses an imperial unit against a metrically-priced item (vs. imperial-vs-imperial, which needs no conversion at all).
   - Recommendation: planner should have the executor grep live recipe ingredient units (via `GET /api/recipes?status=active` + `/api/recipes/:id`) for any non-metric, non-count unit before deciding; if none exist today, ship without imperial support and document the fail-closed behavior as intentional (matches D-02's spirit — better to block an edge case loudly than silently mis-price it).

2. **Should D-03 also add a defense-in-depth reject inside `apps-script/adminApi.gs`'s Google-OAuth `create_recipe`/`update_recipe` branch (L416-425), given it's a currently-unused-but-present code path?**
   - What we know: no live caller was found (A2 above); GAS has zero test infrastructure so any logic added there is effectively unverified in CI.
   - What's unclear: whether the executor/owner wants belt-and-suspenders coverage of a technically-reachable-but-dormant path.
   - Recommendation: skip unless the planner explicitly wants it — the middleware-side validation (routes/recipes.js) already covers 100% of the confirmed live write surface, and adding untested GAS logic increases risk without confirmed benefit.

3. **Does `pos-recipe.js`'s discount-distribution logic (`distributeRecipeDiscount`, L109-144) need to change once invoice-line quantities become unit-converted?**
   - What we know: `distributeRecipeDiscount` computes each targeted line's total as `(Number(li.quantity) || 0) * (Number(li.rate) || 0)` (L124, L133) — this is a SEPARATE, sixth `qty*rate` computation, operating on the `lineItems` array AFTER it's built.
   - What's unclear: if `lineItems` quantities are correctly converted upstream (fix to site 5), this discount math automatically inherits the fix (it reads from the already-corrected `li.quantity`/`li.rate`) — so likely no separate change needed, but the planner should verify this explicitly with a test (discount applied to a converted-quantity line still caps/distributes correctly) rather than assume it, since it's yet another site touching the same shape of computation.

## Environment Availability

No new external dependency. Existing dependencies this phase touches are already configured and available: Redis (`INGREDIENTS_ALL` cache), Zoho Books/Inventory API (`/invoices` endpoint, item catalog), Apps Script Web App (`APPS_SCRIPT_URL`/`APPS_SCRIPT_SERVER_TOKEN`). No environment audit gaps identified — this is a pure logic-correctness phase within already-live infrastructure.

## Validation Architecture

Skipped — `workflow.nyquist_validation` is explicitly `false` in `.planning/config.json`.

## Security Domain

`security_enforcement: true`, `security_asvs_level: 1` (from `.planning/config.json`) — included per policy, though this phase is a money-path/data-integrity bug fix, not a new attack-surface feature.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | No new auth surface — existing kiosk device-token / Google-session tiers on `/api/recipes` and `/api/kiosk/recipe-*` routes are unchanged |
| V3 Session Management | No | Unchanged |
| V4 Access Control | No | Unchanged — `POST/PUT /api/recipes` already staff-gated; no new route added |
| V5 Input Validation | **Yes** | The D-03 save-time unit validation IS an ASVS V5 concern (reject malformed/incompatible business data at the write boundary). Implement as a synchronous pre-flight check in `routes/recipes.js` before proxying to Apps Script, returning `422` with a named-item error, matching the existing D-02 activation-guardrail idiom already in the same route (L400-414) |
| V6 Cryptography | No | Not applicable |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Business-logic price manipulation via crafted recipe unit/quantity data (not this phase's bug, but adjacent) | Tampering | Server-authoritative rate is already enforced (`lib/recipe-scaling.js` comment: "rate is always read from catalogMap[item_id].rate. Any rate/price field on the client-supplied ingredient object is ignored" — T-36-01, still true after this fix since the helper reads `item.rate` from the server catalog, never from client-supplied line data) |
| Un-validated unit strings causing silent mis-pricing (THIS phase's actual bug) | Tampering / (unintentional, not adversarial) Repudiation of correct pricing | D-02 fail-closed + named error — this phase's core fix |

## Sources

### Primary (HIGH confidence — verified by reading actual source in this session, 2026-08-25)
- `zoho-middleware/lib/recipe-scaling.js` (full file read) — scaling/cost sum-sites, `DISCRETE_UNITS`/`CONTINUOUS_UNITS`
- `zoho-middleware/routes/recipes.js` (L1-430 read) — `enrichWithComputedPrice`, `enrichListPrices`, `POST/PUT /api/recipes`
- `zoho-middleware/routes/pos-recipe.js` (full file, 918 lines, read) — `computeRecipeQuote`, `GET recipe-quote`, `POST recipe-sale`, `_runRecipeConfirm`
- `zoho-middleware/routes/catalog.js` (relevant sections read) — `INGREDIENTS_ALL` cache population, `item.unit` sourcing (raw Zoho passthrough, no normalization)
- `apps-script/adminApi.gs` (L239-438, L3331-3636 read) — `doPost` dispatcher (both `create_recipe`/`update_recipe` branches), `createRecipe`/`updateRecipe`/`getRecipeDetail`, `RecipeIngredients` sheet column shape, confirmed no Ingredients-catalog sheet exists
- `zoho-middleware/__tests__/recipe-scaling.test.js`, `recipes.test.js`, `pos-recipe.test.js` (structure + representative fixtures read) — confirmed catalog fixtures universally lack `unit`
- `.planning/phases/67-.../67-PATTERNS.md` (full file read) — fail-closed pattern precedent, discriminated-result idiom
- `js/brewpad.js` (grep for `api/recipes`) — confirmed BrewPad frontend exclusively calls the middleware, never Apps Script directly
- `.planning/phases/73-.../73-CONTEXT.md`, `73-PRICING-BUG-HANDOFF.md` — locked decisions and authoritative bug spec

### Secondary (MEDIUM confidence)
- None — all findings in this research were directly verified against source in this session; no external web/Context7 lookups were needed for this internal-only bug fix.

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: N/A — no external packages
- Architecture / sum-site locations: HIGH — every cited file:line was read directly in this session
- Pitfalls: HIGH for Pitfalls 1/2/4 (directly observed in code); MEDIUM for Pitfall 3 (imperial-unit scope gap is a real open question, not a confirmed defect)
- Test-fixture impact sizing (Pitfall 2): HIGH confidence on the *existence* of the gap (grep-confirmed counts), MEDIUM on the exact task-sizing magnitude (counts are approximate — `grep -c` counts occurrences of the word "catalogMap"/"unit:", not unique fixture blocks needing edits)

**Research date:** 2026-08-25
**Valid until:** Effectively indefinite for the architectural findings (internal code, not an external API) — re-verify only if `recipe-scaling.js`, `recipes.js`, or `pos-recipe.js` are touched by another phase before Phase 73 executes.
