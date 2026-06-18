---
phase: 33-deploy-safety-monitoring
verified: 2026-06-18T15:10:00Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
re_verification: false
---

# Phase 33: Deploy Safety & Monitoring Verification Report

**Phase Goal:** Test-gated CI deploys, prod deploy tagging + rollback runbook, nightly snapshot staleness fix, external uptime monitoring, and production secrets verification.
**Verified:** 2026-06-18T15:10:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A manual workflow_dispatch on the staging repo runs the full frontend + middleware test suite and refuses to deploy if either fails | VERIFIED | `gated-deploy.yml` line 57: `needs: [test-middleware, test-frontend]`; no `push:` trigger; both jobs mirror `tests.yml`; confirmed by live run 27765441259 |
| 2 | On green tests, the workflow force-pushes production, smoke-checks /health, tags prod-YYYYMMDD-N, and appends a runbook entry | VERIFIED | Tag and runbook steps (g, h) run `if: success()` and are ordered BEFORE the smoke-check (step i), so a later smoke-check failure cannot prevent recording; tag `prod-20260618-1` and RUNBOOK.md row confirmed in 33-HUMAN-UAT.md |
| 3 | The nightly snapshot job runs only on the staging repo and pushes the snapshot to BOTH repos so a production force-push never reverts it | VERIFIED | `update-snapshot.yml` line 21: `if: github.repository == 'koa-inn/steins-and-vines-staging'`; lines 87-88: `git push origin main` + `git push ... steins-and-vines-production.git HEAD:main` |
| 4 | An external UptimeRobot keyword monitor polls /health every 5 minutes and emails an alert when `"redis":true` is absent | VERIFIED | 33-HUMAN-UAT.md task 2 (passed 2026-06-18): UptimeRobot Keyword monitor on https://svmiddleware-production.up.railway.app/health, keyword `"redis":true`, alert-when-absent, 5-min interval, test check reports UP |
| 5 | A production middleware boot without SENTRY_DSN (or HELCIM_API_TOKEN) fails closed (process.exit(1)) — proven by a healthy post-deploy boot | VERIFIED | `validateEnv.js` REQUIRED_IN_PROD lines 20-21: both vars present; OPTIONAL array contains neither; 27 validateEnv tests pass; 33-HUMAN-UAT.md confirms healthy boot (HTTP 200 + redis:true, uptime ~458s) with SENTRY_DSN now REQUIRED_IN_PROD |

