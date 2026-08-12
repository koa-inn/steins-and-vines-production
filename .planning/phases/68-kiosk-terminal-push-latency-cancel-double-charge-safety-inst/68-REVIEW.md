---
phase: 68-kiosk-terminal-push-latency-cancel-double-charge-safety-inst
reviewed: 2026-08-12T00:00:00Z
depth: standard
files_reviewed: 12
files_reviewed_list:
  - zoho-middleware/routes/pos.js
  - zoho-middleware/routes/webhooks.js
  - zoho-middleware/lib/constants.js
  - zoho-middleware/lib/helcim.js
  - zoho-middleware/lib/authTiers.js
  - zoho-middleware/server.js
  - js/kiosk-core.js
  - zoho-middleware/__tests__/kiosk-telemetry.test.js
  - zoho-middleware/__tests__/pos-cancel-orphan.test.js
  - tests/frontend/kiosk-push-latency.test.js
  - tests/frontend/kiosk-cancel-safety.test.js
findings:
  critical: 2
  warning: 3
  info: 2
  total: 7
status: fixes_applied
fix_outcomes:
  fixed_at: 2026-08-12
  CR-01: fixed
  CR-02: fixed
  WR-01: deferred
  WR-02: fixed
  WR-03: fixed
  IN-01: skipped
  IN-02: skipped
---

# Phase 68: Code Review Report

**Reviewed:** 2026-08-12
**Depth:** standard
**Files Reviewed:** 12
**Status:** fixes_applied (CR-01, CR-02, WR-02, WR-03 fixed; WR-01 deferred; IN-01/IN-02 skipped)

## Summary

Phase 68 adds (a) observation-only stage-timing telemetry to `/api/kiosk/sale` plus a
new `/api/kiosk/telemetry` sink, and (b) a cancel/orphan-charge safety net:
`/api/pos/cancel` writes a `KIOSK_CANCELLED_PREFIX` flag, and the Helcim webhook's
APPROVED branch voids a charge that lands after cancel via `voidCancelledApprovedCharge`.

The telemetry half is sound: the sink is device-token-gated + rate-limited, scrubs
control chars and PAN-shaped digit runs, clamps the numeric payload, emits no PII, and
has no money/data side-effect. The auth/rate-limit registration (`authTiers.js`
KIOSK_ROUTES + `server.js` telemetryLimiter) is correct. The instrumentation is genuinely
observation-only — `emitStageTiming` never gates a money-moving branch.

The cancel-safety half has **two BLOCKER money-path defects** in
`voidCancelledApprovedCharge` (webhooks.js). Both stem from the same root cause:
`moneyPath.voidWithTimeout` **always resolves** (it catches every void error internally),
so the `.then()` chained after it runs unconditionally — on void *failure* just as on
success. This (1) deletes the orphan-recovery records after a failed void, and (2) the
lock is released on the wrong path. The regression suite only exercises the
void-*success* path, so neither defect is caught by tests.

## Critical Issues

### CR-01: Cancelled-approved charge is orphaned (money taken, no invoice) when the void fails

> **OUTCOME: FIXED** (commit `94fc80a5`). `moneyPath.voidWithTimeout` now resolves a
> discriminated result `{ ok, reason }` (backward-compatible — every existing caller
> ignores the resolved value; parameter signature unchanged). `voidCancelledApprovedCharge`
> deletes the `KIOSK_PENDING_CHARGE`/cancelled records and logs the voided event ONLY on a
> confirmed void (`ok:true`). On any non-ok outcome (declined/timeout/error) it RETAINS the
> pending-charge record so `reconcile.js`'s 5-minute sweep can recover the orphan, and
> persists an `sv:void-failure` sentinel (30-day TTL) for manual review — mirroring
> `reconcile.js:274-290`. `voidWithTimeout` still fires its own CRITICAL alert (non-timeout)
> / logs for manual reconciliation (timeout), so we do not double-alert. Regression tests
> (e)/(f) in `pos-cancel-orphan.test.js` assert the pending record survives a failed and a
> timed-out void and that a sentinel is written (RED-first).

