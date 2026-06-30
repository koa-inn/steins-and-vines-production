---
phase: 45-security-and-money-path-hardening-audit-critical-and-high
plan: "08"
subsystem: money-path
tags: [money-path, reconciliation, orphan-charge, d13, tdd, security, webhook, sweep]
dependency_graph:
  requires: [lib/money-path.js (45-05), kiosk-pending-charge-interface (45-07)]
  provides: [orphan-charge-reconciliation-backstop, sweepPendingCharges, reconcilePendingCharge]
  affects: [routes/webhooks.js, server.js, routes/pos.js, lib/reconcile.js]
tech_stack:
  added: [zoho-middleware/lib/reconcile.js, zoho-middleware/__tests__/reconcile.test.js]
  patterns: [tdd-red-green, fire-and-forget-async, sv:void-failure-convention, age-guard, double-stringify-terminal-result]
key_files:
  created:
    - zoho-middleware/lib/reconcile.js
    - zoho-middleware/__tests__/reconcile.test.js
  modified:
    - zoho-middleware/routes/webhooks.js
    - zoho-middleware/server.js
    - zoho-middleware/routes/pos.js
decisions:
  - "D-13: reconcilePendingCharge(transactionId, deps) calls getCardTransactionById to get invoiceNumber, looks up KIOSK_PENDING_CHARGE_PREFIX + invoiceNumber, voids if APPROVED + old + no Zoho order"
  - "D-13: age guard (120s threshold) prevents false-positive voids during the normal 90s terminal approval window — webhook fires before frontend calls /confirm"
  - "D-13: hasMatchingZohoOrder checks KIOSK_IDEM_PREFIX + 'confirm:' + idempotency_key — present means confirm ran and Zoho invoice/payment was recorded"
  - "D-13: Rule 2 deviation — confirm path deletes KIOSK_PENDING_CHARGE_PREFIX + refNumber on success so the sweep can rely on absence (not just the 10-min confirm idem TTL)"
  - "D-13: sweepPendingCharges checks helcim:terminal:result:{invoiceNumber} (300s TTL set by processCardTransactionResult) to extract transactionId for auto-void; if result expired + record old → flag sv:void-failure for manual review"
  - "D-13: VOID_FAILURE_TTL = 30 days, matching pos.js:1007/1664 convention; sv:void-failure key includes needs_manual_review:true"
  - "D-13: sweepPendingCharges no-ops cleanly when cache.isConnected() is false — mirrors brewpad retry sweep pattern"
metrics:
  duration: "~5 min"
  completed: "2026-06-30"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 5
---

# Phase 45 Plan 08: Helcim↔Zoho Orphan-Charge Reconciliation Backstop (D-13) Summary

Closed the late-approval orphan-charge window (D-13) that synchronous void-on-failure (45-06/07) cannot catch: a bounded reconciliation backstop keyed on reference_number (= Helcim invoiceNumber passed to terminalPurchase) auto-voids or flags for manual review any kiosk charge that was approved after the 90-second polling timeout with no matching Zoho order. 8 new TDD tests; full 1102-test suite green.

## What Was Built

### Task 1: lib/reconcile.js (new, 350 lines)

Two exported functions:

**`reconcilePendingCharge(transactionId, deps)`**

Called by the webhook handler when a late Helcim approval arrives. Flow:

1. `helcimLib.getCardTransactionById(transactionId)` → get `status` + `invoiceNumber`
2. Fetch `KIOSK_PENDING_CHARGE_PREFIX + invoiceNumber` from Redis
3. Age guard: if record is < 120s old → defer (still in normal 90s approval window; `/confirm` may not have run yet)
4a. If `APPROVED` + record old + `hasMatchingZohoOrder()` returns true → `cache.del(pendingKey)` (settled)
4b. If `APPROVED` + record old + no Zoho order → `helcimLib.voidTransaction(transactionId)`
    - On void success: `cache.del(pendingKey)` + log
    - On void failure: persist `sv:void-failure:{ts}` (`needs_manual_review: true`, 30-day TTL) + `mailer.sendVoidFailureAlert`
