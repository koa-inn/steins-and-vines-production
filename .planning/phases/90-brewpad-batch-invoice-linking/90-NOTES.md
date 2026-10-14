# Handoff — BrewPad batch → Zoho invoice linking (`zoho_so_number`)

**Date:** 2026-10-14
**Severity:** Low as a bug, high as a data-quality problem. Nothing is broken at runtime.
**Why it matters:** 28% of batches have no invoice link, which makes BrewPad unusable as an audit
tool against Zoho. During a stock investigation on 13 Oct 2026, three "unmatched" batches were
chased as suspected unbilled sales and all three turned out to be fully invoiced and paid.

---

## Repo non-negotiables (from CLAUDE.md)

1. `npm test` AND `cd zoho-middleware && npm test` before every commit.
2. `npm run lint` — fix all errors.
3. Bug fixes: **regression test first**, then fix.
4. ONE logical change per commit.
5. Never edit `js/main.js` / `js/main.min.js` — edit `js/modules/*`, then `npm run build`.
   (`js/brewpad.js` is its own file, not part of the modules concat — check before assuming.)
6. `grep` for all usages before modifying any shared function.
7. Do NOT modify existing tests unless asked.
8. **Staging first.** Never push to production without staging approval.

---

## The actual diagnosis — the integration is NOT at fault

Measured across all 206 batches on 2026-10-14:

| Source | Unlinked / total | |
|---|---|---|
| `kiosk` | **0 / 44** | perfect |
| `zoho_scan` | **0 / 14** | perfect |
| `online` | **0 / 4** | perfect |
| `research` | **0 / 1** | perfect |
| `manual` | **33 / 61** | 54% unlinked |
| *(blank — legacy)* | **24 / 82** | 29% unlinked |
| **Total** | **57 / 206 (28%)** | |

**Every automated path links correctly, 63 for 63.** `createBatchesFromSale`
(`zoho-middleware/lib/brewpad-integration.js:383`) and `detectRecipeSale` (`:817`) both pass
`zoho_so_number` into `createBatch`, and `apps-script/adminApi.gs:2696` writes it. That machinery
works and should not be touched.

**The gap is manual batch creation.** Unlinked batches span 2026-01-09 to 2026-10-08, so this is
ongoing, not just legacy backlog.

---

## Root cause

`js/brewpad.js:7591` — the "create batch" sheet's submit handler builds its `create_batch` payload
with `product_name`, `product_sku`, customer fields, `start_date`, `vessel_id`, `shelf_id`,
`bin_id`, `schedule_id`, `notes`, `recipe_id`, `recipe_snapshot`.

**`zoho_so_number` is not in the payload, and there is no input for it in the form.**

A staff member creating a batch by hand therefore *cannot* link it to an invoice at creation time,
even if they want to.

### The after-the-fact path exists but is optional and unprompted

`js/brewpad.js:5655` renders a **"Link to Invoice"** button on the batch *detail* view, shown only
when `zoho_so_number` is empty. It drives a search (`fetchSoSearch`, `:2121`) and writes via
`update_batch` (`zoho_so_number` IS in `allowedFields`, `apps-script/adminApi.gs:2912`).

So the capability is all there. Nothing surfaces it at the moment of creation, and nothing reports
on batches that never got linked.

---

## Observed consequences

1. **False "unbilled sale" leads.** On 13 Oct, these three were investigated as missing revenue and
   were all fully paid:
   - SV-B-000222 (Mercer, Jan) → INV-000208, $272.85, paid 24 Sep
   - SV-B-000035 / 63 / 64 (Lush, Gerry) → INV-000230 and INV-000171, both paid
   - SV-B-000067 (Lacheur, Lisa) → INV-000044, $420, paid 7 Apr
2. **Real unbilled sales hide in the same list**, so the noise is not harmless — it makes the signal
   unusable. Four genuine ones were found the same day (Yvonne Lally, Katie McLachlan, Anthony
   McLachlan ×2), but only by checking each customer individually.
3. `cf_batch_status` write-back to Zoho keys on the batch→invoice link
   (`brewpad-integration.js:401-409`), so an unlinked batch also never stamps its invoice.

---

## Suggested fix, in priority order

### 1. Capture the link at creation (the actual fix)

Add an optional invoice field to the create-batch sheet and include it in the `create_batch`
payload at `js/brewpad.js:7591`. The search UI already exists — reuse `fetchSoSearch` (`:2121`)
rather than writing a second implementation.

Consider defaulting to a warning rather than a hard requirement: staff kits and comped batches
legitimately have no invoice, and a forced field would get filled with junk. A
"No invoice (internal batch)" checkbox that sets `source` appropriately would capture intent
instead. **Note:** `source` is currently NOT in `updateBatch`'s `allowedFields`
(`adminApi.gs:2912`) so it cannot be set after creation — see the main handoff, §6.

