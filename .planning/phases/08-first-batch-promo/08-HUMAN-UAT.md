---
status: complete
phase: 08-first-batch-promo
source: [08-01-SUMMARY.md, 08-02-SUMMARY.md, 08-03-SUMMARY.md]
started: 2026-05-04T00:00:00Z
updated: 2026-05-04T12:00:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Homepage banner renders visually
expected: Burgundy strip with "20% off your first batch — use code FIRSTBATCH at checkout" appears between hero and promo section. Dismiss button (x) hides it. Refreshing page keeps it hidden. Clearing localStorage brings it back.
result: pass

### 2. Checkout widget UI flow
expected: On reservation.html checkout, promo code input appears in Step 1. Entering FIRSTBATCH + email and clicking Apply shows green chip. Kit line items show "20% OFF" badges and discounted prices. Savings summary row appears above Total. Remove Code restores original pricing.
result: pass

### 3. Ingredients excluded from promo in dual-cart
expected: When promo is applied and ingredients are in the other cart, ingredient items show no discount badges or price changes. Only kit items and Maker's Fee receive the 20% discount.
result: pass

### 4. Helcim charge amount reflects discount
expected: When promo is applied and checkout proceeds to payment, the Helcim iframe/terminal shows the discounted total (original - 20% on kits and Maker's Fee), not the original undiscounted total.
result: issue
reported: "Looks like the proper amount gets sent to helcim but the combined total and the total at the bottom don't reflect the discount"
severity: major

## Summary

total: 4
passed: 3
issues: 1
pending: 0
skipped: 0
blocked: 0

## Gaps

- truth: "Checkout page combined total and bottom total reflect the promo discount"
  status: failed
  reason: "User reported: Looks like the proper amount gets sent to helcim but the combined total and the total at the bottom don't reflect the discount"
  severity: major
  test: 4
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""

## Feature Requests (Out of Scope)

- Partial form completion persistence on checkout page (remember fields across page reloads)
