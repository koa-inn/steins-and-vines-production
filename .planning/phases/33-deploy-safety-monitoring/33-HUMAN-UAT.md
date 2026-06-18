---
status: partial
phase: 33-deploy-safety-monitoring
source: [33-03-PLAN.md]
started: 2026-06-18T05:40:00Z
updated: 2026-06-18T05:40:00Z
---

## Current Test

Task 3 — Run the first gated deploy and verify the full chain + MONITOR-02 secrets

## Tests

### 1. Deploy secrets created + Railway "Wait for CI" enabled (DEPLOY-01/02/03 enablement)
expected: `PROD_DEPLOY_TOKEN` (fine-grained PAT, resource owner koa-inn, repo koa-inn/steins-and-vines-production only, Contents:write, 1-year expiry) and `RAILWAY_TOKEN` (project token scoped to sv-middleware project + production environment) both exist as Actions secrets on the koa-inn/steins-and-vines-staging repo; Railway "Wait for CI" is enabled on svmiddleware-production. No token values recorded anywhere.
result: passed — 2026-06-18. PROD_DEPLOY_TOKEN added as Actions secret on the staging repo (fine-grained, production repo only, Contents:Read+Write, 1-year expiry). RAILWAY_TOKEN added as Actions secret on the staging repo (Railway project token, production environment). Railway "Wait for CI" enabled on svmiddleware-production. Token values not stored.

### 2. UptimeRobot /health keyword monitor live (MONITOR-01)
expected: A UptimeRobot Keyword monitor polls https://svmiddleware-production.up.railway.app/health every 5 minutes, keyword `"redis":true` (exists check — alerts when ABSENT or HTTP != 200), email alert configured. Exact keyword string matches the live /health serialization (confirmed by curl: `{"status":"ok","authenticated":true,"redis":true,...}`). A test check reports UP.
result: passed — 2026-06-18. UptimeRobot Keyword monitor created on https://svmiddleware-production.up.railway.app/health, keyword `"redis":true` (alert when not exists), 5-min interval, email alert. Test check reports UP.

### 3. First gated deploy ran green end-to-end + MONITOR-02 secrets posture closed (DEPLOY-01/02/03, MONITOR-02)
expected: gated-deploy.yml triggered via workflow_dispatch; deploy job ran only because both test jobs passed (DEPLOY-01); steinsandvines.ca loads and /health returns 200 + redis:true; a `prod-YYYYMMDD-N` tag exists on both repos; docs/RUNBOOK.md has a new deploy-history row pairing git SHA + Railway deploy ID (DEPLOY-02); CNAME restored to staging.steinsandvines.ca on staging and steinsandvines.ca does not 404; steinsandvines.ca/content/zoho-snapshot.json generated_at within 25h (DEPLOY-03); Railway confirmed NODE_ENV=production + all REQUIRED_IN_PROD secrets (incl. SENTRY_DSN, HELCIM_API_TOKEN) present (healthy boot proves the gate — MONITOR-02 / D-09); pending 32-HUMAN-UAT.md items closed.
result: [pending]

## Summary

total: 3
passed: 2
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps
