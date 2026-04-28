# Phase 2: Sales Order Integrity - Research

**Researched:** 2026-04-28
**Domain:** Zoho Books/Inventory invoice creation, per-item tax rules, POS terminal flow, kiosk error UX
**Confidence:** HIGH

## Summary

Phase 2 fixes the financial accuracy of kiosk sales by replacing the flat 5% GST tax rate with per-item `tax_id` from the catalog cache, adds Invoice creation to the SO-pay flow so stock deducts on all payment paths, upgrades error handling to show full-screen void notifications, and hooks post-sale stock refresh into receipt dismiss.

The existing code architecture is well-suited for these changes. The kiosk products cache already stores `tax_id` per item (confirmed in `catalog.js` line 728). The invoice creation pattern is already established in `processSaleWithPrices()`. The error view already occupies full-screen via `kioskShowView('error')`. The `kioskLoadProducts(true)` force-refresh already works with `?bust=1`. All four requirements (SO-01, SO-02, SO-03, STOCK-03) map to targeted code changes in existing functions rather than new architectural patterns.

**Primary recommendation:** Modify `processSale()` and `processSaleWithPrices()` to pass `tax_id` on each `line_items` entry (letting Zoho compute tax), add a `zohoPost('/invoices/fromsalesorder', ...)` call to the `salesorder-pay` endpoint after payment recording, enhance `kioskShowError()` to display transaction ID and void status, and call `kioskLoadProducts(true)` on receipt "Done" button click.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Direct kiosk sales continue creating Zoho Invoices (not Sales Orders). Fix line-item accuracy and tax on the existing invoice flow.
- **D-02:** Phase 4's SO-pay flow must also create an Invoice (or convert SO to Invoice) after payment, so stock deducts on all payment paths.
- **D-03:** Replace flat KIOSK_TAX_RATE with per-item tax_id from catalog cache. Each invoice line item includes tax_id so Zoho calculates tax.
- **D-04:** Fallback: if catalog item is missing tax_id, apply KIOSK_TAX_RATE (5% GST) as default.
- **D-05:** Failed Zoho + successful payment + auto-void = full-screen error view (not toast). Includes: payment was voided, no charge, transaction ID. Staff can "Try Again" or "Cancel."
- **D-06:** Void failure shows same error banner. Staff does not distinguish. sendVoidFailureAlert email handles escalation.
- **D-07:** On receipt dismiss ("Done"), call kioskLoadProducts(true) to reload products with ?bust=1.
- **D-08:** Same refresh on all payment paths (direct sale + SO-pay receipt dismiss).
- **D-09:** Show negative stock numbers in kiosk (e.g., "-3 in stock") instead of capping at "Out of stock."

### Claude's Discretion
- Exact wording of full-screen error messages
- Whether SO-to-Invoice conversion uses Zoho's `/invoices/fromsalesorder` API or creates a separate invoice referencing the SO
- How to handle KIOSK_TAX_RATE env var (keep as fallback only, deprecate, or remove after migration)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SO-01 | Completed kiosk sale creates a sales order in Zoho Books with correct line items, quantities, and amounts | Invoice creation with `item_id` + server-anchored rate already works; add `tax_id` per line item for accuracy |
| SO-02 | Sales order includes correct tax calculation matching Zoho tax rules | Per-item `tax_id` field available in kiosk cache; pass to Zoho and let Zoho compute tax server-side |
| SO-03 | Failed Zoho sales order creation after successful payment triggers auto-void and staff notification | Auto-void already implemented; upgrade frontend error display to full-screen with txn ID |
| STOCK-03 | Stock levels update after a completed sale without requiring manual cache bust | `kioskLoadProducts(true)` already supports forced refresh; just call it on receipt dismiss |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Per-item tax on invoice | API / Backend (pos.js) | -- | Tax computation is server-authoritative; catalog cache provides tax_id |
| SO-to-Invoice conversion | API / Backend (pos.js) | -- | Zoho API call after terminal payment success |
| Full-screen void error | Frontend (kiosk.js) | API / Backend | Backend returns void status; frontend renders the error view |
| Post-sale stock refresh | Frontend (kiosk.js) | -- | Frontend triggers `kioskLoadProducts(true)` on UI event |
| Negative stock display | Frontend (kiosk.js) | -- | Rendering logic change only, data already flows correctly |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Express.js | (existing) | HTTP middleware routes | Already in use, no change needed |
| Zoho Books API v3 | v3 | Invoice creation, customer payments | Existing integration via zoho-api.js |
| Helcim Terminal | (existing) | Card payments, void transactions | Already integrated via lib/helcim.js |
| Redis (via cache.js) | (existing) | Kiosk products cache, SO cache | Already in use for all caching |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| inventory-ledger.js | (existing) | Redis stock shadow decrement | Post-sale stock adjustment (already used) |
| mailer.js | (existing) | Void failure email alerts | sendVoidFailureAlert (already used) |
| eventLog.js | (existing) | Sale event logging | Logging sale/void events (already used) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `/invoices/fromsalesorder` | Manually create invoice with SO line items | fromsalesorder is simpler, auto-links SO; manual gives more control but duplicates data handling |
| Per-item tax_id on line items | Tax group with `tax_id` at invoice level | Per-item is correct for mixed-tax carts (GST-only services + GST+PST kits) |

