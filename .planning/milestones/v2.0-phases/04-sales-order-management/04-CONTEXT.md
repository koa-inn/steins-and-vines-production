# Phase 4: Sales Order Management - Context

**Gathered:** 2026-04-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Staff can view all Zoho sales orders (including closed/paid) from the kiosk, import existing SO line items into the kiosk cart for modification and payment, and have the SO updated and marked as closed/paid in Zoho after successful payment. Includes a "Reorder" capability on closed SOs to quickly create repeat orders.

</domain>

<decisions>
## Implementation Decisions

### Import-to-Cart Flow
- **D-01:** Importing an SO loads its line items into the kiosk cart where staff CAN modify them — adjust quantities, remove items, and add new products from the catalog. This is NOT read-only preview.
- **D-02:** All cart edits are LOCAL until payment time. At payment, the middleware updates the Zoho SO with modified line items first, then charges the new balance via the Helcim terminal.
- **D-03:** If the kiosk cart already has items when staff taps "Import to Cart", show a confirm dialog: "This will replace your current cart. Continue?" Clear cart on confirm.
- **D-04:** After importing, staff can browse the product grid and add NEW items (not on the original SO). The Zoho SO gets all items (original + modified + new) at payment time.
- **D-05:** The existing direct "Pay" button on SO cards remains for quick payment without modification. "Import to Cart" is an alternative path when staff needs to adjust the order.

### Post-Payment SO Lifecycle
- **D-06:** Whether to explicitly update the SO status in Zoho or rely on Zoho's auto-close behavior when balance reaches 0 via `/customerpayments` is at Claude's discretion. Research the Zoho Books API behavior during implementation and pick the most reliable approach.
- **D-07:** After successful SO payment: show a payment receipt, then return to the empty cart/product grid view. Staff navigates back to the SO list manually if needed.
- **D-08:** If the Zoho SO update succeeds but the terminal payment fails or is declined: keep the modified SO in Zoho as-is (don't revert). Show "Payment failed — retry?" so staff can retry payment on the already-updated SO.

### Status Filter Design
- **D-09:** Horizontal toggle chips above the SO list: `Open`, `Draft`, `Closed`, `Paid`, `All`. Multiple chips can be active simultaneously. Matches the existing kiosk category filter pattern.
- **D-10:** Default active filters: Open + Draft (actionable orders shown first). Staff taps other chips to see history.
- **D-11:** Paid/closed SO cards are view-only — no "Pay" or "Import to Cart" buttons. Instead show a "Reorder" button that creates a NEW SO with the same line items for a new transaction.

### Claude's Discretion
- Fetch strategy for all statuses — fetch all in one cached batch vs. per-status on demand (D-09 implies "All" chip needs all data available; leaning toward batch-fetch-and-filter-client-side given existing cache pattern)
- Zoho SO auto-close behavior verification and whether explicit status update is needed (D-06)
- Exact chip styling and active/inactive states (match existing kiosk category filter pattern)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Kiosk Frontend
- `js/kiosk.js` lines 700-715 — kiosk state variables (`_kioskSalesOrders`, `_kioskCart`, `_kioskSoPayingId`)
- `js/kiosk.js` lines 2119-2170 — `kioskLoadSalesOrders()` and `kioskRenderSalesOrders()` (SO list rendering, search, card HTML)
- `js/kiosk.js` lines 2195-2300 — `kioskCollectPayment()` (existing direct-pay flow with terminal polling and receipt)
- `js/kiosk.js` lines 2470-2490 — SO create form with "Save" and "Save & Pay" buttons
- `js/kiosk.js` lines 2597-2665 — `kioskCreateSalesOrder()` (creates SO from cart items)

### Middleware — SO Endpoints
- `zoho-middleware/routes/pos.js` lines 943-1023 — `GET /api/kiosk/salesorders` (currently fetches open+draft only, 2-min Redis cache)
- `zoho-middleware/routes/pos.js` lines 1025-1119 — `POST /api/kiosk/salesorder-create` (creates new SO in Zoho from kiosk)
- `zoho-middleware/routes/pos.js` lines 1121-1326 — `POST /api/kiosk/salesorder-pay` (charges SO balance via terminal, records payment, auto-voids on failure)

### Middleware — Payment Collection
- `zoho-middleware/routes/collect.js` — `POST /api/pos/collect` (alternative payment collection endpoint, uses webhook-based terminal flow)

### Zoho API
- Zoho Books API: `GET /salesorders` with `status` param (open, draft, closed, confirmed, void)
- Zoho Books API: `PUT /salesorders/{id}` for updating line items
- Zoho Books API: `POST /customerpayments` with `salesorders_to_apply` for recording payments against SOs

### No external specs
Requirements fully captured in REQUIREMENTS.md (SOM-01, SOM-02, SOM-03) and decisions above.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `kioskCollectPayment()` — existing terminal payment flow with polling, receipt display, and void-on-failure. Reusable for the import-to-cart payment path.
- `kioskCreateSalesOrder()` — creates SO from `_kioskSoItems`. The import flow will need a similar "update SO then pay" path.
- `kioskRenderSalesOrders()` — existing card rendering with search filter. Extend with status chip filtering.
- `escapeHTML()` from `js/lib/utils.js` — already used throughout kiosk for safe rendering.
- Redis cache pattern (`KIOSK_SO_CACHE_KEY`, 2-min TTL) — extend for multi-status caching.

### Established Patterns
- Kiosk IIFE with `_kiosk` prefixed state variables (`_kioskCart`, `_kioskSalesOrders`, `_kioskSoPayingId`)
- `confirm()` dialog pattern for destructive actions (used in stock overflow, out-of-stock, already used for cart operations)
- `showToast()` for success/error notifications
- `fetch()` with `x-api-key` header for middleware calls
- SO card HTML built with string concatenation + `escapeHTML()`

### Integration Points
- `kioskLoadSalesOrders()` — needs status param support and multi-status fetching
- `kioskRenderSalesOrders()` — needs status chip UI and conditional action buttons (Pay/Import vs Reorder)
- `GET /api/kiosk/salesorders` — needs to accept multiple statuses and fetch closed/paid
- New middleware endpoint needed: `PUT /api/kiosk/salesorder-update` (update SO line items before payment)
- `kioskAddToCart()` / `kioskSetQty()` — cart functions need to work in "imported SO" mode
- Post-payment cache invalidation (`KIOSK_SO_CACHE_KEY`) already exists

</code_context>

<specifics>
## Specific Ideas

- "Reorder" button on paid/closed SO cards — creates a new SO with the same line items, essentially a quick-repeat for common orders
- Import clears cart with confirm dialog — same `confirm()` pattern used elsewhere in the kiosk
- Receipt after SO payment follows existing receipt display pattern, then returns to product grid (not SO list)
- Toggle chips should match the existing kiosk category filter styling for consistency

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 4-Sales Order Management*
*Context gathered: 2026-04-27*
