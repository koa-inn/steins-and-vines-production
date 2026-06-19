---
phase: 34-ingredient-display-server-enrichment
plan: 02
subsystem: api
tags: [recipes, enrichment, ingredients, zoho, custom-fields]

# Dependency graph
requires:
  - phase: 34-ingredient-display-server-enrichment
    provides: "PATTERNS.md critical finding: cf_type is top-level, cf_subcategory in custom_fields[]"
provides:
  - "readCF(entry, apiName) helper in recipes.js for extracting custom_fields values"
  - "enrichIngredientGroups(ingredients) always-run additive enrichment on recipe detail endpoint"
  - "GET /api/recipes/:id response includes cf_type/cf_subcategory/display_group on every ingredient"
  - "Jest cases for field presence, custom_fields extraction, additive-only shape, cold-cache, locked-price coverage"
affects:
  - "34-03: frontend grouping helper (js/lib/recipe-grouping.js) consumes cf_type/cf_subcategory"
  - "35-batch-scaling: scaling logic reads cf_type (Grain/Hops/etc) to determine weight vs pcs rounding"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "readCF accessor mirrors catalog.js L551-556 Millable flatten idiom for custom_fields[] extraction"
    - "Separate always-run enrichIngredientGroups chained after enrichWithComputedPrice so locked-price recipes also get grouping fields"
    - "Cold-cache fallback mirrors enrichListPrices fs.readFileSync pattern (D-07)"

key-files:
  created: []
  modified:
    - zoho-middleware/routes/recipes.js
    - zoho-middleware/__tests__/recipes.test.js

key-decisions:
  - "Separate always-run enrichIngredientGroups function (not wired into enrichWithComputedPrice) because enrichWithComputedPrice early-returns for locked-price recipes — avoiding the gate ensures both pricing modes get grouping fields"
  - "display_group set to raw cf_subcategory||cf_type key — client (Plan 01 recipe-grouping helper) does label collapse via CATEGORY_DISPLAY_NAMES to avoid duplicating the map server-side"

patterns-established:
  - "readCF pattern: for custom_fields[] extraction matching api_name, prefer value_formatted then value"
  - "Always-run enrichment chain: enrichWithComputedPrice (gated) then enrichIngredientGroups (ungated) — keeps money path logic unmodified"

requirements-completed: [RDISP-02]

# Metrics
duration: 3min
completed: 2026-06-19
---

# Phase 34 Plan 02: Server Enrichment Summary

**enrichIngredientGroups() in recipes.js adds cf_type/cf_subcategory/display_group additively to every recipe-detail ingredient via readCF custom_fields[] accessor, with cold-cache fallback, for both locked and dynamic recipes**

## Performance

- **Duration:** 3 min
- **Started:** 2026-06-19T15:18:09Z
- **Completed:** 2026-06-19T15:21:20Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added `readCF(entry, apiName)` helper that extracts values from `custom_fields[]` by `api_name`, mirroring the catalog.js Millable flatten idiom
- Added `enrichIngredientGroups(ingredients)` always-run function that sets `cf_type`, `cf_subcategory`, and `display_group` additively on each ingredient (D-08: never mutates rate/tax/quantity/item_id or reorders array)
- Wired enrichment into both branches of `GET /api/recipes/:id` (cache-hit and fresh-fetch), chained after `enrichWithComputedPrice` so it runs regardless of `pricing_mode`
- 6 new Jest cases covering: warm-cache field presence, custom_fields extraction, additive-only shape, cold-cache fallback (D-07), locked-price coverage, and fresh-fetch (cache miss) enrichment

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: failing tests for enrichIngredientGroups** - `31450f2` (test)
2. **Task 1 GREEN: implement enrichIngredientGroups in recipes.js** - `8b37091` (feat)

_Task 2 (Jest cases) was completed as part of the TDD RED/GREEN flow for Task 1; tests are in the same test file. No separate commit needed as all new test cases were committed in 31450f2 and verified green in 8b37091._

## Files Created/Modified
- `zoho-middleware/routes/recipes.js` - Added `readCF`, `enrichIngredientGroups`, wired into GET /api/recipes/:id handler
- `zoho-middleware/__tests__/recipes.test.js` - Added 6 new test cases in "ingredient group enrichment" describe block

## Decisions Made
- Separate `enrichIngredientGroups` function (not integrated into `enrichWithComputedPrice`) because the pricing enrichment early-returns for locked-price recipes; an independent function is the clean way to guarantee locked AND dynamic recipes both get the grouping fields without touching the money path
- `display_group` set to raw `cf_subcategory || cf_type` value rather than applying `CATEGORY_DISPLAY_NAMES` server-side — the Plan 01 client helper already owns label collapse, avoiding duplication

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Worktree lacked `node_modules` in zoho-middleware; installed via `npm install --prefer-offline` (normal worktree setup, not a deviation)

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `GET /api/recipes/:id` now returns `cf_type`/`cf_subcategory`/`display_group` on each ingredient for all pricing modes
- Plan 01 (recipe-grouping.js client helper) can consume these fields directly to group ingredients by `cf_type`
- Phase 35 (batch scaling) can read `cf_type` for weight-vs-pcs rounding logic

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced. Enrichment reads from existing `C.CACHE_KEYS.INGREDIENTS` cache and the same `INGREDIENTS_FILE_CACHE` fallback already used by `enrichListPrices`. Threat mitigations T-34-03/T-34-04/T-34-05 verified:
- T-34-03 (info disclosure): only `cf_type`/`cf_subcategory`/`display_group` written, no rate/cost/internal fields exposed
- T-34-04 (tampering): `item_id`/`quantity`/`rate`/`tax_id` untouched; additive-only test confirms shape
- T-34-05 (DoS): cold cache resolves without throwing, recipe detail still returns

## Self-Check

Files present:
- `zoho-middleware/routes/recipes.js` — FOUND (contains `function readCF`, `enrichIngredientGroups`)
- `zoho-middleware/__tests__/recipes.test.js` — FOUND (contains enrichment test cases)

Commits present:
- `31450f2` — FOUND (test RED)
- `8b37091` — FOUND (feat GREEN)

## Self-Check: PASSED

---
*Phase: 34-ingredient-display-server-enrichment*
*Completed: 2026-06-19*
