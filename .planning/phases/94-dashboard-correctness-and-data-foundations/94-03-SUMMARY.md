---
phase: 94-dashboard-correctness-and-data-foundations
plan: 03
subsystem: batches-middleware
tags: [batch-type, postgres, create]
requires: [94-01]
provides: [batch_type and batch_type_source stored on every Postgres create]
affects: [zoho-middleware/lib/batch-pg-create.js, zoho-middleware/lib/batch-store.js]
key-files:
  modified:
    - zoho-middleware/lib/batch-pg-create.js
    - zoho-middleware/lib/batch-store.js
  created:
    - zoho-middleware/__tests__/db/batch-pg-create-type.test.js
    - zoho-middleware/__tests__/batch-store-create-type.test.js
decisions:
  - Client batch_type honoured only for manual/internal sources, stored as source 'manual'
  - Zoho hint resolved in batch-store before the transaction; none inside createBatch
metrics:
  tasks: 2
  completed: 2026-10-27
---

# Phase 94 Plan 03: Batch type on create Summary

Every Postgres create now stores `batch_type` and `batch_type_source` at INSERT ($29, $30) via `classifyBatchType`, with the Zoho cf_type hint resolved from the Redis kiosk cache before the transaction.

## Commits
- 172fd1fd: createBatch stores type and source (recipe row, snapshot style fallback, schedule category, manual override)
- Task 2 commit: batch-store.create awaits `zohoTypeHint(sku)` (postgres, unfrozen, SKU present) and passes `pgOpts.typeHints`

## Verification
- test:db: new batch-pg-create-type (12 cases) plus existing create, internal, latency, idempotency suites green (42 tests).
- Middleware `npm test` 3612 passed, middleware lint clean, root `npm test` and lint green, Node 24.

## Deviations from Plan
- Task 2 implementation was written before its test file was run, so no separate RED run was recorded for the unit test (tests pass and cover all listed behaviours).
- Worktree base was wrong at start (HEAD 8dbfa2ac); reset to b83bc19f per the startup instruction.

## Known Stubs
None.

## Self-Check: PASSED
