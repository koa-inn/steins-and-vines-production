---
phase: 33-deploy-safety-monitoring
plan: "01"
subsystem: ci-cd
tags: [deploy-safety, monitoring, github-actions, validate-env, sentry, helcim]
dependency_graph:
  requires: []
  provides:
    - DEPLOY-03-fix: nightly snapshot cross-pushed to production so force-push cannot revert it
    - MONITOR-02-code: full ROADMAP SC#5 set enforced at prod boot (fail-closed)
  affects:
    - .github/workflows/update-snapshot.yml
    - zoho-middleware/lib/validateEnv.js
tech_stack:
  added: []
  patterns:
    - github-actions-repo-guard: job-level if condition on github.repository
    - cross-repo-push: x-access-token URL in git push with masked PAT
    - required-in-prod-array: validateEnv.js REQUIRED_IN_PROD loop enforces fail-closed boot
key_files:
  modified:
    - .github/workflows/update-snapshot.yml
    - zoho-middleware/lib/validateEnv.js
    - zoho-middleware/__tests__/validateEnv.test.js
decisions:
  - SENTRY_DSN and HELCIM_API_TOKEN both promoted to REQUIRED_IN_PROD per ROADMAP SC#5 (not scope creep — ROADMAP explicitly requires live Helcim/Cal.com/REDIS_ENCRYPTION_KEY coverage)
  - SENTRY_DSN and HELCIM_API_TOKEN removed from OPTIONAL array to avoid misleading startup log output after the hard gate
  - Token embedded inline in git push URL only; never echoed or stored in env var (T-33-01 mitigation)
  - HELCIM_API_TOKEN confirmed present in Railway production (payments live) — fail-closed boot gate will not strand a working deploy
metrics:
  duration: 253s
  completed: "2026-06-18"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 3
  commits: 3
---

# Phase 33 Plan 01: Deploy Safety — Snapshot Staleness Fix + validateEnv Prod Hardening Summary

**One-liner:** Repo-guarded nightly snapshot with cross-repo push to production (DEPLOY-03) + SENTRY_DSN and HELCIM_API_TOKEN promoted to fail-closed REQUIRED_IN_PROD completing ROADMAP SC#5 (MONITOR-02).

## What Was Built

### Task 1: Repo-guard update-snapshot.yml and cross-push to production

Modified `.github/workflows/update-snapshot.yml` with two targeted additions:

1. **Repo guard** — added `if: github.repository == 'koa-inn/steins-and-vines-staging'` at the job level. This prevents the production repo (which receives the file via force-push) from running its own divergent nightly snapshot job. Only the staging repo runs the cron.

2. **Dual push** — replaced bare `git push` with:
   - `git push origin main` (staging)
   - `git push https://x-access-token:${{ secrets.PROD_DEPLOY_TOKEN }}@github.com/koa-inn/steins-and-vines-production.git HEAD:main` (production)

   Renamed the step to "Commit and push to both repos". Token embedded inline in URL only — Actions auto-masks it; never echoed (T-33-01).

**Why this fixes DEPLOY-03:** The snapshot commit now lands on both repos in the same nightly run. The subsequent `git push production main --force` from a deploy carries the same snapshot (since staging has it too). Production can never revert to a stale snapshot via force-push.

**Commit:** `7826bef`

### Task 2: Promote SENTRY_DSN and HELCIM_API_TOKEN to REQUIRED_IN_PROD (TDD)

**RED** (`f10040e`): Added regression tests before implementation:
- Expanded `PROD_SECRETS` constant from 4 to 6 entries (added SENTRY_DSN, HELCIM_API_TOKEN)
- Updated `D-06` describe `beforeEach` and `D-02` railway test to set all 6 prod secrets
- Added failing tests: SENTRY_DSN missing in prod → exit(1), HELCIM_API_TOKEN missing in prod → exit(1)
- Added non-prod gate tests: neither var enforced outside production
- Result: 2 tests failing (expected RED)

