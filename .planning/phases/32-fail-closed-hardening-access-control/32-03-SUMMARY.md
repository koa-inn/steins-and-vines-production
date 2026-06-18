---
phase: 32-fail-closed-hardening-access-control
plan: "03"
subsystem: infra
tags: [validateEnv, fail-closed, NODE_ENV, RAILWAY_ENVIRONMENT, security, boot-gate]

requires:
  - phase: 32-fail-closed-hardening-access-control
    provides: "32-CONTEXT.md D-02/D-06 decisions and PATTERNS.md HARDEN-04 section"

provides:
  - "validateEnv.js: REQUIRED_IN_PROD hard-fail on missing prod secrets (D-06)"
  - "validateEnv.js: D-02 boot assertion (RAILWAY_ENVIRONMENT set + NODE_ENV != production -> exit(1))"
  - "validateEnv.js: GP_* dead vars removed (HARDEN-04)"
  - "validateEnv.js: Live Helcim/Redis-encryption vars added to OPTIONAL"
  - "22-test validateEnv.test.js suite covering all new and existing behaviors"

affects:
  - 32-fail-closed-hardening-access-control
  - post-wave gate (32-02 Task 3 full suite)

tech-stack:
  added: []
  patterns:
    - "REQUIRED_IN_PROD list gated on isProd — extends existing REQUIRED/exit pattern"
    - "RAILWAY_ENVIRONMENT as NODE_ENV-independent 'looks like prod' signal for D-02 assertion"

key-files:
  created:
    - zoho-middleware/__tests__/validateEnv.test.js
  modified:
    - zoho-middleware/lib/validateEnv.js

key-decisions:
  - "RAILWAY_ENVIRONMENT chosen as the NODE_ENV-independent platform signal for D-02 (no prior codebase precedent — new reference introduced)"
  - "D-02 assertion placed BEFORE the REQUIRED check (can't be gated on isProd — circular)"
  - "REQUIRED_IN_PROD vars also listed in OPTIONAL so startup accounting is complete"
  - "Dev/CI (NODE_ENV and RAILWAY_ENVIRONMENT both unset) entirely unaffected by new checks"
  - "Scoped suite only (validateEnv.test.js) — full suite + lint deferred to post-wave gate (32-02 Task 3)"

patterns-established:
  - "REQUIRED_IN_PROD: separate array filtered only when isProd, reusing identical log.error + process.exit(1) mechanism"
  - "D-02 boot assertion pattern: if (RAILWAY_ENVIRONMENT && NODE_ENV !== 'production') -> log.error + exit(1)"

requirements-completed: [HARDEN-04]

duration: ~12min
completed: 2026-06-18
---

# Phase 32 Plan 03: validateEnv Fail-Closed Boot Gate Summary

**validateEnv.js rewritten to hard-fail boot in prod when money-path secrets are missing (REQUIRED_IN_PROD / D-06) and when RAILWAY_ENVIRONMENT is set but NODE_ENV is not 'production' (D-02); dead GP_* entries removed (HARDEN-04)**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-06-18T00:37:00Z
- **Completed:** 2026-06-18T00:49:00Z
- **Tasks:** 2 completed (Task 3 pending human action — see below)
- **Files modified:** 2

## Accomplishments

- REQUIRED_IN_PROD boot gate: RECAPTCHA_SECRET_KEY, HELCIM_WEBHOOK_SECRET, CALCOM_WEBHOOK_SECRET, REDIS_ENCRYPTION_KEY all trigger process.exit(1) in prod when absent (D-06)
- D-02 boot assertion: RAILWAY_ENVIRONMENT set + NODE_ENV !== 'production' -> process.exit(1) before any other check, preventing silent fail-open on Railway deploy
- HARDEN-04: All six dead Global Payments vars removed (GP_ENVIRONMENT, GP_APP_ID, GP_APP_KEY, GP_MERCHANT_ID, GP_TERMINAL_ENABLED, GP_DEPOSIT_AMOUNT)
- Live Helcim/Redis vars added to OPTIONAL: HELCIM_API_TOKEN, HELCIM_DEVICE_CODE, HELCIM_WEBHOOK_SECRET, REDIS_ENCRYPTION_KEY
- 22-test suite (validateEnv.test.js) covering REQUIRED regression, D-06 prod gate (each missing secret), D-02 assertion (unset/wrong NODE_ENV with RAILWAY_ENVIRONMENT), dev/CI no-exit, and GP_* source absence
- TDD: RED commit (339a33f) then GREEN commit (a30b912); all 22 tests pass

