---
phase: 90-brewpad-batch-invoice-linking
plan: 09
subsystem: frontend-brewpad
tags: [brewpad, recipe-picker, combobox, clone, es5]
requires: [90-04, 90-06]
provides:
  - bpCreateRecipePicker / renderRecipeDropdown shared by the four BrewPad recipe pickers
  - editor similar-name assist (initBpRecipeNameAssist) and bpStartRecipeFromExisting
affects: [90-10]
key-files:
  created:
    - tests/frontend/brewpad-recipe-picker-full-list.test.js
    - tests/frontend/brewpad-recipe-start-from.test.js
  modified:
    - js/brewpad.js
    - css/brewpad.css
requirements-completed: [D-19, D-20, D-21, D-23]
completed: 2026-10-14
---

# Phase 90 Plan 09: BrewPad full-list recipe pickers and Start from Summary

All four BrewPad recipe pickers now open the whole active recipe list A-Z (name over style) on focus or click and narrow by name or style as staff type. The recipe editor shows up to 5 similar recipes while a new one is named and can start from one through the existing clone path.

PLAN_BASE: d5e4b2bf3907c01ef1f21315073b9d0b2c3d7e8c (worktree started on b34d96ee; reset to this base per the branch check).

## Commits
- 0269f615 feat(90-09): shared full-list dropdown for the four BrewPad recipe pickers (Task 1)
- d1087284 feat(90-09): recipe editor similar-name check and Start from this recipe (Task 2)

## What was built
- Task 1: `bpCreateRecipePicker(cfg)` (lazy catalog fetch with in-flight guard, focus + click open, Escape close, combobox/listbox ARIA) and `renderRecipeDropdown` (loading / error / empty / filtered-empty / rows via `RecipePicker.filterRecipes`, no cap). Wired into attach-recipe, new-batch Recipes tab (`_productPickerTab` guard kept, touchstart kept), waitlist per-row attach and waitlist manual-add. Each picker keeps its own catalog variable and selection side-effects. A failed fetch leaves the catalog null, shows "Could not load recipes. Tap to retry." and the next open (or a tap on the row) retries. `bindProductSearch` (kit cap of 15) is untouched. Rows keep `bp-vessel-option` / `data-rid` / `data-rname`.
- Task 2: `initBpRecipeNameAssist` (called from the new-recipe branch of `openRecipeDetail`; fetches `/api/recipes?status=all` once into `_recipesState.allForDupCheck`; mounts `#bp-recipe-name-similar` after the name input; 200 ms debounce), exact-match `role="alert"` warning (saving not blocked), `bpStartRecipeFromExisting` (dirty check, `showConfirmSheet` with "Start from copy", fetch detail, set current recipe, `bpCloneRecipe()`, focus and select the name). Edit mode and `bpCloneRecipe` completion clear the list. `bpCloneRecipePayload` is unchanged.
- Test seams added: `_openRecipeAttachPanelForTest`, `_bindRecipePickerSearchForTest`, `_setProductPickerTabForTest`, `_openRecipeDetailForTest`, `_initBpRecipeNameAssistForTest`, `_bpStartRecipeFromExistingForTest`.
- CSS appended: `.bp-recipe-opt-name/style`, 320px panel at >= 768px, `.bp-recipe-similar*`, `.bp-recipe-dup`, `.bp-recipe-start-from`.

## TDD record (RED observed for both tasks)
- Task 1 RED (before the dropdown code, after adding seams): `brewpad-recipe-picker-full-list.test.js` 20 failed / 13 passed of 33. GREEN: 33/33.
- Task 2 RED: `brewpad-recipe-start-from.test.js` 7 failed / 1 passed of 8 (`ReferenceError: initBpRecipeNameAssist is not defined`). GREEN: 8/8. The one early pass is the edit-mode "no similar list" test, vacuous before the feature existed.

## Deviations from Plan
**1. Acceptance grep `grep -c "renderRecipeDropdown(" js/brewpad.js >= 5` yields 4.** The four pickers share the renderer indirectly through `bpCreateRecipePicker` (one definition plus three call sites inside the helper) instead of each calling it directly. Behaviour matches the intent (one renderer, no per-picker copies); `slice(0, 15)` count is 1 (kit search only) as required.
**2. Copy deviation (planned):** filtered-empty row reads "No recipes found. Clear the search to see all."; "Loading recipes…" and "No recipes found" kept.
**3. ABV suffix dropped from attach / new-batch rows** (rows now show name and style, per D-19 and the UI spec); no existing test depended on it.
**4. Start-from error is appended to the similar-name container** and reuses `.bp-recipe-dup` styling.
**5. Worktree base:** HEAD started on b34d96ee, not the required base; `git reset --hard` to d5e4b2bf per the startup check (no work lost).
Flat A-Z, no beer_category grouping (UI-SPEC Q7 default).

## Verification (Node 24.21.0)
- Root: 192 suites / 2569 tests pass; `eslint js/ --max-warnings 0` clean.
- zoho-middleware: 221 suites / 3363 tests pass; lint clean. One earlier middleware run in the background appeared to hang with no output and finished on its own; the rerun passed (open-handle exit slowness, middleware untouched).
- Existing picker tests (waitlist-recipes, waitlist-manual-add, recipe-attach-modify, recipe-volume-factor, recipe-list-clone) pass unedited. Only the two new test files changed under tests/frontend.
- `bpStartRecipeFromExisting` body calls `bpCloneRecipe()`; no `bpCloneRecipePayload` lines removed.
- No build, no *.min.js / js/main.js / ?v= changes, STATE.md and ROADMAP.md untouched, nothing pushed, no real systems touched.

## Notes for 90-10
- css/brewpad.css changed: css/brewpad.min.css and js/brewpad.min.js need the central build.
- The new-batch kit and recipe pickers share one input and dropdown; the dropdown permanently carries `bp-recipe-dropdown` / `role="listbox"` even on the kits tab (cosmetic: 320px cap on tablet).

## Threat Flags
None. T-90-37: every recipe name/style/id is passed through `escapeHTML` (tested with markup in both pickers and the editor list; the error line uses `textContent`). T-90-38: Start from goes through `bpCloneRecipe` (currentRecipeId null, status draft), so Save creates a new record. T-90-39: accepted, one fetch per catalog, none per keystroke.

## Known Stubs
None.

## Self-Check: PASSED
Files and commits 0269f615, d1087284 verified present.
