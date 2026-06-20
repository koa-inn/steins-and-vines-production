---
phase: 35-batch-scaling-engine
plan: "03"
subsystem: zoho-middleware/routes
tags: [scaling, pos-recipe, tdd, pricing, stock-gate, invoice, snapshot]
dependency_graph:
  requires: [35-02]
  provides: [pos-recipe-scaling]
  affects: [kiosk-recipe-sale-flow, brewpad-batch-creation]
tech_stack:
  added: []
  patterns:
    - Server-authoritative scale_factor = target_volume_l / batch_size_l (never client-supplied)
    - TDD RED/GREEN cycle: test suite first, then implementation
    - computeScaledRecipeTotal called from BOTH quote and confirm (no duplicated money math)
    - D-11 validation: missing/<=0 batch_size_l returns 400 (scaling disabled)
    - D-05 backward compat: absent/blank target_volume_l defaults to batch_size_l => factor 1.0
    - D-08 stock gate: checkScaledStock at quote; D-09 belt-and-suspenders re-check at confirm
    - SCALE-04 snapshot freeze: scaledIngredients + target_volume_l + scale_factor in recipe_snapshot
key_files:
  created: []
  modified:
    - zoho-middleware/routes/pos-recipe.js
    - zoho-middleware/__tests__/pos-recipe.test.js
decisions:
  - "D-06 global fee-inclusive: locked-price formula now adds service_fee + materials_fee at ALL scale factors (even 1x) — behavior change authorized by plan; existing locked-pricing test assertions updated"
  - "D-11 missing-base returns 400 (not silent 1x default): batch_size_l <= 0 is a hard error — scaling explicitly disabled"
  - "D-05 backward compat: absent/blank target_volume_l defaults to batch_size_l, not 0 — preserves all existing API callers"
  - "SCALE-04 snapshot freeze: ingredients field replaced with scaledIngredients in recipe_snapshot passed to detectRecipeSale"
  - "Milling fee preserved: applied on top of computeScaledRecipeTotal result (helper does not know about milling)"
metrics:
  duration: "~20 min"
  completed_date: "2026-06-20"
  tasks_completed: 3
  files_created: 0
  files_modified: 2
requirements: [SCALE-01, SCALE-03, SCALE-04, SCALE-05]
---

# Phase 35 Plan 03: Recipe Sale Route Scaling Wire-Up Summary

**One-liner:** Both pos-recipe.js handlers (quote + confirm) now compute scale_factor server-side from target_volume_l, scale ingredient quantities via the Plan 02 helpers, re-price via computeScaledRecipeTotal, gate on scaled stock with override, and freeze enriched snapshots — 33 tests green.

## What Was Built

Wired the Plan 02 `recipe-scaling.js` helpers into both money paths of `zoho-middleware/routes/pos-recipe.js`. Neither handler duplicates pricing or stock math; both delegate to the tested helper functions.

### Files Modified

**`zoho-middleware/routes/pos-recipe.js`** (both handlers)

Added `var scaling = require('../lib/recipe-scaling');` at top.

**Quote handler (`POST /api/kiosk/recipe-sale`):**
- Validation block (inserted after recipe fetch, before catalog lookup):
  - `batch_size_l <= 0` → 400 "Recipe has no base batch size set. Cannot scale." (D-11, scaling disabled)
  - Absent/blank/null `target_volume_l` → defaults to `batch_size_l` (scale_factor 1.0, D-05 backward compat)
  - `target_volume_l <= 0` or NaN → 400 "target_volume_l must be > 0"
  - `target_volume_l > batch_size_l * 10` → 400 "target_volume_l exceeds maximum (10x base)" (D-11 fat-finger guard)
  - Server-side: `scaleFactor = targetVolumeL / baseVol`; `recipe._scale_factor = scaleFactor`
- After catalogMap build: `var scaledIngredients = scaling.scaleIngredients(ingredients, scaleFactor)`
- Stock gate: `var stockCheck = scaling.checkScaledStock(scaledIngredients, catalogMap)` → 409 with conflicts unless `body.override` (D-08)
- Replaced inline locked/dynamic money math with: `var grandTotal = scaling.computeScaledRecipeTotal(recipe, scaledIngredients, catalogMap, body.sale_type)` (SCALE-03)
- Milling fee still added on top after helper result (preserved take-out path)
- 202 response now includes `scale_factor` and `target_volume_l`
- Server never reads `body.scale_factor` (T-35-03-02 mitigation)

