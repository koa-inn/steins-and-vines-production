---
status: complete
phase: 83-postgres-infrastructure
source: [83-VERIFICATION.md]
started: 2026-10-02T21:45:32Z
updated: 2026-10-02T22:34:57Z
---

## Current Test

[testing complete]

## Tests

### 1. Railway staging pre-deploy runs both migration guards
expected: After pushing main to staging, the sv_middleware staging deploy's pre-deploy log shows both `migration-guard: … additive-only OK` and `migration-allowlist: … additive-only OK`, the libpg-query WASM loads without error, and the deploy succeeds. Must pass before any production push.
result: pass — 2026-10-02 staging deploy fe40a4c2 (commit d68fd4df) SUCCESS; preDeployCommand `npm run migrate` exited 0 (Railway CLI does not surface pre-deploy stdout). Verified directly via `railway ssh` into the deployed staging container: Node v20.20.2, libpg-query 16.7.3 loads; `migration-guard.js` and `migration-allowlist.js` both print `1 file(s) additive-only OK` (exit 0); WASM parser rejects the REVIEW CR-04 payload (`ALTER COLUMN U&"balance" TYPE integer` → alter-not-allowed, exit 1) and accepts an additive CREATE TABLE (exit 0).

### 2. Production Postgres backups + tested restore (hard prerequisite for Phase 84)
expected: Scheduled off-box pg_dump (or a Railway plan with backups) is running for production Postgres (Postgres-EMVk), and one restore into a scratch database has been performed successfully. Phase 84 must not start until this passes (owner decision 4, 2026-10-02).
result: pass — 2026-10-02. Railway cron service `pg-backup` (production only, `0 10 * * *`) dumps Postgres-EMVk with pg_dump 18, age-encrypts and uploads to Cloudflare R2 `sv-pg-backups` (30-day lifecycle, 7-day bucket lock). First backup `production/production-20261002T223253Z.pgcustom.age` uploaded; restore drill (infra/pg-backup/restore-drill.sh) restored it into a scratch postgres:18 — `app_meta` 1, `pgmigrations` 1, identical to production.

## Summary

total: 2
passed: 2
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps
