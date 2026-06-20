---
phase: 37-brewpad-recipe-manager
plan: "03"
subsystem: frontend/brewpad
tags: [brewpad, recipes, delete, confirm-sheet, bundle, test-gate]
dependency_graph:
  requires:
    - _recipesState / getRecipesMwHeaders / loadRecipeList / showRecipesListView (37-01)
    - deleteRecipe DELETE /api/recipes/:id via showConfirmSheet (37-02 for context)
    - showConfirmSheet / mwUrl / getRecipesMwHeaders / showToast (js/brewpad.js, unchanged)
  provides:
    - deleteRecipe(recipeId, name) — confirm-gated delete via showConfirmSheet danger variant
    - recipeDeleteConfirmMessage(name) — pure helper (exported + unit-tested)
    - "#bp-recipe-delete" button in brewpad.html detail view actions (hidden when new recipe)
    - js/brewpad.min.js rebuilt — includes full recipe manager (browse/search/detail/edit/activate/delete)
    - Full test gate green: 743 frontend tests, 791 middleware tests, 0 lint errors
  affects:
    - brewpad.html (action buttons area)
    - js/brewpad.js (deleteRecipe + recipeDeleteConfirmMessage + delegation wire)
    - js/brewpad.min.js (rebuilt artifact)
tech_stack:
  added: []
  patterns:
    - showConfirmSheet danger variant for all recipe destructive actions (D-04: no one-tap delete on shared iPad)
    - recipeDeleteConfirmMessage pure helper at module scope for testability (matches filterRecipesByName / canActivateRecipe pattern)
    - Delete button hidden (display:none) when currentRecipeId is null — prevents accidental delete on new recipe form
    - Delegation pattern: #bp-recipe-delete click reads _recipesState.currentRecipeId / currentRecipe.name directly
key_files:
  created: []
  modified:
    - js/brewpad.js
    - brewpad.html
    - js/brewpad.min.js
    - tests/frontend/brewpad-recipes.test.js
key_decisions:
  - "recipeDeleteConfirmMessage lifted to module scope (outside IIFE) — same testability pattern as filterRecipesByName, canActivateRecipe from Plans 01/02; Jest can import and assert the irreversible-warning copy without DOM"
  - "Delete button starts display:none in HTML and is shown/hidden by openRecipeDetail — avoids flash of visible button when transitioning to new recipe mode"
  - "deleteRecipe reads _recipesState.currentRecipeId/currentRecipe.name in the delegation handler rather than storing a local copy — single source of truth matches save/activate pattern"
  - "Middleware tests run from main repo checkout (worktree lacks zoho-middleware/node_modules — expected in worktree isolation); no middleware files changed so gate is valid"
requirements-completed: [BPR-02]

# Metrics
duration: 3min
completed: "2026-06-20"
---

# Phase 37 Plan 03: BrewPad Recipe Manager — Confirm-Gated Delete + Ship Readiness Summary

**Confirm-gated recipe delete (showConfirmSheet danger variant, D-04) added to BrewPad; brewpad.min.js rebuilt with full recipe manager; 743 frontend + 791 middleware tests green; human-verify iPad Safari checkpoint reached.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-06-20T04:33:33Z
- **Completed:** 2026-06-20T04:36:40Z
- **Tasks completed:** 2 of 3 autonomous (Task 3 is human-verify checkpoint — not yet approved)
- **Files modified:** 4 source files + 21 build-artifact HTML/JS stamps

## Accomplishments

- Added `deleteRecipe(recipeId, name)` inside the IIFE — calls `showConfirmSheet` with `'bp-confirm-btn--danger'` before issuing `DELETE /api/recipes/:id`, refreshes list and returns to list view on success, error toast on failure (T-37-08, T-37-09)
- Added `recipeDeleteConfirmMessage(name)` at module scope for unit testability; 5 new tests assert recipe name inclusion, "cannot be undone" copy, null-safety (T-37-10: message uses text assignment not innerHTML)
- Added `#bp-recipe-delete` button to `brewpad.html` detail view action area (hidden by default; `openRecipeDetail` shows it only when `recipeId` is non-null)
- `npm run build` regenerated `js/brewpad.min.js` — `grep -c recipe` returns 1 (recipe symbols present)
- Full gate green: 743 frontend tests (47 in brewpad-recipes), 791 middleware tests, 0 lint errors

## Task Commits

