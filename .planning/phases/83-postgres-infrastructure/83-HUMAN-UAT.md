---
status: partial
phase: 83-postgres-infrastructure
source: [83-VERIFICATION.md]
started: 2026-10-02T21:45:32Z
updated: 2026-10-02T21:45:32Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Railway staging pre-deploy runs both migration guards
expected: After pushing main to staging, the sv_middleware staging deploy's pre-deploy log shows both `migration-guard: … additive-only OK` and `migration-allowlist: … additive-only OK`, the libpg-query WASM loads without error, and the deploy succeeds. Must pass before any production push.
result: [pending]

### 2. Production Postgres backups + tested restore (hard prerequisite for Phase 84)
expected: Scheduled off-box pg_dump (or a Railway plan with backups) is running for production Postgres (Postgres-EMVk), and one restore into a scratch database has been performed successfully. Phase 84 must not start until this passes (owner decision 4, 2026-10-02).
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
