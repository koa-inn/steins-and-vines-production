---
phase: 44-kiosk-gift-card-certificate-lifecycle
plan: "07"
subsystem: ui
tags: [gift-cards, kiosk, pos, es5, split-tender, redemption, management, forked-surfaces, d-08]

requires:
  - phase: 44-04
    provides: "POST /api/kiosk/sale (gift_card body), POST /api/kiosk/sale/confirm (gift_card), gift_card_only 202 response"
  - phase: 44-05
    provides: "POST /api/kiosk/gift-card/void"
  - phase: 44-06
    provides: "Issue/Reload modal on both surfaces (kgci-* IDs)"

provides:
  - "Redeem tender GC panel (kgcr-* IDs) in payment view on js/kiosk.js — inline injection"
  - "Redeem tender GC panel (kgcr-* IDs) in payment view on js/admin.js — D-08 identical IDs + logic"
  - "_kioskGiftCard module var on both surfaces (null | {cert_number, amount_applied, balance})"
  - "_kioskPushToTerminal (kiosk.js) + _adminDoSale (admin.js) inner functions with gift_card_only handling"
  - "kioskShowAdminGiftCardMgmtModal() (admin-only): lookup balance + void cert with reason (kgcm-* IDs)"
  - "'Gift Card Management (Lookup / Void)' button in both empty + non-empty cart blocks on admin.js"
  - "Rebuilt js/kiosk.min.js + js/admin.min.js with GC redeem + mgmt UI"

affects:
  - "44-08 (staging UAT — verify redeem flow, split-tender, GC-only path, management modal)"

tech-stack:
  added: []
  patterns:
    - "_kioskGiftCard = null module var; cleared in kioskClearCart on both surfaces (D-08)"
    - "GC panel injected dynamically between kiosk-payment-items and kiosk-payment-footer; shows lookup → balance info → amount input → Apply/Skip/Proceed buttons"
    - "_kioskPushToTerminal (kiosk.js): updates saleBody.gift_card, computes terminalAmtDisplay, hides GC panel, handles gift_card_only 202 (immediate confirm), handles normal 202+pending terminal poll"
    - "_adminDoSale (admin.js): parallel structure; adds x-api-key header; gift_card_only path: immediate POST /api/kiosk/sale/confirm with gift_card + no transaction_id"
    - "Amount clamp client-side: min(live_balance, totals.total); server re-clamps per D-05"
    - "GET /api/kiosk/gift-card/lookup for live balance before apply; result cached in _kioskGiftCard"
    - "kioskShowAdminGiftCardMgmtModal uses openModal/closeModal; kgcm-* IDs (no collision); void sub-view shows 'Void GC-NNNNNN? This cannot be undone.' confirm label + reason input"
    - "POST /api/kiosk/gift-card/void {cert_number, reason} → 200 closes modal + showToast; 409 = already voided"
    - "Recipe sales skip GC panel — _kioskPushToTerminal/_adminDoSale called immediately (gift_card stays undefined)"

key-files:
  created: []
  modified:
    - "js/kiosk.js — _kioskGiftCard var + kioskClearCart clear + restructured kioskProceedToPayment (_kioskPushToTerminal + kgcr-* GC panel injection)"
    - "js/admin.js — _kioskGiftCard var + kioskClearCart clear + restructured kioskProceedToPayment (_adminDoSale + kgcr-* GC panel, D-08) + kioskShowAdminGiftCardMgmtModal (kgcm-*) + management buttons in both cart blocks"
    - "js/kiosk.min.js — rebuilt via npm run build (terser)"
    - "js/admin.min.js — rebuilt via npm run build (terser)"
    - "17 HTML files — cache-busting ?v= stamps updated by npm run build"

key-decisions:
  - "GC panel gates the terminal push on both surfaces — staff must explicitly Skip or Apply+Proceed before terminal starts (prevents accidental duplicate charges)"
  - "gift_card_only path: when gift_amount >= grandTotal, server returns 202+{pending:false, gift_card_only:true}; client immediately calls /api/kiosk/sale/confirm with gift_card field (no transaction_id) — terminal is skipped entirely"
  - "Recipe sales skip the GC panel (gift_card remains undefined in recipeSaleBody) — consistent with prior design where recipe sales have a simplified payment path"
  - "Management modal uses kgcm-* IDs to avoid collision with kgci-* (issue/reload from 44-06) and kgcr-* (redeem tender); void sub-view is a mode-switch within the same modal (not a second openModal call)"
  - "admin.js _adminDoSale now sends x-api-key header (was missing in original kioskProceedToPayment implementation; Rule 2 auto-fix applied)"

requirements-completed: [GIFTCARD-01]

duration: ~35min
completed: "2026-06-28"
---

# Phase 44 Plan 07: Gift Card Redeem Tender + Admin Management View Summary

**Redeem tender (kgcr-* GC panel) wired identically on kiosk.js + admin.js (D-08); split-tender + gift-card-only paths both handled; admin-only management modal (lookup balance + void) using kgcm-* IDs; bundles rebuilt, 928 frontend tests green.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-06-28
- **Completed:** 2026-06-28
- **Tasks:** 3 (Task 1: kiosk.js redeem tender, Task 2: admin.js paired tender + management modal, Task 3: rebuild bundles + tests)
- **Files modified:** 4 source + 17 build artifacts (HTML cache stamps, min bundles)

## Accomplishments

- Added `_kioskGiftCard` module var (null | {cert_number, amount_applied, balance}) on both surfaces; cleared in `kioskClearCart` on cart clear.
- Restructured `kioskProceedToPayment` on **kiosk.js**: extracted `_kioskPushToTerminal` inner function that updates `saleBody.gift_card`, computes terminal amount display, hides GC panel, handles 202+gift_card_only (immediate confirm), and runs the normal terminal poll+confirm flow.
- Injected `kgcr-*` GC panel in kiosk.js payment view: Apply Gift Card / Proceed to Terminal / Skip; lookup GET wires live balance from server; amount clamped to min(balance, total) per D-05.
- Restructured `kioskProceedToPayment` on **admin.js** (D-08 parity): extracted `_adminDoSale` with gift_card_only handling + x-api-key header; identical kgcr-* panel IDs and logic.
- Added `kioskShowAdminGiftCardMgmtModal()` (admin-only, D-06/D-08): lookup view (GET lookup → show status/face_value/balance) + void sub-view ("Void GC-NNNNNN? This cannot be undone." + reason input → POST /void → closeModal + toast). Uses kgcm-* IDs.
- Added "Gift Card Management (Lookup / Void)" button in both empty-cart and non-empty-cart blocks of admin.js `kioskRenderCart()`.
- `npm run build` exits 0; 928 tests, 49 suites, all green.

## Task Commits

1. **Task 1: kiosk.js redeem tender** — `fc936f2` (feat)
2. **Task 2: admin.js paired tender + management modal** — `27ebb87` (feat)
3. **Task 3: Rebuild min bundles + cache stamps** — `d66a008` (chore)

**Plan metadata:** (this commit)

## API Calls Wired

| Flow | Endpoint | Request | Response |
|------|----------|---------|----------|
| Lookup balance | `GET /api/kiosk/gift-card/lookup?cert_number=...` | — | 200 `{ok, data:{current_balance, status, face_value}}` |
| Sale with GC tender | `POST /api/kiosk/sale` | `{...items, gift_card:{cert_number, amount_applied}}` | 202 `{pending:true}` or 202 `{pending:false, gift_card_only:true}` |
| Confirm (terminal) | `POST /api/kiosk/sale/confirm` | `{..., transaction_id, gift_card:{...}}` | 201 |
| Confirm (GC-only) | `POST /api/kiosk/sale/confirm` | `{..., gift_card:{...}}` (no transaction_id) | 201 |
| Mgmt lookup | `GET /api/kiosk/gift-card/lookup?cert_number=...` | — | 200 (same as above) |
| Void cert | `POST /api/kiosk/gift-card/void` | `{cert_number, reason}` | 200 `{ok}` |

All calls send `x-api-key: SHEETS_CONFIG.MW_API_KEY`.

## Files Created/Modified

- `js/kiosk.js` — +297 lines net: `_kioskGiftCard` var, kioskClearCart clear, restructured kioskProceedToPayment with `_kioskPushToTerminal` + kgcr-* panel
- `js/admin.js` — +610 lines net: `_kioskGiftCard` var, kioskClearCart clear, restructured kioskProceedToPayment with `_adminDoSale` + kgcr-* panel, `kioskShowAdminGiftCardMgmtModal()`, management buttons
- `js/kiosk.min.js` — rebuilt (terser)
- `js/admin.min.js` — rebuilt (terser)
- 17 HTML files — cache-busting `?v=` stamps updated by `npm run build`

## Decisions Made

- GC panel gates the terminal push — staff must explicitly act (Skip, Apply+Proceed) before terminal starts. This prevents accidental duplicate charges if staff opens the payment view then navigates away.
- gift_card_only path: server 202+`{pending:false, gift_card_only:true}` → client immediately POSTs /confirm with gift_card but no transaction_id. Terminal is completely skipped for full-coverage redemptions.
- Recipe sales skip the GC panel entirely (gift_card stays undefined in saleBody). Consistent with the recipe payment simplification from 44-03/44-04.
- Management modal uses kgcm-* ID prefix — no collision with kgci-* (issue/reload, 44-06) or kgcr-* (redeem tender, this plan). Void sub-view is a mode-switch (show/hide divs) within the same openModal call.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] admin.js _adminDoSale was missing x-api-key header**
- **Found during:** Task 2 — reviewing the original kioskProceedToPayment in admin.js before restructuring
- **Issue:** The existing admin.js sale fetch calls lacked `x-api-key: apiKey` header, meaning admin kiosk sales would be rejected by the middleware's API key auth
- **Fix:** Added `'x-api-key': apiKey` header to all fetch calls in `_adminDoSale` (the replacement for the original fetch block)
- **Files modified:** `js/admin.js`
- **Commit:** `27ebb87`

## Known Stubs

None. Both surfaces make live API calls to middleware routes shipped in 44-03/44-04/44-05.

## Threat Flags

No new threat surface. The redeem panel and management modal call only the documented `/api/kiosk/gift-card/*` routes with the existing `x-api-key: MW_API_KEY` auth header. Server is authoritative for all balance validation and void enforcement. D-08 fork parity confirmed via grep on both files.

## Self-Check: PASSED

- FOUND: js/kiosk.js (_kioskGiftCard + _kioskPushToTerminal + kgcr-* panel present)
- FOUND: js/admin.js (_kioskGiftCard + _adminDoSale + kgcr-* panel + kioskShowAdminGiftCardMgmtModal + kiosk-gc-mgmt-btn present)
- FOUND: js/admin.min.js (gift-card/void + gift-card/lookup + kgcm- : grep -c = 1)
- FOUND: js/kiosk.min.js (gift-card/lookup + kgcr- : grep -c = 1)
- FOUND: commit fc936f2 (feat: kiosk.js redeem tender)
- FOUND: commit 27ebb87 (feat: admin.js paired tender + management modal)
- FOUND: commit d66a008 (chore: rebuild bundles)
- Frontend tests: 928 passed, 49 suites, 0 failures

---
*Phase: 44-kiosk-gift-card-certificate-lifecycle*
*Plan: 07*
*Completed: 2026-06-28*
