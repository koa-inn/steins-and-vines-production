---
phase: 89-beer-category-field-for-recipes
plan: 09
subsystem: release
tags: [staging, apps-script, runbook, uat]
requires: [89-01, 89-02, 89-03, 89-04, 89-05, 89-06, 89-07, 89-08]
provides: [Phase 89 live on staging, Apps Script v63 deployed, production promotion runsheet]
affects: [production promotion after 85-13]
key-files:
  modified: [docs/RUNBOOK.md]
metrics:
  tasks: 3
  completed: 2026-10-15
---

# Phase 89 Plan 09: Staging release, Apps Script deploy and UAT Summary

Phase 89 is live and approved on staging (middleware migration 0006, public API `beer_category`, tinted beer cards); Apps Script v63 is deployed (rollback v62); the production promotion is documented, not executed (D-13).

## Task 1: Gate, RUNBOOK, staging push, probe
- Node 24.21.0. Root: 178 suites / 2371 tests, lint clean. Middleware: 215 suites / 3214 tests, lint clean, migrate:guard 6 files additive-only OK. check-artifact-drift.sh PASS (its ?v= churn restored, never committed).
- DB suites (`jest.db.config.js recipe migrations`): the combined run failed intermittently with testcontainers `beforeAll` startup timeouts (21-30 failures, a different set each run; docker itself and a standalone container start fine; disabling ryuk did not help). Run per file, every file passed (recipe-pg-create, delete, read, update, beer-category, recipes-migration, recipes-beer-category-migration, recipes-backfill, recipes-rename-latency, migrations; a few needed attempt 2-3). Owner ACCEPTED this gate: code outside .planning/ is byte-identical to 89-08's build commit 07598231, which passed the full DB gate (10 suites, 64 tests); failures are environmental.
- RUNBOOK "Beer category (Phase 89)" section added between Phase 85 and Phase 86, with the production promotion runsheet and the Apps Script deploy-record row. Commit b34d96ee.
- Pre-push guard: only Phase 89, worktree-merge and planning-docs commits (all docs(90) commits verified .planning/-only).
- `git push origin main` (staging only): eaf0b8cc..b34d96ee; origin/main == main at push. Production remote untouched.
- Railway switched over after about 3 minutes; probe: `11 recipes, bad=0` (beer_category present, no non-public fields).

## Task 2: Apps Script deploy (owner)
- 2026-10-14: v63 deployed, rollback v62. setupRecipeBeerCategoryColumn ran OK. Production probes: Recipes list loaded 13 recipes, German Pilsner opened, draft "ZZ TEST 89 2026-10-14" create/edit/delete all succeeded, no console errors. RUNBOOK row filled (commit f9d86c4c).

## Task 3: Staging UAT
- All 11 categories set via staging BrewPad; API comparison against D-06: mismatches=0 (re-run 2026-10-15 by the executor too). Both non-active recipes blank, statuses unchanged.
- Clone keeps the category; staging beer.html tint classes correct on every card, no category text. Owner approved 2026-10-15. RUNBOOK §2 note added (commit 07a9ac4b).

## Deviations from Plan
- The staging admin view of SV-R-000003 (D-11 admin check) was not performed (needs a separate sign-in); the owner accepted this.
- DB gate accepted on per-file passes plus identical-code argument, as above.

## Known Stubs
None.

## Deferred / follow-ups
- Production promotion (after 85-13) per RUNBOOK; the Phase 85 D-14 callout stays until then. Promotion SHA is `_pending_` in the RUNBOOK.
- Testcontainers startup flakiness on this machine is unresolved (cause not found); worth its own issue.

## Self-Check: PASSED
RUNBOOK section present (one match each for the runsheet heading and "remove the Phase 85"); commits b34d96ee, f9d86c4c, 07a9ac4b exist.