## Architecture Patterns

### System Architecture Diagram

```
[Kiosk UI (kiosk.js)]
    |
    |-- POST /api/kiosk/sale/confirm --> [pos.js processSale]
    |       |
    |       |--> Read KIOSK_PRODUCTS cache (get catalog + tax_id per item)
    |       |--> Build line_items with tax_id from catalog
    |       |--> helcimLib.terminalPurchase() --> [Helcim Terminal]
    |       |       |
    |       |       |--> Poll for result
    |       |
    |       |--> ON APPROVED: zohoPost('/invoices', payload with per-item tax_id)
    |       |       |
    |       |       |--> zohoPost('/invoices/{id}/submit') -- stock deducts
    |       |       |--> zohoPost('/customerpayments') -- mark paid
    |       |       |--> cache.del(KIOSK_PRODUCTS) -- bust cache
    |       |       |--> ledger.decrementStock() -- Redis shadow
    |       |       |--> Return receipt to frontend
    |       |
    |       |--> ON ZOHO FAIL: helcimLib.voidTransaction(txnId)
    |               |
    |               |--> Return { payment_voided: true, voided_transaction_id }
    |               |--> Frontend: full-screen error with txn ID
    |
    |-- POST /api/kiosk/salesorder-pay --> [pos.js salesorder-pay]
    |       |
    |       |--> zohoGet('/salesorders/{id}') -- fetch SO details
    |       |--> helcimLib.terminalPurchase(balance) --> [Helcim Terminal]
    |       |--> ON APPROVED: zohoPost('/customerpayments') -- record payment
    |       |--> NEW: zohoPost('/invoices/fromsalesorder') -- create invoice for stock
    |       |--> Return receipt to frontend
    |
    |-- Receipt "Done" --> kioskLoadProducts(true) --> GET /api/kiosk/products?bust=1
```

### Pattern 1: Per-Item Tax ID on Invoice Line Items
**What:** Each line item in the Zoho invoice payload includes `tax_id` from the catalog cache, letting Zoho compute tax using its configured tax rules.
**When to use:** All kiosk invoice creation (direct sale and SO-pay paths).
**Example:**
```javascript
// Source: Zoho Books API docs (https://www.zoho.com/books/api/v3/invoices/)
var lineItems = body.items.map(function (item) {
  var qty = Number(item.quantity) || 1;
  var catalogItem = catalogMap[item.item_id];
  var rate = catalogItem.rate;
  var li = {
    item_id: item.item_id,
    name: item.name || '',
    quantity: qty,
    rate: rate
  };
  // D-03: Per-item tax from catalog; D-04: fallback to default
  if (catalogItem.tax_id) {
    li.tax_id = catalogItem.tax_id;
  }
  // If no tax_id, Zoho uses item's default tax configuration
  return li;
});
```

### Pattern 2: SO-to-Invoice via Zoho API
**What:** After SO payment is recorded, create an invoice from the SO using Zoho's dedicated endpoint so inventory decrements.
**When to use:** The `salesorder-pay` endpoint after successful terminal charge + payment recording.
**Example:**
```javascript
// Source: Zoho Books API docs (https://www.zoho.com/books/api/v3/invoices/)
// POST /invoices/fromsalesorder?salesorder_id={soId}
zohoPost('/invoices/fromsalesorder?salesorder_id=' + soId, {})
  .then(function (invoiceData) {
    var invoice = invoiceData.invoice || {};
    // Submit the invoice to trigger stock decrement
    return zohoPost('/invoices/' + invoice.invoice_id + '/submit', {});
  });
```

