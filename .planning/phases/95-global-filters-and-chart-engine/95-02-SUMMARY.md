---
phase: 95-global-filters-and-chart-engine
plan: 02
subsystem: middleware/backfill
tags: [backfill, staff-batch, runbook]
requires: [95-01]
provides:
  - zoho-middleware/scripts/backfill/staff-batch-backfill.js (parseArgs, runStaffBackfill, CANDIDATES_SQL)
  - RUNBOOK "Staff batch flag (Phase 95)" and README "Phase 95 staff flag tooling"
affects: [95-07]
key-files:
  created:
    - zoho-middleware/scripts/backfill/staff-batch-backfill.js
    - zoho-middleware/__tests__/backfill/staff-batch-backfill-plan.test.js
    - zoho-middleware/__tests__/db/staff-batch-backfill.test.js
  modified:
    - zoho-middleware/scripts/backfill/README.md
    - docs/RUNBOOK.md
decisions:
  - Reasons and matched field are computed in JS (ASCII word boundary) from returned rows; SQL uses Postgres \m..\M bound params
metrics:
  tasks: 2
  completed: 2026-10-28
---

# Phase 95 Plan 02: Staff flag backfill Summary

Dry-run-default CLI that flags internal/research-source and McLachlan/Inn-named batches via `setStaffBatch` under a row lock with no `last_updated` bump, gated by `--apply --expect=N` (exit 3 on mismatch), plus README and RUNBOOK procedure. Not run against any real database.

## Commits
- 50767bd0: CLI + plan test (fake pool) + real-Postgres test
- docs commit: README + RUNBOOK sections

## Deviations from Plan
None. Section 7 of brewpad-dashboard-v2.md already had D2-D5 ticked (count 4), so the file was left unchanged.

## Verification
- Plan test: 11 passed. Real-Postgres test: passed (Dinner/Winn/Innes/McLachlane excluded, last_updated unchanged, expect mismatch exits 3 with no writes, re-run lists 0, no names in default output). Middleware lint passes.
- Full-suite runs were not repeated; only new files and docs were added, no shared code touched.

## Known Stubs
None.

## Threat Flags
None.

## Self-Check: PASSED
