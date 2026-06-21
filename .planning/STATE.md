---
gsd_state_version: 1.0
milestone: v4.3
milestone_name: Recipe Builder Refinement
status: ready_to_plan
stopped_at: Phase 35 complete (6/6) — ready to discuss Phase 37
last_updated: 2026-06-21T00:31:03.185Z
last_activity: 2026-06-20
progress:
  total_phases: 23
  completed_phases: 2
  total_plans: 12
  completed_plans: 12
  percent: 9
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-19)

**Core value:** Customers can discover, select, or co-create fermentation recipes and purchase them as a complete package — with ingredient inventory, pricing, and batch tracking handled automatically by the system.
**Current focus:** Phase 37 — brewpad recipe manager

## Current Position

Phase: 37
Plan: Not started
Status: Ready to plan
Last activity: 2026-06-21

Progress: [█████████░] 92%

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

### Pending Todos

None.

### Blockers/Concerns

- Federal brewing licence pending — BEER_SALES_ENABLED must remain false in Railway production
- Apps Script changes require manual redeploy (not in CI) — plan authors must flag this

## Session Continuity

Last session: 2026-06-20T23:46:55.445Z
Stopped at: 35-06 COMPLETE — server quote endpoint + frontend wiring + 17-test suite + rebuild all done. Phase 35 awaiting deploy + UAT.
Resume file: None
