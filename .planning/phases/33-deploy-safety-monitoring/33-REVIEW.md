---
phase: 33-deploy-safety-monitoring
reviewed: 2026-06-18T18:00:00Z
depth: deep
files_reviewed: 5
files_reviewed_list:
  - .github/workflows/gated-deploy.yml
  - .github/workflows/update-snapshot.yml
  - zoho-middleware/lib/validateEnv.js
  - zoho-middleware/__tests__/validateEnv.test.js
  - docs/RUNBOOK.md
findings:
  critical: 1
  warning: 4
  info: 2
  total: 7
status: resolved
resolved: 2026-06-18T15:00:00Z
resolution: "CR-01 (blocker) + WR-01..WR-04 fixed in the same phase; INFO items folded into the WR fixes. See Resolution Log below."
---

# Phase 33: Code Review Report

> **Resolution Log (2026-06-18):** All actionable findings fixed and verified (780 middleware tests pass, both workflows YAML-valid):
> - **CR-01** — `update-snapshot.yml` now uses `persist-credentials: false` + a `git remote set-url origin` step, so the nightly production cross-push authenticates with `PROD_DEPLOY_TOKEN` instead of being overridden by the persisted `GITHUB_TOKEN` extraheader. (To be confirmed live at the next nightly run or a manual `workflow_dispatch`.)
> - **WR-01** — `HELCIM_API_TOKEN` added to the RUNBOOK Phase 32 secrets checklist.
> - **WR-02** — RUNBOOK CNAME section rewritten to describe the swap-then-`git reset --hard` design (no restore step; staging CNAME never changes).
> - **WR-03** — the `reason` input is now passed via `env:` and sanitized (`tr -d '\r\n' | tr '|' '/'`) before being written to the RUNBOOK row — no shell injection or table corruption.
> - **WR-04** — the four prod-required vars removed from `OPTIONAL` in `validateEnv.js` (no more misleading "optional not set" warning).
> - **INFO (table append at EOF)** — the RUNBOOK row is now inserted into the Deploy History table (anchored on the heading + separator, newest-first) instead of appended at EOF.

**Reviewed:** 2026-06-18T18:00:00Z
**Depth:** deep
**Files Reviewed:** 5
**Status:** issues_found

## Summary

Phase 33 delivered a gated production deploy workflow (`gated-deploy.yml`), a repo-guarded nightly snapshot cross-pusher (`update-snapshot.yml`), validateEnv hardening for two new prod secrets, and a companion runbook. The `gated-deploy.yml` logic is sound after its three fixup commits — the CNAME-swap-via-reset design, token scoping, and failure-safety gating all appear correct. The `validateEnv.js` changes are correct and well-tested.

One **critical bug** was found in `update-snapshot.yml`: it uses the same `persist-credentials` anti-pattern that was explicitly identified and fixed in `gated-deploy.yml` during this phase, meaning every cross-push to the production repo will fail with 403. Four additional warnings cover a missing prerequisite in the runbook, stale CNAME documentation, duplicate variable declarations, and a shell-injection vector in the `reason` input.

---

## Critical Issues

### CR-01: `update-snapshot.yml` production cross-push always fails (same persist-credentials bug fixed in gated-deploy)

**File:** `.github/workflows/update-snapshot.yml:26-29, 88`

**Issue:** The `Checkout repository` step specifies `token: ${{ secrets.GITHUB_TOKEN }}` without `persist-credentials: false`. `actions/checkout` with any `token:` value writes a git `http.https://github.com/.extraheader` authorization header that applies to **all** `github.com` HTTPS URLs and silently overrides the `x-access-token:PROD_DEPLOY_TOKEN` credential embedded in the explicit production push URL on line 88. The result: the production push authenticates as `GITHUB_TOKEN` (scoped to the staging repo only), GitHub rejects it with 403, and the snapshot is never written to the production repo.

This is word-for-word the bug the `gated-deploy.yml` comments call out and fix with `persist-credentials: false` (commit `560cef1`). `update-snapshot.yml` received the cross-push feature in the same phase (`7826bef`) but was not given the same fix.