### Pattern 3: Enhanced Error View with Void Details
**What:** Pass additional context (transaction ID, void status) to `kioskShowError` so the full-screen error can display void-specific messaging.
**When to use:** When backend returns `{ payment_voided: true, voided_transaction_id: "..." }`.
**Example:**
```javascript
// Existing kioskShowError signature extended with optional context:
function kioskShowError(title, msg, canRetry, extra) {
  kioskShowView('error');
  // ... existing title/msg logic ...
  // D-05: Show transaction ID if provided
  var detailEl = document.getElementById('kiosk-error-detail');
  if (detailEl && extra && extra.txnId) {
    detailEl.textContent = 'Transaction: ' + extra.txnId;
    detailEl.style.display = '';
  }
}
```

### Anti-Patterns to Avoid
- **Computing tax server-side with a flat rate and passing it to Zoho:** Zoho's tax rules handle multi-rate scenarios (GST, PST, GST+PST, zero-rated). Passing `tax_id` per item lets Zoho do the math correctly, including composite tax groups.
- **Removing KIOSK_TAX_RATE entirely:** Keep it as the D-04 fallback for items missing `tax_id` in the catalog cache. It's the safety net.
- **Creating a standalone invoice for SO-pay (not linked to the SO):** Using `/invoices/fromsalesorder` preserves the SO-Invoice link in Zoho, so accounting can trace the paper trail. A standalone invoice would be an orphan.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tax computation for mixed-rate carts | Manual per-item tax math | Zoho `tax_id` on line items | Zoho handles composite taxes (GST+PST groups), rounding, and audit trail |
| SO-to-Invoice conversion | Manual invoice creation replicating SO fields | `POST /invoices/fromsalesorder?salesorder_id=X` | Zoho links the invoice to the SO automatically, preserves accounting trail |
| Stock decrement timing | Manual Zoho stock adjustment API calls | Invoice submit (auto-decrements) + Redis ledger | Invoice confirm in Zoho auto-adjusts stock; ledger provides real-time shadow |

**Key insight:** Zoho's invoice system is designed to handle tax computation and stock adjustment when you pass `item_id` + `tax_id` on line items and submit the invoice. Fighting this by computing tax yourself leads to rounding mismatches and audit discrepancies.

## Common Pitfalls

### Pitfall 1: Missing tax_id on catalog items
**What goes wrong:** Some items in Zoho may not have a `tax_id` configured (especially newly added items or items imported without tax assignment). If you only pass `tax_id` when it exists but don't handle the fallback, those items go tax-free.
**Why it happens:** Zoho's list endpoint returns `tax_id: ""` for items without explicit tax configuration.
**How to avoid:** D-04 mandates a fallback. When `catalogItem.tax_id` is empty/falsy, do NOT pass `tax_id` on the line item -- instead rely on Zoho's default item tax (which is set on the item in Zoho). If the item truly has no tax configured in Zoho either, the existing `KIOSK_TAX_RATE` logic should log a warning.
**Warning signs:** Invoice totals that don't include expected 5% GST on items.

### Pitfall 2: Tax total mismatch between frontend and backend
**What goes wrong:** The frontend `kioskCalcTotals()` still uses flat `KIOSK_TAX_RATE = 0.05`, but the backend now uses per-item tax. The amounts shown in the payment view may differ from what Zoho calculates.
**Why it happens:** Frontend shows "estimated" total before terminal charge; backend computes authoritative total.
**How to avoid:** Accept that frontend total is an estimate. The terminal charges `grandTotal` computed server-side. Frontend total is cosmetic/informational only. Document this clearly. The receipt shows the authoritative total from the server response.
**Warning signs:** Staff notices small discrepancies between payment view total and receipt total.

### Pitfall 3: Race condition in SO-pay invoice creation
**What goes wrong:** If `/invoices/fromsalesorder` fails after payment recording succeeds, the SO is marked paid but no invoice exists for stock decrement.
**Why it happens:** Two sequential Zoho calls (payment recording + invoice creation) with no transaction guarantee.
**How to avoid:** Make invoice creation failure non-fatal with a logged warning (like the existing payment recording pattern). Stock will eventually reconcile via the next Zoho sync. The SO is still properly paid. Log a warning event so it can be investigated.
**Warning signs:** Sales orders marked "paid" with no corresponding invoice (detectable via Zoho reports).

