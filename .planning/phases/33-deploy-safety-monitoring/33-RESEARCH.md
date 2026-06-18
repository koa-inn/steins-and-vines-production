# Phase 33: Deploy Safety & Monitoring — Research

**Researched:** 2026-06-17
**Domain:** GitHub Actions CI/CD gating, Railway deploy lifecycle, UptimeRobot monitoring, git two-repo model
**Confidence:** HIGH (all key findings verified directly against code, CLI output, and official docs)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Gate prod deploys via a GitHub Actions deploy workflow that runs the test suite first. Replaces ungated manual `git push production main --force` as the blessed path.
- **D-02:** Trigger = manual `workflow_dispatch` only. No auto-on-push. Human approves staging first, then triggers gated prod deploy.
- **D-03:** Both surfaces gated: frontend (GitHub Pages on `*-production` repo) AND middleware (Railway). Either suite failing blocks the whole deploy.
- **D-04:** After deploying, workflow smoke-tests `/health` and requires a healthy response before declaring success.
- **D-05:** Smoke-check semantics: `redis:true` + HTTP 200 are HARD pass conditions. `authenticated:false` is SOFT (Zoho OAuth drops on every middleware restart — do NOT hard-fail on `authenticated:false`).
- **D-06:** Scripted: workflow auto-creates `prod-YYYYMMDD-N` git tag and appends runbook entry pairing git SHA with Railway deploy ID.
- **D-07:** Runbook lives as a tracked doc the deploy flow appends to.
- **D-08:** UptimeRobot free tier polling `/health` every 5 min, email alerting, HTTP keyword monitoring to assert body contains `"redis":true`.
- **D-09:** MONITOR-02 work = verifying secrets are present in Railway (largely proven by healthy post-deploy `/health`) + close Phase 32 pending human UAT together.
- **D-10:** Fix mechanism for DEPLOY-03 (snapshot staleness) is left to research. Researcher must pin root cause and pick cleanest fix.

### Claude's Discretion

- DEPLOY-03 fix mechanism (D-10).
- Exact runbook file path/format (D-07).
- Whether gated deploy workflow lives on staging repo (deploying to production) or on production repo as `workflow_dispatch`.

### Deferred Ideas (OUT OF SCOPE)

- Separate staging-middleware environment / sandbox Zoho+Helcim.
- Fixing `enforce-cname.yml` properly (403 Pages-PUT bug) beyond what is needed to keep CNAME correct through the new deploy flow.
- Richer observability (Sentry dashboards, structured deploy metrics, SLO tracking) beyond uptime + secrets.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DEPLOY-01 | Production deploys gated on test suite — failing frontend OR middleware tests block the deploy | D-01/D-02/D-03 locked; workflow structure documented in §Target 2 |
| DEPLOY-02 | Every prod deploy tagged (`prod-YYYYMMDD-N`) and rollback runbook pairs git SHA with Railway deploy ID | `railway deployment list --json --limit 1` gives deploy ID; rollback commands in §Target 2 |
| DEPLOY-03 | Nightly Zoho snapshot reliably reaches live prod site (fix `[skip ci]` + force-push interaction) | Root cause pinned in §Target 1; recommended fix: dual-repo commit |
| MONITOR-01 | External uptime monitor polls `/health` every ~5 min and alerts on downtime/`authenticated:false`/`redis:false` | UptimeRobot free tier confirmed; setup steps in §Target 3 |
| MONITOR-02 | Required prod secrets verified present in Railway; absence fails closed | validateEnv.js gap identified (SENTRY_DSN missing from REQUIRED_IN_PROD); in §Target 6 |
</phase_requirements>

---

## Summary

Phase 33 adds deploy safety infrastructure without changing application behavior. It involves: (1) a new GitHub Actions `workflow_dispatch` workflow that gates prod deploys on tests and post-deploy health; (2) fixing a snapshot-staleness bug caused by the two-repo force-push model; (3) UptimeRobot keyword monitoring; and (4) closing the Phase 32 pending human UAT on Railway secrets.

**The most complex finding** is the DEPLOY-03 root cause: the `update-snapshot.yml` nightly job runs on **both** repos independently, but the production repo's content diverges from staging after a force-push because `git push production main --force` sets the production repo's `main` to a snapshot-of-staging that lacks any snapshot commits that arrived on production/main after that force-push. The snapshot job running on the production repo then re-commits a fresh snapshot, but the next force-push from staging overwrites it. The cleanest fix is to have `update-snapshot.yml` run on the **production** (or **staging**) repo only and push the fresh snapshot to BOTH remotes. See §Target 1.

**CNAME is tracked in git** (not untracked), making the CLAUDE.md statement that "CNAME is in `.gitignore`" technically inaccurate — it is listed in `.gitignore` but was committed before that entry and remains tracked. This must be handled explicitly in any new deploy workflow.

**Primary recommendation:** Locate the new gated-deploy workflow on the **staging repo** (deploying to production), since that is where all development work happens and where tests.yml already runs. The production repo continues to receive the push from this workflow and runs `deploy-production.yml` normally.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Test gating | GitHub Actions (CI) | — | Tests must pass before any deploy action |
| Frontend deploy | GitHub Actions → GitHub Pages | — | `deploy-production.yml` already handles this |
| Middleware deploy | GitHub Actions → Railway CLI | Railway auto-deploy (disabled for gated path) | Gated deploy requires explicit `railway up` |
| Deploy tagging | GitHub Actions (git tag + push) | — | Scripted into deploy workflow |
| Runbook append | GitHub Actions (echo >> docs/RUNBOOK.md, commit, push) | — | Automated, tracked in git |
| Snapshot update | GitHub Actions (update-snapshot.yml, both repos) | — | Must reach both repos reliably |
| Uptime monitoring | UptimeRobot (external) | — | External monitoring is independent of CI |
| Secrets verification | Railway validateEnv.js boot gate | Human Railway dashboard check | Code half ships in Phase 32; human check closes UAT |

