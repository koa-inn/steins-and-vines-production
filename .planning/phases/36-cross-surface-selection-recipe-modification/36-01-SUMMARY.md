---
phase: 36-cross-surface-selection-recipe-modification
plan: 01
subsystem: api
tags: [recipe-scaling, pricing, middleware, pure-function, tdd]

# Dependency graph
requires:
  - phase: 35-batch-scaling-engine
    provides: scaleIngredient/scaleIngredients/computeScaledRecipeTotal in lib/recipe-scaling.js
provides:
  - computeModifiedRecipeTotal pure helper in zoho-middleware/lib/recipe-scaling.js (MOD-02)
  - locked-add pricing: locked_price×factor + fees + added_scaled_qty×catalog_rate (D-07)
  - locked-remove no-credit: charge identical to unmodified locked total (D-08)
  - dynamic-modify natural repricing: Σ(scaled_qty×rate over modified list) + fees (D-09)
  - T-36-01 mitigation: catalog rate always used; client rate field ignored
affects:
  - 36-03 (wires computeModifiedRecipeTotal into pos-recipe.js quote/sale/confirm routes)
  - any future plan consuming recipe modification pricing

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Pure helper pattern extended — computeModifiedRecipeTotal follows same no-I/O, no-mutation contract as prior recipe-scaling exports
    - TDD RED/GREEN with hard-coded literal assertions for owner-approved worked examples

key-files:
  created: []
  modified:
    - zoho-middleware/lib/recipe-scaling.js
    - zoho-middleware/__tests__/recipe-scaling.test.js

key-decisions:
  - "Added ingredients scale identically to base ingredients (D-04) at the given scaleFactor — pcs discrete ceil, kg/g linear (owner decision 2026-06-21)"
  - "LOCKED_ADD_1_5X literal $125.50 hard-coded in test (never derived from scaleIngredient at assert time) — owner-approved worked example"
  - "Client-supplied rate field on added ingredient is silently ignored; only catalogMap[item_id].rate used (T-36-01)"
  - "Locked-remove gives no credit at any scale factor (D-08 intentional asymmetry)"

patterns-established:
  - "computeModifiedRecipeTotal branches on locked_price > 0; locked base computed via computeScaledRecipeTotal with empty scaledIngredients, then ADDED items detected via originalIds lookup"
  - "Dynamic branch: scaleIngredients(modifiedBaseIngredients, factor) fed into computeScaledRecipeTotal — adds/removals fall out naturally"

requirements-completed: [MOD-02]

# Metrics
duration: 12min
completed: 2026-06-21
---

# Phase 36 Plan 01: computeModifiedRecipeTotal — Locked-Add/Remove Asymmetry + Dynamic Modify Pricing Summary

**Pure `computeModifiedRecipeTotal` helper added to `lib/recipe-scaling.js`, implementing locked-add D-07 (added lines priced at scaled_qty×catalog_rate on top of locked base), locked-remove D-08 (no credit, charge unchanged), and dynamic D-09 (natural repricing over full modified list), with a TDD suite including the owner-approved $125.50 literal fixture.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-06-21T04:15:00Z
- **Completed:** 2026-06-21T04:27:00Z
- **Tasks:** 2 (Task 1 RED + Task 2 GREEN)
- **Files modified:** 2

## Accomplishments
- `computeModifiedRecipeTotal(recipe, originalIngredients, modifiedBaseIngredients, catalogMap, scaleFactor, saleType)` implemented and exported as a pure function
- TDD RED commit with 10 named test cases including the owner-mandated `125.50` literal assertion for LOCKED_ADD_1_5X
- GREEN: all 877 middleware tests pass with no regressions
- Security mitigation T-36-01 enforced by implementation: catalog rate always used for added lines; client-supplied `rate` field is ignored

## Task Commits

1. **Task 1: Write failing tests for computeModifiedRecipeTotal (RED)** - `02ea49f` (test)
2. **Task 2: Implement computeModifiedRecipeTotal (GREEN)** - `f339e5c` (feat)

**Plan metadata:** (docs commit below)

_TDD tasks: test commit → feat commit_

## Files Created/Modified
- `zoho-middleware/lib/recipe-scaling.js` - Added `computeModifiedRecipeTotal` function (88 lines) + updated export block
- `zoho-middleware/__tests__/recipe-scaling.test.js` - Added `describe('computeModifiedRecipeTotal', ...)` with 10 test cases

## Decisions Made
- Added ingredients scale identically to base ingredients at `scaleFactor` (D-04) — pcs uses `Math.max(1, Math.ceil(qty × factor))`, kg/g linear. This is why the $125.50 value is what it is: 1 pcs hop at 1.5× = 2 pcs × $4 = $8 added to 67.50 + 50.
- Literal `125.50` hard-coded in the LOCKED_ADD_1_5X test assertion — owner decision 2026-06-21 to never derive expected values from the implementation at assert time.
- Security: the locked-mode branch explicitly reads `catalogMap[ing.item_id].rate` — the ingredient's own `rate` field (if any) is never referenced.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `computeModifiedRecipeTotal` is exported and ready for plan 36-03 to wire into `pos-recipe.js` quote/sale/confirm routes
- The helper is pure and independently testable — no route changes needed in this plan
- T-36-01 (client rate tampering) is fully mitigated by the implementation
- T-36-02 (locked-remove credit) is mitigated by the no-credit locked branch

---
*Phase: 36-cross-surface-selection-recipe-modification*
*Completed: 2026-06-21*
