---
phase: 94-dashboard-correctness-and-data-foundations
plan: 13
subsystem: middleware/backfill
tags: [recompute, cycle-time, runbook, backfill]
requires: [94-01, 94-06]
provides: [batch-cycle-recompute CLI, Phase 94 RUNBOOK section]
affects: [94-09, 94-11, 94-12 acceptance checks]
key-files:
  created:
    - zoho-middleware/scripts/backfill/batch-cycle-recompute.js
    - zoho-middleware/__tests__/backfill/batch-cycle-recompute.test.js
    - zoho-middleware/__tests__/db/batch-cycle-recompute.test.js
  modified:
    - zoho-middleware/scripts/backfill/README.md
    - docs/RUNBOOK.md
decisions:
  - "Recompute uses four constant read-only queries (per type, total, excluded, coverage) in one read-only transaction; year is the only bound parameter"
  - "Statistics rounded to whole days; no ids ever logged"
metrics:
  tasks: 2
  completed: 2026-10-27
---

# Phase 94 Plan 13: Cycle recompute CLI and RUNBOOK Summary

Read-only `batch-cycle-recompute.js` computes calendar-YTD (Vancouver) median/mean cycle days with SQL `percentile_cont`, independent of the dashboard JS, and reports `null_batch_type` and `needs_a_type` counts; the RUNBOOK documents the staging-Postgres-only / production-replay-and-verify procedure.

## Commits
- e1bafce6: recompute CLI + unit and real-Postgres tests
- b1f68b89: RUNBOOK section + README entries

## TDD red run (not committed red, per CLAUDE.md rule 1)
First run of the unit test failed to load: `Cannot find module '../../scripts/backfill/batch-cycle-recompute'`, 0 tests ran. Green after the CLI: 6/6.

## Verification (Node 24)
- Middleware `npm test` 250 suites / 3663 tests; root `npm test` 211 / 2830; both lints clean (--max-warnings 0).
- Added a real-Postgres test (`__tests__/db/batch-cycle-recompute.test.js`, Testcontainers) proving the SQL is valid and that the Vancouver-day boundary is respected (completed 2026-01-12T03:00Z counts as Jan 11). Passes.
- The CLI was never run against any real DATABASE_URL.

## Deviations from Plan
- [Rule 2 - extra test] Added the real-PG test, beyond the plan's fake-pool test, because constant SQL against fake pools cannot catch syntax or parameter-typing errors.
- Worktree base was behind; reset to 5b2598b5 per the branch check, then `npm ci` in both package roots.
- RUNBOOK section also documents the step list in the plan's (a)-(g) order, reworded into subsections. No existing tests or sections modified.

## Known Stubs
None.

## Self-Check: PASSED
