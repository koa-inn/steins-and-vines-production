# Production Deploy Runbook — Steins & Vines

## Overview

| Path | Trigger | Who | When to use |
|------|---------|-----|-------------|
| **Blessed** | `gated-deploy.yml` workflow_dispatch button in GitHub Actions | Developer (manual) | Normal production deploys — tests both surfaces, smoke-checks /health, writes record |
| **Break-glass** | `git push production main --force` | Developer (local) | Emergency only — bypasses tests, CNAME guard, tagging, and runbook entry |

Use the blessed path unless something is actively broken and you need to ship a fix without waiting for tests.

---

## Deploy History

<!-- gated-deploy.yml inserts each new deploy row directly under the table separator below (newest first). -->

| Date | Git SHA | Railway Deploy ID | Deploy URL | Notes |
|------|---------|-------------------|------------|-------|
| 2026-06-27 20:46 UTC | `3d770f29` | `31585f6d-cd04-4785-9b46-ecf34303a481` | [Run](https://github.com/koa-inn/steins-and-vines-staging/actions/runs/28301299186) | Promote v4.4: recipe cart-collision undercharge fix + imperial scaling + Phase 43 custom line item + Phases 39/41 |
| 2026-06-26 21:50 UTC | `50465bc6` | `ca24b052-023e-40ad-9c1c-9200d648a0d2` | [Run](https://github.com/koa-inn/steins-and-vines-staging/actions/runs/28267197386) | Hotfix: kiosk customer-search x-api-key (prod-down) + promote v4.4 discount feature + facility image optimization |
| 2026-06-19 04:22 UTC | `5d6aa93d` | `5081cbbf-5c09-41eb-aba6-649416509705` | [Run](https://github.com/koa-inn/steins-and-vines-staging/actions/runs/27805206730) | Recipe builder: Refresh from Zoho button (5d6aa93) |
| 2026-06-19 04:11 UTC | `6ce1620f` | `014207ee-c805-4aee-9c9f-b50a79faa7aa` | [Run](https://github.com/koa-inn/steins-and-vines-staging/actions/runs/27804840892) | Recipe list: dynamic/ingredient-based price display + computed_price cold-cache fallback (6ce1620) |
| 2026-06-19 00:51 UTC | `c9eff325` | `1d3a061c-4386-4ef3-b67c-ad50a22335e9` | [Run](https://github.com/koa-inn/steins-and-vines-staging/actions/runs/27798555795) | Recipe editor: fix catalog-load race (shifting cost/retail numbers), commit c9eff32 |
| 2026-06-18 23:11 UTC | `9bd98bdc` | `54bc4013-2fd6-48df-b6e7-9b8250a824aa` | [Run](https://github.com/koa-inn/steins-and-vines-staging/actions/runs/27794924337) | Recipe builder Internal Only items (2c49dec) + high-CVE dep patch (9bd98bd) |
| 2026-06-18 14:11 UTC | `04c09d98` | `0461dc19-d188-48e9-858e-c33d6a996d17` | [Run](https://github.com/koa-inn/steins-and-vines-staging/actions/runs/27765441259) | testing deploy workflow |

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
- [ ] `HELCIM_API_TOKEN` — Helcim payment API token (required in prod as of Phase 33 — middleware will NOT boot without it)

A healthy post-deploy `/health` response (HTTP 200, `redis:true`) confirms the app booted successfully through `validateEnv.js`, which means all `REQUIRED_IN_PROD` vars are present.

---

## Phase 46 Auth Cutover (CRITICAL — leaked-key neutralization)

Closes the audit CRITICAL: the storefront previously shipped `MW_API_KEY` in client JS, so the
shared `API_SECRET_KEY` is compromised (its value also persists in git history). Phase 46 replaces
the single shared key with three credential tiers — legacy `x-api-key`, kiosk `x-device-token`,
and Google `sv_session` cookie — all accepted **simultaneously** (dual-accept) until the owner
**rotates `API_SECRET_KEY`**, which is the step that actually kills the leaked key.

**Status:** ⏳ PENDING owner execution (code + build complete and tested as of Phase 46 waves 1–5).

> **Deploy topology note (matters for sequencing):** Railway (middleware) and GitHub Pages
> (frontend) both build from the **production** repo, so a prod deploy ships them **together** —
> the new middleware cannot go live without the new frontend. Chosen approach: **coupled deploy,
> off-hours.** Deploy both to prod at once under dual-accept (old `API_SECRET_KEY` retained), when
> the store is closed, then immediately provision the iPad. Only the kiosk is affected, and only
> until its device token is entered; admin/BrewPad/public keep working throughout. There is no
> staging middleware (staging frontend calls prod middleware), so the new auth is truly verifiable
> only on prod post-deploy — dual-accept is the safety net, not staging.

### Secret locations (values are NOT stored in this file)

| Variable | Where the value lives | Notes |
|----------|----------------------|-------|
| `STAFF_EMAILS` | Owner-defined → Railway `svmiddleware-production` → Variables | Comma-separated allowlisted Google emails (D-46-07) |
| `KIOSK_DEVICE_TOKEN` | Password manager + Railway → Variables | Generated during cutover prep (`openssl rand -base64 48`) |
| `SHEETS_CLIENT_ID` | Railway → Variables | Public Google OAuth client id `8605205683-tck2da2tpp03vcbr5etauu9q7kompg3q.apps.googleusercontent.com` (not a secret) |
| `API_SECRET_KEY` | Railway → Variables | UNCHANGED until Task 3, then rotated (`openssl rand -base64 32`) |
| `API_SECRET_KEY_PREVIOUS` | Railway → Variables (optional) | Set to the retired key value after rotation for canary logging (Finding #6) |

### Task 1 — Set env vars + coupled prod deploy (dual-accept live)

- [ ] Generate secrets in your OWN terminal (keep them out of chat): `openssl rand -base64 48` → `KIOSK_DEVICE_TOKEN`; hold `openssl rand -base64 32` → new `API_SECRET_KEY` for Task 3
- [ ] Set `STAFF_EMAILS`, `KIOSK_DEVICE_TOKEN`, `SHEETS_CLIENT_ID` in Railway `svmiddleware-production` → Variables. **Leave `API_SECRET_KEY` at its current (old) value** (dual-accept)
- [ ] Store `KIOSK_DEVICE_TOKEN` in the password manager
- [ ] `git push origin main` — publish to staging + run CI (nothing goes live on prod yet)
- [ ] **When the store is CLOSED**, promote to prod: trigger the `Gated Production Deploy` workflow (workflow_dispatch), or break-glass `git push production main --force`. This publishes new frontend (Pages) **and** new middleware (Railway) together; `API_SECRET_KEY` stays old, so old key + new credentials are all accepted
- [ ] Proceed to Task 2 immediately — the store kiosk is down until its device token is entered

**Verify:**
```bash
# /health authenticated + redis up
curl -s https://<prod-middleware-host>/health   # expect 200, authenticated:true, redis:true
# dual-accept: OLD key still works on a mutating route
curl -i -X POST https://<prod-middleware-host>/api/<mutating-route> \
  -H "x-api-key: <OLD_API_SECRET_KEY>" -H "Content-Type: application/json" -d '{...}'   # expect NOT 401/403
```
Resume signal: **"deployed"**

### Task 2 — Provision iPad + verify all three surfaces

- [ ] KIOSK (store iPad, staging `kiosk.html`): open the device-token settings prompt, paste `KIOSK_DEVICE_TOKEN`, save → PIN pad appears (no Google sign-in). Ring up a real test sale end-to-end (terminal charge → Zoho invoice). Confirm customer search works (via `/api/contacts/search`).
- [ ] ADMIN (`admin.html`): sign in with an **allowlisted** Google account → dashboard loads; perform an admin-grade action (report / gift-card void view). Sign in with a **non-allowlisted** account → denied.
- [ ] BREWPAD (`brewpad.html`): Google sign-in → authenticated; load a batch list (session-auth) → works.
- [ ] NEGATIVE: from the kiosk device token, confirm an admin-grade route (gift-card void) is **refused 403** (device scope holds).

Resume signal: **"verified"**

### Task 3 — Rotate API_SECRET_KEY + confirm old key dead

- [ ] (Frontend is already live on prod from the Task 1 coupled deploy — no separate promotion needed.)
- [ ] Within ~2–3 business days of go-live (D-46-12), once all surfaces are confirmed on the new credentials: rotate `API_SECRET_KEY` in Railway to the new value from Task 1 (this ends dual-accept and kills the leaked key)
- [ ] (optional) Set `API_SECRET_KEY_PREVIOUS` to the retired value for canary logging

**Verify:**
```bash
# old key now dead
curl -i -X POST https://<prod-middleware-host>/api/<mutating-route> \
  -H "x-api-key: <OLD_API_SECRET_KEY>" -d '{...}'   # expect 403
# no lockout: re-check kiosk sale, an admin action, a BrewPad load
# public prod checkout (ferment reservation → /api/bookings + /api/contacts + /api/payment/initialize) completes with NO 403
```
Resume signal: **"rotated"**

### Outcome record (fill in on completion)

- Go-live (Task 1) date: _pending_
- Surfaces verified (Task 2) date: _pending_
- `API_SECRET_KEY` rotation date: _pending_
- Retired-key disposition: _pending_
- **D-46-13 (interim IP allowlist): SKIPPED** — Phase 45 containment already shipped, cutover is days away, and the store IP may be dynamic. Recorded here per decision; no interim allowlist added.

---

## CNAME Reference

The CNAME file is **tracked in git** (not untracked — see Research note below).

| Repo | CNAME value | When |
|------|-------------|------|
| Staging (`origin`) | `staging.steinsandvines.ca` | Always — staging's CNAME is never changed |
| Production | `steinsandvines.ca` | Set by gated-deploy as part of the force-pushed commit |

**The gated-deploy workflow handles the CNAME swap without ever touching staging:**
1. Validates CNAME is `staging.steinsandvines.ca` before starting (aborts if it is already the production value — backstop against an externally-introduced stuck state)
2. Commits `steinsandvines.ca` on top of the deploy SHA and force-pushes that commit to the **production** repo only
3. Immediately runs `git reset --hard` back to the deploy SHA, so the prod-CNAME commit is never pushed to `origin`/staging. There is no separate "restore" step — staging's CNAME is never modified, eliminating the old mid-swap window.

**Never push `steinsandvines.ca` to the staging repo (`origin`) or `staging.steinsandvines.ca` to the production repo.**

> **`enforce-cname.yml` is BROKEN (403):** The workflow uses `gh api ... -X PUT` to set the Pages domain. This fails with 403 because `GITHUB_TOKEN` lacks the `pages:write` scope for the PUT endpoint on repos using Actions-based deploy. Do NOT rely on `enforce-cname.yml` for CNAME management — the gated-deploy workflow manages it manually.

> **Research note:** CLAUDE.md states "CNAME is in `.gitignore`." This is technically inaccurate — CNAME is listed in `.gitignore` but was committed before that entry and remains tracked. `git ls-files CNAME` returns `CNAME`. Once a file is tracked, `.gitignore` has no effect until `git rm --cached`.