1. **Task 1: Confirm-gated delete via showConfirmSheet** - `8b01bc7` (feat)
2. **Task 2: Build bundle + full frontend/middleware/lint gate** - `c5cf2c3` (chore)
3. **Task 3: Human-verify iPad Safari E2E flow** - CHECKPOINT (awaiting human verification)

## Files Created/Modified

- `js/brewpad.js` — `recipeDeleteConfirmMessage` helper at module scope; `deleteRecipe()` function inside IIFE; show/hide delete button in `openRecipeDetail`; delegation wire for `#bp-recipe-delete`; `recipeDeleteConfirmMessage` added to `module.exports`
- `brewpad.html` — `#bp-recipe-delete` button added to `.bp-recipes-detail-actions` (display:none, danger styling)
- `js/brewpad.min.js` — Rebuilt artifact (terser minification of updated brewpad.js)
- `tests/frontend/brewpad-recipes.test.js` — 5 new tests for `recipeDeleteConfirmMessage`; import added

## Decisions Made

- `recipeDeleteConfirmMessage` pure helper lifted to module scope for testability — same pattern as `filterRecipesByName` (Plan 01) and `canActivateRecipe` (Plan 02); `deleteRecipe` itself is inside the IIFE and DOM-coupled so not exported
- Delete button starts `display:none` in HTML and is shown by `openRecipeDetail` — this avoids a flash of visible button and is consistent with how the Activate button's disabled state is managed
- Middleware tests verified from main repo (`/Users/koa/dev/steins-and-vines-website/zoho-middleware`); worktree lacks `zoho-middleware/node_modules` (expected — not tracked by git); no middleware files changed so gate validity is confirmed

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. `deleteRecipe` calls `DELETE /api/recipes/:id` with live API key. List refresh calls `loadRecipeList('all')` against real middleware.

## Threat Surface Scan

No new network endpoints introduced. All mitigations from the plan's threat model applied:

| T-ID | Applied |
|------|---------|
| T-37-08 | `deleteRecipe` routes through `showConfirmSheet` with `bp-confirm-btn--danger` variant and "cannot be undone" copy before any DELETE fires — no one-tap delete |
| T-37-09 | DELETE sends `getRecipesMwHeaders(true)` (x-api-key); throws on `!data.ok && data.error`; error toast on reject — no optimistic mutation |
| T-37-10 | `showConfirmSheet` uses `element.textContent = message` (line 3237) not innerHTML — recipe name cannot inject markup |
| T-37-SC | No new packages; `npm run build`/`npm test`/`npm run lint` use existing committed dev deps only |

## Requirements Traceability

| Requirement | Status | Satisfied by |
|-------------|--------|--------------|
| BPR-01 | Satisfied (Plan 01) | Browse/search list, status badges, name filter, recipe row click |
| BPR-02 | Satisfied (Plans 02+03) | Detail/editor with full field parity, autocomplete, guardrail, create/edit/activate/delete |

## Checkpoint Status

**Task 3 (human-verify)** is a `checkpoint:blocking` gate — see structured checkpoint message below. The autonomous portion of Plan 03 is complete and committed. iPad Safari E2E verification is awaiting human approval before staging deploy sign-off.

## Issues Encountered

- `cd zoho-middleware && npm test` inside the worktree returns 32 suite failures due to missing `node_modules` (expected in git worktree isolation — middleware package.json dependencies are not installed in the worktree). Verified from main repo checkout: 791 tests / 38 suites, all green. No middleware files were changed in this plan.

## Self-Check

Files exist:
- `js/brewpad.js` — FOUND (modified)
- `brewpad.html` — FOUND (modified)
- `js/brewpad.min.js` — FOUND (rebuilt)
- `tests/frontend/brewpad-recipes.test.js` — FOUND (modified)

Commits:
- `8b01bc7` — feat(37-03): add confirm-gated deleteRecipe via showConfirmSheet (D-03, D-04) — FOUND
- `c5cf2c3` — chore(37-03): rebuild minified bundle and run full frontend/middleware/lint gate — FOUND

Automated verification: `grep -q "function deleteRecipe" js/brewpad.js && grep -q "method: 'DELETE'" js/brewpad.js && grep -q "bp-confirm-btn--danger" js/brewpad.js && ! grep -q "window.confirm" js/brewpad.js && echo PASS` → PASS

## Self-Check: PASSED
