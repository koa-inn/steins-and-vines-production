# Phase 33: Deploy Safety & Monitoring — Pattern Map

**Mapped:** 2026-06-17
**Files analyzed:** 5 new/modified files
**Analogs found:** 5 / 5

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `.github/workflows/gated-deploy.yml` | workflow (CI/CD) | event-driven (workflow_dispatch) | `.github/workflows/tests.yml` | role-match (same runner pattern, multi-job `needs:`) |
| `.github/workflows/update-snapshot.yml` | workflow (CI/CD) | batch (scheduled cron, file I/O) | itself (modify in place) | exact (same file, two additions: repo guard + cross-repo push step) |
| `docs/RUNBOOK.md` | documentation | — | `docs/DEPLOYMENT.md` | role-match (same doc style: procedure tables + code blocks) |
| `zoho-middleware/lib/validateEnv.js` | utility (config guard) | request-response (startup check) | itself (modify in place) | exact (add one entry to existing REQUIRED_IN_PROD array) |
| `/health` endpoint (no-op) | — | — | `zoho-middleware/server.js:103-120` | exact — already exists, no change needed |

---

## Pattern Assignments

### `.github/workflows/gated-deploy.yml` (new workflow, event-driven / workflow_dispatch)

**Analog:** `.github/workflows/tests.yml` (multi-job structure, `needs:`, `actions/checkout@v4`, `actions/setup-node@v4`)
**Secondary analog:** `.github/workflows/deploy-production.yml` (repo guard pattern, `actions/deploy-pages@v4`)
**Tertiary analog:** `.github/workflows/update-snapshot.yml` (python3 JSON parsing, curl + HTTP status check, git commit/push pattern)

**Trigger pattern** (from `tests.yml` lines 3-6, adapted for `workflow_dispatch`):
```yaml
on:
  workflow_dispatch:
    inputs:
      reason:
        description: 'Reason for this production deploy'
        required: false
        default: ''
```

**Multi-job with `needs:` gate pattern** (from `tests.yml` lines 8-47):
```yaml
jobs:
  test-middleware:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm install
        working-directory: zoho-middleware
      - run: npm test
        working-directory: zoho-middleware
      - name: Lint middleware
        run: npm run lint
        working-directory: zoho-middleware

  test-frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm install
      - run: npm test
      - name: Lint frontend
        run: npm run lint
```

**`needs:` dependency pattern** (from `tests.yml` lines 42-47 — E2E job depending on both test jobs):
```yaml
  test-e2e:
    needs: [test-frontend, test-middleware]
    # ... deploy job should use: needs: [test-middleware, test-frontend]
```

**Repo guard pattern** (from `deploy-production.yml` lines 12-23):
```yaml
  check-repo:
    runs-on: ubuntu-latest
    outputs:
      is_production: ${{ steps.check.outputs.is_production }}
    steps:
      - id: check
        run: |
          if [[ "${{ github.repository }}" == *"-production" ]]; then
            echo "is_production=true" >> "$GITHUB_OUTPUT"
          else
            echo "is_production=false" >> "$GITHUB_OUTPUT"
          fi
```

**curl HTTP status check pattern** (from `update-snapshot.yml` lines 33-44):
```yaml
      - name: Fetch snapshot from middleware
        id: fetch
        run: |
          HTTP_CODE=$(curl -s -o snapshot_raw.json -w "%{http_code}" \
            --max-time 60 \
            "https://svmiddleware-production.up.railway.app/api/snapshot")
          if [ "$HTTP_CODE" != "200" ]; then
            echo "ERROR: Middleware returned HTTP $HTTP_CODE"
            exit 1
          fi
```

**python3 JSON parsing pattern** (from `update-snapshot.yml` lines 47-69):
```yaml
          python3 -c "import sys,json; d=json.load(open('snapshot_raw.json')); sys.exit(1 if 'error' in d else 0)"
          # For inline here-doc block style:
          python3 - <<'PYEOF'
          import json, sys
          d = json.load(open('snapshot_raw.json'))
          # ... parse fields
          PYEOF
```

**Git config + commit pattern** (from `update-snapshot.yml` lines 79-88):
```yaml
      - name: Commit and push if changed
        run: |
          git config user.name  "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add content/zoho-snapshot.json
          if git diff --staged --quiet; then
            echo "Snapshot unchanged — nothing to commit"
          else
            git commit -m "chore: update Zoho snapshot [skip ci]"
            git push
          fi
```

**GitHub Pages deploy pattern** (from `deploy-production.yml` lines 25-59):
```yaml
  deploy:
    needs: check-repo
    if: needs.check-repo.outputs.is_production == 'true'
    runs-on: ubuntu-latest
    permissions:
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: ${{ steps.deploy.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - name: Strip .planning from published artifact
        run: rm -rf .planning
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: .
      - id: deploy
        uses: actions/deploy-pages@v4
```

**Key construction notes for `gated-deploy.yml`:**
- Workflow lives on the **staging repo** (`koa-inn/steins-and-vines-staging`), triggered by `workflow_dispatch` only (D-02).
- Two parallel test jobs (`test-middleware`, `test-frontend`) matching `tests.yml` structure, then a `deploy` job with `needs: [test-middleware, test-frontend]` (D-03).
- CNAME swap before force-push; restore in an `if: always()` step (Pitfall 3 guard from RESEARCH.md).
- Smoke-check step after deploy: curl retry loop (5 × 20s), hard-fail on non-200 or `redis` != `true`, soft-warn on `authenticated` == `false` (D-04/D-05 and RESEARCH.md Target 4).
- `PROD_DEPLOY_TOKEN` secret for cross-repo push; `RAILWAY_TOKEN` secret for `railway deployment list --json` (RESEARCH.md Target 2).
- `[skip ci]` in CNAME-swap commit messages (Pitfall 5).
- Tag creation step: `prod-$(date -u +%Y%m%d)-N` (D-06).
- RUNBOOK.md append step before restoring CNAME (D-07).

---

### `.github/workflows/update-snapshot.yml` (existing file — two targeted additions)

**Analog:** itself — modify in-place at two locations only.

**Addition 1 — Repo guard** (add `if:` condition to the `update-snapshot` job, after line 19):
```yaml
jobs:
  update-snapshot:
    runs-on: ubuntu-latest
    if: github.repository == 'koa-inn/steins-and-vines-staging'   # ADD THIS
    permissions:
      contents: write
```
This prevents the job from running on the production repo (which receives the file via force-push). Only the staging repo runs the nightly snapshot fetch.

**Addition 2 — Cross-repo push** (replace the `git push` on line 87 inside the "Commit and push if changed" step):
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
            git push origin main
            git push https://x-access-token:${{ secrets.PROD_DEPLOY_TOKEN }}@github.com/koa-inn/steins-and-vines-production.git HEAD:main
            echo "Snapshot pushed to both staging and production repos"
          fi
```
The cross-repo push requires the same `PROD_DEPLOY_TOKEN` secret used by `gated-deploy.yml`. Pattern for `x-access-token:` URL authentication is standard GitHub Actions practice (no additional library needed).

**No other changes to `update-snapshot.yml`** — the fetch, validate, and write-file steps are unchanged.

---

### `docs/RUNBOOK.md` (new file)

**Analog:** `docs/DEPLOYMENT.md` — same documentation style: section headers (`##`), tables, fenced code blocks, numbered procedure steps.

**Structure pattern** (from `docs/DEPLOYMENT.md`):
```markdown
# Title

## Overview

Brief table: component | detail | detail

---

## Section Heading

1. Numbered steps
2. With code blocks:
   ```bash
   command here
   ```

---

## Rolling Back

### Sub-surface Rollback
Steps...
```

**Key sections `RUNBOOK.md` must contain** (per D-06/D-07):
1. **Deploy History** — auto-appended table by `gated-deploy.yml`: `| Date | Git SHA | Railway Deploy ID | Deploy URL | Notes |`
2. **Rollback Procedures** — two sub-sections: GitHub Pages rollback (git revert + force-push) and Railway middleware rollback (dashboard steps + GraphQL mutation documented in RESEARCH.md Target 2).
3. **UptimeRobot Setup** — one-time human checklist (D-08, RESEARCH.md Target 3 monitor config steps).
4. **CNAME Swap Reference** — reminder of the swap ritual (do not rely on enforce-cname.yml which is broken/403).
5. **Phase 32 UAT Close** — Railway human action checklist (NODE_ENV=production, 4 prod secrets, from RESEARCH.md Target 6).

**Append format the workflow writes** (one row per deploy):
```
| 2026-06-17 | abc1234 | xxxx-yyyy-zzzz | https://railway.app/... | manual deploy via gated-deploy.yml |
```

---

### `zoho-middleware/lib/validateEnv.js` (existing file — one-line addition)

**Analog:** itself — add one entry to the existing `REQUIRED_IN_PROD` array.

**Current `REQUIRED_IN_PROD` array** (lines 13-18):
```javascript
var REQUIRED_IN_PROD = [
  { name: 'RECAPTCHA_SECRET_KEY', desc: 'Google reCAPTCHA secret — required in prod (fail-closed, HARDEN-01)' },
  { name: 'HELCIM_WEBHOOK_SECRET', desc: 'Helcim webhook HMAC secret — required in prod (fail-closed, HARDEN-02)' },
  { name: 'CALCOM_WEBHOOK_SECRET', desc: 'Cal.com webhook HMAC secret — required in prod (fail-closed, HARDEN-02)' },
  { name: 'REDIS_ENCRYPTION_KEY', desc: 'Redis Zoho refresh-token encryption key — required in prod (#106)' },
];
```

