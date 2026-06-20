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
  - "Recipe enrichment (grouping + dynamic pricing) reads INGREDIENTS_ALL at all three enrichment sites in recipes.js — internal-only ingredients (e.g. Gypsum Bulk) are consumed and charged, so all enrichment must use the full catalog consistent with the availability/sale path"
metrics:
  duration: 358s (first pass) + extension
  completed: 2026-06-20
  tasks_completed: 4
  files_modified: 4
---

# Phase 35 Plan 05: SCALE-05 Internal-Only Ingredient Stock Visibility — Summary

**One-liner:** Switch ALL recipe catalog reads (stock checks, grouping, dynamic pricing) from purchasable-only INGREDIENTS to full INGREDIENTS_ALL so internal-only ingredients (e.g. Gypsum Bulk) report real stock, get correct display groups, and are priced correctly in dynamic recipes.

## What Was Built

### The Bug (First Pass — Stock Checks)

Recipe stock checks and sale pricing in `pos-recipe.js` and `recipes.js` read `CACHE_KEYS.INGREDIENTS` (Redis key `zoho:ingredients`), which is the purchasable-only ingredient catalog that deliberately excludes internal-only items. Recipe ingredients that are internal-only — confirmed live example: "Gypsum (Calcium Sulfate) (Bulk)", item_id 109900000000028635, real stock_on_hand 20.83 kg — are absent from that catalog.

Consequences (original):
- `GET /api/recipes/:id/availability`: stock map returns 0 for internal items → `batches_possible=0` → status `'out'` → `summary: 'cannot_brew'` (false negative)
- `POST /api/kiosk/recipe-sale` (quote handler): internal item absent from catalogMap → `computeScaledRecipeTotal` uses rate=0 → undercharges the customer
- `POST /api/kiosk/recipe-sale/confirm` (confirm handler): same — invoice line item rate=0, stock re-check skips item (no 409 but pricing is wrong)

### The Extension Bug (Three Enrichment Sites)

The same root cause applied to three enrichment functions in `recipes.js` — all three read `CACHE_KEYS.INGREDIENTS` (purchasable-only):

| Function | Consequence |
|----------|-------------|
| `enrichIngredientGroups` | Internal-only ingredients get no `cf_type`, `cf_subcategory`, or `display_group` — display grouping is broken for internal items |
| `enrichWithComputedPrice` | Dynamic recipe `computed_price` excludes internal ingredient rates — price shown to staff is wrong |
| `enrichListPrices` | Recipe list `computed_price` excludes internal ingredient rates — list prices wrong for dynamic recipes with internal items |

**Confirmed business rule:** Internal-only recipe ingredients ARE consumed and ARE charged. Both stock AND dynamic pricing AND display grouping must use the FULL catalog (`CACHE_KEYS.INGREDIENTS_ALL`), consistent with the already-fixed availability and sale paths.

### The Fix

**First pass (original 35-05):** Three source-level cache key changes — `CACHE_KEYS.INGREDIENTS` → `CACHE_KEYS.INGREDIENTS_ALL` at stock-check sites:

| File | Line | Handler |
|------|------|---------|
| `zoho-middleware/routes/pos-recipe.js` | ~103 | recipe-sale quote: catalogMap for `checkScaledStock`, `computeScaledRecipeTotal`, milling fee lookup |
| `zoho-middleware/routes/pos-recipe.js` | ~254 | recipe-sale confirm: belt-and-suspenders stock re-check + invoice line item rates |
| `zoho-middleware/routes/recipes.js` | ~318 | availability pre-check: stockMap for per-ingredient status + batches_possible |

**Extension (35-05 gap-closure):** Three additional source-level cache key changes + file-cache constant in `recipes.js`:

| Function | Change |
|----------|--------|
| `enrichIngredientGroups` | `INGREDIENTS` → `INGREDIENTS_ALL`; cold-cache file fallback: `INGREDIENTS_FILE_CACHE` → `INGREDIENTS_ALL_FILE_CACHE` |
| `enrichWithComputedPrice` | `INGREDIENTS` → `INGREDIENTS_ALL` (no file fallback in this function) |
| `enrichListPrices` | `INGREDIENTS` → `INGREDIENTS_ALL`; cold-cache file fallback: `INGREDIENTS_FILE_CACHE` → `INGREDIENTS_ALL_FILE_CACHE` |

Added `INGREDIENTS_ALL_FILE_CACHE = path.join(__dirname, '..', 'ingredients-all-cache.json')` constant in `recipes.js` (mirrors `catalog.js`).

## TDD Execution

### First Pass

#### RED Commit: `35b43cd`

Added 3 failing regression tests proving stock-check bug:
- `recipes.test.js` — SCALE-05 regression: availability returns `'cannot_brew'` for internal-only ingredient
- `pos-recipe.test.js` — SCALE-05a (quote): computed total excludes internal ingredient rate
- `pos-recipe.test.js` — SCALE-05b (confirm): invoice line item rate is 0 for internal ingredient

All 53 existing tests passed; only 3 new tests failed.

#### GREEN Commit: `40443cc`

Applied stock-check source changes + updated mock CACHE_KEYS in both test files. All 56 tests pass; full suite: 852 tests, 0 failures.

### Extension Pass (Enrichment Sites)

#### RED Commit: `71a1b53`

Added 3 failing regression tests proving enrichment bug (key-based cache mocking: INGREDIENTS → empty, INGREDIENTS_ALL → internal item):
- `enrichIngredientGroups`: `cf_type` is `undefined` (expected `'Additive'`)
- `enrichWithComputedPrice`: `computed_price` is `10.00` (expected `13.00` — internal ingredient rate missing)
- `enrichListPrices`: `computed_price` is `5.00` (expected `11.00` — internal ingredient rate missing)

All 21 existing tests passed; only 3 new tests failed.

#### GREEN Commit: `2923783`

Applied three enrichment source changes + `INGREDIENTS_ALL_FILE_CACHE` constant. All 24 tests in recipes suite pass; full suite: 855 tests, 0 failures. npm run lint: 0 errors.

## Commits

| Commit | Type | Description |
|--------|------|-------------|
| `35b43cd` | test | RED — 3 failing regression tests for SCALE-05 (stock checks) |
| `40443cc` | fix | GREEN — INGREDIENTS_ALL at three stock-check sites + mock plumbing |
| `71a1b53` | test | RED — 3 failing tests for enrichment reading INGREDIENTS_ALL |
| `2923783` | fix | GREEN — enrichment reads INGREDIENTS_ALL at all three sites + file fallbacks |

## Deviations from Plan

**Extension pass:** The original plan only covered 3 stock-check sites (pos-recipe.js x2 + recipes.js availability). The objective prompt identified 3 additional same-root-cause sites in `recipes.js` (the three enrichment functions). Fixed atomically in a second RED→GREEN cycle per the same TDD contract.

**Business rule confirmed:** Internal-only recipe ingredients are consumed and charged. Enrichment (grouping + dynamic pricing display) must use `INGREDIENTS_ALL` for consistency with the sale/availability paths.

## Deployment Note

This is a middleware-only change. The fix requires a Railway middleware deploy (`railway up` from `zoho-middleware/`) before the Phase 35 staging UAT for SCALE-05 can be fully verified. No frontend build is needed. The human owns the Railway deploy.

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes introduced.

## Self-Check: PASSED

- 35-05-SUMMARY.md: updated
- RED commit 71a1b53: FOUND
- GREEN commit 2923783: FOUND
- INGREDIENTS_ALL_FILE_CACHE in recipes.js: FOUND
- enrichIngredientGroups reads INGREDIENTS_ALL: FOUND
- enrichWithComputedPrice reads INGREDIENTS_ALL: FOUND
- enrichListPrices reads INGREDIENTS_ALL: FOUND
- Full test suite: 855 passed, 0 failed