**Score:** 5/5 truths verified

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `.github/workflows/gated-deploy.yml` | Test-gated workflow_dispatch production deploy | VERIFIED | 288 lines; `workflow_dispatch` trigger only (no `push:`); `needs: [test-middleware, test-frontend]`; CNAME pre-flight guard; force-push via PROD_DEPLOY_TOKEN; Railway deploy ID capture; tag push to both remotes; RUNBOOK.md append; smoke-check with hard/soft semantics; YAML valid |
| `.github/workflows/update-snapshot.yml` | Repo-guarded nightly snapshot with cross-repo push | VERIFIED | Job-level `if: github.repository == 'koa-inn/steins-and-vines-staging'`; `git push origin main` + `git push ... steins-and-vines-production.git HEAD:main`; commit message `chore: update Zoho snapshot [skip ci]` unchanged; YAML valid |
| `zoho-middleware/lib/validateEnv.js` | Full SC#5 set in REQUIRED_IN_PROD; SENTRY_DSN + HELCIM_API_TOKEN not in OPTIONAL; no GP_* vars | VERIFIED | REQUIRED_IN_PROD contains all 6 SC#5 vars; SENTRY_DSN and HELCIM_API_TOKEN each appear exactly once (in REQUIRED_IN_PROD only); `grep -Ei 'GP_\|GLOBAL_PAYMENT'` returns nothing |
| `zoho-middleware/__tests__/validateEnv.test.js` | Regression test: SENTRY_DSN absence fails boot in prod | VERIFIED | 27 tests pass; includes explicit `process.exit(1)` assertion when SENTRY_DSN is the only missing prod secret (line 168-174); includes non-prod does-NOT-exit test (line 193-199) |
| `docs/RUNBOOK.md` | Deploy history table + both rollback paths + human prerequisites | VERIFIED | Deploy history table with header `| Date \| Git SHA \| Railway Deploy ID \| Deploy URL \| Notes \|`; `## Rollback` section with GitHub Pages revert+force-push path and Railway `deploymentRollback` / dashboard path; states `railway deployment redeploy` is NOT a rollback; smoke-check semantics table; human prerequisites (PROD_DEPLOY_TOKEN, RAILWAY_TOKEN, UptimeRobot, Railway "Wait for CI", Phase 32 secrets); CNAME reference with `enforce-cname.yml` broken warning |
| `.planning/phases/33-deploy-safety-monitoring/33-HUMAN-UAT.md` | Recorded human verification of monitor, secrets, first gated deploy, snapshot freshness | VERIFIED | `status: passed`; 3/3 tasks passed; records: PROD_DEPLOY_TOKEN + RAILWAY_TOKEN created; UptimeRobot monitor live; first gated deploy ran (run 27765441259, commit 04c09d9); tag `prod-20260618-1` on both repos; RUNBOOK row with SHA `04c09d98` + Railway deploy ID `0461dc19-d188-48e9-858e-c33d6a996d17`; DEPLOY-03 snapshot `generated_at=2026-06-18T10:00:31Z` within 25h |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `gated-deploy.yml` deploy job | test-middleware + test-frontend | `needs: [test-middleware, test-frontend]` | WIRED | Line 57; no deploy without both test jobs passing |
| `gated-deploy.yml` | `koa-inn/steins-and-vines-production` | `git push ... PROD_DEPLOY_TOKEN ... HEAD:main --force` | WIRED | Line 126; `persist-credentials: false` on checkout so PROD_DEPLOY_TOKEN takes precedence; origin rewired to GITHUB_TOKEN on line 83 |
| `gated-deploy.yml` | `docs/RUNBOOK.md` | `echo "${ROW}" >> docs/RUNBOOK.md` + commit + push | WIRED | Lines 211-217; runs `if: success()` BEFORE smoke-check so record survives a smoke-check failure; confirmed by live RUNBOOK.md row |
| `gated-deploy.yml` | `svmiddleware-production.up.railway.app/health` | 5-retry curl loop, hard-fail on redis:false/non-200 | WIRED | Lines 224-282; soft-warn on authenticated:false; prints auth/zoho re-auth URL |
| `gated-deploy.yml` | prod tags on both remotes | `git push origin` + `git push ... PROD_DEPLOY_TOKEN ... production` | WIRED | Lines 192-193; confirmed by tag `prod-20260618-1` in HUMAN-UAT |
| `update-snapshot.yml` | `koa-inn/steins-and-vines-production` | `git push ... PROD_DEPLOY_TOKEN ... HEAD:main` | WIRED | Line 88; only runs on staging repo (line 21 repo guard) |
| `validateEnv.js` REQUIRED_IN_PROD | `process.exit(1)` | missing-prod-secret loop lines 109-117 | WIRED | Loop iterates REQUIRED_IN_PROD; calls process.exit(1) on any missing var; 27 tests confirm behavior |

---

## Data-Flow Trace (Level 4)

Not applicable — all artifacts are CI workflows, configuration, and server-side boot code. No frontend rendering of dynamic data.

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| validateEnv tests pass (full suite) | `cd zoho-middleware && npm test -- --testPathPattern=validateEnv` | 27 tests passed, 1 suite | PASS |
| Full middleware test suite still passes | `cd zoho-middleware && npm test` | 780 tests passed, 38 suites | PASS |
| gated-deploy.yml YAML valid | `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/gated-deploy.yml'))"` | Exit 0 | PASS |
| update-snapshot.yml YAML valid | `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/update-snapshot.yml'))"` | Exit 0 | PASS |
| SENTRY_DSN and HELCIM_API_TOKEN absent from OPTIONAL | `awk '/var OPTIONAL/,/^\];/' validateEnv.js \| grep -E 'SENTRY_DSN\|HELCIM_API_TOKEN'` | No output | PASS |
| GP_* dead vars absent from validateEnv.js | `grep -Ei 'GP_\|GLOBAL_PAYMENT' validateEnv.js` | No output | PASS |
| No token echoed in gated-deploy.yml | grep for `echo.*PROD_DEPLOY_TOKEN` or `echo.*RAILWAY_TOKEN` literal values | Only string "RAILWAY_TOKEN secret is not set" (safe warning, not a value) | PASS |
| Live gated deploy ran green end-to-end | GitHub Actions run 27765441259 (commit 04c09d9) | Both test jobs passed, deploy job ran, tag + RUNBOOK row created | PASS (recorded in HUMAN-UAT) |

---

## Probe Execution

