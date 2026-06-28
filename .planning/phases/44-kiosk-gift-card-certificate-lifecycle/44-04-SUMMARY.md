---
phase: 44-kiosk-gift-card-certificate-lifecycle
plan: "04"
subsystem: middleware
tags: [gift-cards, split-tender, pos, zoho-books, apps-script, kiosk, money-path]

requires:
  - phase: 44-02
    provides: "GiftCards sheet + redeem_gift_card Apps Script action"
  - phase: 44-03
    provides: "gift-cards route (lookup used by 44-06 UI)"

provides:
  - "pos.js split-tender: terminal_amount = grandTotal - gift_amount (D-01, D-05)"
  - "Two customerpayments on confirm: creditcard (terminal) + others (gift, account_id=109900000000873231)"
  - "redeem_gift_card Apps Script call as the LAST step — void-on-failure leaves balance untouched (Pitfall 1)"
  - "Gift-card-only path (terminal_amount=0): terminal skipped, 202 gift_card_only:true"
  - "Void-on-failure added to confirm outer catch (Rule 2): prevents orphan charges when invoice creation fails"
  - "ZOHO_GIFT_CARD_CLEARING_ACCOUNT_ID env var registered in validateEnv OPTIONAL list"
  - "11-test suite in pos-gift-card.test.js; 1009 middleware tests green, 928 frontend tests green"

affects:
  - "44-06 (kiosk UI: sends body.gift_card = { cert_number, amount_applied } to /api/kiosk/sale)"
  - "44-05 (reload route: independent of this plan, no cross-affects)"

tech-stack:
  added: []
  patterns:
    - "Split-tender: two zohoPost('/customerpayments') calls — creditcard then others — summing to grandTotal"
    - "Pitfall 1 enforcement: redeem_gift_card axios.post is the LAST .then() in the payment chain"
    - "Pitfall 3 enforcement: gcApplied re-clamped to re-computed grandTotal in confirm handler"
    - "Void-on-failure in confirm outer catch: body.transaction_id presence gates the void"
    - "ZOHO_GIFT_CARD_CLEARING_ACCOUNT_ID env var with hardcoded fallback '109900000000873231'"

key-files:
  created:
    - "zoho-middleware/__tests__/pos-gift-card.test.js (11 tests, 238 lines)"
  modified:
    - "zoho-middleware/routes/pos.js (processSaleWithPrices + confirm handler)"
    - "zoho-middleware/lib/validateEnv.js (ZOHO_GIFT_CARD_CLEARING_ACCOUNT_ID OPTIONAL entry)"

key-decisions:
  - "account_id 109900000000873231 sourced from env var ZOHO_GIFT_CARD_CLEARING_ACCOUNT_ID with hardcoded fallback — Railway env var is OPTIONAL (see below)"
  - "Void-on-failure added to confirm handler outer catch for ALL kiosk sales with a transaction_id (Rule 2 enhancement, not gift-card-specific) — strengthens existing money path"
  - "redeem_gift_card failure mode: log CRITICAL + return 201 (invoice already paid — Pitfall 1 accepted failure mode per RESEARCH.md)"
  - "tax is never recomputed at redemption — gift_amount subtracts from post-tax grandTotal only (D-03/R-03)"

requirements-completed: [GIFTCARD-01]

duration: ~13min
completed: "2026-06-28"
---

# Phase 44 Plan 04: Split-Tender Gift Card Redeem in pos.js Summary

**Split-tender shipped: terminal charge reduced by gift_amount, two Zoho payments (creditcard + others with explicit account_id=109900000000873231), redeem_gift_card called LAST; 1009 middleware tests green.**

## Performance

- **Duration:** ~13 min
- **Started:** 2026-06-28T16:59:24Z
- **Completed:** 2026-06-28T17:12:27Z
- **Tasks:** 2 (Task 1: pos.js + validateEnv; Task 2: pos-gift-card.test.js)
- **Files modified:** 2 (`routes/pos.js`, `lib/validateEnv.js`)
- **Files created:** 1 (`__tests__/pos-gift-card.test.js`)

## Accomplishments

### Task 1: pos.js split-tender — processSaleWithPrices + confirm handler

