---
phase: 89-beer-category-field-for-recipes
plan: 07
subsystem: backfill
tags: [backfill, recipes, beer_category, verify]
requires: [89-01, 89-04]
provides: [beer_category in backfill spec, reject and verify]
key-files:
  modified:
    - zoho-middleware/scripts/backfill/specs/recipes.js
    - zoho-middleware/scripts/backfill/recipes-backfill.js
    - zoho-middleware/scripts/backfill/recipes-verify.js
    - zoho-middleware/__tests__/backfill/recipes-spec-headers.test.js
    - zoho-middleware/__tests__/backfill/recipes-backfill-plan.test.js
  created:
    - zoho-middleware/__tests__/backfill/recipes-beer-category.test.js
decisions:
  - Backfill rejects non-blank non-canonical beer_category (exact key match, reason code only)
metrics:
  completed: 2026-10-14
---

# Phase 89 Plan 07: Backfill beer_category Summary

Offline recipes backfill spec maps an optional `beer_category` header, rejects any non-blank value that is not an exact canonical key (`invalid_beer_category`, no cell echo), and recipes-verify compares it with blank equal to NULL.

PLAN_BASE: e1e3e0005348ddee880a317636b4fd68593d7e66 (worktree reset to it at start; HEAD began on an older commit).

## Commits
- cdb71b5c test(89-07): add failing backfill/verify beer_category tests (RED)
- 14a8ab6e feat(89-07): backfill spec, reject and verify cover beer_category
- d09fad6e test(89-07): pinned backfill tests carry the beer_category field (D-12)

## D-14 ordering
89-01 RUNBOOK commit e5a77bf4 is an ancestor of the spec commit (`git merge-base --is-ancestor` exit 0).

## D-12 edits
Only field-set changes: header list gains `beer_category`, "18 real headers" retitled 19, the appended-last test title/set includes beer_category, and the clean-fixture key count 18 -> 19. recipes-verify.test.js and db/recipes-backfill.test.js are unchanged.

## Verification
- New test file 6/6, backfill unit tests 42/42, recipes-backfill DB suite 8/8 (Docker, Node 20.20 locally).
- Root npm test 2371 pass, lint clean. Middleware lint clean.
- Middleware npm test: only 2 failures, both in vancouver-timezone.test.js (known pre-existing Node 20 tzdata issue; Node 24 not used because nvm sourcing was blocked in this sandbox).

## Deviations
Test-only adjustment in my own new test: an invalid recipe row also orphans its ingredient row, so reject assertions filter on field `beer_category`. No other deviations.

## Self-Check: PASSED
