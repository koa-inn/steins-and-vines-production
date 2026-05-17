---
phase: 14-kiosk-recipe-sales-inventory-batch-creation
plan: "05"
subsystem: verification
tags: [verification, tests, lint, build, staging, checkpoint]

requires:
  - phase: 14-01
    provides: detectRecipeSale, LOCK_KEYS, MILLING_FEE_ITEM_ID
  - phase: 14-02
    provides: pos-recipe.js route, recipe sale endpoints
  - phase: 14-03
    provides: admin.html/admin.js recipe browser UI
  - phase: 14-04
    provides: kiosk.css recipe browser styles

provides:
  - Full test suite verified green (506 MW + 360 frontend = 866 tests passing)
  - Lint verified clean (0 errors, 84 pre-existing warnings)
  - Build artifacts regenerated (admin.min.js, main.min.js, kiosk.min.js, styles.min.css)
  - Staging deploy pending human verification

affects:
  - All Phase 14 feature work confirmed regression-free

tech-stack:
  added: []
  patterns:
    - "Verification-only plan: no new code, only test/lint/build gate"

key-files:
  created: []
  modified:
    - js/admin.js (BUILD_TIMESTAMP bump by npm run stamp)
    - js/admin.min.js (regenerated)
    - js/main.js (concatenated, minor timestamp bump)
    - js/main.min.js (regenerated)
    - admin.html (cache version bump)
    - index.html (cache version bump)
    - kiosk.html (cache version bump)
    - brewpad.html (cache version bump)
    - about.html (cache version bump)
    - contact.html (cache version bump)
    - products.html (cache version bump)
    - ingredients.html (cache version bump)
    - reservation.html (cache version bump)
    - products/ferment-in-store.html (cache version bump)
    - products/ingredients-supplies.html (cache version bump)

key-decisions:
  - "RECIPE_SALE grep check returned 1 (not 2) in constants.js — the key is defined once as LOCK_KEYS.RECIPE_SALE; usage is in pos-recipe.js via C.LOCK_KEYS.RECIPE_SALE, which is correct. Plan intent (constant defined and in use) is satisfied."

requirements-completed: [KSK-01, KSK-02, KSK-03, KSK-04, BAT-01, BAT-02, BAT-03, INV-01, INV-02, INV-03]

duration: 8min
completed: "2026-05-17"
---

# Phase 14 Plan 05: Verification and Staging Summary

**Full test suite green (866 tests), lint clean (0 errors), build artifacts regenerated — awaiting human verification of recipe sale flow on staging**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-05-17T18:35:00Z
- **Completed:** 2026-05-17T18:43:00Z
- **Tasks:** 1 of 2 (Task 2 is checkpoint:human-verify)
- **Files modified:** 15 (all build artifacts / cache version bumps)

## Accomplishments

**Task 1: Full test suite, lint, and build verification (COMPLETE)**

- Middleware tests: **506 passed, 0 failed** (24 suites)
- Frontend tests: **360 passed, 0 failed** (20 suites)
- ESLint: **0 errors, 84 warnings** (all pre-existing, unchanged from 14-03 baseline)
- Build: **EXIT 0** — all artifacts regenerated
  - `js/admin.min.js` — includes full recipe browser code
  - `js/main.min.js` — concatenated modules, no regressions
  - `css/styles.min.css`, `css/kiosk.min.css` — regenerated (pre-existing WARNING at kiosk.css:873 is unchanged)
  - All HTML files cache-version stamped

**Plan output verifications:**
- `detectRecipeSale` in `zoho-middleware/lib/brewpad-integration.js`: 2 occurrences (PASS >= 2)
- `RECIPE_SALE` in `zoho-middleware/lib/constants.js`: 1 occurrence (see Decisions — semantically correct)
- `pos-recipe` in `zoho-middleware/server.js`: 1 occurrence (PASS >= 1)
- `kioskLoadRecipes` in `js/admin.js`: 2 occurrences (PASS >= 2)
- `kiosk-recipe-grid` in `admin.html`: 1 occurrence (PASS >= 1)
- `kiosk-mode-toggle` in `css/kiosk.css`: 4 occurrences (PASS >= 3)

