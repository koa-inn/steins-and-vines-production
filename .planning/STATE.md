---
gsd_state_version: 1.0
milestone: v4.3
milestone_name: Recipe Builder Refinement
status: executing
stopped_at: 36-05 complete
last_updated: "2026-06-22T20:21:05.056Z"
last_activity: 2026-06-22
progress:
  total_phases: 23
  completed_phases: 3
  total_plans: 24
  completed_plans: 19
  percent: 13
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-19)

**Core value:** Customers can discover, select, or co-create fermentation recipes and purchase them as a complete package — with ingredient inventory, pricing, and batch tracking handled automatically by the system.
**Current focus:** Phase 36 — cross-surface-selection-recipe-modification

## Current Position

Phase: 36 (cross-surface-selection-recipe-modification) — EXECUTING
Plan: 7 of 7
Status: Ready to execute
Last activity: 2026-06-22

Progress: [████████░░] 79%

## Performance Metrics

**Velocity:**

- Total plans completed: 47 (prior milestone v4.1) + 11 (v4.2)
- Average duration: 3 min
- Total execution time: ~3 hrs

## Accumulated Context

### Decisions

- [v4.3 Roadmap]: Phase 34 (server enrichment) must ship before Phase 35 (scaling) — `cf_type` unit field drives weight-vs-pcs rounding logic
- [v4.3 Roadmap]: Phase 37 (BrewPad Recipe Manager) depends only on Phase 34, not 35/36 — it is independent of the money path and can be sequenced separately if needed
- [v4.3 Roadmap]: SCALE-03/04 and MOD-02 must flow through `pos-recipe.js` / `lib/pricing.js` — never client-trusted pricing
- [v4.3 Roadmap]: Scale factor = target_volume_l ÷ recipe.batch_size_l; linear for weight (kg/g), Math.ceil for pcs/unit
- [v4.3 Roadmap]: Locked-price recipes scale ingredient-cost portion proportionally; service/materials fees stay fixed; dynamic recipes price from scaled ingredient costs
- [v4.3 Roadmap]: Apps Script schema changes (if any in Phase 35/37) require manual redeploy — flag as human-action checkpoint in plans
- [v4.2 Roadmap]: No separate staging middleware — middleware changes deploy to the prod Railway instance; staging site calls prod middleware
- [Phase ?]: D-06 global fee-inclusive: locked recipes now charge locked_price * scale_factor + service_fee + materials_fee at ALL scale factors (even 1x)
- [Phase ?]: SCALE-04: recipe_snapshot now contains scaledIngredients + target_volume_l + scale_factor, enabling batch creation from scaled sale data
- [35-06]: Server-quote approach chosen — client fetches /api/kiosk/recipe-quote (dry-run) to guarantee displayed price === charged price with no client-side drift
- [Phase ?]: 36-01 complete
- [36-02]: detectRecipeSale now forwards target_volume_l + scale_factor onto batch payload from server-built snapshot (T-36-04 mitigated)
- [36-03]: computeRecipeQuote extended with modifiedIngredients 5th param; all three money-path entry points (quote/sale/confirm) price via computeModifiedRecipeTotal; confirm snapshot freezes modified_base_ingredients + is_modified (MOD-02)
- [Phase ?]: No save-as-new affordance on kiosk surface — UI-SPEC §2 confirmed (36-05)

### Pending Todos

None.

### Blockers/Concerns

- Federal brewing licence pending — BEER_SALES_ENABLED must remain false in Railway production
- Apps Script changes require manual redeploy (not in CI) — plan authors must flag this
- 36-02 BLOCKED: Apps Script create_batch handler must accept + persist target_volume_l and scale_factor; manual redeploy needed before SEL-02 is fully closed

## Session Continuity

Last session: 2026-06-22T20:21:05.050Z
Stopped at: 36-05 complete
Resume file: None
