---
phase: 53-money-path-observability-ci-gates
plan: 02
subsystem: observability
tags: [sentry, captureException, money-path, correlation-id, middleware]

# Dependency graph
requires:
  - phase: 53-01
    provides: "Global Sentry beforeSend scrub + error-class fingerprint (lib/sentry-scrub.js wired into server.js Sentry.init) — protects every captureException call added here against PII leakage, no per-call-site scrubbing needed"
provides:
  - "Sentry.captureException at every money-movement catch on the money path: lib/money-path.js void primitives (rejectWithVoid + voidWithTimeout timeout/CRITICAL branches), checkout.js (captured-amount readback, customerpayment recording, order-creation-after-charge, reCAPTCHA-reject void, 5 pre-validate void catches), pos.js (kiosk sale/confirm void consolidation point), webhooks.js (reconcilePendingCharge orphan-charge)"
  - "reqId (existing req.id) threaded through the shared money-path.js deps object into voidWithTimeout/rejectWithVoid — no signature change to exported primitives"
  - "__tests__/money-path-sentry.test.js — forced-void-failure regression proving capture with reqId/txnId tags at level error and no raw PII (locks ROADMAP SC#1 / M17)"
affects: [53-03, 53-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Money-path captureException convention: level:'error' uniformly (never 'fatal'), tags carry ONLY the safe-id allowlist (reqId, txnId, invoiceId/salesOrderId/invoiceNumber, phase) — never amount/total/email; fingerprint is set globally by 53-01's beforeSend so call sites never set it"
    - "Correlation-id threading: req.id (server.js:101-109, previously access-log-only) is passed into the shared money-path deps object so route-layer captures and the shared void primitive tag the same reqId"

key-files:
  created:
    - zoho-middleware/__tests__/money-path-sentry.test.js
  modified:
    - zoho-middleware/lib/money-path.js
    - zoho-middleware/routes/checkout.js
    - zoho-middleware/routes/pos.js
    - zoho-middleware/routes/webhooks.js

key-decisions:
  - "reqId threaded via the existing deps/opts object (added a reqId key) rather than changing voidWithTimeout/rejectWithVoid signatures — honors the money-path.js contract that 45-06/07/08 depend on"
  - "checkout.js's local rejectWithVoid wrapper gained a 5th reqId param (defaulted through to moneyPath.rejectWithVoid deps.reqId); every in-handler call site passes req.id"
  - "webhooks.js reconcilePendingCharge catch omits reqId (req is not in scope at that fire-and-forget call site) — tags carry txnId + invoiceNumber only, as the plan permits"

patterns-established:
  - "Best-effort catches (cache housekeeping, mailer confirmation, list-refresh, batch alert email, inventory ledger) stay UN-instrumented — enforced by an automated negative grep in the plan's verify step (NO_BEST_EFFORT_CAPTURE)"

requirements-completed: [OBS-01]

# Metrics
duration: 22min
completed: 2026-07-03
---

# Phase 53 Plan 02: Money-Path Sentry Instrumentation Summary

**Sentry.captureException at every money-movement catch on the money path (void, order-creation-after-charge, captured-amount mismatch, customerpayment, kiosk sale/confirm, orphan-charge reconcile), tagged with reqId/txnId/invoice-or-SO id at level error, plus a forced-failure regression test — closing ROADMAP SC#1 (M17) end-to-end with 53-01's scrub**

## Performance

- **Duration:** ~22 min (spanning one API-connection interruption after the 3 task commits; resumed to finalize)
- **Started:** 2026-07-03T15:44:00Z
- **Completed:** 2026-07-03T16:05:00Z
- **Tasks:** 3
- **Files modified:** 5 (1 created, 4 modified) — plus 14 existing test files mock-synced (see Deviations)

## Accomplishments
- `lib/money-path.js` void primitives now capture void-failure exceptions to Sentry — `rejectWithVoid`'s early-reject void catch and BOTH branches (timeout + CRITICAL) of `voidWithTimeout`'s catch — covering the void path for checkout AND pos in one shared place, tagged from `deps.reqId`/`token`
- Route-level money catches instrumented: `checkout.js` (9 sites — captured-amount readback, customerpayment, order-creation-after-charge, reCAPTCHA-reject void, and the 5 raw pre-validate void-after-early-reject catches); `pos.js` (kiosk sale/confirm void consolidation point); `webhooks.js` (reconcilePendingCharge orphan-charge)
- `req.id` threaded into the shared void primitives via the deps object at every checkout.js and pos.js void call site (no signature change)
- `money-path-sentry.test.js` (2 focused unit tests, no express boot) forces both the CRITICAL and timeout void branches and asserts capture with `tags.reqId === 'test-req-1'/'test-req-2'`, a truthy `tags.txnId`, `level: 'error'`, and no `amount`/`total`/`email` key — locking SC#1 against regression

## Task Commits

Each task was committed atomically:

1. **Task 1: Instrument lib/money-path.js void primitives + thread reqId** - `c274db5` (feat)
2. **Task 2: Instrument route-level money catches in checkout.js/pos.js/webhooks.js + pass reqId** - `7802023` (feat)
3. **Task 3: Regression test — forced money-path error invokes captureException with correlation tags** - `7c3fe35` (test)

**Plan metadata:** committed separately (this SUMMARY) — worktree mode; this executor does NOT touch STATE.md/ROADMAP.md (orchestrator updates them centrally after merge).

## Files Created/Modified
- `zoho-middleware/lib/money-path.js` - `require('@sentry/node')`; `Sentry.captureException` in `rejectWithVoid` catch (phase: void_early_reject) and both `voidWithTimeout` catch branches (phase: void_failed), tagged reqId/txnId at level error
- `zoho-middleware/routes/checkout.js` - `require('@sentry/node')`; 9 captureException sites at money-movement catches; local `rejectWithVoid` wrapper + `processCheckout` gained a reqId param; reqId threaded into `moneyPath.voidWithTimeout` deps
- `zoho-middleware/routes/pos.js` - `require('@sentry/node')`; captureException at the sale/confirm money-movement catch; reqId threaded into all three `moneyPath.voidWithTimeout` call sites
- `zoho-middleware/routes/webhooks.js` - `require('@sentry/node')`; captureException at the `reconcilePendingCharge` orphan-charge catch (tags: txnId + invoiceNumber, no reqId — req out of scope)
- `zoho-middleware/__tests__/money-path-sentry.test.js` - Forced-void-failure regression (CRITICAL + timeout branches); asserts reqId/txnId tags, level error, no PII, and preserved mailer-alert behavior

## Decisions Made
- reqId is threaded via the existing deps/opts object (new `reqId` key) rather than changing exported signatures — the money-path.js contract is depended on by plans 45-06/07/08
- checkout.js's local `rejectWithVoid` wrapper took a 5th `reqId` param defaulted through to `moneyPath.rejectWithVoid`; every in-handler call site passes `req.id`
- webhooks.js reconcile catch omits reqId (req not in scope at that fire-and-forget site) — tags carry txnId + invoiceNumber, as the plan permits
- captureException calls set `level: 'error'` and no fingerprint (D-04) — 53-01's global beforeSend owns the fingerprint; tags never carry amount/total/email (T-53-04)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added `captureException: jest.fn()` to the `@sentry/node` mock in 14 existing test files**
- **Found during:** Task 1 (running the full middleware suite for acceptance)
- **Issue:** The pre-existing `jest.mock('@sentry/node', ...)` scaffolding in 14 test suites returned only `{ init, setupExpressErrorHandler }` (predating captureException). Once the money-path void catches began calling `Sentry.captureException`, any suite that exercised the money path (e.g. `checkout-route.test.js` PATH-3 void-failure) threw `TypeError: Sentry.captureException is not a function` — an environmental mock-shape gap, not a plan defect. The plan only declared the new `money-path-sentry.test.js`; these 14 existing mocks also needed the method.
- **Fix:** Added `captureException: jest.fn()` to the returned mock object in all 14 files. Pure mock-sync change — the mock now matches the real `@sentry/node` surface the code calls. NO assertion changes, no test-logic changes (CLAUDE.md rule 10 respected — behavior of existing tests unchanged; only the mock's shape was completed).
- **Files modified:** `__tests__/{api-key-guard, auth-google-route, auth-tiers-guard, checkout-captured-amount, checkout-route, harden03-idem-redis-down, helcim-webhook, pii-access, pos-auth-tier, promo-failclosed, promo-lock-concurrency, ratelimit-failclosed-52, redis-failclosed, webhook-wr07}.test.js`
- **Verification:** Full suite went from 2 failing (in `checkout-route.test.js`) to 76 suites / 1245 tests all green
- **Committed in:** `c274db5` (Task 1 commit — the same commit that introduced the money-path captureException calls, so the mock stays in lockstep with the code that requires it)

**2. [Rule 3 - Blocking] Restored `zoho-middleware/node_modules` via `npm install`**
- **Found during:** Task 1 verification (`node -e "require('./lib/money-path')"` → `Cannot find module '@sentry/node'`)
- **Issue:** node_modules is gitignored and not carried into a fresh worktree checkout, so the module load and `npm test` failed. Same environment gap 53-01 documented.
- **Fix:** Ran `npm install` inside `zoho-middleware/` — restores the exact declared tree (`@sentry/node@^10.42.0` already present in package.json). No new dependency added.
- **Files modified:** none tracked (node_modules is gitignored; no package.json/lockfile change)
- **Verification:** `require('./lib/money-path')` then printed `LOADS_OK`; full suite ran clean
- **Committed in:** N/A (environment restoration only — no trackable file change)

---

**Total deviations:** 2 auto-fixed (both Rule 3 / blocking). Neither is scope creep: one is a mandatory mock-shape sync so existing suites survive the new capture calls, the other is the known fresh-worktree environment restore. The instrumentation itself matches the plan's acceptance criteria exactly.
**Impact on plan:** No functional/API change beyond the planned captureException call sites; the 14-file mock edit carries zero assertion changes.

## Issues Encountered
- One API-connection interruption occurred AFTER all 3 task commits landed but BEFORE this SUMMARY was written. All code and test commits (`c274db5`, `7802023`, `7c3fe35`) were verified present on the worktree branch; the run resumed to finalize verification and write/commit this SUMMARY. No work was lost or redone.

## Verification Results
- **Full middleware suite:** `cd zoho-middleware && npm test` → **76 suites passed, 1245 tests passed** (0 failing). pos.js line coverage 81.13% — above the 80% floor from 53-05, so the plan's coverage-coupling condition did not require an extra pos.js test.
- **Focused regression:** `npx jest money-path-sentry` → 1 suite, 2 tests passed.
- **Lint:** `cd zoho-middleware && npm run lint` → **60 problems (0 errors, 60 warnings)** — the expected pre-existing baseline. Per instruction, warnings were NOT cleaned here; the `--max-warnings 0` cleanup lands in a later plan (53-03/53-06). No new warnings introduced by this plan's files (money-path.js, checkout.js, pos.js, webhooks.js, money-path-sentry.test.js all lint-clean).
- **Negative check:** `NO_BEST_EFFORT_CAPTURE` — no captureException call bound to a best-effort error name (cacheErr/batchErr/createErr/cacheCheckErr/mailErr/etc.).
- **PII check:** no `level:'fatal'` and no `amount`/`total`/`email` key in any new tags object across the four instrumented files.

## User Setup Required
None - no external service configuration required. `SENTRY_DSN` gating is pre-existing; captureException is a no-op when the DSN is absent. No new env vars, no new packages.

## Next Phase Readiness
- ROADMAP SC#1 (M17) closed end-to-end: a forced money-path error now produces a visible, correlatable Sentry event (reqId/txnId), scrubbed of PII by 53-01's beforeSend, and proven by a regression test.
- No STATE.md/ROADMAP.md writes from this executor (worktree mode) — the orchestrator updates them centrally after the wave merges.
- No blockers. Later plans (53-03 lint gate, 53-06 CI gates) can proceed; the 60-warning baseline is unchanged and untouched here by design.

---
*Phase: 53-money-path-observability-ci-gates*
*Completed: 2026-07-03*

## Self-Check: PASSED

- FOUND: zoho-middleware/lib/money-path.js (captureException x3)
- FOUND: zoho-middleware/routes/checkout.js (captureException x9)
- FOUND: zoho-middleware/routes/pos.js (captureException x1)
- FOUND: zoho-middleware/routes/webhooks.js (captureException x1)
- FOUND: zoho-middleware/__tests__/money-path-sentry.test.js
- FOUND: commit c274db5 (Task 1)
- FOUND: commit 7802023 (Task 2)
- FOUND: commit 7c3fe35 (Task 3)
- CONFIRMED: no STATE.md or ROADMAP.md in this plan's commits
