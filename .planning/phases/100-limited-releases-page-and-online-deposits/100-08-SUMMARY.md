---
phase: 100-limited-releases-page-and-online-deposits
plan: 08
subsystem: payments
tags: [zoho, helcim, kiosk, deposits, money-path]
requires: [100-02, 100-05]
provides:
  - finalizeSalesOrderInvoiceAndApplyPayment optional payment.advance (credits step)
  - computeSalesOrderAmountDue (exported from routes/pos.js)
  - advance-aware /api/kiosk/salesorder-pay
affects: [100-09]
key-files:
  modified:
    - zoho-middleware/lib/money-path.js
    - zoho-middleware/routes/pos.js
  created:
    - zoho-middleware/__tests__/money-path-advance.test.js
    - zoho-middleware/__tests__/kiosk-salesorder-advance.test.js
decisions:
  - "applyAdvanceToInvoice re-reads GET /customerpayments/{id} unused_amount before POST /invoices/{id}/credits so a retry after a prior credit is a no-op"
  - "LIMITED SOs skip the so.balance guard and are guarded on the computed base/due instead (so.balance is not reliable once an advance or invoice exists)"
metrics:
  tasks: 2
  completed: 2026-10-29
---

# Phase 100 Plan 08: Brew-day deposit application Summary

Kiosk SO-pay for LIMITED-* sales orders now charges (invoice balance_due or SO total) minus the deposit advance's unused amount, then applies the advance to the invoice via POST /invoices/{id}/credits before the remainder payment.

## Commits
- Task 1: 484cfdf8 finalize helper applies an optional deposit advance
- Task 2: 6b259b68 kiosk SO-pay charges the remainder

## What changed
- money-path.js: new `applyAdvanceToInvoice`, runs between invoice finalize and the balance_due read; result gains `advanceApplied`. Without `payment.advance` the Zoho call sequence is identical (pinned by test).
- pos.js: `computeSalesOrderAmountDue(so)` (non-LIMITED: no Zoho calls, `parseFloat(so.balance)`). processSalesOrderPay split into two `.then` stages; lookup failure returns 502 and releases the lock before any terminal push; due < 0.01 returns 400; response gains `deposit_applied` and event gains `depositApplied` for LIMITED SOs; `kiosk.limited_so_no_advance` event when no deposit found.
- Imports only `isLimitedReleaseSalesOrder` / `findDepositAdvanceForSalesOrder` (as `depositLib`); void-on-failure catch untouched.

## Verification
Full middleware (268 suites, 3792 tests) and frontend (233 suites, 3212 tests) green; lint clean; pos.js lines 87%. Existing tests unedited.

## Deviations from Plan
None - plan executed as written. (Worktree base was behind the expected commit and was reset to e0a68655 per the startup check.)

## Known Stubs
None.

## Self-Check: PASSED
