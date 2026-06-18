# Phase 33: Deploy Safety & Monitoring - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-17
**Phase:** 33-deploy-safety-monitoring
**Areas discussed:** Deploy-gating mechanism, Uptime monitor + alert channel, Deploy tagging + rollback runbook, Snapshot staleness fix

---

## Deploy-gating mechanism (DEPLOY-01)

| Option | Description | Selected |
|--------|-------------|----------|
| GitHub Actions deploy workflow (tests-then-deploy) | Convert manual prod push into a workflow that runs tests.yml first, deploys only on green | ✓ |
| Local pre-push git hook | Run tests before allowing `git push production`; bypassable, machine-local | |
| Branch protection / required checks | Require tests green before prod repo updates; complicated by `--force` + Railway | |

**User's choice:** GitHub Actions deploy workflow.
**Notes:** Follow-up locked the trigger and post-deploy behavior (below).

### Follow-up: Deploy trigger

| Option | Description | Selected |
|--------|-------------|----------|
| Manual "Deploy to prod" button (workflow_dispatch) | Click to deploy when ready; tests, then deploy on green — preserves staging-first control | ✓ |
| Auto on push to prod line | Every push deploys after tests pass | |
| Tag push (prod-*) triggers deploy | Tagging IS the deploy gesture | |

**User's choice:** Manual workflow_dispatch button.
**Notes:** Staging-first is a hard rule; user wants deliberate control over prod-deploy timing.

### Follow-up: Post-deploy verification

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — poll /health, require healthy | After deploy, require 200 + redis + authenticated; ties DEPLOY-01 to MONITOR-01/02 | ✓ |
| No — rely on external monitor | Keep deploy lean; UptimeRobot catches issues within ~5 min | |

**User's choice:** Yes — post-deploy /health smoke check.
**Notes:** Claude flagged the Zoho-auth-drops-on-restart landmine — captured as D-05 (hard-gate on redis+200, soft on authenticated).

---

## Uptime monitor + alert channel (MONITOR-01)

| Option | Description | Selected |
|--------|-------------|----------|
| UptimeRobot (free) → email | Free 5-min keyword monitoring on /health body; email alerts | ✓ |
| Cloudflare Health Checks | Native, but paid Pro+ feature → added cost | |
| GitHub Actions cron → issue/email | Free, in-repo, but maintenance + granularity | |

**User's choice:** UptimeRobot (free) → email.
**Notes:** Use keyword check on `"redis":true` / `"authenticated":true`, not just HTTP 200.

---

## Deploy tagging + rollback runbook (DEPLOY-02)

| Option | Description | Selected |
|--------|-------------|----------|
| Scripted into deploy flow | Auto-create prod-YYYYMMDD-N tag + append runbook entry (SHA ↔ Railway deploy ID) | ✓ |
| Manual checklist (docs/RUNBOOK.md) | Written runbook + manual `git tag` | |
| Hybrid: auto-tag, manual runbook | Automate tag, manual deploy-ID paste | |

**User's choice:** Scripted into deploy flow.
**Notes:** Rollback must cover both Pages and Railway.

---

## Snapshot staleness fix (DEPLOY-03)

| Option | Description | Selected |
|--------|-------------|----------|
| Leave mechanism to research | Diagnostic CI-interaction bug; researcher pins root cause + cleanest fix | ✓ |
| Commit snapshot to production repo | Nightly job writes content/zoho-snapshot.json into prod repo | |
| Regenerate during deploy | Deploy flow refreshes the snapshot | |

**User's choice:** Leave mechanism to research.
**Notes:** Acceptance is "snapshot reliably live at the prod URL"; fix shape not locked.

---

## Claude's Discretion

- DEPLOY-03 fix mechanism (root-cause + approach left to research/planning).
- Exact runbook file path/format.
- Whether the gated workflow lives on the staging repo (deploying to prod) or the production repo as workflow_dispatch — planner decides against the two-repo/force-push reality. Locked constraints: manual trigger, tests-gated, both surfaces, post-deploy health check.

## Deferred Ideas

- Separate staging-middleware environment / sandbox Zoho+Helcim (out of scope; one shared instance remains).
- Properly fixing the broken `enforce-cname.yml` (403) beyond keeping CNAME correct.
- Richer observability (Sentry dashboards, SLO tracking) beyond uptime + secrets.
