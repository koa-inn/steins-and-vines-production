---
phase: 35-batch-scaling-engine
plan: "02"
subsystem: zoho-middleware/lib
tags: [scaling, pure-module, tdd, math, pricing]
dependency_graph:
  requires: [35-01]
  provides: [recipe-scaling-module]
  affects: [pos-recipe.js, Phase-36-surfaces]
tech_stack:
  added: []
  patterns:
    - Pure function module with no I/O and no requires (SCALE-03 mandate)
    - Object.assign shallow-clone for immutable ingredient transforms
    - Math.max(1, Math.ceil(...)) discrete-unit floor-of-1 rounding (D-02)
    - Math.round(x * 10000) / 10000 continuous 4dp float-safe scaling
    - Math.round(x * 100) / 100 money rounding after accumulation
key_files:
  created:
    - zoho-middleware/lib/recipe-scaling.js
    - zoho-middleware/__tests__/recipe-scaling.test.js
  modified: []
decisions:
  - "D-01/D-02: Discrete units (pcs/each/unit/pkg/ft) use Math.max(1,Math.ceil); continuous (kg/g/l/ml) use Math.round(rawQty*10000)/10000"
  - "D-03: Blank/null/undefined unit treated as continuous (linear) — conservative default"
  - "D-06 confirmed: locked-recipe pricing now includes service_fee + materials_fee — behavior change vs prior flat locked_price"
  - "ft is treated as discrete [ASSUMED] per RESEARCH recommendation; owner can flip to continuous by removing ft from DISCRETE_UNITS"
metrics:
  duration: "~10 min"
  completed_date: "2026-06-20"
  tasks_completed: 3
  files_created: 2
  files_modified: 0
requirements: [SCALE-02, SCALE-03, SCALE-05]
---

# Phase 35 Plan 02: Recipe Scaling Pure Helpers Summary

**One-liner:** Pure server-side scaling module — linear weight scaling, ceil-with-floor-1 discrete rounding, locked/dynamic re-pricing formula, and scaled-quantity stock check; all verified by 43 unit tests including worked locked-price fixture ($95.00/$117.50).

## What Was Built

Created `zoho-middleware/lib/recipe-scaling.js` — a pure module (no requires, no I/O) that is the single source of truth for all recipe batch scaling math. Created `zoho-middleware/__tests__/recipe-scaling.test.js` with 43 unit tests covering every exported function and edge case.

### Files Created

**`zoho-middleware/lib/recipe-scaling.js`** (168 lines)

Four exported functions + two constant arrays:

- `CONTINUOUS_UNITS = ['kg', 'g', 'l', 'ml']` — units that scale linearly
- `DISCRETE_UNITS = ['pcs', 'each', 'unit', 'pkg', 'ft']` — units that round up (ceil with floor-of-1)
- `scaleIngredient(ing, factor)` — shallow-clones ingredient, applies continuous (4dp round) or discrete (Math.max(1, Math.ceil)) scaling; blank/null/unknown unit falls back to continuous (D-03)
- `scaleIngredients(ingredients, factor)` — array map wrapper, handles null/empty input
- `computeScaledRecipeTotal(recipe, scaledIngredients, catalogMap, saleType)` — locked mode: `locked_price × _scale_factor`; dynamic mode: `Σ(quantity × rate)`; adds `service_fee + materials_fee` only for `saleType === 'in-store'`; returns 2dp rounded total
- `checkScaledStock(scaledIngredients, catalogMap)` — skips items absent from catalogMap; returns `{ ok, conflicts: [{ item_id, item_name, needed, stock, unit }] }` when `needed > stock_on_hand`

**`zoho-middleware/__tests__/recipe-scaling.test.js`** (278 lines, 43 tests)

Test coverage:
- Continuous scaling: kg, g, l, ml linear scaling; no-mutation checks; field preservation
- Discrete rounding: pcs ceil (2.3 → 3), floor-of-1 (1 pcs × 0.5 → 1), each/pkg/ft/unit
- Blank unit linear (D-03): blank/null/undefined → linear; non-blank unknown → discrete
- scaleIngredients: array scaling, null/empty input, no mutation
- computeScaledRecipeTotal locked: worked fixture 1.0× = $95.00, 1.5× = $117.50 (D-04/D-05)
- computeScaledRecipeTotal locked take-out: fees NOT added
- computeScaledRecipeTotal dynamic: ingredient sum + fees, take-out, unknown items skipped, 2dp rounding
- checkScaledStock: ok when within stock, conflict when exceeded, unknown items skipped, multiple conflicts, exact-match is not a conflict, null input

## TDD Gate Compliance

- RED commit: `41c76c3` — `test(35-02): add failing recipe-scaling unit tests` (suite failed: Cannot find module)
- GREEN commit: `bcfd969` — `feat(35-02): implement recipe-scaling pure helpers` (43/43 tests pass)
- REFACTOR: not needed — implementation was clean on first pass

## Task Verification Results

### Task 1 (RED)
- `cd zoho-middleware && npm test -- --testPathPattern recipe-scaling` → FAIL with "Cannot find module '../lib/recipe-scaling'"
- RED-OK confirmed

### Task 2 (GREEN)
- `cd zoho-middleware && npm test -- --testPathPattern recipe-scaling` → PASS, 43 tests
- `grep -c "Math.max(1, Math.ceil" zoho-middleware/lib/recipe-scaling.js` → 3 (>= 1 required)
- `grep -c "require(" zoho-middleware/lib/recipe-scaling.js` → 0 (pure module)
- All six exports present in module.exports: scaleIngredient, scaleIngredients, computeScaledRecipeTotal, checkScaledStock, CONTINUOUS_UNITS, DISCRETE_UNITS

### Task 3 (Full Gate)
- `cd zoho-middleware && npm test` → 39 suites, 834 tests PASS
- `npm test` (frontend) → 37 suites, 751 tests PASS
- `npm run lint` → 0 errors (131 pre-existing warnings, unrelated to new file)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed incorrect test assertion in scaleIngredients array test**
- **Found during:** Task 2 (GREEN run)
- **Issue:** Test asserted `results[1].quantity` (1 pcs × 1.5) `.toBe(1)` but the comment in the same line said "1.5x gives ceil(1.5)=2" — the assertion contradicted the comment. `Math.max(1, Math.ceil(1.5)) = 2`, not 1. The implementation was correct.
- **Fix:** Changed assertion to `.toBe(2)` and updated comment to be unambiguous.
- **Files modified:** `zoho-middleware/__tests__/recipe-scaling.test.js`
- **Commit:** `bcfd969` (fix included in GREEN commit)

None of the plan tasks or verifications required architectural changes.

## Known Stubs

None — this is a pure math module. No data source wiring, no UI, no placeholders.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes. This is a pure in-process function module. No new threat surface introduced.

The plan's threat model is satisfied:
- T-35-02-01 (Tampering via computeScaledRecipeTotal): Mitigated — price derived from server-side recipe.locked_price / catalog rates; module accepts no client-supplied price.
- T-35-02-02 (DoS via absurd factor): Accepted — factor bounds enforced upstream by caller (Plan 03).

## Self-Check

File existence:
- `zoho-middleware/lib/recipe-scaling.js` ✓
- `zoho-middleware/__tests__/recipe-scaling.test.js` ✓

Commits:
- `41c76c3` test(35-02) RED ✓
- `bcfd969` feat(35-02) GREEN ✓

## Self-Check: PASSED
