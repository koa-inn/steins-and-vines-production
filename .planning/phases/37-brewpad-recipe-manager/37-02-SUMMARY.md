---
phase: 37-brewpad-recipe-manager
plan: "02"
subsystem: frontend/brewpad
tags: [brewpad, recipes, editor, detail-view, autocomplete, guardrail, unit-tests]
dependency_graph:
  requires:
    - _recipesState / getRecipesMwHeaders / loadRecipeList (37-01)
    - groupRecipeIngredients (js/lib/recipe-grouping.js, loaded on brewpad.html L20)
    - GET /api/recipes/:id (middleware, unchanged)
    - GET /api/recipes/:id/availability (middleware, unchanged)
    - POST /api/recipes / PUT /api/recipes/:id (middleware, unchanged)
    - GET /api/ingredients?include_internal=1 (middleware, unchanged)
  provides:
    - openRecipeDetail(recipeId) — opens detail/editor for existing or new recipe
    - showRecipesListView / showRecipesDetailView — subview toggling
    - populateRecipeForm(recipe) — fills editor fields from recipe object
    - renderIngredientRows(ingredients, availability) — grouped table render
    - canActivateRecipe(formData, ingredients) — D-06 inline guardrail (exported + tested)
    - buildRecipePayload(formData, ingredients) — builds POST/PUT payload with ingredient_count (exported + tested)
    - saveRecipe() — POST (create) or PUT (update), surfaces 422 errors, refreshes list
    - addIngredientRow() — pushes blank row and focuses new search input
    - Autocomplete trio: filterIngredientCatalog, showIngredientAutocompleteBp, selectIngredientFromAutocompleteBp
    - updateActivateGuardrail() — evaluates guardrail and disables/enables Activate button
    - "#bp-recipes-detail-view" markup with full field parity (admin D-05)
  affects:
    - brewpad.html (#bp-panel-recipes expanded with list + detail subviews)
    - js/brewpad.js (recipes detail/editor section + module.exports additions)
    - tests/frontend/brewpad-recipes.test.js (17 new tests)
tech_stack:
  added: []
  patterns:
    - groupRecipeIngredients with indexOf(ing) data-ing-idx (identical to admin.js L8770-8804 pattern)
    - canActivateRecipe + buildRecipePayload at module scope for testability (same as filterRecipesByName, recipeRowPrice from Plan 01)
    - mousedown + preventDefault autocomplete selection (survives blur)
    - getRecipesMwHeaders(true) for all writes, getRecipesMwHeaders(false) for reads
    - ingredient_count in payload so server guardrail (recipes.js L399-412) can see it
    - Promise.all(detail + availability) with availability best-effort catch->null
key_files:
  created: []
  modified:
    - brewpad.html
    - js/brewpad.js
    - tests/frontend/brewpad-recipes.test.js
decisions:
  - "canActivateRecipe and buildRecipePayload placed at module scope (outside IIFE), matching filterRecipesByName pattern from Plan 01 — Jest can import them directly via module.exports"
  - "renderAvailabilityBannerBp is an internal helper (not exported) — its output is presentational and not tested; mirrors admin's renderAvailabilityBanner approach"
  - "Activate button sets recipe-status to 'active' and calls saveRecipe() — rather than a separate endpoint, keeps single save path"
  - "mousedown + e.preventDefault() on autocomplete options (not click) — identical to admin L8890-8892; survives blur on touch"
  - "BeerXML import not ported (out of scope per PATTERNS discretion note)"
  - "updateIngredientTotalsBp accepts precomputed totals from renderIngredientRows to avoid double-iteration"
metrics:
  duration: "~4 min"
  completed: "2026-06-20"
  tasks_completed: 2
  files_changed: 3
requirements_satisfied: [BPR-01, BPR-02]
---

# Phase 37 Plan 02: BrewPad Recipe Detail/Editor Summary

**One-liner:** Recipe detail view and create/edit editor in BrewPad with grouped ingredient table, catalogue autocomplete, inline D-06 guardrail, and POST/PUT save against existing middleware endpoints.

## What Was Built

### Task 1: Detail/editor markup + openRecipeDetail with grouped ingredients (`f57c0b0`)

Added two subviews inside `#bp-panel-recipes` in `brewpad.html` and all orchestration functions in `js/brewpad.js`:

**brewpad.html changes:**
- `#bp-recipes-list-view` — wraps the list host (`#bp-recipes-inner`) with a header and "+ New Recipe" button
- `#bp-recipes-detail-view` (hidden by default) — full editor form with availability banner, form grids (name/style/description, batch size/ABV/IBU/colour SRM, pricing mode/locked-price/service-fee/materials-fee, status), ingredient table (`#bp-recipe-ing-tbody` / `#bp-recipe-ing-tfoot`), and action buttons (`#bp-recipes-save-btn`, `#bp-recipe-activate`)
- No BeerXML controls (out of scope per PATTERNS discretion)

**js/brewpad.js additions (inside IIFE):**
- `showRecipesListView()` / `showRecipesDetailView()` — toggle list vs detail, reset state
- `openRecipeDetail(recipeId)` — `Promise.all(GET /api/recipes/:id, GET /api/recipes/:id/availability)` with availability best-effort catch; calls `populateRecipeForm` and `renderIngredientRows`
- `populateRecipeForm(recipe)` — fills all form fields from recipe object
- `renderIngredientRows(ingredients, availability)` — grouped render via `groupRecipeIngredients` with cold-cache flat fallback; `data-ing-idx = ingredients.indexOf(ing)` (critical: maps back to original array position after grouping reorders); all dynamic values pass through `escapeHTML` (T-37-04)
- `renderAvailabilityBannerBp(availability)` — status-badged availability banner
- `attachIngredientRowListeners()` — remove button + qty change + autocomplete focus/blur per row
- `filterIngredientCatalog(query)` / `showIngredientAutocompleteBp(input)` / `selectIngredientFromAutocompleteBp(input, item)` — autocomplete trio with `mousedown + preventDefault` selection
- `addIngredientRow()` — push blank ingredient and focus new search input
- `updateActivateGuardrail()` — evaluate `canActivateRecipe` and disable/enable `#bp-recipe-activate` with reason as `title`
- `saveRecipe()` — reads form via `readRecipeFormData()`, builds payload via `buildRecipePayload()`, applies D-06 guardrail on `status=active`, `PUT` vs `POST` branch on `currentRecipeId`, `getRecipesMwHeaders(true)`, surfaces 422 errors, calls `loadRecipeList('all')` on success
- `readRecipeFormData()` — reads all editor fields to a flat object
- `updateIngredientTotalsBp(cost, retail, count)` — renders totals footer row
- **Module scope:** `canActivateRecipe(formData, ingredients)` and `buildRecipePayload(formData, ingredients)` lifted outside IIFE for testability
- **Delegation:** `#bp-panel-recipes` click handler for New Recipe / Back / Save / Activate / Add Ingredient; input handler for locked-price guardrail re-evaluation

### Task 2: Tests for canActivateRecipe + buildRecipePayload (`ce4836d`)

Extended `tests/frontend/brewpad-recipes.test.js` with 17 new tests:

- **`canActivateRecipe` (9 tests):** missing price, zero price, negative price, NaN string price, empty ingredients, null ingredients, valid (price + ingredients), multiple ingredients, ok:true has no reason
- **`buildRecipePayload` (8 tests):** all fields included, filters no-item_id, filters zero-qty, ingredient_count = filtered count, count matches payload length, empty ingredients gives count 0, all-invalid gives count 0, null ingredients handled
- Full suite: 738 tests / 37 suites, 0 failures

## Deviations from Plan

None. Plan executed exactly as written.

## Known Stubs

None. The editor reads from live `GET /api/recipes/:id`; saves via real `POST`/`PUT`; autocomplete from real `/api/ingredients?include_internal=1` catalog. All code paths are wired to actual middleware endpoints.

## Threat Surface Scan

No new network endpoints introduced. All mitigations from the plan's threat model applied:

| T-ID | Applied |
|------|---------|
| T-37-04 | `escapeHTML` on all group labels, ingredient names, SKUs, stock text, dot titles in `renderIngredientRows` |
| T-37-05 | `canActivateRecipe` is UX-only; `buildRecipePayload` always sends `ingredient_count`; server re-validates on PUT (recipes.js L399-412) |
| T-37-06 | All writes use `getRecipesMwHeaders(true)`; throws on `!data.ok` (no silent partial write) |
| T-37-07 | Network reject caught → error toast; no client-side queue |

## Self-Check

Files created/modified:
- `brewpad.html` — FOUND (modified)
- `js/brewpad.js` — FOUND (modified)
- `tests/frontend/brewpad-recipes.test.js` — FOUND (modified)

Commits:
- `f57c0b0` — feat(37-02): add recipe detail/editor markup and openRecipeDetail with grouped ingredients
- `ce4836d` — test(37-02): add unit tests for canActivateRecipe and buildRecipePayload

Test result: `npm test -- brewpad-recipes` → 42 passed. Full suite → 738 passed (37 suites), 0 failed.

## Self-Check: PASSED
