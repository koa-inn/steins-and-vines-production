---
phase: 90-brewpad-batch-invoice-linking
plan: 01
subsystem: batches
tags: [apps-script, postgres, batch-source, guard]
requires: []
provides:
  - batchSourceTransitionDecision (adminApi.gs) and sourceTransitionDecision (batch-rules.js), identical truth table
  - updateBatch source guard in sheets and Postgres stores
affects: [90-03, 90-06]
key-files:
  created:
    - tests/frontend/adminapi-batch-source-edit.test.js
    - tests/frontend/adminapi-batch-create-invoice.test.js
    - zoho-middleware/__tests__/batch-rules-source.test.js
    - zoho-middleware/__tests__/db/batch-pg-update-source.test.js
    - zoho-middleware/__tests__/db/batch-pg-create-internal.test.js
  modified:
    - apps-script/adminApi.gs
    - zoho-middleware/lib/batch-rules.js
    - zoho-middleware/lib/batch-pg-update.js
decisions:
  - Off-list target source values are dropped (not rejected); manual/internal against a locked source is rejected invalid_source before any write (D-05 refinement)
  - Blank legacy source counts as manual
metrics:
  tasks: 3
  completed: 2026-10-14
---

# Phase 90 Plan 01: Source edit guard Summary

`source` is now editable after creation, restricted to manual and internal, in both the Apps Script sheets store and the middleware Postgres store, with one shared truth table proven identical by a parity test.

PLAN_BASE: 821461110d853dc4153ace10df944a3df6ae4443 (worktree was reset to this base at start; it had started on eaf0b8cc).

## Commits
- d2419b77: pure decision in both stores + vector/parity tests
- ed40feb2: Apps Script updateBatch guard (placed after the optimistic lock, before locationChanged/VesselHistory) + `'source'` in allowedFields + create round-trip tests
- 841de6ff: Postgres guard (shallow copy of updates, never mutates caller) + `source: 'text'` in FIELD_KINDS + real-PG tests

## RED evidence
- Task 1: `TypeError: api.batchSourceTransitionDecision is not a function` on all vectors.
- Task 2: 3 of 4 updateBatch cases failed (blank to internal not written, kiosk_recipe not rejected, ordering assertion); create round-trip tests already passed since createBatch needed no change.
- Task 3: 3 of 4 PG update cases failed (source not written, locked source not rejected, internal not stored); create tests already passed.

## Deviations from Plan
- [Rule 3 - Blocking] Worktree base was eaf0b8cc, not the required base; reset to 82146111 per the startup instruction (tree was clean).
- Environment: `nvm` sourcing is blocked in the sandbox, so Node 24.21.0 was used by prepending its bin dir to PATH.
- Real-PG suites hit sporadic 120s container-start timeouts when run together while sibling worktrees were also starting containers; each suite passed when rerun (batch-pg-update, batch-pg-create, batch-pg-create-internal, batch-pg-update-source all green).

## Verification (Node 24)
- Root: 180 suites / 2395 tests pass; lint clean.
- Middleware: 216 suites / 3232 tests pass; lint clean.
- DB suites: batch-pg-update (unedited, pinned source:'x' test), batch-pg-create, batch-pg-create-internal, batch-pg-update-source all pass.
- No existing test file edited; no build run; adminApi.gs not deployed.

## Known Stubs
None.

## Threat Flags
None.

## Self-Check: PASSED
