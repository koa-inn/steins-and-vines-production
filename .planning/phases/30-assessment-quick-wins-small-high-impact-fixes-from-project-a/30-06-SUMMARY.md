---
phase: 30-assessment-quick-wins-small-high-impact-fixes-from-project-a
plan: "06"
subsystem: middleware-infra
tags: [railway, node-cron, jest, npm-audit, config-cleanup]
dependency_graph:
  requires: [30-01]
  provides: [watchPatterns-scoped-builds, node-cron-4-upgraded, jest-coverage-clean]
  affects: [railway.toml, zoho-middleware/package.json, zoho-middleware/jest.config.js]
tech_stack:
  added: []
  patterns: [railway-watchPatterns, node-cron-v4-cjs, jest-coverage-config]
key_files:
  created: []
  modified:
    - railway.toml
    - zoho-middleware/package.json
    - zoho-middleware/jest.config.js
    - zoho-middleware/__tests__/checkout-fallback-email.test.js
decisions:
  - "node-cron v4 CJS require().schedule(expr, fn) API is backward-compatible — server.js cron call unchanged"
  - "package-lock.json is gitignored at repo root — only package.json committed for node-cron upgrade"
  - "Remaining 22 npm audit findings are all in Jest dev deps (js-yaml/form-data/opentelemetry) — pre-existing, out of scope"
metrics:
  duration: "~8 minutes"
  completed: "2026-06-15"
  tasks_auto: 2
  tasks_pending_human: 3
---

# Phase 30 Plan 06: Config/Infra + Jest Cleanup Summary

One-liner: railway.toml scoped to middleware-only rebuilds, node-cron upgraded from 3.0.3 to 4.2.1 clearing 2 moderate audit findings, and stale jest coverage exclusion removed.

## Tasks Completed (Auto)

### Task 1 — railway.toml watchPatterns + jest cleanup (#19 #21)

**Commit:** `002ac35`
**Files:** `railway.toml`, `zoho-middleware/jest.config.js`, `zoho-middleware/__tests__/checkout-fallback-email.test.js`

- Added `watchPatterns = ["zoho-middleware/**"]` to `[build]` in `railway.toml` — frontend-only pushes no longer trigger Railway middleware rebuilds.
- Removed the stale `'!lib/mailer.js'` coverage exclusion from `zoho-middleware/jest.config.js`; mailer.js now appears in coverage at 82.45% lines (Campaign 2 tests added in 30-01).
- Corrected the misleading header comment in `checkout-fallback-email.test.js` lines 4-5 to accurately describe what is being tested (customer order-confirmation email via Resend API after checkout). Assertions unchanged per CLAUDE.md rule 10.
- All 648 middleware tests green.

### Task 2 — Upgrade node-cron to 4.2.1 (#20)

**Commit:** `c9c6049`
**Files:** `zoho-middleware/package.json`

- Ran `npm i node-cron@4.2.1` from the `zoho-middleware/` directory.
- node-cron v4 CJS `require('node-cron').schedule` is backward-compatible — the `cron.schedule('0 5,13 * * *', fn)` call at `server.js:426` needs no changes.
- 2 moderate npm audit findings cleared: `uuid` (GHSA-w5hq-g745-h8pq) and dependent `node-cron 3.0.2-3.0.3`.
- Before: 24 vulnerabilities (23 moderate, 1 high). After: 22 vulnerabilities (21 moderate, 1 high) — 2 moderate removed as expected.
- All 648 middleware tests green.

## Deviations from Plan

None — plan executed exactly as written. The cron.schedule() v4 compatibility check confirmed no code changes required (CJS API unchanged for basic usage).

## PENDING: Human Checkpoints (3 items)

These tasks CANNOT be auto-completed. The orchestrator should surface them to the user verbatim.

---

### Task 3 (checkpoint:human-verify — gate: blocking-human): Verify node-cron@4.2.1 Legitimacy

Before deploying to Railway, confirm:

1. Visit https://npmjs.com/package/node-cron — verify 4.2.1 is the legitimate published version (not typosquatted).
2. Confirm `cd zoho-middleware && npm audit` shows the 2 prior moderate findings cleared (uuid/node-cron chain) with no new high/critical introduced. Current state: 22 vulns (21 moderate, 1 high, all in Jest dev deps — pre-existing).
3. Confirm `cd zoho-middleware && npm test` passes (648 tests) — verified locally but confirm before Railway deploy.
4. Optionally start the middleware locally and confirm `[cron] Scheduled warm-up registered: 05:00 and 13:00 UTC daily` appears in startup log.

Resume signal: Type "approved" once node-cron@4.2.1 is verified legitimate and the cron warm-up still registers.

---

### Task 4 (checkpoint:human-action — gate: blocking): Railway Env Vars (#17) + Uptime Monitor (#18)

**Item #17 — Railway Dashboard (zoho-middleware service → Variables):**

Confirm these 4 env vars are SET in PRODUCTION:
- `REDIS_ENCRYPTION_KEY` — closes issue #106; without it the Zoho refresh token is stored plaintext
- `HELCIM_WEBHOOK_SECRET`
- `RECAPTCHA_SECRET_KEY`
- `SENTRY_DSN`

Record which were already set vs. newly added.

**Item #18 — Uptime Monitor:**

Stand up an external uptime monitor (UptimeRobot or Better Stack) pointed at the middleware `/health` endpoint. Configure it to alert when the health payload reports `authenticated:false` or `redis:false`. Record the monitor URL/check created.

Resume signal: Type "done" once the four Railway env vars are confirmed/added and the /health uptime monitor is live.

---

### Task 5 (checkpoint:human-verify — gate: blocking): Deploy to Staging + Railway Prod

After Tasks 3 and 4 are cleared:

1. Run `npm test` (frontend), `cd zoho-middleware && npm test`, and `npm run lint` — confirm all green locally.
2. Confirm CNAME reads `staging.steinsandvines.ca`; run `git push origin main`. Confirm a frontend-only push does NOT trigger a middleware rebuild on Railway (watchPatterns working).
3. Deploy the middleware change to Railway prod (node-cron + jest/config changes). Confirm the middleware boots, `/health` returns healthy (authenticated + redis ok), and `[cron] Scheduled warm-up registered` appears in the startup log.
4. Promote frontend config (railway.toml lives at repo root) to production per staging-first workflow.

Resume signal: Type "approved" once the middleware is healthy on Railway with node-cron@4.2.1 and watchPatterns confirmed.

---

## Known Stubs

None — this plan is config/infra only (no UI or data rendering changes).

## Threat Flags

None introduced — no new network endpoints, auth paths, or schema changes.

## Self-Check

- [x] `railway.toml` contains `watchPatterns = ["zoho-middleware/**"]`
- [x] `zoho-middleware/jest.config.js` has no `mailer.js` or `gp.js` coverage exclusion
- [x] `checkout-fallback-email.test.js` header corrected; assertions unchanged
- [x] `node-cron` in `package.json` is `^4.2.1`
- [x] `cron.schedule('0 5,13 * * *', fn)` at server.js:426 is v4-valid (CJS compatible)
- [x] 648 middleware tests green
- [x] 2 moderate npm audit findings (uuid/node-cron chain) cleared
- [x] Task 1 commit: `002ac35`
- [x] Task 2 commit: `c9c6049`
- [x] NO remote pushes, NO Railway deploy performed

## Self-Check: PASSED
