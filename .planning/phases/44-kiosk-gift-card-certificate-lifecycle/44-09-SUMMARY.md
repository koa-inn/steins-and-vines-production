---
phase: 44-kiosk-gift-card-certificate-lifecycle
plan: "09"
subsystem: middleware
tags: [gift-cards, pos, cart, terminal, activation, idempotency, security, money-path, tdd]

requires:
  - phase: 44-04
    provides: "split-tender confirm chain + void-on-failure + redeem_gift_card LAST-step pattern"
  - phase: 44-02
    provides: "Apps Script issue_gift_card / reload_gift_card / update_gift_card_invoice actions"

provides:
  - "gift_cert cart line in /api/kiosk/sale + /confirm: server-priced from KIOSK_GIFT_CARD_ITEM_ID, zero-tax (D-03)"
  - "issue_gift_card + reload_gift_card called LAST in confirm chain after invoice + customerpayments (T-44-G3)"
  - "update_gift_card_invoice called after successful issue_gift_card (links Sheets row to cart invoice)"
  - "activation failure: 201 with gift_card_activation_failed:true + needs_manual_review:true + CRITICAL log (T-44-G11)"
  - "confirm-level Redis idempotency (KIOSK_IDEM_PREFIX+'confirm:'+key): no double invoice / double activation (T-44-G2)"
  - "fail-closed 503 in sale + confirm when KIOSK_GIFT_CARD_ITEM_ID unset (T-44-G4)"
  - "phantom-payment /issue + /reload routes decommissioned; lookup/next-number/void retained"
  - "1033 middleware tests passing; 44-04 redeem path unchanged + green"

affects:
  - "44-10 (frontend): reads gift_card_activation_failed + needs_manual_review from confirm 201"
  - "44-04 (redeem path): preserved, unmodified, all tests green"

tech-stack:
  added: []
  patterns:
    - "gift_cert line: gift_cert:true flag in body.items; server-authoritative item_id (KIOSK_GIFT_CARD_ITEM_ID); no tax_id; qty forced 1"
    - "runConfirm() extraction: confirm idempotency check wraps full confirm body (mirrors sale handler pattern)"
    - "LAST-STEP extension: redeem_gift_card (existing) → issue/reload_gift_card (new) — sequential promise chain"
    - "giftCardActivationFailed closure variable: set inside last-step, surfaces in 201 body"
    - "zohoLineItems: strips internal gift_cert/gift_action/cert_number flags before Zoho invoice payload"
    - "resolveDiscount: gift_cert lines excluded from all discount scopes (D-08 extension)"

key-files:
  created:
    - ".planning/phases/44-kiosk-gift-card-certificate-lifecycle/44-09-SUMMARY.md"
  modified:
    - "zoho-middleware/routes/pos.js"
    - "zoho-middleware/routes/gift-cards.js"
    - "zoho-middleware/server.js"
    - "zoho-middleware/__tests__/pos-gift-card.test.js"
    - "zoho-middleware/__tests__/gift-cards.test.js"

key-decisions:
  - "giftCardActivationFailed closure variable preferred over promise rejection for activation failures — invoice is paid; error must not propagate to outer catch (which triggers void)"
  - "zohoLineItems mapper strips gift_cert internal flags before Zoho invoice — Zoho ignores unknown fields but clean payload is safer"
  - "resolveDiscount gift_cert exclusion added as Rule 2 (correctness) — discounting a gift cert face value would be semantically wrong"
  - "runConfirm() function extracted to allow idempotency guard to wrap entire confirm body cleanly"
  - "Sequential last-step chaining (redeem → issue/reload) keeps LAST-STEP ordering deterministic without Promise.all races"

requirements-completed: [GIFTCARD-01]

duration: ~35min
completed: "2026-06-29"
---

# Phase 44 Plan 09: Gift Cert Cart+Terminal Fix (G-44-01 Gap Closure) Summary

