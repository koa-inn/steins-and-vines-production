# Phase 90: BrewPad batch invoice linking - Context

**Gathered:** 2026-10-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 90 has three workstreams that share no files. Plan them as separate plans/waves.

- **A. Batch → invoice linking.**
  - Manual BrewPad batches can carry `zoho_so_number` from creation.
  - Staff can see which batches lack a link.
  - The 57-batch backlog is cleared through guided review, and a person confirms every link.
- **C. Kiosk one-tap canning bundle.**
  - Flat $40 (beer 25 L) or $35 (cider / sparkling wine 23 L), plus 12% tax, on a custom line.
  - The real can item is added at the actual count and $0, which relieves stock.
  - Includes the `custom-labels.html` "~84 cans" copy fix.
- **D. Recipe picker dropdown (added by owner during discussion).**
  - The full list of existing recipes is visible when selecting a recipe in BrewPad (new-batch picker, attach-recipe) and in kiosk recipe mode.
  - The recipe editor shows existing recipes when creating one: a duplicate check plus "start from".

**Moved OUT of Phase 90: Workstream B, online grain-order recipe splitting.** The owner decided this is bigger than first thought: the split should happen as grains are selected, not at checkout. It becomes its own phase (Phase 91). The partial decisions captured today are in `<deferred>` as its starting context. Do not plan any grain-split work in Phase 90.

</domain>

<decisions>
## Implementation Decisions

### A1. Invoice at batch creation
- **D-01:** The create-batch sheet (`js/brewpad.js` ~:7591 submit handler) gets an **optional invoice picker**, and `zoho_so_number` is added to the `create_batch` payload.
- **D-02:** The picker **reuses the existing invoice search**: `fetchSoSearch` (~:2121), the same one the detail-view "Link to Invoice" button uses (~:5655). It is pre-filled with the customer name already entered on the form. There is no second search implementation and no free-text invoice entry.
- **D-03:** The sheet gets a **"No invoice (internal batch)" checkbox**. If the invoice and the checkbox are both empty on submit, show a one-tap confirm ("Create without invoice?"). The invoice field is never a hard requirement.
- **D-04:** The checkbox records **`source = 'internal'`**, a new value alongside `manual` / `kiosk` / `online` / `zoho_scan` / `research`. The planner must grep every consumer of `source` and make sure each tolerates the new value: Apps Script `createBatch` (~adminApi.gs:2705 defaults to `'manual'`), the batch views, reports, and the Phase 87 PG `batches.source` column, including any CHECK or allowlist.
- **D-05:** `source` becomes **editable after creation, restricted to `manual` ↔ `internal`**. Add it to `update_batch` `allowedFields` (adminApi.gs ~:2912) with a guard that rejects any other transition. Automated sources (`kiosk`, `online`, `zoho_scan`, `research`) stay locked. Enforce the same rule in the middleware PG batch-store path.

### A2. Unlinked filter + backfill review
- **D-06:** Add an **"Unlinked" filter chip** to the batch list, alongside Pending / Ready-to-Bottle (~`js/brewpad.js:4129`).
  - Unlinked means empty `zoho_so_number` AND `source != 'internal'`.
  - Internal batches are excluded so the list can reach zero.
- **D-07:** **Guided review lives on the batch detail view; there is no separate review screen.** For an unlinked batch, the detail view shows up to ~3 candidate invoices. Each has one-tap actions: **Confirm**, **Not this**, and **Mark internal** (sets `source='internal'` via D-05).
- **D-08:** **Candidate heuristic.** A human confirms every candidate.
  - **Match:** same Zoho customer, invoice date within ±60 days of `start_date`, and the invoice contains a Maker's Fee or kit line. Rank by date distance.
  - **Show:** invoice number, date, total, paid status and line items.
  - **Prefer:** adapt the existing inverse lookup `/api/batch/scan-invoices` (`zoho-middleware/routes/pos.js` ~:3260) rather than building new matching code.