The practical consequence is that `content/zoho-snapshot.json` on `koa-inn/steins-and-vines-production` is never updated by the nightly bot; production will serve a stale fallback snapshot indefinitely while staging gets fresh data every night.

**Fix:**

```yaml
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          persist-credentials: false   # prevents GITHUB_TOKEN extraheader from overriding PROD_DEPLOY_TOKEN

      - name: Configure origin auth for staging push
        run: |
          git remote set-url origin "https://x-access-token:${{ secrets.GITHUB_TOKEN }}@github.com/${{ github.repository }}.git"
```

Then remove the now-redundant `token:` field. This mirrors the pattern already used in `gated-deploy.yml` steps a + a2.

---

## Warnings

### WR-01: `HELCIM_API_TOKEN` missing from RUNBOOK.md operator prerequisite checklist

**File:** `docs/RUNBOOK.md:166-177`

**Issue:** The "Phase 32 Railway Secrets" checklist lists 6 secrets an operator must set before the first gated deploy. `HELCIM_API_TOKEN` was promoted to `REQUIRED_IN_PROD` in this phase (`validateEnv.js:21`), meaning the middleware will refuse to boot in production without it. But the checklist does not include it. An operator following the runbook verbatim would configure all listed secrets, trigger the gated deploy, and watch it fail at boot with `[startup] Missing required prod secret: HELCIM_API_TOKEN`.

**Fix:** Add to the checklist at `docs/RUNBOOK.md` line 177, before the closing paragraph:

```markdown
- [ ] `HELCIM_API_TOKEN` — Helcim API token for payment processing (required in prod as of Phase 33, ROADMAP SC#5)
```

Also update the closing note: "A healthy post-deploy `/health` response confirms all `REQUIRED_IN_PROD` vars — now 6 total — are present."

---

### WR-02: RUNBOOK.md CNAME Reference section describes a restore step that no longer exists

**File:** `docs/RUNBOOK.md:185-194`

**Issue:** The "CNAME Reference" table and bullet list still describe the **old** two-step swap/restore design that was replaced in commit `04c09d9`:

```
| After restore | staging.steinsandvines.ca | Restored by gated-deploy after force-push |

3. Restores staging.steinsandvines.ca in an `if: always()` step (runs even if smoke-check fails)
```

Neither of these is true. The current design uses `git reset --hard` to discard the CNAME-swap commit locally after the force-push; staging's `origin` never receives it and no separate restore step exists. An operator responding to an incident by reading the runbook would look for a step 3 restore that doesn't exist, and the "After restore" table row implies staging's CNAME changes and changes back during a normal deploy — which it doesn't.

**Fix:** Replace lines 185–194 with:

```markdown
| State | CNAME value | When |
|-------|-------------|------|
| Staging (normal) | `staging.steinsandvines.ca` | Always — the swap commit is reset away locally |
| Production deploy | `steinsandvines.ca` | Committed locally, force-pushed to production only |

**The gated-deploy workflow handles the CNAME swap automatically:**
1. Validates CNAME is `staging.steinsandvines.ca` before starting (aborts if already the production value)
2. Commits `steinsandvines.ca` locally, force-pushes to production, then immediately runs `git reset --hard` to discard the swap commit locally — staging/origin never receives the production CNAME
```

---

### WR-03: `reason` workflow input interpolated directly into shell — shell injection via table pipe corruption and command substitution

**File:** `.github/workflows/gated-deploy.yml:207, 210`

**Issue:** The `reason` input from `workflow_dispatch` is interpolated directly by the GitHub Actions expression engine into the shell script body before the shell runs:

```yaml
REASON="${{ github.event.inputs.reason }}"
ROW="| ... | ${REASON:-manual deploy via gated-deploy.yml} |"
```

Two problems:

1. **Command substitution:** If a collaborator enters `$(id)` as the reason, the generated shell script becomes `REASON="$(id)"` and bash expands the subshell when constructing `ROW`. The output of the command is written into `RUNBOOK.md` and committed.

2. **Markdown table corruption:** A reason containing `|` breaks the Markdown table structure (verified: input `"a | b"` produces `| ... | a | b |` — a six-column row in a five-column table).

