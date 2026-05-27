---
status: human_needed
phase: 02-sales-order-integrity
verified: "2026-04-28"
score: 4/4
human_verification_count: 5
---

# Phase 2: Sales Order Integrity — Verification

## Success Criteria

| # | Criterion | Automated | Status |
|---|-----------|-----------|--------|
| SC-1 | Kiosk sale creates invoice with correct line items (SKUs, quantities, prices) | ✓ Code verified: `tax_id` on line items (pos.js:159, 529) | PASS |
| SC-2 | Tax matches Zoho tax rules per item | ✓ Code verified: per-item `tax_percentage` with fallback (pos.js:168-176, 616-632) | PASS |
| SC-3 | Failed Zoho + void = staff notification | ✓ Code verified: `payment_voided` check + full-screen error (kiosk.js:1997, 2686) | PASS |
| SC-4 | Post-sale stock refresh without manual bust | ✓ Code verified: `kioskLoadProducts(true)` on both Done handlers (kiosk.js:2180, 2668) | PASS |

## Must-Have Artifacts

| Artifact | Exists | Contains Expected Pattern |
|----------|--------|--------------------------|
| zoho-middleware/routes/pos.js | ✓ | `tax_id` (9 occurrences), `invoices/fromsalesorder` |
| zoho-middleware/__tests__/pos-tax.test.js | ✓ | 8 test cases covering per-item tax and SO-to-Invoice |
| js/kiosk.js | ✓ | `payment_voided`, `kioskLoadProducts(true)`, `stock < 0` |
| kiosk.html | ✓ | `kiosk-error-detail` element |
| js/kiosk.min.js | ✓ | Rebuilt after changes |

## Key Links

| From | To | Via | Verified |
|------|----|-----|----------|
| pos.js | KIOSK_PRODUCTS cache | `catalogMap[item.item_id].tax_id` | ✓ |
| pos.js | Zoho Books API | `zohoPost('/invoices/fromsalesorder')` | ✓ |
| kiosk.js | Backend 502 response | `result.data.payment_voided` | ✓ |
| kiosk.js | Product reload | `kioskLoadProducts(true)` | ✓ |

## Test Results

- **Middleware:** 382/382 passed (including 8 new pos-tax tests)
- **Frontend:** 254/254 passed
- **Lint:** 0 errors (79 pre-existing warnings)

## Security Threat Mitigations

| Threat | Mitigation | Verified |
|--------|------------|----------|
| T-02-01: Client tax_id injection | tax_id from server-side catalogMap only | ✓ No `req.body.tax_id` references |
| T-02-02: Manipulated grandTotal | Computed server-side from catalog rate + tax_percentage | ✓ |
| T-02-05: Error info disclosure | Generic error messages, details logged server-side | ✓ Only opaque txnId shown |

## Human Verification Required

These items require live testing on staging with the Zoho integration:

1. **Direct kiosk sale creates correct Zoho invoice** — Complete a kiosk sale, check the Zoho Books invoice has per-item tax matching the item's tax configuration
2. **SO-pay creates invoice from SO** — Pay an existing sales order via kiosk, verify a linked invoice appears in Zoho Books and stock decrements
3. **Void scenario displays correctly** — Trigger a Zoho failure after Helcim charge (e.g., disconnect middleware mid-sale), verify full-screen error shows "Payment Voided" with transaction ID
4. **Receipt Done refreshes products** — Complete a sale, tap Done on receipt, verify product stock numbers update immediately
5. **Negative stock renders correctly** — Ensure an item with negative stock shows the actual number (e.g., "-3 in stock") instead of "Out of stock"
