---
phase: 53-money-path-observability-ci-gates
plan: 01
subsystem: observability
tags: [sentry, pii-scrub, error-fingerprinting, middleware]

# Dependency graph
requires: []
provides:
  - "lib/sentry-scrub.js — pure scrubEvent(event) + fingerprintFor(event), unit-testable, no Sentry SDK dependency"
  - "server.js Sentry.init beforeSend wired to scrub + fingerprint, active for every event captured from this process"
affects: [53-02, 53-03, 53-04, 53-05, 53-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Sentry beforeSend scrub-and-fingerprint gate — all downstream captureException call sites (53-02) inherit this protection automatically, no per-call-site scrubbing needed"
    - "PII masking convention (mask, don't drop) extended from lib/redact.js's maskEmail into the Sentry event pipeline"

key-files:
  created:
    - zoho-middleware/lib/sentry-scrub.js
    - zoho-middleware/__tests__/sentry-beforeSend.test.js
  modified:
    - zoho-middleware/server.js

key-decisions:
  - "Money-shaped tag/extra keys (amount, total, price, balance, grandTotal) are deleted outright rather than masked — unlike emails, there's no safe partial-reveal for a monetary figure, and the safe-id allowlist (reqId, txnId, invoiceId, salesOrderId, salesorder_id, invoice_id) keeps correlation intact"
  - "request.data/cookies/headers are removed wholesale (not scrubbed field-by-field) — auth headers (API_SECRET_KEY) and session cookies must never reach Sentry, and a request body's shape is unpredictable enough that allow-listing individual fields would be fragile"
  - "beforeSend's function signature omits the unused hint parameter (Sentry tolerates fewer args than it passes) rather than accepting-and-ignoring it, to keep the file lint-warning-free ahead of the --max-warnings 0 gate landing in 53-06"

requirements-completed: [OBS-01]

# Metrics
duration: 4min
completed: 2026-07-03
---

# Phase 53 Plan 01: Sentry PII Scrub + Error Fingerprint Summary

**Global Sentry `beforeSend` hook that masks customer emails, deletes raw payment amounts, and fingerprints every event by error class before it leaves the middleware process**

## Performance

- **Duration:** 4 min
- **Started:** 2026-07-03T15:31:02Z
- **Completed:** 2026-07-03T15:34:55Z
- **Tasks:** 2
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments
- `lib/sentry-scrub.js` created: pure `scrubEvent`/`fingerprintFor` functions that mask emails (reusing `redact.maskEmail`), strip money-shaped tag/extra keys, remove `request.data/cookies/headers`, and preserve the safe correlation-id allowlist
- `server.js`'s existing DSN-gated `Sentry.init` now wires `beforeSend` to call both functions on every event before send — no route/handler changes required, so plan 53-02's upcoming `captureException` calls inherit the protection automatically
- Regression suite (`__tests__/sentry-beforeSend.test.js`, 4 tests) proves a seeded customer email + raw amount never survive scrubbing, safe ids survive, and same-class errors share a fingerprint while different classes don't

## Task Commits

Each task was committed atomically:

1. **Task 1: Create lib/sentry-scrub.js — pure PII scrub + error-class fingerprint** - `8ff2aeb` (feat)
2. **Task 2: Wire beforeSend into server.js Sentry.init + regression test** - `2d677cb` (feat)

**Plan metadata:** committed separately by the orchestrator after wave completion (worktree mode — this executor does not touch STATE.md/ROADMAP.md).

## Files Created/Modified
- `zoho-middleware/lib/sentry-scrub.js` - Pure `scrubEvent(event)` (mask email, delete money-shaped tags/extra, strip request.data/cookies/headers) and `fingerprintFor(event)` (group by exception type)
- `zoho-middleware/__tests__/sentry-beforeSend.test.js` - Regression suite: email+amount stripped, safe ids preserved, same/different error classes fingerprint correctly
- `zoho-middleware/server.js` - `Sentry.init`'s `beforeSend` now calls `scrub.scrubEvent` + sets `event.fingerprint = scrub.fingerprintFor(event)`

## Decisions Made
- Money-shaped keys are deleted (not masked) — no safe partial-reveal exists for a dollar amount, unlike an email's first-character-plus-domain
- `request.data/cookies/headers` removed wholesale rather than field-scrubbed, closing the auth-header/session-cookie leak path (T-53-03) in addition to the email/amount paths (T-53-01/T-53-02)
- Dropped the unused `hint` parameter from the `beforeSend` callback signature to stay lint-warning-free ahead of the `--max-warnings 0` gate (D-05, lands in 53-06)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Restored zoho-middleware/node_modules via npm install**
- **Found during:** Task 2 (running the full middleware test suite for the acceptance criteria)
- **Issue:** The worktree's `zoho-middleware/node_modules` did not exist (node_modules is gitignored and not carried into a fresh worktree checkout), so `npm test` failed with `Cannot find module 'axios'`/`'express'` etc. across 61 unrelated test suites — an environment gap, not a plan defect.
- **Fix:** Ran `npm install` (no new dependency added — restores the exact tree already declared in `zoho-middleware/package.json`) inside `zoho-middleware/`.
- **Files modified:** none tracked (node_modules is gitignored; no package.json/lockfile change)
- **Verification:** `npm test` then ran clean: 75/75 suites, 1243/1243 tests passing, coverage thresholds all met
- **Committed in:** N/A (no trackable file change — environment restoration only)

**2. [Rule 1 - Bug] Corrected a typo in the plan's own Task 1 verify one-liner**
- **Found during:** Task 1 verification
- **Issue:** The plan's `<verify><automated>` one-liner checked `o.user.email.indexOf('jacob@')===0`, i.e. it asserted the masked email still starts with the full raw local part `'jacob@'`. That's inconsistent with the plan's own stated acceptance criteria ("email masked to `j***@gmail.com`-shape") and with `redact.maskEmail`'s established convention (`'jacob@gmail.com' -> 'j***@gmail.com'`, keeping only the first character). The literal check as written could never pass for a correctly-masked email.
- **Fix:** Verified `scrubEvent`'s behavior directly against the plan's prose acceptance criteria and `redact.maskEmail`'s existing, tested convention (`j***@gmail.com`), rather than the typo'd literal string in the one-liner. Ran a corrected version of the same check (`indexOf('j')===0`) to confirm: prints `SCRUB_OK` and `FP_OK` as intended.
- **Files modified:** none (verification-script correction only, not a code fix — `lib/sentry-scrub.js` was correct as written)
- **Verification:** Corrected one-liner prints `SCRUB_OK` / `FP_OK`; Task 2's regression test suite independently asserts the same masked-shape behavior (`toContain('***')`, `not.toBe(raw email)`) and passes
- **Committed in:** N/A (no code change required)

---

**Total deviations:** 2 auto-fixed (1 blocking/environment, 1 verify-script bug)
**Impact on plan:** No scope creep — both were pre-existing environment/plan-script issues surfaced during verification, not gaps in the implementation. `lib/sentry-scrub.js` and `server.js` match the plan's acceptance criteria exactly.

## Issues Encountered
None beyond the two items documented above under Deviations.

## User Setup Required
None - no external service configuration required. `SENTRY_DSN` gating is pre-existing; no new env vars introduced.

## Next Phase Readiness
- `beforeSend` scrub + fingerprint is live in `server.js`'s `Sentry.init` — plan 53-02 (money-path `captureException` call sites) can proceed without adding any per-call-site scrubbing; every event captured anywhere in the process passes through this gate automatically.
- Full middleware suite green (75 suites / 1243 tests), lint clean on all touched files (`server.js`, `lib/sentry-scrub.js`, `__tests__/sentry-beforeSend.test.js` — 0 errors, 0 warnings).
- No blockers for 53-02.

---
*Phase: 53-money-path-observability-ci-gates*
*Completed: 2026-07-03*
