# Requirements: v4.3 Recipe Builder Refinement

**Milestone goal:** Make recipes scalable and adjustable at the point of selection across admin, kiosk, and BrewPad — and make the recipe builder/manager available in BrewPad — without weakening the server-authoritative money path hardened in v4.2.

**Source:** User feature request (2026-06-19) + recipe-architecture map (admin.js / kiosk.js / brewpad.js / routes/recipes.js / routes/pos-recipe.js / lib/pricing.js / apps-script adminApi.gs).

**Kickoff design decisions:**
- **Locked-price scaling:** scale the ingredient-cost portion proportionally; service/materials fees stay fixed. Dynamic recipes price from scaled ingredient costs.
- **Batch size input:** target volume in litres; scale factor = target ÷ recipe `batch_size_l`.
- **Substitution output:** one-off modified sale/batch (saved recipe untouched) **plus** optional "save as new recipe".
- **Grouping dimension:** `cf_type` (Grain/Hops/Yeast/Additive/Packaging/…), enriched server-side.

---

## v4.3 Requirements

### Ingredient Display (RDISP)

- [ ] **RDISP-01**: In the admin recipe viewing page, ingredients are grouped into labelled sections by `cf_type` (e.g. Grain, Hops, Yeast, Additive, Packaging) and ordered consistently within each group.
- [ ] **RDISP-02**: Recipe ingredient data is enriched server-side with each ingredient's `cf_type` (and `cf_subcategory` where present) so admin, kiosk, and BrewPad can group ingredients identically from one source of truth.
- [ ] **RDISP-03**: The kiosk and BrewPad recipe ingredient views present ingredients grouped by `cf_type`, matching the admin grouping.

### Batch Scaling (SCALE)

- [ ] **SCALE-01**: After a recipe is selected, staff can set a target batch volume in litres; the system derives and displays the scale factor relative to the recipe's base `batch_size_l`.
- [ ] **SCALE-02**: Scaling linearly adjusts weight-based ingredient quantities (kg/g) and rounds **up** discrete (pcs/unit) ingredient quantities to whole units.
- [ ] **SCALE-03**: Scaled quantities are priced server-authoritatively — dynamic recipes price from scaled ingredient costs (+ fixed fees); locked recipes scale the ingredient-cost portion proportionally while service/materials fees stay fixed.
- [ ] **SCALE-04**: The Zoho invoice line items and the frozen `recipe_snapshot` reflect the scaled ingredient quantities and the chosen target volume.
- [ ] **SCALE-05**: Ingredient availability/stock checks reflect the scaled quantities (a scaled batch that exceeds stock is surfaced before sale).

### Cross-Surface Selection (SEL)

- [ ] **SEL-01**: Batch size (target volume) can be chosen wherever a recipe is selected — admin recipe sale, kiosk recipe sale, and BrewPad recipe attach — using a consistent control.
- [ ] **SEL-02**: The chosen batch size persists through the selected surface's flow into the sale/batch (cart line items, snapshot, and batch record) without the user re-entering it.

### Recipe Modification (MOD)

- [ ] **MOD-01**: At recipe-selection time, staff can add, remove, or substitute ingredients for a one-off modified sale/batch without altering the saved recipe template.
- [ ] **MOD-02**: Modified ingredient lists are priced server-authoritatively and captured in the Zoho invoice line items and the frozen `recipe_snapshot`.
- [ ] **MOD-03**: A one-off modified selection can optionally be saved as a new recipe (`SV-R-…`) via the existing recipe-create path, respecting activation guardrails.

### BrewPad Recipe Manager (BPR)

- [ ] **BPR-01**: Staff can browse and view the recipe catalogue from within BrewPad (not only attach a recipe to a batch).
- [ ] **BPR-02**: Staff can create and edit recipes from within BrewPad, reusing the existing recipe CRUD endpoints and activation guardrails (`locked_price > 0` and ≥1 ingredient before activation).

---

## Future Requirements (deferred to a later milestone)

- Per-ingredient scaling overrides (non-linear adjustments for ingredients that don't scale linearly, e.g. yeast pitch rates).
- Customer-facing recipe scaling / self-serve recipe configuration (staff-only for now).
- Unit conversion between volume and weight (kg ↔ L) for ingredients defined in mismatched units.
- Recipe versioning / history of edits to saved recipes.

## Out of Scope (this milestone)

- Changes to the wine-kit (single-SKU) purchase path — this milestone is recipe-based products only.
- Online (non-kiosk) checkout for recipe products — recipe sales remain kiosk/in-store + BrewPad.
- Reworking the locked-vs-dynamic pricing model itself — v4.3 extends it with scaling, it does not replace it.
- New payment-path infrastructure — v4.3 must reuse the server-authoritative pricing/charge path hardened in v4.2, not add a parallel one.

---

## Traceability

_(Filled by the roadmapper — every REQ-ID maps to exactly one phase.)_

| REQ-ID | Phase | Status |
|--------|-------|--------|
| RDISP-01 | TBD | Pending |
| RDISP-02 | TBD | Pending |
| RDISP-03 | TBD | Pending |
| SCALE-01 | TBD | Pending |
| SCALE-02 | TBD | Pending |
| SCALE-03 | TBD | Pending |
| SCALE-04 | TBD | Pending |
| SCALE-05 | TBD | Pending |
| SEL-01 | TBD | Pending |
| SEL-02 | TBD | Pending |
| MOD-01 | TBD | Pending |
| MOD-02 | TBD | Pending |
| MOD-03 | TBD | Pending |
| BPR-01 | TBD | Pending |
| BPR-02 | TBD | Pending |
