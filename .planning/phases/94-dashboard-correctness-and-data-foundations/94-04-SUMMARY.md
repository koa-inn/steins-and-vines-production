---
phase: 94-dashboard-correctness-and-data-foundations
plan: 04
subsystem: middleware/batches
tags: [postgres, batch-type, completed-at, trusted-channel]
requires: [94-01]
provides: [manual batch_type edit, opts.trusted backfill channel, D-23 completed_at stamp, type re-derivation]
affects: [94-06 backfill CLIs, 94-03 create path]
key-files:
  modified:
    - zoho-middleware/lib/batch-pg-update.js
    - zoho-middleware/lib/batch-pg-tasks.js
  created:
    - zoho-middleware/__tests__/db/batch-pg-update-completed-stamp.test.js
    - zoho-middleware/__tests__/db/batch-pg-update-type.test.js
    - zoho-middleware/__tests__/batch-store-trusted.test.js
decisions:
  - "batch_type and the two source columns stay out of FIELD_KINDS; handled with their own addSet"
  - "Trusted completed_at only accepts source 'backfill-task'; trusted type sources limited to recipe/zoho/schedule/name/other"
  - "batch-store.js untouched: existing writeOpts already drops trusted (proved by new unit test)"
metrics:
  tasks: 3
  completed: 2026-10-27
---

# Phase 94 Plan 04: Update path for B3/B2 Summary

`updateBatch` now stamps `completed_at` on status to complete (source `status`), accepts a validated manual `batch_type`, exposes a server-only `opts.trusted` channel for the backfills, and re-derives weak types when a schedule or recipe is attached.

## Commits
- eb996f75: D-23 completed_at stamp + packaging source 'task'
- c638c235: manual batch_type + trusted channel (manual_locked, already_set)
- 33c220f4: re-derive on schedule/recipe attach

## TDD red run (Task 1, before the fix)
The regression test was run before any code change (not committed red, per CLAUDE.md rule 1):

```
FAIL __tests__/db/batch-pg-update-completed-stamp.test.js
  x stamps completed_at = now with source status when blank and none supplied
      TypeError: Cannot read properties of null (reading 'getTime')
  v leaves an existing completed_at and its source unchanged
  x keeps a supplied completed_at and marks the source manual   (Expected "manual", Received null)
  v does not touch completed_at on a change to primary
  x marks packaging-task completion with source task            (Expected "task", Received null)
Tests: 3 failed, 2 passed
```
All 5 pass after the fix.

## Verification
- Middleware `npm test` 243 suites / 3607 tests; root `npm test` 211 / 2830; both lints clean (Node 24).
- Full `npm run test:db`: 39 suites / 395 tests pass.
- Acceptance greps: no `trusted` in batch-store.js, batch-proxy.js (only an unrelated comment in routes/pos.js); no client source columns read.

## Deviations from Plan
- `__tests__/batch-store-trusted.test.js` listed in files_modified is a NEW file; no existing test was edited.
- Commit c638c235 left one comment that the plan's grep would match; reworded in 33c220f4 (comment only).
- Setup: worktree base reset to b83bc19f per branch check; `npm ci` in both package roots.

## Known Stubs
None.

## Self-Check: PASSED