---

## Target 1: DEPLOY-03 Snapshot Staleness — Root Cause and Fix [VERIFIED: direct code + git log inspection]

### Exact Root Cause

The system has **two independent GitHub repositories** with **no shared git ancestry** after a force-push:

1. `koa-inn/steins-and-vines-staging` (origin) — where all development happens
2. `koa-inn/steins-and-vines-production` (production) — receives `git push production main --force` from the staging repo's state

The `update-snapshot.yml` workflow exists on **both** repos (verified: `git show production/main:.github/workflows/update-snapshot.yml` returns content). Each repo runs the nightly cron independently. Each nightly run commits `content/zoho-snapshot.json` with message `chore: update Zoho snapshot [skip ci]` to its own `main` branch.

**The failure sequence:**

```
T=0:  staging/main at commit S1 (feature work)
T=1:  git push production main --force
      → production/main set to S1 (staging's tree, including CNAME=staging.steinsandvines.ca OOPS)
      Actually: user manually commits CNAME swap first → S2 (CNAME=steinsandvines.ca) → push production
T=2:  production/main = S2 (CNAME=steinsandvines.ca, feature S1, last snapshot from staging)
T=3:  06:00 UTC — update-snapshot.yml runs on STAGING repo
      Commits 18d10f1 to staging/main → "chore: update Zoho snapshot [skip ci]"
T=4:  06:00 UTC — update-snapshot.yml runs on PRODUCTION repo
      Commits 2d10ffe to production/main → "chore: update Zoho snapshot [skip ci]"
T=5:  Next production deploy (next force-push from staging)
      git push production main --force
      This sets production/main = staging/main (which lacks 2d10ffe since staging and production have DIVERGED)
      production/main snapshot is now OVERWRITTEN by staging's snapshot
      The production snapshot's generated_at may be hours behind
```

**Verified by git log inspection:**

- `production/main` has `2d10ffe` (2026-06-17 10:22 UTC) as most recent snapshot
- `origin/main` has `18d10f1` (2026-06-17 10:20 UTC) as most recent snapshot
- These are DIFFERENT commits on DIFFERENT diverged branches
- The production repo ran its own snapshot job 2 minutes after the staging job
- Both are fresh for now, but the next force-push will reset production to staging's tree, overwriting `2d10ffe`

**The `[skip ci]` interaction:** The `[skip ci]` marker on snapshot commits is a contributing detail — it prevents `tests.yml` and `deploy-production.yml` from triggering on snapshot commits (correct behavior). It does NOT cause the staleness. The staleness is entirely caused by the force-push overwriting snapshot commits that landed on production after the most recent force-push.

**Additional observation:** The snapshot on production is currently at `generated_at: 2026-06-17T10:22:32.980Z`. But since phase 32 work (many commits) was never force-pushed to production, the production repo is stuck at the v4.1 codebase and will be stale once the Phase 33 force-push lands.

### Recommended Fix: Single Canonical Snapshot Source (commit to staging + copy to production)

**Recommendation: Modify `update-snapshot.yml` to run on the staging repo only, then push the snapshot commit directly to the production remote as well.**

**Why not "regenerate snapshot during deploy workflow":**
- The deploy workflow triggers `workflow_dispatch` — at deploy time, the middleware may be mid-restart (cold Railway spin-up). Generating the snapshot at deploy time hits a temporarily `authenticated:false` middleware and gets a stale or empty snapshot.
- The snapshot relies on warm Redis caches (06:00 UTC runs 1h after the 05:00 UTC cache warm-up cron). A deploy at 14:00 UTC may hit a cold cache.
- The nightly schedule is already well-tuned; disrupting it adds fragility.

**Recommended Fix Shape — Option A: Push to Both Remotes in update-snapshot.yml**

Modify the `git push` step in `update-snapshot.yml` to push the snapshot commit to both the staging and production remotes:

```yaml
- name: Commit and push to both repos
  run: |
    git config user.name  "github-actions[bot]"
    git config user.email "github-actions[bot]@users.noreply.github.com"
    git add content/zoho-snapshot.json
    if git diff --staged --quiet; then
      echo "Snapshot unchanged — nothing to commit"
    else
      git commit -m "chore: update Zoho snapshot [skip ci]"
      git push origin main                  # staging
      # Also push to production so force-pushes don't overwrite the snapshot
      git push https://x-access-token:${{ secrets.PROD_DEPLOY_TOKEN }}@github.com/koa-inn/steins-and-vines-production.git HEAD:main
      echo "Snapshot pushed to both staging and production repos"
    fi
```

**Requires:** A `PROD_DEPLOY_TOKEN` secret on the staging repo with write access to the production repo. This is the same token the new gated-deploy workflow will need for `git push production main --force` anyway.

**Why this works:** The snapshot lands on production/main as a direct push (not a force-push). The subsequent `git push production main --force` from the deploy workflow will include this snapshot commit in the staging tree (since it was also pushed to staging/main). The production repo's `main` will always have the latest snapshot at or before the force-push time.

**Option B: Add a repo guard to update-snapshot.yml that runs ONLY on the production repo.**

```yaml
jobs:
  update-snapshot:
    runs-on: ubuntu-latest
    if: github.repository == 'koa-inn/steins-and-vines-production'
```

This means the staging repo no longer gets nightly snapshot updates (acceptable — staging uses live middleware calls normally). The production repo gets the snapshot nightly, and the force-push from staging WILL overwrite it next deploy. This does NOT solve the problem.

**Option C: Remove update-snapshot.yml from the production repo entirely, run on staging only, and push to production in the workflow.**

Equivalent to Option A but cleaner separation. Since the production repo receives a force-push that includes the `.github/workflows/update-snapshot.yml` file, the cron will always be on both repos unless we add a repo guard. Option A with the guard + cross-repo push is the cleanest.

