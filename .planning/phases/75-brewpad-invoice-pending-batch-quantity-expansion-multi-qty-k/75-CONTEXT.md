# Phase 75: BrewPad invoice→pending-batch quantity expansion — Context

**Gathered:** 2026-08-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix the bug where a Zoho invoice line with quantity > 1 of the same kit surfaces only ONE pending batch in BrewPad instead of one pending batch per unit. Reported by owner 2026-08-25 with concrete evidence: **INV-000171** (3 × the same kit) → 1 pending batch observed, 3 expected.

The bug is in the **invoice→pending-batch reconciliation/derivation path** (the Phase 63 "Batch↔Invoice Reconciliation Model" that surfaces pending batches from existing Zoho invoices), NOT the real-time sale path — `zoho-middleware/lib/brewpad-integration.js`'s `createBatchesFromSale`/`planKitBatches` is already quantity-aware (`kitBatchQuantity`, D-03). The reconciliation/derivation path collapses a qty>1 kit line to a single pending batch. Exact derivation site is a RESEARCH target (it may live in `apps-script/` since batch records are stored there, and/or in a middleware reconciliation route).

**In scope:** expand multi-qty kit lines into N distinct pending batches with stable per-unit identity + idempotency (no duplicates on re-poll); reconcile against already-existing batches for the line; per-unit display in BrewPad; regression test using an INV-000171-shaped invoice (qty 3 → 3 batches).
**Out of scope:** the real-time sale path (already correct); recipe pricing (Phase 73); any change to how batches are activated/completed beyond count/identity/label.

</domain>

<decisions>
## Implementation Decisions

### Retroactive handling of already-ingested invoices
- **D-01:** **Auto-backfill on next reconcile.** On the next reconciliation poll, invoices already ingested before the fix get their missing units added automatically — INV-000171 self-corrects from 1 → 3 with no manual step. This is safe ONLY because D-02's reconcile-against-existing rule + stable per-unit identity make the operation idempotent (re-polling must never duplicate). The regression suite must prove idempotency across repeated polls.

### Count rule vs. already-activated/created batches
- **D-02:** **Reconcile: pending_to_add = invoice_line_qty − batches_already_existing_for_that_line.** Always converge the total batch count (pending + already-created) to exactly the invoice line quantity (capped per D-04). Never blindly create N; count what already exists for the line first so units already turned into real/activated batches (e.g. via the sale path) are not duplicated. Attributing an existing batch to a specific invoice line is a research detail (likely via the Phase 63 batch↔invoice link fields).

### BrewPad display of the N units
- **D-03:** **Per-unit label "Unit X of N"** on each pending batch (e.g. "30L Amber Kit — Unit 1 of 3 / 2 of 3 / 3 of 3") so staff can track and activate them distinctly. `js/brewpad.js` batch-list rendering. Ordinal is derived from the per-unit identity, stable across re-render.

### Fermentation-slot cap consistency
- **D-04:** **Match the sale path — cap by paid fermentation slots.** Expand to `min(kit_line_qty, makers_fee_slots_paid)`, consistent with `createBatchesFromSale`/`makersFeeSlots`/`planKitBatches` and the `MAX_BATCHES_PER_KIT_LINE` (=100) fat-finger guard. Do not create batches for slots that weren't paid for. If the invoice lacks a usable Maker's Fee quantity (legacy/edge), fall back to kit-line quantity (mirror the sale path's legacy fallback).

### Claude's Discretion
- The exact per-unit **identity / idempotency key** scheme (e.g. `{invoice_id or line_id}#{unit_index}`) — research + planner decide, constrained only by: stable across re-polls, unique per unit, and reconcilable against existing batches (D-02). This was explicitly left as a technical decision.
- Which layer the fix lands in (`apps-script/` derivation vs. `zoho-middleware/` reconciliation vs. both) — pin down in research.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Bug report + tracking
- `.planning/ROADMAP.md` § "Phase 75" — goal + root-cause hypothesis + related-subsystem pointers.
- `.planning/ROADMAP.md` § "Phase 63: Batch↔Invoice Reconciliation Model" — the reconciliation/ingestion + dedup model this fix must not break (re-poll must not duplicate).
- `.planning/ROADMAP.md` § "Phase 62: Inventory Consumption Sync" — invoice-consumption/ingestion model context.

### Money/batch-path code (source of truth for the correct quantity-aware pattern to mirror)
- `zoho-middleware/lib/brewpad-integration.js` — the ALREADY-correct sale-path quantity expansion: `detectKitItems` (L56), `kitBatchQuantity` (L83, D-03 quantity-aware + cap), `makersFeeSlots` (L168, fermentation-slot count), `planKitBatches` (L197, min(kit,slots) allocation), `createBatchesFromSale` (L345), `MAX_BATCHES_PER_KIT_LINE`=100 (L82). Mirror this logic in the invoice-derivation path.
- `js/brewpad.js` — batch-list rendering (pending-batch visibility gate ~L554-587 `source==='kiosk' && status==='pending'`); this is where the "Unit X of N" label (D-03) is applied.
- Invoice→pending-batch derivation site — **RESEARCH TARGET** (not yet located; likely `apps-script/` batch store and/or a middleware reconciliation route). This is where D-01/D-02/D-04 are implemented.

### Project rules
- `./CLAUDE.md` — middleware has own `node_modules` (`cd zoho-middleware` for its tests); write a regression test FIRST reproducing the bug then fix; both `npm test` and `cd zoho-middleware && npm test` + `npm run lint` before commit; frontend is vanilla ES5 and `js/brewpad.min.js` is a build artifact (regenerate, never hand-edit).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `planKitBatches` / `kitBatchQuantity` / `makersFeeSlots` (`brewpad-integration.js`): the correct min(kit_qty, paid_slots) expansion + clamp — the invoice path should reuse or mirror this rather than re-implement, satisfying D-04 by construction.

### Established Patterns
- The sale path already treats Maker's Fee quantity as the authoritative fermentation-slot count and caps batches to it — D-04 keeps the two paths consistent.
- Pending batches are real batch records (status=pending, source=kiosk), not synthetic view rows (`brewpad.js:554-560`), so "adding a pending batch" means creating a batch record — hence idempotency/identity (D-01/D-02) is essential to avoid duplicate records on re-poll.

### Integration Points
- Reconciliation/poll that reads Zoho invoices → derives/creates pending batches (Phase 63 model): the fix site.
- BrewPad batch-list render (`js/brewpad.js`): per-unit label (D-03).
- Batch store (`apps-script/`): where batch records + their invoice-line linkage live (attribution for D-02).

</code_context>

<specifics>
## Specific Ideas

- Reproduction anchor for the regression test: an **INV-000171-shaped** invoice — a single kit line with quantity 3 (and matching Maker's Fee slots) → must yield exactly 3 pending batches, stable and non-duplicating across repeated reconciliation polls.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 75-brewpad-invoice-pending-batch-quantity-expansion-multi-qty-k*
*Context gathered: 2026-08-26*
