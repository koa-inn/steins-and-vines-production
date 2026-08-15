---
phase: 71-kiosk-so-collect-reconciliation-finalize-invoice-sent-open-a
reviewed: 2026-08-14T00:00:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - zoho-middleware/routes/webhooks.js
  - zoho-middleware/lib/money-path.js
  - zoho-middleware/lib/reconcile.js
  - zoho-middleware/routes/checkout.js
  - zoho-middleware/__tests__/collect-webhook-reconcile.test.js
findings:
  critical: 1
  warning: 3
  info: 2
  total: 6
status: fixes_applied
fixes_applied: 2026-08-14
fix_commit: 3525aee7
resolved:
  - "CR-01 (BL-01): per-transaction idempotency lock added (collect-specific key)"
  - "WR-01: pending-key delete made best-effort — cleanup failure no longer alerts"
  - "WR-03: amount_applied clamped to invoice balance_due (read back), not stale ctx.amount"
  - "IN-01: invoice_id surfaced onto the fail-closed reconcile-failure sentinel"
deferred:
  - "WR-02: unverified salesorder.invoices[] dedup shape — deferred to 71-03 live-verify"
  - "IN-02: sendVoidFailureAlert subject mismatch — cosmetic, not fixed"
---

# Phase 71: Code Review Report

**Reviewed:** 2026-08-14
**Depth:** standard
**Files Reviewed:** 5
**Status:** fixes_applied (CR-01/WR-01/WR-03/IN-01 fixed in 3525aee7; WR-02 deferred to 71-03, IN-02 cosmetic)

## Summary

Reviewed the Phase 71 kiosk "collect payment on a sales order" money-path rewrite. The
**core reconcile shape is correct**: the APPROVED collect webhook now finalizes the SO's
invoice via `ensureOpenInvoiceForSalesOrder` (reuse-or-convert + `/invoices/{id}/submit`)
and books the customerpayment with `invoices:[{invoice_id, amount_applied}]` instead of
`salesorders_to_apply`. Ordering is right — the invoice is submitted **before** the payment
is applied (submit happens inside `ensureOpenInvoiceForSalesOrder`, whose promise resolves
before the `/customerpayments` POST runs), so Zoho is never asked to apply to a draft. The
happy path reaches a PAID invoice + APPLIED payment. The fail-closed catch fires
`recordCollectReconcileFailure` and retains the pending key on a genuine apply failure, and
the checkout.js dead else-branch removal is safe (the surviving guard fails loud, and the
invoice invariant makes it unreachable).

However, the rewrite **did not carry over the re-delivery protection the terminal path
already has**. The collect APPROVED apply runs with no idempotency lock, so an overlapping
or post-cleanup-failure webhook re-delivery can book the customerpayment twice — a real
money defect (BL-01). Three warnings concern a false-alarm/double-apply conflation on
cleanup failure, the unverified SO->invoice dedup field path (silent duplicate-invoice
risk), and applying a stale `ctx.amount` without reconciling against the freshly-created
invoice balance.

Note (acknowledged, out of scope per task brief): the DECLINED branch at
`webhooks.js:243` reads `ctx.idempotencyKey` (camelCase) while `collect.js:105` writes
`idempotency_key` (snake_case), so the idem key is never cleared on decline. This is the
known/out-of-scope idem-key bug and is **not** counted as a Phase 71 finding.

## Critical Issues

### CR-01: Collect APPROVED apply has no idempotency lock — webhook re-delivery double-applies the payment

**File:** `zoho-middleware/routes/webhooks.js:205-234`
**Issue:**
The APPROVED collect block reads `cache.get(pendingKey)`, then runs
`ensureOpenInvoiceForSalesOrder -> /customerpayments -> cache.del(pendingKey)` with **no
lock** guarding the transaction. The comment claims the "delete only after a successful
apply" guard makes re-delivery a no-op, but that only protects **sequential** re-delivery
that starts *after* the first has finished. It does not protect against:

1. **Concurrent / overlapping delivery.** Helcim webhook delivery is at-least-once. Two
   deliveries of the same `cardTransaction` both pass `if (!raw) return` (the first hasn't
   reached `cache.del` yet — there are 3-4 network round-trips in between: GET salesorder,
   POST fromsalesorder, POST submit, POST customerpayments). Both then POST
   `/customerpayments` with `amount_applied: ctx.amount` against the same invoice →
   **two payments booked / invoice over-applied**. Zoho has no dedup on `reference_number`,
   so both succeed (or the second fails with a false "reconcile failed" alert).