**Confirm handler (`POST /api/kiosk/recipe-sale/confirm`):**
- Same validation + defaulting + factor computation as quote (re-derives server-side — Pitfall 1)
- `var scaledIngredients = scaling.scaleIngredients(ingredients, scaleFactorConfirm)` — never uses client quantities
- Belt-and-suspenders stock re-check at confirm time (D-09): 409 unless `body.override`
- Invoice lineItems loop iterates `scaledIngredients` (scaled quantities sent to Zoho for inventory deduction, SCALE-04)
- Fee line items (Brewing Fee, Materials Fee) unchanged — still added as fixed lines
- `var grandTotal = scaling.computeScaledRecipeTotal(recipe, scaledIngredients, catalogMap, body.sale_type)` (SCALE-03)
- Milling fee preserved on top after helper result
- `recipe_snapshot` now: `{ ..., target_volume_l: targetVolumeLConfirm, scale_factor: scaleFactorConfirm, ingredients: scaledIngredients }` (SCALE-04)
- `brewpadIntegration.detectRecipeSale` called with enriched snapshot — no change to brewpad-integration.js

**`zoho-middleware/__tests__/pos-recipe.test.js`** (extended)

Fixture changes (D-06 authorized):
- `MOCK_RECIPE_RESPONSE`: added `batch_size_l: 20`; added pcs-unit yeast ingredient (`ing-yeast-1`, qty: 1, unit: 'pcs')
- `MOCK_INGREDIENTS_CATALOG`: added `stock_on_hand` to all entries; added yeast catalog entry
- Test 15: expected total updated from `195.00` to `245.00` (D-06 fee-inclusive at 1x: 195*1.0 + 45 + 5)
- Test 9: line count updated from 4 to 5 (3 ingredients + 2 fee lines)
- Tests 16, 18: added `batch_size_l: 20` to dynamic recipe fixtures

New describe blocks:
- `describe('POST /api/kiosk/recipe-sale — scaling (SCALE-01, SCALE-03, SCALE-05)')`: 9 tests (S1-S9)
  - S1: missing batch_size_l → 400
  - S2: target_volume_l <= 0 → 400
  - S3: target_volume_l > 10x base → 400
  - S4: no target_volume_l → defaults 1.0x, fee-inclusive total 245.00, response includes scale_factor/target_volume_l
  - S5: locked 1.5x → 342.50 (195*1.5 + 45 + 5)
  - S6: locked take-out 1.5x → 292.50 (no fees)
  - S7: dynamic 1.5x → scaled ingredient sum + fees
  - S8: stock conflict → 409 with conflicts array
  - S9: override=true → 202 bypassing conflict
- `describe('POST /api/kiosk/recipe-sale/confirm — scaling (SCALE-04, SCALE-05)')`: 6 tests (C1-C6)
  - C1: invoice line items use scaled quantities (malt 8.25kg, hops 0.15kg, yeast 2pcs at 1.5x)
  - C2: confirm locked 1.5x grandTotal = 342.50
  - C3: detectRecipeSale called with snapshot containing target_volume_l=30, scale_factor=1.5, scaledIngredients
  - C4: stock depleted between quote and confirm → 409 at confirm (D-09)
  - C5: no target_volume_l on confirm → defaults to 1.0x (not silent short-circuit)
  - C6: no batch_size_l on confirm recipe → 400

**Total tests:** 33 (was 18, added 15 new)

## TDD Gate Compliance

- RED commit: `d8d82df` — `test(35-03): add failing quote-handler scaling tests + update locked-pricing fixtures (D-06)` (16 failures for Task 1; C1-C6 already in the file and failing for Task 2)
- GREEN commit (Task 1): `b0487d8` — `feat(35-03): wire scaling helper into recipe-sale quote handler` (S1-S9 + test 15 green; C1-C6 still failing)
- GREEN commit (Task 2): `be4b909` — `feat(35-03): wire scaling helper into recipe-sale confirm handler + snapshot` (all 33 green)

Note: Task 1 and Task 2 RED phases were committed together in a single test commit because the confirm tests were naturally written at the same time as the quote tests. The C1-C6 tests were genuinely in RED state (failing) before the Task 2 GREEN implementation, satisfying the TDD gate requirement.

## Task Verification Results

