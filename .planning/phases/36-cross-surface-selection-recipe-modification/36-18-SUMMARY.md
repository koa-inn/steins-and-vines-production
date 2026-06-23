---
phase: 36
plan: 18
subsystem: kiosk-recipe-sale
tags: [gap-fix, live-price, ingredient-list, admin, kiosk, TDD]
dependency_graph:
  requires: [36-15, 36-09]
  provides: [GAP-8-live-price-pre-sale-type]
  affects: [admin.js, kiosk.js, admin.min.js, kiosk.min.js]
tech_stack:
  added: []
  patterns: [preview-default-sale-type, hoisted-render-helper, module-scope-extract]
key_files:
  created: []
  modified:
    - js/kiosk.js
    - js/admin.js
    - js/admin.min.js
    - js/kiosk.min.js
    - tests/frontend/kiosk-recipe-live-price.test.js
    - tests/frontend/kiosk-recipe-quote.test.js
decisions:
  - "GAP-8 preview uses in-store as default sale type (owner decision: matches label already shown pre-selection)"
  - "T1d in kiosk-recipe-quote.test.js updated — it encoded the broken behavior, not a valid invariant"
  - "kioskRenderRecipeIngredients hoisted to module scope in kiosk.js (was closure inside kioskShowRecipePrompt)"
  - "admin.js: inline flat-list ingredient renders replaced with kioskRenderRecipeIngredients() helper call"
  - "Ingredient list re-render only fires when quote.ingredients is non-empty (protects base list for no-ingredient recipes)"
metrics:
  duration: "18 min"
  completed: "2026-06-22"
  tasks_completed: 1
  files_changed: 6
---

# Phase 36 Plan 18: GAP-8 Live Price + Ingredient List Pre-Sale-Type Summary

Live price display and ingredient list on recipe-sale surfaces now update LIVE on volume/×factor/ingredient change before the user selects Ferment-in-Store or Take-Out.

## What Was Built

Fixed two bugs on both `js/admin.js` and `js/kiosk.js` recipe-sale surfaces (D-01 parity):

**Bug 1 — Quote gated on sale type.** `kioskFetchRecipeQuote()` early-returned when `_kioskSaleType` was null, so volume/factor `oninput` handlers called `kioskScheduleRecipeQuote()` correctly but the fetch never ran.

**Bug 2 — Ingredient list rendered once, never re-scaled.** `#kiosk-recipe-ingredients` was rendered once in `kioskShowRecipePrompt` from base quantities and never updated from a scaled quote.

## Changes

### kiosk.js
- Hoisted `kioskRenderRecipeIngredients(ingredients, el)` from a closure inside `kioskShowRecipePrompt` to module scope — allows both `kioskShowRecipePrompt` and `kioskFetchRecipeQuote` to call it
- Removed the now-redundant local closure definition
- `kioskFetchRecipeQuote`: changed `if (!_kioskSelectedRecipe || !_kioskSaleType) return;` to `if (!_kioskSelectedRecipe) return;`
- Added `var saleType = _kioskSaleType || 'in-store';` and use `saleType` (not `_kioskSaleType`) in the quote URL
- On quote success, re-renders `#kiosk-recipe-ingredients` from `result.data.ingredients` when non-empty

### admin.js
- Extracted inline flat ingredient render (two identical blocks in `kioskShowRecipePrompt`) into module-scope `kioskRenderRecipeIngredients(ingredients, el)` helper
- Replaced both inline blocks with calls to the new helper
- Same `kioskFetchRecipeQuote` guard and preview default changes as kiosk.js

### Test files
- `tests/frontend/kiosk-recipe-live-price.test.js`: Added 8 GAP-8 regression tests (GAP8-A1..A4 for admin, GAP8-K1..K4 for kiosk). Tests assert: fetch fires with no sale type, URL uses in-store default, price updates, ingredient list re-renders scaled, Add-to-Cart stays hidden
- `tests/frontend/kiosk-recipe-quote.test.js`: Updated T1d — it was asserting the OLD broken behavior (no fetch without sale type). Updated to assert the fixed behavior (fetch fires with `sale_type=in-store`)

## Gates Not Changed

- `kioskUpdateAddToCartButton()`: still requires `!addBtn || !_kioskSelectedRecipe || !_kioskSaleType` — Add-to-Cart stays hidden until real sale type is chosen
- `kioskAddRecipeToCart()`: still requires `!_kioskSelectedRecipe || !_kioskSaleType` — charge path unaffected

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] T1d in kiosk-recipe-quote.test.js was asserting old broken behavior**
- **Found during:** GREEN phase — full `npm test` after fix
- **Issue:** `T1d` asserted `fetch` should NOT be called when `_kioskSaleType === null`. This was encoding the broken behavior that GAP-8 was fixing, not a meaningful invariant.
- **Fix:** Updated T1d to assert the fixed behavior — fetch fires with `sale_type=in-store` preview default
- **Files modified:** `tests/frontend/kiosk-recipe-quote.test.js`
- **Commit:** dd3b99e

## Test Results

- Frontend: 873 tests, 45 suites — all pass
- Middleware: 897 tests, 39 suites — all pass (no middleware changes)
- Lint: 0 errors (133 pre-existing warnings in unrelated files)
- Build: `npm run build` regenerated `admin.min.js`, `kiosk.min.js`, and HTML cache stamps

## Commits

| Hash | Type | Description |
|------|------|-------------|
| f0f65bd | test | Add GAP-8 regression tests (RED phase — 8 tests intentionally failing) |
| dd3b99e | feat | Fix GAP-8 — drop sale-type gate, in-store preview default, ingredient re-render |

## Self-Check: PASSED

- js/kiosk.js modified: FOUND
- js/admin.js modified: FOUND
- js/admin.min.js rebuilt: FOUND
- js/kiosk.min.js rebuilt: FOUND
- tests/frontend/kiosk-recipe-live-price.test.js extended: FOUND
- tests/frontend/kiosk-recipe-quote.test.js updated: FOUND
- Commits f0f65bd, dd3b99e: FOUND in git log