2. **Cleanup-failure re-delivery.** If `/customerpayments` succeeds but `cache.del(pendingKey)`
   rejects (Redis blip), the pending key survives; the next delivery re-applies the payment.

This is exactly the scenario the terminal path was hardened against: `reconcile.js:206-320`
and `voidCancelledApprovedCharge` (`webhooks.js:311-382`) both wrap their work in
`cache.acquireLock('reconcile:txn:' + transactionId, 60)` precisely to stop
double-processing on re-delivery. The new collect money path skips that guard, so it is the
one APPROVED path in this handler that can double-book money.

**Fix:** Wrap the collect APPROVED apply in the same per-transaction lock the terminal path
uses, and skip (do not release) when not acquired:

```js
if (status === 'APPROVED') {
  var lockKey = 'reconcile:txn:' + transactionId;
  return cache.acquireLock(lockKey, 60).then(function (acquired) {
    if (!acquired) {
      log.info('[webhook/helcim] collect-apply: duplicate delivery for txn=' +
        transactionId + ' — lock held; skipping');
      return; // do NOT release — holder owns it
    }
    return moneyPath.ensureOpenInvoiceForSalesOrder(ctx.salesorder_id)
      .then(function (invoiceId) { /* ...POST /customerpayments... */ })
      .then(function () { return cache.del(pendingKey); })
      // release ONLY on the acquired path, mirroring reconcile.js:313-318
      .then(function () { return cache.releaseLock(lockKey).catch(function () {}); },
            function (err) {
              return cache.releaseLock(lockKey).catch(function () {}).then(function () { throw err; });
            });
  });
}
```
(Note the DECLINED branch shares this transactionId, so scope the lock to the APPROVED apply
only, or acquire before the status switch and release in both branches.)

## Warnings

### WR-01: `cache.del` failure after a successful apply is misclassified as a post-charge failure — false staff alert + re-delivery double-apply

**File:** `zoho-middleware/routes/webhooks.js:229-263`
**Issue:**
The success chain is `...customerpayments POST -> cache.del(pendingKey)`. If the payment is
booked successfully but `cache.del(pendingKey)` rejects (Redis error), the whole chain
rejects and lands in the fail-closed `catch` at line 246. That path calls
`recordCollectReconcileFailure` and fires `mailer.sendVoidFailureAlert` — i.e. it alerts
staff that the collect "failed after charge" **even though the payment actually succeeded**.
Worse, because the pending key was not deleted, a subsequent webhook re-delivery re-applies
the payment (compounding CR-01). The catch cannot distinguish "apply failed" from "apply
succeeded, cleanup failed."

**Fix:** Make the pending-key delete best-effort and outside the apply chain so its failure
never masquerades as an apply failure:

```js
}).then(function () {
  eventLog.logEvent('collect.payment_recorded', { /* ... */ });
  return; // apply is done; treat as success regardless of cleanup outcome
});
// ...after the .then that logs success:
.then(function () { return cache.del(pendingKey).catch(function () {}); })
```
Delete the key in its own `.catch(function(){})` continuation so a failed cleanup logs but
does not trigger the fail-closed alert. (The lock from CR-01 then covers the residual
re-delivery window.)

### WR-02: SO->invoice dedup relies on an unverified Zoho response shape — silent duplicate-invoice risk on the money path

**File:** `zoho-middleware/lib/money-path.js:300-323`
**Issue:**
`ensureOpenInvoiceForSalesOrder` decides "reuse vs create" from
`salesorder.invoices[].invoice_id` (fallback `salesorder.invoice_id`) on
`GET /salesorders/{id}`. The code's own header (lines 283-296) admits this shape has **no
in-repo precedent, is mock-tested only, and must be live-verified in 71-03**. If the real
Zoho Books SO response does not surface linked invoices under `invoices[]` (Zoho commonly
exposes only `invoiced_status` on the SO detail and requires a separate
`GET /invoices?salesorder_id=` query), then `existingInvoiceId` is always `''` and the
helper **always** hits `/invoices/fromsalesorder`, creating a **new invoice on every collect**
— the exact duplicate-invoice bug this phase exists to prevent. The whole test suite passes
because the mock returns the assumed shape (`test 2` feeds `salesorder.invoices[...]`), so
green tests prove nothing about production.

