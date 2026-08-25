---
phase: 73-recipe-dynamic-pricing-unit-conversion-correctness-unit-awar
plan: 02
subsystem: api
tags: [express, recipes, unit-conversion, fail-closed, pricing]

# Dependency graph
requires:
  - phase: 73-01
    provides: "zoho-middleware/lib/recipe-scaling.js exports classifyUnit + ingredientLineCost (unit-aware, fail-closed via RecipeLineUnitError)"
provides:
  - "GET /api/recipes/:id (detail) computed_price is unit-converted via scaling.ingredientLineCost"
  - "GET /api/recipes (list) computed_price is unit-converted via scaling.ingredientLineCost"
  - "Read-path fail-closed: a non-convertible ingredient line sets computed_price=null + pricing_error naming the line, for that recipe only — never a thrown error or aborted list response"
  - "SV-R-000004 fixture-driven money regression pinned at ~$88.10 (was ~$1,896.98 unconverted)"
affects: [pos-recipe, kiosk-quote, recipe-editor]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Read-path fail-closed: per-line pricing errors set {computed_price: null, pricing_error: <string>} on the offending recipe only, distinct from the sale-path's throw/4xx (D-02)"
    - "Per-recipe Promise.all guard in list enrichment: a .catch() on each per-recipe promise prevents one recipe's failure from rejecting the whole list (T-73-04 DoS mitigation)"

key-files:
  created: []
  modified:
    - zoho-middleware/routes/recipes.js
    - zoho-middleware/__tests__/recipes.test.js

key-decisions:
  - "SV-R-000004 regression is fixture-driven only (D-04) — no live recipe/Zoho data was read or edited; the fixture models the Whirlfloc line already corrected to unit 'pcs' at ~$0.32/tablet per the owner data action (D-01), since that correction is out of this plan's scope"
  - "Read-path fail-closed sets computed_price=null + pricing_error on the recipe rather than a 4xx/5xx, because GET /api/recipes(/:id) also returns non-price recipe data that must still reach the client (D-02)"
  - "Completed pre-existing dynamic-mode test fixtures (internalCatalogEntry + its two ingredient lines in the SCALE-05 ext describe block) with matching unit:'pcs' fields so wiring ingredientLineCost did not regress them — fixture completion per CLAUDE.md rule #10, not assertion weakening"

patterns-established:
  - "Any future recipe cost sum-site must call scaling.ingredientLineCost(item, line) — never re-implement qty * rate inline"

requirements-completed: [AC-01, AC-02, AC-03, D-02, D-04]

# Metrics
duration: ~20min
completed: 2026-08-25
---

# Phase 73 Plan 02: Recipe computed_price unit-conversion wiring Summary

**Wired both recipe `computed_price` read-path sum-sites (detail + list) in `routes/recipes.js` to the shared `ingredientLineCost` helper, fixing the ~20x SV-R-000004 overcharge and adding read-path fail-closed behavior that never aborts the list on one bad line.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-08-25T19:45:53Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- `enrichWithComputedPrice` (recipe detail) and `enrichListPrices` (recipe list) both now call `scaling.ingredientLineCost(entry, ing)` per line instead of a bare `qty * rate` multiply, so recipe unit and item stock unit are converted before pricing (mass g↔kg, volume ml↔L, count pass-through)
- SV-R-000004 fixture regression pinned: corrected-state fixture recomputes to ~$88.10, not the previous unconverted ~$1889-1896.98
- Read-path fail-closed (D-02): a non-convertible ingredient line marks `computed_price = null` and sets `pricing_error` naming the offending item on that recipe only — the handler still returns 200 with the rest of the recipe data
- List resilience (T-73-04): a per-recipe `.catch()` guard inside the `Promise.all` map ensures one un-priceable recipe never rejects the whole list response; other recipes in the same list still get a numeric price

## Task Commits

Each task was committed atomically:

1. **Task 1: Regression tests first — SV-R-000004 recompute + read-path fail-closed + completed fixtures** - `408255f7` (test)
2. **Task 2: Wire enrichWithComputedPrice + enrichListPrices to ingredientLineCost (read-path fail-closed)** - `253032ef` (feat)

**Plan metadata:** commit to follow (SUMMARY + REQUIREMENTS)

_TDD cycle: RED (`408255f7`, 3 new tests failing for the correct reason — unconverted math and no fail-closed) → GREEN (`253032ef`, all 28 recipes.test.js tests + full 1425-test middleware suite passing). No REFACTOR commit needed — implementation was clean on first pass._

## Files Created/Modified
- `zoho-middleware/routes/recipes.js` - Added `var scaling = require('../lib/recipe-scaling')`; replaced both L119/L197 bare multiplies with `scaling.ingredientLineCost` calls; added read-path fail-closed branches (`computed_price = null` + `pricing_error`) in both `enrichWithComputedPrice` and `enrichListPrices`; added a per-recipe `.catch()` guard in the list's `Promise.all` map
- `zoho-middleware/__tests__/recipes.test.js` - Added a new `describe('Phase 73-02: unit-aware computed_price (detail + list read-paths)')` block with 3 tests (SV-R-000004 regression, detail fail-closed, list resilience); completed the pre-existing `internalCatalogEntry` SCALE-05 fixture and its two dynamic-mode ingredient lines with matching `unit: 'pcs'` fields

## Decisions Made
- SV-R-000004 regression fixture models the Whirlfloc line in its *corrected* state (unit `pcs`, ~$0.32/tablet) since fixing the live recipe's invalid `L` unit is an owner data action (D-01) out of this plan's scope, and D-04 forbids editing the live recipe for this test
- Chose `computed_price: null` + `pricing_error: <string>` over a thrown error for the read path, since `enrichWithComputedPrice`/`enrichListPrices` back GET endpoints that must still return the rest of the recipe payload even when pricing fails for one line
- Added a per-recipe `.catch()` in `enrichListPrices`'s `Promise.all` map as defense-in-depth beyond the `ingredientLineCost` `ok:false` path — covers any future/unexpected error inside the per-recipe promise chain (e.g. a detail-fetch failure), consistent with the T-73-04 DoS mitigation in the threat register

## Deviations from Plan

None - plan executed exactly as written. The two required fixture completions (internalCatalogEntry + its ingredient lines) were explicitly called out in the plan's Task 1 action text, so they are not deviations.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `computed_price` (detail + list) is now unit-converted and matches the unit-aware sale path already wired in 73-01's `pos-recipe.js` (AC-01/AC-03)
- Owner data action (D-01, fixing the live SV-R-000004 Whirlfloc line's invalid `L` unit) is still outstanding — the regression here is fixture-only and does not touch live Zoho/Sheet data
- `GET /api/kiosk/recipe-quote` (mentioned in the handoff as another cost-sum site) was not in this plan's `files_modified` scope — confirm whether a later 73-* plan wires it, or whether it already delegates to `pos-recipe.js`/`recipe-scaling.js`

---
*Phase: 73-recipe-dynamic-pricing-unit-conversion-correctness-unit-awar*
*Completed: 2026-08-25*
