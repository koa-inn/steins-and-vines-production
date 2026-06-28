---
phase: 44-kiosk-gift-card-certificate-lifecycle
plan: "05"
subsystem: middleware
tags: [gift-cards, zoho-books, apps-script, kiosk, reload, void, atomic-safety]

requires:
  - phase: 44-03
    provides: "gift-cards.js router with callAppsScript helper + zohoPost issue pattern"
  - phase: 44-02
    provides: "Apps Script reload_gift_card + void_gift_card actions (server_token gated)"

provides:
  - "POST /api/kiosk/gift-card/reload — increment-first, zero-tax Zoho sale, needs_manual_review on Zoho failure"
  - "POST /api/kiosk/gift-card/void — status-only cancel via Apps Script void_gift_card"
  - "paymentLimiter on reload route (server.js) — mirrors issue rate-limit"
  - "12 new tests (reload: 8 cases, void: 4 cases); 1021 total middleware tests green"

affects:
  - "44-07 (admin management UI: consumes reload + void request/response shapes documented below)"

tech-stack:
  added: []
  patterns:
    - "Increment-first ordering for reload: Apps Script reload_gift_card increments balance BEFORE Zoho invoice/payment (opposite of issue/redeem). Rationale: customer paid cash — protect their value at rest; Zoho is a bookkeeping concern."
    - "CRITICAL log + needs_manual_review flag on reload Zoho failure: no auto-reversal unlike issue void-on-failure (T-44-20 accepted). Staff reconcile via GiftCards sheet."
    - "Zero-tax reload invoice: identical to issue — no tax_id on line item; KIOSK_GIFT_CARD_ITEM_ID's own EXEMPT setting applies (44-01 Probe B confirmed)."
    - "Void is status-only: no Zoho money movement; void_gift_card Apps Script action sets status='void' in GiftCards sheet."

key-files:
  modified:
    - "zoho-middleware/routes/gift-cards.js — reload + void routes appended (187 new lines; 426 total)"
    - "zoho-middleware/__tests__/gift-cards.test.js — 12 new test cases appended (203 new lines; 648 total)"
    - "zoho-middleware/server.js — paymentLimiter for /api/kiosk/gift-card/reload (1 line)"

key-decisions:
  - "Increment-first ordering for reload (vs issue's Sheets-first): money in hand, protect customer balance; Zoho failure is a staff reconciliation task not a customer data loss risk (T-44-20 accepted)"
  - "No auto-reversal on reload Zoho failure: needs_manual_review flag in 502 response surfaces the inconsistency to staff without exposing Zoho internals or risking a double-decrement if the reverse also fails"
  - "Void has no rate-limiter: status-only, no money movement; existing MW_API_KEY + referer guard are sufficient (T-44-21)"

requirements-completed: [GIFTCARD-01]

duration: ~15min
completed: "2026-06-28"
---

# Phase 44 Plan 05: Gift Card Reload + Void Routes Summary

**Reload (increment-first, zero-tax Zoho sale) and void (status-only) routes shipped; 1021 middleware tests green.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-06-28
- **Completed:** 2026-06-28
- **Tasks:** 2 (Task 1: routes, Task 2: tests — TDD: RED commit then GREEN commit)
- **Files modified:** 3 (gift-cards.js, gift-cards.test.js, server.js)

## Accomplishments

- Appended two new routes to `zoho-middleware/routes/gift-cards.js`:
  - `POST /api/kiosk/gift-card/reload` — fail-closed 503 (KIOSK_GIFT_CARD_ITEM_ID), amount bounds (0, 2000], cert validation, increment-first via `reload_gift_card`, zero-tax Zoho invoice + creditcard payment, `needs_manual_review` 502 on Zoho failure (no auto-reversal).
  - `POST /api/kiosk/gift-card/void` — cert + non-empty reason validation, `void_gift_card` Apps Script call, 200 {ok} / 404 / 400.
- Added `paymentLimiter` for `/api/kiosk/gift-card/reload` in `server.js` (money path — mirrors issue rate-limit).
- Extended `gift-cards.test.js` with 12 new test cases covering all behaviors. Full middleware suite: 1021 tests, 45 suites, all green, lint clean (0 errors; 58 pre-existing warnings unchanged).
- TDD executed: RED commit (test(44-05): 12 failing cases) → GREEN commit (feat(44-05): routes + rate-limit).

## Task Commits

1. **RED — test(44-05)** — `38df271` (test): add failing reload and void test cases
2. **GREEN — feat(44-05)** — `cb36ea2` (feat): implement gift card reload and void routes

## API Shapes (for 44-07 admin UI)

### POST /api/kiosk/gift-card/reload

**Request:**
```json
{ "cert_number": "GC-000042", "amount": 50 }
```

**Response 200:**
```json
{ "ok": true, "cert_number": "GC-000042", "new_balance": 150 }
```

**Error responses:**
- `503` — KIOSK_GIFT_CARD_ITEM_ID not set (fail-closed)
- `400` — cert_number not matching /^GC-\d{6}$/ or amount not in (0, 2000]
- `404` — cert not found (Apps Script not_found)
- `409` — cert not active (Apps Script invalid_status — voided or redeemed-to-zero)
- `502` with `needs_manual_review: true` — balance was incremented but Zoho invoice/payment failed; staff must reconcile

### POST /api/kiosk/gift-card/void

**Request:**
```json
{ "cert_number": "GC-000042", "reason": "customer requested cancellation" }
```

**Response 200:**
```json
{ "ok": true }
```

**Error responses:**
- `400` — cert_number invalid or reason missing/empty
- `404` — cert not found
- `502` — Apps Script unreachable

## Reload Ordering Rationale (Increment-First)

Unlike `issue` (Sheets row first → Zoho → void-on-failure) and `redeem` (balance decremented LAST after Zoho succeeds), `reload` increments the balance **first**:

```
reload_gift_card (increment)  ← happens first
  ↓ success
zohoPost /invoices            ← may fail
  ↓ success
zohoPost /customerpayments    ← may fail
```

**Why:** The customer has already paid cash or card for the top-up. Losing their balance increment (if Zoho fails) is worse than having the accounting system temporarily out of sync. The GiftCards sheet is the balance-of-record (D-05); Zoho is the bookkeeping record. A CRITICAL log + `needs_manual_review: true` in the 502 response tells staff to reconcile: add a manual Zoho invoice for the reload amount.

**Contrast with issue:** Issue creates the Sheets row first (cert exists immediately for customer) then does Zoho — if Zoho fails it voids the Sheets row (cert never activated). The stakes are reversed: a phantom cert with no Zoho record is worse than a delayed cert activation.

## Zero-Tax Reload Invoice

Identical to the issue route (44-03 D-03/D-04 confirmed pattern):

```javascript
line_items: [{
  item_id: process.env.KIOSK_GIFT_CARD_ITEM_ID,  // 109900000000873211
  name: 'Gift Certificate Reload GC-NNNNNN',
  quantity: 1,
  rate: amount
  // No tax_id — item's own 0%/EXEMPT setting produces tax_total=0
}]
```

`ZOHO_TAX_ZERO_ID` is NOT used. 44-07 UI does not need to pass any tax_id.

## Deviations from Plan

### Auto-added: paymentLimiter for reload route

- **Rule:** Rule 2 (missing critical functionality — money-path rate-limit)
- **Found during:** Task 1 implementation
- **Issue:** Plan success criteria required "rate-limited consistently with 44-03" for reload (money path). The plan's task file list omitted server.js but the rate-limit is required for T-44-18 defense-in-depth.
- **Fix:** Added `app.use('/api/kiosk/gift-card/reload', paymentLimiter);` to server.js (one line, mirrors the existing issue rate-limit at line 407).
- **Files modified:** `zoho-middleware/server.js`
- **Commit:** `cb36ea2`

## Known Stubs

None. Both routes make live Apps Script and Zoho calls with no hardcoded placeholder data.

## Threat Flags

No new network endpoints or auth paths beyond the plan's threat model. Reload and void routes are under `/api/kiosk/gift-card/*` which inherits the existing `requireApiKey` and `requireAllowedReferer` guards.

| In-plan coverage | File | Description |
|---|---|---|
| T-44-18 | gift-cards.js reload handler | amount bounds (0, 2000] validated fail-closed |
| T-44-19 | gift-cards.js reload handler | not_found→404, invalid_status→409 |
| T-44-20 | gift-cards.js reload Zoho catch | CRITICAL log + needs_manual_review 502; no auto-reversal |
| T-44-21 | gift-cards.js void handler | reason required; MW_API_KEY guard inherited |
| T-44-22 | gift-cards.js reload handler | 503 fail-closed if KIOSK_GIFT_CARD_ITEM_ID unset |

## Self-Check: PASSED

- FOUND: zoho-middleware/routes/gift-cards.js (426 lines; reload + void routes appended)
- FOUND: zoho-middleware/__tests__/gift-cards.test.js (648 lines; 12 new cases)
- FOUND: commit 38df271 (test: RED phase)
- FOUND: commit cb36ea2 (feat: GREEN phase)
- Full suite: 1021 tests, 45 suites, all green

---
*Phase: 44-kiosk-gift-card-certificate-lifecycle*
*Plan: 05*
*Completed: 2026-06-28*