### Pitfall 4: Receipt dismiss vs. browser navigation
**What goes wrong:** Staff navigates away or refreshes the page instead of tapping "Done", so `kioskLoadProducts(true)` never fires.
**Why it happens:** Kiosk is a browser page; staff might accidentally hit back button.
**How to avoid:** Also bust the kiosk products cache server-side (already done in `processSaleWithPrices`). The `cache.del(KIOSK_PRODUCTS_CACHE_KEY)` ensures the NEXT product load (even without `?bust=1`) will fetch fresh data within 30 minutes (cache TTL). The `kioskLoadProducts(true)` on dismiss just makes it immediate.
**Warning signs:** Staff sees stale stock after a sale (self-resolves on next page load or within cache TTL).

### Pitfall 5: Negative stock display breaking existing UI assumptions
**What goes wrong:** Negative numbers could break layout if the stock label is wider than expected, or other code that checks `outOfStock` might behave differently.
**Why it happens:** Current code sets `outOfStock = !isService && stock <= 0` and uses it for card styling. If we show "-3" instead of "Out of stock", the `outOfStock` flag still needs to be true for the card dimming/styling.
**How to avoid:** Keep `outOfStock` logic unchanged (still true for stock <= 0). Only change the label text from "Out of stock" to the actual negative number. The card still gets `kiosk-product-card--out-of-stock` class for dimming.
**Warning signs:** Cards with negative stock losing their dimmed appearance or stock badges overflowing their container.

## Code Examples

### Per-Item Tax in Line Items (Backend)
```javascript
// In processSale() after catalog lookup — replace flat taxRate with per-item tax
// Source: pos.js lines 146-161 (current code to modify)
var lineItems = body.items.map(function (item) {
  var qty = Number(item.quantity) || 1;
  var catalogItem = catalogMap[item.item_id];
  var rate = catalogItem.rate;
  var li = {
    item_id: item.item_id,
    name: item.name || '',
    quantity: qty,
    rate: rate
  };
  // Per-item tax_id from catalog (D-03)
  if (catalogItem.tax_id) {
    li.tax_id = catalogItem.tax_id;
  }
  return li;
});

// Remove flat tax computation; let Zoho handle it:
// var taxRate = parseFloat(process.env.KIOSK_TAX_RATE) || 0.05;  // REMOVE
// var taxTotal = Math.round(subtotal * taxRate * 100) / 100;       // REMOVE

// Terminal charge amount: still need grandTotal for terminal
// Compute estimated tax for terminal charge using per-item tax_percentage from catalog
var taxTotal = 0;
var defaultTaxRate = parseFloat(process.env.KIOSK_TAX_RATE) || 0.05;
lineItems.forEach(function (li) {
  var catalogItem = catalogMap[li.item_id];
  var pct = catalogItem.tax_percentage;
  if (!pct && !catalogItem.tax_id) {
    // D-04 fallback: no tax_id configured, use default rate
    pct = defaultTaxRate * 100;
  }
  taxTotal += (li.quantity * li.rate) * ((pct || 0) / 100);
});
taxTotal = Math.round(taxTotal * 100) / 100;
var grandTotal = Math.round((subtotal + taxTotal) * 100) / 100;
```

### SO-to-Invoice Conversion (Backend)
```javascript
// In salesorder-pay endpoint, after successful payment recording
// Source: pos.js ~line 1236 (after existing cache.del)
zohoPost('/invoices/fromsalesorder?salesorder_id=' + soId, {})
  .then(function (invoiceData) {
    var invoice = (invoiceData && invoiceData.invoice) || {};
    var invoiceId = invoice.invoice_id || '';
    log.info('[kiosk/so-pay] Invoice created from SO: ' + (invoice.invoice_number || '') + ' id=' + invoiceId);
    if (invoiceId) {
      return zohoPost('/invoices/' + invoiceId + '/submit', {}).catch(function (err) {
        log.warn('[kiosk/so-pay] Invoice submit failed (non-fatal): ' + err.message);
      });
    }
  })
  .catch(function (err) {
    // Non-fatal: SO is paid, but invoice creation failed
    // Stock won't auto-decrement until next reconcile
    log.error('[kiosk/so-pay] Invoice from SO failed (non-fatal): ' + err.message);
  });
```

