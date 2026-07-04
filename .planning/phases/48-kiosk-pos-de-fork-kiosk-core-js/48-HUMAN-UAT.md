---
status: partial
phase: 48-kiosk-pos-de-fork-kiosk-core-js
source: [48-VERIFICATION.md]
started: 2026-07-04T15:36:44Z
updated: 2026-07-04T15:36:44Z
---

## Current Test

[awaiting human testing on staging — iPad Safari + Helcim terminal]

## Tests

### 1. iPad Safari full-sale parity (SC#5, plan 48-06)
expected: On staging (calls PROD middleware), a full kiosk sale — product + recipe + product-type discount — from BOTH the standalone kiosk URL and the admin-embedded kiosk tab behaves identically; terminal charge succeeds, receipt shows, Zoho invoice/payment created with the correct discounted total.
result: [pending]

### 2. Dual-cart / sales-order-import live flow
expected: Import a held sales order into the standalone kiosk cart and complete the sale; behaves as before the de-fork.
result: [pending]

### 3. Void-on-failure live path
expected: Trigger/observe a terminal failure; `payment_voided` renders correctly; void behaviour unchanged post-relocation.
result: [pending]

### 4. Manager Override (D-07) live on both surfaces
expected: Force a stock-insufficient recipe sale on BOTH the standalone kiosk and the admin kiosk tab; 409 → tap #kiosk-stock-override-btn → resubmit → success on both. Standalone kiosk override (previously dead) now works.
result: [pending]

### 5. Admin modified_ingredients pricing fix live
expected: Edit ingredient quantities on an admin recipe sale before charging; invoice total matches the edited preview, not the base recipe price.
result: [pending]

### 6. Admin single-batch fix live
expected: Sell a kit item via the admin kiosk tab; exactly one batch appears in BrewPad "Needs Scheduling" (no duplicate).
result: [pending]

## Summary

total: 6
passed: 0
issues: 0
pending: 6
skipped: 0
blocked: 0

## Gaps
