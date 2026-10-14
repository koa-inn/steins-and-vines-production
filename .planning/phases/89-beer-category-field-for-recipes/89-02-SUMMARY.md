---
phase: 89-beer-category-field-for-recipes
plan: 02
subsystem: frontend
tags: [recipes, catalog, tint]
requires: []
provides: [BEER_CATEGORIES, recipeTintClass]
affects: [js/lib/constants.js, js/modules/07-catalog-kits.js]
key-files:
  created: [tests/frontend/catalog-recipe-tint.test.js]
  modified: [js/lib/constants.js, js/modules/07-catalog-kits.js]
decisions:
  - "Whitelist beer_category against BEER_CATEGORIES before getTintClass (T-89-04)"
metrics:
  completed: 2026-10-14
---

# Phase 89 Plan 02: Recipe card tint Summary

Public recipe cards are tinted from `beer_category` via a whitelisted `recipeTintClass`, backed by a shared 12-entry `BEER_CATEGORIES` list in `js/lib/constants.js`.

PLAN_BASE: 5c8637256e8fb730a2bfb5f80ab484c476e42ece (worktree HEAD was reset to this base at start; it had started at eaf0b8cc).

## Commits
- 517f7e47: test(89-02) failing tint tests (RED, 5 of 8 failing)
- feat(89-02) colour recipe cards from beer_category (GREEN): constants.js, 07-catalog-kits.js

## Behaviour
- `ipa` gives className `label-beer tint-ipa`; blank, missing, non-string, off-list, wine keys give `label-beer`.
- Blank short-circuits before touching globals, so existing card tests stay green and unmodified.
- Stale fetchActiveRecipes comment reworded (beer_category is colour only, not routing).
- No build run, no main.js edits (Plan 89-08 owns build).

## Verification
- New tint test + catalog-recipe-block + catalog-custom-recipe-card: 66 passed.
- Root `npm test`: 174 suites / 2318 tests pass. `npm run lint` clean.
- Middleware `npm test`: 2 failures, both in `__tests__/vancouver-timezone.test.js`. This is the known Node 20 tzdata vs BC permanent time issue (Node 24 fix on staging), unrelated to this plan's files.

## Deviations from Plan
- Note: constants.js uses CRLF line endings; preserved them when editing.
- Worktree base was corrected via the prescribed reset before starting.

## Known Stubs
None.

## Self-Check: PASSED
