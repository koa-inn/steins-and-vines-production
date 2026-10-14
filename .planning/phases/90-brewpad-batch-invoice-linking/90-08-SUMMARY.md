---
phase: 90-brewpad-batch-invoice-linking
plan: 08
subsystem: admin-frontend
tags: [admin, recipes, D-21, duplicate-check]
requires: [90-04]
provides: [admin recipe editor similar-name list, duplicate-name warning, Start from this recipe]
affects: [js/admin.js, css/admin.css]
key-files:
  modified: [js/admin.js, css/admin.css]
  created: [tests/frontend/admin-recipe-start-from.test.js]
requirements: [D-21]
metrics:
  tasks: 2
  commits: 1
completed: 2026-10-14
---

# Phase 90 Plan 08: Admin recipe Start-from Summary

Admin new-recipe editor now shows up to 5 similar recipes (all statuses, via RecipePicker.findRecipeNameMatches) with an exact-name warning, and "Start from this recipe" fetches the detail then reuses the unchanged duplicateRecipe() clone path.

## What was built
- `initRecipeNameAssist()` (called from the new-recipe branch of `openRecipeDetail`): fetches `/api/recipes?status=all` once per session (`_recipesState.allForDupCheck`; silent on failure), mounts `#recipe-name-similar` after `#recipe-name`, binds a once-only 200 ms debounced input handler that renders only when `currentRecipeId` is null. Edit mode removes the container.
- Warning `A recipe named '<name>' already exists.` (role="alert"); Save is never disabled. All text goes through `escapeHTML`.
- `startRecipeFromExisting(id, name, btn)`: dirty check (ingredients, style, description) -> `showConfirm("Replace what you have entered with a copy of '<name>'?")`; fetches detail; sets currentRecipe/currentIngredients; calls `duplicateRecipe()`; clears list; focuses and selects `#recipe-name`. Failure shows inline `Could not load that recipe. Try again.` and re-enables the button.
- `kioskSaveAsNewRecipe` is not used. `duplicateRecipe()` is untouched.
- CSS: additive `.recipe-similar-*` and `.recipe-dup-warn` block in css/admin.css using existing tokens.
- Test seams `_openRecipeDetailForTest`, `_saveRecipeForTest`, and a test-only `window.RecipePicker` require guard (mirrors the KioskCore one).

## Test evidence
- RED: first run of the new file, 13 of 13 failed (`admin._openRecipeDetailForTest is not a function`).
- GREEN: 13 of 13 pass. Full gate on Node 24.21: root 185 suites / 2452 tests pass, middleware 218 suites / 3308 tests pass, both linters clean. No sibling new-test failures observed.

## Deviations from Plan
- **Single commit instead of one per task.** Both tasks edit the same functions and share one test file, so the gate was run once on the complete change and committed as `960a3163`. Both tasks' verify gates (full suites and lint) pass on that commit. No existing tests edited.
- Task 2 acceptance greps on `PLAN_BASE`: `duplicateRecipe` definition not removed (verified by diff: only additions in admin.js apart from the `previousStatus` line and insertions).
- Worktree started from an older base; reset to 0c7e91cd per the startup instruction before any work.

## Known Stubs
None.

## Threat Flags
None. T-90-34 (escaping) and T-90-35 (copy goes through duplicateRecipe; test asserts POST with no recipe_id) are covered by tests.

## Not done (by design)
No `npm run build`, no min files, no BUILD_TIMESTAMP change (Plan 90-10 owns the build). Not pushed.

## Self-Check: PASSED
- tests/frontend/admin-recipe-start-from.test.js exists; commit 960a3163 exists.
