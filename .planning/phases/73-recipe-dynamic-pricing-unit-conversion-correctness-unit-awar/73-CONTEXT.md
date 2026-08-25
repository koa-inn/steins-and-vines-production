# Phase 73: Recipe dynamic pricing unit-conversion correctness - Context

**Gathered:** 2026-08-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Make recipe ingredient-cost math **unit-aware** across every place ingredient cost is summed, so the dynamic recipe price can no longer multiply `item.rate` (per Zoho stock unit) by `recipe_line.quantity` (recipe unit) without conversion. One shared helper computes each line's cost with unit conversion (mass g↔kg, volume ml↔L, count pass-through) and is called from all sum-sites so **quote = displayed `computed_price` = actual sale invoice = stock draw-down** can never diverge. Also resolve multi-unit pack-item granularity and add save-time unit validation.

**In scope:** unit-aware cost helper + wiring it into all sum-sites; pack-granularity resolution; fail-closed on non-convertible pairs; apps-script save-time unit validation; regression tests (helper units, `SV-R-000004` ≈ $88–95, quote==sale, converted stock draw-down).

**Out of scope (owner data actions, not code):** confirming the SafLager sale price in Zoho ($10/sachet — computes correctly, not an engine bug); catalog-wide Zoho unit normalization; the Kits-sheet negative retail_instore row (separate pricing-data todo).
</domain>

<decisions>
## Implementation Decisions

### Pack-granularity model (root cause B)
- **D-01:** Resolve multi-unit pack items by **redefining the sellable/recipe item per-unit in Zoho** (Whirlfloc → unit `pcs` = 1 tablet, rate ≈ $0.32; purchases received in packs of 25 via a purchase-side conversion). Once per-unit, the item prices correctly as `pcs × pcs` with no engine special-case. The **invalid `L` unit on the Whirlfloc recipe line must be fixed regardless** (a tablet is a count, not a volume). Note: the Zoho item redefinition + purchase-receiving conversion is an **owner data action**; the code side must (a) not assume pack semantics and (b) let the save-time validator (D-03) reject the `L`-on-a-count mismatch.

### Non-convertible unit/rate pairs (root cause A safety)
- **D-02:** **Fail closed.** When a recipe line's unit cannot be converted to the item's stock unit (e.g. recipe `g` vs item `pcs`), the engine must **refuse to produce a price** for that line — flag/error, never a silent best-effort product. A recipe with any un-priceable line cannot be quoted or sold until fixed. Follow the **Phase 67 tax fail-closed precedent**: the error must **name the offending ingredient line** (item + units) so staff/owner can fix it, mirroring how unresolvable tax fails closed naming the item. This applies identically on the kiosk quote, the displayed `computed_price`, and the pos-recipe sale path.

### apps-script save-time validation (scope)
- **D-03:** **In scope for this phase.** Add unit validation/normalization to `apps-script` `createRecipe`/`updateRecipe` so an un-convertible unit/rate mismatch (a per-kg item saved with a raw-gram quantity, or a tablet counted as `L`) is **caught or auto-normalized to the item's unit at write time**, closing the loop end-to-end rather than only fixing the read/compute path.

### Interim mitigation
- **D-04:** **Leave `SV-R-000004` as `draft`** (its current state) — no interim data edits. Draft recipes can't be sold, so the exposure is contained; the fix will recompute it to ~$88–95. Do NOT set `locked_price` or hand-edit BrewPad line units as a workaround.

### Claude's Discretion
- Exact home/signature of the shared helper (`ingredientLineCost(item, line)` in `lib/recipe-scaling.js` is the strong candidate — it already sums recipe cost) and the conversion table structure — planner/executor decide, provided all sum-sites call the one helper.
- Whether save-time validation (D-03) **rejects** vs **auto-normalizes** per case — executor's judgment, but it must never let an un-priceable recipe be saved as sellable.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 73 bug diagnosis (authoritative)
- `.planning/phases/73-recipe-dynamic-pricing-unit-conversion-correctness-unit-awar/73-PRICING-BUG-HANDOFF.md` — full symptom, root causes A + B, per-line evidence table for `SV-R-000004`, suggested fix, tests, and acceptance criteria. **The spec for this phase.**

