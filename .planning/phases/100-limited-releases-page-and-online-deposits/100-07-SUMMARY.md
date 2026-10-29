---
phase: 100-limited-releases-page-and-online-deposits
plan: 07
subsystem: payments
tags: [helcim, zoho, deposits, cleanup, idempotency]
requires:
  - phase: 100-06
    provides: verification stage and bookDeposit seam
  - phase: 100-05
    provides: createDepositSet / cleanupDepositSet
provides:
  - Real bookDeposit in routes/preorder.js (POST /api/preorder/deposit complete end to end)
key-files:
  modified:
    - zoho-middleware/routes/preorder.js
  created:
    - zoho-middleware/__tests__/preorder-deposit-booking.test.js
key-decisions:
  - "bookDeposit sends its own response; failure path lives in failAfterCapture (cleanup, then void, then alert)"
  - "Pending sentinel is deleted only when the void succeeded and cleanup left nothing behind"
requirements-completed: [SC3, D-01, D-03, D-04, D-11, D-13, D-15]
completed: 2026-10-29
---

# Phase 100 Plan 07: Deposit booking stage Summary

A verified deposit for N kits now creates N sales orders (one $50 advance each), returns 201 with every SO number, and on any failure after capture cleans up, voids the Helcim charge (always), and alerts staff on leftovers.

## Gate
Plan 06 recorded "LV11 gate: pass (branch b)"; the nonce contract is unchanged, so the plan was executed.

## What was built
- `realBookDeposit`: pending sentinel (ids and counts only, 7 d) -> `helpers.resolveOrCreateContact` -> `resolveFeeItems` + `getKitRate` per distinct item -> `createDepositSet` (units from `expandUnits`, date = UTC ISO day) -> response body built from created[] with name/release_label from the allowlist -> cache idem body (24 h), `markTxnUsed` on `''`, `:sv-cart-ferment`, `:sv-cart-ingredients`, `:preorder` (30 d), delete nonce and sentinel -> 201 -> fire-and-forget confirmation + staff emails, strict-`true` newsletter (source `preorder`, masked email), `preorder.deposit_completed` event.
- `failAfterCapture`: `cleanupDepositSet(err.created)` (guarded; a throw makes every created record a leftover) BEFORE `voidWithTimeout` (also guarded, never skipped); `sendPreorderCleanupAlert` when leftovers, possibleOrphan or cleanup threw; sentinel kept unless void ok and clean; nonce kept, txn not marked used, idem not cached; 500 `{error, voided}`; `preorder.failed_after_charge` event; no PII anywhere.
- No reference to createBatchesFromSale, decrementStock or notifyAdminPanel in routes/preorder.js (grep count 0).

## Verification
Middleware 271 suites / 3856 tests green; root 234 suites / 3248 tests green; `npm run lint` clean. 17 new tests (happy, replay, email, newsletter, no-batch, failure at contact/pricing/create, cleanup order, cleanup throw, possibleOrphan, void failure, PII).

## Deviations from Plan
- [Process] Tasks 1 and 2 share one file and were written together; committed as a single commit rather than two, and tests were written after the implementation rather than strictly first.
- [Rule 3] Worktree HEAD was behind the required base; reset to 28259847 per the startup check, then `npm ci` in root and zoho-middleware.
- The Plan 06 verify test's `__setBookDeposit` hook is unchanged; the booking test relies on the real default.

## Known Stubs
None. The Plan 06 stub is replaced.

## Self-Check: PASSED