- **D-09:** **One invoice can link to several batches.** This is legitimate: INV-000171 covered SV-B-000063 and 64. The picker **warns "already linked to SV-B-xxx"** so a double link is a deliberate choice.
- **D-10:** **No unattended writes.** Nothing writes `zoho_so_number` without a human tap. There is no bulk auto-match.

### C. Kiosk canning bundle
- **D-11:** **Trigger: a "Canning bundle" button** in the kiosk opens a small picker:
  1. Batch type: **Beer 25 L** or **Cider / sparkling wine 23 L**.
  2. Can size: **473 mL** or **355 mL**.
  3. **Actual can count**, pre-filled with the nominal (beer 52 / 70; cider/sparkling 48 / 64).

  The picker adds two lines:
  - The real can item at the actual count, rate $0.
  - A custom line, e.g. "Canning Bundle — Beer 25 L (473 mL)", at $40 or $35.

  Editing the count later changes only the $0 can line; the bundle price never varies with count.
- **D-12:** **Over cap (beer 55/72, cider/sparkling 50/68): warn and allow an override.** Show an inline warning ("Above the bundle cap — confirm this is one batch"). Once the operator confirms, the bundle price still applies. There is no per-can fallback and no block.
- **D-13:** **Wine: one "Cider / sparkling wine" option.** Still wine is never offered and there is no still-vs-sparkling question.
- **D-14:** **The bundle line stays non-discountable.** Keep D-08 (`js/kiosk-core.js` ~:834, "custom/gift_cert lines are never discounted") as-is and do not change discount code.
- **D-15:** **Tax:** the bundle line carries **12% GST+PST**, matching `can-473`.
  - Rule: `sales_tax_rule_id 109900000000033423`, tax `109900000000029101`.
  - It must **not** default to the zero-rated ingredient rule `109900000000033411`.
  - Client and server totals must agree, and Zoho tax rounding is entity_level, so round per rate group.
- **D-16:** **Lifecycle:** follow the `kioskSyncKitFees()` add/teardown pattern (`js/kiosk-core.js` ~:772) and the Phase 43 custom-line contract (`js/kiosk-core.js` ~:2653). Removing the bundle removes both lines, so no $0 can line is left stranded.
- **D-17:** **Production proof:** one staging hardware session proves both the pending kiosk recipe money-path work (an auto confirm and a manual confirm) **and** a canning bundle sale. For the bundle, the invoice must show the bundle plus 12% tax, with the can quantity equal to the actual count. Promote both together or back-to-back.
- **D-18:** **Copy fix in this phase:** `custom-labels.html:161` says "~84 cans (355 mL)". Change it to match the bundle table: about 70 × 355 mL or about 52 × 473 mL for a 25 L beer batch.

### D. Recipe picker dropdown
- **D-19:** **Surfaces:**
  - BrewPad new-batch Recipes tab (`bindRecipePickerSearch`, `js/brewpad.js` ~:7677)
  - BrewPad attach-recipe on the batch detail view (~:5245)
  - Kiosk recipe mode (`kioskRenderRecipes`, `js/kiosk-core.js` ~:1173, above the existing grid)
  - The recipe editor when creating a new recipe
- **D-20:** **Behaviour:** focusing or clicking the field opens a scrollable list of **all** active recipes (name + style, sorted by name), and typing narrows it. Remove the current 15-item cap. Use one shared behaviour or component across the BrewPad surfaces; the kiosk can be its own ES5 implementation if sharing isn't practical.
- **D-21:** **Recipe editor (new recipe):**
  - As the name is typed, show matching existing recipes, with a warning when the name already exists.
  - Each match has a **"Start from this recipe"** action that copies it, reusing the existing clone / save-as-new path (`bpCloneRecipePayload` / `bpSaveAsNewRecipe` in BrewPad, `kioskSaveAsNewRecipe` in admin).

### Addendum: owner answers at plan time (2026-10-14) and research corrections
- **D-22:** Canning bundle prices ($40 beer / $35 cider-sparkling) are a **server-side constant** in the middleware next to the bundle rules. Changing them needs a code deploy, not env vars. The server owns the price and the 12% tax, and the client never sets them.
- **D-23:** The two BrewPad **waitlist recipe pickers** (research: `js/brewpad.js` ~:8884 and ~:9241) also get the full-list dropdown (extends D-19).
- **D-24:** The **Unlinked** filter excludes disabled or deleted batches as well as `source='internal'` (refines D-06).
- **D-25:** The canning bundle button goes in the **standalone kiosk (`kiosk.html`) only**. The kiosk embedded in admin.html is unchanged.
- **Research corrections (supersede the CONTEXT wording above):**
  - The D-05 guard treats a **blank/legacy `source` as editable**, like `manual`. 82 batches have a blank source, 24 of them unlinked.
  - **`kiosk_recipe`** joins the locked automated sources.
  - Batches support **sheets and postgres only**, not dual.
  - Candidate "Link invoice" (D-07) writes **only `zoho_so_number`**, then calls the invoice-status reconcile. It does not reuse `handleSoSelect`, which overwrites customer and product fields.
  - "Start from this recipe" (D-21) fetches the recipe detail and then uses `bpCloneRecipePayload` and the BrewPad save-as-new path. `kioskSaveAsNewRecipe` is not the right target.
  - The bundle needs **server-owned line handling** in both `/api/kiosk/sale` and `/api/kiosk/sale/confirm` (RESEARCH finding 1).
- **D-05 refinement (owner-informed 2026-10-14):** off-list target values are dropped (never written), not rejected, to keep the pinned batch-pg-update test unedited; locked-source updates are rejected with invalid_source before any write.
- **D-09 known limitation (plan-time, 2026-10-14):** a deliberate multi-link of one invoice to two batches of the **same product SKU** cannot be completed from the create sheet, because the server dedup returns `duplicate_so_number`. The create sheet shows a banner telling staff to create without an invoice and link it from the batch (detail-view Link to Invoice / Possible invoices). Multi-links across different SKUs work from the create sheet.
- **Backlog clearance is operational (plan-time, 2026-10-14):** driving "Unlinked" to 0 on production is done by staff, one tap per batch (D-10), after production promotion. It is not a Phase 90 completion criterion. Phase 90 delivers the tools and proves them on staging.

### Claude's Discretion
- The exact ±60-day window and the "kit line" detection rule within D-08. Keep the human-confirm invariant.
- Visual design of the chip, candidate cards, canning picker and dropdown, following existing BrewPad and kiosk styles.
- Whether the recipe dropdown groups by `beer_category`. Phase 89 adds that field; grouping is optional, and sorted-by-name is the baseline.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & owner handoffs
- `.planning/phases/90-brewpad-batch-invoice-linking/90-NOTES.md` — the owner handoff for all workstreams, with root cause, per-source measurement, do-not-do list, acceptance criteria and canning business rules.
- `HANDOFF-batch-invoice-linking.md` — the original invoice-linking handoff, including the 3 false-positive examples and the legitimately unlinked staff batches SV-B-000230/231/233.
- `HANDOFF-kiosk-canning-bundle.md` — canning bundle §B, with rejected alternatives (composite items, discount preset); §A is already fixed in `eaf0b8cc`.
- `HANDOFF-beer-golive.md` §6 — the `source` not being editable via `update_batch`.
- `.planning/ROADMAP.md` § Phase 90.

### Batch store / Phase 87
- `.planning/phases/87-*/87-DESIGN.md` — the batch-store facade. `create_batch` is server-idempotent. Every batch write must work for `BATCHES_STORE` = sheets, dual and postgres.
- `zoho-middleware/migrations/0005_batches.sql` — PG `batches` columns, including `zoho_so_number` (~:51) and `source`.

