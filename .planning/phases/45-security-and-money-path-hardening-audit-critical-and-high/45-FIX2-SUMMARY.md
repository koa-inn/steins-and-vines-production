---
phase: 45
plan: FIX2
subsystem: kiosk-pos-money-path
tags: [security, money-path, reconcile, webhook, orphan-charge, race-condition]
dependency-graph:
  requires: [45-FIX1, 45-08]
  provides: [money-path-defect-fixes-2]
  affects:
    - zoho-middleware/lib/reconcile.js
    - zoho-middleware/routes/webhooks.js
    - zoho-middleware/__tests__/reconcile.test.js
    - zoho-middleware/__tests__/reconcile-wr02-wr07.test.js
    - zoho-middleware/__tests__/webhook-wr07.test.js
    - zoho-middleware/__tests__/helcim-terminal-success.test.js
tech-stack:
  patterns: [redis-lock, already-voided-recovery, unconfirmed-status, orphan-guard]
key-files:
  created:
    - zoho-middleware/__tests__/reconcile-wr02-wr07.test.js
    - zoho-middleware/__tests__/webhook-wr07.test.js
  modified:
    - zoho-middleware/lib/reconcile.js
    - zoho-middleware/routes/webhooks.js
    - zoho-middleware/__tests__/reconcile.test.js
    - zoho-middleware/__tests__/helcim-terminal-success.test.js
decisions:
  - WR-02(a): Raise MIN_ORPHAN_AGE_SECONDS to 600 s; Zoho authoritative check deferred
  - WR-02(c): Lock key = 'reconcile:txn:' + transactionId; TTL 60 s; always released
  - WR-02(c): isAlreadyVoidedError checks both message text and HTTP response body
  - WR-07: Status 'UNCONFIRMED' (not 'PENDING') to avoid collision with Helcim native PENDING status
  - WR-07 open money question: genuine-approved-but-API-down + slow-confirm → reconcile may void; flagged not guessed
metrics:
  duration: ~2h
  completed: 2026-06-30
  tasks: 2 (WR-02, WR-07)
  files-modified: 6
---

# Phase 45 FIX2: Reconcile + Webhook Defects (WR-02, WR-07) Summary

Two confirmed money-path defects from the Phase 45 code review fixed TDD-first
(RED regression tests → GREEN implementation), committed atomically.

## What Was Fixed

### WR-02 (WARNING) — Reconcile false-positive voids + race/double-void

Three exposures addressed:

#### WR-02(a): In-flight false-positive void — orphan age guard raised

**Bug:** `MIN_ORPHAN_AGE_SECONDS = 120` (2 min) was barely larger than the 90-second
terminal approval window. If staff took >2 min to confirm (slow batch review, network
hiccup), the sweep would void a valid APPROVED charge, then `/confirm` would record a
Zoho payment against the reversed charge → invoice paid, charge reversed.

**Fix:** Raised `MIN_ORPHAN_AGE_SECONDS` from 120 to 600 (10 min).

Justification:
- 600 s covers the full 45 s client poll + manual-confirm fallback window + generous confirm buffer
- Terminal-result cache TTL (300 s) expires BEFORE the 600 s guard fires; sweep transitions to
  "manual review" path (no auto-void) for stale APPROVED results — eliminating the false-positive
  void race from the sweep path entirely
- Genuine orphans still caught after 10 min
- The webhook-retry path (Helcim retrying delivery) can still trigger reconcile for records
  >600 s old; the pending-record deletion on successful confirm remains the primary guard

**Deferred:** Authoritative Zoho check (GET /invoices?invoice_number=refNumber) before voiding.
This would be definitive proof that no invoice exists, independent of cache TTLs. Omitted in this
sprint because it requires adding a Zoho API dependency to reconcile.js and building a new query
path. Documented here for the next hardening pass.

#### WR-02(b): Settled-signal alignment verified

After FIX1 the pending record stores `idempotency_key = refNumber` (sale body now sends
`idempotency_key: refNumber` to the frontend). The confirm handler writes the confirm idem key
as `KIOSK_IDEM_PREFIX + 'confirm:' + refNumber`. `hasMatchingZohoOrder` checks
`KIOSK_IDEM_PREFIX + 'confirm:' + ctx.idempotency_key`. With `ctx.idempotency_key = refNumber`,
these keys are now aligned. Verified by test WR-02-B (GREEN throughout — alignment is correct
with FIX1 in place).

#### WR-02(c): Redis lock prevents double-void; already-voided treated as success

**Bug (double-void race):** The 5-min sweep and the webhook handler can both call
`reconcilePendingCharge` for the same `transactionId` concurrently. Without a lock, both
would reach `voidTransaction`. The second void fails (already voided) → persists
`sv:void-failure` + sends a staff alert — false-positive manual-review noise.

**Fix (lock):** `cache.acquireLock('reconcile:txn:' + transactionId, 60)` at the top of
`reconcilePendingCharge`. Second concurrent call sees `acquired = false` → returns early
without proceeding to the void step. Lock always released when the cycle completes
(void success, settled, deferred, or Helcim lookup failure).

**Bug (already-voided alert):** Any `voidTransaction` rejection → sv:void-failure +
sendVoidFailureAlert regardless of error type, including "already reversed."

**Fix (isAlreadyVoidedError):** Detects "already", "reversed", "reversal", "voided" in
both the error message string and the Helcim HTTP response body. On match: clears the
pending sentinel and returns success — no sv:void-failure, no alert email.

---

### WR-07 (WARNING) — Webhook no longer synthesizes APPROVED on API failure

