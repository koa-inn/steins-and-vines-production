---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: Recipe-Based Products
status: executing
stopped_at: Phase 13 context gathered
last_updated: "2026-05-16T17:21:45.528Z"
last_activity: 2026-05-16
progress:
  total_phases: 11
  completed_phases: 1
  total_plans: 2
  completed_plans: 2
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-09)

**Core value:** Customers can discover, select, or co-create fermentation recipes and purchase them as a complete package — with ingredient inventory, pricing, and batch tracking handled automatically by the system.
**Current focus:** Phase 12 — recipe-data-foundation

## Current Position

Phase: 13
Plan: Not started
Status: Executing Phase 12
Last activity: 2026-05-16

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**

- Total plans completed: 2 (this milestone)
- Average duration: — min
- Total execution time: — min

## Accumulated Context

### Decisions

- [v2.0 Roadmap]: Recipes stored in Google Sheets "Recipes" tab, not Zoho composite items — composite items do not auto-deduct components via REST API invoice path
- [v2.0 Roadmap]: locked_price on recipe record set explicitly by staff — never computed at runtime from live Zoho ingredient rates to avoid pricing drift
- [v2.0 Roadmap]: recipe_snapshot JSON serialized to Batches sheet at sale time — immune to future recipe edits; unretrofit-able, must be in schema before first sale
- [v2.0 Roadmap]: BEER_SALES_ENABLED env var gates kiosk confirm endpoint server-side — UI hiding alone is insufficient; env var managed on Railway, defaults false
- [v2.0 Roadmap]: detectRecipeSale() separate from detectKitItems() — recipe sales must not trigger one batch per ingredient line item
- [v2.0 Roadmap]: BeerXML import (Phase 15) deferred after core kiosk flow (Phase 14) — manual recipe entry unblocks kiosk testing without import

### Pending Todos

None.

### Blockers/Concerns

- Federal brewing licence pending — BEER_SALES_ENABLED must remain false in Railway production until licence granted; public recipe browsing (informational) can go live earlier
- Tax treatment for brewing service fee vs. ingredient sales under BC ferment-in-store model needs confirmation before first live recipe sale
- Redis reservation mechanism for multi-ingredient inventory (Lua script vs MULTI/EXEC vs recipe-sale mutex) — design decision required at Phase 14 planning time

## Session Continuity

Last session: 2026-05-16T17:21:45.518Z
Stopped at: Phase 13 context gathered
Resume file: .planning/phases/13-middleware-api-admin-recipe-management/13-CONTEXT.md
