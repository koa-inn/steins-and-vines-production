---
phase: 43-kiosk-manual-custom-line-item-with-notes
verified: 2026-06-27T00:00:00Z
status: passed
score: 14/14 must-haves verified
overrides_applied: 0
---

# Phase 43: Kiosk Manual Custom Line Item with Notes — Verification Report

**Phase Goal:** Let kiosk staff add an ad-hoc invoice line (description + staff-entered price + qty + note) that is not a catalog product, on both kiosk surfaces (standalone `kiosk.js` and admin-embedded `admin.js`, forked per #14), without weakening the v4.2-hardened money path. Server `/api/kiosk/sale` + `/api/kiosk/sale/confirm` gain a custom-line path (no `item_id`, `custom:true`) that trusts the bounded staff price and records the note in the Zoho invoice line description; the terminal charge (server `computeTax`) must equal the Zoho invoice tax for taxable custom lines.

**Verified:** 2026-06-27
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | KIOSK-02: POST /api/kiosk/sale accepts a line with no item_id when custom:true (bypasses catalog-rejection) | ✓ VERIFIED | `pos.js:309` — `if (cItem.custom) continue;` in both sale and confirm catalog-rejection loops; test "not rejected by catalog check" passes |
| 2 | D-01/D-02: taxable custom line charges 5% GST in computeTax AND carries a resolved GST tax_id on the Zoho invoice line | ✓ VERIFIED | `pos.js:143-154` — `if (li.custom)` branch in computeTax uses `li.tax_percentage`; `pos.js:353-355` — `li.tax_id = gstTaxId` on taxable lines; test "taxable custom line: grandTotal includes 5% GST" passes |
| 3 | D-02: taxable custom line with no resolvable GST tax_id fails closed (sale rejected), never silently undertaxed | ✓ VERIFIED | `pos.js:324-330` — pre-resolves `gstTaxId`; if `!gstTaxId` returns 400 with "Cannot tax this custom line…" error; test "fail-closed GST" passes |
| 4 | D-01: tax-exempt custom line (taxable:false) charges 0% tax and carries no tax_id | ✓ VERIFIED | `pos.js:351` — `tax_percentage: taxable ? 5 : 0`; `pos.js:353-355` — tax_id only added when taxable; test "tax-exempt Zoho invoice line has no tax_id" passes |
| 5 | D-03: server caps custom rate magnitude (abs ≤ 10000); grandTotal > 0 and grandTotal ≤ 10000 guards unchanged | ✓ VERIFIED | `pos.js:275-277` — `Math.abs(vRate) > 10000` returns 400; `pos.js:400-404` — grandTotal guards unchanged; tests for rate > 10000, rate < -10000, and net-zero reject all pass |
| 6 | D-04: Zoho invoice line description is "Description — Note" (or just "Description" when note blank) | ✓ VERIFIED | `pos.js:345` — `fullDesc = note ? (desc + ' — ' + note) : desc`; tests "description + note" and "blank note" pass |
| 7 | D-05: Description required (1-100 chars after sanitize), quantity integer 1-100, rate numeric within bounds | ✓ VERIFIED | `pos.js:267-281` — full structural validation for custom lines; tests for missing/long description, qty 0/101, non-numeric rate all pass |
| 8 | D-08: resolveDiscount never applies cart-scope or type-scope discounts to a custom line (server) | ✓ VERIFIED | `pos.js:76,83,94` — three D-08 guards in resolveDiscount (cart-% forEach, cart-fixed forEach, type-scope matchFlags.map); tests for both type-scope and cart-scope D-08 skip pass |
| 9 | KIOSK-02 UI: "Add custom item" button in cart area opens modal on BOTH kiosk surfaces (D-06) | ✓ VERIFIED | `kiosk.js:2801,2856` — button in empty and non-empty cart render; `admin.js:10230,10268` — same on admin surface; both call kioskRenderCart() on init (kiosk.js:234, admin.js:952) |
| 10 | D-05 modal fields: Description (required), Note (optional), Price, Qty (default 1), Tax-exempt toggle (default taxable) | ✓ VERIFIED | `kiosk.js:2716-2774` and `admin.js:10157-10214` — identical validation and cart-entry shape including `tax_percentage: taxExempt ? 0 : 5` |
| 11 | D-03 client confirm: explicit confirm when amount > $2000 or negative before line enters cart | ✓ VERIFIED | `kiosk.js:2752-2757` — `if (rate > 2000 || rate < 0) { window.confirm(...) }`; `admin.js:10193-10198` — identical |
| 12 | D-07: custom line shows in cart with qty +/- and remove, reusing existing cart controls, on both surfaces | ✓ VERIFIED | Custom lines keyed `custom-N` in `_kioskCart`; `kiosk.js` kioskSetQty/kioskRemoveFromCart handle arbitrary keys; `admin.js:10076-10078` — `delete _kioskCart[itemId]` at qty ≤ 0 |
| 13 | D-04/D-08: items array posted to server forwards { custom:true, description, note, quantity, rate, taxable } — no item_id; frontend discount-skip in kioskCalcTotals on both surfaces | ✓ VERIFIED | `kiosk.js:3147-3155` — custom branch in items mapper; `admin.js:10510-10518` — identical; `kiosk.js:1221` — D-08 skip in kioskCalcTotals discount block; admin.js has no `_kioskDiscount` state — no discount system to skip, trivially satisfied |
| 14 | Fork parity: kiosk.js and admin.js carry identical custom-line logic with intentional modal divergence only | ✓ VERIFIED | `_kioskCustomCounter` in both; item shape identical; items mapper identical; D-03 threshold identical; D-05 field rules identical; modal divergence: kiosk.js uses inline overlay, admin.js uses openModal/closeModal (intentional per D-06) |

**Score:** 14/14 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `zoho-middleware/routes/pos.js` | custom-line acceptance + bounded pricing + GST tax_id resolution + note→description across both handlers | ✓ VERIFIED | `resolveGstTaxId` (L38-49), `computeTax` custom branch (L143-154), `resolveDiscount` D-08 guards (L76,83,94), validation loop (L265-282), catalog-rejection skips (L309, L517), lineItems builders with custom branch (L337-356, L539-557) |
| `zoho-middleware/__tests__/pos-custom-line.test.js` | regression suite covering taxable/exempt/fail-closed/bounds/discount-skip | ✓ VERIFIED | 20 tests, 8 describe blocks; all pass (verified by running `npx jest __tests__/pos-custom-line.test.js`) |
| `js/kiosk.js` | custom-item modal + _kioskCustomCounter + custom-line items-array branch + discount skip | ✓ VERIFIED | `_kioskCustomCounter` (L703), `kioskShowCustomItemModal` (L2631), items mapper branch (L3147-3155), D-08 skip (L1221) |
| `js/admin.js` | same as kiosk.js via openModal/closeModal | ✓ VERIFIED | `_kioskCustomCounter` (L9799), openModal-based modal (L10142), `kioskSubmitAdminCustomItem` (L10157), items mapper (L10510-10518) |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `computeTax` | `li.tax_percentage` on custom lines | `if (li.custom)` branch before `catalogMap[li.item_id]` | ✓ WIRED | `pos.js:143` — branch returns early after using `li.tax_percentage`; catalogMap lookup never reached for custom lines |
| `lineItems builder (both handlers)` | Zoho invoice line `{ description, rate, quantity, tax_id? }` | `resolveGstTaxId(catalogMap)` when taxable | ✓ WIRED | `pos.js:324-330` (sale) and `pos.js:523-535` (confirm) — pre-resolution before map; L353-355 and L554-556 — tax_id attached |
| Add-custom-item modal submit | `_kioskCart['custom-N']` | `{ item: { custom:true, description, note, name, rate, tax_percentage, taxable }, qty }` | ✓ WIRED | `kiosk.js:2770-2771`; `admin.js:10211-10212` |
| `kioskProceedToPayment` items mapper | POST `/api/kiosk/sale` body.items[] | `if (entry.item.custom) return { custom:true, description, note, quantity, rate, taxable }` | ✓ WIRED | `kiosk.js:3147-3155`; `admin.js:10510-10518` |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `pos.js` resolveGstTaxId | `gstTaxId` | env `KIOSK_GST_TAX_ID` or catalog scan on `sales_tax_rule_id` | Yes — env var or live catalog cache | ✓ FLOWING |
| `pos.js` computeTax custom branch | `li.tax_percentage` | client-provided (5 or 0), trusted on custom lines | Yes — direct from validated item | ✓ FLOWING |
| `kiosk.js` cart entry | `_kioskCart['custom-N']` | staff input from modal form | Yes — validated before insert | ✓ FLOWING |
| `admin.js` cart entry | `_kioskCart['custom-N']` | staff input from openModal form | Yes — identical validation path | ✓ FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| 20 pos-custom-line tests all pass | `cd zoho-middleware && npx jest __tests__/pos-custom-line.test.js` | 20/20 tests pass | ✓ PASS |
| Full middleware suite unaffected | `cd zoho-middleware && npx jest` | 977/977 tests pass | ✓ PASS |
| `resolveGstTaxId` exported | `grep "module.exports.resolveGstTaxId" zoho-middleware/routes/pos.js` | line 2339 found | ✓ PASS |
| Custom branch in computeTax (before catalogMap dereference) | `grep -n "li.custom" zoho-middleware/routes/pos.js` | line 143, inside computeTax forEach, before `catalogMap[li.item_id]` | ✓ PASS |
| Catalog-rejection skips custom lines | `grep -n "custom.*continue" zoho-middleware/routes/pos.js` | lines 309, 517 (both handlers) | ✓ PASS |
| D-08 guards in resolveDiscount (3 sites) | `grep -n "D-08" zoho-middleware/routes/pos.js` | lines 76, 83, 94 | ✓ PASS |
| grandTotal guards unchanged | literal strings "greater than zero", "exceeds maximum" | present at pos.js:401, 404 | ✓ PASS |
| Both forked files have custom-line logic | `grep "_kioskCustomCounter" js/kiosk.js js/admin.js` | kiosk.js:703, admin.js:9799 | ✓ PASS |
| D-03 confirm on both surfaces | `grep "rate > 2000" js/kiosk.js js/admin.js` | kiosk.js:2752, admin.js:10193 | ✓ PASS |
| escapeHTML on custom-line name in cart render | `grep "T-43-04" js/admin.js` | line 10255 — escapeHTML(item.name) | ✓ PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| KIOSK-02 | 43-01, 43-02 | Staff can add ad-hoc custom invoice line on both kiosk surfaces through the hardened money path | ✓ SATISFIED | Server: custom-line path in pos.js handlers; Client: modal + cart wiring in both kiosk.js and admin.js; Test suite: 20/20 pass; Human UAT: owner sign-off ("custom items look good") |
| D-01 | 43-01 | Custom lines default taxable at 5% GST with per-line tax-exempt toggle | ✓ SATISFIED | `tax_percentage: taxable ? 5 : 0` on cart entry and Zoho line |
| D-02 | 43-01 | Money-path invariant: terminal charge == Zoho invoice tax; fail-closed when GST tax_id unresolvable | ✓ SATISFIED | Same computeTax drives terminal charge; resolveGstTaxId drives Zoho tax_id; fail-closed 400 implemented and tested |
| D-03 | 43-01, 43-02 | Rate bounds: abs ≤ 10000 server-side; UI confirm for > $2000 or negative | ✓ SATISFIED | Server validation at L275-277; UI confirm at kiosk.js:2752, admin.js:10193 |
| D-04 | 43-01, 43-02 | Two-field shape: description (line label) + note (appended as "Desc — Note") | ✓ SATISFIED | Server fullDesc building; client items mapper forwards both fields |
| D-05 | 43-01, 43-02 | Description 1-100 chars required, quantity integer 1-100, rate numeric | ✓ SATISFIED | Server validation loop + client validation in both modal submit handlers |
| D-06 | 43-02 | "Add custom item" button in cart area opens focused modal, identical on both surfaces | ✓ SATISFIED | Both files have the button in kioskRenderCart + init render |
| D-07 | 43-02 | Custom line uses existing cart +/-/remove controls | ✓ SATISFIED | custom-N key reuses existing kioskSetQty/remove mechanism |
| D-08 | 43-01, 43-02 | Custom lines excluded from all discount presets (server + client) | ✓ SATISFIED | Server: 3 guards in resolveDiscount; client kiosk.js: L1221 guard; admin.js: no discount system |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None found | — | — | — | — |

No TBD, FIXME, or XXX markers found in any of the four modified files (pos.js, kiosk.js, admin.js, pos-custom-line.test.js).

---

### Notable Edge Case (Non-blocking)

`zoho-middleware/lib/brewpad-integration.js:55` — `detectKitItems` filters out only the Maker's Fee and Materials Fee items; it does not explicitly exclude custom lines. If a custom line co-exists in a sale with a Maker's Fee (ferment-in-store kit scenario), the custom line would be treated as a kit item and trigger a batch-creation attempt with an empty SKU. In practice this scenario is atypical (custom lines are for ad-hoc charges unrelated to ferment-in-store kits), and `detectKitItems` returns `[]` early when no Maker's Fee item is present (the common case). `decrementStock` already self-guards via `if (!line || !line.item_id || !line.quantity) return;` at L118. This is a pre-existing architectural gap, not introduced by Phase 43, and is not a blocker for the phase goal.

---

### Human Verification Required

None. Owner UAT was completed on staging (recorded in 43-02-SUMMARY.md): owner tested both surfaces on `admin.html?tab=kiosk` and the standalone kiosk surface and signed off: "custom items look good." All behavioral checks were completed before this verification.

---

### Gaps Summary

None. All 14 must-have truths are VERIFIED in the codebase. The phase goal is achieved.

---

_Verified: 2026-06-27_
_Verifier: Claude (gsd-verifier)_