### Kiosk money path
- `.planning/phases/43-kiosk-manual-custom-line-item-with-notes/` — the custom-line contract.
- Memory/notes: Zoho tax rounding is entity_level (round per rate group); kiosk recipe confirm verification (staging only); pending staging terminal test (D-17).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `fetchSoSearch` (`js/brewpad.js` ~:2121) and the "Link to Invoice" flow (~:5655): the invoice picker for D-01/D-02 and the confirm action in D-07.
- `update_batch` `allowedFields` (`apps-script/adminApi.gs` ~:2912) already includes `zoho_so_number`; `source` must be added (D-05).
- `/api/batch/scan-invoices` (`zoho-middleware/routes/pos.js` ~:3260): the invoice→batch inverse lookup to adapt for candidates.
- `kioskSyncKitFees()` (`js/kiosk-core.js` ~:772): the auto-maintained line pattern with teardown.
- Phase 43 custom line (`js/kiosk-core.js` ~:2653): forwards `description` / `note` / `taxable` without an `item_id`.
- Recipe catalog fetch `/api/recipes?status=active`, used by both BrewPad pickers (~:7677, ~:5245).
- `bpCloneRecipePayload` / `bpSaveAsNewRecipe` (BrewPad) and `kioskSaveAsNewRecipe` (admin): the "start from" copy path.

### Established Patterns
- `js/brewpad.js` and `js/kiosk-core.js` are standalone ES5 files, not part of the `js/modules` concat. Rebuild the min files via `npm run build`, done once at the end as in Phase 89's 89-08.
- Bug fixes and behaviour changes are test-first. Do not modify existing tests unless the owner approves.

### Integration Points
- Apps Script `createBatch` (~adminApi.gs:2696–2705) writes `zoho_so_number` and `source`. The `'manual'` default stays.
- The middleware batch-store facade (Phase 87) for the PG path.
- Kiosk cart → `/api/kiosk/sale` server totals and tax for the bundle line.

</code_context>

<specifics>
## Specific Ideas

- Known false positives the heuristic must not auto-write: SV-B-000222 → INV-000208, SV-B-000035/63/64 → INV-000230/INV-000171, SV-B-000067 → INV-000044. These are good UAT cases for the candidate list.
- Bundle line label format: "Canning Bundle — Beer 25 L (473 mL)".
- Can stock is about 11 batches (586 × 473 mL, 778 × 355 mL), with no reorder points yet.

</specifics>

<deferred>
## Deferred Ideas

### Phase 91 (new): Online grain-order recipe splitting
This was moved out of Phase 90 by the owner on 2026-10-14. Starting context from today's discussion:
- **Assign at selection time.** The customer separates grains into recipes/bags *as grains are added*, not only at checkout. The exact UX (bag selector on add-to-cart vs a recipe-builder mode) is **undecided**; settle it in the Phase 91 discussion.
- A single grain line **can be split by quantity** across bags (e.g. 5 kg 2-row → 3 kg Bag 1 + 2 kg Bag 2).
- The split applies to **all grains**, not just milled ones, with a **maximum of 4 bags**.
- Staff must see the split in **all three** places: Zoho sales order/invoice notes, the order confirmation email, and the BrewPad `online` batch record.
- **One milling fee per order** stays, as it is today (`js/modules/12-checkout.js` ~:1359); pin it with a test.
- Facts from 90-NOTES §"Second workstream": `_milledItemKeys` / `sv-milled-keys` sessionStorage, `renderMillingSection`, the middleware milling-line validation (`routes/checkout.js` ~:353), and public copy on `products/grains.html`.
- The kiosk multi-recipe milling question is moot for now: in-store recipe milling is priced at $0 by owner choice.

</deferred>

---

*Phase: 90-brewpad-batch-invoice-linking*
*Context gathered: 2026-10-14*
