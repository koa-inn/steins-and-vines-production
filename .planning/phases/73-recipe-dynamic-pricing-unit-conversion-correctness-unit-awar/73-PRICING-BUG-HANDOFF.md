# Handoff — Recipe dynamic pricing is wrong (unit conversion + pack-granularity)

**For:** the Phase 73 planner/executor (BrewPad recipe system: `zoho-middleware/` + `apps-script/`).
**Priority:** High — a recipe can display/charge a price ~20× too high. Caught because the affected recipe is still a draft.
**Status:** Diagnosed from live data (Zoho items + `/api/recipes`). Not yet fixed. Diagnosis structurally confirmed against code 2026-08-25 (un-converted `rate × quantity` sum sites exist in `routes/recipes.js`, `routes/pos-recipe.js`; `lib/recipe-scaling.js` is the natural home for the shared helper).

---

## Symptom

The dynamic recipe price (`computed_price`) for **`SV-R-000004` "30L American Lager"** (status `draft`) returns **`$1,896.98`**. Expected: **~$88–95** (other 30 L recipes: Dangerous Bunny $109, Czech Lager $124, Hazy Pale Ale $108). Multiple ingredient lines are individually wrong — some way too high, and a data issue that makes another look too cheap.

## Root cause A (the big one): cost math ignores units

Dynamic price is computed roughly as:

```
computed_price = Σ( item.rate × recipe_line.quantity ) + service_fee + materials_fee
```

`item.rate` is per the item's **Zoho stock unit**, but `recipe_line.quantity` is in **whatever unit the recipe uses**, and the two are multiplied **with no conversion**. So a bulk hop priced **$54/kg** used as **12 g** is charged 12 × 54 = **$648** instead of 0.012 × 54 = **$0.65** — a **1000×** error. Lines where recipe unit == item unit (malt: kg×kg) are fine; only unit mismatches break.

Exposed by the "recipes use the bulk item by default" change: bulk items (`*-B` SKUs) are stocked/priced **per kg / per L**, while recipes are written in **g / ml**. Retail-pack items (e.g. `Citra-100g`, unit `pcs`) don't hit this — which is why `SV-R-000003` Hazy Pale Ale priced fine.

## Root cause B: pack-granularity mismatch (Irish moss / Whirlfloc)