**File:** `zoho-middleware/routes/webhooks.js:294-306`
**Issue:**
`moneyPath.voidWithTimeout` never rejects — on both timeout and non-timeout errors it
catches internally and returns a resolved promise (`lib/money-path.js:198-244`).
Therefore the `.then()` after it always runs, even when the void did **not** succeed:

```js
return moneyPath.voidWithTimeout(helcimLib, transactionId, voidAmount, { reqId: invoiceNumber })
  .then(function () {
    eventLog.logEvent('kiosk.cancel_after_push_voided', { ... });   // false "voided" event on failure
    return Promise.all([
      cache.del(C.CACHE_KEYS.KIOSK_PENDING_CHARGE_PREFIX + invoiceNumber).catch(function () {}),
      cache.del(C.CACHE_KEYS.KIOSK_CANCELLED_PREFIX + invoiceNumber).catch(function () {})
    ]);
  });
```

Consequences when the void fails (Helcim down / error / timeout):
1. The `KIOSK_PENDING_CHARGE` record is deleted → the `reconcile.js` 5-minute sweep
   backstop can no longer find the charge → the orphan (customer charged, no invoice) is
   never retried or reconciled. This is exactly money-path concern #1.
2. The `KIOSK_CANCELLED` flag is deleted → a later webhook re-delivery no longer
   recognizes the ref as cancelled either.
3. On a **timeout** specifically, `voidWithTimeout` deliberately sends *no* staff alert
   (`money-path.js:214-222`) — so with the pending record also gone, the orphan is
   **silently** lost: no alert, no sweep record, no recovery.
4. `kiosk.cancel_after_push_voided` is logged as a success even though nothing was voided.

Contrast `reconcile.js:259-302`, which deletes the pending record **only** on void
success (or a positively-detected already-voided error) and otherwise persists an
`sv:void-failure` sentinel + alerts. `voidCancelledApprovedCharge` must mirror that.

**Fix:** Have the void resolve a discriminated result (or thread success through), and
only delete the pending-charge record / log the voided event on confirmed success. On
failure, keep the pending record (so the sweep can retry) and persist an
`sv:void-failure` sentinel, e.g.:

```js
return moneyPath.voidWithTimeout(helcimLib, transactionId, voidAmount, {
  mailer: mailer, eventLog: eventLog, reqId: invoiceNumber
}).then(function (voidResult) {
  var ok = voidResult && voidResult.ok; // requires voidWithTimeout to surface outcome
  if (!ok) {
    // leave KIOSK_PENDING_CHARGE intact for the reconcile sweep; record a sentinel
    return cache.set('sv:void-failure:' + Date.now(), {
      txn_id: transactionId, invoice_number: invoiceNumber,
      amount: voidAmount, needs_manual_review: true, created_at: new Date().toISOString()
    }, 60 * 60 * 24 * 30).catch(function () {});
  }
  eventLog.logEvent('kiosk.cancel_after_push_voided', {
    txnId: transactionId, invoiceNumber: invoiceNumber, amount: voidAmount
  });
  return Promise.all([
    cache.del(C.CACHE_KEYS.KIOSK_PENDING_CHARGE_PREFIX + invoiceNumber).catch(function () {}),
    cache.del(C.CACHE_KEYS.KIOSK_CANCELLED_PREFIX + invoiceNumber).catch(function () {})
  ]);
});
```

(`voidWithTimeout` currently returns `Promise<void>`; it must be extended to report
success/failure, or `voidCancelledApprovedCharge` must void through a thin wrapper that
captures the outcome — the same idiom `pos.js:1626-1640` uses.)

### CR-02: `reconcile:txn` lock is released on the not-acquired path, defeating the double-void guard

> **OUTCOME: FIXED** (commit `94fc80a5`). `releaseLock` is now nested INSIDE the
> `if (acquired)` branch (mirroring `reconcile.js:205-317`), so the skip path
> (`!acquired`) returns without releasing a lock it never held. Regression test (g) in
> `pos-cancel-orphan.test.js` asserts a lock-held re-delivery does NOT call `releaseLock`
> and does NOT void (RED-first).

**File:** `zoho-middleware/routes/webhooks.js:280-318`
**Issue:**
The final `.then(releaseLock)` is chained on the **outer** promise, so it runs regardless
of whether this invocation acquired the lock:

```js
return cache.acquireLock(lockKey, 60).then(function (acquired) {
    if (!acquired) {
      log.info('...another path holds the reconcile lock; skipping');
      return;                         // <-- skips the void (correct)
    }
    return cache.get(...) ...;        // void path
  })
  .catch(function (err) { ... })
  .then(function () {
    return cache.releaseLock(lockKey).catch(function () {});  // <-- runs even when NOT acquired
  });
```

`cache.releaseLock` unconditionally `del`s the lock (`cache.js:138-147`). So a re-delivered
webhook that correctly finds the lock held and skips will then **release the lock the
first, still-in-flight void is holding**. A subsequent delivery (Helcim/Svix commonly
retries 3+ times, seconds apart, well inside the 60s TTL and the up-to-8s void window) can
then re-acquire the freed lock and issue a second void — producing exactly the spurious
`sendVoidFailureAlert` the lock exists to prevent (the second Helcim void returns an
already-reversed error, and `voidWithTimeout` — unlike `reconcile.js:268` — does **not**
treat already-voided as success, so it fires the CRITICAL alert path,
`money-path.js:223-243`). This directly contradicts the function's own docstring guarantee
(webhooks.js:271-274) and money-path concern #3.

Compare `reconcile.js:205-317`, where `releaseLock` is nested **inside** the
`if (acquired)` branch and is never reached on the skip path.

**Fix:** Only release the lock on the path that acquired it. Move the release inside the
acquired branch (mirroring `reconcile.js`):

```js
return cache.acquireLock(lockKey, 60).then(function (acquired) {
  if (!acquired) {
    log.info('[webhook/helcim] cancel-void: duplicate delivery for txn=' + transactionId + ' — skipping');
    return; // do NOT release — the holder owns it
  }
  return cache.get(...) ...
    .catch(function (err) { ...captureExceptionSafe... })
    .then(function () { return cache.releaseLock(lockKey).catch(function () {}); });
});
```

## Warnings

### WR-01: Webhook void path never checks whether the ref was already booked before voiding