**`processSaleWithPrices` (Phase 44 split-tender block, ~line 407):**
- Reads `body.gift_card.cert_number` + `body.gift_card.amount_applied`
- Clamps `gift_amount = min(max(amount_applied, 0), grandTotal)` (D-05)
- Normalises `gift_cert_number = cert_number.trim().toUpperCase().slice(0,20)`
- Computes `terminal_amount = round((grandTotal - gift_amount) * 100) / 100`
- If `terminal_amount > 0`: calls `helcimLib.terminalPurchase(terminal_amount, refNumber)` (not grandTotal)
- If `terminal_amount === 0` (gift covers 100%): skips terminal, returns `{ pending:false, gift_card_only:true, reference }` as 202

**Confirm handler (Phase 44 split-tender block, before `zohoPost('/invoices')`):**
- Re-clamps `gcApplied` to re-computed `grandTotal` (Pitfall 3)
- Computes `terminalApplied = round((grandTotal - gcApplied) * 100) / 100`
- Payment chain inside `zohoPost('/invoices').then()`:
  1. Submit invoice (existing, unchanged)
  2. Payment 1: `payment_mode:'creditcard'`, `amount:terminalApplied` — conditional on `terminalApplied > 0`
  3. Payment 2: `payment_mode:'others'`, `account_id: ZOHO_GIFT_CARD_CLEARING_ACCOUNT_ID || '109900000000873231'`, `amount:gcApplied`, `reference_number:gcCertNum` — conditional on `gcApplied > 0 && gcCertNum`
  4. LAST STEP: `axios.post` to Apps Script `redeem_gift_card({cert_number, amount, transaction_ref:refNumber})` — conditional on gift card present. On non-ok response or throw: `log.error('CRITICAL: ...')` but continues (invoice already paid — Pitfall 1 accepted failure mode). On success: `eventLog.logEvent('kiosk.gift_card_redeemed', {certNumber, amountApplied, refNumber})`
- Outer `.catch` (existing): void-on-failure added — if `body.transaction_id` is set (terminal was charged), calls `helcimLib.voidTransaction(txnId)` before returning 502 (Rule 2: prevents orphan charges)

**`validateEnv.js`:** Added `ZOHO_GIFT_CARD_CLEARING_ACCOUNT_ID` to OPTIONAL array (startup warning only; falls back to hardcoded literal at request time).

### Task 2: pos-gift-card.test.js (11 tests)

Tests cover all required behaviors:
1. Sale partial: `terminalPurchase` called with `grandTotal - gift_amount` (60)
2. Sale full: `terminalPurchase` NOT called; response `gift_card_only:true`
3. Sale clamp: `amount_applied > grandTotal` → clamped → terminal skipped
4. Confirm partial: two `customerpayments` (creditcard:60 + others:40) summing to 100
5. Confirm full gift: only `others` payment, no creditcard payment
6. Confirm ordering: `redeem_gift_card` called AFTER both `zohoPost('/customerpayments')` calls
7. Void-on-failure: `zohoPost('/invoices')` throws + `transaction_id` set → `voidTransaction` called, `redeem_gift_card` NOT called
8. Redeem failure (Apps Script throws): still 201, CRITICAL logged
9. Redeem non-ok (`{ok:false}`): still 201, CRITICAL logged
10. Regression (sale): no gift_card → full grandTotal to terminal
11. Regression (confirm): no gift_card → single creditcard payment

## Task Commits

1. **RED: pos-gift-card.test.js (failing)** — `3f7aec5` (test)
2. **GREEN: pos.js + validateEnv.js** — `8b7880d` (feat)

## API Shape (for 44-06 UI)

The kiosk sale request body now accepts an optional `gift_card` field:

```json
POST /api/kiosk/sale
{
  "items": [...],
  "reference_number": "KIOSK-xxx",
  "idempotency_key": "KIOSK-xxx",
  "gift_card": {
    "cert_number": "GC-000042",
    "amount_applied": 50.00
  }
}
```

Response 202 (partial — terminal charged for `terminal_amount`):
```json
{ "pending": true, "reference": "KIOSK-xxx" }
```

Response 202 (full gift card coverage — no terminal):
```json
{ "pending": false, "gift_card_only": true, "reference": "KIOSK-xxx" }
```

The confirm request (`POST /api/kiosk/sale/confirm`) carries the same `gift_card` field:
```json
{
  "items": [...],
  "transaction_id": "txn-helcim-123",
  "reference_number": "KIOSK-xxx",
  "gift_card": {
    "cert_number": "GC-000042",
    "amount_applied": 50.00
  }
}
```

For gift-card-only (`terminal_amount=0`), `transaction_id` is absent; confirm is called immediately after the 202.

## Where account_id 109900000000873231 Lives

| Location | Value | Required Railway env var? |
|---|---|---|
| `zoho-middleware/lib/validateEnv.js` | OPTIONAL entry with description | No — startup warning only |
| `zoho-middleware/routes/pos.js` line ~705 | `process.env.ZOHO_GIFT_CARD_CLEARING_ACCOUNT_ID \|\| '109900000000873231'` | No — hardcoded fallback used if unset |

**Owner action required:** The hardcoded fallback `109900000000873231` is the "Gift Card Redemptions" (cash-type) clearing account_id confirmed live (Probe C, 44-01) — distinct from the "Gift Cards Sold" liability account (`109900000000873204`), which the monthly journal clears the redemptions clearing balance into. The system works without setting `ZOHO_GIFT_CARD_CLEARING_ACCOUNT_ID` in Railway because the fallback is the correct live value. Setting the env var is optional but recommended for transparency and to allow account remapping without a code deploy.

## Deviations from Plan

### Auto-fixed: Void-on-failure added to confirm handler (Rule 2 — missing critical functionality)

**Found during:** Task 1
**Issue:** The existing confirm handler outer catch (`/api/kiosk/sale/confirm`) had no void-on-failure logic. If `zohoPost('/invoices')` failed after a terminal charge, the charge would be orphaned (no refund to customer). The PATTERNS.md explicitly called for reusing the `voidTransaction` pattern here.
**Fix:** Added void-on-failure to the outer catch: if `body.transaction_id` is set (terminal was charged), calls `helcimLib.voidTransaction(txnId)` before returning 502. This applies to ALL kiosk confirms (not just gift card), which is correct behavior (T-44-14 mitigated).
**Files modified:** `zoho-middleware/routes/pos.js` (outer catch at ~line 762)
**Commit:** `8b7880d`

This strengthens (not weakens) the existing money path — per constraint "must NOT weaken the existing terminal→invoice→payment→void-on-failure→idempotency behaviour".

## Threat Model Coverage

| Threat | Mitigation | Verified |
|---|---|---|
| T-44-13: Client over-applies gift | `gift_amount` clamped in processSaleWithPrices AND re-clamped in confirm (Pitfall 3) | Test 3 (clamp) |
| T-44-14: Phantom balance decrement after void | `redeem_gift_card` is LAST after all Zoho calls; any upstream failure skips it | Test 7 (void-no-decrement) |
| T-44-15: Replay double-decrement | `transaction_ref = refNumber` → Apps Script `last_tx_ref` idempotency + Redis KIOSK_IDEM_PREFIX | Existing infrastructure |
| T-44-16: Tax miscomputed | `gift_amount` subtracts only from post-tax `grandTotal`; no tax recompute | Code review confirmed |
| T-44-17: Sale route abuse | Existing `paymentLimiter` on `/api/kiosk/sale` covers this path | Existing infrastructure |

## Known Stubs

None. All payment paths make live Zoho and Apps Script calls with no hardcoded placeholder data.

## Threat Flags

No new network endpoints or auth paths introduced beyond what the plan's threat model documents. The `axios.post` to `APPS_SCRIPT_URL` follows the same server_token pattern established in 44-03.

## Self-Check: PASSED

- FOUND: `zoho-middleware/__tests__/pos-gift-card.test.js`
- FOUND: `zoho-middleware/routes/pos.js` (modified — grep confirms gift_card, gcApplied, terminalApplied, payment_mode:'others')
- FOUND: `zoho-middleware/lib/validateEnv.js` (ZOHO_GIFT_CARD_CLEARING_ACCOUNT_ID in OPTIONAL)
- FOUND: commit `3f7aec5` (test RED)
- FOUND: commit `8b7880d` (feat GREEN)
- Full middleware suite: 1009 tests, 45 suites, all green
- Full frontend suite: 928 tests, 49 suites, all green
- Lint: 0 errors

---
*Phase: 44-kiosk-gift-card-certificate-lifecycle*
*Plan: 04*
*Completed: 2026-06-28*
