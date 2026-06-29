---
phase: 44-kiosk-gift-card-certificate-lifecycle
plan: "10"
subsystem: ui
tags: [gift-cards, kiosk, pos, es5, cart, terminal, activation-failure, forked-surfaces, d-08, gap-closure]

requires:
  - phase: 44-09
    provides: "gift_cert line handling in /api/kiosk/sale + /confirm; activation post-payment; gift_card_activation_failed 201 flag; /issue + /reload routes decommissioned"
  - phase: 44-07
    provides: "redeem tender (_kioskGiftCard / kgcr-*) + management modal (kgcm-*) + _adminDoSale / _kioskPushToTerminal on both surfaces"
  - phase: 44-06
    provides: "Issue/Reload modal (kgci-* IDs) + kiosk-add-gc-btn on both surfaces; kioskShowGiftCardIssueModal / kioskShowAdminGiftCardIssueModal"

provides:
  - "Issue/Reload modal ADDS gift_cert cart line on kiosk.js + admin.js (G-44-01 closed)"
  - "Reload mode pre-checks cert via /api/kiosk/gift-card/lookup before adding line (UX guard)"
  - "gift_cert line: { gift_cert:true, gift_action, cert_number, name, rate, tax_percentage:0, taxable:false, qty:1 }"
  - "kioskProceedToPayment / _adminDoSale items map emits { gift_cert, gift_action, cert_number, quantity:1, rate }"
  - "gift_cert lines: zero-tax (tax_percentage:0), never discounted (custom||gift_cert guard), removable, qty fixed at 1"
  - "gift_card_activation_failed alert in handleSaleResult (kiosk.js) + _adminDoSale confirm paths (admin.js) — T-44-G11, D-08"
  - "Rebuilt js/kiosk.min.js + js/admin.min.js; 928 frontend + 1033 middleware tests green"

affects:
  - "44-08 UAT re-run: full iPad UAT (issue via cart+terminal, reload, lookup, partial/full redeem, void) can now proceed"

tech-stack:
  added: []
  patterns:
    - "gift_cert cart line: _kioskCart['giftcert-'+counter] = { item:{gift_cert:true,...}, qty:1 } — mirrors custom line pattern"
    - "Reload pre-check: GET /lookup before add-to-cart (UX guard; server re-validates, D-05)"
    - "Activation-failure: alert() blocking dialog before normal post-sale cleanup; includes cert_number(s) from gift_cert items"
    - "D-08 parity: identical cart line shape, items map branch, and activation-failure alert on both kiosk.js and admin.js"
    - "gift_cert render: special case in kioskRenderCart forEach loop (no qty stepper, qty=1 fixed, remove button wired)"

key-files:
  created:
    - ".planning/phases/44-kiosk-gift-card-certificate-lifecycle/44-10-SUMMARY.md"
  modified:
    - "js/kiosk.js — kioskSubmitGiftCardIssue reworked; _kioskGiftCertCounter added; discount guard extended; gift_cert render + items map; gift_card_activation_failed in handleSaleResult"
    - "js/admin.js — kioskSubmitAdminGiftCardIssue reworked; _kioskGiftCertCounter added; gift_cert render + remove wiring; items map; gift_card_activation_failed in _adminDoSale (both paths)"
    - "js/kiosk.min.js — rebuilt via npm run build"
    - "js/admin.min.js — rebuilt via npm run build"
    - "admin.html, kiosk.html, brewpad.html, index.html, + 14 page HTML files — cache stamp updated by build"

key-decisions:
  - "alert() used for gift_card_activation_failed (blocking native dialog, no dismiss-to-proceed until staff reads it) — ensures staff sees the message before normal post-sale flow"
  - "admin.js gift_card_activation_failed check added in both gift-card-only confirm path AND direct 201 path for defensive coverage"
  - "admin.js discount guard not added (admin.js has no discount feature; documented as deviation note)"
  - "Reload mode pre-check uses /lookup status field: any non-active status shows 'Certificate is not active and cannot be reloaded' — consistent with 44-07 redeem panel wording"
  - "_kioskGiftCertCounter added as a separate counter from _kioskCustomCounter to avoid key collisions and clarify intent"

requirements-completed: [GIFTCARD-01]

duration: ~20min
completed: "2026-06-29"
---

# Phase 44 Plan 10: Gift Cert Cart+Terminal Frontend Fix (G-44-01) Summary

**Issue/Reload Gift Card modal now adds a gift_cert cart line on both kiosk.js + admin.js (D-08), flowing through the real Helcim terminal checkout — no more direct POST to the decommissioned /issue or /reload routes; activation-failure alert surfaces on both surfaces (T-44-G11).**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-06-29
- **Tasks:** 3 (Tasks 1+2+3 committed atomically — single working commit)
- **Files modified:** 4 source + 18 build artifacts (HTML cache stamps, min bundles)

## Accomplishments

- Reworked `kioskSubmitGiftCardIssue` (kiosk.js) and `kioskSubmitAdminGiftCardIssue` (admin.js): no longer POST to `/api/kiosk/gift-card/issue` or `/reload` (decommissioned in 44-09). Instead, adds a gift_cert cart line that flows through the normal terminal checkout.
- Reload mode performs a GET `/api/kiosk/gift-card/lookup` pre-check before adding the line; rejects unknown or non-active certs with an inline modal error message.
- `_kioskGiftCertCounter` added on both surfaces for unique `'giftcert-N'` cart key generation.
- Discount skip guard extended to `custom || gift_cert` on kiosk.js (admin.js has no discount feature).
- `kioskRenderCart` renders gift_cert lines with fixed qty=1, no qty stepper, and a remove button on both surfaces. Remove button wired via `addEventListener` on `.kiosk-cart-remove-btn`.
- `kioskProceedToPayment` items map emits `{ gift_cert, gift_action, cert_number, quantity:1, rate }` on kiosk.js; `_adminDoSale` items map does the same on admin.js.
- `gift_card_activation_failed` blocking `alert()` added in `handleSaleResult` (kiosk.js) and both 201-success paths in `_adminDoSale` (admin.js) — staff sees cert number(s) and must dismiss before post-sale cleanup.
- `npm run build` rebuilt js/kiosk.min.js + js/admin.min.js; both contain `gift_cert` wiring. All 928 frontend + 1033 middleware tests green, lint 0 errors.

## Task Commits

1. **Tasks 1+2+3 (kiosk.js modal + admin.js parity + bundles)** — `04e42d6` (feat)

## Files Created/Modified

- `js/kiosk.js` — `_kioskGiftCertCounter`, reworked `kioskSubmitGiftCardIssue`, discount guard, render loop, items map, `handleSaleResult` alert
- `js/admin.js` — `_kioskGiftCertCounter`, reworked `kioskSubmitAdminGiftCardIssue`, render loop + remove wiring, items map, `_adminDoSale` alert (2 paths)
- `js/kiosk.min.js` — rebuilt (terser)
- `js/admin.min.js` — rebuilt (terser)
- 18 HTML files — cache-busting `?v=` stamps updated by `npm run build`

## Decisions Made

- `alert()` chosen for activation-failure alert (native blocking dialog, no custom CSS needed, guaranteed to block flow until dismissed; staff cannot accidentally skip it)
- `_kioskGiftCertCounter` is separate from `_kioskCustomCounter` to keep semantics clear and avoid future key collisions if custom vs. gift_cert lines coexist
- admin.js `gift_card_activation_failed` check added in both confirm paths (gift-card-only and direct 201) for defensive coverage even though the flag currently only flows from the /confirm endpoint
- admin.js lookup call in the submit function uses `SHEETS_CONFIG.MW_API_KEY || ''` (consistent with the admin kiosk's other confirm/sale API calls)

## Deviations from Plan

### Auto-fixed Issues

None — all plan actions executed as specified.

### Notes on Plan Spec vs. Implementation

**admin.js discount skip guard:** The plan mentions "the admin discount-skip guard gains `|| entry.item.gift_cert`". Admin.js does not have a discount feature (`_kioskDiscount` is absent from admin.js; `kioskCalcTotals` has no discount logic). No guard to add. Since `tax_percentage: 0` on gift_cert lines already yields $0 tax, and there is no discount path in admin.js, this has no functional impact.

## Known Stubs

None — gift_cert lines flow to the real terminal checkout (44-09 activates the cert on payment success). The /lookup pre-check calls the live middleware endpoint.

## Threat Model Coverage

| Threat | Mitigation | Status |
|--------|-----------|--------|
| T-44-G7: client tampers gift_cert rate/cert | Server (44-09) re-validates cert format + rate + forces item_id | 44-09 complete |
| T-44-G8: premature 'issued' feedback | Modal no longer toasts success on add; cert real only after terminal + confirm | Implemented |
| T-44-G9: 44-07 redeem/mgmt regression | gift_cert line is additive; kgcr-* and kgcm-* wiring untouched; 928 tests green | Verified |
| T-44-G10: stale build artifact | Bundles rebuilt via npm run build; grep confirms gift_cert in both min files | Verified |
| T-44-G11: post-payment activation failure | Blocking alert() with cert number(s) in handleSaleResult (kiosk.js) and _adminDoSale (admin.js, D-08) | Implemented |
| T-44-SC: npm installs | No new packages added | N/A |

## Threat Flags

None — no new network endpoints or auth paths. The /lookup call in reload mode is read-only and was already used by the 44-07 redeem panel.

## Self-Check: PASSED

- FOUND: `js/kiosk.js` — `grep -c gift_cert js/kiosk.js` = 10; `grep -c gift_card_activation_failed js/kiosk.js` = 1
- FOUND: `js/admin.js` — `grep -c gift_cert js/admin.js` = 10; `grep -c gift_card_activation_failed js/admin.js` = 2
- FOUND: `js/kiosk.min.js` — `grep -c gift_cert js/kiosk.min.js` = 1
- FOUND: `js/admin.min.js` — `grep -c gift_cert js/admin.min.js` = 1
- VERIFIED: No `/api/kiosk/gift-card/issue` or `/api/kiosk/gift-card/reload` calls in kiosk.js or admin.js submit functions
- VERIFIED: Frontend tests: 928 passed, 49 suites, 0 failures
- VERIFIED: Middleware tests: 1033 passed, 47 suites, 0 failures
- VERIFIED: Lint: 0 errors
- FOUND: commit `04e42d6`

---
*Phase: 44-kiosk-gift-card-certificate-lifecycle*
*Plan: 10*
*Completed: 2026-06-29*