**Addition — append `SENTRY_DSN` entry** (per RESEARCH.md Target 6 gap analysis):
```javascript
var REQUIRED_IN_PROD = [
  { name: 'RECAPTCHA_SECRET_KEY',  desc: 'Google reCAPTCHA secret — required in prod (fail-closed, HARDEN-01)' },
  { name: 'HELCIM_WEBHOOK_SECRET', desc: 'Helcim webhook HMAC secret — required in prod (fail-closed, HARDEN-02)' },
  { name: 'CALCOM_WEBHOOK_SECRET', desc: 'Cal.com webhook HMAC secret — required in prod (fail-closed, HARDEN-02)' },
  { name: 'REDIS_ENCRYPTION_KEY',  desc: 'Redis Zoho refresh-token encryption key — required in prod (#106)' },
  { name: 'SENTRY_DSN',            desc: 'Sentry DSN for error tracking — required in prod (MONITOR-02, phase 33)' },  // ADD
];
```

**Also remove the duplicate `SENTRY_DSN` entry from `OPTIONAL`** (line 29) to avoid the confusing duplication (it currently appears in OPTIONAL with a weaker description). The REQUIRED_IN_PROD check will enforce it; leaving it in OPTIONAL too creates misleading startup log output saying "optional var SENTRY_DSN not set" after the hard-fail gate already caught it.

**No other logic changes** — the `validateEnv()` function body (lines 70-132) is unchanged; the REQUIRED_IN_PROD loop already handles the new entry at lines 107-116.

---

### `/health` endpoint (no change — consume as-is)

**Source:** `zoho-middleware/server.js` lines 103-120

**Exact response shape** (verified):
```javascript
app.get('/health', function (req, res) {
  // Always returns HTTP 200
  res.json({
    status: 'ok',
    authenticated: zohoAuth.isAuthenticated(),  // false on fresh restart
    redis: redisPong,                            // true only if Redis PONG received
    uptime: process.uptime()
  });
});
```

**Smoke-check contract** (for `gated-deploy.yml` to copy):
- Hard-fail: `HTTP != 200` OR `redis == false`
- Soft-warn: `authenticated == false` (expected on Railway restart — log warning only, do not fail)
- `uptime` field available for logging but not used as gate condition

---

## Shared Patterns

### Secret masking in workflow steps
**Source:** All three existing `.github/workflows/*.yml` files — consistent pattern
**Apply to:** All steps in `gated-deploy.yml` and `update-snapshot.yml` that use tokens
```yaml
env:
  GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
# For cross-repo token: embed inline in URL only, never echo the token value
# git push https://x-access-token:${{ secrets.PROD_DEPLOY_TOKEN }}@github.com/...
```

### `[skip ci]` commit message convention
**Source:** `update-snapshot.yml` line 85 — `"chore: update Zoho snapshot [skip ci]"`
**Apply to:** All automated commits in both workflows (CNAME swap, RUNBOOK.md append, snapshot push)
**Purpose:** Prevents `tests.yml` triggering on bot commits (Pitfall 5 in RESEARCH.md)

### `actions/checkout@v4` with explicit token for push
**Source:** `update-snapshot.yml` lines 27-29
```yaml
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
```
**Apply to:** `gated-deploy.yml` checkout step (needed for git push back to staging after CNAME restore)

### `if: always()` for cleanup/restore steps
**Source pattern:** Standard GitHub Actions — used in `tests.yml` for artifact upload on failure (`if: failure()`).
**Apply to:** CNAME restore step in `gated-deploy.yml` — must run even if smoke-check or Railway step fails (Pitfall 3). Use `if: always()`.

### python3 JSON field extraction
**Source:** `update-snapshot.yml` lines 47-48
```bash
python3 -c "import sys,json; d=json.load(open('file.json')); sys.exit(1 if 'error' in d else 0)"
```
**Apply to:** Smoke-check step in `gated-deploy.yml` for parsing `/health` response. Use `jq` as simpler alternative (available on ubuntu-latest):
```bash
REDIS=$(echo "$HEALTH" | jq -r '.redis')
AUTH=$(echo "$HEALTH" | jq -r '.authenticated')
```

---

## No Analog Found

All files have analogs. No entries in this section.

---

## Metadata

**Analog search scope:** `.github/workflows/`, `zoho-middleware/lib/`, `docs/`, `zoho-middleware/server.js`
**Files read:** 7 source files (`deploy-production.yml`, `tests.yml`, `update-snapshot.yml`, `enforce-cname.yml`, `validateEnv.js`, `server.js:95-130`, `DEPLOYMENT.md`)
**Pattern extraction date:** 2026-06-17
