---
status: partial
phase: 28-zoho-customer-read-back-path
source: [28-VERIFICATION.md]
started: 2026-06-12T02:05:00Z
updated: 2026-06-12T02:05:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Apps Script deployment includes customer_email/customer_phone allowedFields
expected: The hosted Google Apps Script project serves updateBatch() with both new allowedFields entries, no editor errors
result: pass — verified live 2026-06-11: user deployed manually; subsequent update_batch call persisted customer_email and customer_phone onto SV-B-000153, proving the deployed script accepts both fields

### 2. Batches sheet has customer_phone column
expected: The Batches tab (spreadsheet 10BzcANc_-dyS-Is_C4He7mMYHfJ2OSJS9V4p7D-1JrM) has a customer_phone header and writes persist
result: pass — verified live 2026-06-11: column was missing (write silently no-op'd), user added the header, re-run persisted +1-6048151535; header confirmed in get_batch key dump

### 3. Read endpoint verified against deployed Railway middleware
expected: GET /api/batch/customer-by-number returns customer details when called against the Railway-deployed middleware (not just localhost)
result: [pending] — the functional loop was fully verified with the committed code on localhost against live Zoho (INV-000094 → SV-B-000153). Railway deploys from the PRODUCTION repo; the endpoint reaches Railway with the next production push (currently bundled with pending Phase 27/27.1 work). Re-run one curl against the Railway URL after that deploy.

## Summary

total: 3
passed: 2
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps
