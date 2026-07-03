---
phase: 49-online-captured-amount-verification
plan: 01
subsystem: payments
tags: [helcim, zoho-invoices, money-path, tdd, audit-h2]

# Dependency graph
requires:
  - phase: 45-security-money-path-hardening
    provides: lib/money-path.js shared primitives (voidWithTimeout, rejectWithVoid, acquireIdempotencyLock, assertTxnNotReplayed, markTxnUsed)
provides:
  - Captured-amount verification in POST /api/checkout — reads the authoritative Helcim capture via getCardTransactionById and compares it against the Zoho invoice total (+/-$0.01 tolerance) before any customerpayment is recorded
  - H2 regression suite (checkout-captured-amount.test.js) covering SHORT / EQUAL / GREATER / FETCH-ERROR / DUAL-CART
affects: [49-02-live-card-uat, money-path, checkout]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fail-closed captured-amount verification: unverifiable or short capture throws a tagged error (isCapturedAmountMismatch) that the EXISTING catch/void block consumes — no new void path introduced"
    - "Overpayment (captured > recorded) is logged, not blocked — asymmetric tolerance direction protects dual-cart shared-charge legs from false-rejects"

key-files:
  created:
    - zoho-middleware/__tests__/checkout-captured-amount.test.js
  modified:
    - zoho-middleware/routes/checkout.js

key-decisions:
  - "Captured-amount check lives between depositAmount resolution (Zoho invoice total) and the first side-effect (inventory decrement) — throws BEFORE any fire-and-forget or customerpayment recording"
  - "Single void path preserved — the throw is caught by the pre-existing catch block's moneyPath.voidWithTimeout; no raw voidTransaction call added (H5/L18 compliance)"
  - "Mismatch classification collapses 'unverifiable' (API rejects / non-finite amount) and 'short capture' into one tagged error + one generic client message — never leaks the raw captured/recorded figures to the client (server-side log.error retains the real figures for reconciliation)"
  - "402 Payment Required chosen for the isCapturedAmountMismatch status class (added as a single branch in the existing status-computation block in the catch)"

patterns-established:
  - "MONEY-01/H2 comment tag on both the verification block and the status branch, cross-referencing the H5/L18 single-void-path guardrail"

requirements-completed: [MONEY-01]

# Metrics
duration: 8min
completed: 2026-07-03
---

# Phase 49 Plan 01: Online Captured-Amount Verification Summary

**Closed audit finding H2: `/api/checkout` now reads back the ACTUAL Helcim-captured amount via `getCardTransactionById` and rejects (402, void, no customerpayment) any order where the capture falls short of the invoice total — closing the silent reconciliation hole where a tampered `initialize(amount:0.01)` could book a full-price invoice as paid-in-full.**

## Performance

