# Phase 33: Deploy Safety & Monitoring - Context

**Gathered:** 2026-06-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Make production deploys *safe* (test-gated, tagged, rollback-ready) and *observed* (uptime + secrets verified) — **without changing application behavior**. Five requirements:

**In scope:**
- **DEPLOY-01** — Production deploys are gated on the test suite; failing frontend OR middleware tests block the deploy.
- **DEPLOY-02** — Every prod deploy is tagged (`prod-YYYYMMDD-N`) and a rollback runbook pairs the git SHA with the Railway deploy.
- **DEPLOY-03** — The nightly Zoho snapshot reliably reaches the live prod site (fix the `[skip ci]` + force-push interaction that leaves `content/zoho-snapshot.json` stale).
- **MONITOR-01** — An external uptime monitor polls middleware `/health` every ~5 min and alerts on downtime / `authenticated:false` / `redis:false`.
- **MONITOR-02** — Required prod secrets (`HELCIM_WEBHOOK_SECRET`, `RECAPTCHA_SECRET_KEY`, `SENTRY_DSN`) are verified present in Railway; their absence fails closed (the *code* half shipped in Phase 32's `validateEnv.js`).

**Out of scope (deferred):**
- A separate staging-middleware environment / sandbox Zoho+Helcim (still deferred; one shared middleware instance remains the model).
- Decomposing `processCheckout()` (deferred since Phase 31).
- Any new application features or copy changes.
- Fixing `enforce-cname.yml` itself (broken/403) beyond what's needed to keep CNAME correct through the new deploy flow.
</domain>

<decisions>
## Implementation Decisions

All decisions below are LOCKED.

### Deploy gating & trigger (DEPLOY-01)
- **D-01:** Gate prod deploys via a **GitHub Actions deploy workflow** that runs the test suite first and deploys (frontend + middleware) ONLY on green. This replaces the ungated manual `git push production main --force` ritual as the *blessed* path.
- **D-02:** **Trigger = manual `workflow_dispatch`** ("Deploy to prod" button), NOT auto-on-push. This preserves the hard **staging-first** rule: human approves on staging, then deliberately triggers the gated prod deploy. Auto-deploy-on-every-push was explicitly rejected.
- **D-03:** The workflow gates **both** surfaces: frontend (GitHub Pages on the `*-production` repo) AND middleware (Railway). Failing `tests.yml` (frontend jsdom suite) OR the middleware Jest suite must block the whole deploy.

### Post-deploy verification (DEPLOY-01 ↔ MONITOR-01/02 tie-in)
- **D-04:** After deploying, the workflow **smoke-tests `/health`** and requires a healthy response before declaring success; an unhealthy deploy fails loudly (and alerts), catching breakage immediately rather than waiting for the 5-min external monitor.
- **D-05:** **Smoke-check semantics (researcher/planner MUST resolve the Zoho-auth nuance):** `/health` returns `{status, authenticated, redis, uptime}`. `redis:true` + HTTP 200 are **hard** pass conditions. BUT `authenticated` reflects **Zoho OAuth, which drops on every middleware restart** (re-auth via `/auth/zoho`) — so a fresh Railway redeploy can legitimately report `authenticated:false`. Do NOT hard-fail the deploy on `authenticated:false` immediately post-deploy; treat it as a warning / trigger a re-auth step / allow a grace window. (This is a real landmine — see code_context.)

### Deploy tagging & rollback runbook (DEPLOY-02)
- **D-06:** **Scripted into the deploy flow** — the workflow auto-creates the `prod-YYYYMMDD-N` git tag and appends a runbook entry pairing the deployed git SHA with the Railway deploy ID, so a rollback can be initiated from either end without manual record-keeping. Manual-only and hybrid options were rejected.
- **D-07:** Runbook lives as a tracked doc (e.g. `docs/RUNBOOK.md` — exact path planner's choice) that the deploy flow appends to; it must include the rollback procedure for both surfaces (Pages revert + Railway deploy rollback).

### Uptime monitoring (MONITOR-01)
- **D-08:** **UptimeRobot (free tier)** polling `/health` every 5 min, alerting via **email**. Use its HTTP **keyword** monitoring to assert the body contains `"redis":true` (and ideally `"authenticated":true`), not just HTTP 200 — a 200 with `redis:false` must alert. Cloudflare Health Checks rejected (paid Pro+ feature → added cost); GitHub Actions cron rejected (maintenance + granularity).

### Secrets verification (MONITOR-02)
- **D-09:** The *code* fail-closed half is **already done** (Phase 32 `validateEnv.js` `REQUIRED_IN_PROD` boot gate). This phase's MONITOR-02 work is **verification that the secrets are present in Railway** — satisfied largely by the D-04 post-deploy `/health` smoke check (a booted, healthy middleware proves the boot gate passed, i.e. secrets present) PLUS the one-time human Railway check. This overlaps the pending Phase 32-03 human-action UAT (`NODE_ENV=production` + 4 prod secrets) — close them together.

### Snapshot staleness (DEPLOY-03)
- **D-10:** **Fix mechanism left to research/planning.** It's a diagnostic CI-interaction bug (`[skip ci]` + force-push leaves the static fallback stale). The researcher must pin the exact root cause in `update-snapshot.yml` and the prod-deploy interaction, then pick the cleanest fix. Acceptance: `content/zoho-snapshot.json` is reliably current at `steinsandvines.ca/content/zoho-snapshot.json`. Candidate shapes considered (commit-to-prod-repo / regenerate-during-deploy) are NOT locked — research decides.

### Claude's Discretion
- DEPLOY-03 fix mechanism (D-10).
- Exact runbook file path/format (D-07).
- Whether the gated deploy workflow lives on the staging repo (deploying *to* production) or on the production repo as `workflow_dispatch` — planner decides based on the two-repo/force-push reality (see code_context). The locked constraint is: manual trigger, tests-gated, both surfaces, post-deploy health check.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Deploy pipeline (existing — modify, don't reinvent)
- `.github/workflows/deploy-production.yml` — current prod deploy: triggers on push to `main`, checks repo is `*-production`, deploys GitHub Pages. The new gate/trigger builds on this.
- `.github/workflows/tests.yml` — the test suite to gate on (push + PR to main). Reuse as the gating job (`needs:` or `workflow_call`).
- `.github/workflows/update-snapshot.yml` — the nightly Zoho snapshot job at the heart of DEPLOY-03.
- `.github/workflows/enforce-cname.yml` — **BROKEN (403 on Pages PUT)**; does NOT auto-pin CNAME. Context for why CNAME handling must be preserved manually in any new deploy flow.
- `railway.toml` (repo root) — Railway middleware deploy config: build `cd zoho-middleware && npm install --production`, `watchPatterns = ["zoho-middleware/**"]` (auto-deploys on middleware changes), start `node server.js`. Gating Railway means coordinating with this auto-deploy.
- `CLAUDE.md` §Deployment — the two-repo / two-domain model, `git push production main --force`, CNAME-in-`.gitignore` vs tracked nuance, staging-first mandatory rule.

### Monitoring / health
- `zoho-middleware/server.js:103` — `/health` endpoint; returns `{status:'ok', authenticated, redis, uptime}`. The smoke-check (D-04/D-05) and UptimeRobot keyword (D-08) target this exact shape.
- `zoho-middleware/lib/validateEnv.js` — Phase 32 boot gate (`REQUIRED_IN_PROD`); MONITOR-02's fail-closed code half.

### Cross-phase carry-forward
- `.planning/phases/32-fail-closed-hardening-access-control/32-CONTEXT.md` §D-02 — `NODE_ENV=production` Railway pinning + boot assertion (one shared middleware instance `svmiddleware-production`).
- `.planning/phases/32-fail-closed-hardening-access-control/32-HUMAN-UAT.md` — the pending Railway secrets/`NODE_ENV` human action that MONITOR-02 (D-09) closes.
- `content/zoho-snapshot.json` — the artifact DEPLOY-03 must keep live.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`/health` endpoint** (`server.js:103`): already reports `authenticated` + `redis` — no new endpoint needed for MONITOR-01 or the D-04 smoke check; consume the existing shape.
- **`tests.yml`**: the frontend + middleware test jobs already exist — the deploy gate reuses them rather than re-defining test steps.
- **`deploy-production.yml`**: the Pages deploy job + `*-production` repo guard already exist — extend with a `needs: <tests>` gate and a `workflow_dispatch` trigger.

### Established Patterns
- **Two-repo deploy model:** `origin` → staging repo → `staging.steinsandvines.ca`; `production` → production repo → `steinsandvines.ca`. Prod ships via `git push production main --force`. Any gated workflow must respect this split and not break the CNAME pinning (enforce-cname.yml is broken; CNAME must stay correct per repo).
- **Railway auto-deploy:** middleware redeploys automatically on `zoho-middleware/**` changes (railway.toml watchPatterns). Test-gating the middleware deploy means either disabling auto-deploy + using `railway up`/a deploy hook from the workflow, or accepting a post-deploy health gate as the safety net. Researcher to determine the Railway deploy-trigger/rollback API.

### Integration Points / Landmines
- **⚠ Zoho re-auth on restart:** every middleware restart drops Zoho OAuth (`authenticated:false` until `/auth/zoho` is re-run). A post-deploy `/health` smoke check (D-04) must NOT hard-fail on `authenticated:false` right after a Railway redeploy — gate hard on `redis:true`+200, soft on `authenticated`. This same nuance affects what UptimeRobot should treat as a real alert vs transient.
- **⚠ CNAME / force-push:** moving prod deploy into an Actions workflow interacts with the CNAME-swap ritual and the broken enforce-cname.yml. The plan must keep `steinsandvines.ca` CNAME correct on the production repo through the new flow (untracking CNAME → 404).
- **Railway deploy ID:** DEPLOY-02's runbook needs the Railway deploy ID paired with the git SHA — researcher to find how to obtain it (Railway CLI/API) within the deploy flow.
</code_context>

<specifics>
## Specific Ideas

- Deploy trigger should feel like a deliberate "Deploy to prod" button (workflow_dispatch), matching the existing staging-first, human-approved cadence.
- Prefer free / zero-new-cost tooling (UptimeRobot free, GitHub Actions, scripted git tags) — consistent with the project's Cloudflare-free-tier / no-new-deps posture.
</specifics>

<deferred>
## Deferred Ideas

- Separate staging-middleware environment / sandbox Zoho+Helcim — explicitly out of scope (one shared middleware instance remains; deferred from Phase 32).
- Fixing `enforce-cname.yml` properly (the 403 Pages-PUT bug) — only touch if required to keep CNAME correct; a full fix is its own task.
- Richer observability (Sentry dashboards, structured deploy metrics, SLO tracking) beyond uptime + secrets — future phase if desired.

None of the above block Phase 33.
</deferred>

---

*Phase: 33-deploy-safety-monitoring*
*Context gathered: 2026-06-17*
