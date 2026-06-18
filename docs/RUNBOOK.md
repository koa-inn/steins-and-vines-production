# Production Deploy Runbook — Steins & Vines

## Overview

| Path | Trigger | Who | When to use |
|------|---------|-----|-------------|
| **Blessed** | `gated-deploy.yml` workflow_dispatch button in GitHub Actions | Developer (manual) | Normal production deploys — tests both surfaces, smoke-checks /health, writes record |
| **Break-glass** | `git push production main --force` | Developer (local) | Emergency only — bypasses tests, CNAME guard, tagging, and runbook entry |

Use the blessed path unless something is actively broken and you need to ship a fix without waiting for tests.

---

## Deploy History

<!-- The gated-deploy.yml workflow appends one row per deploy below this line. -->

| Date | Git SHA | Railway Deploy ID | Deploy URL | Notes |
|------|---------|-------------------|------------|-------|

---

## Rollback

### GitHub Pages (frontend)

Use `git revert` to produce a new commit that undoes the bad change, then force-push to production.
`--force` is required because production/main may have diverged from staging/main after a force-push.

**Revert one commit:**

```bash
git revert --no-edit HEAD
git push production main --force
```

**Revert multiple commits:**

```bash
git revert --no-edit HEAD~N..HEAD
git push production main --force
```

> **Important:** Ensure `CNAME` contains `steinsandvines.ca` on the local branch before pushing to production. Verify with `cat CNAME` first.

The `deploy-production.yml` workflow on the production repo will rebuild and republish GitHub Pages automatically.

### Railway (middleware)

**Option 1 — Railway Dashboard (recommended):**