Trigger requires repo write access, so this is not a public attack surface. But GitHub's own security hardening guide recommends passing `workflow_dispatch` inputs via `env:` to prevent expression injection.

**Fix:**

```yaml
      - name: Append deploy history to RUNBOOK.md
        if: success()
        env:
          REASON: ${{ github.event.inputs.reason }}
        run: |
          # REASON is now an env var — bash does not re-expand it
          SAFE_REASON="${REASON//|/∣}"   # replace pipe chars to protect table structure
          ROW="| ${UTC_DATE} | \`${SHORT_SHA}\` | \`${DEPLOY_ID}\` | [Run](${RUN_URL}) | ${SAFE_REASON:-manual deploy via gated-deploy.yml} |"
```

---

### WR-04: `validateEnv.js` — four prod-required secrets appear in both `REQUIRED_IN_PROD` and `OPTIONAL`, generating misleading warnings in dev

**File:** `zoho-middleware/lib/validateEnv.js:16-19, 36-39, 59`

**Issue:** `RECAPTCHA_SECRET_KEY`, `HELCIM_WEBHOOK_SECRET`, `CALCOM_WEBHOOK_SECRET`, and `REDIS_ENCRYPTION_KEY` appear in both `REQUIRED_IN_PROD` (lines 16–19) and `OPTIONAL` (lines 36–39, 59). In development/CI where `NODE_ENV !== 'production'`, these four secrets are correctly not required — but they also appear in the `missingOptional` log line, generating a noisy warning that lists them alongside genuinely optional configuration (Zoho custom fields, fee item IDs, etc.).

This means a clean dev environment will log: `[startup] Optional env vars not set: ..., RECAPTCHA_SECRET_KEY, HELCIM_WEBHOOK_SECRET, ...` even though their absence is expected and intentional in dev. This erodes the signal value of optional-var warnings: developers learn to ignore them.

In production the `REQUIRED_IN_PROD` check exits before the optional-var log fires, so there is no functional impact in prod.

**Fix:** Remove the four duplicated entries from `OPTIONAL`:

```javascript
// Remove these four from the OPTIONAL array (they are already in REQUIRED_IN_PROD):
// { name: 'RECAPTCHA_SECRET_KEY', ... }   line 36
// { name: 'HELCIM_WEBHOOK_SECRET', ... }  line 38
// { name: 'REDIS_ENCRYPTION_KEY', ... }   line 39
// { name: 'CALCOM_WEBHOOK_SECRET', ... }  line 59
```

---

## Info

### IN-01: `gated-deploy.yml` — no concurrency group; parallel manual triggers race on the tag counter

**File:** `.github/workflows/gated-deploy.yml:14`

**Issue:** `gated-deploy.yml` has no `concurrency:` group. If two `workflow_dispatch` runs start within seconds of each other, both pass tests, both read `git tag -l "prod-YYYYMMDD-*" | wc -l` and get `EXISTING=0`, both compute `TAG_NAME=prod-YYYYMMDD-1`, and the second tag push fails. Because the tag step precedes the runbook step and uses the default `if: success()`, the second run's force-push to production goes unrecorded in RUNBOOK.md. For a single-developer shop this is a theoretical concern, but it is the only scenario where a production deploy can succeed without a runbook entry.

**Fix:** Add a concurrency group to serialize deploys:

```yaml
concurrency:
  group: production-deploy
  cancel-in-progress: false   # never cancel a deploy in progress
```

---

### IN-02: `gated-deploy.yml` — `TAG_NAME` written to `GITHUB_ENV` but never read by any downstream step

**File:** `.github/workflows/gated-deploy.yml:196`

**Issue:** Step g writes `echo "TAG_NAME=${TAG_NAME}" >> "$GITHUB_ENV"` but no subsequent step references `$TAG_NAME` or `${{ env.TAG_NAME }}`. The smoke-check step (i) and runbook step (h) both use `SHORT_SHA` from step outputs, not the tag name. The dead write is harmless but adds noise.

**Fix:** Remove line 196 (`echo "TAG_NAME=${TAG_NAME}" >> "$GITHUB_ENV"`). If the tag name is ever needed in a later step, add it then.

---

_Reviewed: 2026-06-18T18:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
