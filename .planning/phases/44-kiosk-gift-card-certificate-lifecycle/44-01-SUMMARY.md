---
phase: 44-kiosk-gift-card-certificate-lifecycle
plan: "01"
subsystem: infra
tags: [zoho-books, validateEnv, gift-card, accounting, kiosk]

requires:
  - phase: 43-kiosk-manual-custom-line-item-with-notes
    provides: forked kiosk.js + admin.js money-path and Zoho invoice/payment baseline

provides:
  - "KIOSK_GIFT_CARD_ITEM_ID registered as OPTIONAL env var (startup warning, fail-closed 503 at request time)"
  - "Confirmed zero-tax mechanism: item's own 0%/EXEMPT setting is sufficient — no ZOHO_TAX_ZERO_ID needed on gift-card invoice line"
  - "Confirmed payment_mode:'others' accepted by Zoho; Undeposited Funds is the default posting account (explicit account_id required for liability draw-down in 44-04)"
  - "Zoho Gift Certificate item_id=109900000000873211, Gift Card Sales income account_id=109900000000873209 — confirmed live"
  - "Deferral-journal cadence documented for owner/bookkeeper (monthly: Dr Gift Card Sales → Cr Gift Cards Sold)"

affects:
  - "44-03 (issue route: rely on item's own exemption, do NOT pass tax_id)"
  - "44-04 (redemption split-tender: MUST pass explicit account_id for 'others' payment — NOT the Undeposited Funds default)"
  - "44-05 (reload: same zero-tax mechanism as issue)"
  - "44-02 (Apps Script GiftCards sheet: independent but parallel Wave 1)"

tech-stack:
  added: []
  patterns:
    - "OPTIONAL env var pattern: startup warning only, routes enforce fail-closed 503 at request time"

key-files:
  created: []
  modified:
    - "zoho-middleware/lib/validateEnv.js"

key-decisions:
  - "ZOHO_TAX_ZERO_ID is NOT required on gift-card invoice lines — item's own 0%/EXEMPT setting is sufficient (Probe B, live Zoho confirmation)"
  - "payment_mode:'others' works in S&V Zoho but defaults to Undeposited Funds — 44-04 MUST pass explicit account_id for the Gift Cards Sold liability account"
  - "Gift Certificate item maps to Gift Card Sales INCOME account (not liability) — D-04 satisfied by periodic manual deferral journal (Dr Gift Card Sales → Cr Gift Cards Sold), NOT by code in v1"
  - "KIOSK_GIFT_CARD_ITEM_ID is OPTIONAL (startup warning) not REQUIRED — routes enforce fail-closed 503 at request time, not at startup"

patterns-established:
  - "Zoho zero-tax: set item-level exemption, do not pass tax_id in invoice line for 0%-tax items"
  - "Split-tender 'others' payment: always pass explicit account_id, never rely on Zoho default posting"

requirements-completed: [GIFTCARD-01]

duration: ~15min (Task 3 only; Tasks 1+2 were owner/human-action)
completed: "2026-06-28"
---

# Phase 44 Plan 01: Zoho Setup + API Probes + validateEnv Entry Summary

**Zoho Gift Certificate item (109900000000873211) + Gift Card Sales income account confirmed live; Wave-0 probes resolved both open questions; KIOSK_GIFT_CARD_ITEM_ID registered as optional env with fail-closed semantics.**

## Performance

- **Duration:** ~15 min (code task only; owner-action tasks done prior session)
- **Started:** 2026-06-28T04:30:00Z (continuation agent)
- **Completed:** 2026-06-28T04:44:48Z
- **Tasks:** 3 (Tasks 1+2 = owner human-action; Task 3 = code)
- **Files modified:** 1 (zoho-middleware/lib/validateEnv.js)

## Accomplishments

- Zoho Books "Gift Card Sales" income account and "Gift Certificate" 0%-exempt Sales item created and confirmed live by owner (item_id=109900000000873211, account_id=109900000000873209, is_taxable=false, tax_exemption_code=EXEMPT)
- Wave-0 API probes ran live against S&V Zoho org and resolved both open questions — see Probe Results section below
- KIOSK_GIFT_CARD_ITEM_ID registered as OPTIONAL env var in validateEnv.js (sibling of KIOSK_CONTACT_ID at line 64); Railway env var set by owner
- 977 middleware tests pass, lint clean (0 errors)

## Task Commits

1. **Task 1: Owner Zoho Books setup + Railway env var** — human-action (no commit; Zoho UI + Railway dashboard)
2. **Task 2: Wave-0 Zoho API probes** — human-action (no commit; live Zoho API probes, test invoices deleted)
3. **Task 3: Register KIOSK_GIFT_CARD_ITEM_ID in validateEnv** — `4767a02` (feat)

**Plan metadata:** (see final commit below)

## Files Created/Modified

- `zoho-middleware/lib/validateEnv.js` — Added KIOSK_GIFT_CARD_ITEM_ID to OPTIONAL array at line 65, immediately after KIOSK_CONTACT_ID

## Wave-0 Probe Results (AUTHORITATIVE — downstream plans hard-wire these)

### Probe B: Zero-Tax Mechanism (Open Question 1 / Assumption A2)

**Method:** Created a 1-line draft invoice using KIOSK_GIFT_CARD_ITEM_ID (Gift Certificate item) with no explicit `tax_id` on the line.

**Result:** `tax_total = $0`, `line_item_taxes = []`, `tax_exemption_code = EXEMPT`

**CONCLUSION for 44-03 and 44-05 (issue + reload routes):**
The item's own 0%/EXEMPT setting is sufficient to produce a zero-tax invoice. `ZOHO_TAX_ZERO_ID` is NOT required on the gift-card invoice line. The issue/reload routes in 44-03 and 44-05 MUST NOT pass a `tax_id` on the gift-card line — rely exclusively on the item's own exemption.

### Probe A: payment_mode:'others' (Open Question 2 / Assumption A1)

**Method:** POST `/customerpayments` with `payment_mode="others"` and no `account_id` against a test invoice.

**Result:** Accepted (200/201). Defaulted to deposit account "Undeposited Funds" (`account_id=109900000000000316`, type=cash).

**CONCLUSION for 44-04 (split-tender redemption route):**
`payment_mode:'others'` works in S&V's Zoho without error. HOWEVER, the default posting account (Undeposited Funds, `109900000000000316`) is NOT the desired account — at redemption, the gift portion should draw down the "Gift Cards Sold" liability (not park in Undeposited Funds). **44-04 MUST pass an explicit `account_id` for the Gift Cards Sold liability account.** The exact liability account_id must be confirmed with the owner before 44-04 is implemented (this is the only remaining open design decision).

**Open design flag for 44-04:** Confirm the exact account_id for "Gift Cards Sold" (Current-Liability) in Zoho Books and set it as the `account_id` on the `payment_mode:'others'` customer payment call at redemption. Do NOT rely on the Undeposited Funds default.

All test invoices and payments created during probing were deleted; the live books are clean.

## Confirmed Identifiers

| Item / Account | Zoho ID | Notes |
|---|---|---|
| Gift Certificate item | `109900000000873211` | KIOSK_GIFT_CARD_ITEM_ID |
| Gift Card Sales income account | `109900000000873209` | Mapped on the item |
| Gift Cards Sold liability account | (confirm with owner) | Deferral-journal Cr target; also 44-04 account_id |
| Undeposited Funds (default 'others') | `109900000000000316` | Do NOT use for gift redemption payments |

## Deferral-Journal Cadence (Owner/Bookkeeper — MONTHLY, NOT CODE)

This satisfies D-04 on an accrual basis. No code will be written for this in v1.

**Cadence:** Approximately monthly (or at period end)

**Journal entry:**
- **Debit:** "Gift Card Sales" (Income) — for the total unredeemed gift certificate balance in the period
- **Credit:** "Gift Cards Sold" (Current-Liability) — same amount

**Source of truth for the unredeemed balance:** The GiftCards sheet in the S&V Google Spreadsheet (managed by 44-02 Apps Script). Sum all rows where `status = 'active'` (issued but not fully redeemed/voided) to get the outstanding balance.

**Rationale:** Gift certificate sales post initially to the "Gift Card Sales" income account (because Zoho's Sales item must map to an Income-type account — liability accounts are not selectable). The monthly deferral journal corrects this by shifting the unredeemed balance into the proper liability account, reflecting that the business owes future goods/services equal to that balance. Redeemed certificates stay in income (recognized at redemption).

**Timing note:** This journal should be run before month-end close. The GiftCards sheet `balance` column reflects current outstanding value per certificate.

## Accounting Architecture Summary (for downstream plans)

```
SALE (issue):
  Zoho Invoice line → Gift Certificate item (109900000000873211)
  → posts to "Gift Card Sales" income account (109900000000873209)
  → 0% tax (item's own EXEMPT setting, no tax_id needed)

PERIODIC DEFERRAL (monthly, manual):
  Dr  Gift Card Sales (Income)   — unredeemed balance from GiftCards sheet
  Cr  Gift Cards Sold (Liability) — same amount

REDEMPTION (44-04 split-tender):
  Payment to Zoho: payment_mode='others', account_id=<Gift Cards Sold liability ID>
  → draws down the liability (recognition event)
  → remaining balance charged via Helcim terminal (normal tender path)
```

## Decisions Made

- ZOHO_TAX_ZERO_ID not needed for gift-card invoice lines — item exemption sufficient (Probe B, live confirmation)
- payment_mode:'others' works but default posting is wrong — 44-04 must always supply explicit account_id (Probe A)
- KIOSK_GIFT_CARD_ITEM_ID stays OPTIONAL (not REQUIRED_IN_PROD) because the fail-closed 503 gate lives in the routes themselves, not in startup validation
- D-04 accrual accounting via periodic manual deferral journal is accepted for v1 (not automated in code)

## Deviations from Plan

None — plan executed exactly as written. Tasks 1+2 were already complete when this continuation agent was spawned; Task 3 executed as specified.

## Issues Encountered

None.

## Next Phase Readiness

- 44-02 (Apps Script GiftCards sheet + 7 actions): ready to execute; independent of 44-01 code output
- 44-03 (issue route): ready; hard-wire zero-tax via item exemption only (no tax_id); use KIOSK_GIFT_CARD_ITEM_ID; fail-closed 503 if env unset
- 44-04 (split-tender redemption): requires owner to confirm "Gift Cards Sold" liability account_id before implementation
- Railway env KIOSK_GIFT_CARD_ITEM_ID is set by owner (confirmed); middleware will warn at startup until it's set in other environments (dev/CI expected warning)

---
*Phase: 44-kiosk-gift-card-certificate-lifecycle*
*Plan: 01*
*Completed: 2026-06-28*
