---
phase: 89-beer-category-field-for-recipes
plan: 05
subsystem: api
tags: [express, recipes, validation, public-projection]
requires: [89-01]
provides:
  - "checkBeerCategory: 400 invalid_beer_category on POST/PUT /api/recipes, canonicalises valid values"
  - "beer_category on the anonymous public recipe projection"
affects: [zoho-middleware/routes/recipes.js]
key-files:
  modified: [zoho-middleware/routes/recipes.js]
  created:
    - zoho-middleware/__tests__/recipes-beer-category-route.test.js
    - zoho-middleware/__tests__/recipes-public-beer-category.test.js
decisions:
  - "Category check runs before the activation guard and before any store call, so 400 is uniform across RECIPES_STORE modes"
metrics:
  completed: 2026-10-14
---

# Phase 89 Plan 05: Beer category at the recipe API Summary

POST/PUT /api/recipes now reject off-list `beer_category` with HTTP 400 `invalid_beer_category` (via `normalizeBeerCategory` from 89-01), canonicalise valid values before the store, and the public projection carries `beer_category`.

PLAN_BASE: e520fe11a0a7cd563f3ed2b08b013ee9174a2d00 (worktree HEAD was behind and was reset to it at start).

## Commits
- 64b069a2 test: failing route validation tests (RED)
- 44bbc3e6 feat: 400 validation + canonicalisation (D-04)
- 17e06673 test: failing public projection tests (RED)
- b797e162 feat: add beer_category to PUBLIC_RECIPE_FIELDS (D-08)

## Behaviour
- Absent key: untouched (PUT never clears, D-05). `''` and null forward as `''`.
- Non-string / off-list: 400, store never called. Error body lists enum keys only.
- Existing recipes, write-auth-guard and public-guard suites were not edited and stay green.

## Verification
- Middleware `npm test`: 212/213 suites pass; the only failure is the known pre-existing `vancouver-timezone.test.js` (Node 20.20 tzdata).
- Root `npm test`: 174/174 pass. Both lints clean.

## Deviations from Plan
None. Plan executed as written.

## Known Stubs
None.

## Threat Flags
None.