1. Go to [Railway dashboard](https://railway.app) → Project `sv-middleware` → `svmiddleware-production` service
2. Click the **Deployments** tab
3. Find the last known-good deployment (match against RUNBOOK deploy history by SHA or date)
4. Click the three-dot menu (…) next to that deployment → **Rollback**
5. Railway restores both the Docker image and environment variables from that deployment

> **Constraint:** Only deployments with `canRollback: true` can be rolled back (Railway retains deployments based on plan retention policy).

**Option 2 — GraphQL API (programmatic):**

```graphql
mutation deploymentRollback($id: String!) {
  deploymentRollback(id: $id) {
    id
    status
  }
}
```

Pass the Railway deploy ID from the Deploy History table above. Requires a project token.

> **Note:** `railway deployment redeploy` only re-runs the CURRENT latest deployment — it is NOT a rollback to a previous version. Use the dashboard or GraphQL mutation to roll back.

---

## Smoke-check Semantics

The `gated-deploy.yml` workflow polls `https://svmiddleware-production.up.railway.app/health` after each deploy.

| Condition | Behavior |
|-----------|----------|
| HTTP status != 200 | **HARD FAIL** — workflow exits 1, deploy flagged as failed |
| `redis: false` in body | **HARD FAIL** — Redis not connected; exit 1 |
| `authenticated: false` in body | **SOFT WARN** — logged only, deploy proceeds. Zoho OAuth drops on every Railway restart; re-authenticate at `/auth/zoho` |
| HTTP 200 + `redis: true` | **PASS** |

The smoke-check retries up to 5 times with 20-second waits to allow for Railway cold-start.

**Re-authenticate Zoho after deploy:**
```
https://svmiddleware-production.up.railway.app/auth/zoho
```

---

## Human Prerequisites (one-time setup)

Complete these before triggering the first gated deploy.

### PROD_DEPLOY_TOKEN

The gated-deploy workflow needs write access to `koa-inn/steins-and-vines-production`.

- [ ] Go to GitHub → Settings → Developer Settings → Personal access tokens → Fine-grained tokens
- [ ] Set **Resource owner:** `koa-inn`
- [ ] Set **Repository access:** `koa-inn/steins-and-vines-production` only
- [ ] Set **Permissions:** Contents → Read and Write
- [ ] Set **Expiry:** Maximum (1 year). Add a calendar reminder to renew.
- [ ] Copy the token
- [ ] On the staging repo (`koa-inn/steins-and-vines-staging`): Settings → Secrets and variables → Actions → New secret: `PROD_DEPLOY_TOKEN`

> **Pitfall:** Fine-grained PATs expire. A 401 on `update-snapshot.yml` or the gated deploy push step means the token expired — regenerate and update the secret.

### RAILWAY_TOKEN

Used to capture the Railway deploy ID in the runbook entry. If absent, the deploy ID will be `unknown` (non-blocking).

- [ ] Go to [Railway dashboard](https://railway.app) → Project Settings → Service Tokens → Generate
- [ ] Scope: `sv-middleware` service + `production` environment
- [ ] Copy the token
- [ ] On the staging repo: Settings → Secrets and variables → Actions → New secret: `RAILWAY_TOKEN`

### Railway "Wait for CI" (Approach A)

Ensures Railway holds the auto-triggered deploy until this workflow's test checks pass.

- [ ] Railway dashboard → `svmiddleware-production` service → Settings
- [ ] Enable **"Wait for CI"** toggle
- [ ] Verify: push a commit to staging that touches `zoho-middleware/` and confirm Railway shows the deploy in WAITING state until GitHub checks complete

**If "Wait for CI" causes false skips** (Railway marks deploy SKIPPED due to an unrelated failing check suite from CodeCov, Dependabot, etc.):

Switch to Approach B:
1. Dashboard → Service Settings → disable GitHub autodeploy
2. Add this step to the `deploy` job in `gated-deploy.yml` (after the force-push step):
   ```yaml
   - name: Deploy middleware via Railway CLI
     run: railway up --service sv_middleware --ci
     env:
       RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
   ```

### UptimeRobot Keyword Monitor

External uptime monitoring independent of GitHub CI (D-08).

- [ ] Create account at [uptimerobot.com](https://uptimerobot.com) (free, no credit card)
- [ ] Click **Add New Monitor**
- [ ] Monitor Type: **Keyword**
- [ ] Friendly Name: `sv-middleware /health Redis`
- [ ] URL: `https://svmiddleware-production.up.railway.app/health`
- [ ] Keyword: `"redis":true`
- [ ] Keyword Type: **Keyword exists** (alert when `"redis":true` is ABSENT — Redis is down)
- [ ] Monitoring Interval: **5 minutes** (free tier maximum)
- [ ] Alert Contacts: add email for outage notifications
- [ ] Click **Create Monitor**

**Optional second monitor** (informational only — fires on every Railway restart):
- Monitor Type: **Keyword**
- URL: same
- Keyword: `"authenticated":false`
- Keyword Type: **Keyword exists** (alerts when Zoho auth has dropped)
- Treat as a prompt to re-authenticate at `/auth/zoho`, not an urgent outage

### Phase 32 Railway Secrets (close pending UAT)

Verify these are set in the Railway `svmiddleware-production` service before the first gated deploy:

- [ ] `NODE_ENV` = `production`
- [ ] `RECAPTCHA_SECRET_KEY` — Google reCAPTCHA secret (required in prod, fail-closed)
- [ ] `HELCIM_WEBHOOK_SECRET` — Helcim webhook HMAC secret (required in prod, fail-closed)
- [ ] `CALCOM_WEBHOOK_SECRET` — Cal.com webhook HMAC secret (required in prod, fail-closed)
- [ ] `REDIS_ENCRYPTION_KEY` — Zoho refresh-token encryption key (required in prod, #106)
- [ ] `SENTRY_DSN` — Sentry error tracking DSN (required in prod as of Phase 33, MONITOR-02)

A healthy post-deploy `/health` response (HTTP 200, `redis:true`) confirms the app booted successfully through `validateEnv.js`, which means all `REQUIRED_IN_PROD` vars are present.

---

## CNAME Reference

The CNAME file is **tracked in git** (not untracked — see Research note below).

| State | CNAME value | When |
|-------|-------------|------|
| Staging (normal) | `staging.steinsandvines.ca` | At rest on staging repo |
| Production deploy | `steinsandvines.ca` | Set by gated-deploy before force-push |
| After restore | `staging.steinsandvines.ca` | Restored by gated-deploy after force-push |

**The gated-deploy workflow handles the CNAME swap automatically:**
1. Validates CNAME is `staging.steinsandvines.ca` before starting (aborts if it is already the production value)
2. Commits `steinsandvines.ca` before the force-push
3. Restores `staging.steinsandvines.ca` in an `if: always()` step (runs even if smoke-check fails)

**Never push `steinsandvines.ca` to the staging repo (`origin`) or `staging.steinsandvines.ca` to the production repo.**

> **`enforce-cname.yml` is BROKEN (403):** The workflow uses `gh api ... -X PUT` to set the Pages domain. This fails with 403 because `GITHUB_TOKEN` lacks the `pages:write` scope for the PUT endpoint on repos using Actions-based deploy. Do NOT rely on `enforce-cname.yml` for CNAME management — the gated-deploy workflow manages it manually.

> **Research note:** CLAUDE.md states "CNAME is in `.gitignore`." This is technically inaccurate — CNAME is listed in `.gitignore` but was committed before that entry and remains tracked. `git ls-files CNAME` returns `CNAME`. Once a file is tracked, `.gitignore` has no effect until `git rm --cached`.
