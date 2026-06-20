# Phase 35: Batch Scaling Engine - Context

**Gathered:** 2026-06-20
**Status:** Ready for planning

<domain>
## Phase Boundary

After a recipe is selected on the **admin** recipe-selection surface, staff can enter a target batch volume in litres. The system computes the scale factor relative to the recipe's base `batch_size_l`, scales every ingredient quantity (linear for weight, round-up for discrete), re-prices the recipe **server-authoritatively**, and freezes the scaled quantities + target volume into the Zoho invoice line items and the `recipe_snapshot`. A stock check against the **scaled** quantities surfaces oversells before the sale can confirm.

**In scope:** admin surface only; scaling math; server-authoritative re-pricing (locked + dynamic); scaled quantities in invoice + `recipe_snapshot`; scaled-quantity stock check with hard-block + manager override.

**Out of scope (Phase 36):** exposing the batch-size control on the kiosk and BrewPad recipe-attach surfaces (cross-surface), and one-off ingredient add/remove/substitute. The Phase 35 server endpoint should be written surface-agnostic so Phase 36 can reuse it, but only the admin UI is wired this phase.
</domain>

<decisions>
## Implementation Decisions

### Unit classification & rounding (SCALE-02)
- **D-01:** Classify scaling behavior **by the ingredient's unit string**. Continuous units (`kg`, `g`, `l`, `ml`) scale **linearly**; discrete units (`pcs`, `each`, `unit`, `pkg` and similar) **round up** to whole units. No new catalog fields required — uses unit data already present.
- **D-02:** Discrete rounding is **ceil with a floor of 1** — `Math.max(1, Math.ceil(scaledQty))`. So `2.3 → 3`, and scaling **down** (factor < 1) never drops an essential single-packet item to 0 (e.g. 0.5× of a 1-packet yeast stays 1).
- **D-03:** Unknown/blank units default to **linear (continuous)** scaling (Claude's discretion — see below). The researcher MUST enumerate the actual `unit` values present in the live ingredient catalog so the planner can finalize the exact discrete-unit token list (D-01) against real data.

### Locked-price scaling (SCALE-03)
- **D-04:** Locked-price recipe pricing formula: **`price = locked_price × scale_factor + service_fee + materials_fee`**. The `locked_price` IS the scalable ingredient/recipe portion; `service_fee` and `materials_fee` are **fixed dollar add-ons** that do not scale.
- **D-05:** This model is applied **globally** — base (1×) sales AND scaled sales use the same formula, so there is no price discontinuity between 1× and a slightly-scaled batch.
- **D-06:** ⚠ **BEHAVIOR CHANGE — verify before implementing.** The middleware *today* charges locked recipes a **flat `locked_price` with no fees added** (only dynamic recipes add service+materials — see `pos-recipe.js` line ~97 vs ~108-118). D-04/D-05 change this: locked recipes will now be charged `locked_price + fees`, which **changes the price of existing locked recipes**. The researcher MUST confirm the exact current locked-recipe pricing in `pos-recipe.js` (both the `/recipe-sale` quote path and the `/recipe-sale/confirm` invoice path) before planning, and the planner must treat "locked pricing now includes fees" as an intended, owner-approved change (surface it in UAT so staff are aware existing locked prices shift).
- **D-07:** Dynamic-price recipes follow SCALE-03 as written: `price = Σ(scaled_qty × catalog_rate) + service_fee + materials_fee`. Same fixed-fee treatment as locked; only the ingredient-cost sum scales (via the per-ingredient scaled quantities from D-01/D-02).

### Stock-conflict handling (SCALE-05)
- **D-08:** When **scaled** quantities exceed available stock, **hard-block** the sale and list the short ingredients, but provide an explicit **manager override** to proceed anyway (e.g. staff will restock before brewing). Safe default + escape hatch.
- **D-09:** The stock check compares scaled quantities against the **existing live recipe availability/stock data** — the same source the BrewPad recipe editor and recipe detail view already consume. Researcher confirms which endpoint/cache that is and whether it's re-checked at confirm time.

### Target-volume input (SCALE-01)
- **D-10:** The target-volume input **pre-fills with the recipe's base `batch_size_l`** (so factor = 1 unless changed) and accepts **free numeric entry in litres with 0.5 L steps**. Litres, not multipliers (more intuitive for staff). Display the computed factor as e.g. `1.5× base 20 L` before commit.
- **D-11:** Bounds: require **volume > 0** with a **sane maximum (~10× base)** to catch fat-finger typos (e.g. 600 L instead of 60 L) before the stock check. If a recipe has **no base `batch_size_l` set**, scaling is **disabled** with a prompt to set the base batch size first (a scale factor cannot be computed without a base) — do NOT silently assume factor 1.

### Claude's Discretion
- Unknown/blank ingredient units → linear scaling (D-03), pending the researcher's enumeration of real unit values.
- Exact discrete-unit token set (D-01) — finalize against the live catalog's actual unit strings.
- Scale-factor display string formatting and where the "Target volume (L)" input sits in the admin recipe-sale UI (within admin's existing recipe-selection layout).
- Whether the scaled-quantity stock check is also re-run server-side at `/confirm` (belt-and-suspenders) in addition to the pre-commit UI check — recommend yes if cheap.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap & requirements
- `.planning/ROADMAP.md` §"Phase 35: Batch Scaling Engine" — goal, success criteria, dependency on Phase 34.
- `.planning/REQUIREMENTS.md` — SCALE-01 … SCALE-05 (lines ~25-29) and traceability table.

### Prior phase this builds on
- `.planning/phases/34-ingredient-display-server-enrichment/34-CONTEXT.md` — `cf_type`/`cf_subcategory` enrichment + unit data now available on recipe ingredients.
- `js/lib/recipe-grouping.js` — `groupRecipeIngredients` helper (cf_type grouping; used for display, NOT for unit classification — D-01 uses the unit string).

### Server pricing & sale path (the code Phase 35 extends)
- `zoho-middleware/routes/pos-recipe.js` — `POST /api/kiosk/recipe-sale` (quote/total) and `/api/kiosk/recipe-sale/confirm` (invoice + payment). Locked vs dynamic pricing lives here; **this is where scaling + re-pricing is wired.** Verify current locked-recipe behavior here (D-06).
- `zoho-middleware/lib/pricing.js` — `computeLineItem`, `computeCartTotals`, `formatCurrency` (server-authoritative pricing primitives).
- `zoho-middleware/lib/brewpad-integration.js` — where `recipe_snapshot` is frozen; SCALE-04 requires `target_volume_l` + scaled quantities added here.
- `zoho-middleware/routes/recipes.js` — recipe detail/availability endpoints (base `batch_size_l`, ingredient list, stock/availability source for D-09).

No external specs/ADRs — requirements fully captured in ROADMAP/REQUIREMENTS + the decisions above.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `pos-recipe.js` recipe-sale + confirm handlers: already resolve the recipe, look up ingredient catalog rates, branch locked vs dynamic, build Zoho line items, and freeze a snapshot. Scaling slots into this flow — inject scale factor + scaled quantities rather than rewriting the path.
- `lib/pricing.js`: server-authoritative money math; extend/reuse for scaled totals so the client never computes price.
- Live recipe availability/stock data (consumed by BrewPad editor + recipe detail): reuse for the D-08/D-09 scaled-quantity stock check.

### Established Patterns
- **Server-authoritative pricing** is a hard project rule (see global CLAUDE.md / pricing.js) — the client may *preview* the scale factor, but the charged price and stock verdict come from the server.
- Middleware tests are mandatory (`cd zoho-middleware && npm test`) — SCALE-03 success criteria explicitly require middleware unit tests for the scaling/pricing math.
- Recipe ingredient objects carry `quantity`, `unit`, `item_id`, and (post-Phase-34) `cf_type` — D-01 keys off `unit`.

### Integration Points
- `target_volume_l` + scale factor must flow: admin UI → `recipe-sale` quote → `recipe-sale/confirm` → Zoho invoice line items (scaled qty) → frozen `recipe_snapshot`.
- Stock check hooks the existing availability data, evaluated on the scaled quantities, gating the confirm step (hard-block + manager override).
</code_context>

<specifics>
## Specific Ideas

- Scale-factor display in the style of the roadmap success criterion: `"1.5× base 20 L"`, shown after a volume is entered and before commit.
- Worked example to validate locked pricing against (Dangerous Bunny-like): `locked_price 45, service 45, materials 5` → 1.0× = `45 + 50 = $95`; 1.5× = `67.50 + 50 = $117.50` (fees flat, ingredient/locked portion scales). Use as a test fixture.
- Discrete floor-of-1 example: 0.5× of a 1-packet yeast → stays 1 packet (never 0).
</specifics>

<deferred>
## Deferred Ideas

- **Cross-surface batch-size control (kiosk + BrewPad recipe-attach)** and **carry-through into cart/batch record** — Phase 36 (SEL-01, SEL-02).
- **One-off ingredient add/remove/substitute** and **save-as-new-recipe** — Phase 36 (MOD-01..03).

None of the above were pulled into Phase 35 — discussion stayed within the scaling scope.
</deferred>

---

*Phase: 35-batch-scaling-engine*
*Context gathered: 2026-06-20*
