---
status: partial
phase: 64-linking-search-correctness
source: [64-02-PLAN.md Task 5 checkpoint (deferred by user 2026-07-24)]
started: 2026-07-24T21:30:00Z
updated: 2026-07-24T21:30:00Z
---

## Current Test

[awaiting human testing — requires middleware deployed to prod Railway first]

## Tests

### 1. Stale-ref cleanup dry-run
expected: `POST /api/batch/reconcile-stale-batch-status` with `{"dry_run": true}` (session-authenticated, from BrewPad page context) lists the known stale ref (INV-000151 → "Pending — SV-B-000185") and does NOT list any invoice whose batch still exists; no Zoho writes occur.
result: [pending]

### 2. Stale-ref cleanup apply
expected: Re-call with `{"dry_run": false}` — report shows INV-000151 cleared; Zoho Books shows INV-000151's Batch Status custom field is now empty.
result: [pending]

### 3. Delete-hook reconciles invoice on batch delete
expected: Deleting a disposable test batch linked to a test invoice from BrewPad clears that invoice's `cf_batch_status` (0 remaining) or shows the correct remaining count (multi-batch invoice), with no manual page action.
result: [pending]

### 4. No over-clearing regression
expected: An unaffected invoice with a live batch still shows its correct `cf_batch_status` after the cleanup + delete-hook runs.
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
