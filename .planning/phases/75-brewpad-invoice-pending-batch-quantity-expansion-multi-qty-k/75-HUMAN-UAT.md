---
status: partial
phase: 75-brewpad-invoice-pending-batch-quantity-expansion-multi-qty-k
source: [75-VERIFICATION.md]
started: "2026-08-26T00:00:00Z"
updated: "2026-08-26T00:00:00Z"
---

## Current Test

[awaiting human testing]

## Tests

### 1. Live INV-000171 backfill + idempotency proof
expected: After a prod middleware deploy, run `GET /api/batch/scan-invoices?number=INV-000171` → Create Batches. First re-import: BrewPad shows exactly 3 pending batches for the Italy Nebbiolo Style kit line (converging from the 1 pre-fix batch to 3 via the D-02 reconcile formula, NOT creating a 4th). A second re-run of the same re-import creates 0 additional batches (D-01 idempotency proven live against the real, un-mocked Apps Script dedup guard).
result: [pending]

### 2. Visual "Unit X of N" label confirmation in BrewPad
expected: After the backfill above, open BrewPad in a browser (not curl) and visually confirm the three INV-000171 / SKU 80087352 sibling batches render contiguous "Unit 1 of 3", "Unit 2 of 3", "Unit 3 of 3" labels next to the product name — in correct order, not duplicated, not mixed with any other invoice/SKU group — in both card and table views.
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
