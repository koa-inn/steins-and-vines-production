---
phase: 35-batch-scaling-engine
plan: 05
subsystem: middleware/recipe-sales
tags: [bug-fix, tdd, scale-05, ingredients-catalog, internal-items]
dependency_graph:
  requires: [35-03, 35-04]
  provides: [SCALE-05-fix]
  affects: [routes/pos-recipe.js, routes/recipes.js]
tech_stack:
  added: []
  patterns: [cache-key-switch, tdd-red-green]
key_files:
  created: []
  modified:
    - zoho-middleware/routes/pos-recipe.js
    - zoho-middleware/routes/recipes.js
    - zoho-middleware/__tests__/pos-recipe.test.js
    - zoho-middleware/__tests__/recipes.test.js
decisions:
  - "Recipe stock/pricing reads INGREDIENTS_ALL (zoho:ingredients:all) — full catalog including internal-only items — at all three stock-check sites in pos-recipe.js and recipes.js"
metrics:
  duration: 358s
  completed: 2026-06-20
  tasks_completed: 2
  files_modified: 4
---

# Phase 35 Plan 05: SCALE-05 Internal-Only Ingredient Stock Visibility — Summary

**One-liner:** Switch recipe stock checks from purchasable-only INGREDIENTS catalog to full INGREDIENTS_ALL catalog so internal-only ingredients (e.g. Gypsum Bulk) report real stock instead of 0.

## What Was Built

### The Bug

Recipe stock checks and pricing in `pos-recipe.js` and `recipes.js` read `CACHE_KEYS.INGREDIENTS` (Redis key `zoho:ingredients`), which is the purchasable-only ingredient catalog that deliberately excludes internal-only items. Recipe ingredients that are internal-only — confirmed live example: "Gypsum (Calcium Sulfate) (Bulk)", item_id 109900000000028635, real stock_on_hand 20.83 kg — are absent from that catalog.

Consequences:
- `GET /api/recipes/:id/availability`: stock map returns 0 for internal items → `batches_possible=0` → status `'out'` → `summary: 'cannot_brew'` (false negative)
- `POST /api/kiosk/recipe-sale` (quote handler): internal item absent from catalogMap → `computeScaledRecipeTotal` uses rate=0 → undercharges the customer
- `POST /api/kiosk/recipe-sale/confirm` (confirm handler): same — invoice line item rate=0, stock re-check skips item (no 409 but pricing is wrong)

### The Fix

Three source-level cache key changes — `CACHE_KEYS.INGREDIENTS` → `CACHE_KEYS.INGREDIENTS_ALL` (`zoho:ingredients:all`):

| File | Line | Handler |
|------|------|---------|
| `zoho-middleware/routes/pos-recipe.js` | ~103 | recipe-sale quote: catalogMap for `checkScaledStock`, `computeScaledRecipeTotal`, milling fee lookup |
| `zoho-middleware/routes/pos-recipe.js` | ~254 | recipe-sale confirm: belt-and-suspenders stock re-check + invoice line item rates |
| `zoho-middleware/routes/recipes.js` | ~318 | availability pre-check: stockMap for per-ingredient status + batches_possible |

The full catalog (`INGREDIENTS_ALL`) is the correct source for recipe operations because recipe ingredients legitimately include internal/bulk items that are never sold directly to customers.

## TDD Execution

### RED Commit: `35b43cd`

Added 3 failing regression tests proving the bug exists:

- `recipes.test.js` — "SCALE-05 regression: internal-only ingredient (only in INGREDIENTS_ALL) reports real stock and all_ok": mock `'zoho:ingredients'` returns empty array (item absent), mock `'zoho:ingredients:all'` returns Gypsum with stock 20.83. Current source reads `'zoho:ingredients'` → stock=0 → `'cannot_brew'`. Test asserts `'all_ok'` → FAILED.
- `pos-recipe.test.js` — "SCALE-05a (quote)": internal-only ingredient (rate=0.50) absent from INGREDIENTS → total = fees-only (50.00). Test asserts 51.00 → FAILED.
- `pos-recipe.test.js` — "SCALE-05b (confirm)": gypsum invoice line has rate=0 (item absent from INGREDIENTS catalogMap). Test asserts rate=0.50 → FAILED.

All 53 existing tests passed in the RED commit (only new 3 failed).

### GREEN Commit: `40443cc`

Applied the three source changes + updated mock CACHE_KEYS in both test files to add `INGREDIENTS_ALL: 'zoho:ingredients:all'` + updated all four `beforeEach` blocks in `pos-recipe.test.js` and the availability test in `recipes.test.js` to respond to `'zoho:ingredients:all'`. All 56 tests in the two files pass; full suite: 852 tests, 0 failures.

## Commits

| Commit | Type | Description |
|--------|------|-------------|
| `35b43cd` | test | RED — 3 failing regression tests for SCALE-05 |
| `40443cc` | fix | GREEN — INGREDIENTS_ALL at three stock-check sites + mock plumbing |

## Deviations from Plan

None — plan executed exactly as written. The test mock-infrastructure update (adding `INGREDIENTS_ALL` key to both test files' mock CACHE_KEYS and updating `cache.get` implementations) was explicitly requested in the plan as a waived CLAUDE.md exception.

## Deployment Note

This is a middleware-only change. The fix requires a Railway middleware deploy (`railway up` from `zoho-middleware/`) before the Phase 35 staging UAT for SCALE-05 (false `cannot_brew` on Gypsum Bulk) can be verified. No frontend build is needed. The human owns the Railway deploy.

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes introduced.

## Self-Check: PASSED

- 35-05-SUMMARY.md: FOUND
- RED commit 35b43cd: FOUND
- GREEN commit 40443cc: FOUND
- INGREDIENTS_ALL in pos-recipe.js: FOUND
- INGREDIENTS_ALL in recipes.js: FOUND
- Full test suite: 852 passed, 0 failed