**G-44-01 closed: gift cert issue/reload now flow through real Helcim terminal cart checkout; no phantom creditcard customerpayment is created without a real charge; cert is activated post-payment; 1033 middleware tests green.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-06-29T21:54:16Z
- **Tasks:** 3 (Task 1: pricing TDD; Task 2: activation + idempotency TDD; Task 3: decommission)
- **Files modified:** 3 (`routes/pos.js`, `routes/gift-cards.js`, `server.js`)
- **Files modified (tests):** 2 (`__tests__/pos-gift-card.test.js`, `__tests__/gift-cards.test.js`)
- **Test delta:** +24 tests (1009 → 1033 middleware; 18 new pricing/activation/idempotency tests)

## Accomplishments

### Task 1: gift_cert line pricing in pos.js (sale + confirm)

**Both `processSale` and `runConfirm` (confirm handler) now handle gift_cert lines:**

- **Structural validation loop**: `if (vi.gift_cert) continue;` added alongside custom line skip
- **Fail-closed guard (T-44-G4)**: if any `item.gift_cert===true` and `KIOSK_GIFT_CARD_ITEM_ID` unset → 503
- **validate-before-map**: cert_number `/^GC-\d{6}$/` + rate `(0, 2000]` validated before `lineItems.map()`
- **lineItems builder gift_cert branch**: `item_id: process.env.KIOSK_GIFT_CARD_ITEM_ID` (T-44-G1 — client `item_id` ignored), `name: 'Gift Certificate '+cert` or `'Gift Certificate Reload '+cert`, `quantity: 1`, `rate` from request, **no `tax_id`** (D-03)
- **computeTax**: `if (li.gift_cert) { return; }` — zero-tax short-circuit; prevents undefined catalog lookup
- **zohoLineItems mapper**: strips `gift_cert`, `gift_action`, `cert_number` internal flags before Zoho invoice payload
- **resolveDiscount** (Rule 2 extension): `li.custom || li.gift_cert` exclusion in all three discount scope loops

### Task 2: cert activation + confirm idempotency in pos.js

**`runConfirm()` function extracted from `router.post` callback:**

Idempotency check at entry:
```
KIOSK_IDEM_PREFIX + 'confirm:' + key.slice(0,128)  → cache.get → return cached 201 if hit
```

**LAST STEP extended** (all Apps Script calls in single promise chain after invoice + customerpayments):
1. **redeem_gift_card** (existing 44-04, unchanged)
2. **For each `lineItems.filter(li => li.gift_cert)`:**
   - `gift_action==='issue'`: `axios.post issue_gift_card` → if ok: `axios.post update_gift_card_invoice` + `eventLog`; if non-ok/throw: `giftCardActivationFailed = true` + CRITICAL log
   - `gift_action==='reload'`: `axios.post reload_gift_card` → if ok: `eventLog`; if non-ok/throw: `giftCardActivationFailed = true` + CRITICAL log

**201 result surfacing:**
```js
if (giftCardActivationFailed) {
  result.gift_card_activation_failed = true;
  result.needs_manual_review = true;
}
```
Followed by idempotency cache write, then `res.status(201).json(result)`.

**Void-on-failure outer catch unaffected:** invoice failure still voids terminal + returns 502; `issue_gift_card` is NEVER called in this path (T-44-G3 — ordering correct).

### Task 3: decommission phantom-payment issue/reload routes

- Removed `router.post('/api/kiosk/gift-card/issue', ...)` — 127-line handler with Zoho invoice + phantom `creditcard` customerpayment (the G-44-01 defect)
- Removed `router.post('/api/kiosk/gift-card/reload', ...)` — 118-line handler with same defect
- Removed `app.use('/api/kiosk/gift-card/issue', paymentLimiter)` from server.js
- Removed `app.use('/api/kiosk/gift-card/reload', paymentLimiter)` from server.js
- Removed `zohoPost` import from gift-cards.js (no longer used)
- Removed 37 issue/reload test cases from gift-cards.test.js (per plan explicit instruction)
- Lookup, next-number, void routes + `callAppsScript` helper preserved

## Task Commits

| Task | Commit | Type |
|------|--------|------|
| Task 1 RED | `411c2dd` | test — add failing tests for gift_cert line pricing |
| Task 1 GREEN | `3dbe3f6` | feat — implement gift_cert line pricing in pos.js |
| Task 2 RED | `cea83eb` | test — add failing tests for activation + idempotency |
| Task 2 GREEN | `0663dd2` | feat — add cert activation + confirm idempotency to pos.js |
| Task 3 | `ee738fb` | feat — decommission phantom-payment issue/reload routes |

## Deviations from Plan

### Auto-fixed (Rule 2): resolveDiscount gift_cert exclusion

**Found during:** Task 1 implementation
**Issue:** `resolveDiscount` iterated all lineItems and applied discounts. A gift_cert line with `gift_cert:true` and no `catalogMap` entry would reach the `discountMatch.classifyCatalogItem(catalogMap[li.item_id])` call with `undefined`. More importantly, discounting a gift cert face value would be semantically wrong — a discount on goods should not reduce the face value of a certificate.
**Fix:** Added `|| li.gift_cert` to all three `li.custom` exclusion guards in `resolveDiscount` (cart scope ×2, type scope ×1).
**Files modified:** `zoho-middleware/routes/pos.js`
**Commit:** `3dbe3f6`

## Threat Model Coverage

| Threat | Mitigation | Status |
|--------|-----------|--------|
| T-44-G1: client tampers item_id | Server forces KIOSK_GIFT_CARD_ITEM_ID; client item_id ignored | Implemented + tested |
| T-44-G2: replay double-activation | KIOSK_IDEM_PREFIX+'confirm:'+key; cached 201 returned | Implemented + tested |
| T-44-G3: activation ordering | issue/reload called LAST after invoice + customerpayments | Implemented + tested |
| T-44-G4: missing item config | 503 fail-closed in sale + confirm when item ID unset | Implemented + tested |
| T-44-G5: 44-04 redeem regression | gift_cert LINE orthogonal to gift_card TENDER; both work in same cart | Tested (combo test) |
| T-44-G6: zero-tax accounting | No tax_id on gift_cert line; computeTax short-circuit | Implemented + tested |
| T-44-G11: activation failure | 201 + gift_card_activation_failed + needs_manual_review + CRITICAL log | Implemented + tested |

## Known Stubs

None — all confirmation paths make real Apps Script and Zoho calls.

## Threat Flags

None — no new network endpoints or auth paths beyond what the plan documents. All Apps Script calls follow the established `server_token` pattern.

## Self-Check: PASSED

- FOUND: `zoho-middleware/routes/pos.js` (grep confirms gift_cert, KIOSK_GIFT_CARD_ITEM_ID, giftCardActivationFailed, runConfirm, confirmIdemKey)
- FOUND: `zoho-middleware/routes/gift-cards.js` (lookup, next-number, void routes present; issue/reload removed)
- FOUND: `zoho-middleware/server.js` (no paymentLimiter mounts for gift-card/issue or gift-card/reload)
- FOUND: `zoho-middleware/__tests__/pos-gift-card.test.js` (29 tests)
- FOUND: `zoho-middleware/__tests__/gift-cards.test.js` (issue/reload cases removed; void/lookup/next-number cases remain)
- FOUND: commits `411c2dd`, `3dbe3f6`, `cea83eb`, `0663dd2`, `ee738fb`
- Full middleware suite: 1033 tests, 47 suites, all passing
- Lint: 0 errors
- grep: `grep -nE "gift-card/issue|gift-card/reload" routes/gift-cards.js server.js` → only comments, no active routes

---
*Phase: 44-kiosk-gift-card-certificate-lifecycle*
*Plan: 09*
*Completed: 2026-06-29*