## Task Commits

1. **Task 1 RED: Failing tests for HARDEN-04** - `339a33f` (test)
2. **Task 1 GREEN: validateEnv fail-closed boot gate** - `a30b912` (feat)

_Task 2 (scoped suite gate): confirmed scoped suite is green; no code change, no separate commit needed._

## Files Created/Modified

- `zoho-middleware/__tests__/validateEnv.test.js` - 22 tests covering REQUIRED regression, D-06 prod-secret gate, D-02 RAILWAY_ENVIRONMENT assertion, dev/CI no-exit, and GP_* source absence checks
- `zoho-middleware/lib/validateEnv.js` - REQUIRED_IN_PROD array + prod gate; D-02 assertion; GP_* removed; HELCIM/REDIS vars added to OPTIONAL

## Decisions Made

- RAILWAY_ENVIRONMENT is the NODE_ENV-independent "looks like prod" signal for D-02. No prior codebase reference existed; documented as a new env reference requiring Railway dashboard confirmation (human action, Task 3).
- D-02 assertion placed first in validateEnv() — cannot be gated on `isProd` (that would be circular: NODE_ENV drives isProd).
- REQUIRED_IN_PROD vars are also listed in OPTIONAL so the startup optional-warning accounting remains comprehensive.
- Scoped test suite only (validateEnv.test.js) — global threshold violations in the scoped run are expected (other lib files not covered) and deferred to the post-wave full-suite gate at Plan 32-02 Task 3.

## Deviations from Plan

None — plan executed exactly as written. TDD RED/GREEN followed; GP_* removed, REQUIRED_IN_PROD and D-02 added, dev/CI unaffected, scoped suite green.

## Issues Encountered

None.

## PENDING HUMAN ACTION

**Task 3 is a `checkpoint:human-action` gate — not performed by this agent.**

The code is deployed; the boot gate only has teeth once the Railway middleware service is configured correctly. **Before deploying this change to Railway**, a human must:

1. Open Railway dashboard → `svmiddleware-production` service → Variables
2. Explicitly set `NODE_ENV=production` (do NOT rely on the Nixpacks default) — D-02
3. Confirm `RAILWAY_ENVIRONMENT` is present (Railway injects it automatically; the boot assertion keys on it)
4. Confirm all four prod secrets are set:
   - `RECAPTCHA_SECRET_KEY`
   - `HELCIM_WEBHOOK_SECRET`
   - `CALCOM_WEBHOOK_SECRET`
   - `REDIS_ENCRYPTION_KEY` (also satisfies the long-standing #106 Railway task)
5. If any is missing, set it BEFORE deploying — otherwise the deploy will hard-fail boot (intended behavior, but you want it green-and-armed, not broken).

**Resume signal:** Type "configured" once NODE_ENV=production and all four prod secrets are confirmed set in Railway, or describe what is missing.

## Threat Surface Scan

No new network endpoints, auth paths, or schema changes. This plan only modifies startup boot logic. No threat flags.

## Self-Check

- `zoho-middleware/__tests__/validateEnv.test.js`: FOUND
- `zoho-middleware/lib/validateEnv.js`: FOUND (modified)
- Commit 339a33f (test RED): FOUND
- Commit a30b912 (feat GREEN): FOUND
- Source contains REDIS_ENCRYPTION_KEY: YES
- Source contains HELCIM_WEBHOOK_SECRET: YES
- Source contains no GP_ references: CONFIRMED

## Self-Check: PASSED

## Next Phase Readiness

- HARDEN-04 closed (validateEnv.js fail-closed boot gate complete)
- Full suite + lint check deferred to post-wave gate (Plan 32-02 Task 3)
- Task 3 Railway configuration is a PENDING HUMAN ACTION — the boot gate is armed in code but has no teeth until the human sets NODE_ENV=production and confirms all four prod secrets in Railway

---
*Phase: 32-fail-closed-hardening-access-control*
*Completed: 2026-06-18*