Separately, an item can be defined as a **multi-unit pack** while a recipe consumes **one unit of it**. `Whirlfloc Tablets (25 pack)` (item `…552017`, SKU 63854) is a **25-tablet pack priced $8** (Zoho `unit: pcs`, i.e. 1 "pcs" = 1 pack; its description says "a single tablet treats a 5-gal batch"). The recipe consumes ~1 tablet but is charged for the **whole pack** → **$8** vs the true **~$0.32/tablet**. (The recipe line's unit is even stored as `L`, which is invalid for a tablet — a data problem in its own right.)

## NOT a bug: yeast

`Fermentis SafLager™ W-34/70 11.5g` (`…028523`) is `unit: pcs`, `rate: $10/sachet` (purchase cost $7.40). Recipe uses **2 sachets → $20**, which is the catalog price computing **correctly** (pcs × pcs, no mismatch). If $20 reads "too cheap," the fix is the **item's sale price in Zoho**, not the pricing engine. **Action for owner (not code):** confirm the intended retail per sachet and update the Zoho item if needed; the recipe will follow.

## Evidence — `GET /api/recipes/SV-R-000004` line items

| Ingredient (item_id) | Zoho unit | rate | recipe qty | computed | correct | issue |
|---|---|---|---|---|---|---|
| Magnum Bulk (`…621241`, MAG-B) | **kg** | $54 | 12 g | **$648.00** | $0.65 | A |
| GR Hallertau Mittelfruh Bulk (`…621145`, MIT-B) | **kg** | $72 | 15 g | **$1,080.00** | $1.08 | A |
| Calcium Chloride Bulk (`…028621`) | kg | $15 | 3 g | $45.00 | $0.045 | A |
| Gypsum / Calcium Sulfate Bulk (`…028635`) | kg | $10 | 3 g | $30.00 | $0.03 | A |
| Whirlfloc Tablets (25 pack) (`…552017`) | pcs = 1 pack | $8 | 1 (unit stored `L`) | $8.00 | ~$0.32 | B |
| Gambrinus Pilsner Malt (`…028341`) | kg | $2.75 | 4.1 kg | $11.28 | $11.28 | ✓ |
| OiO Flaked Corn (`…028467`) | kg | $3 | 1.4 kg | $4.20 | $4.20 | ✓ |
| Fermentis SafLager W-34/70 (`…028523`) | pcs | $10 | 2 pcs | $20.00 | $20.00 | ✓ (see yeast note) |
| Lactic Acid 88% (`…028649`) | L | $25 | 0.02 L | $0.50 | $0.50 | ✓ |

Inflated lines total $648 + $1,080 + $45 + $30 + $7.68(whirlfloc excess) = the bulk of the error. Full check: ingredient sum $1,846.98 + service_fee $45 + materials_fee $5 = **$1,896.98** = `computed_price` (fees added pre-tax; milling fee not included). Corrected recipe ≈ **$88** at current catalog rates.

Both bulk hops verified in Zoho: `Magnum Bulk` unit `kg` $54; `GR Hallertau Mittelfruh Bulk` unit `kg` $72.

## Please investigate

1. **Find where `computed_price` is calculated.** `/api/recipes` reports `source: "apps-script"/"cache"` (recipes live in the Google Sheet via `apps-script/`), but the per-ingredient `rate`/`computed_price` enrichment appears to be in `zoho-middleware/routes/recipes.js` (joins recipe ingredients to Zoho item rates). Confirm the layer that does `rate × quantity` and sums it.
2. **Trace every place ingredient cost is summed** so they all get the fix and stay consistent:
   - recipe `computed_price` (list + detail),
   - `GET /api/kiosk/recipe-quote`,
   - the **pos-recipe sale** path that builds the Zoho invoice lines / draws down ingredient stock (so charged invoice == quote *and* stock decrement uses correct units).

## Suggested fix

- **A — make cost computation unit-aware.** Before `rate × quantity`, convert `recipe_line.quantity` from `recipe_line.unit` to the **item's stock unit**: mass `g↔kg` (÷/×1000), volume `ml↔L` (÷/×1000), count `pcs/ea/pack` no conversion. Reject/flag any non-convertible pair (e.g. recipe `g` vs item `pcs`) instead of multiplying. Put it in one shared helper (`ingredientLineCost(item, line)`) and call it from **all** the sites in step 2 so quote, `computed_price`, and the actual sale never diverge. Same conversion for the stock draw-down.
- **B — resolve pack-granularity for tablet/pack items.** Decide the model for `Whirlfloc Tablets (25 pack)`: cleanest is to define the sellable/recipe item **per tablet** (unit `pcs` = 1 tablet, rate ≈ $0.32, and receive purchases in packs of 25 via a conversion), OR keep the pack item and store the recipe quantity as a fraction of a pack (e.g. `0.04`). Fix the invalid `L` unit on that recipe line regardless.
- **Validate/normalize units on recipe save** (`apps-script` createRecipe/updateRecipe): a per-kg item saved with a raw gram quantity+per-kg rate, or a tablet counted as `L`, should be caught or auto-normalized to the item's unit.
- **Owner data check (not code):** confirm the SafLager sale price ($10/sachet) is intentional; the "too cheap yeast" is catalog pricing, not the engine.

## Tests to add

- Unit-cost helper: per-kg item $54 × `12 g` → `0.648`; per-L $25 × `20 ml` → `0.50`; per-pcs $10 × `2 pcs` → `20`; incompatible pair → error, not a silent product.
- `SV-R-000004` regression: `computed_price` ≈ **$88–95**, not $1,896.98 (pin once the helper + Whirlfloc model land).
- Quote == sale: `recipe-quote` total equals the Zoho invoice lines the pos-recipe sale produces for the same recipe/scale.
- Stock draw-down uses converted quantities (12 g hop decrements 0.012 kg, not 12 kg).

## Acceptance criteria

Dynamic pricing multiplies each ingredient by a **unit-converted** quantity and handles multi-unit pack items correctly. `SV-R-000004` recomputes to ~$88–95. Kiosk quote, displayed `computed_price`, and the actual sale invoice + stock draw-down all agree. Recipes can't be saved with an un-convertible unit/rate mismatch.

## Interim options (no code) while the fix is pending

- Leave `SV-R-000004` as **draft** (it is) so it can't be sold, **or**
- Set `locked_price` ≈ $92 and `pricing_mode` ≠ `dynamic` (currently `locked_price: 0`, `pricing_mode: "dynamic"`), **or**
- Correct the bulk line quantities to the item's unit in BrewPad (12 g → 0.012 kg, etc.) and the Whirlfloc line to ~0.04 pack — works today but awkward and doesn't fix the engine.

---

*Context:* logged in staging repo `feedback-log.md` (same folder as this handoff's origin). Related earlier note: Zoho hop/additive units are inconsistent across the catalog (some 100 g packs are `pcs`, some `g`, bulk is `kg`, one tablet pack is `pcs`); normalizing them reduces the surface area for this whole class of bug.
