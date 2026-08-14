---
phase: 71-kiosk-so-collect-reconciliation-finalize-invoice-sent-open-a
plan: 02
subsystem: payments
tags: [dead-code-cleanup, zoho-books, checkout, invariant-guard, jest]

# Dependency graph
requires:
  - phase: 71-kiosk-so-collect-reconciliation-finalize-invoice-sent-open-a
    provides: "71-01's diagnosis that this sibling checkout.js branch used the same salesorders_to_apply construct as the live collect-flow bug"
provides:
  - "checkout.js deposit-booking block permanently limited to booking payments via invoices[] only"
  - "Loud invariant guard (log.error + captureExceptionSafe) if useInvoice is ever false when the block is entered"
  - "Regression lock test pinning the invoices[]-only shape of the deposit-booking block"
affects: [71-kiosk-so-collect-reconciliation-finalize-invoice-sent-open-a]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Reachability analysis before 'fixing' a reported sibling bug — confirm the branch is actually live before treating it as a money-path defect"
    - "Replace a dead branch with a loud invariant guard (log.error + captureExceptionSafe) rather than deleting it silently, so a future refactor that makes the branch reachable fails safe instead of orphaning money"

key-files:
  created:
    - zoho-middleware/__tests__/checkout-so-deposit-reconcile.test.js
  modified:
    - zoho-middleware/routes/checkout.js

key-decisions:
  - "Reclassified this plan from 'sibling money-path fix' (as framed in 71-CONTEXT.md decision 4) to dead-code cleanup: reachability analysis proves the salesorders_to_apply else-branch at checkout.js:693 could never execute, because useInvoice = !!transactionId and depositAmount is only nonzero when transactionId is truthy, so the deposit-booking block's entry guard (transactionId && depositAmount > 0 && soId) guarantees useInvoice === true on every entry."
  - "Removed the dead else-branch entirely rather than leaving it in place, and replaced it with a loud invariant guard (log.error + captureExceptionSafe with reqId/txnId/invoiceId tags) so a future refactor that flips the useInvoice invariant fails loudly instead of silently booking an orphaned advance."
  - "Regression test intentionally passes green both before and after the code change — its value is as a permanent lock, not a RED/GREEN TDD cycle, since there is no live bug to reproduce."

requirements-completed: ["71-D4-sibling-deposit"]

# Metrics
duration: 14min
completed: 2026-08-14
---

# Phase 71 Plan 02: Checkout Deposit-Booking Dead-Code Cleanup Summary

**Removed the unreachable `salesorders_to_apply` else-branch at checkout.js:693 (dead since 2026-05-07 commit f6d6e52dc) and replaced it with a loud invariant guard + a permanent regression-lock test — NOT a money-path bug fix.**

## Performance

- **Duration:** 14 min
- **Started:** 2026-08-14T22:41:xx (approx, first task commit 22:4x)
- **Completed:** 2026-08-14
- **Tasks:** 2
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments

- **Reachability finding confirmed and documented in code:** the deposit-booking block at `checkout.js:680` is entered only when `transactionId` is truthy. `depositAmount` is only ever nonzero when `transactionId` is truthy (`checkout.js:496`), and `useInvoice = !!transactionId` (`checkout.js:562`). So `useInvoice === true` is guaranteed on every entry into the block, and the `else { paymentBody.salesorders_to_apply = [...] }` branch could never run. This has been true since the 2026-05-07 checkout refactor (commit `f6d6e52dc`) — i.e., it has been dead code for over three months, not a live bug.
- Removed the dead branch and replaced it with a loud invariant guard: if a future refactor ever makes the block reachable with `useInvoice === false`, the code now `log.error`s and calls `captureExceptionSafe` (tags: `reqId`, `txnId`, `invoiceId`) instead of silently booking a payment that would never reconcile against an invoice in Zoho.
- Added a permanent regression-lock test (`checkout-so-deposit-reconcile.test.js`) asserting: (1) with a `transaction_id`, the `/customerpayments` call body contains an `invoices` array (`invoice_id` + `amount_applied`) and has no `salesorders_to_apply` key; (2) without a `transaction_id`, the deposit-booking block is never entered at all (no `/customerpayments` call).
- `grep -n "salesorders_to_apply" zoho-middleware/routes/checkout.js` returns no match — confirmed after the edit, including all comments and error strings (had to rephrase two comments/an error message that initially still contained the literal string).

## Task Commits

Each task was committed atomically:

1. **Task 1: Regression test — deposit path books invoices[] only, never salesorders_to_apply** - `413c7ed5` (test)
2. **Task 2: Remove the unreachable salesorders_to_apply else-branch + add a loud invariant guard** - `5faf4ddb` (refactor)

**Plan metadata:** (this SUMMARY commit, made after this file)

_Note: This is a dead-code cleanup, not a TDD bug fix — Task 1's test is a "regression lock," not a RED test. It passes green both before and after Task 2's edit because the reachable path already booked correctly via `invoices[]`._

## Files Created/Modified

