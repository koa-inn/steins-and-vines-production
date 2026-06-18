---
status: partial
phase: 32-fail-closed-hardening-access-control
source: [32-VERIFICATION.md]
started: 2026-06-18T01:35:20Z
updated: 2026-06-18T01:35:20Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Railway: set NODE_ENV=production on middleware service
expected: On the `svmiddleware-production` Railway service, `NODE_ENV` is explicitly set to `production` under Variables (NOT relying on the Nixpacks default). This arms every fail-closed gate added in Plans 32-01/02/04 (D-02).
result: [pending]

### 2. Railway: confirm RAILWAY_ENVIRONMENT is present
expected: `RAILWAY_ENVIRONMENT` is injected by Railway and visible on the service. The validateEnv boot assertion keys on it — if it is set while `NODE_ENV !== 'production'`, the process exits at boot by design.
result: [pending]

### 3. Railway: confirm all four prod secrets are set before next deploy
expected: `RECAPTCHA_SECRET_KEY`, `HELCIM_WEBHOOK_SECRET`, `CALCOM_WEBHOOK_SECRET`, and `REDIS_ENCRYPTION_KEY` are all present in the `svmiddleware-production` Variables. A missing one now hard-fails boot by design (D-06) — this is the intended fail-closed behavior, but you want them set so the next deploy boots green-and-armed. (Note: overlaps long-standing #106 REDIS_ENCRYPTION_KEY task — verify it here.)
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
