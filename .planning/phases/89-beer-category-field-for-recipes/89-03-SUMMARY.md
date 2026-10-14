---
phase: 89-beer-category-field-for-recipes
plan: 03
subsystem: apps-script
tags: [apps-script, recipes, beer_category, parity, drift-test]
requires: [89-01, 89-02]
provides:
  - Apps Script normalizeBeerCategory + BEER_CATEGORY_KEYS (identical to middleware)
  - ensureRecipesBeerCategoryColumn + setupRecipeBeerCategoryColumn
  - createRecipe/updateRecipe/mirrorRecipeState carry beer_category
  - 4-copy key drift test
affects: [89-07, 89-08, 89-09]
key-files:
  modified:
    - apps-script/adminApi.gs
    - tests/frontend/adminapi-recipe-mirror.test.js
  created:
    - tests/frontend/adminapi-recipe-beer-category.test.js
    - zoho-middleware/__tests__/recipe-rules-beer-category-parity.test.js
    - tests/frontend/beer-category-key-drift.test.js
decisions:
  - Validation in updateRecipe runs before the lock is acquired (stronger than "inside the try"); no lock/ensure/write on reject.
  - setupRecipeTabs untouched (schedule_id precedent).
metrics:
  tasks: 3
  completed: 2026-10-14
---

# Phase 89 Plan 03: Apps Script beer_category Summary

Apps Script now round-trips `beer_category` (create, update, PG-to-sheet mirror) with the same normalise-then-reject rule as the middleware, proven by a parity test, and all key-list copies plus CSS tints are drift-tested. adminApi.gs is NOT deployed.

PLAN_BASE: e520fe11a0a7cd563f3ed2b08b013ee9174a2d00 (worktree HEAD was behind; reset to this base per the branch check).

## Commits
- baf5dc5a test: failing parity, ensure and writer tests (RED)
- 1031beab feat: normaliser, BEER_CATEGORY_KEYS, ensureRecipesBeerCategoryColumn, setupRecipeBeerCategoryColumn
- 521c97a7 feat: createRecipe/updateRecipe/mirrorRecipeState carry beer_category; D-12 mirror test edit
- 16a7a320 test: key drift test (4 copies + CSS)

## Behaviour
- createRecipe: off-list value returns `invalid_data` before the lock and any write; value written by header lookup (not in positional appendRow); absent writes ''.
- updateRecipe: validated before lock; undefined leaves cell untouched; '' clears; ensure runs beside pmCol/schedCol before cache invalidation and findRowById.
- mirrorRecipeState: ensure inside the lock before headers are read.

## D-12 mirror test edit
Ran the file first: exactly the three named tests failed. Edited field-set only: `RECIPE_HEADERS_FULL` and `recipeObj` gain beer_category; counts 18->19; legacy test tail slice -2 -> -3 plus a new beer_category cell assertion. No assertion removed or weakened.

## Deviations
- The writer behaviour tests (create/update/mirror) were committed in the single RED commit with the Task 1 tests rather than a second RED commit, since both live in one new file. RED confirmed (14/15 failing) before implementation.
- Real createRecipe/updateRecipe/mirrorRecipeState run under fake SpreadsheetApp/LockService/Logger; nothing else needed faking, so the STOP rule was not triggered.

## Verification
- Root `npm test`: 176 suites / 2350 tests pass; `npm run lint` clean.
- Middleware `npm test` (Node 20.20.2): all pass except pre-existing `__tests__/vancouver-timezone.test.js` (tzdata issue, known).
- Neither build artifacts nor STATE.md/ROADMAP.md touched.

## Known Stubs
None.

## Self-Check: PASSED
Files and commits above verified present (git log shows all four hashes).
