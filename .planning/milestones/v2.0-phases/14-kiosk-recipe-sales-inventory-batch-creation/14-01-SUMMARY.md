---
phase: 14-kiosk-recipe-sales-inventory-batch-creation
plan: 01
subsystem: api
tags: [redis, batch-creation, brewpad, constants, env-validation]

# Dependency graph
requires:
  - phase: 13-middleware-api-admin-recipe-management
    provides: brewpad-integration.js kit batch creation pattern and fire-and-forget architecture
provides:
  - LOCK_KEYS.RECIPE_SALE constant in constants.js for Redis mutex in pos-recipe.js
  - MILLING_FEE_ITEM_ID registered in validateEnv.js OPTIONAL array
  - detectRecipeSale() exported from brewpad-integration.js — creates exactly 1 batch per recipe sale
affects:
  - 14-02-pos-recipe-route (consumes LOCK_KEYS.RECIPE_SALE and detectRecipeSale)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "detectRecipeSale: single-batch fire-and-forget, separate code path from detectKitItems"
    - "LOCK_KEYS: centralized Redis mutex key names in constants.js"

key-files:
  created:
    - zoho-middleware/__tests__/brewpad-recipe.test.js
  modified:
    - zoho-middleware/lib/constants.js
    - zoho-middleware/lib/validateEnv.js
    - zoho-middleware/lib/brewpad-integration.js

key-decisions:
  - "detectRecipeSale uses source: 'kiosk_recipe' not 'kiosk' — distinguishes recipe batches from kit batches"
  - "detectRecipeSale creates exactly ONE batch per call regardless of ingredient count (D-10)"
  - "fire-and-forget .catch(()=>{}) — Apps Script failure after payment is silent per D-12"
  - "LOCK_KEYS object added as sibling to CACHE_KEYS in constants.js for consistent mutex key management"

patterns-established:
  - "detectRecipeSale pattern: explicit params (recipeId, recipeSnapshot, invoiceNumber, customerName, contactId) instead of lineItems array"
  - "recipe_snapshot serialized to JSON string at call time — immune to future recipe edits"

requirements-completed: [BAT-01, BAT-02, BAT-03, INV-02]

# Metrics
duration: 8min
completed: 2026-05-17
---

# Phase 14 Plan 01: Kiosk Recipe Batch Foundation Summary

**LOCK_KEYS.RECIPE_SALE constant, MILLING_FEE_ITEM_ID env var, and detectRecipeSale() single-batch fire-and-forget function with 9 unit tests — foundation for Plan 02 recipe sale endpoint**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-05-17T13:32:00Z
- **Completed:** 2026-05-17T13:40:21Z
- **Tasks:** 2
- **Files modified:** 4 (2 modified, 1 modified, 1 created)

## Accomplishments

- Added `LOCK_KEYS` object to `constants.js` with `RECIPE_SALE: 'recipe-sale'` — centralized mutex key for pos-recipe.js Redis lock
- Added `MILLING_FEE_ITEM_ID` to `validateEnv.js` OPTIONAL array — take-out grain milling fee Zoho item ID
- Added `detectRecipeSale()` to `brewpad-integration.js` — creates exactly ONE batch per recipe sale (not one per ingredient), separate from `detectKitItems` code path, with `source: 'kiosk_recipe'`, `recipe_id`, and `recipe_snapshot` fields
- 9 unit tests in `brewpad-recipe.test.js` covering payload shape, single-batch guarantee, falsy recipeId guard, name splitting, walk-in defaults, rejection tolerance, and product_name fallback

## Task Commits

Each task was committed atomically:

1. **Task 1: Add LOCK_KEYS to constants.js and MILLING_FEE_ITEM_ID to validateEnv.js** - `2ff7d1c` (feat)
2. **Task 2: Add detectRecipeSale() to brewpad-integration.js with unit tests** - `71f3cdb` (feat)

## Files Created/Modified

- `zoho-middleware/lib/constants.js` - Added `LOCK_KEYS` object with `RECIPE_SALE: 'recipe-sale'`; exported as `LOCK_KEYS`
- `zoho-middleware/lib/validateEnv.js` - Added `MILLING_FEE_ITEM_ID` to OPTIONAL array
- `zoho-middleware/lib/brewpad-integration.js` - Added `detectRecipeSale()` function; exported from module.exports
- `zoho-middleware/__tests__/brewpad-recipe.test.js` - 9 unit tests for `detectRecipeSale`

## Decisions Made

- `detectRecipeSale` uses `.catch(function () {})` directly on the `callAppsScriptCreateBatch` call — matching D-12 fire-and-forget intent. This means Apps Script failures after payment succeed are silently dropped, consistent with existing kit batch pattern.
- `recipe_snapshot` is serialized to JSON string (`JSON.stringify`) at call time — ensures immutability and aligns with Phase 12 schema decision that snapshot is immune to future recipe edits.
- `product_name` falls back to `recipeId` when `recipeSnapshot.name` is absent — defensive, non-crashing.

## Deviations from Plan

None — plan executed exactly as written. The 9 tests (vs plan's 6 minimum) are additional coverage for edge cases (undefined recipeId, product_name fallback from both directions).

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `LOCK_KEYS.RECIPE_SALE` available for `cache.acquireLock(C.LOCK_KEYS.RECIPE_SALE, 30)` in Plan 02
- `detectRecipeSale` exported and ready for fire-and-forget call in Plan 02 confirm handler
- `MILLING_FEE_ITEM_ID` registered — Plan 02 can read `process.env.MILLING_FEE_ITEM_ID`
- Full middleware test suite passes: 492 tests, 23 suites, 0 failures

## Self-Check: PASSED

**Created files:**
- FOUND: zoho-middleware/__tests__/brewpad-recipe.test.js
- FOUND: .planning/phases/14-kiosk-recipe-sales-inventory-batch-creation/14-01-SUMMARY.md

**Commits:**
- FOUND: 2ff7d1c (feat(14-01): add LOCK_KEYS.RECIPE_SALE constant and MILLING_FEE_ITEM_ID env var)
- FOUND: 71f3cdb (feat(14-01): add detectRecipeSale() to brewpad-integration.js with 9 unit tests)

**Test verification:**
- 9/9 brewpad-recipe.test.js tests pass
- 492/492 middleware tests pass (23 suites)

---
*Phase: 14-kiosk-recipe-sales-inventory-batch-creation*
*Completed: 2026-05-17*
