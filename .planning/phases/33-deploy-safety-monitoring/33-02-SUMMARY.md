---
phase: 33-deploy-safety-monitoring
plan: "02"
subsystem: ci-cd
tags: [github-actions, deploy, railway, runbook, production-safety]
dependency_graph:
  requires: []
  provides: [gated-deploy-workflow, production-runbook]
  affects: [.github/workflows/gated-deploy.yml, docs/RUNBOOK.md]
tech_stack:
  added: []
  patterns: [workflow_dispatch gate, needs dependency, if:always() cleanup, if:success()||failure() record]
key_files:
  created:
    - .github/workflows/gated-deploy.yml
    - docs/RUNBOOK.md
  modified: []
decisions:
  - "D-01: Gate prod deploys via GitHub Actions workflow_dispatch"
  - "D-02: Manual trigger only — no push trigger"
  - "D-03: Both test suites (frontend + middleware) must pass to gate deploy"
  - "D-04: Post-deploy /health smoke-check required"
  - "D-05: redis:false/non-200 = hard-fail; authenticated:false = soft-warn"
  - "D-06: prod-YYYYMMDD-N tag + runbook entry written before smoke-check"
  - "D-07: RUNBOOK.md tracked doc with rollback procedures"
  - "Approach A (Railway Wait for CI) primary; Approach B (railway up) documented as fallback"
metrics:
  duration: "~5 minutes"
  completed: "2026-06-18"
  tasks_completed: 2
  tasks_total: 2
---

# Phase 33 Plan 02: Gated Production Deploy + Rollback Runbook Summary

**One-liner:** GitHub Actions `workflow_dispatch` deploy gate with test-gated force-push, prod-YYYYMMDD-N tagging, /health smoke-check (hard redis/200, soft authenticated), and a RUNBOOK.md that records every deploy and documents both rollback paths.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Create gated-deploy.yml (test gate + CNAME swap + force-push + smoke-check) | `ce78462` | `.github/workflows/gated-deploy.yml` |
| 2 | Create docs/RUNBOOK.md with deploy history + rollback + prerequisites | `010b041` | `docs/RUNBOOK.md` |

## What Was Built

### Task 1: `.github/workflows/gated-deploy.yml`

A `workflow_dispatch`-only workflow with:

- **Two parallel test jobs** (`test-middleware`, `test-frontend`) copied exactly from `tests.yml` including lint and audit steps. No E2E job.
- **Deploy job** with `needs: [test-middleware, test-frontend]` — either failure blocks production.
- **Step ordering** designed around DEPLOY-02 invariant (record survives a failed smoke-check):
  - (b) CNAME pre-flight guard — aborts if CNAME is already `steinsandvines.ca` (stuck-mid-swap detection)
  - (c) Set CNAME + commit `[skip ci]`
  - (d) Force-push to production via `PROD_DEPLOY_TOKEN`
  - (e) Railway Approach A note (Wait for CI — documented; Approach B fallback in comments)
  - (f) `id: meta` — captures short SHA + Railway deploy ID via `railway deployment list --service sv_middleware --json --limit 1 | jq -r '.[0].id'`; `if: success() || failure()`; gracefully falls back to `unknown` if `RAILWAY_TOKEN` absent
  - (g) Annotated tag `prod-YYYYMMDD-N` pushed to both remotes; `if: success() || failure()`
  - (h) RUNBOOK.md row appended + committed `[skip ci]`; `if: success() || failure()` — written BEFORE smoke-check
  - (i) Smoke-check: 5 retries x 20s; hard-fail on non-200 or `redis != true`; soft-warn on `authenticated == false` with `/auth/zoho` URL
  - (j) CNAME restore to `staging.steinsandvines.ca`; `if: always()` — runs even if smoke-check exits 1

Security mitigations applied (T-33-04 through T-33-SC):
- `PROD_DEPLOY_TOKEN` and `RAILWAY_TOKEN` only referenced via `${{ secrets.* }}` (Actions masks them); never echoed
- CNAME guard aborts on stuck-swap state (T-33-07)
- Smoke-check exit 1 on redis:false is mandatory (T-33-08)

### Task 2: `docs/RUNBOOK.md`

Six sections:
1. **Overview** — blessed path (workflow_dispatch) vs break-glass (manual force-push) table
2. **Deploy History** — markdown table with `| Date | Git SHA | Railway Deploy ID | Deploy URL | Notes |` header + HTML comment anchor for workflow appends
3. **Rollback** — two subsections:
   - GitHub Pages: `git revert --no-edit HEAD` + `git push production main --force` (CNAME note)
   - Railway: dashboard 3-dot Rollback + `deploymentRollback(id)` GraphQL mutation; explicitly states `railway deployment redeploy` is NOT a rollback
4. **Smoke-check semantics** — table: hard (non-200/redis:false), soft (authenticated:false)
5. **Human prerequisites** — PROD_DEPLOY_TOKEN, RAILWAY_TOKEN, UptimeRobot keyword monitor (`"redis":true`), Railway Wait for CI + Approach B fallback, Phase 32 secrets checklist
6. **CNAME reference** — swap ritual, enforce-cname.yml broken warning, gitignore-but-tracked clarification

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. The workflow references `secrets.PROD_DEPLOY_TOKEN` and `secrets.RAILWAY_TOKEN` which must be created by a human (documented in RUNBOOK.md prerequisites). These are intentional human-action prerequisites, not stubs.

## Threat Flags

No new threat surfaces beyond those in the plan's threat_model (T-33-04 through T-33-SC, all mitigated).

## Self-Check

**Created files exist:**
- `.github/workflows/gated-deploy.yml` — FOUND
- `docs/RUNBOOK.md` — FOUND

**Commits exist:**
- `ce78462` — feat(33-02): add gated production deploy workflow — FOUND
- `010b041` — docs(33-02): create production deploy runbook — FOUND

**YAML parse:** `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/gated-deploy.yml'))"` — exits 0

**Key pattern grep results (all OK):**
- `workflow_dispatch`: found; no `push:` trigger
- `needs: [test-middleware, test-frontend]`: found
- `if: always()` (CNAME restore): found
- `if: success() || failure()` (tag + runbook steps): found
- `auth/zoho` (soft warn): found
- `railway deployment list --service sv_middleware --json --limit 1`: found
- No `echo.*${{ secrets.*}}` patterns

## Self-Check: PASSED
