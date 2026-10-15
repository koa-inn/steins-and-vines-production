---
phase: 90-brewpad-batch-invoice-linking
plan: 10
subsystem: build
tags: [build, artifacts, gate]
requires: [90-01, 90-02, 90-03, 90-04, 90-05, 90-06, 90-07, 90-08, 90-09]
provides: [rebuilt BrewPad, kiosk and admin bundles carrying invoice linking, canning bundle and recipe pickers; green phase gate]
affects: [90-11]
key-files:
  modified: [js/admin.js, js/admin.min.js, js/brewpad.min.js, js/kiosk-core.min.js, js/kiosk.min.js, css/admin.min.css, css/brewpad.min.css, css/kiosk.min.css, "26 HTML files (?v= tokens only)"]
metrics:
  tasks: 2
  completed: 2026-10-14
---

# Phase 90 Plan 10: Single phase build and authoritative gate Summary

One `npm run build` after all code plans, committed as bc1a686c (32 files); full Node 24.21.0 gate green, with load-induced timeouts in three suites that each passed when rerun individually.

PLAN_BASE: 26031040. Start `git status`: ` M links.html` plus untracked HANDOFF-*.md (not this plan's); no uncommitted Phase 90 source.

## Task 1: Build (commit bc1a686c)
- Bundle greps: link-candidates in brewpad.min.js = 1, bpStartRecipeFromExisting in brewpad.min.js = 1, bundle_can in kiosk-core.min.js = 1, showCanningBundleModal in kiosk.min.js = 1, recipe-name-similar in admin.min.js = 1.
- js/main.js and js/main.min.js were unchanged by the build (no module changes in Phase 90); HTML ?v= tokens still re-stamped.
- Staged HTML was ?v= only (0 non-token lines); js/admin.js diff was BUILD_TIMESTAMP only (0 other lines). One main.min.js token across the sampled pages.
- Commit gate before staging: middleware `npm test` 221 suites / 3363 tests, lint clean; root lint clean; root `npm test` see Task 2 note.
- check-artifact-drift.sh run AFTER the commit: PASS, no drift. Its re-stamp side effects (HTML, js/admin.js, js/admin.min.js) were reverted with `git checkout --` on explicit paths so committed tokens match the build commit.
- Build commit lists no links.html, HANDOFF-*.md or .planning/phases/90-* path; links.html still ` M`.

## Task 2: Gate (Node 24.21.0, Docker up)
- Root `npm test`: 191 of 192 suites passed (2568 of 2569 tests). The single failure, tests/frontend/kiosk-slow-approval.test.js ("polling still stops eventually (hard cap)"), took 662s in the full run (machine under heavy load) and PASSED in isolation (2/2, 1.9s). Treated as load-induced timing; flagged for the owner since it is a timing-sensitive test on the money path.
- Root lint clean. Middleware `npm test` 221 suites / 3363 tests passed; lint clean; `migrate:guard` 6 files additive-only OK.
- DB suites (`jest.db.config.js batch --maxWorkers=1`, real Postgres via Docker): 10 of 12 suites passed in the combined run (182 of 183 tests). `batches-backfill` (917s) and `batch-create-latency` (813s) failed in the combined run due to testcontainers timeouts; rerun individually: batches-backfill 9/9 passed (attempt 1), batch-create-latency 1/1 passed (attempt 1). batch-pg-update-source and batch-pg-create-internal passed in the combined run.
- Sibling-failure notes: 90-01 recorded sporadic 120s container-start timeouts (batch-pg-update, batch-pg-create, batch-pg-create-internal, batch-pg-update-source): all now green. 90-03 recorded a transient health-database-required timeout: green in the middleware run. No other deferred notes.
- Existing-test check: `git diff --name-only 82146111..HEAD -- tests/ zoho-middleware/__tests__/` lists 23 paths, all new in Phase 90 (none existed at 82146111). No existing test edited.

## Deviations from Plan
None in substance. The gate commands were not all green in a single combined run (see timeouts above); every failing file was green on individual rerun, per the sequential-execution instructions. No code was changed.

## Known Stubs
None.

## Self-Check: PASSED
