---
gsd_state_version: 1.0
milestone: v4.3
milestone_name: Recipe Builder Refinement
status: executing
stopped_at: Phase 34 context gathered
last_updated: "2026-06-20T04:15:24.629Z"
last_activity: 2026-06-20 -- Phase 37 execution started
progress:
  total_phases: 23
  completed_phases: 1
  total_plans: 6
  completed_plans: 3
  percent: 4
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-19)

**Core value:** Customers can discover, select, or co-create fermentation recipes and purchase them as a complete package — with ingredient inventory, pricing, and batch tracking handled automatically by the system.
**Current focus:** Phase 37 — brewpad-recipe-manager

## Current Position

Phase: 37 (brewpad-recipe-manager) — EXECUTING
Plan: 1 of 3
Status: Executing Phase 37
Last activity: 2026-06-20 -- Phase 37 execution started

Progress: [░░░░░░░░░░] 0% (v4.3)

## Performance Metrics

**Velocity:**

- Total plans completed: 38 (prior milestone v4.1) + 11 (v4.2)
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

### Pending Todos

None.

### Blockers/Concerns

- Federal brewing licence pending — BEER_SALES_ENABLED must remain false in Railway production
- Apps Script changes require manual redeploy (not in CI) — plan authors must flag this

## Session Continuity

Last session: 2026-06-20T03:01:55.782Z
Stopped at: Phase 34 context gathered
Resume file: None
