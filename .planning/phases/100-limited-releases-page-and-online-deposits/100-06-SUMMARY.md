---
phase: 100-limited-releases-page-and-online-deposits
plan: 06
subsystem: payments
tags: [helcim, express, redis, deposits, idempotency]
requires:
  - phase: 100-02..05
    provides: limited-releases lib, nonce-capable initializeCheckout, mailer.sendPreorderCleanupAlert
provides:
  - POST /api/preorder/initialize (nonce-bound Helcim checkout, kill switch)
  - POST /api/preorder/deposit verification stage with a bookDeposit seam for Plan 07
key-files:
  created:
    - zoho-middleware/routes/preorder.js
    - zoho-middleware/__tests__/preorder-initialize.test.js
    - zoho-middleware/__tests__/preorder-deposit-verify.test.js
  modified:
    - zoho-middleware/lib/helcim.js
    - zoho-middleware/__tests__/helcim-initialize-invoice.test.js
    - zoho-middleware/server.js
key-decisions:
  - "LV11 gate: pass (invoiceRequest + lineItems) -- branch (b)"
  - "Plan 07 plugs into routes/preorder.js via router.__setBookDeposit(fn); ctx = {txnId, invoiceNumber, lines, totalKits, amount, customer, consent, newsletter, reqId, res, idemKey}"
requirements-completed: [SC3, D-14, D-17, D-18, D-19]
duration: 40min
completed: 2026-10-29
---

# Phase 100 Plan 06: Preorder initialize and deposit verification Summary

Nonce-bound HelcimPay initialize plus a deposit verification stage that voids only charges whose readback proves the caller owns them.

## LV11 gate: pass (invoiceRequest + lineItems)

Spike LV11 recorded "propagates: yes", readback field top-level `invoiceNumber` (unchanged). Helcim requires `invoiceRequest.lineItems` and rejects a top-level `invoiceNumber`, so `initializeCheckout` now sends `invoiceRequest: {invoiceNumber, lineItems}`. Without caller-supplied `opts.lineItems` it sends a single summary line (qty 1, price and total equal to `amount`); the no-opts body is byte-identical to before. The route passes only `{invoiceNumber}`, so the default summary line is used.

## Tasks

1. Task 0 (8f9dc1b5): helcim.js lineItems fix, test updated (Phase 100 file).
2. Task 1 (071e2f04): routes/preorder.js initialize + server.js wiring (KEYLESS_POSTS x2, OFFLINE_CAPABLE_POSTS, paymentLimiter, mount, no referer exemption), preorder-initialize.test.js (11 tests).
3. Task 2 (c9c38341): deposit verification stage, preorder-deposit-verify.test.js (35 tests).

## Verification

Middleware 268 suites / 3826 tests green; root 233 suites / 3212 tests green (run at Task 0); eslint clean on the new/changed files. checkout.js untouched.

## Deviations from Plan

**1. [Process] Deposit route committed in the Task 1 commit.** routes/preorder.js was written whole (initialize and deposit) before the first commit, so Task 1's commit contains the deposit handler and Task 2's commit contains its tests. Behaviour verified by Task 2 tests afterwards rather than strict test-first.

**2. [Rule 1 - lint] ** unused catch bindings in my own code fixed (now logged without PII).

Pre-existing `npm run lint` warnings in lib/batch-pg-read.js and lib/mailer.js (line 515) are out of scope, not touched.

## Notes for later plans

- Plan 07: call `require('../routes/preorder').__setBookDeposit(fn)` or replace the `bookDeposit` variable; it must send the response itself, and call `markTxnUsed(cache, txn, ':preorder')` plus cache the final body at `idemKey` (86400) and delete the nonce.
- Non-production quirk: `acquireIdempotencyLock` fails open on Redis errors outside NODE_ENV=production (money-path behaviour), so the lock fail-closed void is only exercised in production.
- Limiter test asserts the mount line in server.js rather than a 429 burst.

## Known Stubs

`bookDeposit` default rejects with "booking not implemented" (intentional; resolved by Plan 07). Until then a verified deposit voids and returns 500.

## Self-Check: PASSED

Files and commits 8f9dc1b5, 071e2f04, c9c38341 exist.
