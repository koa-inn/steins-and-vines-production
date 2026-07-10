---
status: complete
phase: 48-kiosk-pos-de-fork-kiosk-core-js
source: [48-VERIFICATION.md]
started: 2026-07-04T15:36:44Z
updated: 2026-07-10T19:50:00Z
---

## Current Test

[human iPad run completed 2026-07-10 — standalone kiosk only, per owner decision. Admin-surface tests (5, 6) intentionally not run.]

## Tests

### 1. iPad Safari full-sale parity (SC#5, plan 48-06)
expected: On staging (calls PROD middleware), a full kiosk sale — product + recipe + product-type discount — from BOTH the standalone kiosk URL and the admin-embedded kiosk tab behaves identically; terminal charge succeeds, receipt shows, Zoho invoice/payment created with the correct discounted total.
result: PASS (standalone only). Terminal charged, receipt rendered, Zoho invoice/payment booked (verified: the sale-path invoices were created during the 2026-07-09 evening sitting, incl. INV-000143 product+discount, since deleted as test data). Parity-with-admin not exercised (owner scoped this UAT to standalone-only).

### 2. Dual-cart / sales-order-import live flow
expected: Import a held sales order into the standalone kiosk cart and complete the sale; behaves as before the de-fork.
result: SKIP (not run). Covered by automated parity test kiosk-core-parity.test.js; NOT live-verified.

### 3. Void-on-failure live path
expected: Trigger/observe a terminal failure; `payment_voided` renders correctly; void behaviour unchanged post-relocation.
result: PASS. Terminal failure forced; payment_voided rendered; nothing left orphaned.

### 4. Manager Override (D-07) live on both surfaces
expected: Force a stock-insufficient recipe sale on BOTH the standalone kiosk and the admin kiosk tab; 409 → tap #kiosk-stock-override-btn → resubmit → success on both. Standalone kiosk override (previously dead) now works.
result: PASS (standalone). The previously-dead standalone override now works: 409 → override → success. Sale ran during the 2026-07-09 evening sitting (test invoice since deleted); no orphaned charge — owner confirmed all test charges refunded in Helcim. Admin surface not exercised (owner: standalone-only).

### 5. Admin modified_ingredients pricing fix live
expected: Edit ingredient quantities on an admin recipe sale before charging; invoice total matches the edited preview, not the base recipe price.
result: NOT RUN — out of scope for this UAT (owner decision: standalone kiosk only). Covered by automated tests.

### 6. Admin single-batch fix live
expected: Sell a kit item via the admin kiosk tab; exactly one batch appears in BrewPad "Needs Scheduling" (no duplicate).
result: NOT RUN — out of scope for this UAT (owner decision: standalone kiosk only). Covered by automated tests.

## Summary

total: 6
passed: 3
issues: 0
pending: 0
skipped: 1
not_run_out_of_scope: 2

## Gaps

- Test 2 (dual-cart import) skipped — live money-path for SO import not exercised; relies on automated parity coverage.
- Tests 5 & 6 (admin surface) not run by owner decision (standalone-only UAT); the de-fork's admin-side behaviour is covered by automated tests, not live hardware.
- RESOLVED (money-path integrity): the Test 1/Test 4 sale-path runs happened during the 2026-07-09 evening sitting, not the 2026-07-10 marking session — which is why Zoho shows no 2026-07-10 invoice. Owner confirmed those were test sales (now deleted) and all terminal charges were refunded in Helcim. No orphaned charge. SC#5 verified end-to-end (terminal → receipt → Zoho invoice/payment) on the standalone kiosk.
