---
status: resolved
phase: 73-recipe-dynamic-pricing-unit-conversion-correctness-unit-awar
source: [73-VERIFICATION.md, 73-REVIEW.md]
started: 2026-08-25T20:28:10Z
updated: 2026-08-25T21:15:00Z
resolved_by: [73-06, 73-07]
---

## Current Test

[resolved — owner chose gap-closure; CR-01 closed by 73-06, CR-02 closed by 73-07; re-verification passed 21/21]

## Tests

### 1. Disposition of CR-01 — `checkScaledStock` unit-mismatch (inventory oversell risk)
expected: `checkScaledStock` (recipe-scaling.js:181-206) compares a scaled ingredient quantity directly to catalog `stock_on_hand` with NO unit conversion — the same bug class this phase fixed everywhere else, on the same `computeRecipeQuote` (pos-recipe.js:240) and `_runRecipeConfirm` (pos-recipe.js:665) paths 73-03 modified. Owner to decide: (a) open a gap-closure plan now, (b) accept as tracked follow-on / new phase, or (c) accept as-is with documented rationale.
result: resolved — owner chose (a). Plan 73-06 converts `checkScaledStock` and the availability endpoint (WR-01) via `ingredientLineCost(...).convertedQty` before comparing to `stock_on_hand`, fails closed on non-convertible units (no raw-quantity fallback), and reordered the `/confirm` void safety net ahead of the stricter gate. Re-verified in current code (recipe-scaling.js:188-229, recipes.js:380-406).

### 2. Disposition of CR-02 — BrewPad editor client-side price preview not unit-aware
expected: The recipe editor's Cost/Retail columns + Totals footer (js/brewpad.js ~L2387-2388, 2456-2457, 2548-2549) still compute `qty * rate` with no conversion — this is the number staff use to set `locked_price`. Server-authoritative `computed_price` IS correctly fixed. Owner to decide: fix client-side mirror before closing, or accept as follow-on UI work.
result: resolved — owner chose to fix now. Plan 73-07 adds ES5 `bpIngredientLineCost`/`bpClassifyUnit` mirroring the server helper, wired into all three totals sites, capturing `ing.catalog_unit` distinctly from `ing.unit` (so conversion doesn't no-op); non-convertible lines show "N/A" excluded from totals; `brewpad.min.js` rebuilt via terser. Re-verified in current code (js/brewpad.js).

## Summary

total: 2
passed: 2
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps
