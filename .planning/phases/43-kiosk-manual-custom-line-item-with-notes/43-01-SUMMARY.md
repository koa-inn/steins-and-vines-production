---
phase: 43-kiosk-manual-custom-line-item-with-notes
plan: "01"
subsystem: middleware/kiosk-pos
tags: [tdd, money-path, kiosk, custom-line, gst, pos]
dependency_graph:
  requires: []
  provides: [custom-line-server-acceptance, gst-tax-resolution, discount-skip-d08]
  affects: [zoho-middleware/routes/pos.js]
tech_stack:
  added: []
  patterns: [fail-closed-gst, resolveGstTaxId, computeTax-custom-branch, catalog-bypass-guard]
key_files:
  created:
    - zoho-middleware/__tests__/pos-custom-line.test.js
  modified:
    - zoho-middleware/routes/pos.js
decisions:
  - resolveGstTaxId resolution order: env KIOSK_GST_TAX_ID -> catalog auto-discover (sales_tax_rule_id match) -> fail-closed with 400
  - GST pre-resolution happens before the lineItems .map() in both /sale and /confirm to avoid returning inside .map()
  - Custom line Zoho shape: { description, rate, quantity, tax_id? } with no item_id/sku (mirrors /api/pos/sale legacy shape)
  - D-08 skip in resolveDiscount: custom branch in type-scope matchFlags.map returns false; cart-scope forEach returns early
metrics:
  duration: "~25 min"
  completed_date: "2026-06-27"
  tasks_completed: 2
  files_changed: 2
---

# Phase 43 Plan 01: Custom Line Item Server Path Summary

Server-side custom-line acceptance in `routes/pos.js` with fail-closed GST tax-id resolution, bounded pricing, note-to-description shaping, and discount exclusion — implemented test-first (TDD RED/GREEN).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Write failing custom-line regression suite (RED) | d75528d | zoho-middleware/__tests__/pos-custom-line.test.js |
| 2 | Implement custom-line path in routes/pos.js (GREEN) | 1e98888 | zoho-middleware/routes/pos.js |

## What Was Built

### `resolveGstTaxId(catalogMap)` (new top-level helper, exported)
Resolution order (D-02):
1. Return `process.env.KIOSK_GST_TAX_ID` if set (env override)
2. Scan `catalogMap` for any item whose `sales_tax_rule_id === ZOHO_TAX_SERVICES_RULE` and return its `tax_id`
3. Return `null` — caller fail-closes with a 400 error

### `computeTax` patch
Added `if (li.custom)` branch at the top of the forEach, before `catalogMap[li.item_id]` is dereferenced. Custom lines carry `li.tax_percentage` (5 for taxable, 0 for exempt) so existing tax math works unchanged once the catalog lookup is skipped.

### `resolveDiscount` patch (D-08)
- Type-scope `matchFlags.map`: `if (li.custom) return false;` before `classifyCatalogItem`
- Cart-scope `percentage` forEach: `if (li.custom) return;`
- Cart-scope `fixed` forEach: `if (li.custom) return;`

### `/api/kiosk/sale` structural validation loop
Custom-line branch: validates `description` (1-100 chars after trim), `rate` (finite, `abs(rate) <= 10000`), `quantity` (integer 1-100). Pre-existing catalog-item validation skipped via `continue`.

### `/api/kiosk/sale` catalog-rejection loop
Added `if (cItem.custom) continue;` — custom lines have no `item_id` and bypass the catalog check.

### `/api/kiosk/sale` lineItems builder
Pre-resolves GST tax_id once before the `.map()` (fail-closed if taxable custom exists but no GST tax_id found). Custom-line branch: uses staff-entered `rate` (already bounded), builds `{ custom, description, rate, quantity, tax_percentage, tax_id? }`. Description shaping: `"<Description> — <Note>"` or `"<Description>"` when note blank. Control chars stripped, capped to 100 chars (T-43-04).

### `/api/kiosk/sale/confirm` — parallel guards
Identical catalog-rejection skip and lineItems builder custom-line branch. Same GST pre-resolution pattern.

### Exports
`module.exports.resolveGstTaxId = resolveGstTaxId;` added.

## Test Suite: `pos-custom-line.test.js`

20 tests across 8 describe blocks, all GREEN:

| Case | Behavior Verified |
|------|-------------------|
| Taxable custom line grandTotal | rate*qty*1.05 pushed to terminal |
| Custom line bypasses catalog check | sale accepted with empty catalog when KIOSK_GST_TAX_ID set |
| Tax-exempt grandTotal | rate*qty only (no tax) |
| Fail-closed GST | 400 returned, terminalPurchase NOT called |
| GST auto-discovery | Zoho line gets `tax_id` from catalog item with matching `sales_tax_rule_id` |
| KIOSK_GST_TAX_ID env override | Zoho line gets `tax_id` from env var, catalog not needed |
| Tax-exempt Zoho line | `tax_id` undefined on the invoice line |
| Description + note shaping | "Repair — broke airlock" |
| Blank note shaping | "Labour" |
| Negative rate + positive grandTotal | accepted, terminal sees correct total |
| Net-zero/negative grandTotal | rejected by existing guard ("greater than zero") |
| rate > 10000 | rejected before terminal charge |
| rate < -10000 | rejected before terminal charge |
| Missing description | 400 |
| Description > 100 chars | 400 |
| Quantity 0 | 400 |
| Quantity 101 | 400 |
| Non-numeric rate | 400 |
| Type-scope discount D-08 skip | custom line `discount` undefined, subtotal unaffected |
| Cart-scope discount D-08 skip | custom line `discount` undefined |

## Deviations from Plan

None — plan executed exactly as written.

## Threat Flags

No new network endpoints or auth paths introduced. The custom-line path uses the existing `/api/kiosk/sale` and `/api/kiosk/sale/confirm` endpoints. All STRIDE mitigations from the plan's threat model were implemented:

- T-43-01: rate magnitude cap (abs <= 10000) in structural validation loop
- T-43-02: computeTax custom branch + resolveGstTaxId fail-closed (charge == invoice tax guaranteed)
- T-43-03: client `item_id`/`tax_id` ignored for custom lines; tax_id server-resolved only
- T-43-04: control-char strip + 100-char cap on description/note before Zoho submission

## Self-Check: PASSED

- FOUND: `zoho-middleware/__tests__/pos-custom-line.test.js`
- FOUND: `zoho-middleware/routes/pos.js`
- FOUND: commit `d75528d` (test RED)
- FOUND: commit `1e98888` (feat GREEN)
- All 969 middleware tests pass (`npm test`)
- Lint exits 0 errors (57 pre-existing warnings, unchanged)