### Task 1 (Quote handler — RED then GREEN)
- `cd zoho-middleware && npm test -- --testPathPattern pos-recipe` → RED: 16 failures (S1-S9 + test 15 + C1-C6)
- After implementation → GREEN: 27 passed, 6 failing (C1-C6 only — Task 2 not yet implemented)
- `grep -c "computeScaledRecipeTotal" pos-recipe.js` → 1 (quote handler)
- `grep -c "scaleIngredients" pos-recipe.js` → 1 (quote handler)
- `grep -c "body.scale_factor" pos-recipe.js` → 0

### Task 2 (Confirm handler — RED then GREEN)
- C1-C6 still failing after Task 1 GREEN (RED for Task 2 confirmed)
- After implementation → GREEN: 33 passed, 0 failing
- `grep -c "computeScaledRecipeTotal" pos-recipe.js` → 2 (quote + confirm)
- `grep -c "scaleIngredients" pos-recipe.js` → 2 (quote + confirm)
- `grep -c "target_volume_l" pos-recipe.js` → 14 appearances
- `grep -c "body.scale_factor" pos-recipe.js` → 0
- `git diff --quiet zoho-middleware/lib/brewpad-integration.js` → unchanged

### Task 3 (Full suite + lint gate)
- `cd zoho-middleware && npm test` → 849 tests, 39 suites PASS
- `npm run lint` → 0 errors (131 pre-existing warnings, unchanged from Plan 02)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Test 9 line count updated for fixture change**
- **Found during:** Task 1 RED phase
- **Issue:** Adding the pcs-unit yeast ingredient to `MOCK_RECIPE_RESPONSE` changed the invoice line count from 4 to 5 (3 ingredients + 2 fees). Test 9 asserted `lineItems.length === 4`.
- **Fix:** Updated test 9 comment and assertion to expect 5 line items (3 ingredients + 2 fees).
- **Authorized by:** CLAUDE.md Rule 10 exemption in the plan — fixture changes that affect existing assertions are authorized by the D-06 global change.
- **Files modified:** `zoho-middleware/__tests__/pos-recipe.test.js`
- **Commit:** `d8d82df` (included in the RED commit)

**2. [TDD deviation] Task 2 RED and Task 1 RED in single commit**
- **Found during:** Test writing (Task 1 action)
- **Issue:** The plan specifies two separate RED commits (one for Task 1, one for Task 2). Writing both quote and confirm tests together in a single session resulted in a combined RED commit.
- **Impact:** None — C1-C6 tests were genuinely in RED state before the Task 2 GREEN implementation. The TDD guarantee (test failure before implementation) was preserved.
- **Tracking:** This deviation is documented here for auditability.

### Plan-Directed Updates to Existing Tests (D-06 Owner-Approved)
Per the plan's CLAUDE.md Rule 10 exemption:
- Test 15: updated expected total `195.00` → `245.00` (D-06 fee-inclusive locked pricing at 1x)
- Test 9: updated line count `4` → `5` (fixture now has 3 ingredients)
- Tests 16, 18: added `batch_size_l: 20` to dynamic recipe fixtures

## Known Stubs

None — all pricing, stock check, and snapshot paths are fully wired. No placeholders.

## Threat Surface Scan

No new network endpoints introduced. The two existing routes (`POST /api/kiosk/recipe-sale` and `POST /api/kiosk/recipe-sale/confirm`) are modified, not created.

Threat mitigations from plan verified:
- T-35-03-01 (client target_volume_l drives price): Mitigated — server recomputes full price from locked_price/catalog rates via computeScaledRecipeTotal
- T-35-03-02 (client supplies scale_factor directly): Mitigated — `grep -c "body.scale_factor" pos-recipe.js` = 0; factor always derived from target_volume_l/batch_size_l
- T-35-03-03 (override bypasses stock block): Accepted per D-08 — within Google-OAuth admin session
- T-35-03-04 (client sends scaled quantities at confirm): Mitigated — confirm re-fetches recipe and re-scales via scaleIngredients(); client quantities never used for line items
- T-35-03-05 (absurd target_volume_l): Mitigated — bounds check rejects `> batch_size_l * 10` before any scaling work

## Self-Check

File existence:
- `zoho-middleware/routes/pos-recipe.js` ✓
- `zoho-middleware/__tests__/pos-recipe.test.js` ✓
- `.planning/phases/35-batch-scaling-engine/35-03-SUMMARY.md` ✓

Commits:
- `d8d82df` test(35-03) RED ✓
- `b0487d8` feat(35-03) GREEN Task 1 ✓
- `be4b909` feat(35-03) GREEN Task 2 ✓

## Self-Check: PASSED
