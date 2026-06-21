---
phase: 36-cross-surface-selection-recipe-modification
plan: 03
subsystem: api
tags: [recipe-scaling, pos-recipe, modified-ingredients, server-authoritative-pricing, recipe-snapshot, tdd]

# Dependency graph
requires:
  - phase: 36-01
    provides: computeModifiedRecipeTotal helper in lib/recipe-scaling.js

provides:
  - GET /api/kiosk/recipe-quote accepts optional modified_ingredients (JSON-encoded) and returns server-authoritative modified total + scaled modified ingredient lines + is_modified flag
  - POST /api/kiosk/recipe-sale passes body.modified_ingredients to computeRecipeQuote for displayed==charged parity
  - POST /api/kiosk/recipe-sale/confirm prices modified list via computeModifiedRecipeTotal, uses scaled modified list for invoice + stock gate, freezes modified_base_ingredients + is_modified into recipe_snapshot
  - All three money-path entry points server-authoritatively price the modified base list; no client-supplied price ever trusted

affects:
  - 36-04 (client-side UI sends modified_ingredients to these endpoints)
  - brewpad-integration (snapshot now carries modified_base_ingredients/is_modified for batch creation)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - computeRecipeQuote 5th param (modifiedIngredients) — optional; when present, routes pricing through computeModifiedRecipeTotal
    - isModified flag propagated from computeRecipeQuote result to HTTP response
    - Confirm handler: modifiedConfirm pattern — parse body.modified_ingredients, use as baseIngredientsConfirm for scaling/stock/invoice
    - Snapshot freeze pattern: modified_base_ingredients (pre-scale client list or null), is_modified (bool)

key-files:
  created: []
  modified:
    - zoho-middleware/routes/pos-recipe.js
    - zoho-middleware/__tests__/pos-recipe.test.js

key-decisions:
  - "computeRecipeQuote extended with a 5th positional param (not options object) — keeps all callers simple; both the quote GET and sale POST pass modifiedIngredients as the 5th arg"
  - "Malformed JSON in GET ?modified_ingredients treated as null (unmodified quote) — no 500, no partial pricing"
  - "base_quantity in quote response reflects the pre-scale modified list when modified, not the original recipe list"
  - "confirm handler variable modifiedConfirm kept separate from computeRecipeQuote modifiedIngredients to avoid scope shadowing in the long confirm closure"
  - "is_modified=false (not null) for no-modified-list case in snapshot, matching boolean semantics from 36-01"

patterns-established:
  - "TDD RED→GREEN per task: failing tests committed before implementation; all 64 pos-recipe tests green"
  - "displayed==charged guarantee: quote/sale/confirm all call computeModifiedRecipeTotal for identical inputs, assert in M-C2 test"
  - "T-36-07 mitigation pattern: unknown added item_id in catalogMap silently contributes 0 (test M-Q7)"
  - "T-36-08 mitigation pattern: checkScaledStock runs on scaled MODIFIED list in confirm (test M-C7)"

requirements-completed: [MOD-02]

# Metrics
duration: 30min
completed: 2026-06-20
---

# Phase 36 Plan 03: Modified Ingredients Server Money-Path Wiring Summary

**Server-authoritative modified recipe pricing wired into all three money-path entry points (quote, sale, confirm) via computeModifiedRecipeTotal, with snapshot freezing modified_base_ingredients + is_modified**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-06-20
- **Completed:** 2026-06-20
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- `computeRecipeQuote` extended with `modifiedIngredients` (5th param); when present, scales the modified base list and prices via `computeModifiedRecipeTotal` (36-01), never trusting client rates
- `GET /api/kiosk/recipe-quote` parses `?modified_ingredients` (JSON) with a `try/catch` fallback to null; returns `is_modified` flag + scaled modified ingredient lines in response
- `POST /api/kiosk/recipe-sale` passes `body.modified_ingredients` to `computeRecipeQuote`, achieving quote/sale price parity for identical inputs
- `POST /api/kiosk/recipe-sale/confirm` prices modified list via `computeModifiedRecipeTotal`, uses scaled modified list for invoice line items and the stock gate (409), and freezes `modified_base_ingredients` + `is_modified` into `recipe_snapshot`
- 17 new TDD tests (M-Q1..M-Q7, M-S1..M-S3, M-C1..M-C7) covering locked-add, locked-remove, dynamic-modify, malformed JSON, displayed==charged parity, snapshot fields, stock gate on modified quantities, and Phase 35 regressions
- Full middleware suite: 897 tests pass; lint: 0 errors

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: failing tests for quote + sale modified_ingredients** - `bfbecff` (test)
2. **Task 1 GREEN: extend computeRecipeQuote + quote/sale routes** - `15029ac` (feat)
3. **Task 2 RED: failing tests for confirm modified_ingredients + snapshot** - `270667d` (test)
4. **Task 2 GREEN: wire modified list into confirm + freeze snapshot** - `9123c98` (feat)

## Files Created/Modified

- `zoho-middleware/routes/pos-recipe.js` — Extended `computeRecipeQuote` (5th param), `GET /api/kiosk/recipe-quote` (JSON.parse modified_ingredients, is_modified in response), `POST /api/kiosk/recipe-sale` (pass modified_ingredients), `POST /api/kiosk/recipe-sale/confirm` (modified list pricing + snapshot freeze)
- `zoho-middleware/__tests__/pos-recipe.test.js` — 17 new MOD-02 tests covering all three endpoints + regression + TDD commits per task; MOCK_INGREDIENTS_CATALOG extended with Centennial Hops for locked-add fixture

## Decisions Made

- `computeRecipeQuote` uses a 5th positional param `modifiedIngredients` (not an options object) — keeps all callers simple and matches the existing pattern for millGrain
- Malformed JSON in `?modified_ingredients` falls back to `null` (unmodified quote) rather than 400 — client sends best-effort; an unusable value means "use original recipe"
- `base_quantity` in quote response reflects the pre-scale modified list when modified (not original recipe list) so the client sees the correct pre-scale quantity for each line
- `is_modified: false` (not null) in the response/snapshot for the no-modified-list case — consistent boolean semantics with `computeModifiedRecipeTotal` T-36-01 contract

## Deviations from Plan

None — plan executed exactly as written. All three entry points wired; all acceptance criteria met.

## Issues Encountered

None.

## Known Stubs

None — all modified_ingredients paths fully implemented and priced server-authoritatively.

## Threat Surface Scan

No new network endpoints, auth paths, or schema changes introduced. All three entry points (quote/sale/confirm) already sat behind the MW_API_KEY guard + BEER_SALES_ENABLED gate; the modified_ingredients param is threaded through the same guarded paths.

Threat mitigations verified by tests:
- T-36-06: Server re-fetches recipe + reads rates from catalogMap; no client rate field trusted (test M-Q1, M-C1)
- T-36-07: Added item_id not in catalogMap contributes 0 (test M-Q7)
- T-36-08: checkScaledStock runs on scaled MODIFIED quantities in confirm (test M-C7)
- T-36-09: Snapshot JSON.stringify'd; ingredient names from server (not client); no HTML injection path

## Next Phase Readiness

- All server-side money paths for modified recipes are complete; 36-04 (client UI) can now send `modified_ingredients` to these endpoints
- `is_modified` in quote response enables the UI to distinguish modified vs unmodified totals
- `recipe_snapshot.modified_base_ingredients` + `recipe_snapshot.is_modified` ready for brewpad batch creation in 36-05+

## Self-Check

---
*Phase: 36-cross-surface-selection-recipe-modification*
*Completed: 2026-06-20*
