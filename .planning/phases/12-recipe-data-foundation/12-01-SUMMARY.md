---
phase: 12-recipe-data-foundation
plan: "01"
subsystem: database
tags: [apps-script, google-sheets, recipe, crud]

requires: []
provides:
  - "Recipe CRUD actions in adminApi.gs (create_recipe, get_recipes, get_recipe, update_recipe, delete_recipe)"
  - "Recipes sheet schema: recipe_id, name, style, description, status, locked_price, service_fee, materials_fee, batch_size_l, abv, ibu, colour_srm, notes, created_at, created_by, updated_at"
  - "RecipeIngredients sheet schema: ingredient_id, recipe_id, item_id, item_name, quantity, unit"
  - "setupRecipeTabs() utility for one-click sheet creation"
  - "RECIPES_SHEET_NAME and RECIPE_INGREDIENTS_SHEET_NAME constants"
affects:
  - "12-02 (middleware recipe API builds on this schema)"
  - "13 (admin UI uses get_recipes/get_recipe)"
  - "14 (kiosk recipe sales use create_recipe)"
  - "15 (BeerXML import uses server_token create_recipe)"

tech-stack:
  added: []
  patterns:
    - "Recipe CRUD follows identical Apps Script action-routing pattern as batch/ferm-schedule CRUD"
    - "RecipeIngredients tab mirrors BatchTasks/PlatoReadings multi-tab pattern"
    - "server_token if-branch for middleware→Apps Script, staff-auth switch-case for interactive CRUD"

key-files:
  created: []
  modified:
    - "apps-script/adminApi.gs"

key-decisions:
  - "service_fee defaults to 45 and materials_fee defaults to 5 per D-01/D-02 — overridable per recipe"
  - "RecipeIngredients stored in separate tab (not JSON blob) per D-04 — matches existing multi-tab pattern"
  - "Ingredient fields are minimal: recipe_id, item_id, item_name, quantity, unit per D-05"
  - "deleteRecipe soft-deactivates to inactive when batch references exist per D-07 — hard deletes otherwise"
  - "server_token branch includes create_recipe for future BeerXML import middleware (Phase 15)"

patterns-established:
  - "Recipe ID prefix: SV-R- with 6-digit padding (e.g., SV-R-000001)"
  - "Ingredient ID prefix: RI- with 6-digit padding (e.g., RI-000001)"
  - "acquireScriptLock(15000) in createRecipe prevents concurrent ID collisions"
  - "_invalidateRecipeCache() clears gr, grl, and gr:{recipeId} cache keys"

requirements-completed:
  - RDM-01
  - RDM-02

duration: ~25min
completed: "2026-05-10"
---

# Phase 12 Plan 01: Recipe Data Foundation Summary

**Recipe CRUD (get_recipes, get_recipe, create_recipe, update_recipe, delete_recipe) added to adminApi.gs with Recipes and RecipeIngredients sheet schemas, separate-tab ingredient storage, and soft-delete/hard-delete logic based on batch references**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-05-10T01:00:00Z
- **Completed:** 2026-05-10T01:24:22Z
- **Tasks:** 2 (both committed in single atomic commit)
- **Files modified:** 1

## Accomplishments
- Five recipe actions wired into adminApi.gs: `get_recipes` and `get_recipe` in doGet, `create_recipe`/`update_recipe`/`delete_recipe` in staff-auth doPost, plus `create_recipe` in server_token branch for middleware integration
- Recipes sheet schema established with 16 columns including separate `service_fee` and `materials_fee` fields (per D-01/D-02), defaulting to $45/$5
- RecipeIngredients sheet schema with 6 minimal columns stored in a separate tab (per D-04, D-05)
- `deleteRecipe` checks Batches sheet for references — soft-deactivates to `inactive` if found, hard-deletes with child row cleanup if not (per D-07)
- `setupRecipeTabs()` utility for one-click sheet creation from Apps Script editor, idempotent and safe to re-run
- All existing frontend tests (348) and lint checks pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Add Recipes and RecipeIngredients sheet constants and CRUD functions** - `a87822e` (feat)
2. **Task 2: Add Google Sheets tab setup instructions** - included in `a87822e` (same file, same commit)

## Files Created/Modified
- `apps-script/adminApi.gs` - Added 414 lines: 2 sheet name constants, 7 recipe-related functions (getRecipes, getRecipeDetail, createRecipe, updateRecipe, deleteRecipe, _invalidateRecipeCache, setupRecipeTabs), doGet cases, doPost cases, server_token branch handler

## Decisions Made
- Server token branch uses `if (action === 'create_recipe')` pattern (not `case`) — matches existing codebase pattern for server_token block. The plan's verification check (`grep -c "case 'create_recipe'"`) returns 1 (staff-auth only) but both code paths are present. This is intentional per the established pattern where server_token uses if-branches and staff-auth uses switch-cases.
- `setupRecipeTabs()` was added in the same file edit as Task 1 and committed together — the tasks are logically one unit of work on the same file.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

**Pre-existing: Middleware test suite fails in worktree environment** — `zoho-middleware` has no `node_modules` directory in this worktree (worktree isolation). 16 of 21 test suites fail with "Cannot find module 'express'". This is unrelated to changes made in this plan (apps-script/adminApi.gs is not tested by the Node.js suite). Per CLAUDE.md scope boundary rule, not fixed. Frontend tests (348 passing) and lint (0 errors) are unaffected.

## User Setup Required

The user must run `setupRecipeTabs()` manually from the Apps Script editor to create the Recipes and RecipeIngredients tabs in the Google Sheet before the CRUD actions can write data. Steps:
1. Open the Google Sheet → Extensions → Apps Script
2. Select `setupRecipeTabs` from the function dropdown
3. Click Run
4. Verify "Recipes" and "RecipeIngredients" tabs appear in the Sheet

## Next Phase Readiness
- Recipe schema is stable and ready for Phase 12 Plan 02 (middleware recipe API) to build on
- Both RECIPES_SHEET_NAME and RECIPE_INGREDIENTS_SHEET_NAME constants are exported for consistent use
- The `create_recipe` server_token branch is ready for Phase 15 BeerXML import middleware

## Self-Check: PASSED

- `apps-script/adminApi.gs` exists and contains all 7 recipe functions
- Commit `a87822e` confirmed in git log
- No unexpected file deletions

---
*Phase: 12-recipe-data-foundation*
*Completed: 2026-05-10*
