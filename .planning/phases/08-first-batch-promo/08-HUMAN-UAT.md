---
status: partial
phase: 08-first-batch-promo
source: [08-VERIFICATION.md]
started: 2026-05-04T00:00:00Z
updated: 2026-05-04T18:00:00Z
---

## Current Test

[awaiting human testing — re-verification after plans 04-06]

## Tests

### 1. Homepage banner renders visually
expected: Burgundy banner strip with promo message visible between header and hero; clicking X hides it; on reload it stays hidden; FIRSTBATCH code is legible
result: pass (verified in prior round)

### 2. Checkout promo widget apply/remove flow
expected: On reservation.html?cart=ferment, promo input field appears. Typing FIRSTBATCH and clicking Apply shows chip and discount badges on kit items. Savings row appears. Remove Code restores original pricing.
result: pass (verified in prior round)

### 3. Ingredients excluded from promo in dual-cart
expected: When promo applied, ingredient items show no discount badges or price changes. Only kit items and Maker's Fee receive the 20% discount.
result: pass (verified in prior round)

### 4. Dual-cart combined totals update after promo apply/remove
expected: When promo is applied in dual-cart mode, the "Combined Total (both orders)" in the ingredient section AND the bottom summary near the submit button reflect the 20% discount on kits. When promo is removed, both totals revert to undiscounted amounts.
result: [pending]
note: This was the gap from the prior round — plan 08-04 added renderCheckoutIngredientSection() calls after promo apply/remove. Needs re-test.

### 5. Checkout form fields restore after page refresh
expected: Partially filling name/email/phone on reservation.html, refreshing the page, and seeing the fields restored from localStorage. After successful checkout, the saved data is cleared.
result: [pending]

### 6. Helcim charge reflects discounted amount
expected: When promo is applied, the Helcim iframe/terminal shows the discounted total, not the original undiscounted total.
result: pass (verified in prior round — amount sent to Helcim was correct)

## Summary

total: 6
passed: 4
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps

- truth: "Checkout page combined total and bottom total reflect the promo discount"
  status: resolved
  reason: "Fixed by plan 08-04 — added renderCheckoutIngredientSection() calls after promo apply/remove"
  severity: major
  test: 4
  resolved_by: 08-04
