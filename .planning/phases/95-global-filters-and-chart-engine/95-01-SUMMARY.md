---
phase: 95-global-filters-and-chart-engine
plan: 01
subsystem: middleware/batches
tags: [postgres, migration, staff-batch, dashboard]
requires: []
provides:
  - batches.staff_batch (migration 0008)
  - batchRules.STAFF_AUTO_SOURCES / isStaffAutoSource / normalizeStaffBatch
  - batchPgUpdate.setStaffBatch (no last_updated bump)
  - get_dashboard_stats staffBatchIds; staff_batch on includeType list/detail
affects: [95-02, 95-07]
tech-stack:
  added: []
  patterns: [PG-only column outside BATCH_COLUMNS, no-bump write like TYPE_SET_SQL]
key-files:
  created:
    - zoho-middleware/migrations/0008_staff_batch.sql
    - zoho-middleware/__tests__/batch-rules-staff.test.js
    - zoho-middleware/__tests__/db/batches-staff-migration.test.js
    - zoho-middleware/__tests__/db/batch-pg-staff-read-create.test.js
    - zoho-middleware/__tests__/db/batch-pg-update-staff.test.js
    - zoho-middleware/__tests__/backfill/batches-parity-staff-keys.test.js
  modified:
    - zoho-middleware/lib/batch-rules.js
    - zoho-middleware/lib/batch-pg-read.js
    - zoho-middleware/lib/batch-pg-create.js
    - zoho-middleware/lib/batch-pg-update.js
    - zoho-middleware/scripts/backfill/batches-parity.js
    - zoho-middleware/__tests__/db/batches-type-migration.test.js
decisions:
  - staffBatchIds comes from a separate id-only query so DASH_STATS_BATCHES_SQL and its LEAN_KEYS test are untouched
metrics:
  tasks: 2
  completed: 2026-10-28
---

# Phase 95 Plan 01: staff_batch flag Summary

Postgres-only `batches.staff_batch` (migration 0008): auto-set on create for internal/research sources only, editable via `update_batch` with strict boolean validation, settable without a `last_updated` bump via `setStaffBatch`, exposed as `staffBatchIds` on the dashboard aggregate and `staff_batch` on includeType list/detail reads, and kept out of the sheet mirror and parity checks.

## Commits
- e8fbcf59: migration, rules, create auto-set, reads
- 33de0d35: update_batch branch, setStaffBatch, parity exclusion

## Deviations from Plan

**1. [Rule 3 - Blocking] Existing test edited: `batches-type-migration.test.js`**
- Its rollback test ran `migrate('down', 1)` and asserted the 0007 columns vanish; with 0008 on top, that now rolls back only 0008. Changed to `migrate('down', 2)` (one line plus comment). Required for the full `test:db` suite to pass; no assertion semantics changed.

## Verification
- Real-Postgres (Docker/Testcontainers) ran locally: full `npm run test:db` passes (50 suites) after the fix above.
- Middleware `npm test`: all pass except `vancouver-timezone.test.js` (2 tests), a pre-existing failure because the local Node is 20.20 (tzdata lacks BC permanent time; prod runs Node 24). Unrelated to this plan.
- Middleware lint, frontend `npm test` (2866) and frontend lint pass. `migrate:guard` passes.

## Known Stubs
None.

## Threat Flags
None beyond the plan's threat model (T-95-01..05 mitigated and tested).

## Self-Check: PASSED