**Fix:** Do not trust the SO-embedded array as the sole dedup signal. Query invoices
authoritatively before converting, e.g.:

```js
return zohoGet('/invoices', { salesorder_id: soId }).then(function (d) {
  var inv = (d.invoices || []).filter(function (i) {
    return (i.status || '').toLowerCase() !== 'void';
  })[0];
  if (inv && inv.invoice_id) return inv.invoice_id;   // reuse
  return zohoPost('/invoices/fromsalesorder?salesorder_id=' + soId, {}) /* ...create... */;
});
```
At minimum, block the 71-03 live-verify sign-off before this ships to production SOs, and add
a test that feeds a Zoho SO response *without* an `invoices[]` array and asserts a
reuse-not-create outcome from the authoritative lookup.

### WR-03: Payment applied with stale `ctx.amount`, never reconciled against the created invoice's balance_due — silent partial payment

**File:** `zoho-middleware/routes/webhooks.js:214-221`, `zoho-middleware/routes/collect.js:104`
**Issue:**
The customerpayment books `amount: ctx.amount` and `amount_applied: ctx.amount`, where
`ctx.amount` is the SO `balance` captured at collect-initiation time (`collect.js:104`).
The invoice is freshly converted from the SO inside the same flow, and its `balance_due`
is never read back or compared. Two divergence cases leave a silently-wrong end state
(the pending key is still deleted, so the flow reports success):

- If `ctx.amount` < invoice `balance_due` (e.g. the SO carried a prior partial deposit that
  did not transfer to the new invoice, or tax/rounding differs at conversion), the invoice
  is left **partially paid** but treated as fully reconciled.
- If `ctx.amount` > invoice `balance_due`, Zoho rejects the `/customerpayments` POST
  ("amount applied exceeds balance due"), which then trips the fail-closed alert for what is
  really an amount-mismatch, not an infra failure.

Contrast checkout.js:597-642, which re-derives `depositAmount` from the Zoho invoice `total`
and MONEY-01/H2-verifies the captured amount before booking. The collect path has neither
guard.

**Fix:** After `ensureOpenInvoiceForSalesOrder` resolves the invoice, read the invoice
`balance_due` and apply `Math.min(ctx.amount, balanceDue)` (or reject/alert on a
tolerance-exceeding mismatch), mirroring the checkout `CAPTURED_AMOUNT_TOLERANCE` logic,
rather than trusting the collect-time balance.

## Info

### IN-01: Reconcile-failure sentinel never records the invoice_id for this path

**File:** `zoho-middleware/lib/reconcile.js:496`, `zoho-middleware/routes/webhooks.js:255`
**Issue:** `recordCollectReconcileFailure` records `invoice_id: safeCtx.invoice_id`, but the
collect pending context (`collect.js:100-107`) never contains `invoice_id` — the invoice is
created inside `ensureOpenInvoiceForSalesOrder` and is not written back to `ctx`. So the
manual-review sentinel's `invoice_id` is always `null` for the post-submit/pre-apply failure
case, even though an open invoice now exists. Recovery still works (the SO number is present
and the dedup would re-find the invoice on retry), but the sentinel is less actionable than
it looks.
**Fix:** Have `ensureOpenInvoiceForSalesOrder` surface the invoice_id to the caller so the
catch can pass `Object.assign({}, collectCtx, { invoice_id: invoiceId })` into
`recordCollectReconcileFailure`.

### IN-02: Collect failures reuse `sendVoidFailureAlert` — "void failed" subject is a cosmetic mismatch

**File:** `zoho-middleware/lib/reconcile.js:473-478, 520-525`
**Issue:** `recordCollectReconcileFailure` reuses `mailer.sendVoidFailureAlert`, whose
subject line reads "void failed" for what is actually a collect-reconcile (non-void)
failure. The body's `error` field carries the true description, and the code documents this
as intentional, but staff triaging alerts may misclassify it.
**Fix:** Add a thin `sendCollectReconcileFailureAlert` (or a subject/category param on the
existing mailer) so the alert subject matches the failure class. Non-blocking.

---

_Reviewed: 2026-08-14_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
