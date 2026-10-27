---
phase: 94-dashboard-correctness-and-data-foundations
plan: 06
subsystem: middleware/backfill
tags: [backfill, batch-type, completed-at, sheet-mirror-guard]
requires: [94-01, 94-04]
provides: [batch-type-backfill CLI, completed-at-backfill CLI, production-only replay guard]
affects: [94-09, 94-11, 94-12 owner-gated apply checkpoints]
key-files:
  created:
    - zoho-middleware/scripts/backfill/batch-type-backfill.js
    - zoho-middleware/scripts/backfill/completed-at-backfill.js
    - zoho-middleware/__tests__/backfill/batch-type-backfill-plan.test.js
    - zoho-middleware/__tests__/backfill/completed-at-backfill-plan.test.js
    - zoho-middleware/__tests__/backfill/batches-replay-staging-guard.test.js
    - zoho-middleware/__tests__/db/batch-type-backfill.test.js
    - zoho-middleware/__tests__/db/completed-at-backfill.test.js
  modified:
    - zoho-middleware/scripts/backfill/batches-replay-to-sheet.js
decisions:
  - "--expect without --apply is rejected, and --apply without --expect is rejected"
  - "Weak-source rows whose proposal equals the stored type+source are 'unchanged' and not candidates"
  - "'needs a type' counts rows whose final type is 'other'"
  - "Replay guard lives in main() only, so the existing runBatchesReplay tests are untouched"
metrics:
  tasks: 3
  completed: 2026-10-27
---

# Phase 94 Plan 06: Backfill CLIs and replay guard Summary

Two dry-run-by-default CLIs (type B3, completion date B2) that write only with `--apply --expect=<reviewed count>` through the trusted `updateBatch` channel, plus a production-only guard on `batches-replay-to-sheet.js`.

## Commits
- 6e683cba: batch-type-backfill CLI
- 297588ef: completed-at-backfill CLI
- c6597e09: replay guard on batches-replay-to-sheet.js

## TDD red runs (not committed red, per CLAUDE.md rule 1)
- Task 1: first run failed to load (`Cannot find module scripts/backfill/batch-type-backfill`), 0 tests ran.
- Task 2: `Cannot find module '../../scripts/backfill/completed-at-backfill'`, 0 tests ran.
- Task 3: guard test, 4 failed / 4 (assertProductionEnvironment undefined, spawn exited 0 path not guarded); green after the guard.

## Verification (Node 24)
- Middleware `npm test` 247 suites / 3642 tests; root `npm test` 211 / 2830; both lints clean.
- `npm run test:db` 42 suites / 409 tests pass (includes both new real-PG suites).
- `NODE_ENV=production RAILWAY_ENVIRONMENT_NAME=staging node scripts/backfill/batches-replay-to-sheet.js ...` prints the refusal and exits 1.
- `--apply` with no `BACKFILL_DATABASE_URL` exits 1 without connecting.
- No CLI was run against any real database, Zoho or sheet; no `--apply` against anything but Testcontainers.

## Deviations from Plan
- Worktree base was behind; reset to f4cab065 per the branch check, then `npm ci` in both package roots.
- Own-test fixes during Task 1/2 (test data, not product code): recipe style fallback needs an exact word (`Cider`, not `IPA`, per D-22); real-PG batch_tasks seed needs step_number/day_offset/last_updated; candidate count 3 not 4 (the beer/name row is unchanged).
- No existing test edited.

## Notes for follow-up (not fixed here)
- The sibling replay CLIs (gift-cards, recipes, ops) have no production-only guard.
- The Zoho `fetchAllItems()` list rows are assumed to carry `cf_type` (plan interface); the first real dry run on the owner's session will show it as `needs a type` growing if not. Dry-run output makes this visible before any `--apply`.

## Known Stubs
None.

## Self-Check: PASSED
