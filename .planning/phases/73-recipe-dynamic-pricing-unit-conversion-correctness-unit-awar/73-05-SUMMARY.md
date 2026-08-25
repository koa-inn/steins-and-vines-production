---
phase: 73-recipe-dynamic-pricing-unit-conversion-correctness-unit-awar
plan: 05
subsystem: ui
tags: [brewpad, recipe-editor, session-drafts, fetch, resilience, jest]

requires:
  - phase: 73-04
    provides: "D-03 recipe save-time unit validation pre-flight, returning 422 { error, code, cause } on unit_mismatch/activation_locked_price/activation_no_ingredients/save_failed"
provides:
  - "Recipe editor form registered in the existing BrewPad _formSavers session-draft system (6th saver, key sv-brewpad-recipe-draft)"
  - "saveRecipe/submitRecipeSave correctly treat any non-2xx response as a save failure, regardless of body shape"
  - "D-03 code/cause consumption: unit_mismatch highlights the offending ingredient row and names the cause in the failure toast; code/cause absent falls back to the human error string"
  - "Retry affordance (new showToast actionLabel/onAction) on transient (network/502/503/504) save failures, re-submitting the exact already-built payload"
affects: [brewpad-recipe-editor, brewpad-form-drafts]

tech-stack:
  added: []
  patterns:
    - "showToast(message, type, { actionLabel, onAction }) — inline toast action button pattern, reusable for future retry/undo affordances"
    - "submitRecipeSave(endpoint, method, formData, recipeId) extracted from saveRecipe so a retry closure can re-invoke the exact same built request without re-reading the DOM form"

key-files:
  created:
    - tests/frontend/brewpad-recipe-save-resilience.test.js
  modified:
    - js/brewpad.js
    - js/brewpad.min.js

key-decisions:
  - "saveRecipe/submitRecipeSave now return the fetch promise chain (previously void) so callers/tests can await completion; no existing caller depended on the previous undefined return value"
  - "Toast message for unit_mismatch is patched to include the cause name only if not already present in the server error string, avoiding duplicate text against the real 73-04 server message while still guaranteeing the cause is visible"
  - "Transient-failure classification for the retry affordance: !status (network-level rejection) OR status in {502,503,504}; 422/other 4xx do not get a retry (non-transient, form/data issue)"

requirements-completed: [D-05a, D-05b, D-05c, D-05d]

duration: ~35min
completed: 2026-08-25
---

# Phase 73 Plan 05: BrewPad Recipe Editor Save Resilience Summary

**Recipe editor form joins BrewPad's existing session-draft system, saveRecipe now branches on HTTP status before trusting the response body, consumes D-03's code/cause contract to highlight the failing ingredient, and offers a one-click retry on transient failures — closing the gap where a failed save could silently lose in-progress recipe edits.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-08-25
- **Tasks:** 2 (RED test task + TDD implementation task)
- **Files modified:** 3 (js/brewpad.js, js/brewpad.min.js, tests/frontend/brewpad-recipe-save-resilience.test.js)

## Accomplishments

- Recipe editor form is now the 6th `_formSavers` saver (`sv-brewpad-recipe-draft`), snapshotted on `#bp-recipes-detail-view` visibility and restored via `populateRecipeForm` + `renderIngredientRows` — matching the pattern used by the other five BrewPad forms.
- `saveRecipe`/new `submitRecipeSave` check `r.ok`/`r.status` before trusting the JSON body, closing the exact regression where a 422/502 with an unexpected body shape (`!data.ok && data.error` both falsy) fell through to the success branch.
- D-03's `{ error, code, cause }` 422 contract is consumed: `unit_mismatch` + `cause` highlights the matching ingredient row (`bp-ing-row--error`) and names the cause in the toast; absent code/cause gracefully falls back to the human error string.
- Transient failures (network rejection or 502/503/504) show a "Retry" button inline in the error toast (new `showToast` `actionLabel`/`onAction` support) that re-submits the exact same already-built payload — no form re-read, so in-flight edits made after the failure are never accidentally sent instead of what the user actually attempted to save.
- A successful save now clears any stale draft so a later unrelated failure doesn't restore old data.

