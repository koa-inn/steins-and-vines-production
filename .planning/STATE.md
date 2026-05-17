---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: Recipe-Based Products
status: executing
stopped_at: "Phase 14 Plan 05 Task 1 complete — checkpoint:human-verify awaiting staging sign-off"
last_updated: "2026-05-17T22:26:10.788Z"
last_activity: 2026-05-17
progress:
  total_phases: 11
  completed_phases: 4
  total_plans: 13
  completed_plans: 13
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-09)

**Core value:** Customers can discover, select, or co-create fermentation recipes and purchase them as a complete package — with ingredient inventory, pricing, and batch tracking handled automatically by the system.
**Current focus:** Phase 15 — beerxml-import

## Current Position

Phase: 15
Plan: Not started
Status: Executing Phase 15
Last activity: 2026-05-17

Progress: [######░░░░] 60%

## Performance Metrics

**Velocity:**

- Total plans completed: 12 (this milestone)
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
- [13-01]: CR-01 lock placement — validation guard stays above lock to avoid unnecessary lock contention on invalid input
- [13-01]: _invalidateRecipeCache clears status-variant keys (all/draft/active/inactive at :0:0) covering default admin UI queries
- [13-01]: Server-token block passes 'middleware' as userEmail, matching existing create_recipe pattern
- [13-02]: Availability returns 'unknown' when ingredient cache is cold rather than triggering blocking Zoho refresh
- [13-02]: bustRecipeCache clears all 4 status-variant list keys at default pagination (:0:0)
- [13-02]: Method+path composite key in test mocks to avoid handler collision on shared path patterns
- [13-03]: Recipes tab placed after Batches in tab order (operational flow: recipe -> sale -> batch)
- [13-03]: initRecipesControls called only from initRecipesTab (no DOMContentLoaded) to prevent double event listener binding
- [14-01]: detectRecipeSale uses source 'kiosk_recipe' not 'kiosk' — distinguishes recipe batches from kit batches in BrewPad
- [14-01]: LOCK_KEYS object added as sibling to CACHE_KEYS in constants.js for centralized mutex key management
- [14-01]: detectRecipeSale .catch(()=>{}) fire-and-forget — Apps Script failure after payment is silent per D-12
- [14-02]: pos-recipe.js is a standalone route file — not modifying pos.js avoids branching in complex handler
- [14-02]: Terminal charge = sum of ingredient Zoho catalog rates + applicable fees (not locked_price per D-08 resolution)
- [14-02]: detectRecipeSale called only for in-store sales (take-out creates no batch per D-09)
- [14-02]: RECIPES_TS cache also busted after sale to ensure freshness of recipe availability data
- [14-03]: Recipe cart items use rate=0 display-only — server recomputes all rates at confirm (T-14-11 accept)
- [14-03]: _kioskCart._recipeContext sentinel detects recipe sales in checkout — avoids modifying existing product flow
- [14-03]: Recipe 202 pending handled by calling /confirm immediately — admin.js kiosk is staff-facing, no polling needed
- [14-03]: milling toggle shown only for take-out (D-03) — JS enforces visibility, server enforces logic

### Pending Todos

None.

### Blockers/Concerns

- Federal brewing licence pending — BEER_SALES_ENABLED must remain false in Railway production until licence granted; public recipe browsing (informational) can go live earlier
- Tax treatment for brewing service fee vs. ingredient sales under BC ferment-in-store model needs confirmation before first live recipe sale
- Redis reservation mechanism for multi-ingredient inventory — RESOLVED: simple mutex via cache.acquireLock('recipe-sale', 30) per D-04; one recipe sale at a time fits single-kiosk reality

## Session Continuity

Last session: 2026-05-17T18:43:00Z
Stopped at: Phase 14 Plan 05 Task 1 complete — checkpoint:human-verify awaiting staging sign-off
Resume file: .planning/phases/14-kiosk-recipe-sales-inventory-batch-creation/14-05-PLAN.md
