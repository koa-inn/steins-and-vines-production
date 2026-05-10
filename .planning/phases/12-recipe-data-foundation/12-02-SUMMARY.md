---
phase: 12-recipe-data-foundation
plan: "02"
subsystem: constants, apps-script
status: checkpoint
tags:
  - constants
  - feature-flag
  - redis
  - apps-script
  - schema
dependency_graph:
  requires:
    - 12-01 (Recipes and RecipeIngredients sheet structure created by setupRecipeTabs)
  provides:
    - BEER_SALES_ENABLED optional env var (consumed by Phase 14 kiosk confirm endpoint)
    - CACHE_KEYS.RECIPES and CACHE_KEYS.RECIPES_TS (consumed by Phase 13 recipe catalog route)
    - ITEM_TYPES.RECIPE (consumed by Phase 13 frontend product routing)
    - Batches sheet recipe_id and recipe_snapshot columns (consumed by Phase 14 kiosk sale batch creation)
  affects:
    - zoho-middleware/lib/validateEnv.js (startup env var logging)
    - zoho-middleware/lib/constants.js (CACHE_KEYS object)
    - js/lib/constants.js (ITEM_TYPES object)
    - apps-script/adminApi.gs (createBatch, setupRecipeTabs)
tech_stack:
  added: []
  patterns:
    - "Header-lookup pattern for optional Google Sheets columns (avoids positional coupling)"
    - "sv: Redis key prefix (vs zoho:) denoting Google Sheets sourced data"
key_files:
  created: []
  modified:
    - zoho-middleware/lib/validateEnv.js
    - zoho-middleware/lib/constants.js
    - js/lib/constants.js
    - apps-script/adminApi.gs
decisions:
  - "CACHE_KEYS.RECIPES uses sv: prefix (not zoho:) because recipe data comes from Google Sheets, not Zoho — prefix indicates data source"
  - "recipe_snapshot bypasses sanitizeInput in createBatch — it is server-generated JSON (T-12-09 disposition: mitigate by not allowing client to supply it)"
  - "Header-lookup used for recipe_id/recipe_snapshot in createBatch — keeps the 24-column appendRow stable, avoids positional coupling"
metrics:
  duration_min: 2
  completed_date: "2026-05-10"
  tasks_completed: 2
  tasks_total: 3
  files_modified: 4
---

# Phase 12 Plan 02: Infrastructure Scaffolding for Recipe Data Foundation Summary

Feature flag, Redis cache keys, frontend type constant, and Batches sheet schema extension for recipe-based product support.

## What Was Built

### Task 1: Constants and feature flag (commit 6b407b0)

- **`zoho-middleware/lib/validateEnv.js`**: Added `BEER_SALES_ENABLED` to the OPTIONAL env var list. This gates kiosk recipe sales and public recipe visibility server-side per D-08. Absence = false (same pattern as `INVENTORY_LEDGER_ENABLED`).
- **`zoho-middleware/lib/constants.js`**: Added `CACHE_KEYS.RECIPES = 'sv:recipes'` and `CACHE_KEYS.RECIPES_TS = 'sv:recipes:ts'`. The `sv:` prefix (not `zoho:`) denotes Google Sheets sourced data, matching the naming convention for data source origin.
- **`js/lib/constants.js`**: Added `ITEM_TYPES.RECIPE = 'recipe'` to the ITEM_TYPES object. Added trailing comma to `KIT_PURCHASE` entry. Downstream phases use this to route recipe products to the correct cart and display logic.

### Task 2: Batches sheet schema extension (commit 62bbe0b)

- **`apps-script/adminApi.gs` — `createBatch()`**: Added header-lookup block after the existing `customer_firstname`/`customer_lastname` lookup. Writes `recipe_id` (via `sanitizeInput`) and `recipe_snapshot` (raw, bypassing sanitizeInput per T-12-09) to the batch row when the payload includes them. The 24-column `appendRow` is unchanged — no positional coupling introduced.
- **`apps-script/adminApi.gs` — `setupRecipeTabs()`**: Extended to add `recipe_id` and `recipe_snapshot` header columns to the existing Batches tab if not already present. Idempotent — repeated runs skip already-existing columns. Both headers set bold. Logs action taken.
- **`getBatchDetail()`**: No code change needed — `sheetToObjects(BATCHES_SHEET_NAME)` already reads all columns, so new headers are automatically included in responses.

## Checkpoint Status

**Task 3 (human-verify) awaiting user action.** The user must:

1. Copy-paste the updated `apps-script/adminApi.gs` into the Google Apps Script editor
2. Run `setupRecipeTabs` to create the sheet structure and add Batches columns
3. Verify the Recipes tab (16 columns), RecipeIngredients tab (6 columns), and Batches tab (recipe_id + recipe_snapshot columns added)
4. Run a manual `createRecipe` test and verify the row is created correctly
5. Confirm `MAKERS_FEE_ITEM_ID` and `MATERIALS_FEE_ITEM_ID` are set in Railway env vars (per D-03, recipe sales reuse these existing fee items)
6. Set `BEER_SALES_ENABLED=false` in Railway env vars if not already set

## Deviations from Plan

None — plan executed exactly as written.

## Threat Surface Scan

No new network endpoints or trust boundaries introduced in this plan. All changes are constants, env var registration, and Apps Script column writes that follow established patterns. The threat model entries T-12-07 through T-12-10 from the plan are fully addressed:

- T-12-07 (BEER_SALES_ENABLED bypass): env var registered; server-side enforcement deferred to Phase 14
- T-12-08 (recipe_snapshot in Batches): accepted — staff-visible operational data, no PII
- T-12-09 (recipe_snapshot integrity): mitigated — bypasses sanitizeInput, written from trusted server payload only
- T-12-10 (CACHE_KEYS.RECIPES DoS): accepted — follows existing Redis cache patterns with TTL

## Known Stubs

None. This plan adds constants and schema scaffolding only. No UI rendering or data wiring that could leave a visual stub.

## Self-Check

### Files exist:
- zoho-middleware/lib/validateEnv.js: modified (contains BEER_SALES_ENABLED)
- zoho-middleware/lib/constants.js: modified (contains CACHE_KEYS.RECIPES)
- js/lib/constants.js: modified (contains ITEM_TYPES.RECIPE)
- apps-script/adminApi.gs: modified (contains recipe_id/recipe_snapshot header-lookup)

### Commits exist:
- 6b407b0: feat(12-02): add BEER_SALES_ENABLED, CACHE_KEYS.RECIPES, ITEM_TYPES.RECIPE
- 62bbe0b: feat(12-02): extend Batches schema for recipe_id and recipe_snapshot

### Tests:
- npm run lint: 0 errors, 78 warnings (pre-existing warnings, not introduced by this plan)
- npm test (frontend): 348 passed, 0 failed
- cd zoho-middleware && npm test: 469 passed, 0 failed

## Self-Check: PASSED
