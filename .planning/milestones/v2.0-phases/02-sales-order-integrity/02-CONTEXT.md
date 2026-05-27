# Phase 2: Sales Order Integrity - Context

**Gathered:** 2026-04-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Every kiosk payment results in a correct Zoho financial record (Invoice for direct sales, Invoice-backed SO for Phase 4 SO payments) with accurate per-item line items, proper tax, auto-void on failure with staff notification, and automatic post-sale stock refresh on the frontend.

</domain>

<decisions>
## Implementation Decisions

### Zoho Record Type
- **D-01:** Direct kiosk sales (tap-and-pay at terminal) continue creating **Zoho Invoices**, not Sales Orders. Invoices auto-decrement stock on confirm and land in accounting immediately. Fix line-item accuracy and tax on the existing invoice flow.
- **D-02:** Phase 4's SO-pay flow (`salesorder-pay`) must also be updated to create an Invoice (or convert SO to Invoice) after payment, so stock deducts on all payment paths. Both direct sale and SO-pay paths must result in proper inventory adjustment.

### Per-Item Tax Rules
- **D-03:** Replace flat `KIOSK_TAX_RATE` with per-item `tax_id` from the catalog cache. Each invoice line item includes `tax_id` so Zoho calculates tax using its own rules. Handles mixed-tax carts correctly (e.g., taxable kits + zero-rated items).
- **D-04:** Fallback: if a catalog item is missing `tax_id`, apply `KIOSK_TAX_RATE` (5% GST) as default. No item goes tax-free by accident.

### Failure Notification UX
- **D-05:** When Zoho fails after a successful terminal charge and the payment is auto-voided, show a **prominent full-screen error view** (not a toast). Message includes: payment was voided, no charge to customer, transaction ID for reference. Staff can tap "Try Again" or "Cancel."
- **D-06:** When the void itself fails (worst case), show the **same error banner**. Staff does not need to distinguish the two failure modes on screen. The existing `sendVoidFailureAlert` email handles escalation behind the scenes.

### Post-Sale Stock Refresh
- **D-07:** On receipt dismiss (staff taps "Done"), call `kioskLoadProducts(true)` to reload products with `?bust=1`. Staff sees fresh stock immediately when returning to the product grid.
- **D-08:** Same refresh behavior on **all payment paths** — direct sale receipt dismiss and SO-pay receipt dismiss both trigger product reload.
- **D-09:** Show **negative stock numbers** in the kiosk (e.g., "-3 in stock") instead of capping at "Out of stock" for <= 0. Staff uses this to see actual shortfall for reorder decisions. Only staff see the kiosk.

### Claude's Discretion
- Exact wording of the full-screen error messages (D-05 gives the pattern, Claude refines copy)
- Whether SO-to-Invoice conversion uses Zoho's convert API or creates a separate invoice referencing the SO (D-02 — research Zoho API behavior during planning)
- How to handle the `KIOSK_TAX_RATE` env var — keep as fallback only, deprecate, or remove after migration

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Kiosk Sale Flow (Direct Sale)
- `zoho-middleware/routes/pos.js` lines 73-446 — `POST /api/kiosk/sale` and `processSale`/`processSaleWithPrices` (invoice creation, terminal polling, auto-void, cache bust)
- `zoho-middleware/routes/pos.js` lines 484-680 — `POST /api/kiosk/sale/confirm` (manual confirm flow with discounts, same invoice+flat-tax pattern)
- `js/kiosk.js` lines 1954-2001 — confirm button handler, calls `/api/kiosk/sale/confirm`, shows receipt or batch review

### Kiosk Sale Flow (SO Pay — Phase 4)
- `zoho-middleware/routes/pos.js` lines 1129-1280 — `POST /api/kiosk/salesorder-pay` (terminal payment for existing SO, records customer payment, needs Invoice creation added)
- `js/kiosk.js` lines 2558-2700 — `kioskCollectPayment()` (SO payment with terminal polling and receipt)

### Tax & Catalog
- `zoho-middleware/routes/catalog.js` lines 103-191 — catalog enrichment with `tax_id`, `tax_name`, `tax_percentage`, `sales_tax_rule_id`
- `zoho-middleware/lib/pricing.js` — server-authoritative pricing library (may be useful for tax computation)

### Stock & Cache
- `zoho-middleware/lib/inventory-ledger.js` — Redis stock shadow layer, decrements on checkout
- `zoho-middleware/lib/cache.js` — cache operations, `KIOSK_PRODUCTS_CACHE_KEY` usage

### Receipt & Post-Sale Frontend
- `js/kiosk.js` lines 2085-2130 — `kioskShowReceipt()` (receipt rendering, Done button)
- `js/kiosk.js` lines 1502-1509 — `kioskClearCart()` (clears cart state, re-renders)
- `js/kiosk.js` lines 935-970 — `kioskLoadProducts(forceRefresh)` with `?bust=1` param
- `js/kiosk.js` lines 1105-1149 — stock display labels (`outOfStock`, `lowStock`, `stockLabel`)

### Existing Error Handling
- `js/kiosk.js` `kioskShowError()` — existing error display function (needs upgrade to full-screen view for D-05)
- `zoho-middleware/lib/mailer.js` — `sendVoidFailureAlert()` for void failure email escalation

### No external specs
Requirements fully captured in REQUIREMENTS.md (SO-01, SO-02, SO-03, STOCK-03) and decisions above.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `kioskShowError(title, message, retryable)` — existing error display; extend for prominent full-screen error view
- `kioskLoadProducts(true)` — already supports `?bust=1` for forced refresh; just needs to be called on receipt dismiss
- `helcimLib.voidTransaction(txnId)` — auto-void already implemented and working
- `sendVoidFailureAlert()` — email escalation for void failures already in place
- `inventory-ledger.js` `decrementStock()` — Redis stock shadow already decrements post-sale
- Phase 4's `salesorder-pay` endpoint — terminal payment + customer payment recording; needs Invoice step added

### Established Patterns
- Invoice creation: `zohoPost('/invoices', payload)` → submit → record customer payment
- Terminal flow: `helcimLib.terminalPurchase()` → poll → process result
- Cache bust: `cache.del(KIOSK_PRODUCTS_CACHE_KEY)` after successful sale
- Stock display: `parseFloat(p.stock_on_hand) || 0` with outOfStock/lowStock labels
- `confirm()` dialogs for destructive or important actions
- `showToast()` for non-blocking notifications
- `kioskShowView('error')` for error states

### Integration Points
- `processSaleWithPrices()` line 146-156 — line item building needs `tax_id` from catalog
- `taxRate` computation (lines 160-162) — replace flat rate with per-item tax from catalog
- `invoicePayload.line_items` — each item needs `tax_id` field added
- `kioskShowReceipt()` Done button — add `kioskLoadProducts(true)` call
- `kioskCollectPayment()` receipt dismiss — add same product refresh
- `salesorder-pay` endpoint — add Invoice creation step after payment recording
- Stock label rendering (lines 1108-1131) — allow negative display instead of "Out of stock" floor

</code_context>

<specifics>
## Specific Ideas

- Negative stock display shows actual number (e.g., "-3 in stock") with the same `kiosk-product-stock--out` styling, so staff sees shortfall for reorder decisions
- Full-screen error should be unmissable — not a dismissable toast. Transaction ID included so staff can reference it if needed
- Tax fallback uses existing `KIOSK_TAX_RATE` env var so there's no config change needed for the fallback path

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 2-Sales Order Integrity*
*Context gathered: 2026-04-28*
