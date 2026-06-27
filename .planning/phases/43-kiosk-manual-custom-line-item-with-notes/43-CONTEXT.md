# Phase 43: Kiosk manual custom line item with notes - Context

**Gathered:** 2026-06-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Add a staff-only affordance on the kiosk POS to ring up an **ad-hoc, non-catalog line item** (description + staff-entered price + qty + optional note) that flows through the existing terminal-charge → Zoho-invoice → payment-record money path. Must work identically on **both** forked kiosk surfaces (standalone `js/kiosk.js` and admin-embedded `js/admin.js`, per #14) and must not weaken the v4.2-hardened money path.

**In scope:** standard kiosk sale path only (`/api/kiosk/sale` + `/api/kiosk/sale/confirm`). Custom-line UI on both surfaces. Server custom-line acceptance, bounded pricing, GST tax handling, note → Zoho line description.

**Out of scope:** recipe-sale path (`/api/kiosk/recipe-sale`); online checkout; the Phase 42 kiosk de-fork itself (this feature is built on the still-forked surfaces and deliberately duplicates into both files until Phase 42).
</domain>

<decisions>
## Implementation Decisions

### Tax (locked with owner before discussion)
- **D-01:** Custom lines are taxed at **GST 5% by default**, with a per-line **tax-exempt toggle** in the UI.
- **D-02:** Money-path invariant — the terminal charge (server `computeTax`, `routes/pos.js`) MUST equal the Zoho invoice tax for the line. A **taxable** custom line therefore needs a Zoho GST `tax_id` on the invoice line. Resolution order: (1) `process.env.KIOSK_GST_TAX_ID`; (2) auto-discover from the kiosk catalog cache — find an item whose `sales_tax_rule_id` maps to 5% (`ZOHO_TAX_SERVICES_RULE`) and reuse its `tax_id`; (3) **fail-closed** — if a taxable custom line is requested and no GST `tax_id` is resolvable, reject the sale with a clear, actionable error. Tax-exempt custom lines never need a `tax_id`.

### Price bounds (locked with owner before discussion)
- **D-03:** Per-line `rate` may be **negative** (ad-hoc discount/credit) and **large**. The **UI requires an explicit confirmation** step when an entered amount is **> $2000 or negative**. Server keeps the existing grand-total guardrails unchanged: `grandTotal > 0` and `grandTotal <= 10000` (a net-negative/zero sale is still rejected by the existing check).

### Note vs description data shape
- **D-04:** **Two fields.** `Description` = the line label (required), shown on the receipt and used as the Zoho invoice line name/description. `Note` = optional; appended to the Zoho line `description` as `"<Description> — <Note>"`. Matches the owner's earlier "ad-hoc line + note in description" design.

### Field rules & defaults
- **D-05:** `Description` is **required** (non-empty, 1–100 chars after trim/sanitize). `rate` is required (numeric, within bounds). `quantity` defaults to **1** (integer ≥ 1, reuse existing qty bounds). `taxable` defaults **on**.

### UI affordance & placement
- **D-06:** An **"Add custom item" button in the cart area** opens a **focused modal/sheet** containing the fields (Description, Note, Price, Qty, Tax-exempt toggle, confirm-on-large/negative). Chosen for large iPad touch targets, minimal disturbance to the product grid, and easiest to keep pixel-identical across the two forked files. Build the SAME modal + handler in `kiosk.js` and `admin.js`.

### Cart editing & discounts
- **D-07:** A custom line behaves like a catalog line in the cart for **qty +/- and remove** (reuse existing cart controls; Claude's discretion on exact wiring).
- **D-08:** Custom lines are **excluded from discount presets** — never discounted by cart-scope or type-scope presets. Staff enter the net price directly or add a negative custom line. Keeps the money path predictable and avoids double-discounting. Server `resolveDiscount` and frontend `kioskCalcTotals` must skip custom lines when applying discounts.

### Claude's Discretion
- Exact custom-line cart key scheme (e.g. synthetic `custom-<n>` keys in `_kioskCart`), the line object shape passed to the server (`{ custom: true, description, note, quantity, rate, taxable }`, no `item_id`), input sanitization specifics, and receipt rendering of custom lines.
- Whether the modal is a true `<dialog>`/overlay or a positioned panel — pick whatever matches existing kiosk modal patterns for consistency.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Money path (server)
- `zoho-middleware/routes/pos.js` — the two handlers to extend: `processSale` / `/api/kiosk/sale` (terminal charge; catalog-rejection loop ~L251–259, lineItems builder ~L264–280) and `/api/kiosk/sale/confirm` (Zoho invoice + payment; ~L409–545). `computeTax` (~L116–139) reads `catalogMap[li.item_id]` and will crash on a custom line — must handle missing catalog entry via the line's `taxable` flag. `resolveDiscount` (~L41–113) type-scope uses `catalogMap[li.item_id]` — must skip custom lines. Legacy `/api/pos/sale` (~L629–634) proves Zoho accepts a description-only ad-hoc line `{ description, rate, quantity }`.
- `zoho-middleware/lib/inventory-ledger.js` — `decrementStock(lineItems, ...)` is called in confirm; must tolerate lines with no `item_id` (skip them, no stock to decrement).
- `zoho-middleware/lib/brewpad-integration.js` — `createBatchesFromSale(lineItems, ...)` is called in confirm; custom lines are not kits — confirm it tolerates missing `item_id`.
- Tax rule constants: `routes/pos.js` `_TAX_RULE_PCT` (~L26–30) + `routes/catalog.js` (~L112–120); `ZOHO_TAX_SERVICES_RULE` = 5% GST.

### Money path (frontend, BOTH forked surfaces)
- `js/kiosk.js` — `_kioskCart` (keyed object, ~L689), `kioskCalcTotals` (~L1187, taxes each line by `entry.item.tax_percentage`, defaults 5% — a custom entry with `tax_percentage` 5/0 needs no math change), `kioskProceedToPayment` (~L2950, builds the `items` array posted to the server — extend the mapper to forward `custom`/`description`/`note`/`taxable`), sale + confirm POSTs (~L3070–3190).
- `js/admin.js` — the admin-embedded kiosk fork (`admin.html?tab=kiosk`); the SAME changes must be duplicated here. Prod kiosk = admin surface.

### Decisions / gotchas
- `.planning/.continue-here.md` — root checkpoint; **blocking** anti-patterns: (1) kiosk fork blind spot — any kiosk change must touch kiosk.js AND admin.js; (2) never `sed` with `|` delimiter on `.md` tables (use Edit).
- `.planning/PROJECT.md` — v4.4 milestone scope + money-path constraints; v4.2 server-authoritative-pricing principle.
- `CLAUDE.md` (repo root) — non-negotiables: test-first on money-path changes, run both test suites + lint before commit, `npm run build` after JS module changes, staging-first deploy.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `kioskCalcTotals()` already does per-line tax via `tax_percentage` with a 5% default → custom lines need only carry `tax_percentage` (5 or 0); no totals-math change.
- Existing cart qty +/- and remove controls → reuse for custom lines.
- Legacy `/api/pos/sale` description-only Zoho line → the proven shape for an ad-hoc invoice line.
- Existing kiosk modal/overlay patterns (recipe modify, payment view) → match for the custom-item modal.

### Established Patterns
- Server-authoritative pricing: client `rate`/`tax_total` ignored for catalog items. Custom lines are the one place a staff-entered price is trusted — bound it server-side (magnitude cap) and keep grand-total guards.
- ES5 / `var` throughout; no framework. Match surrounding style.
- Forked kiosk (#14): kiosk.js + admin.js diverge — duplicate deliberately, keep identical.

### Integration Points
- `body.items[]` shape on `/api/kiosk/sale` + `/sale/confirm` gains an optional custom-line variant (no `item_id`, `custom: true`).
- `computeTax`, `resolveDiscount`, `decrementStock`, `createBatchesFromSale` all iterate `lineItems` and key off `item_id` — each needs a guard for custom lines.

</code_context>

<specifics>
## Specific Ideas

- Zoho line for a custom line: `{ description: "<Description> — <Note>", rate, quantity }` plus `tax_id` only when taxable. No `item_id`, no `sku`.
- Fail-closed error copy when a taxable custom line can't resolve a GST tax_id should tell staff to either mark the line tax-exempt or have `KIOSK_GST_TAX_ID` configured.
- Confirm prompt for >$2k or negative: explicit "You entered <amount> — confirm this custom charge" before it enters the cart.

</specifics>

<deferred>
## Deferred Ideas

- Phase 42 kiosk de-fork (`js/kiosk-core.js`) — would end the duplicate-into-both-files burden this feature incurs. Separate, owner-gated phase.
- Optional Railway env `KIOSK_GST_TAX_ID` as belt-and-suspenders for the GST tax_id (auto-discovery covers the common case). Human action, not code.

None other — discussion stayed within phase scope.

</deferred>

---

*Phase: 43-kiosk-manual-custom-line-item-with-notes*
*Context gathered: 2026-06-26*