- `zoho-middleware/__tests__/checkout-so-deposit-reconcile.test.js` - New regression-lock suite: asserts the deposit-booking block only ever books via `invoices[]`, and that the block is never entered without a `transaction_id`. Clones the `checkout-captured-amount.test.js` server-boot + money-path mock harness (including the MONEY-01/H2 captured-amount readback via `helcimLib.getCardTransactionById`, which must be satisfied for the block to be reached).
- `zoho-middleware/routes/checkout.js` - Removed the unreachable `else { paymentBody.salesorders_to_apply = [...] }` branch (lines ~693 pre-edit). Added a documentation comment above the deposit-booking block explaining the reachability invariant and the `f6d6e52dc` origin of the dead code. Replaced the removed branch with a loud invariant guard (`log.error` + `captureExceptionSafe`) that fires only if `useInvoice` is ever false when the block is entered — which should be impossible given the current invariant chain.

## Decisions Made

- **Reclassified scope from "sibling money-path fix" to "dead-code cleanup."** `71-CONTEXT.md` decision 4 and `71-PATTERNS.md` treated `checkout.js:693` as the same class of live bug as the collect-flow bug fixed in 71-01. Reachability analysis (interfaces block in `71-02-PLAN.md`, re-verified by reading `checkout.js` lines 227, 496, 562, 584, 680-704 directly) proves the branch is provably dead, not live. Per the plan's explicit instruction, this is documented as cleanup, not framed as a money-path bug fix.
- **Kept the deletion (did not fall back to documentation-only).** The plan's escape hatch ("if the cleanup looks riskier than a pure dead-branch deletion... reduce this plan to documentation-only") was not needed — the branch removal was a clean, isolated, three-line deletion with no shared control flow risk. Proceeded with the code change as planned.
- **Rephrased two comments and one error message during Task 2** to avoid the literal string `salesorders_to_apply` after the first edit attempt left it in prose (comment text and the invariant-guard error message), which caused `grep -n "salesorders_to_apply" checkout.js` to still match. Rewrote using "sales-order-scoped apply-payment"/"sales-order-scoped payment" phrasing to preserve the documentation's meaning while satisfying the acceptance criterion (no literal match) exactly.
- **Skipped the root-level `npm test` frontend suite.** No files under `js/` were touched (per plan scope: "Server-only; no js/ changes"), and the plan's own `<verification>` section lists only middleware commands (`cd zoho-middleware && npm test`, `npx jest checkout-so-deposit-reconcile`, the `grep` check, and `npm run lint`). Ran all four. Root `node_modules` was also absent in this worktree; installing it purely to run an unrelated frontend suite for a middleware-only change was judged out of scope and unnecessary given CLAUDE.md's own scoping intent (rule 7 requires the full suite only "after changing any shared utility" — `checkout.js` is a route, not a shared `lib/` utility).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `zoho-middleware/node_modules` was missing in this worktree**
- **Found during:** Task 1 (running the new regression test for the first time)
- **Issue:** `npx jest` failed with `Cannot find module 'node-cron'` — the worktree had no `node_modules` installed at all (not merely stale), blocking every middleware test from running, including pre-existing suites (verified `checkout-captured-amount.test.js` failed identically before any of my changes).
- **Fix:** Ran `npm ci` inside `zoho-middleware/` (a `package-lock.json`-pinned install, per the plan's `<parallel_execution>` note "npm ci in zoho-middleware/ if needed" — not a new-package install, so the Rule-3 package-legitimacy exclusion does not apply).
- **Files modified:** None tracked (installs `node_modules/`, which is gitignored).
- **Verification:** `npx jest checkout-so-deposit-reconcile` and the full `cd zoho-middleware && npm test` both ran cleanly afterward (93 suites / 1393 tests passed).
- **Committed in:** N/A (no files to commit — `node_modules` is gitignored).

**2. [Rule 1 - Bug] Invariant-guard comment/error text initially still matched the acceptance-criteria grep**
- **Found during:** Task 2 verification (`grep -n "salesorders_to_apply" routes/checkout.js`)
- **Issue:** My first edit removed the dead branch's *code* but left the literal string `salesorders_to_apply` in a doc comment and in the new invariant-guard's `Error` message, so the required-zero-match grep check still found 3 hits.
- **Fix:** Rewrote the comment and error message to describe the removed construct without using the literal API field name (`sales-order-scoped apply-payment` / `sales-order-scoped payment`), preserving the documentation's intent.
- **Files modified:** `zoho-middleware/routes/checkout.js`
- **Verification:** `grep -n "salesorders_to_apply" zoho-middleware/routes/checkout.js` now returns no match.
- **Committed in:** `5faf4ddb` (part of Task 2 commit — the rewrite happened before commit, so no separate fix commit was needed).

---

**Total deviations:** 2 auto-fixed (1 blocking — missing `node_modules`; 1 bug — grep-breaking string in own new code, caught and fixed before commit)
**Impact on plan:** Both were necessary to meet the plan's explicit verification and acceptance criteria. No scope creep — no code outside `checkout.js`'s deposit-booking block and its own new test file was touched.

## Issues Encountered

None beyond the two deviations above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The sibling `salesorders_to_apply` construct flagged in `71-CONTEXT.md` decision 4 is now fully resolved for `checkout.js`: it no longer exists in the file, and a regression-lock test + invariant guard prevent reintroduction.
- This closes out the "sibling deposit" scope note from Phase 71's context — no further action needed on `checkout.js` for this phase. The live collect-flow bug (webhooks.js) was already fixed in 71-01; this plan confirms the checkout.js sibling was never actually live.
- No blockers for phase completion.

---
*Phase: 71-kiosk-so-collect-reconciliation-finalize-invoice-sent-open-a*
*Completed: 2026-08-14*
