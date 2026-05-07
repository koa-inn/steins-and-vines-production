---
status: partial
phase: 02-sales-order-integrity
source: [02-VERIFICATION.md]
started: "2026-04-28T21:40:00Z"
updated: "2026-04-28T21:40:00Z"
---

## Current Test

[awaiting human testing]

## Tests

### 1. Direct kiosk sale creates correct Zoho invoice with per-item tax
expected: Invoice in Zoho Books has line items with correct tax_id per item (not flat 5%), tax amounts match Zoho tax rules
result: passed — confirmed by user 2026-05-07

### 2. SO-pay creates invoice from sales order for stock deduction
expected: Paying an existing SO via kiosk creates a linked Invoice in Zoho Books, invoice is submitted, stock decrements
result: deferred — not yet tested, acknowledged at milestone close 2026-05-07

### 3. Void scenario shows full-screen error with transaction ID
expected: When Zoho fails after Helcim charge, full-screen "Payment Voided" error appears with "Ref: {txnId}" and clear "no charge" message
result: deferred — not yet encountered, acknowledged at milestone close 2026-05-07

### 4. Receipt Done button refreshes product stock
expected: After tapping Done on receipt (both direct sale and SO-pay), product stock numbers update immediately without manual refresh
result: deferred — acknowledged at milestone close 2026-05-07

### 5. Negative stock displays actual number
expected: Items with negative stock show e.g. "-3 in stock" instead of "Out of stock", card stays dimmed
result: deferred — haven't encountered negative stock, acknowledged at milestone close 2026-05-07

## Summary

total: 5
passed: 1
issues: 0
pending: 0
deferred: 4
skipped: 0
blocked: 0

## Gaps
