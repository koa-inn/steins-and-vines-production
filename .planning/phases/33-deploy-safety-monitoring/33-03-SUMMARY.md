---
phase: 33-deploy-safety-monitoring
plan: "03"
subsystem: ci-cd
tags: [deploy, monitoring, uptimerobot, railway, secrets, human-uat, production-safety]
dependency_graph:
  requires: [gated-deploy-workflow, production-runbook, validateEnv-prod-secret-gate, snapshot-cross-push]
  provides: [first-gated-deploy-proof, uptime-monitor, secrets-posture-closure]
  affects:
    - .planning/phases/33-deploy-safety-monitoring/33-HUMAN-UAT.md
    - .planning/phases/32-fail-closed-hardening-access-control/32-HUMAN-UAT.md
    - .github/workflows/gated-deploy.yml
tech_stack:
  added: []
  patterns: [workflow_dispatch deploy, per-remote token auth, persist-credentials-false, swap-then-reset CNAME, if:success() record-on-deploy]
key_files:
  created:
    - .planning/phases/33-deploy-safety-monitoring/33-HUMAN-UAT.md
  modified:
    - .github/workflows/gated-deploy.yml
    - .planning/phases/32-fail-closed-hardening-access-control/32-HUMAN-UAT.md
decisions:
  - "D-08: UptimeRobot free-tier keyword monitor on /health every 5 min, email alert (MONITOR-01)"
  - "D-09: MONITOR-02 secrets verified by a healthy post-deploy boot + human Railway confirmation"
  - "Deploy-time fix: staging pushes use GITHUB_TOKEN; production uses prod-scoped PROD_DEPLOY_TOKEN; persist-credentials:false so neither overrides the other"
  - "Deploy-time fix: swap CNAME -> force-push to prod -> reset swap commit locally, so staging is never polluted and no CNAME-restore step is needed"
  - "Deploy-time fix: record steps gated on if:success() (not success()||failure()) so a failed deploy writes no false RUNBOOK row / tag"
metrics:
  duration: "~1 session (human-gated checkpoint)"
  completed: "2026-06-18"
  tasks_completed: 3
  tasks_total: 3
---

# Phase 33 Plan 03: First Gated Deploy + Uptime Monitoring + Secrets Closure Summary

**One-liner:** Wired the deploy secrets and Railway "Wait for CI", stood up the UptimeRobot /health keyword monitor (MONITOR-01), ran the first gated production deploy end-to-end (DEPLOY-01/02/03 proven live), and closed the MONITOR-02 secrets posture plus the carried-over Phase 32 UAT — fixing three real gated-deploy workflow bugs surfaced by the live run.

## Tasks Completed

| # | Task | Type | Evidence |
|---|------|------|----------|
| 1 | Create deploy secrets + enable Railway "Wait for CI" | human-action | `PROD_DEPLOY_TOKEN` (fine-grained, prod repo, Contents+Workflows:write) + `RAILWAY_TOKEN` (project token, production) as Actions secrets on staging; Wait-for-CI on |
| 2 | Create UptimeRobot /health keyword monitor (MONITOR-01) | human-action | Keyword monitor on `/health`, keyword `"redis":true`, 5-min interval, email alert |
| 3 | Run first gated deploy + verify chain + MONITOR-02 | human-verify | Run 27765441259 green; tag `prod-20260618-1`; healthy redeploy boot |

## What Was Built / Verified

- **First gated deploy (run 27765441259, commit `04c09d9`):** `test-middleware` + `test-frontend` passed and gated the deploy job (DEPLOY-01). Force-push to production succeeded; production HEAD = the prod-CNAME commit; production CNAME = `steinsandvines.ca`.
- **DEPLOY-02 record:** annotated tag `prod-20260618-1` on BOTH repos; `docs/RUNBOOK.md` row written with git SHA `04c09d98` + real Railway deploy ID `0461dc19-d188-48e9-858e-c33d6a996d17`.
- **DEPLOY-03:** production repo `content/zoho-snapshot.json` generated_at `2026-06-18T10:00:31Z` (~4.5h, within 25h). The nightly bot runs daily and (via 33-01) now dual-pushes to production so a prod deploy can't revert it.
- **MONITOR-01:** UptimeRobot keyword monitor live on `/health`.
- **MONITOR-02 / D-09:** middleware redeployed and booted healthy (`/health` 200, redis:true, uptime ~458s) with `SENTRY_DSN` + `HELCIM_API_TOKEN` now `REQUIRED_IN_PROD` — proving the full prod-secret set is present. Closed the three pending Phase 32 UAT items (NODE_ENV, RAILWAY_ENVIRONMENT, four prod secrets incl. #106 REDIS_ENCRYPTION_KEY).
- **CNAME:** production `steinsandvines.ca`, staging `staging.steinsandvines.ca` — clean.

## Deviations from Plan

The plan's three tasks were pure human-action/verify, but the first live deploy exposed three real bugs in `gated-deploy.yml` (created by 33-02) that had to be fixed forward before the deploy could pass:

1. **`8c52d46`** — staging pushes (tag, runbook, CNAME) 403'd because checkout authenticated `origin` with the production-scoped `PROD_DEPLOY_TOKEN`. Fixed: checkout uses the default `GITHUB_TOKEN`.
2. **`560cef1`** — production push then 403'd as `github-actions[bot]` because `actions/checkout` persists an `http.extraheader` that overrides URL-embedded tokens. Fixed: `persist-credentials: false` + point `origin` at a `GITHUB_TOKEN` URL so each remote uses its own token.
3. **`04c09d9`** — failure-safe redesign: capture deploy SHA pre-swap; swap CNAME → force-push → `git reset --hard` the swap commit away (origin never sees it, no CNAME-restore step); gate the Railway-ID/tag/runbook steps on `if: success()` so a failed deploy writes no false record.

Human-side: `PROD_DEPLOY_TOKEN` also needed the **Workflows: Read and write** permission (the force-push carries `.github/workflows/`). A failed run #2 left junk commits + a spurious `prod-20260618-1` tag on staging; both were cleaned up (force-push of clean main + tag deletion) before the successful run.

## Known Follow-ups (non-blocking)

- **Live-site snapshot cache lag:** `steinsandvines.ca/content/zoho-snapshot.json` still served the 06-16 snapshot at verification (Cloudflare/Pages cache); the production repo is fresh. Will clear on Pages rebuild + Cloudflare TTL, or a manual Cloudflare purge.
- **Storefront UptimeRobot monitor (if added):** Cloudflare Bot Fight Mode may 403 UptimeRobot's probe on `steinsandvines.ca` (it 403'd bare curl). The `/health` monitor is unaffected (Railway is not behind Cloudflare). Confirm any homepage monitor reports UP; if not, allowlist UptimeRobot or rely on /health.

## Self-Check

**Created/updated artifacts exist:**
- `.planning/phases/33-deploy-safety-monitoring/33-HUMAN-UAT.md` (status: passed, 3/3) — FOUND
- `.planning/phases/32-fail-closed-hardening-access-control/32-HUMAN-UAT.md` (status: passed, 3/3, closed_by 33-03) — FOUND
- `.github/workflows/gated-deploy.yml` — redesigned, YAML valid

**Live verification (2026-06-18):**
- Run 27765441259 conclusion: success
- Tag `prod-20260618-1`: present on staging + production
- `/health`: HTTP 200, redis:true, uptime ~458s (redeployed)
- steinsandvines.ca: HTTP 200 (browser UA)
- production repo snapshot generated_at: 2026-06-18T10:00:31Z (within 25h)

## Self-Check: PASSED
