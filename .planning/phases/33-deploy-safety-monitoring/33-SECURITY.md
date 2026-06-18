---
phase: 33
slug: deploy-safety-monitoring
status: verified
threats_open: 0
asvs_level: 1
created: 2026-06-18
---

# Phase 33 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Domain: CI/CD pipeline + ops security (production deploy gate, nightly snapshot push, prod secret gate).

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| GitHub Actions runner → production repo | Force-push + tag from staging-run workflows | `PROD_DEPLOY_TOKEN` (fine-grained PAT) |
| GitHub Actions runner → Railway API | Deploy-ID lookup during gated deploy | `RAILWAY_TOKEN` (project token) |
| Human operator → GitHub/Railway secret stores | One-time creation of privileged tokens | Token values (never recorded) |
| External monitor → live `/health` | UptimeRobot polls the public health endpoint | None (read-only public endpoint) |
| Operator env → middleware boot | `REQUIRED_IN_PROD` fail-closed gate | Prod secrets (presence asserted at boot) |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-33-01 | Information Disclosure | `PROD_DEPLOY_TOKEN` in update-snapshot logs | mitigate | Token only as `${{ secrets.PROD_DEPLOY_TOKEN }}` inline in push URL (Actions auto-masks); no `echo` of value — `update-snapshot.yml` | closed |
| T-33-02 | Elevation of Privilege | `PROD_DEPLOY_TOKEN` over-scope | mitigate | Fine-grained PAT scoped to `koa-inn/steins-and-vines-production`, Contents+Workflows:write only — `RUNBOOK.md`, `33-HUMAN-UAT.md` | closed |
| T-33-03 | Tampering | Snapshot reverted by force-push (stale catalog) | mitigate | Repo-guarded nightly job dual-pushes snapshot to production — `update-snapshot.yml:21,99` | closed |
| T-33-04 | Information Disclosure | Tokens in gated-deploy logs | mitigate | Tokens only via `${{ secrets.* }}` inline / `env:`; the one `echo` prints the var NAME, not its value — `gated-deploy.yml` | closed |
| T-33-05 | Elevation of Privilege | `PROD_DEPLOY_TOKEN` over-scope (gated-deploy) | mitigate | `persist-credentials: false` + origin set to GITHUB_TOKEN URL; prod token only on production-repo URLs — `gated-deploy.yml:75,83` | closed |
| T-33-06 | Tampering | Deploy-gate bypass (broken code to prod) | mitigate | `needs: [test-middleware, test-frontend]`; mandatory smoke-check hard-fail; break-glass documented as intentional — `gated-deploy.yml:57` | closed |
| T-33-07 | Spoofing | CNAME poisoning (staging served as prod domain) | mitigate | Pre-flight CNAME guard (`exit 1` if already prod value) + swap-then-`git reset --hard` so origin never receives the prod CNAME (no mid-swap window) — `gated-deploy.yml:88-98,128` | closed |
| T-33-08 | Tampering | Smoke-check skipped / fail-open | mitigate | Hard `exit 1` on non-200 or `redis != true` after retries; only `authenticated:false` is soft-warn — `gated-deploy.yml` | closed |
| T-33-09 | Elevation of Privilege | `PROD_DEPLOY_TOKEN` / `RAILWAY_TOKEN` scope | mitigate | Per-remote token isolation (`persist-credentials: false`); RAILWAY_TOKEN scoped to sv-middleware + production — `gated-deploy.yml:75`, `RUNBOOK.md` | closed |
| T-33-10 | Information Disclosure | Token values pasted into UAT/runbook | mitigate | Only names/scopes/dates + non-secret IDs (deploy ID, run ID, SHAs) recorded; no token values — `33-HUMAN-UAT.md`, `RUNBOOK.md` | closed |
| T-33-11 | Denial of Service | Missing prod secret blocks boot after deploy | accept | Intended fail-closed (MONITOR-02) — see Accepted Risks Log | closed |
| T-33-SC | Tampering | npm/pip/cargo supply-chain | mitigate | No new packages this phase; workflows run only existing `npm install`/`test`/`lint` from `tests.yml` | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

### Additional finding verified (code review → fixed pre-audit)

Shell-injection / table-corruption via the deploy `reason` input is mitigated: passed via `env: REASON_RAW` (no direct `${{ }}` shell interpolation) and sanitized with `tr -d '\r\n' | tr '|' '/'` before being written to the RUNBOOK row — `gated-deploy.yml:207-213`. Verified sound by the auditor.

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-33-01 | T-33-11 | Missing `REQUIRED_IN_PROD` secret causes `process.exit(1)` at boot under `NODE_ENV=production` (`validateEnv.js:108-117`). This is the designed fail-closed alarm (MONITOR-02 / D-09), not a regression — the operator sets all prod secrets before deploy. A healthy post-deploy `/health` boot (run 27765441259, uptime ~458s) proves the gate is active and all secrets present. | koainn | 2026-06-18 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-06-18 | 12 | 12 | 0 | gsd-security-auditor (verify mode; block_on: high) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-06-18