5. Helcim lookup failure → leave record intact (no destructive action)

**`hasMatchingZohoOrder(ctx)`** (internal helper):

Checks `KIOSK_IDEM_PREFIX + 'confirm:' + ctx.idempotency_key` in Redis. If that key exists, the kiosk `/confirm` handler ran and the Zoho invoice/payment was recorded → charge is settled. Returns false on any Redis error (fail-safe toward orphan detection).

**`sweepPendingCharges(deps)`**

Called every 5 minutes from server.js. Flow for each `KIOSK_PENDING_CHARGE_PREFIX:*` key:

- Check `helcim:terminal:result:{invoiceNumber}` cache (300s TTL set by `processCardTransactionResult`). This key uses the double-stringify convention (webhooks.js caches `JSON.stringify({...})` and `cache.set` JSON-stringifies again → `cache.get` returns inner string → parse again to get object).
- If cached result present AND `approved: true` → extract `transactionId` → call `reconcilePendingCharge(transactionId, deps)` (auto-void path)
- If no cached result AND record age > 120s → persist `sv:void-failure:{ts}` + `mailer.sendVoidFailureAlert` (manual review flag; we have no transactionId to auto-void)
- No-ops cleanly if `cache.isConnected()` returns false

### Task 2: Webhook wiring + periodic sweep

**routes/webhooks.js:**

```js
// Added at top:
var reconcile = require('../lib/reconcile');

// Added after collect-pending block in processCardTransactionResult:
if (status === 'APPROVED' && invoiceNumber) {
  reconcile.reconcilePendingCharge(transactionId).catch(function (err) {
    log.warn('[webhook/helcim] Kiosk pending charge reconcile error: ' + err.message);
  });
}
```

Fire-and-forget `.catch()` preserves the respond-200-before-async invariant (webhook 200 was already sent at line 47).

**server.js:**

```js
// D-13: Kiosk pending-charge reconciliation sweep (45-08 backstop)
setInterval(function () {
  reconcile.sweepPendingCharges().catch(function (err) {
    log.error('[reconcile] Pending-charge sweep failed: ' + err.message);
  });
}, 5 * 60 * 1000);
log.info('[reconcile] Kiosk pending-charge sweep registered: every 5 minutes');
```

Registered after the existing brewpad retry sweeps (~line 571) — same 5-minute cadence.

### Rule 2 Deviation: pos.js confirm path clears pending record

**Problem**: The confirm idempotency key has a 10-minute TTL. After 10 minutes, `hasMatchingZohoOrder()` returns false even for settled charges (no Zoho API call). The sweep (running every 5 minutes) would see old pending records with no confirm key and flag them as orphans — false positives for every normal kiosk sale.

**Fix**: In the confirm path, after the Zoho `invoicePost` succeeds, also `cache.del(KIOSK_PENDING_CHARGE_PREFIX + refNumber)`. Absence of the pending record is a durable signal (7-day Redis TTL otherwise) that the charge is settled.

```js
// D-13 (45-08 Rule 2): clear kiosk pending-charge sentinel on successful confirm
var pendingRef = (typeof body.reference_number === 'string' && body.reference_number)
  ? body.reference_number.slice(0, 64) : '';
if (pendingRef) {
  cache.del(C.CACHE_KEYS.KIOSK_PENDING_CHARGE_PREFIX + pendingRef).catch(function () {});
}
```

### __tests__/reconcile.test.js (8 tests, new)

| Test | What it covers |
|------|----------------|
| T1   | APPROVED + no confirm key → voidTransaction called |
| T1b  | void failure → sv:void-failure persisted + sendVoidFailureAlert |
| T2   | APPROVED + confirm key present → cache.del (settled), no void |
| T3   | Helcim lookup failure → no void, no del, no alert |
| T3b  | No pending record → no-op |
| T4   | Redis disconnected → sweepPendingCharges no-ops (getClient not called) |
| T5   | Old record + APPROVED terminal result → reconcilePendingCharge → void |
| T6   | Old record + no terminal result → sv:void-failure + alert (no transactionId) |

## Commits

| Hash    | Type         | Description |
|---------|--------------|-------------|
| 318366b | test(45-08)  | Add failing tests for orphan-charge reconciliation backstop (RED) |
| 37b0d82 | feat(45-08)  | Create lib/reconcile.js — orphan-charge reconciliation backstop (GREEN) |
| 1cc7dc5 | feat(45-08)  | Wire webhook reconcile + register periodic sweep (D-13) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] pos.js confirm path must clear pending record**

- **Found during:** GREEN phase — analyzing reconcile's `hasMatchingZohoOrder` logic against the confirm idempotency TTL (10 min) vs. pending record TTL (7 days)
- **Issue:** The confirm idem key expires after 10 minutes. The periodic sweep runs every 5 minutes. After the first sweep cycle following TTL expiry (T+15 min), any successfully-settled kiosk/sale charge would appear as an orphan to the sweep (pending record present, no confirm key, no terminal result), triggering false-positive `sendVoidFailureAlert` calls for all normal sales.
- **Fix:** Added `cache.del(KIOSK_PENDING_CHARGE_PREFIX + refNumber)` in the confirm success path in pos.js. Absence of the pending record is a durable signal (up to 7 days) that the charge is settled.
- **Files modified:** `zoho-middleware/routes/pos.js` (NOT in original plan's `files_modified` list)
- **Commit:** 1cc7dc5

**2. [Rule 1 - Design] Age guard added to reconcilePendingCharge**

- **Found during:** GREEN phase — analyzing race condition between webhook handler and kiosk /confirm
- **Issue:** The webhook fires within seconds of terminal approval. In the normal flow (approval within 90s), the webhook fires BEFORE the kiosk frontend has called `/confirm`. Without an age check, `reconcilePendingCharge` would see the pending record + no confirm key → void a valid charge mid-confirm-flow.
- **Fix:** Added `isOldEnough(ctx)` check (threshold: 120s = 90s terminal timeout + 30s buffer). If the pending record is < 120s old, reconciliation is deferred. After 120s, no frontend will retry confirm (it got a 504 or succeeded).
- **Files modified:** `zoho-middleware/lib/reconcile.js`
- **Commit:** 37b0d82

## Verification Results

- `cd zoho-middleware && npm test -- reconcile`: 8/8 PASS
- `cd zoho-middleware && npm test -- "reconcile|webhooks"`: all PASS
- `cd zoho-middleware && npm test`: 1102/1102 PASS (8 new, 1094 pre-existing green)
- `npm test` (frontend jsdom): 928/928 PASS (unchanged)
- `npm run lint`: 0 errors (138 pre-existing warnings only)

## Known Stubs

None. The reconciliation backstop is fully wired:
- `reconcilePendingCharge` called by webhook handler (fire-and-forget) on every APPROVED event
- `sweepPendingCharges` registered in server.js every 5 minutes
- `pos.js` confirm path clears pending record on success
- All orphan paths: auto-void (with transactionId) or `sv:void-failure` + staff alert (without)

## Threat Flags

None new beyond those in the plan's threat model:
- T-45-08-ORPHAN: mitigated (webhook reconcile + periodic sweep, keyed on reference_number)
- T-45-08-CADENCE: accepted (5-min sweep window documented; synchronous void-on-failure from 45-06/07 is the primary guard)
- T-45-08-MULTI: accepted (single Railway instance; documented)
- T-45-08-SC: mitigated (no new packages; uses existing helcim/cache/mailer)

## Self-Check: PASSED

- [x] zoho-middleware/lib/reconcile.js exists (350 lines, exports reconcilePendingCharge + sweepPendingCharges)
- [x] zoho-middleware/__tests__/reconcile.test.js exists (8 tests, all green)
- [x] zoho-middleware/routes/webhooks.js modified (require reconcile + call in processCardTransactionResult)
- [x] zoho-middleware/server.js modified (require reconcile + setInterval sweep)
- [x] zoho-middleware/routes/pos.js modified (cache.del pending record in confirm path)
- [x] Commits 318366b (RED), 37b0d82 (GREEN), 1cc7dc5 (feat/Task2) exist in git log
- [x] Full test suite 1102/1102 green
