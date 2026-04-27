# Phase 1: Catalog & Stock Display - Context

**Gathered:** 2026-04-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Staff and customers see accurate product information in the kiosk: correct category filters (no Zoho item types polluting the dropdown), real-time stock levels, and warnings when cart quantity exceeds available stock with override capability.

</domain>

<decisions>
## Implementation Decisions

### Stock Overflow Warning
- **D-01:** Warn on EVERY add that would push cart qty past `stock_on_hand` — applies to: product grid click, cart +/- buttons, and manual qty input in the cart box.
- **D-02:** Confirm dialog shows stock + cart qty context. Example: `"Merlot" — only 2 in stock, cart has 3. Add anyway?`
- **D-03:** User can override (staff may know about incoming shipments or floor samples). Same `confirm()` pattern as the existing out-of-stock dialog at line 1117-1118 of `js/kiosk.js`.
- **D-04:** The existing out-of-stock warning (stock <= 0) remains as-is — this new check covers the partial-stock case (stock > 0 but qty > stock).

### Category Filter Cleanup
- **D-05:** `kioskItemCategory()` should return `category_name` only. If `category_name` is empty/missing, treat the item as uncategorized.
- **D-06:** Uncategorized items appear under an "Other" option in the category filter dropdown.
- **D-07:** Product cards for uncategorized items should NOT display a category badge — hide it rather than showing "Other" or "goods".
- **D-08:** The Zoho `product_type` values ("goods", "services") and `cf_type` fallback should never appear as category labels or filter options.

### Stock Freshness
- **D-09:** After a successful kiosk sale, bust the Redis product cache (`zoho:kiosk-products`) so the next product load gets fresh stock from Zoho.
- **D-10:** Cross-channel stock changes (online checkout, admin) rely on the existing 5-minute cache TTL — no change needed.

### Claude's Discretion
- Exact wording of the stock overflow confirm dialog (D-02 gives the pattern, Claude refines copy)
- Whether to consolidate the stock <= 0 and stock < cart qty checks into a single function or keep them separate

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Kiosk Frontend
- `js/kiosk.js` lines 745-763 — `kioskGetItemType()`, `kioskItemCategory()` (category logic to fix)
- `js/kiosk.js` lines 940-975 — `kioskPopulateCategories()` (filter dropdown population)
- `js/kiosk.js` lines 1110-1122 — grid card click handler (existing out-of-stock confirm)
- `js/kiosk.js` lines 1205-1228 — `kioskAddToCart()` (needs stock overflow check)
- `js/kiosk.js` lines 1419-1431 — `kioskSetQty()` (cart qty change — needs stock check)

### Middleware
- `zoho-middleware/routes/pos.js` — kiosk sale flow, cache bust logic after sale

### No external specs
Requirements fully captured in decisions above.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `confirm()` dialog pattern at line 1117-1118 — reuse for stock overflow warning
- `parseFloat(p.stock_on_hand) || 0` pattern used throughout for stock parsing
- `kioskGetItemType()` already classifies items — can inform whether to skip stock check for services

### Established Patterns
- Stock display: `outOfStock` / `lowStock` / `In stock` label logic at lines 1058-1084
- Filter state: `_kioskFilters` object with `category`, `type`, `stockStatus` properties
- Cart state: `_kioskCart[itemId] = { item: product, qty: N }` structure
- Products fetched from `/api/kiosk/products` with optional `?bust=1` param for cache bypass

### Integration Points
- `kioskAddToCart()` — primary entry point for stock overflow check
- `kioskSetQty()` — secondary entry point for cart qty changes (+/- buttons and typed input)
- `kioskPopulateCategories()` — where category filter options are built
- `kioskItemCategory()` — where category label fallback chain needs fixing
- Post-sale cache bust in `pos.js` — verify it invalidates `zoho:kiosk-products`

</code_context>

<specifics>
## Specific Ideas

- Stock overflow confirm should mirror the existing out-of-stock confirm UX — same dialog style, just different message
- "Other" in category filter but NO category badge on the product card for uncategorized items
- The +/- buttons AND the qty input box both trigger the stock overflow warning, not just the grid add

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 1-Catalog & Stock Display*
*Context gathered: 2026-04-27*
