---
status: partial
phase: 73-recipe-dynamic-pricing-unit-conversion-correctness-unit-awar
source: [73-VERIFICATION.md, 73-REVIEW.md]
started: 2026-08-25T20:28:10Z
updated: 2026-08-25T20:28:10Z
---

## Current Test

[awaiting owner scope decision on CR-01 / CR-02]

## Tests

### 1. Disposition of CR-01 — `checkScaledStock` unit-mismatch (inventory oversell risk)
expected: `checkScaledStock` (recipe-scaling.js:181-206) compares a scaled ingredient quantity directly to catalog `stock_on_hand` with NO unit conversion — the same bug class this phase fixed everywhere else, on the same `computeRecipeQuote` (pos-recipe.js:240) and `_runRecipeConfirm` (pos-recipe.js:665) paths 73-03 modified. Owner to decide: (a) open a gap-closure plan now, (b) accept as tracked follow-on / new phase, or (c) accept as-is with documented rationale.
result: [pending]

### 2. Disposition of CR-02 — BrewPad editor client-side price preview not unit-aware
expected: The recipe editor's Cost/Retail columns + Totals footer (js/brewpad.js ~L2387-2388, 2456-2457, 2548-2549) still compute `qty * rate` with no conversion — this is the number staff use to set `locked_price`. Server-authoritative `computed_price` IS correctly fixed. Owner to decide: fix client-side mirror before closing, or accept as follow-on UI work.
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