**Final Recommendation: Option A with repo guard.** Modify `update-snapshot.yml` to:
1. Add `if: github.repository == 'koa-inn/steins-and-vines-staging'` guard so only the staging repo runs the job.
2. Push the new snapshot commit to both `origin main` (staging) and production via token.

**Acceptance:** `content/zoho-snapshot.json` at `steinsandvines.ca/content/zoho-snapshot.json` has a `generated_at` within 25 hours of current time, even after a production force-push.

---

## Target 2: Railway Deploy Trigger, Deploy ID, and Rollback [VERIFIED: Railway CLI v4.30.2 + official docs]

### Railway CLI is Available

```
/opt/homebrew/bin/railway
railway 4.30.2
```

### Middleware Deploy Strategy: Accept Auto-Deploy, Add Post-Deploy Health Gate

**Railway `watchPatterns = ["zoho-middleware/**"]`** in `railway.toml` means Railway auto-deploys every time a push to the connected branch touches `zoho-middleware/**`. This cannot be bypassed by using `railway up` from the workflow — both would trigger a deploy, potentially creating competing deployments.

**Two viable approaches:**

**Approach A: "Wait for CI" + post-deploy health gate (RECOMMENDED)**

1. Enable "Wait for CI" in Railway Service Settings (Dashboard → `svmiddleware-production` service → Settings → "Wait for CI" toggle).
2. Railway holds the auto-triggered deploy in `WAITING` state while the gated deploy workflow's test jobs run.
3. If tests fail, Railway marks the deploy `SKIPPED` — middleware never redeploys.
4. The workflow then posts a health-check step AFTER the GitHub Pages deploy completes (listening on `deployment_status` or via a sleep+curl loop).

**Approach B: Disable Railway auto-deploy + use `railway up` from workflow**

1. Dashboard → Service Settings → click "Disable" on GitHub autodeploy.
2. The deploy workflow runs `railway up --service sv_middleware --ci` explicitly.
3. After `railway up`, fetch the Railway deploy ID.
4. Run smoke-check against `/health`.

**Recommendation: Approach A** for the initial implementation. It preserves Railway's native GitHub integration, avoids managing a `RAILWAY_TOKEN` secret for every developer, and gives the clearest failure signal (Railway itself marks the deploy SKIPPED). The downside: Railway's "Wait for CI" checks ALL check suites, which can cause false SKIPS if any other app (GitHub Pages, codecov) fails. For this project's simple setup, this is acceptable.

**If Approach A proves flaky due to extra check suites, fall back to Approach B.** The planner should document both as options and let human choose.

### Obtaining the Railway Deploy ID

After any Railway deploy, the CLI provides a `railway deployment list` command:

```bash
railway deployment list --service sv_middleware --json --limit 1 | jq -r '.[0].id'
```

This returns the UUID of the most recent deployment. [VERIFIED: railway 4.30.2 `railway deployment list --help`]

**In a CI context with `RAILWAY_TOKEN`:**

```bash
DEPLOY_ID=$(railway deployment list --service sv_middleware --json --limit 1 | jq -r '.[0].id')
echo "Railway deploy ID: ${DEPLOY_ID}"
```

**Note:** `jq` must be installed in the runner. Ubuntu runners have it by default on GitHub Actions.

### Railway Rollback Commands

**Via Railway GraphQL API (programmatic):** [CITED: docs.railway.com/integrations/api/manage-deployments]

```graphql
mutation deploymentRollback($id: String!) {
  deploymentRollback(id: $id) {
    id
    status
  }
}
```

Constraint: only deployments with `canRollback: true` can be rolled back. Railway retains deployments based on plan retention policy.

**Via Railway Dashboard (manual):**
1. Dashboard → `svmiddleware-production` service → Deployments tab
2. Find the target deployment → click three-dot menu → "Rollback"
3. Both Docker image and custom variables are restored

**Via CLI (redeploy most recent, not true rollback):**

```bash
railway deployment redeploy
```

This only redeploys the CURRENT latest, not a previous version.

**Conclusion:** True rollback to a specific previous deploy must be done via dashboard or GraphQL API. The runbook should document both paths.

### GitHub Pages Rollback

The production repo uses Actions-based deployment (`deploy-production.yml`). GitHub Pages rollback:

```bash
# Revert to a specific commit on the production repo
git revert --no-edit HEAD        # revert latest commit
git push production main --force  # force-push production (preserving CNAME)
```

Or to roll back multiple commits:
```bash
git revert --no-edit HEAD~N..HEAD
git push production main --force
```

**The `--force` is required** because production/main may have diverged from staging/main.

### RAILWAY_TOKEN Authentication in GitHub Actions

Railway requires a **project token** (scoped to project + environment), set as a GitHub Actions secret `RAILWAY_TOKEN`. [CITED: blog.railway.com/p/github-actions]

```yaml
env:
  RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
```

**Create token:** Railway dashboard → Project Settings → Service Tokens → Generate → scope to `sv-middleware` service + `production` environment.

### Gated Deploy Workflow Shape (DEPLOY-01/DEPLOY-02)

**Placement decision:** The gated deploy workflow should live on the **staging repo** (`koa-inn/steins-and-vines-staging`), triggered as `workflow_dispatch`. It:

1. Runs tests (reusing `tests.yml` logic via `workflow_call` or inline `needs:`)
2. If tests pass: performs the CNAME swap + force-push to production
3. Deploys middleware via Railway (Approach A: noop — Railway auto-deploys on the push; Approach B: `railway up`)
4. Waits for GitHub Pages to finish (poll deploy status or sleep 90s)
5. Smoke-checks `/health` (hard fail on not-200 or `redis:false`, soft warn on `authenticated:false`)
6. Creates the `prod-YYYYMMDD-N` git tag
7. Appends to `docs/RUNBOOK.md` with: date, git SHA, Railway deploy ID, deploy link
8. Commits and pushes the updated RUNBOOK.md to staging (and production)

**Why staging repo, not production repo:**
- All development, CI, and tests run on staging. Triggering from staging keeps the workflow co-located with its dependencies.
- The production repo has minimal history and receives force-pushes — its own `workflow_dispatch` would be overwritten on every force-push.
- A `workflow_dispatch` on staging's main branch is visible in the GitHub UI under the staging repo's Actions tab.

---

## Target 3: UptimeRobot Free Tier — Capabilities and Setup [VERIFIED: official docs + help center]

### Free Tier Capabilities (Confirmed)

| Feature | Free Tier | Notes |
|---------|-----------|-------|
| Monitor count | 50 | More than sufficient |
| Check interval | 5 minutes | Cannot go lower without paid ($7/mo Solo) |
| Monitor types | HTTP/S, Keyword, Ping, Port, Heartbeat, SSL, Domain expiry | All included |
| Keyword monitoring | YES | Scans HTTP response body for string presence/absence |
| JSON body scanning | YES | Scans raw response body — works on JSON endpoints |
| Email alerting | YES | Free tier includes email alerts |
| Slack/Discord/SMS | Paid only | Not needed for this phase |

[VERIFIED: uptimerobot.com/knowledge-hub + help.uptimerobot.com]

### Keyword Monitor Behavior

UptimeRobot keyword monitoring performs an HTTP(S) request to the target URL, fetches the raw response body, and checks for the presence or absence of a specified string. [VERIFIED: official UptimeRobot knowledge hub]

**For `/health` monitoring:** The response body from `server.js:103` is:
```json
{
  "status": "ok",
  "authenticated": true,
  "redis": true,
  "uptime": 12345.67
}
```

The keyword string `"redis":true` will be present in this raw JSON body when Redis is connected. UptimeRobot's keyword monitor will match this string exactly (with or without space after the colon depends on Express JSON serialization — `res.json()` produces `"redis":true` with no space).

**Verify serialization:** Express `res.json()` uses `JSON.stringify()` which by default produces compact JSON with no spaces around colons. So the exact string to monitor is `"redis":true` (no space). [ASSUMED — based on standard JSON.stringify behavior; verify by curling the live endpoint once to confirm]

### Monitor Configuration (Human Dashboard Action)

The human must complete these steps in the UptimeRobot dashboard:

1. Create account at `uptimerobot.com` (free, no credit card)
2. Click "Add New Monitor"
3. Set Monitor Type: **Keyword**
4. Set Friendly Name: `sv-middleware /health Redis`
5. Set URL: `https://svmiddleware-production.up.railway.app/health`
6. Set Keyword: `"redis":true`
7. Set Keyword Type: **Keyword exists** (alert when keyword is ABSENT, meaning Redis is down)
8. Set Monitoring Interval: **5 minutes** (maximum on free tier)
9. Alert Contacts: add email address(es) for Railway/site alerts
10. Click "Create Monitor"

**For authenticated:false alerting (D-08 secondary):** Add a SECOND keyword monitor on the same URL:
- Keyword: `"authenticated":false`
- Keyword Type: **Keyword exists** (alert when `authenticated:false` IS present — i.e., Zoho dropped auth)
- Note: this monitor will fire after every Railway restart (expected) — so alerts should be treated as informational, not urgent

**Landmine:** `"authenticated":false` will fire on every fresh deploy (Zoho auth drops on restart). The human should expect this alert after every production deploy and treat it as a prompt to re-authenticate Zoho at `/auth/zoho`.

### UptimeRobot vs D-08 Decision

D-08 specifies: keyword monitoring asserting body contains `"redis":true` (and ideally `"authenticated":true`). The above satisfies this exactly.