**Bug:** When `getCardTransactionById` fails (Helcim API down) but a device-pending invoice
is found, the fallback called `processCardTransactionResult(txnId, 'APPROVED', pendingInvoice, '')`
unconditionally. If the actual transaction was declined or voided, this:
1. Cached `{status:'APPROVED', approved:true}` in `helcim:terminal:result:{invoice}`
2. The kiosk poll returned `{ status: 'approved' }` → client called `/confirm`
3. `/confirm` created a paid Zoho invoice for an uncaptured payment (phantom revenue)

**Fix:** Changed to `processCardTransactionResult(txnId, 'UNCONFIRMED', pendingInvoice, '')`.

What changes:
- `cache.set` stores `{status:'UNCONFIRMED', approved:false, transactionId:txnId, cardType:''}`
- `/api/kiosk/sale/status` poll handler returns `{ status: 'pending' }` for any non-APPROVED,
  non-DECLINED status → kiosk.js poll loop keeps running
- Client hits `POLL_TIMEOUT_MS = 45000` → shows "Confirm Manually" button
- `reconcilePendingCharge` is NOT triggered (the `if (status === 'APPROVED' && invoiceNumber)`
  gate in webhooks.js fires only for real APPROVED status — UNCONFIRMED does not pass)
- The reconcile/API-retry path (Helcim webhook retry, 5-min sweep) establishes real status
  once the Helcim API is back online

#### Open Money Question (WR-07)

**Scenario:** Charge is genuinely APPROVED, Helcim API is down when webhook fires →
UNCONFIRMED cached. Client poll times out → shows manual-confirm button. Staff are slow
to click it (> 600 s, the new MIN_ORPHAN_AGE). Helcim retries the webhook delivery
→ API is now up → real APPROVED received → `reconcilePendingCharge` runs → finds
pending record still present → no confirm idem key (staff hasn't confirmed yet) → VOIDS.

This would void a genuinely approved charge. The correct action (void vs record) depends
on whether the customer's card was actually captured — which requires business context
and cannot be determined from the code alone.

**Not fixed here:** changing this behavior requires either (a) an authoritative Zoho lookup
before voiding, or (b) a longer MIN_ORPHAN_AGE that outlasts Helcim's webhook retry window,
or (c) a "record and flag for manual review" path instead of auto-void for UNCONFIRMED
charges. All three require a separate decision. This is documented here for the next pass.

The risk is mitigated (not eliminated) by WR-02(a)'s raised MIN_ORPHAN_AGE (600 s vs 120 s),
which gives staff more time to manually confirm before reconcile fires.

---

## Commits

| Hash | Message |
|------|---------|
| `68da18d` | test(45): WR-02/WR-07 regression tests (RED) |
| `f427e27` | fix(45): WR-02 — reconcile lock + already-voided recovery + raise orphan guard |
| `147a417` | fix(45): WR-07 — webhook fallback caches UNCONFIRMED, not synthesized APPROVED |

## Deviations from Plan

### Necessary Infrastructure Changes to Existing Tests

**1. [Infrastructure] reconcile.test.js cache mock — added acquireLock + releaseLock**
- **Found during:** WR-02 GREEN phase
- **Issue:** Adding `cache.acquireLock` call to `reconcilePendingCharge` would make existing
  reconcile tests fail because the test's cache mock had no `acquireLock` method (undefined → TypeError)
- **Fix:** Added `acquireLock: jest.fn().mockResolvedValue(true)` and `releaseLock: jest.fn().mockResolvedValue()`
  to the mock factory and `beforeEach` restores. Default `acquired = true` so all existing tests
  continue to exercise the full reconcile logic path. No assertions changed.

**2. [Infrastructure] reconcile.test.js oldPendingCtx — updated from 5 min to 15 min**
- **Found during:** WR-02 GREEN phase
- **Issue:** Raising MIN_ORPHAN_AGE_SECONDS from 120 to 600 made records 5 min old (300 s)
  no longer "old enough" → isOldEnough returned false → all orphan-detection tests deferred
  instead of executing the void/settle path
- **Fix:** Updated `created_at` in `oldPendingCtx` from `Date.now() - 5*60*1000` to
  `Date.now() - 15*60*1000` (15 min > 600 s). Test logic and all assertions unchanged.

**3. [Security Bug] helcim-terminal-success.test.js test (b) — updated assertion**
- **Found during:** WR-07 GREEN phase
- **Issue:** Test (b) asserted `approved: true` for the API-failure fallback — this was
  codifying the WR-07 phantom-revenue bug (same pattern as FIX1's T6/CR-01 exception)
- **Fix:** Updated test name and assertion to `approved: false` (UNCONFIRMED); updated
  log.warn assertion to match the new 'UNCONFIRMED' log message

## Threat Flags

None. No new network endpoints, auth paths, or trust boundaries introduced. All changes
are hardening of existing reconcile and webhook handler code.

## Self-Check: PASSED

Files exist:
- `zoho-middleware/lib/reconcile.js` — verified
- `zoho-middleware/routes/webhooks.js` — verified
- `zoho-middleware/__tests__/reconcile-wr02-wr07.test.js` — verified
- `zoho-middleware/__tests__/webhook-wr07.test.js` — verified

Commits verified:
- `68da18d` test(45): regression tests RED
- `f427e27` fix(45): WR-02
- `147a417` fix(45): WR-07

Test results:
- 1116 middleware tests pass (55 test suites)
- 928 frontend tests pass (49 test suites)
- 0 lint errors