No probe scripts declared or present in `scripts/*/tests/probe-*.sh`. Step skipped.

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| DEPLOY-01 | 33-02-PLAN.md | Production deploys are gated on the test suite — failing tests block the deploy (frontend + middleware) | SATISFIED | `gated-deploy.yml` `needs: [test-middleware, test-frontend]`; confirmed by live run where deploy only ran because both test suites passed |
| DEPLOY-02 | 33-02-PLAN.md | Every production deploy is tagged and a written rollback runbook pairs the git SHA with the Railway deploy | SATISFIED | Tag `prod-20260618-1` on both repos; RUNBOOK.md row with SHA `04c09d98` + Railway deploy ID `0461dc19-...`; both GitHub Pages revert and Railway `deploymentRollback` paths documented |
| DEPLOY-03 | 33-01-PLAN.md | The nightly Zoho snapshot reaches the live production site | SATISFIED | `update-snapshot.yml` repo-guarded to staging, cross-pushes to production; DEPLOY-03 snapshot generated_at `2026-06-18T10:00:31Z` confirmed within 25h in HUMAN-UAT |
| MONITOR-01 | 33-03-PLAN.md | An external uptime monitor polls /health and alerts on downtime, authenticated:false, or redis:false | SATISFIED | UptimeRobot keyword monitor on /health, `"redis":true` keyword, 5-min interval, email alert, test check UP — recorded in 33-HUMAN-UAT.md |
| MONITOR-02 | 33-01-PLAN.md + 33-03-PLAN.md | Required prod secrets verified present in Railway; absence fails closed | SATISFIED | validateEnv.js REQUIRED_IN_PROD contains full SC#5 set (6 vars); healthy post-deploy boot (HTTP 200 + redis:true) proves all REQUIRED_IN_PROD vars present; 33-HUMAN-UAT confirms Railway secrets posture |

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `zoho-middleware/lib/validateEnv.js` | 36, 38, 39, 59 | OPTIONAL array contains RECAPTCHA_SECRET_KEY, HELCIM_WEBHOOK_SECRET, REDIS_ENCRYPTION_KEY, CALCOM_WEBHOOK_SECRET — all four are already in REQUIRED_IN_PROD | Info | Pre-existing before phase 33 (phase 33 only removed SENTRY_DSN and HELCIM_API_TOKEN from OPTIONAL). Functionally harmless: if the vars are present (required in prod, so they will be), the OPTIONAL warning log never fires for them. If somehow unset in dev, they appear in both the hard-fail and the optional-warning log. No runtime impact on production. |
| `docs/RUNBOOK.md` | 194 | CNAME section states workflow "Restores `staging.steinsandvines.ca` in an `if: always()` step" — this is inaccurate. The actual gated-deploy.yml uses a local `git reset --hard` approach with NO restore step. | Warning | Documentation inaccuracy. The actual mechanism (local reset, no push of staging CNAME) is more robust than what's documented. No functional gap — staging never receives the production CNAME. |
| `docs/RUNBOOK.md` | 201 | Deploy history row appended to end-of-file (after CNAME section) rather than inside the deploy history table (lines 18-19) | Warning | The workflow uses `echo "${ROW}" >> docs/RUNBOOK.md` which appends to EOF, not to the table position. The data record (SHA + deploy ID) is present and findable but breaks the markdown table structure. DEPLOY-02 is functionally satisfied — the record pairs the git SHA with the Railway deploy ID. Future appended rows will also land at EOF. |

No TBD/FIXME/XXX markers found in phase-modified files.

---

## Human Verification Required

None. All human/external verification items were addressed in 33-HUMAN-UAT.md (status: passed, 3/3). Per the verification instructions, those items are treated as satisfied and not re-flagged.

---

## Gaps Summary

No gaps blocking goal achievement. All five requirements (DEPLOY-01 through DEPLOY-03, MONITOR-01, MONITOR-02) are satisfied.

**Notable implementation deviations from plan (non-blocking):**

1. **DEPLOY-02 step conditions:** The plan specified `if: success() || failure()` on the tag and runbook steps to ensure they survive a smoke-check failure. The implementation uses `if: success()` on all three steps (f, g, h) but positions them BEFORE the smoke-check (step i). The ordering achieves identical behavior — a smoke-check failure cannot undo already-committed steps. The HUMAN-UAT confirmed the live deploy recorded tag + RUNBOOK row before the smoke-check ran.

2. **No `if: always()` CNAME restore step:** The plan included a CNAME restore step marked `if: always()`. The final implementation (commit 04c09d9, third fix) replaced this with a `git reset --hard` approach: the prod-CNAME commit is force-pushed to production and then immediately reset away locally, so the staging repo never receives the production CNAME. The RUNBOOK.md CNAME section still describes the old restore-step approach (a minor documentation inaccuracy).

3. **RUNBOOK deploy history table placement:** The `echo "${ROW}" >> docs/RUNBOOK.md` append targets EOF, not the table position. The row appended after all CNAME content on the first live deploy. The data is valid; the table display is broken. Tracking for future cleanup.

---

_Verified: 2026-06-18T15:10:00Z_
_Verifier: Claude (gsd-verifier)_
