---
phase: 89-beer-category-field-for-recipes
plan: 04
subsystem: database
tags: [postgres, migration, recipes, beer-category]
requires: [89-01]
provides:
  - "Migration 0006: recipes.beer_category plain nullable text, no CHECK, no data step"
  - "recipe-pg carries beer_category (19th key) through create, update and every read"
affects: [89-05, 89-07]
key-files:
  created:
    - zoho-middleware/migrations/0006_recipes_beer_category.sql
    - zoho-middleware/__tests__/db/recipes-beer-category-migration.test.js
    - zoho-middleware/__tests__/db/recipe-pg-beer-category.test.js
  modified:
    - zoho-middleware/lib/recipe-pg.js
    - zoho-middleware/__tests__/fixtures/recipes-sheet-shape.json
key-decisions:
  - "beer_category special-cased in updateRecipe like pricing_mode (not in UPDATE_STRING_FIELDS); reject happens before LOCK_RECIPE_SQL so off-list is never reported as stale_recipe"
requirements-completed: [D-03, D-04, D-05, D-07, D-12, D-13]
completed: 2026-10-14
---

# Phase 89 Plan 04: Postgres beer_category column and recipe-pg support Summary

Migration 0006 adds `recipes.beer_category` as plain nullable text (no CHECK, no data), and `recipe-pg` normalises it with `normalizeBeerCategory` on create/update and returns it as the 19th key on all reads.

PLAN_BASE: `e520fe11` (worktree reset to this base at start; HEAD was `eaf0b8cc`).

## Commits

- `21b460ec` test: failing migration test (RED)
- `baee5506` feat: migration 0006 (GREEN)
- `5b4b1fbf` test: failing recipe-pg beer_category tests (RED, 8 failing)
- `0f28f8ff` feat: recipe-pg changes plus D-12 fixture edit (GREEN)

## Verification (Node 24.21.0, Docker available)

- `npm run migrate:guard`: 6 files additive-only OK.
- DB suites (`recipe-pg*`, `recipes-backfill`, `recipes-rename-latency`, `migrations`, `recipes-migration`, new migration test): all pass.
- recipe-pg-read.test.js failed on exactly the two byte-identical fixture tests before the fixture edit and passes after; the test file itself is not edited.
- Middleware `npm test`: 211 suites / 3163 tests pass; root `npm test`: 174 suites / 2318 tests pass; both lints clean.
- One middleware run showed a single suite failing from a jest worker crash; two reruns were fully green (flaky, unrelated to this plan).

## Deviations from Plan

- [Rule 1 - Bug] The migration test's raw inserts omitted NOT NULL columns (`status`, `created_at`, `updated_at`); fixed in the test before the GREEN commit. No source impact.
- The plan's "shared working tree" wording did not apply (isolated worktree).
- Fixture edit: `"beer_category": ""` inserted after all 6 `"schedule_id"` keys (field-set addition only).

## Known Stubs

None.

## Self-Check: PASSED