## Task Commits

Each task was committed atomically:

1. **Task 1: Frontend regression tests first — draft round-trip, non-2xx-as-error, retry** - `9fec242b` (test, RED)
2. **Task 2: Harden saveRecipe + register recipe draft + rebuild brewpad.min.js** - `08bc23af` (feat, GREEN)

_TDD gate compliance: `test(73-05)` commit precedes `feat(73-05)` commit — RED → GREEN sequence verified in git log._

## Files Created/Modified

- `js/brewpad.js` - Added `RECIPE_DRAFT_KEY`, `recipeDraftSnapshot`, `saveRecipeDraftNow`, `clearRecipeDraft`, `highlightIngredientRowByCause`; refactored `saveRecipe` into `saveRecipe` + `submitRecipeSave`; extended `showToast` with `actionLabel`/`onAction`; registered Saver 6 in the `_formSavers` registry; added test-seam exports (`saveRecipe`, `restoreAllFormDrafts`, `renderIngredientRows`, `_getRecipesStateForTest`, `_setRecipesStateForTest`)
- `js/brewpad.min.js` - Rebuilt via `terser js/brewpad.js -o js/brewpad.min.js -c -m` (the file `brewpad.html` actually loads)
- `tests/frontend/brewpad-recipe-save-resilience.test.js` - 12 new tests covering draft round-trip, non-2xx-as-error (including the exact "empty body" regression shape), code/cause consumption + fallback, and retry-without-re-read

## Decisions Made

- Ran the isolated `terser js/brewpad.js -o js/brewpad.min.js -c -m` command (the exact step named in the plan's `<build_note>`) rather than the full `npm run build` pipeline, to avoid touching unrelated files (admin.js build timestamp, HTML cache-bust version strings, other unrelated `*.min.js`/`*.min.css` bundles) that `npm run build` would have modified as a side effect. This keeps the commit scoped to `js/brewpad.js`/`js/brewpad.min.js` per the plan's `files_modified` list.
- `saveRecipe`/`submitRecipeSave` now `return` their promise chain (previously fire-and-forget/`undefined`) so tests can `await` completion. No production caller relied on the prior `undefined` return value, so this is a non-breaking, low-risk addition.
- Kept `_formSavers`' `save()` for the recipe form (`recipeDraftSnapshot`) as the single source of truth, called directly from the save-failure path (`saveRecipeDraftNow`) rather than duplicating the snapshot logic — matches the plan's D-05a instruction to invoke the snapshot on failure "not only on the 401 handleUnauthorized path."

## Deviations from Plan

None — plan executed as written. Two minor same-task refinements during the RED→GREEN cycle (not deviations from the plan's behavior spec):
- Adjusted the toast message construction so the D-03 `cause` is guaranteed visible even when the server's `error` string doesn't literally repeat it (defensive; the real 73-04 server message already includes the label, so this only matters for edge-case/older response shapes — matches the plan's "graceful fallback" instruction).
- Exported `renderIngredientRows` (already an internal closure function) as a test seam so the code/cause row-highlight tests could render real ingredient-row markup instead of hand-rolling a DOM fixture that could drift from the actual renderer.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- D-05a/b/c/d (recipe editor save resilience) are complete; the recipe editor is now covered by the same draft-protection guarantee as every other BrewPad form.
- Frontend suite (1126/1126), middleware suite (1436/1436), and lint are all green as of this plan's final commit.
- No blockers for downstream phases. `js/brewpad.min.js` is rebuilt and up to date with `js/brewpad.js`.

---
*Phase: 73-recipe-dynamic-pricing-unit-conversion-correctness-unit-awar*
*Completed: 2026-08-25*
