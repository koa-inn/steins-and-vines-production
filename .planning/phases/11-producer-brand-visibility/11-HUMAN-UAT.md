---
status: partial
phase: 11-producer-brand-visibility
source: [11-VERIFICATION.md]
started: 2026-05-06T23:20:00Z
updated: 2026-05-06T23:20:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Catalog Producer filter with live Zoho data
expected: Producer filter row appears in catalog filter panel. Selecting a producer shows only kits from that producer. Kits without manufacturer show no producer line.
result: [pending]

### 2. Cart sidebar inline producer format
expected: Name element reads "ProducerName — Kit Name" (em dash separator). Without manufacturer, name shows alone.
result: [pending]

### 3. Checkout review table Producer column
expected: Producer column visible before Brand in checkout table. Cell shows manufacturer value. Column absent when no items have manufacturer.
result: [pending]

### 4. Kiosk grid producer display (kit items only)
expected: Kit cards show producer div above name. Ingredient items do not show producer.
result: [pending]

### 5. Admin kit table Producer column
expected: Producer column appears between SKU and Brand. Values sourced from Zoho (zohoKitMap), not Google Sheets.
result: [pending]

## Summary

total: 5
passed: 0
issues: 0
pending: 5
skipped: 0
blocked: 0

## Gaps
