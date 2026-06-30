---
phase: 45-security-and-money-path-hardening-audit-critical-and-high
plan: "07"
subsystem: money-path
tags: [money-path, pos, gift-card, split-tender, pending-charge, tdd, d12, d13, security]
dependency_graph:
  requires: [lib/money-path.js (45-05), pos.js hardening (45-06), AUDIT-H-GC, AUDIT-H-ORPHAN]
  provides: [balance-validated-split-tender, needs_manual_review-on-redeem-failure, kiosk-pending-charge-interface]
  affects: [routes/pos.js, lib/constants.js, __tests__/pos-giftcard.test.js]
tech_stack:
  added: [zoho-middleware/__tests__/pos-giftcard.test.js]
  patterns: [fail-open-balance-lookup, Promise.resolve-wrap, pending-charge-persist, giftCardActivationFailed-flag]
key_files:
  created:
    - zoho-middleware/__tests__/pos-giftcard.test.js
  modified:
    - zoho-middleware/routes/pos.js
    - zoho-middleware/lib/constants.js
decisions:
  - "D-12: balance lookup in sale path wraps axios.post in Promise.resolve() so undefined return (jest.fn default) doesn't throw — fail-open pattern preserved for tests and real outages"
  - "D-12: confirm path also validates gcApplied against realBalance before recording Zoho gift-card payment (both endpoints protected)"
  - "D-12: redeem failure reuses existing giftCardActivationFailed → needs_manual_review mechanism (no new response field needed)"
  - "D-13: KIOSK_PENDING_CHARGE_PREFIX = 'kiosk:pending-charge:' with 7-day TTL; 45-08 reconciliation backstop consumes this record"
  - "D-13: pending context written after every successful kiosk/sale push (not just timeouts) — client-side timeout leaves a reconcilable trail regardless of where the timer fires"
  - "D-13: salesorder-pay timeout branch persists pending context before 504 response; both terminalPurchase rejection and poll timeout land in same .catch() handler"
  - "T5 test: key-aware cache.get mock needed (catalog key vs idempotency key) to prevent acquireIdempotencyLock from short-circuiting as a replay when idempotency_key is present in body"
metrics:
  duration: "~20 min"
  completed: "2026-06-30"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 3
---

# Phase 45 Plan 07: Gift-Card Split-Tender Hardening (D-12 + D-13) Summary

Closed the gift-card split-tender underpayment hole (D-12) and laid the orphan-defense interface (D-13): server-side balance validation clamps gcApplied to the certificate's real balance before the terminal is charged, redeem failures surface as needs_manual_review, and terminal timeouts persist a pending-charge record for the 45-08 reconciliation backstop. 8 new regression tests; full 1094-test suite green.

## What Was Built

### Task 1: Balance-validated split-tender + needs_manual_review (D-12)

**The underpayment hole (before):**
- Customer submits `gift_card.amount_applied = $50` on a cert with only $30 balance
- Server clamped to `grandTotal` ($100) — $50 < $100 so no clamp fired
- Terminal charged $50 (= $100 − $50) instead of $70 (= $100 − $30)
- Zoho recorded $50 terminal + $50 gift card = $100 — looked balanced!
- Net loss: $20 underpayment, certificate balance overdrawn

**The fix:**

`routes/pos.js — processSaleWithPrices (kiosk/sale path):`
- Before computing `terminal_amount`, look up real balance via Apps Script `lookup_gift_card`
- Clamp: `gift_amount = min(submitted, realBalance, grandTotal)`
- Fail-open: if lookup fails or is unreachable, use client-submitted amount (bounded by grandTotal)
- `Promise.resolve(axios.post(...))` wraps the call so jest.fn() returning undefined doesn't throw

`routes/pos.js — /api/kiosk/sale/confirm handler:`
- Same balance lookup before `zohoPost('/invoices')` records the gift-card payment
- Prevents Zoho recording a larger gift-card payment than the certificate held
- Same fail-open pattern

`routes/pos.js — redeem_gift_card failure (LAST STEP):`
- Both the `!r.ok` branch and the network-error `.catch()` now set `giftCardActivationFailed = true`
- Flows through the existing `giftCardActivationFailed → result.needs_manual_review = true` mechanism at line ~1086
- Staff see `needs_manual_review: true` in the 201 response (not a silent CRITICAL log)

### Task 2: Pending-charge context on terminal timeout (D-13 interface)

**lib/constants.js:**
```js
// Kiosk pending charge — D-13 reconciliation interface (45-07 → consumed by 45-08)
KIOSK_PENDING_CHARGE_PREFIX: 'kiosk:pending-charge:',
```

`routes/pos.js — kiosk/sale push success (after terminalPurchase resolves):`
```js
var pendingCacheKey = C.CACHE_KEYS.KIOSK_PENDING_CHARGE_PREFIX + refNumber;
var pendingContext = {
  reference_number: refNumber,
  amount:           terminal_amount,
  idempotency_key:  body.idempotency_key || null,
  created_at:       new Date().toISOString()
};
cache.set(pendingCacheKey, pendingContext, KIOSK_PENDING_CHARGE_TTL).catch(function () {});
```

`routes/pos.js — salesorder-pay timeout (.catch branch):`
```js
var _pendingCtx = {
  reference_number: soNumber,
  amount:           balance,
  salesorder_id:    soId,
  idempotency_key:  idempotencyKey,
  created_at:       new Date().toISOString()
};
cache.set(_pendingKey, _pendingCtx, KIOSK_PENDING_CHARGE_TTL).catch(function () {});
// then: return res.status(504).json({ error: 'Terminal did not respond in time...' });
```

TTL: `KIOSK_PENDING_CHARGE_TTL = 604800` (7 days) — chosen to survive daily reconciliation cadence.

### __tests__/pos-giftcard.test.js (8 tests, new)

| Test | What it covers |
|------|----------------|
| T1 | gcApplied > realBalance → terminalPurchase called with grandTotal − realBalance |
| T2 | redeem_gift_card failure → needs_manual_review:true in 201 response |
| T3 | gcApplied <= realBalance → original terminal_amount unchanged |
| T4 | kiosk/sale push success → cache.set called with KIOSK_PENDING_CHARGE_PREFIX + refNumber |
| T5 | kiosk/sale pending record shape: reference_number, amount, idempotency_key, created_at |
| T6 | salesorder-pay timeout → cache.set called with KIOSK_PENDING_CHARGE_PREFIX + soNumber |
| T7 | salesorder-pay pending record shape: salesorder_id, reference_number, amount, idempotency_key, created_at |
| T8 | salesorder-pay timeout → staff still receive 504 response |

## Pending-Charge Record Shape (consumed by 45-08)

**kiosk/sale key format:** `kiosk:pending-charge:{reference_number}`

```json
{
  "reference_number": "KIOSK-1234567890",
  "amount": 70.00,
  "idempotency_key": "client-key-abc123",
  "created_at": "2026-06-30T13:15:00.000Z"
}
```

**salesorder-pay key format:** `kiosk:pending-charge:{salesorder_number}`

```json
{
  "reference_number": "SO-00123",
  "amount": 80.00,
  "salesorder_id": "zoho-so-id-abc",
  "idempotency_key": "helcim-generated-key",
  "created_at": "2026-06-30T13:15:00.000Z"
}
```

TTL: 604800 seconds (7 days). 45-08 reconciliation reads `KIOSK_PENDING_CHARGE_PREFIX` keys, cross-references Helcim transaction status, and alerts/voids orphaned charges.

## Commits

| Hash | Type | Description |
|------|------|-------------|
| ff3c961 | test(45-07) | Add failing tests for gift-card balance validation + pending-charge persist (RED) |
| 8ecc127 | feat(45-07) | Gift-card split-tender balance validation + pending-charge persist (GREEN) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] axios.post returns undefined in tests without mockResolvedValue**
- **Found during:** GREEN phase — full suite run after first implementation attempt
- **Issue:** `jest.fn()` returns `undefined` by default. My balance lookup called `axios.post(...).then(...)` — `undefined.then(...)` throws a TypeError synchronously, before my `.catch(function() { return null; })` could intercept it. 3 tests in `pos-gift-card.test.js` timed out.
- **Fix:** Wrapped `axios.post(...)` in `Promise.resolve(...)` — `Promise.resolve(undefined).then(...)` gets `resp = undefined`, computes `r = {}`, no balance → falls back to submitted amount. Fail-open behavior preserved.
- **Files modified:** `zoho-middleware/routes/pos.js` (both sale and confirm paths)
- **Commit:** 8ecc127

**2. [Rule 1 - Test design] T5 cache.get interference with idempotency lock**
- **Found during:** GREEN phase — T5 failed when `idempotency_key` was present in the request body
- **Issue:** `cache.get.mockResolvedValue(CATALOG_EXEMPT)` returns `CATALOG_EXEMPT` for ALL keys, including the idempotency key. `acquireIdempotencyLock` saw a truthy cached value → `{ status: 'replay' }` → handler returned 201 immediately without ever reaching the pending-charge persist.
- **Fix:** T5 uses a key-aware `cache.get.mockImplementation` that returns `CATALOG_EXEMPT` for `test:kiosk-products` and `null` for all other keys (idempotency key → no replay).
- **Files modified:** `zoho-middleware/__tests__/pos-giftcard.test.js`
- **Commit:** 8ecc127

## Verification Results

- `cd zoho-middleware && npm test -- pos-giftcard`: 8/8 PASS
- `cd zoho-middleware && npm test`: 1094/1094 PASS (8 new, 1086 pre-existing green)
- `npm test` (frontend jsdom): 928/928 PASS (unchanged)
- `npm run lint`: 0 errors (pre-existing warnings only)

## Known Stubs

None. Both D-12 and D-13 mitigations are fully wired:
- Balance validation runs in both sale and confirm paths
- needs_manual_review surfaces on redeem failure
- Pending-charge context persisted for every terminal push (kiosk/sale) and on timeout (salesorder-pay)

The pending-charge CONSUMER (45-08 reconciliation backstop) is the next plan; the interface is now defined and ready.

## Threat Flags

None. All threats in the plan's threat model are mitigated:
- T-45-07-UNDER: clamped to real server-side balance (not just grandTotal) + needs_manual_review on failure
- T-45-07-LOSS: accepted (Apps Script LockService bounds loss; we validate + flag rather than rewrite)
- T-45-07-ORPHAN-A: partial mitigation — pending-charge context persisted; full closure via 45-08
- T-45-07-SC: no new packages

## Self-Check: PASSED

- [x] zoho-middleware/__tests__/pos-giftcard.test.js exists (8 tests)
- [x] zoho-middleware/routes/pos.js modified (balance lookup + pending-charge persist + redeem failure flag)
- [x] zoho-middleware/lib/constants.js modified (KIOSK_PENDING_CHARGE_PREFIX)
- [x] Commits ff3c961 (RED), 8ecc127 (GREEN) exist in git log
- [x] Full test suite 1094/1094 green