For `"authenticated":true` monitoring: use an "exists" check on `"authenticated":true` as the keyword (alert when it's absent). This WILL fire after every deploy. Recommendation: start with the `"redis":true` existence check as the hard alert. Add the `authenticated` check as a separate soft-alert monitor if desired.

---

## Target 4: /health Endpoint Semantics and Smoke-Check Logic [VERIFIED: server.js:103-119]

### Exact /health Response Shape

```javascript
// server.js:103-119
app.get('/health', function (req, res) {
  var redisOk = cache.isConnected();
  var redisCheck = redisOk
    ? cache.getClient().then(function (c) {
        if (!c) return false;
        return c.ping().then(function (r) { return r === 'PONG'; }).catch(function () { return false; });
      }).catch(function () { return false; })
    : Promise.resolve(false);

  redisCheck.then(function (redisPong) {
    res.json({
      status: 'ok',
      authenticated: zohoAuth.isAuthenticated(),
      redis: redisPong,
      uptime: process.uptime()
    });
  });
});
```

**Key observations:**
- Always returns HTTP 200 (no error status, no error field in body)
- `redis: redisPong` — boolean, `true` only if Redis is connected AND PONG received
- `authenticated: zohoAuth.isAuthenticated()` — boolean, `false` on every fresh restart until `/auth/zoho`
- `uptime` — seconds since process start (useful for detecting crash loops)

### Smoke-Check Logic for Deploy Workflow

**Hard-fail conditions (deploy fails, alert fires):**
- HTTP status != 200
- `"redis":false` in response body

**Soft-warn conditions (deploy succeeds, log warning):**
- `"authenticated":false` — expected on first deploy, MUST NOT fail the deploy
- `uptime` < 30 — process just started, may still be connecting to Redis

**Recommended smoke-check script for deploy workflow:**

```bash
echo "Running smoke check..."
HEALTH=$(curl -s --max-time 30 https://svmiddleware-production.up.railway.app/health)
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 30 https://svmiddleware-production.up.railway.app/health)

if [ "$HTTP_CODE" != "200" ]; then
  echo "SMOKE CHECK FAILED: HTTP $HTTP_CODE"
  exit 1
fi

REDIS=$(echo "$HEALTH" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('redis',''))")
AUTH=$(echo "$HEALTH" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('authenticated',''))")

if [ "$REDIS" != "True" ]; then
  echo "SMOKE CHECK FAILED: redis=${REDIS} (must be true)"
  exit 1
fi

if [ "$AUTH" = "False" ]; then
  echo "SMOKE CHECK WARNING: authenticated=false — Zoho OAuth dropped on restart"
  echo "Action required: re-authenticate at https://svmiddleware-production.up.railway.app/auth/zoho"
fi

echo "SMOKE CHECK PASSED: HTTP 200, redis=true (authenticated=${AUTH})"
```

**Grace window for Railway cold-start:** Railway typically starts the container in 5-20 seconds. The deploy workflow should wait ~60 seconds after triggering the Railway deploy before polling `/health`. The health check may return `redis:false` if Redis hasn't connected yet — recommend polling with retry:

```bash
for i in 1 2 3 4 5; do
  sleep 20
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 https://svmiddleware-production.up.railway.app/health)
  if [ "$HTTP_CODE" = "200" ]; then
    REDIS=$(curl -s --max-time 15 https://svmiddleware-production.up.railway.app/health | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('redis',''))")
    if [ "$REDIS" = "True" ]; then
      break
    fi
  fi
  echo "Attempt $i/5: not ready yet (HTTP=${HTTP_CODE})"
done
```

---

## Target 5: CNAME / Force-Push Landmine [VERIFIED: git ls-files + git log + .gitignore inspection]

### Contradiction Resolution

**CLAUDE.md says:** "CNAME is in `.gitignore` — domains are managed via GitHub Pages settings, not the file"

**Actual reality (verified by direct inspection):**
- `git ls-files CNAME` returns `CNAME` — the file IS tracked in git
- `.gitignore` line 44 has `CNAME` — but this does NOT untrack an already-tracked file
- `cat CNAME` returns `staging.steinsandvines.ca` (the local staging value)
- `git show production/main:CNAME` returns `steinsandvines.ca` (production value correctly set)
- git log shows 5+ commits with messages `chore: set CNAME to steinsandvines.ca for production deploy` and `chore: restore CNAME to staging.steinsandvines.ca after prod promote`

**Resolution:** CNAME is actively tracked and committed. The CLAUDE.md description is wrong. The MEMORY.md notes this correctly: "CNAME must stay TRACKED per-repo (untracking → 404)." The `.gitignore` entry is inert (once a file is tracked, `.gitignore` has no effect until `git rm --cached`).

**The CNAME swap ritual (actual current practice):**
1. Before prod deploy: `echo "steinsandvines.ca" > CNAME && git commit -m "chore: set CNAME..." && git push production main --force`
2. After prod deploy: `echo "staging.steinsandvines.ca" > CNAME && git commit -m "chore: restore CNAME..." && git push origin main`

**`enforce-cname.yml` is BROKEN (403):** The workflow uses `gh api ... -X PUT` to set Pages CNAME. This fails with 403 because the `GITHUB_TOKEN` in the Actions context lacks the necessary `pages: write` scope for the PUT endpoint on repos using the newer Actions-based deploy mechanism. Do NOT rely on this workflow. [CITED: MEMORY.md `deploy_mechanism_2026.md`]

### How the New Deploy Workflow Must Handle CNAME

The gated deploy workflow (on staging repo) must:

1. Before `git push production main --force`:
   - Read current `CNAME` value (should be `staging.steinsandvines.ca`)
   - Write `steinsandvines.ca` to `CNAME`
   - Commit: `git commit -m "chore: set CNAME to steinsandvines.ca for production deploy [skip ci]"`
   - Push to production: `git push production main --force`
   - `deploy-production.yml` triggers on the push and deploys GitHub Pages

2. After Pages deploy completes:
   - Write `staging.steinsandvines.ca` back to `CNAME`
   - Commit: `git commit -m "chore: restore CNAME to staging.steinsandvines.ca after prod promote [skip ci]"`
   - Push to staging: `git push origin main`

**CNAME validation step in workflow:**

```bash
CURRENT_CNAME=$(cat CNAME)
if [ "$CURRENT_CNAME" = "steinsandvines.ca" ]; then
  echo "ERROR: CNAME is already steinsandvines.ca — aborting to prevent overwriting prod domain"
  exit 1
fi
```

**PROD_DEPLOY_TOKEN secret:** The workflow needs write access to the production repo. This must be a Personal Access Token or GitHub App token with `contents: write` on `koa-inn/steins-and-vines-production`. The `GITHUB_TOKEN` from the staging repo Actions context only has write access to the staging repo.

### PROD_DEPLOY_TOKEN Setup (Human Action)

1. GitHub → Settings → Developer Settings → Personal access tokens → Fine-grained tokens
2. Resource owner: `koa-inn`
3. Repository access: `koa-inn/steins-and-vines-production` only
4. Permissions: Contents (Read and Write)
5. Generate token → copy
6. On staging repo: Settings → Secrets and variables → Actions → New secret: `PROD_DEPLOY_TOKEN`

---

## Target 6: MONITOR-02 Secrets Verification — validateEnv.js Gap Analysis [VERIFIED: direct file inspection]

### Current State of validateEnv.js (Phase 32 output)

**REQUIRED (always, exits on missing):**
- `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_ORG_ID`, `API_SECRET_KEY` (or `MW_API_KEY`)

**REQUIRED_IN_PROD (exits when `NODE_ENV=production`):**
- `RECAPTCHA_SECRET_KEY` — reCAPTCHA secret (HARDEN-01)
- `HELCIM_WEBHOOK_SECRET` — Helcim webhook HMAC (HARDEN-02)
- `CALCOM_WEBHOOK_SECRET` — Cal.com webhook HMAC (HARDEN-02)
- `REDIS_ENCRYPTION_KEY` — Zoho refresh token encryption (#106)

**OPTIONAL (warns but continues):**
- `SENTRY_DSN`, `HELCIM_API_TOKEN`, `CALCOM_API_KEY`, and ~40 others

**Dead Global Payments vars:** None found in validateEnv.js. `GP_*` / `GLOBAL_PAYMENT*` vars are absent. HARDEN-04 is complete. [VERIFIED: grep returns empty]

### Gap: SENTRY_DSN Not in REQUIRED_IN_PROD

**MONITOR-02 requirement states:** `HELCIM_WEBHOOK_SECRET`, `RECAPTCHA_SECRET_KEY`, **`SENTRY_DSN`** are verified present in Railway, and their absence fails closed.

**Current reality:** `SENTRY_DSN` is only in OPTIONAL (line 29). It does not fail closed if missing.

**Phase 33 code task:** Add `SENTRY_DSN` to `REQUIRED_IN_PROD` in `validateEnv.js`.

**Rationale check:** Should SENTRY_DSN hard-fail boot? `SENTRY_DSN` controls error tracking — missing it means errors go untracked silently, not that the service is misconfigured for payments. The REQUIREMENTS.md wording says "absence fails closed" for it. Adding it to `REQUIRED_IN_PROD` means a missing Sentry DSN prevents the app from booting in prod. This is the literal requirement — add it.

### Gap: HELCIM_API_TOKEN Not in REQUIRED_IN_PROD

`HELCIM_API_TOKEN` is required for payment processing. Without it, `/api/payment/initialize` and `/api/checkout` will fail at runtime (not at boot). The REQUIREMENTS.md does not explicitly list it in MONITOR-02, but it is a live Helcim var that HARDEN-04 says should be validated. It is currently OPTIONAL only. [ASSUMED: whether the requirements intended HELCIM_API_TOKEN in REQUIRED_IN_PROD — the literal MONITOR-02 text only mentions 3 specific secrets. Planner should confirm with user.]

### Phase 32 Pending Human UAT (closes with MONITOR-02/D-09)

From `32-HUMAN-UAT.md`, 3 tests remain `[pending]`:
1. **Railway: set `NODE_ENV=production`** on `svmiddleware-production` service Variables
2. **Railway: confirm `RAILWAY_ENVIRONMENT` is present** (injected by Railway automatically)
3. **Railway: confirm `RECAPTCHA_SECRET_KEY`, `HELCIM_WEBHOOK_SECRET`, `CALCOM_WEBHOOK_SECRET`, `REDIS_ENCRYPTION_KEY` all set**

These should be closed as part of Phase 33's human verification, immediately before or after the first gated deploy. The post-deploy `/health` check proving a healthy boot proves the boot gate passed (all REQUIRED_IN_PROD vars are present).

---

## Standard Stack

### Core (No New Libraries Needed)

| Tool | Version | Purpose | Notes |
|------|---------|---------|-------|
| GitHub Actions | N/A | Gated deploy workflow, snapshot distribution | Already in use |
| Railway CLI | 4.30.2 (local) | Deploy middleware, list deployment IDs | Already installed |
| `railway deployment list --json` | CLI built-in | Get Railway deploy ID after deploy | Verified via `--help` |
| UptimeRobot | Free tier | External uptime + keyword monitoring | No code, human setup |
| `jq` | GitHub Actions default | Parse JSON from `railway deployment list` | Pre-installed on ubuntu-latest |

**This phase installs zero new npm packages.** Work is entirely:
- New/modified `.github/workflows/*.yml` files
- Minor `zoho-middleware/lib/validateEnv.js` update (add `SENTRY_DSN` to REQUIRED_IN_PROD)
- New `docs/RUNBOOK.md` file
- Minor update to `update-snapshot.yml`

### Package Legitimacy Audit

**No packages to audit.** This phase adds no new npm dependencies.

---

## Architecture Patterns

### System Architecture Diagram

```
Developer workstation
  |
  | (manual workflow_dispatch trigger)
  v
GitHub Actions: gated-deploy.yml (staging repo)
  |
  |--- [Job 1: test-gate] -------------------|
  |    runs tests.yml (frontend + middleware) |
  |    if FAIL → exit, no deploy             |
  |------------------------------------------|
  |
  |--- [Job 2: deploy (needs: test-gate)] ----|
  |    1. CNAME validation check             |
  |    2. git: set CNAME=steinsandvines.ca   |
  |    3. git push production main --force   |
  |       → triggers deploy-production.yml   |
  |         → GitHub Pages updated           |
  |    4. Wait ~90s for Railway auto-deploy  |
  |       (triggered by watchPatterns match) |
  |    5. Poll /health (5 retries × 20s)     |
  |       HARD fail: redis:false or !HTTP200 |
  |       SOFT warn: authenticated:false     |
  |    6. Get Railway deploy ID:             |
  |       railway deployment list --json --limit 1 | jq -r '.[0].id'
  |    7. Create git tag: prod-YYYYMMDD-N    |
  |    8. Append to docs/RUNBOOK.md          |
  |    9. git: restore CNAME=staging.steinsandvines.ca
  |    10. git push origin main              |
  |------------------------------------------|
  |
  v
steinsandvines.ca (GitHub Pages)
  +
svmiddleware-production.up.railway.app (/health green)

External monitor (UptimeRobot):
  Polls /health every 5 min
  ALERT: "redis":true absent → email alert
  ALERT: HTTP != 200 → email alert
```

### Update-Snapshot Flow (Fixed)

```
06:00 UTC daily
  |
  v
update-snapshot.yml (staging repo ONLY — repo guard added)
  1. Fetch /api/snapshot from production middleware
  2. Validate (no error, >0 items)
  3. Commit content/zoho-snapshot.json to staging/main [skip ci]
  4. Push to origin (staging)
  5. Push to production repo via PROD_DEPLOY_TOKEN [skip ci]
     → production/main gets snapshot commit
     → Next force-push from staging includes this snapshot
```

### Recommended File Paths

```
.github/workflows/
├── gated-deploy.yml          # NEW: workflow_dispatch prod deploy gate
├── update-snapshot.yml       # MODIFIED: add repo guard + cross-repo push
├── deploy-production.yml     # UNCHANGED: triggered by force-push
├── tests.yml                 # UNCHANGED: reused by gated-deploy
└── enforce-cname.yml         # UNCHANGED: broken/noop, leave as-is

docs/
└── RUNBOOK.md                # NEW: deploy history + rollback procedures

zoho-middleware/lib/
└── validateEnv.js            # MODIFIED: add SENTRY_DSN to REQUIRED_IN_PROD
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Railway deploy ID | Custom API call | `railway deployment list --json --limit 1 \| jq -r '.[0].id'` | CLI provides it directly |
| External uptime monitoring | GitHub Actions cron pinging /health | UptimeRobot free tier | External; alerts even when CI is down |
| Pages deploy detection | Custom polling logic | Sleep + `/health` poll | GitHub Pages APIs are complex; `/health` is the real gate |

---

## Common Pitfalls

### Pitfall 1: force-push Overwrites Snapshot
**What goes wrong:** `git push production main --force` replaces production/main with staging/main, discarding snapshot commits that arrived on production after the last force-push.
**Why it happens:** Two diverged repos; force-push is destructive.
**How to avoid:** After the fix (Option A with repo guard), the snapshot is committed to BOTH repos in the same nightly run. The force-push from staging includes the same snapshot commit (since staging also has it).
**Warning signs:** `steinsandvines.ca/content/zoho-snapshot.json` `generated_at` is more than 25 hours old.

### Pitfall 2: authenticated:false Fails Smoke Check
**What goes wrong:** Smoke check sees `authenticated:false` immediately after Railway deploy, marks deploy failed.
**Why it happens:** Zoho OAuth drops on every middleware restart. Re-auth happens when someone visits `/auth/zoho`.
**How to avoid:** Smoke check must treat `authenticated:false` as a warning (log it), not a hard failure. Only `redis:false` and non-200 are hard failures.
**Warning signs:** Every deploy fails smoke check with "authenticated:false" error.

### Pitfall 3: CNAME Left as steinsandvines.ca on Staging Push
**What goes wrong:** Workflow fails mid-deploy (after CNAME swap, before restore). Staging gets served as steinsandvines.ca; real production site breaks.
**Why it happens:** If the deploy workflow exits early (test failure, network error) after committing the CNAME swap to staging but before restoring.
**How to avoid:** CNAME restore step should be in a `finally`-equivalent (`if: always()`) step. Also: validate `cat CNAME` before the workflow starts — abort if it's already `steinsandvines.ca`.
**Warning signs:** `staging.steinsandvines.ca` starts serving production-flavored content.

### Pitfall 4: Railway "Wait for CI" Skips Deploy on Unrelated Check Failure
**What goes wrong:** A passing GitHub Actions workflow run still causes Railway to SKIP the deploy because another installed app (CodeCov, Dependabot, etc.) has a failing check suite.
**Why it happens:** Railway's "Wait for CI" monitors ALL check suites on the repository, not just the named Actions workflow.
**How to avoid:** If this becomes a problem, switch to Approach B (disable auto-deploy + use `railway up` from workflow).
**Warning signs:** Railway dashboard shows deploys stuck in WAITING or SKIPPED even after tests pass.

### Pitfall 5: CNAME Commit Message Missing [skip ci]
**What goes wrong:** CNAME swap commit triggers `tests.yml` (tests.yml triggers on push to main), causing a duplicate test run during deploy.
**Why it happens:** Any commit to main without `[skip ci]` triggers tests.yml.
**How to avoid:** Include `[skip ci]` in the CNAME swap commit messages (already done in existing practice).
**Warning signs:** Redundant test runs in Actions tab after each deploy.

### Pitfall 6: PROD_DEPLOY_TOKEN Expiry
**What goes wrong:** Snapshot job fails to push to production repo with 401.
**Why it happens:** Fine-grained PATs have configurable expiry (max 1 year).
**How to avoid:** Set token expiry to maximum (1 year) and add a calendar reminder. Or use a GitHub App token (no expiry).
**Warning signs:** `update-snapshot.yml` fails with "remote: Invalid username or password".

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Express `res.json()` serializes `"redis":true` with no space after colon | Target 3, UptimeRobot keyword | UptimeRobot keyword `"redis":true` wouldn't match; use `"redis"` as keyword instead |
| A2 | Railway auto-deploy triggers within ~60-90s of a force-push being received | Target 2, smoke-check grace window | Smoke check polls too early and fails; increase retry wait to 30s |
| A3 | GitHub Actions ubuntu-latest includes `python3` for JSON parsing | Target 4, smoke-check script | Use `jq` instead: `echo "$HEALTH" \| jq -r '.redis'` |
| A4 | HELCIM_API_TOKEN should be added to REQUIRED_IN_PROD | Target 6 | Payment processing silently fails in prod without it; or conversely, adding it prevents prod boot until token is set |

---

## Open Questions

1. **Should HELCIM_API_TOKEN be added to REQUIRED_IN_PROD?**
   - What we know: it is currently OPTIONAL; payments hard-fail at runtime without it
   - What's unclear: the MONITOR-02 requirement only lists 3 secrets; was HELCIM_API_TOKEN intentionally left out?
   - Recommendation: Add it to REQUIRED_IN_PROD alongside SENTRY_DSN. If it causes issues, it means the token wasn't set in Railway — which is the correct alarm.

2. **Should the gated-deploy workflow use Approach A (Wait for CI) or Approach B (disable auto-deploy + railway up)?**
   - What we know: both work; A is simpler, B gives more control
   - What's unclear: whether Railway's "Wait for CI" will cause issues with this project's check suite setup
   - Recommendation: Start with Approach A. Document fallback to B in RUNBOOK.md.

3. **UptimeRobot `"authenticated":true` alert — should it be set up?**
   - What we know: `authenticated:false` is expected after every deploy; alerting on it creates noise
   - What's unclear: whether the operator wants post-deploy re-auth reminders
   - Recommendation: Set up only the `"redis":true` keyword monitor initially. Document the `authenticated` monitor as an optional addition.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Railway CLI | Deploy ID fetch, `railway up` | YES | 4.30.2 at `/opt/homebrew/bin/railway` | Dashboard manual |
| `jq` | GitHub Actions JSON parsing | YES (ubuntu-latest default) | N/A | `python3 -c "import json,sys..."` |
| `python3` | Smoke check JSON parsing, snapshot validation | YES (ubuntu-latest default) | 3.x | `jq` |
| GitHub Actions `workflow_dispatch` | Gated deploy trigger | YES | N/A | — |
| `PROD_DEPLOY_TOKEN` secret | Cross-repo push (CNAME swap + snapshot) | NOT YET | N/A | Manual CNAME swap (existing ritual) |
| `RAILWAY_TOKEN` secret | `railway deployment list` in CI | NOT YET | N/A | Dashboard manual deploy ID lookup |
| UptimeRobot account | MONITOR-01 | NOT YET | N/A | No fallback (required per D-08) |

**Missing dependencies with no fallback:**
- UptimeRobot account (must be created by human)
- PROD_DEPLOY_TOKEN secret (must be created by human)
- RAILWAY_TOKEN secret (must be created by human, scoped to production service)

**Missing dependencies with fallback:**
- None (all missing items are human-action prerequisites, not blockers to code work)

---

## Project Constraints (from CLAUDE.md)

| Directive | Impact on Phase 33 |
|-----------|-------------------|
| Run `npm test` AND `cd zoho-middleware && npm test` before every commit | New `gated-deploy.yml` workflow must run both test suites |
| Never commit `.env` files or API credentials | `PROD_DEPLOY_TOKEN` and `RAILWAY_TOKEN` go in GitHub Secrets, never in code |
| ALL changes go to staging first; never push directly to production without staging approval | The `workflow_dispatch` gated-deploy IS the staging-approved prod deploy mechanism |
| CNAME is in `.gitignore` (WRONG — it IS tracked) | The new workflow must commit CNAME changes using the existing CNAME swap ritual |
| `enforce-cname.yml` workflow auto-corrects domain (BROKEN — 403) | Do NOT rely on this; the new workflow must manage CNAME itself |
| Never edit `js/main.js` directly — edit source in `js/modules/` | N/A — Phase 33 has no frontend JS changes |

---

## Security Domain

`security_enforcement: true` in `.planning/config.json`.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | — |
| V3 Session Management | No | — |
| V4 Access Control | No | — |
| V5 Input Validation | No | — |
| V6 Cryptography | No | — |
| V14 Configuration | YES | `validateEnv.js` boot gate + REQUIRED_IN_PROD; secrets in GitHub Secrets not code |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Secret exfiltration in workflow logs | Information Disclosure | Use `${{ secrets.X }}` (masked in logs); never echo tokens |
| PROD_DEPLOY_TOKEN over-scoped | Elevation of Privilege | Fine-grained PAT scoped to production repo + contents:write only |
| Smoke check bypass (skip health gate) | Tampering | Health check is mandatory step in workflow, not optional |
| CNAME poisoning via staging push | Spoofing | Validate CNAME value before any prod push; restore CNAME as `if: always()` step |

---

## Sources

### Primary (HIGH confidence)
- Direct code inspection: `.github/workflows/update-snapshot.yml`, `deploy-production.yml`, `tests.yml`, `enforce-cname.yml` — all read in full
- Direct code inspection: `zoho-middleware/server.js:103-119` — `/health` exact shape
- Direct code inspection: `zoho-middleware/lib/validateEnv.js` — full REQUIRED/REQUIRED_IN_PROD/OPTIONAL arrays
- Direct git log + `git ls-files` — CNAME tracking status confirmed
- Railway CLI 4.30.2 `--help` output — `railway deployment list --json`, `railway up` flags confirmed

### Secondary (MEDIUM confidence)
- [Railway Deployment Actions docs](https://docs.railway.com/deployments/deployment-actions) — rollback via dashboard + `deploymentRollback` GraphQL mutation
- [Railway Manage Deployments API](https://docs.railway.com/integrations/api/manage-deployments) — `deploymentRollback` mutation, `canRollback` constraint
- [Railway GitHub Autodeploys](https://docs.railway.com/deployments/github-autodeploys) — "Wait for CI" feature, disable auto-deploy
- [Railway blog: Using GitHub Actions with Railway](https://blog.railway.com/p/github-actions) — RAILWAY_TOKEN project token pattern
- [UptimeRobot Knowledge Hub: monitoring types](https://uptimerobot.com/knowledge-hub/monitoring/ultimate-guide-to-uptime-monitoring-types/) — keyword monitor scans raw HTTP body, JSON supported
- [UptimeRobot: monitoring interval](https://help.uptimerobot.com/en/articles/11360876-what-is-a-monitoring-interval-in-uptimerobot) — free tier = 5 min confirmed

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- DEPLOY-03 root cause: HIGH — verified by git log + two-repo divergence analysis
- Railway deploy ID retrieval: HIGH — verified via CLI --help on installed railway 4.30.2
- Railway rollback procedure: MEDIUM — dashboard steps from official docs; GraphQL mutation documented
- UptimeRobot free tier keyword monitoring: HIGH — confirmed from official knowledge hub
- CNAME tracking contradiction: HIGH — verified via git ls-files, git log, direct file read
- validateEnv.js gap (SENTRY_DSN): HIGH — direct file inspection

**Research date:** 2026-06-17
**Valid until:** 2026-07-17 (Railway CLI API changes slowly; UptimeRobot free tier stable)