> **OUTCOME: DEFERRED** (out of locked phase scope). Adding a `hasMatchingZohoOrder` guard
> requires either exporting that helper from `reconcile.js` — which plan 68-02 explicitly
> locks as UNTOUCHED ("reconcile.js and its 600s backstop are UNCHANGED"; "reconcile.js's
> inline void is a pre-existing reviewed exception, do not copy it for new code") — or
> duplicating a Zoho settled-order lookup, introducing a second lookup path the plan's
> threat model (T-68-02-4) deliberately avoids. The review itself classifies this as
> "defense-in-depth rather than a live bug": the client disables cancel once `confirmSale`
> runs and stops the poll timer on `cancelled`, so a ref that is both cancelled AND booked
> is not reachable through the shipped surfaces. Recommend tracking as a follow-up that
> either (a) exports `hasMatchingZohoOrder` from `reconcile.js` for reuse, or (b) gates the
> cancel-void behind a settled-order check, as a scoped change with its own plan. Not fixed
> here to keep the money-path change minimal and the locked reconcile.js contract intact.

**File:** `zoho-middleware/routes/webhooks.js:242-256`
**Issue:** On an APPROVED event for a cancelled ref, `voidCancelledApprovedCharge` voids
unconditionally. It does not verify (via `hasMatchingZohoOrder`, as `reconcile.js:246`
does) that no paid Zoho invoice already exists for that ref. If a ref were ever both
cancelled *and* confirmed (booked/paid), this would void the charge behind a paid invoice
— a reverse orphan (invoice marked paid, money reversed). The client currently makes this
hard to reach (the cancel button is disabled once `confirmSale` runs, and the poll timer
stops on `cancelled`), so this is a defense-in-depth gap rather than a live bug — but it
is the only guard preventing a paid-invoice-with-no-money outcome, and cross-channel
confirms (manual `/api/kiosk/sale/confirm` from another surface) bypass those client
guards.
**Fix:** Before voiding, confirm no settled Zoho order exists for the ref (reuse
`reconcile`'s `hasMatchingZohoOrder`); if one does, clear the flag and do not void.

### WR-02: Void-failure path of the new cancel-safety code is untested

> **OUTCOME: FIXED** (commit `bb52b76c`, folded into the CR-01/CR-02 regression suite). The
> shared `voidWithTimeout` mock now resolves the discriminated `{ ok: true }` contract, and
> three new cases were added to `pos-cancel-orphan.test.js`: (e) a FAILED void retains the
> pending-charge record + writes a void-failure sentinel; (f) a TIMED-OUT void does the
> same; (g) a lock-held re-delivery does not release the lock or void. All three fail
> against the pre-fix code (RED-first) and pass after CR-01/CR-02.

**File:** `zoho-middleware/__tests__/pos-cancel-orphan.test.js:34-40, 132`
**Issue:** The suite mocks `moneyPath.voidWithTimeout` as always-resolving
(`mockResolvedValue()`), so every assertion exercises only the void-*success* path. The
CR-01 orphan (records deleted after a failed void) and the CR-02 spurious-alert race are
both invisible to the current tests. A regression test that makes the void reject/return
non-ok would have caught CR-01.
**Fix:** Add a case where the void fails and assert the pending-charge record is *retained*
(not deleted) and a void-failure sentinel/alert is produced.

### WR-03: `emitStageTiming` is not defensively wrapped

> **OUTCOME: FIXED** (commit `73253046`). The body of `emitStageTiming` is now wrapped in a
> `try/catch` (optional catch binding, matching the codebase convention) that swallows any
> throw, so observation-only telemetry can never reject and block the `res.status(202)`
> response — matching the client beacons' try/catch contract. No behaviour change on the
> happy path; existing telemetry tests remain green.

**File:** `zoho-middleware/routes/pos.js:359-368, 787, 819`
**Issue:** `emitStageTiming` is invoked on the success path immediately before
`res.status(202).json(...)` (e.g. line 787, inside `cacheWrite.then`). If `eventLog.logEvent`
or `log.info` ever threw, the rejection would prevent the 202 from being sent and hang the
client mid-sale. The client-side beacons in `kiosk-core.js:154-160/183-189` are carefully
`try`/`catch`-wrapped for exactly this reason; the server emit is not. Risk is currently
low (`eventLog.logEvent` only calls `log.info`, `eventLog.js:27-33`), so this is a
robustness concern, not a live failure.
**Fix:** Wrap the body of `emitStageTiming` in a `try/catch` so telemetry can never
interfere with the money-path response, matching the client beacon's contract.

## Info

### IN-01: Cancelled-flag TTL equals the reconcile orphan-age threshold

> **OUTCOME: SKIPPED** (Info; out of fix scope for this pass). No coverage gap — the review
> confirms an APPROVED webhook landing just after 600s correctly falls through to the
> reconcile path. Left as a documentation/robustness note for a future tuning pass.

**File:** `zoho-middleware/routes/pos.js:35` (`KIOSK_CANCELLED_TTL = 600`) vs
`zoho-middleware/lib/reconcile.js:70` (`MIN_ORPHAN_AGE_SECONDS = 600`)
**Issue:** The fast-path cancelled flag expires (10 min) at almost exactly the moment the
reconcile backstop first considers the pending record "old enough" to void. An APPROVED
webhook landing just after 600s finds no flag and takes the reconcile path, which is fine
(it then voids as an orphan), so there is no coverage gap — but the coincident boundary is
fragile and undocumented. Consider making the flag TTL comfortably exceed
`MIN_ORPHAN_AGE_SECONDS` (or referencing it) so the fast path always wins within the
backstop window.

### IN-02: `voidAmount` defaults to 0 silently when the pending record is missing

> **OUTCOME: SKIPPED** (Info; out of fix scope for this pass). Harmless to the actual
> reversal (Helcim voids by `transactionId`, not amount) as the review notes; the only
> impact is a `$0` label in a failure alert. Cosmetic — deferred.

**File:** `zoho-middleware/routes/webhooks.js:291`
**Issue:** When the pending-charge record is absent/unreadable, the void proceeds with
`amount = 0`. This is harmless to the actual reversal (`helcimLib.voidTransaction` reverses
by `transactionId`, not amount) and is documented, but it means a void-failure *alert* for
such a case reports `$0`, which could mislead staff triaging the alert. Consider labelling
the amount as "unknown" in the alert payload when the pending record is missing.

---

_Reviewed: 2026-08-12_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