### Money-path fail-closed precedent to mirror
- `.planning/phases/67-kiosk-tax-quote-charge-correctness-pre-charge-total-assertio/` — Phase 67 established the fail-closed-and-name-the-item pattern (quote==charge, no silent fallback). D-02 mirrors it. See its SUMMARY/VERIFICATION for the pattern.

### Project rules
- `CLAUDE.md` — money-path rules: write regression test FIRST (rule #3), one logical change per commit (#4), after changing shared utilities run FULL frontend + middleware suites (#7), `cd zoho-middleware` for middleware commands (#13).

*(No external ADRs; requirements fully captured in the handoff + decisions above.)*
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `zoho-middleware/lib/recipe-scaling.js` — already sums recipe ingredient cost + fees (`total += service_fee + materials_fee`, ~L148). **Strong candidate home** for the shared unit-aware `ingredientLineCost(item, line)` helper.

### Sum-sites that must all call the shared helper (code-confirmed 2026-08-25)
- `zoho-middleware/routes/recipes.js` — `computed_price` for list + detail (accumulates `total` then adds fees, ~L122–124 and ~L199–201).
- `zoho-middleware/routes/pos-recipe.js` — the pos-recipe **sale** path building Zoho invoice lines + stock draw-down (`line_total: scaledQty * rate`, ~L478; fees ~L671–672/L728).
- `GET /api/kiosk/recipe-quote` — the kiosk quote path (per handoff; confirm exact location in `routes/pos-recipe.js` / `routes/recipes.js` during planning).
- Stock draw-down must use the **same converted quantity** (12 g hop → 0.012 kg decrement, not 12 kg).

### Established Patterns
- Fail-closed money-path validation naming the offending item (Phase 67 tax pre-charge assertion) — reuse the shape for D-02.
- Recipes live in the Google Sheet via `apps-script/`; `/api/recipes` reports `source: apps-script/cache`; per-ingredient `rate`/`computed_price` enrichment is joined in the middleware.

### Integration Points
- Zoho item `unit`/`rate` join is where the conversion must happen (before `rate × quantity`).
- `apps-script` `createRecipe`/`updateRecipe` — new save-time unit validation (D-03).
</code_context>

<specifics>
## Specific Ideas

- Regression targets are pinned in the handoff: helper unit cases ($54/kg × 12 g → 0.648; $25/L × 20 ml → 0.50; $10/pcs × 2 pcs → 20; incompatible pair → error, not a silent product); `SV-R-000004` `computed_price` ≈ $88–95; kiosk `recipe-quote` total == the Zoho invoice lines the pos-recipe sale produces for the same recipe/scale; stock draw-down uses converted quantities.
- Unit families: mass `g↔kg` (÷/×1000), volume `ml↔L` (÷/×1000), count `pcs/ea/pack` (no conversion). Anything cross-family = non-convertible → fail closed (D-02).
</specifics>

<deferred>
## Deferred Ideas

- **Catalog-wide Zoho unit normalization** — hop/additive units are inconsistent across the catalog (some 100 g packs are `pcs`, some `g`, bulk is `kg`, one tablet pack is `pcs`). Normalizing reduces this whole bug class but is a broader data-hygiene effort; owner data action, not this code phase.
- **SafLager sale-price confirmation** — owner to confirm intended retail per sachet in Zoho; the "too cheap yeast" is catalog pricing, not the engine.

### Reviewed Todos (not folded)
- "Correct the bad (negative) price row in the Kits sheet — retail_instore" — pricing-*data* bug in the Kits sheet, not the recipe unit-conversion *engine*; adjacent but separate. Left in backlog.
- The other 11 todo.match-phase hits (kiosk cash/MOTO, BrewPad bottled-refresh, GTM/analytics, gated-deploy, beer-waitlist cleanup, etc.) scored a flat generic 0.6 and are unrelated to recipe pricing — not folded.
</deferred>

---

*Phase: 73-recipe-dynamic-pricing-unit-conversion-correctness-unit-awar*
*Context gathered: 2026-08-25*