### Full-Screen Void Error (Frontend)
```javascript
// Enhanced kioskShowError for void scenarios
// Source: kiosk.js lines 2177-2203 (existing function to extend)
function kioskShowError(title, msg, canRetry, extra) {
  kioskShowView('error');
  var titleEl = document.getElementById('kiosk-error-title');
  var msgEl = document.getElementById('kiosk-error-msg');
  var retryBtn = document.getElementById('kiosk-retry-btn');
  var backBtn = document.getElementById('kiosk-back-btn');
  var detailEl = document.getElementById('kiosk-error-detail');

  if (titleEl) titleEl.textContent = title;
  if (msgEl) msgEl.textContent = msg;

  // D-05/D-06: Show transaction ID for void scenarios
  if (detailEl) {
    if (extra && extra.txnId) {
      detailEl.textContent = 'Ref: ' + extra.txnId;
      detailEl.style.display = '';
    } else {
      detailEl.style.display = 'none';
    }
  }

  if (retryBtn) {
    retryBtn.style.display = canRetry ? '' : 'none';
    retryBtn.onclick = function () {
      kioskShowView('browse');
      kioskStartCheckout();
    };
  }
  if (backBtn) {
    backBtn.onclick = function () { kioskShowView('browse'); };
  }
}
```

### Post-Sale Stock Refresh (Frontend)
```javascript
// In kioskShowReceipt() "Done" button handler
// Source: kiosk.js ~line 2167 (existing newSaleBtn.onclick)
var newSaleBtn = document.getElementById('kiosk-new-sale-btn');
if (newSaleBtn) {
  newSaleBtn.onclick = function () {
    // D-07: Force product refresh on receipt dismiss
    kioskLoadProducts(true);
    _kioskCustomer = null;
    kioskClearImportedSo();
    kioskShowView('browse');
  };
}
```