**Task 2: Human verification on staging (CHECKPOINT — awaiting)**

Deploy to staging: `git push origin main`

Pre-requisite: Set `BEER_SALES_ENABLED=true` in Railway staging environment to test the full sale flow.

Verification steps:
1. Visit https://staging.steinsandvines.ca/admin.html?tab=kiosk
2. Verify Products/Recipes mode toggle appears above product grid
3. Switch to Recipes — recipe card grid appears (or "No active recipes" if none exist)
4. Each recipe card shows name, style, ABV, locked price in --barrel brown
5. Tap a recipe card — sale-type prompt with Ferment in Store / Take Out buttons
6. Availability banner: yellow (low stock) or red (cannot brew) or none (ok)
7. Select "Ferment in Store" — dark selected state, "Add to Cart" appears
8. Select "Take Out" — "Mill grain?" checkbox appears
9. Tap "Add to Cart" — cart populates with ingredient lines + fees, mode returns to Products
10. Checkout flow hits `/api/kiosk/recipe-sale` (verifiable in Network tab)
11. Back button returns to recipe grid
12. With `BEER_SALES_ENABLED=false`: terminal push returns 403 "Recipe sales are not enabled"

Resume signal: Type "approved" to confirm the recipe sale flow works, or describe issues.

## Task Commits

1. **Task 1: Full verification** — `(see commit after SUMMARY write)`

## Files Created/Modified

Build artifacts (all from `npm run build` cache stamping):
- `js/admin.js`, `js/admin.min.js`, `js/main.js`, `js/main.min.js`
- `admin.html`, `index.html`, `kiosk.html`, `brewpad.html`
- `about.html`, `contact.html`, `products.html`, `ingredients.html`, `reservation.html`
- `products/ferment-in-store.html`, `products/ingredients-supplies.html`

## Decisions Made

- `RECIPE_SALE` grep in `zoho-middleware/lib/constants.js` returned 1 (plan said >= 2). The key is defined once as `LOCK_KEYS.RECIPE_SALE: 'recipe-sale'`. All usages are in `zoho-middleware/routes/pos-recipe.js` as `C.LOCK_KEYS.RECIPE_SALE`. The constant is correctly defined and used; the plan's grep count was optimistic. Implementation is semantically correct.

## Deviations from Plan

**1. [Note - Minor] RECIPE_SALE grep count 1 vs expected >= 2**
- **Found during:** Task 1 output verification
- **Issue:** `grep -c 'RECIPE_SALE' zoho-middleware/lib/constants.js` returns 1, not >= 2
- **Root cause:** The constant is defined once as `LOCK_KEYS.RECIPE_SALE` — the usage lives in pos-recipe.js. No separate usage or alias in constants.js.
- **Impact:** None — the implementation is correct. Lock key is defined, exported, and consumed correctly.
- **Action:** No fix needed.

## User Setup Required

Railway environment variable needed before live testing:
- **Service:** Railway (staging environment)
- **Variable:** `MILLING_FEE_ITEM_ID`
- **Source:** Zoho Books Dashboard -> Items -> find the milling fee service item -> copy `item_id` from URL
- **Also required for testing:** `BEER_SALES_ENABLED=true` to enable the recipe sale flow

## Known Stubs

None.

## Threat Surface Scan

No new network endpoints or attack surface. This is a verification-only plan.

## Self-Check: PASSED

- Middleware tests: 506 passed — CONFIRMED
- Frontend tests: 360 passed — CONFIRMED
- ESLint: 0 errors — CONFIRMED
- `npm run build`: EXIT 0 — CONFIRMED
- `js/main.min.js` exists: CONFIRMED (222991 bytes)
- `css/styles.min.css` exists: CONFIRMED (111765 bytes)
- All 6 plan output greps: 5/6 PASS (1 minor count deviation documented above)

---
*Phase: 14-kiosk-recipe-sales-inventory-batch-creation*
*Completed: 2026-05-17*
*Status: Task 1 complete, Task 2 (human-verify) awaiting staging deployment and sign-off*