**GREEN** (`2ddf3e5`): Implemented in `validateEnv.js`:
- Added `SENTRY_DSN` entry to `REQUIRED_IN_PROD` with MONITOR-02/ROADMAP SC#5/phase 33 reference
- Added `HELCIM_API_TOKEN` entry to `REQUIRED_IN_PROD` with live-Helcim/ROADMAP SC#5 reference
- Removed `SENTRY_DSN` from `OPTIONAL` (was line 29 — duplication eliminated)
- Removed `HELCIM_API_TOKEN` from `OPTIONAL` (was line 34 — duplication eliminated)
- `validateEnv()` function body unchanged — existing REQUIRED_IN_PROD loop at lines 106-117 handles new entries
- Result: 27/27 tests pass; full suite 780/780 pass; lint exits 0

**Full SC#5 set now in REQUIRED_IN_PROD:**
- RECAPTCHA_SECRET_KEY (HARDEN-01)
- HELCIM_WEBHOOK_SECRET (HARDEN-02)
- CALCOM_WEBHOOK_SECRET (HARDEN-02)
- REDIS_ENCRYPTION_KEY (#106)
- SENTRY_DSN (MONITOR-02, phase 33)
- HELCIM_API_TOKEN (live Helcim, phase 33)

## Commits

| # | Hash | Type | Description |
|---|------|------|-------------|
| 1 | 7826bef | feat | Repo-guard update-snapshot.yml and cross-push to production |
| 2 | f10040e | test | Add failing tests for SENTRY_DSN and HELCIM_API_TOKEN prod enforcement (RED) |
| 3 | 2ddf3e5 | feat | Promote SENTRY_DSN and HELCIM_API_TOKEN to REQUIRED_IN_PROD (GREEN) |

## Deviations from Plan

### Auto-updated existing test infrastructure

**Rule 2 — Missing critical functionality**
- **Found during:** Task 2 RED phase
- **Issue:** Adding SENTRY_DSN and HELCIM_API_TOKEN to `REQUIRED_IN_PROD` would have broken the existing `D-06` describe block's `beforeEach` (which only set 4 prod secrets) and the `D-02` "does NOT exit when...prod" test. These tests would have started incorrectly asserting exit(1) for the new secrets.
- **Fix:** Updated `PROD_SECRETS` constant (6 entries), `D-06` `beforeEach` setEnv call, and the `D-02` prod-secrets setEnv call to include all 6 SC#5 secrets. This is required infrastructure change, not test-logic change — the tests still test the same behavior.
- **Files modified:** `zoho-middleware/__tests__/validateEnv.test.js`
- **Committed in:** `f10040e` (RED phase commit)

## TDD Gate Compliance

- RED gate commit: `f10040e` (`test(33-01):`prefix) — 2 tests failing as expected
- GREEN gate commit: `2ddf3e5` (`feat(33-01):` prefix) — all 27 tests passing
- No REFACTOR phase needed (implementation was a 6-line addition; no cleanup required)

## Threat Surface Scan

No new threat surface introduced:
- No new network endpoints
- No new auth paths
- No schema changes
- PROD_DEPLOY_TOKEN reference in workflow uses standard Actions secret masking pattern — token never logged (T-33-01 mitigated per plan threat register)

## Known Stubs

None. Both changes are complete implementations with no placeholders or deferred wiring.

## Self-Check: PASSED

- `.github/workflows/update-snapshot.yml` modified: `git show 7826bef:.github/workflows/update-snapshot.yml | grep -c "steins-and-vines-staging"` → 1
- `zoho-middleware/lib/validateEnv.js` modified: SENTRY_DSN and HELCIM_API_TOKEN each appear exactly once in file
- `zoho-middleware/__tests__/validateEnv.test.js` modified: 27 tests pass
- Commits 7826bef, f10040e, 2ddf3e5 exist in git log
- YAML validates clean: `python3 -c "import yaml; yaml.safe_load(open(...))"` exits 0
- No GP_/GLOBAL_PAYMENT vars in validateEnv.js
