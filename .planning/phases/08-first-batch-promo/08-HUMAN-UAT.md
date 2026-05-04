---
status: partial
phase: 08-first-batch-promo
source: [08-VERIFICATION.md]
started: 2026-05-04T00:00:00Z
updated: 2026-05-04T00:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Homepage banner renders visually
expected: Burgundy strip with "20% off your first batch — use code FIRSTBATCH at checkout" appears between hero and promo section. Dismiss button (x) hides it. Refreshing page keeps it hidden. Clearing localStorage brings it back.
result: [pending]

### 2. Checkout widget UI flow
expected: On reservation.html checkout, promo code input appears in Step 1. Entering FIRSTBATCH + email and clicking Apply shows green chip. Kit line items show "20% OFF" badges and discounted prices. Savings summary row appears above Total. Remove Code restores original pricing.
result: [pending]

### 3. Ingredients excluded from promo in dual-cart
expected: When promo is applied and ingredients are in the other cart, ingredient items show no discount badges or price changes. Only kit items and Maker's Fee receive the 20% discount.
result: [pending]

### 4. Helcim charge amount reflects discount
expected: When promo is applied and checkout proceeds to payment, the Helcim iframe/terminal shows the discounted total (original - 20% on kits and Maker's Fee), not the original undiscounted total.
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
