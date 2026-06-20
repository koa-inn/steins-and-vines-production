---
phase: 37-brewpad-recipe-manager
plan: "01"
subsystem: frontend/brewpad
tags: [brewpad, recipes, tab, browse, search, unit-tests]
dependency_graph:
  requires: []
  provides:
    - _recipesState (brewpad recipe state object)
    - getRecipesMwHeaders (authenticated header helper for recipe calls)
    - initRecipesTab (lazy-load entry point)
    - loadRecipeList / renderRecipeList (list fetch + render)
    - filterRecipesByName (pure helper, exported + tested)
    - recipeRowPrice (pure helper, exported + tested)
    - "#bp-panel-recipes + data-tab=recipes tab button"
  affects:
    - js/brewpad.js (recipes section + module.exports)
    - brewpad.html (tab bar + panel host)
tech_stack:
  added: []
  patterns:
    - Pure helpers lifted to module scope for testability (same pattern as filterBatchesByStatus)
    - switchTab recipes branch + _recipesDataLoaded/_recipesDataLoading lazy guard
    - Event delegation for row click + search input (initDelegation pattern)
    - getRecipesMwHeaders(mutating) following BrewPad x-api-key convention
key_files:
  created:
    - tests/frontend/brewpad-recipes.test.js
  modified:
    - brewpad.html
    - js/brewpad.js
decisions:
  - "filterRecipesByName and recipeRowPrice lifted to module scope (outside IIFE) for Jest testability — same pattern as escapeHTML and filterBatchesByStatus"
  - "loadIngredientCatalogForRecipes uses getRecipesMwHeaders(true) to send x-api-key for /api/ingredients?include_internal=1 (server gates internal items on key)"
  - "renderRecipeList re-reads bp-recipes-search value to preserve search state on re-render (search input replaced in innerHTML, value re-injected)"
metrics:
  duration: "~5 min"
  completed: "2026-06-20"
  tasks_completed: 2
  files_changed: 3
requirements_satisfied: [BPR-01]
---

# Phase 37 Plan 01: BrewPad Recipes Tab — Browse & Search Summary

**One-liner:** Recipes tab with status-badged, searchable recipe list in BrewPad — reusing GET /api/recipes, lazy-loaded on first visit, pure helpers unit-tested (25 tests, 0 failures).

## What Was Built

### Task 1: Recipes tab markup and tab wiring (`6fbcf52`)

Added the 5th BrewPad tab and its panel host to `brewpad.html`, then wired the full load lifecycle in `js/brewpad.js`:

- **brewpad.html**: 5th `.bp-tab` button (`data-tab="recipes"`) in `.bp-tab-bar`; `#bp-panel-recipes` panel host inside `.bp-panels` (mirrors measurements panel structure)
- **`panels` array**: Added `'recipes'` so `switchTab` shows/hides `#bp-panel-recipes` correctly
- **`_recipesState`**: Ported verbatim from `js/admin.js` L8443-8453 — catalog, catalogLoaded, list, total, currentRecipeId, currentRecipe, currentIngredients, availability, previousStatus
- **Lazy-load guard**: `_recipesDataLoaded` / `_recipesDataLoading` flags prevent re-fetching on tab revisit
- **`initRecipesTab()`**: Entry point called from `switchTab('recipes')` branch — returns early if guard is set, else triggers catalog preload + `loadRecipeList('all')`
- **`getRecipesMwHeaders(mutating)`**: BrewPad-local helper; adds `x-api-key` (lowercase) only when `mutating === true`
- **`loadIngredientCatalogForRecipes()`**: Fetches `/api/ingredients?include_internal=1` with API key (required for internal items); stores into `_recipesState.catalog`
- **Event delegation**: Row click (`'.bp-recipes-row[data-recipe-id]'`) routes to `openRecipeDetail(id)` guarded by `typeof openRecipeDetail === 'function'`; input event on `#bp-recipes-search` calls `renderRecipeList()`

### Task 2: Pure helpers + unit tests (`98200ac`)

Added `filterRecipesByName` and `recipeRowPrice` at module scope (outside the IIFE), `loadRecipeList`, `renderRecipeList`, and the test file:

- **`filterRecipesByName(list, query)`**: Case-insensitive substring filter on `recipe.name`; returns all rows on empty/whitespace/null query; handles null names safely
- **`recipeRowPrice(recipe)`**: Returns `'~$X.XX'` for dynamic recipes (uses `computed_price`), `'$X.XX'` for locked (uses `locked_price`), `'—'` when price is absent/zero
- **`loadRecipeList(statusFilter)`**: Fetches `GET /api/recipes?status=<filter>` with `getRecipesMwHeaders(false)`; stores result in `_recipesState.list/total`; calls `renderRecipeList()` on success; shows toast + error state on failure
- **`renderRecipeList()`**: Emits `#bp-recipes-search` input, filtered recipe rows with `data-recipe-id`, per-row status badge (`bp-recipes-badge-<status>`), and price via `recipeRowPrice`; all dynamic values pass through `escapeHTML`
- **`tests/frontend/brewpad-recipes.test.js`**: 25 tests — 13 for `filterRecipesByName`, 12 for `recipeRowPrice`; all pass

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Pure helpers defined inside IIFE were inaccessible to module.exports**

- **Found during:** Task 1 — first test run after adding `filterRecipesByName`/`recipeRowPrice` to `module.exports`
- **Issue:** `module.exports` block is OUTSIDE the IIFE closure; functions defined inside the IIFE are not accessible there. All 10 existing test suites failed with `ReferenceError: filterRecipesByName is not defined`
- **Fix:** Moved `filterRecipesByName` and `recipeRowPrice` to module scope (before the IIFE), matching the established pattern of `escapeHTML`, `filterBatchesByStatus`, `fmtDate`, etc. The IIFE functions that reference them (`renderRecipeList`) can still call them — module-scope functions are accessible everywhere
- **Files modified:** `js/brewpad.js`
- **Commit:** included in `6fbcf52`

## Known Stubs

None. `loadRecipeList` fetches real data from `GET /api/recipes`. `initRecipesTab` triggers on tab visit. `openRecipeDetail` is referenced by name with a typeof guard — Plan 02 will define it.

## Threat Surface Scan

No new network endpoints introduced. `renderRecipeList` uses `escapeHTML` on all dynamic values (recipe name, status, recipe_id) per T-37-01 in the plan's threat model. `getRecipesMwHeaders(true)` sends `x-api-key` for internal ingredient catalog per T-37-02.

## Self-Check

Files exist:
- `tests/frontend/brewpad-recipes.test.js` — FOUND
- `js/brewpad.js` — FOUND (modified)
- `brewpad.html` — FOUND (modified)

Commits:
- `6fbcf52` — feat(37-01): add Recipes tab markup, panel host, and BrewPad tab wiring — FOUND
- `98200ac` — test(37-01): add unit tests for filterRecipesByName and recipeRowPrice helpers — FOUND

Test result: `npm test -- brewpad-recipes` → 25 passed, 0 failed. Full suite → 721 passed (37 suites), 0 failed.

## Self-Check: PASSED