- **Duration:** 8 min (first RED commit to GREEN commit)
- **Started:** 2026-07-02T21:20:12-07:00
- **Completed:** 2026-07-02T21:22:07-07:00
- **Tasks:** 2 (TDD RED, TDD GREEN)
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments
- Added a fail-closed captured-amount verification in `runCheckout` (checkout.js), gated on `transactionId && depositAmount > 0`, so unpaid sales orders and $0 orders are unaffected
- SHORT capture and unverifiable-readback (Helcim API error / non-finite amount) both throw a tagged `isCapturedAmountMismatch` error consumed by the pre-existing catch block — reusing `moneyPath.voidWithTimeout` as the ONLY void path (no second void path introduced, per H5/L18)
- Overpayment (captured > invoice total) is logged for reconciliation and allowed through unblocked — verified this is provably safe for the dual-cart shared-charge case (each leg's total is a subset of the combined capture, so `captured >= per-leg total` never false-rejects)
- New standalone regression suite `checkout-captured-amount.test.js` (13 tests) drives SHORT / EQUAL / GREATER / FETCH-ERROR / DUAL-CART scenarios without touching the existing `checkout-route.test.js` harness (CLAUDE.md rule 10)
- Full middleware suite (62 suites / 1187 tests) stays green — zero behavior change on the captured==recorded happy path
- `npm run lint` in `zoho-middleware/` — 0 errors (60 pre-existing warnings across the codebase, none newly introduced by this change)

## Task Commits

Each task was committed atomically (TDD RED -> GREEN):

1. **Task 1 (RED): Failing H2 captured-amount regression suite** - `e6c3507` (test)
2. **Task 2 (GREEN): Implement captured-amount verification in /api/checkout** - `d0471d6` (feat)

_TDD gate sequence verified: `test(49-01): ...` commit precedes `feat(49-01): ...` commit in git log — RED then GREEN, no REFACTOR commit needed (implementation landed cleanly on first pass)._

## Files Created/Modified
- `zoho-middleware/__tests__/checkout-captured-amount.test.js` - H2 regression suite: SHORT (402+void+no customerpayment), EQUAL (201+customerpayment), GREATER/overpayment (201+customerpayment at invoice total, not captured), FETCH-ERROR (fail-closed 4xx+void), DUAL-CART (both legs book, no false-reject void)
- `zoho-middleware/routes/checkout.js` - Inserted captured-amount verification (~35 lines) between the Zoho invoice-total resolution and the inventory-ledger decrement; added one `if (err.isCapturedAmountMismatch) status = 402;` branch in the existing catch block's status computation

## Decisions Made
- Collapsed the plan's (a) unverifiable and (b) short-capture cases into a single `isCapturedAmountMismatch` throw with one generic message (`'Captured amount could not be verified against the recorded total'`) — this satisfies "never leak the raw figures to the client" (rule preserved: internal `log.error` calls retain the actual `captured`/`recorded`/`transactionId` values server-side for reconciliation, only the masked message reaches the outer catch's `internalMessage`/`clientMsg`)
- Used the plan's exact tolerance constant (0.01) and `>=`/`<=` boundary semantics: `captured < depositAmount - 0.01` is SHORT (blocked); `captured > depositAmount + 0.01` is GREATER (logged, allowed); everything in between (including exactly equal) proceeds normally

## Deviations from Plan

None - plan executed exactly as written. The insertion point, throw semantics, single-void-path reuse, and 402 status mapping all matched the plan's `<action>` block precisely; no line-number drift or mock gaps were encountered (the checkout-route.test.js harness copied cleanly, and the per-endpoint `zohoPost` dispatcher plus a per-invocation invoice-total counter handled the dual-cart test's two sequential legs without needing anything beyond what the plan anticipated).

## Issues Encountered
None. `node_modules` symlinks (root + `zoho-middleware/`) were created locally in the worktree to run tests — both are gitignored (`node_modules/` pattern) and were left untracked; they are not part of any commit.

## User Setup Required
None - no external service configuration required. This plan is code-only; no environment variables or Helcim/Zoho dashboard changes needed. (Plan 49-02, NOT executed by this run, is a separate live-card UAT checkpoint that validates the online HelcimPay `getCardTransactionById` readback against a real transaction before this ships to production.)

## Next Phase Readiness
- Code-complete and fully tested on staging-equivalent mocks; the online-path `getCardTransactionById` live-verification (required per the plan's honesty caveat — this call is confirmed live for the terminal webhook path per STATE decision 36-20/F2, but the ONLINE HelcimPay txn readback specifically needs a live check) is deferred to **49-02**, a separate live-card UAT checkpoint plan — do not deploy 49-01 to production ahead of that UAT.
- No blockers for 49-02 to proceed; this plan's SUMMARY and commits are the input context it needs.

## Self-Check: PASSED
- FOUND: zoho-middleware/__tests__/checkout-captured-amount.test.js
- FOUND: zoho-middleware/routes/checkout.js (modified, getCardTransactionById + isCapturedAmountMismatch present)
- FOUND commit e6c3507 (test(49-01): add failing captured-amount verification regression (H2))
- FOUND commit d0471d6 (feat(49-01): verify captured amount vs invoice total before booking (MONEY-01))

---
*Phase: 49-online-captured-amount-verification*
*Completed: 2026-07-03*