### Negative Stock Display (Frontend)
```javascript
// Source: kiosk.js lines 1123-1131 (existing stock label logic to modify)
var stockLabel, stockClass;
if (isService) {
  stockLabel = '';
  stockClass = '';
} else if (stock <= 0) {
  // D-09: Show actual negative value for staff reorder decisions
  stockLabel = stock < 0 ? (Math.round(stock) + ' in stock') : 'Out of stock';
  stockClass = 'kiosk-product-stock--out';
} else if (stock <= 5) {
  stockLabel = 'Low stock (' + Math.round(stock) + ')';
  stockClass = 'kiosk-product-stock--low';
} else {
  stockLabel = 'In stock';
  stockClass = '';
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Flat `KIOSK_TAX_RATE` (5% on everything) | Per-item `tax_id` on invoice line items | This phase | Correct tax for mixed-rate carts (kits=12%, ingredients=0%, services=5%) |
| SO payment records payment only (no invoice) | SO payment + invoice creation | This phase | Stock deducts on SO-pay path, not just direct sale |
| Generic toast errors on void | Full-screen error with transaction ID | This phase | Staff can reference txn ID, clear communication that no charge occurred |
| Manual product refresh after sale | Auto-refresh on receipt dismiss | This phase | Staff sees fresh stock immediately |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Zoho's `/invoices/fromsalesorder?salesorder_id=X` endpoint exists and works with POST | Architecture Patterns (Pattern 2) | Would need alternative approach (manual invoice creation linking SO) |
| A2 | Passing `tax_id` on invoice line items causes Zoho to auto-compute tax (overriding any default) | Architecture Patterns (Pattern 1) | If Zoho ignores line-item `tax_id`, tax would use item defaults (may still be correct) |
| A3 | Zoho's items list endpoint returns `tax_id` for items that have it configured | Common Pitfalls | If list endpoint doesn't return tax_id, the kiosk cache won't have it (but detail enrichment adds it for products cache) |

**Note on A1:** The Zoho Books API docs confirm this endpoint exists at `POST /invoices/fromsalesorder` with `salesorder_id` as a query parameter. [CITED: https://www.zoho.com/books/api/v3/invoices/] Multiple community threads reference it. However, the exact parameter format (query param vs body) should be tested with the live Zoho org.

**Note on A2:** Zoho docs confirm `tax_id` is a valid field on invoice line items that applies per-item tax. [CITED: https://www.zoho.com/books/api/v3/invoices/]

**Note on A3:** Zoho Inventory docs confirm the items list endpoint returns `tax_id`. [CITED: https://www.zoho.com/inventory/api/v1/items/] Additionally, the existing code at `catalog.js:728` maps `item.tax_id || ''` directly from the list response to the kiosk cache.

## Open Questions

1. **`/invoices/fromsalesorder` -- query param or body?**
   - What we know: The endpoint exists and takes `salesorder_id`. Zoho docs and community posts confirm it.
   - What's unclear: Whether `salesorder_id` is a query parameter (`?salesorder_id=X`) or part of the POST body.
   - Recommendation: Try query param first (most Zoho endpoints use query params for entity references). If that fails, try body. The code should handle both approaches with a simple fallback.

2. **Does `/invoices/fromsalesorder` auto-mark as "sent"/confirmed?**
   - What we know: Regular invoice creation requires a separate `/submit` call to trigger stock decrement.
   - What's unclear: Whether fromsalesorder auto-submits or needs the same `/submit` call.
   - Recommendation: Always follow up with `/submit` (like the direct sale path). If it's already submitted, the call will be a no-op or return a non-fatal error.

3. **Frontend tax estimate accuracy**
   - What we know: `kioskCalcTotals()` uses flat 5% for display. Backend uses per-item tax for terminal charge.
   - What's unclear: Whether the discrepancy between displayed amount and charged amount will confuse staff.
   - Recommendation: Accept the discrepancy for now. The payment view shows "estimated total" and the terminal charges the authoritative amount. The receipt shows the actual charged amount. This is the same pattern used by the online checkout.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | API key already required on endpoints |
| V3 Session Management | no | Kiosk is stateless (no sessions) |
| V4 Access Control | yes | x-api-key header validation (existing) |
| V5 Input Validation | yes | Cart item validation already in place (item_id format, qty bounds) |
| V6 Cryptography | no | No new crypto operations |

### Known Threat Patterns for This Phase

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Client-supplied tax_id injection | Tampering | tax_id read from server-side catalog cache only, never from client request body |
| Manipulated grandTotal for terminal | Tampering | grandTotal computed server-side from catalog prices + catalog tax_percentage; client values ignored |
| Invoice creation with arbitrary contact_id | Elevation | Server always uses KIOSK_CONTACT_ID env var (existing pattern at line 254) |
| SO-pay on already-paid order | Tampering | Balance check (line 1164) rejects balance <= 0; order_status check rejects void/closed |

**Security note for this phase:** No new attack surface is introduced. The key security property -- that all financial calculations are server-authoritative from the catalog cache -- is preserved. The `tax_id` comes from the cache (populated by Zoho API), not from the client request.

## Sources

### Primary (HIGH confidence)
- Zoho Books API v3 Invoices documentation: https://www.zoho.com/books/api/v3/invoices/ -- confirmed `tax_id` field on line items, `/invoices/fromsalesorder` endpoint
- Zoho Inventory API Items: https://www.zoho.com/inventory/api/v1/items/ -- confirmed items list returns `tax_id`
- Codebase inspection: `zoho-middleware/routes/pos.js` (lines 73-446, 484-682, 1129-1333)
- Codebase inspection: `zoho-middleware/routes/catalog.js` (lines 684-757, 103-191)
- Codebase inspection: `js/kiosk.js` (lines 850-877, 935-968, 1105-1152, 2085-2175, 2177-2203, 2558-2704)

### Secondary (MEDIUM confidence)
- Zoho community post on fromsalesorder: https://help.zoho.com/portal/en/community/topic/help-detail-of-books-zoho-com-api-v3-invoices-fromsalesorder-api -- confirms endpoint accepts salesorder_id as parameter

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in use, no new dependencies
- Architecture: HIGH -- changes are surgical modifications to existing functions with well-understood patterns
- Pitfalls: HIGH -- identified from direct code inspection and Zoho API documentation
- SO-to-Invoice approach: MEDIUM -- Zoho API endpoint confirmed but exact parameter format needs live testing

**Research date:** 2026-04-28
**Valid until:** 2026-05-28 (stable -- no moving targets in this domain)