### 2. Surface the unlinked set

There is no view listing batches without an invoice. A filter chip on the batches list (alongside
the existing Pending / Ready-to-Bottle ones at `js/brewpad.js:4129`) would let staff clear the
backlog incrementally and stop it regrowing.

### 3. Backfill — 57 batches

Do NOT bulk-auto-match. Matching on customer + product + approximate date is exactly the heuristic
that produced the three false positives above; `planKitBatches`
(`brewpad-integration.js:197-250`) already carries warnings about this class of guessing.

A **review queue** is the right shape: propose candidate invoices, require a human to confirm each.
`/api/batch/scan-invoices` (`zoho-middleware/routes/pos.js:3260`) already does the inverse lookup
(invoice → candidate batches) and could be adapted.

---

## Acceptance criteria

- A batch created manually through the BrewPad UI can carry an invoice number, and does so in the
  `create_batch` payload.
- Regression test: `create_batch` with `zoho_so_number` persists it and it round-trips via
  `get_batch`.
- Staff can see which batches lack a link without exporting data.
- No automated bulk backfill writes a link without human confirmation.

---

## Do not do

- Do not "fix" `createBatchesFromSale` or `detectRecipeSale`. They are at 100%.
- Do not infer a link from customer + product + date and write it unattended.
- Do not make the invoice field mandatory without handling internal batches — as of 14 Oct 2026
  there are legitimately unlinked staff batches (SV-B-000230, SV-B-000231, SV-B-000233 among them)
  whose costs have been deliberately reclassified to the Staff & Promotional Consumption account.

---

# Second workstream — online grain-order recipe splitting (added 2026-10-14)

## Owner request

"Allow recipe splitting on our online store for grain orders. If a customer wants two different
recipes, they can use the UI to indicate how to separate it. They shouldn't need to pay the milling fee
twice."

Added to Phase 90 by owner choice (Claude recommended a separate phase; the two workstreams share no files).

## What exists today (verified 2026-10-14, line numbers will drift)

- Online milling lives in `js/modules/12-checkout.js` (bundled into `js/main.js`, so rebuild after edits):
  - `_milledItemKeys` (:2) is the set of cart item keys the customer wants milled, persisted in
    `sessionStorage['sv-milled-keys']` (:5–17). It is cleared from `js/modules/11-cart.js` (:1331, :1345).
  - `_millingServiceItem` (:3) is the Zoho service item, fetched lazily by matching a name containing "mill" (:194–210).
  - `renderMillingSection(items, container)` (:1034) shows per-grain checkboxes for weight-unit items with
    `millable === 'true'` (cart items carry `millable`, `11-cart.js:175`).
  - **The fee is already charged once per order.** If any key is milled, one fee line at
    `_millingServiceItem.rate` is added (:1115 display, :1359 totals + tax, :1510 order line). So no double charge exists
    online today. Keep this and pin it with a test.
- Middleware: `zoho-middleware/routes/checkout.js:353` lets service items (milling) pass validation.
  Check whether the server recomputes or trusts the milling line before relying on it.
- Public copy: `products/grains.html:134` / `:223` says "milling for $10 per order on request".
  `ingredients.html` / `products.html` / `products/ingredients-supplies.html:~131` say "select milling during checkout".
- **Kiosk is different:** kiosk recipe take-out adds `recipe-fee-milling` per recipe sale
  (`js/kiosk-core.js:1475–1540`, `:1681–1685`). That is where a "pay milling twice" case could really happen.
  Whether kiosk is in scope is an open question.

## Open questions for /gsd-discuss-phase 90

1. How the customer marks a split: a per-grain recipe/bag selector ("Recipe A / Recipe B"), named bags,
   or a free-text instruction box. Max number of splits?
2. Does a split apply to all grains or only milled ones? Can a single grain line be split by quantity across
   recipes (e.g. 5 kg of 2-row → 3 kg A + 2 kg B)? Note qty inputs use step="any" (`9be62be9`).
3. How the split reaches staff: Zoho invoice/sales-order notes or line descriptions, the order email,
   and/or the `online` BrewPad batch record. It must survive into whatever staff actually read when milling.
4. Milling fee: confirm one fee per order regardless of splits (current behaviour). Should kiosk take-out
   with multiple recipes also charge once?
5. Persistence: the split state should live alongside `sv-milled-keys` in sessionStorage and clear with the cart.

## Guardrails

- Do not change the per-order fee into per-recipe or per-bag pricing.
- Money path: any change to checkout totals or tax must keep the server and client agreeing (Zoho tax rounding is
  entity_level, see memory `zoho-tax-rounding-entity-level`).
- CSP is unaffected unless a new third-party service is added.
