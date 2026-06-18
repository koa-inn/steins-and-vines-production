---
status: passed
phase: 33-deploy-safety-monitoring
source: [33-03-PLAN.md]
started: 2026-06-18T05:40:00Z
updated: 2026-06-18T14:35:00Z
---

## Current Test

All tasks complete — phase verification next.

## Tests

### 1. Deploy secrets created + Railway "Wait for CI" enabled (DEPLOY-01/02/03 enablement)
expected: `PROD_DEPLOY_TOKEN` (fine-grained PAT, resource owner koa-inn, repo koa-inn/steins-and-vines-production only, Contents:write, 1-year expiry) and `RAILWAY_TOKEN` (project token scoped to sv-middleware project + production environment) both exist as Actions secrets on the koa-inn/steins-and-vines-staging repo; Railway "Wait for CI" is enabled on svmiddleware-production. No token values recorded anywhere.
result: passed — 2026-06-18. PROD_DEPLOY_TOKEN added as Actions secret on the staging repo (fine-grained, production repo only, Contents:Read+Write, 1-year expiry). RAILWAY_TOKEN added as Actions secret on the staging repo (Railway project token, production environment). Railway "Wait for CI" enabled on svmiddleware-production. Token values not stored.

### 2. UptimeRobot /health keyword monitor live (MONITOR-01)
expected: A UptimeRobot Keyword monitor polls https://svmiddleware-production.up.railway.app/health every 5 minutes, keyword `"redis":true` (exists check — alerts when ABSENT or HTTP != 200), email alert configured. Exact keyword string matches the live /health serialization (confirmed by curl: `{"status":"ok","authenticated":true,"redis":true,...}`). A test check reports UP.
result: passed — 2026-06-18. UptimeRobot Keyword monitor created on https://svmiddleware-production.up.railway.app/health, keyword `"redis":true` (alert when not exists), 5-min interval, email alert. Test check reports UP.

### 3. First gated deploy ran green end-to-end + MONITOR-02 secrets posture closed (DEPLOY-01/02/03, MONITOR-02)
expected: gated-deploy.yml triggered via workflow_dispatch; deploy job ran only because both test jobs passed (DEPLOY-01); steinsandvines.ca loads and /health returns 200 + redis:true; a `prod-YYYYMMDD-N` tag exists on both repos; docs/RUNBOOK.md has a new deploy-history row pairing git SHA + Railway deploy ID (DEPLOY-02); CNAME restored to staging.steinsandvines.ca on staging and steinsandvines.ca does not 404; steinsandvines.ca/content/zoho-snapshot.json generated_at within 25h (DEPLOY-03); Railway confirmed NODE_ENV=production + all REQUIRED_IN_PROD secrets (incl. SENTRY_DSN, HELCIM_API_TOKEN) present (healthy boot proves the gate — MONITOR-02 / D-09); pending 32-HUMAN-UAT.md items closed.
result: passed — 2026-06-18. First gated deploy ran green (run 27765441259, commit 04c09d9). DEPLOY-01: test-middleware + test-frontend both passed and gated the deploy job. DEPLOY-02: tag `prod-20260618-1` created on BOTH staging and production repos; docs/RUNBOOK.md row written with git SHA `04c09d98` + real Railway deploy ID `0461dc19-d188-48e9-858e-c33d6a996d17`. CNAME verified: production=steinsandvines.ca, staging=staging.steinsandvines.ca (clean — redesigned flow resets the swap commit so staging is never polluted). steinsandvines.ca returns HTTP 200 with a browser UA (403 to bare curl = Cloudflare Bot Fight Mode, expected). /health = 200 + redis:true; uptime ~458s confirms the middleware redeployed and BOOTED HEALTHY with SENTRY_DSN + HELCIM_API_TOKEN now REQUIRED_IN_PROD — proves MONITOR-02 / D-09 secrets posture, and by extension the Phase 32 secrets (NODE_ENV=production + RECAPTCHA_SECRET_KEY, HELCIM_WEBHOOK_SECRET, CALCOM_WEBHOOK_SECRET, REDIS_ENCRYPTION_KEY all present). DEPLOY-03: production REPO snapshot generated_at=2026-06-18T10:00:31Z (~4.5h, within 25h); 33-01 dual-push guard in place so future nightly snapshots reach production.

Deviations / follow-ups (non-blocking):
- The gated-deploy workflow needed 3 fixes discovered during this checkpoint (commits 8c52d46, 560cef1, 04c09d9): (1) staging pushes must use GITHUB_TOKEN not the prod-scoped PAT; (2) persist-credentials:false so prod+staging use separate tokens; (3) failure-safe redesign (no false RUNBOOK rows / CNAME pollution on a failed deploy). PROD_DEPLOY_TOKEN also required the Workflows:write permission (human-added) because the force-push carries .github/workflows/.
- Live-site steinsandvines.ca/content/zoho-snapshot.json still served 2026-06-16 (Cloudflare/Pages cache lag) at verification time — the production repo is fresh; will clear on Pages rebuild + Cloudflare TTL, or via a manual Cloudflare cache purge.
- If a storefront homepage UptimeRobot monitor was added, confirm it reports UP — Cloudflare Bot Fight Mode may 403 UptimeRobot's probe (the /health monitor is unaffected; Railway is not behind Cloudflare).

## Summary

total: 3
passed: 3
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps
