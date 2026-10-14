# Phase 90: BrewPad batch invoice linking - Research

**Researched:** 2026-10-14
**Domain:** Vanilla ES5 BrewPad/kiosk frontends + Express middleware + Apps Script + Postgres batch store (Phase 87); Zoho Books invoice reads; kiosk money path
**Confidence:** HIGH on code facts (all cited from live files this session); MEDIUM on Zoho list-filter behaviour (one live read-only probe still needed, see A3/Open Questions)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**A1. Invoice at batch creation**
- **D-01:** The create-batch sheet (`js/brewpad.js` ~:7591 submit handler) gets an **optional invoice picker**, and `zoho_so_number` is added to the `create_batch` payload.
- **D-02:** The picker **reuses the existing invoice search**: `fetchSoSearch` (~:2121), the same one the detail-view "Link to Invoice" button uses (~:5655). It is pre-filled with the customer name already entered on the form. There is no second search implementation and no free-text invoice entry.
- **D-03:** The sheet gets a **"No invoice (internal batch)" checkbox**. If the invoice and the checkbox are both empty on submit, show a one-tap confirm ("Create without invoice?"). The invoice field is never a hard requirement.
- **D-04:** The checkbox records **`source = 'internal'`**, a new value alongside `manual` / `kiosk` / `online` / `zoho_scan` / `research`. The planner must grep every consumer of `source` and make sure each tolerates the new value: Apps Script `createBatch` (~adminApi.gs:2705 defaults to `'manual'`), the batch views, reports, and the Phase 87 PG `batches.source` column, including any CHECK or allowlist.
- **D-05:** `source` becomes **editable after creation, restricted to `manual` <-> `internal`**. Add it to `update_batch` `allowedFields` (adminApi.gs ~:2912) with a guard that rejects any other transition. Automated sources (`kiosk`, `online`, `zoho_scan`, `research`) stay locked. Enforce the same rule in the middleware PG batch-store path.

**A2. Unlinked filter + backfill review**
- **D-06:** Add an **"Unlinked" filter chip** to the batch list, alongside Pending / Ready-to-Bottle (~`js/brewpad.js:4129`). Unlinked means empty `zoho_so_number` AND `source != 'internal'`. Internal batches are excluded so the list can reach zero.
- **D-07:** **Guided review lives on the batch detail view; there is no separate review screen.** For an unlinked batch, the detail view shows up to ~3 candidate invoices. Each has one-tap actions: **Confirm**, **Not this**, and **Mark internal** (sets `source='internal'` via D-05).
- **D-08:** **Candidate heuristic.** A human confirms every candidate. Match: same Zoho customer, invoice date within +/-60 days of `start_date`, and the invoice contains a Maker's Fee or kit line. Rank by date distance. Show: invoice number, date, total, paid status and line items. Prefer: adapt the existing inverse lookup `/api/batch/scan-invoices` (`zoho-middleware/routes/pos.js` ~:3260) rather than building new matching code.
- **D-09:** **One invoice can link to several batches.** This is legitimate: INV-000171 covered SV-B-000063 and 64. The picker **warns "already linked to SV-B-xxx"** so a double link is a deliberate choice.
- **D-10:** **No unattended writes.** Nothing writes `zoho_so_number` without a human tap. There is no bulk auto-match.

**C. Kiosk canning bundle**
- **D-11:** Trigger: a **"Canning bundle" button** in the kiosk opens a small picker: (1) Batch type: Beer 25 L or Cider / sparkling wine 23 L. (2) Can size: 473 mL or 355 mL. (3) Actual can count, pre-filled with the nominal (beer 52 / 70; cider/sparkling 48 / 64). The picker adds two lines: the real can item at the actual count, rate $0; and a custom line, e.g. "Canning Bundle - Beer 25 L (473 mL)", at $40 or $35. Editing the count later changes only the $0 can line; the bundle price never varies with count.
- **D-12:** **Over cap (beer 55/72, cider/sparkling 50/68): warn and allow an override.** Inline warning ("Above the bundle cap - confirm this is one batch"). Once the operator confirms, the bundle price still applies. No per-can fallback and no block.
- **D-13:** **Wine: one "Cider / sparkling wine" option.** Still wine is never offered and there is no still-vs-sparkling question.
- **D-14:** **The bundle line stays non-discountable.** Keep D-08 (`js/kiosk-core.js` ~:834, "custom/gift_cert lines are never discounted") as-is and do not change discount code.
- **D-15:** **Tax:** the bundle line carries **12% GST+PST**, matching `can-473`. Rule: `sales_tax_rule_id 109900000000033423`, tax `109900000000029101`. It must **not** default to the zero-rated ingredient rule `109900000000033411`. Client and server totals must agree, and Zoho tax rounding is entity_level, so round per rate group.
- **D-16:** **Lifecycle:** follow the `kioskSyncKitFees()` add/teardown pattern (`js/kiosk-core.js` ~:772) and the Phase 43 custom-line contract (`js/kiosk-core.js` ~:2653). Removing the bundle removes both lines, so no $0 can line is left stranded.
- **D-17:** **Production proof:** one staging hardware session proves both the pending kiosk recipe money-path work (an auto confirm and a manual confirm) **and** a canning bundle sale. For the bundle, the invoice must show the bundle plus 12% tax, with the can quantity equal to the actual count. Promote both together or back-to-back.
- **D-18:** **Copy fix in this phase:** `custom-labels.html:161` says "~84 cans (355 mL)". Change it to match the bundle table: about 70 x 355 mL or about 52 x 473 mL for a 25 L beer batch.

**D. Recipe picker dropdown**
- **D-19:** Surfaces: BrewPad new-batch Recipes tab (`bindRecipePickerSearch`, `js/brewpad.js` ~:7677); BrewPad attach-recipe on the batch detail view (~:5245); Kiosk recipe mode (`kioskRenderRecipes`, `js/kiosk-core.js` ~:1173, above the existing grid); the recipe editor when creating a new recipe.
- **D-20:** Behaviour: focusing or clicking the field opens a scrollable list of **all** active recipes (name + style, sorted by name), and typing narrows it. Remove the current 15-item cap. Use one shared behaviour or component across the BrewPad surfaces; the kiosk can be its own ES5 implementation if sharing isn't practical.
- **D-21:** Recipe editor (new recipe): as the name is typed, show matching existing recipes, with a warning when the name already exists. Each match has a **"Start from this recipe"** action that copies it, reusing the existing clone / save-as-new path (`bpCloneRecipePayload` / `bpSaveAsNewRecipe` in BrewPad, `kioskSaveAsNewRecipe` in admin).

### Claude's Discretion
- The exact +/-60-day window and the "kit line" detection rule within D-08. Keep the human-confirm invariant.
- Visual design of the chip, candidate cards, canning picker and dropdown, following existing BrewPad and kiosk styles.
- Whether the recipe dropdown groups by `beer_category`. Phase 89 adds that field; grouping is optional, and sorted-by-name is the baseline.

### Deferred Ideas (OUT OF SCOPE)
- **Phase 91 (new): Online grain-order recipe splitting.** Moved out of Phase 90 by the owner on 2026-10-14. Do not plan any grain-split work in Phase 90 (assign-at-selection UX, split by quantity, max 4 bags, staff visibility in Zoho notes / email / BrewPad `online` batch, one milling fee per order, `_milledItemKeys`, `renderMillingSection`, `routes/checkout.js` ~:353 milling validation, `products/grains.html` copy). The kiosk multi-recipe milling question is moot (in-store recipe milling priced at $0 by owner choice).
</user_constraints>

<phase_requirements>
## Phase Requirements

No requirement IDs were assigned to this phase. D-01..D-21 are the coverage set.

| ID | Description | Research Support |
|----|-------------|------------------|
| D-01..D-03 | Optional invoice picker + internal checkbox on create sheet | create payload path (Section A1), `fetchSoSearch` refactor need, dedup interaction (Pitfall 3) |
| D-04, D-05 | `source='internal'`, editable manual<->internal | Source-consumer audit (A1), guard design in both stores, blank-legacy-source gap (Pitfall 2) |
| D-06 | Unlinked chip | filter seam `applyBatchFilter` / `filterBatchesByStatus` (A2) |
| D-07..D-10 | Detail-view candidate review | new read-only candidate endpoint adapting scan-invoices; reverse index via `fetchLiveBatchIndex`; link write path + cf_batch_status (A2) |
| D-11..D-16 | Canning bundle | Server changes REQUIRED in `routes/pos.js` (C section); client lifecycle seams |
| D-17 | Staging terminal proof | Section "Deploy / proof constraints" |
| D-18 | Copy fix | `custom-labels.html:161` only occurrence |
| D-19..D-21 | Recipe pickers + editor | Five picker copies found (D section); shared helper recommendation |
</phase_requirements>

## Summary

Three independent workstreams (no shared files). **A (invoice linking)** is mostly additive and low-risk: no CHECK/enum constrains `source` anywhere (PG `source text not null default 'manual'`, no allowlist in sheets, `batch-pg-*`, backfill spec, parity/verify scripts), and the only reader of `source` in the frontend is `shouldShowKioskBadge` (`js/brewpad.js:575`). The real work is (1) a guarded `source` edit in BOTH `updateBatch` implementations, (2) refactoring `fetchSoSearch`/`handleSoSelect` (hard-wired to the detail view's DOM ids and to `_detailBatchId`) so the create sheet can reuse them, and (3) a new READ-ONLY candidate endpoint. A key discovery: the existing `handleSoSelect` write also **overwrites `customer_id`, `customer_name` and `product_name`** from the invoice (line items[0]), which is wrong for a backfill "Confirm"; Confirm should write only `zoho_so_number` and then reconcile `cf_batch_status`.

**C (canning bundle) is NOT a client-only change.** The server (`zoho-middleware/routes/pos.js`) (a) anchors every non-custom line's rate to the catalog (client `rate: 0` for a can would be silently re-priced to the catalog rate), and (b) hard-codes custom lines to 5% GST (`tax_percentage: taxable ? 5 : 0`, `tax_id = resolveGstTaxId`) in TWO places (`/api/kiosk/sale` ~:590-611 and `/api/kiosk/sale/confirm` ~:1264-1290). The bundle needs a server-authoritative bundle line type (price from a server table, 12% tax with the standard tax_id) and a server-validated `$0` can line type (restricted to can-473/can-355 SKUs), added to both paths, with the existing `client_grand_total` +/-$0.01 pre-charge assertion as the divergence detector.

**D (recipe pickers)** has five near-identical copies of the "fetch active recipes, filter, slice(0,15)" picker in `js/brewpad.js` (new-batch :7683, attach :5245, waitlist per-row :8884, waitlist add :9241) plus the kiosk grid; ~10-13 recipes exist today so scale is trivial. Recommend one pure shared helper in `js/lib/` and a small shared dropdown function inside the BrewPad IIFE.

**Primary recommendation:** Plan three independent plan-chains (A: store guard -> payload/UI -> candidates; C: server bundle contract -> client lifecycle -> copy fix; D: shared helper -> pickers -> editor), TDD each seam, one final build/gate plan modelled on 89-08, and gate production on the D-17 staging terminal session. Do NOT run Confirm/link writes against real batches on staging (shared workbook + shared Zoho org).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Optional invoice picker + internal checkbox | Browser (brewpad.js) | API (create_batch via admin-proxy) | UI state; payload carries `zoho_so_number`/`source` |
| `source` transition guard (manual<->internal only) | Database/Store (adminApi.gs + batch-pg-update.js) | API proxy (optional coerce) | Must be enforced where data is written, in BOTH stores; client check is UX only |
| Unlinked chip | Browser | - | Pure filter over already-loaded `_allBatchesData` |
| Candidate invoice lookup | API / Backend (new GET route in pos.js) | Zoho Books | Zoho credentials and rate limits live in middleware; read-only |
| "Already linked to SV-B-xxx" warning | Browser (from `_allBatchesData`) | API (`fetchLiveBatchIndex` for candidates) | Client already holds all batches; server index only for candidate rows |
| Link write (Confirm) | API (update_batch) | Zoho (cf_batch_status via reconcile route) | Human tap -> `update_batch{zoho_so_number}` -> reconcile |
| Bundle price, tax, can-line validity | API / Backend (pos.js sale + confirm) | Browser (display only) | Money path: server is authoritative, client mirrors for display |
| Bundle cart lifecycle (add/teardown/cap warning) | Browser (kiosk-core.js) | - | Mirrors `kioskSyncKitFees` |
| Stock relief for $0 can line | Zoho invoice line qty (+ optional Redis ledger) | API | Same as any item line |
| Recipe dropdown / duplicate check | Browser | API (`/api/recipes`) | Catalog already client-held after one fetch |

## Standard Stack

No new runtime packages. Everything is in-repo vanilla ES5 / Express / existing libs.

### Core (existing, reuse)
| Component | Location | Purpose |
|-----------|----------|---------|
| `fetchSoSearch` / `handleSoSelect` / `callSyncZoho` / `showLinkedSo` | `js/brewpad.js:2123 / 2359 / 2091 / 2411` | Invoice search + link (refactor to be parameterised) |
| `/api/batch/search-invoices` | `routes/pos.js:2938` | Search; up to 10 sequential detail fetches (no status/total in response today) |
| `/api/batch/reconcile-invoice-status` | `routes/pos.js:3002` | Recomputes `cf_batch_status` from the live batch set (handles N batches per invoice) |
| `brewpadIntegration.fetchLiveBatchIndex()` | `lib/brewpad-integration.js:723` | Mode-aware (sheets via Apps Script GET, postgres via `batchStore.listAll`) invoice->batches index. Reusable reverse index |
| `brewpadIntegration.detectKitItems` / `checkoutHelpers.findMakersFeeItem` | `lib/brewpad-integration.js:56` | Maker's-Fee/kit-line detection |
| `zohoGet` (retry/429 aware) | `lib/zoho-api.js:73` | Zoho reads |
| `batchStore` facade | `lib/batch-store.js` | PG ops; sheets mode resolves `null` and callers fall through to Apps Script |
| `showConfirmSheet(message, okLabel, okCls, onOk)` | `js/brewpad.js:4549` | BrewPad confirm idiom (no `window.confirm` is used in brewpad.js) |
| `afterBatchWrite(batchId, opts)` | `js/brewpad.js:2442` | Cache invalidation after any batch write |
| `bpCloneRecipePayload(recipe, ingredients)` / `bpCloneRecipe` | `js/brewpad.js:3059 / 3093` | Clone-to-new-recipe |
| `duplicateRecipe()` | `js/admin.js:~9200` | Admin editor duplicate path |
| `resolveGstTaxId`, `_TAX_RULE_PCT`, `computeTax` | `routes/pos.js:57, 47, 221` | Server tax; pattern to copy for 12% standard tax_id |
| `ZOHO_TAX_STANDARD_ID` / `ZOHO_TAX_STANDARD_RULE` env | `routes/taxes.js:~384`, `pos.js:47` | Standard 12% rule/id; default rule `109900000000033423` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| New candidate endpoint | Extend `scan-invoices` | `scan-invoices` is the opposite direction (recent invoices WITHOUT batches, 30-day window, 4 pages x 50, `cf_batch_status` skip). Reuse its helpers, not its flow (see A2) |
| `sync-zoho` after link | `reconcile-invoice-status` | `sync-zoho` writes a single-batch label ("Pending - SV-B-x") and last-write-wins for multi-batch invoices; reconcile writes "N batches" correctly (D-09) |
| Persisting "Not this" | localStorage per batch | No schema change; not shared across devices. Recommended (Open Question 3) |

**Installation:** none. **Version verification:** N/A (no new packages).

## Package Legitimacy Audit

No external packages are installed or recommended by this phase. slopcheck (0.6.1) is available on PyPI but there is nothing to check.

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
WORKSTREAM A (linking)
 BrewPad create sheet --(create_batch {zoho_so_number?, source?:'internal', customer_id})--> /api/batch/admin-proxy
      |                                                                                      |
      | picker: fetchSoSearch --> GET /api/batch/search-invoices --> Zoho (list+<=10 detail)  v
      |                                              batch-proxy.intercept
      |                                     BATCHES_STORE=postgres? --yes--> batch-store.create -> batch-pg-create (invoice dedup+unit_seq)
      |                                              |no (sheets)
      |                                              v
      |                                     forwardToAppsScript -> adminApi.gs createBatch (batchDedupDecision under lock)
      v
 on success + invoice chosen: POST /api/batch/reconcile-invoice-status {zoho_so_number} --> Zoho PUT cf_batch_status

 Batch detail (unlinked) --> GET /api/batch/link-candidates?customer_id|customer_name&start_date  [NEW, read-only]
      |   Zoho GET /invoices?customer_id&date_start&date_end  -> <=N detail fetches (sequential) -> Maker's-fee flag
      |   fetchLiveBatchIndex() -> annotate each candidate with linked_batches[]
      v
   candidate cards: [Confirm] -> update_batch{zoho_so_number only} -> afterBatchWrite -> reconcile-invoice-status
                    [Not this] -> localStorage hide        [Mark internal] -> update_batch{source:'internal'} (guarded)
 Batch list: Unlinked chip = pure client filter(_allBatchesData)

WORKSTREAM C (bundle)
 Kiosk "Canning bundle" btn -> picker(type,size,count) -> cart: {bundle line (custom, bundle_key)}, {can line (item copy, rate 0, bundle_can)}
      -> pair lifecycle (remove either = remove both; count edit touches can line only; cap warning)
 Checkout -> POST /api/kiosk/sale (items[]) -> [SERVER] bundle line: price from server table, tax 12% + standard tax_id
                                                [SERVER] can line: SKU allow-list, rate forced 0, qty int 1..cap
                                              -> computeTax (per-rate-group rounding) -> client_grand_total assert (+/-$0.01) -> Helcim
 Terminal approve -> POST /api/kiosk/sale/confirm (SAME rebuild) -> Zoho invoice (custom line w/ tax_id + can item qty, rate 0) -> decrementStock

WORKSTREAM D (pickers)
 /api/recipes?status=active (one fetch/catalog) -> shared sort+filter helper -> dropdown (all rows, scroll) in:
   new-batch Recipes tab | attach-recipe | (waitlist x2, optional) | kiosk grid header | recipe editor name field (dup warn + "Start from")
```

### Recommended Project Structure (touch list)
```
apps-script/adminApi.gs                    # updateBatch source guard + pure decision fn; (createBatch unchanged)
zoho-middleware/lib/batch-rules.js         # pure sourceTransitionDecision (mirror of the .gs fn)
zoho-middleware/lib/batch-pg-update.js     # FIELD_KINDS gains source + guard against locked row, before first write
zoho-middleware/routes/pos.js              # new GET /api/batch/link-candidates; bundle + can-line support in sale AND confirm
zoho-middleware/lib/kiosk-bundles.js (new) # single table of bundle prices/caps/can SKUs shared by sale+confirm (recommended)
js/brewpad.js                              # create sheet, unlinked chip, candidate cards, pickers, editor dup check
js/kiosk-core.js (+ kiosk.html markup)     # bundle lifecycle + picker modal; kioskRenderRecipes header dropdown
js/lib/recipe-picker.js (new, optional)    # pure sort/filter/name-match helpers; add <script> to brewpad.html, kiosk.html, admin.html
custom-labels.html                         # D-18 copy
tests/frontend/*.test.js, zoho-middleware/__tests__/*.test.js, __tests__/db/*.test.js
```

### A1 - Invoice at creation + `source`

**Verified consumers of `source`** (grep across `js/`, `apps-script/`, `zoho-middleware/lib|routes|scripts`, excluding catalog `source:` response fields which are unrelated):

| Consumer | Location | Effect of new value `'internal'` |
|----------|----------|----------------------------------|
| PG column | `migrations/0005_batches.sql:50` `source text not null default 'manual'` | **No CHECK, no enum, no index on source.** No migration needed |
| Apps Script createBatch | `adminApi.gs:2705` `sanitizeInput(payload.source \|\| 'manual')`; email blanked only when `source==='kiosk'` (:2691) | Accepts any string |
| PG createBatch | `batch-pg-create.js:252` same default; :239 kiosk-only email blank | Accepts any string |
| Dashboard `needsScheduling` | `adminApi.gs:2377`, `batch-rules.js:769` | Passes the value through; frontend shows it as text (`brewpad.js:3839`) |
| Kiosk badge | `brewpad.js:575` `source==='kiosk'\|\|'kiosk_recipe'` and pending | Unaffected |
| Backfill spec | `scripts/backfill/specs/batches.js:42` `text`, not required | Unaffected |
| `batch-compare.js`, `batch-drift.js`, `batches-parity.js`, `sheet-mirror` | no `source` logic (grep clean; mirror copies whole row, `mirror_batch_state`) | Unaffected |
| Existing tests | `batch-scan-invoices.test.js:652` asserts `zoho_scan`; `brewpad-recipe.test.js` asserts `kiosk_recipe` | Unaffected |

Note the real source set also includes **`kiosk_recipe`** (`brewpad-integration.js:864`), which CONTEXT's list omits. It must be in the locked set of the D-05 guard. Per the HANDOFF measurement, **82 legacy batches have a blank `source`** (24 of them unlinked) [CITED: HANDOFF-batch-invoice-linking.md], so the guard must treat blank as editable (Pitfall 2).

**Guard design (both stores, same truth table):**
- allowed iff `next === current` (no-op) OR (`current` in {`''`,`manual`,`internal`} AND `next` in {`manual`,`internal`}); everything else -> `{ok:false, error:'invalid_source', message}`.
- Apps Script: add `'source'` handling in `updateBatch` (`adminApi.gs:2827-2960`). Validate at the **top of the function**, before the location-history/vessel writes at :2860-2890 (that code appends VesselHistory and flips vessel status BEFORE status validation, so a late rejection leaves partial writes). Extract a pure top-level `batchSourceTransitionDecision(currentSource, nextSource)` like `batchDedupDecision` (:2576) so tests can slice it out.
- PG: `batch-pg-update.js` `FIELD_KINDS` (:67-87) is a fixed allow-list ("source ... deliberately absent" comment at :66 must be updated). `prepareFieldValues` (:205) has no row access; do the transition check in `updateBatch` after `lockBatch` and before the first write (the module's stated invariant: "every validation BEFORE the first write"). Mirror the pure function in `batch-rules.js`.
- Optional hardening (recommended): at the create path, a staff session can currently post any `source` string through `/api/batch/admin-proxy` (`create_batch`). Coerce to `manual` unless `internal` for the proxy path only (server_token callers `createBatchesFromSale`/`detectRecipeSale` call Apps Script directly and set their own sources). Otherwise a mis-set `source:'kiosk'` would bypass the guard's intent. [ASSUMED: owner acceptance, A5]

**create_batch payload (D-01):** the form already has hidden `bp-new-customer-id` (`brewpad.js:7790` `custId`) but the submit handler (:7596-7611) **does not send `customer_id`**. Add `customer_id` AND `zoho_so_number` (and `source:'internal'` when checked). Sending `customer_id` is what makes future candidate lookups name-independent; recommended even though D-01 does not list it [ASSUMED scope, A4].

**Idempotency interaction (important):**
- Without `zoho_so_number` (today's path) PG create dedups by a 2-minute actor+payload fingerprint (`batch-pg-create.js` `manualCreateFingerprint`, fields in `batch-rules.js` FINGERPRINT_FIELDS: product_sku, recipe_id, customer_name, start_date, schedule_id, vessel/shelf/bin, notes; `zoho_so_number`/`source` are NOT in it).
- WITH `zoho_so_number` the PG path switches to invoice+SKU dedup (`dedupDecision`, unique index `batches_unit_seq_idx (zoho_so_number, product_sku, unit_seq)`), and Apps Script does the same under lock (`batchDedupDecision`, :2670). A manual create against an invoice that already has a batch for the same SKU (or any batch when `product_sku` is empty, e.g. Recipes tab) returns `{ok:false,error:'duplicate_so_number'}`. D-09 says multi-batch per invoice is legitimate, but only the **update** path (no dedup) can do it for manual batches unless `unit_total` is sent. UI must surface this error with a recovery ("Create without invoice, then link"), and the picker should show the D-09 warning from `_allBatchesData` before submit. The submit button is already disabled on click (:7595), so double-tap cannot send two creates.
- `update_batch` linking never touches `unit_seq`, so there is no unique-index conflict when linking existing batches (verified `batch-pg-update.js` writes only FIELD_KINDS columns).

**cf_batch_status after create-with-invoice:** `createBatchesFromSale` syncs the field itself; the BrewPad manual create path does not. After a successful create with an invoice, call `POST /api/batch/reconcile-invoice-status {zoho_so_number}` (fire-and-forget, same style as `reconcileInvoiceStatusAfterDelete` `brewpad.js:~2105`).

**fetchSoSearch refactor (D-02):** it hard-codes `#bp-so-search-results`, builds rows with `data-*` attributes, and its click handler calls `handleSoSelect(el)`, which depends on `_detailBatchId` and the detail DOM (`showLinkedSo`). Reuse means parameterising: `fetchSoSearch(term, { resultsId, onSelect })`, keeping the default behaviour byte-identical for the detail view (no tests exist for either function today - add characterization tests first). The create sheet's `onSelect` should only populate hidden fields (`bp-new-so-number`, `so-id`) and a visible "Linked: INV-xxx [x]" chip, never write. Also pre-fill the search input from `bp-new-customer-text` (D-02); `search-invoices` requires term length >= 2 (`pos.js:2942`).

### A2 - Unlinked chip + candidate review

**Chip (D-06):** seam is `applyBatchFilter()` (`brewpad.js:~4025`) which currently special-cases `readyToBottle`. Add `'unlinked'` to `filterOpts` (:4137-4144) and a pure exported helper `filterBatchesByUnlinked(batches)` beside `filterBatchesByStatus` (:203). Predicate: `!String(zoho_so_number||'').trim() && String(source||'').toLowerCase() !== 'internal'`, across ALL statuses (most of the 57 are probably complete). Count badge like pending (:4147-4156). Decide whether `disabled` batches are excluded (discretion; recommend exclude since a disabled batch is dead). Filter state is a single string `_batchStatusFilter`; the click handler (:10170) already routes through `applyBatchFilter`, so no new state variable.

**Candidate endpoint (D-08) - what scan-invoices actually does** (`pos.js:3259-3460`): it is **invoice -> "needs a batch"**, not batch -> invoice. Date-window mode pages `/invoices` (last 30 days, 4 pages x 50, sorted by created_time), skips `cf_batch_status`-stamped invoices and invoices already in the batch dedup index, then sequentially detail-fetches each remaining invoice and keeps those where `detectKitItems(line_items).length > 0`. Single-invoice mode (`?number=`) resolves by number then detail-fetches. It is the **inverse** of what D-07 needs, and it deliberately EXCLUDES invoices that already have `cf_batch_status`/a batch (exactly the "already linked" case D-09 wants to show). So: **do not extend it**; add a sibling GET route and reuse its pieces:
- `authTiers.requireTiers(['legacy','session'])` wrapper (same as every BrewPad GET).
- `zohoGet('/invoices', { customer_id, date_start, date_end, sort_column:'date', per_page: 50 })` - `customer_id`, `date_start`/`date_end`, `status`, `per_page` (max 200), `sort_column` are documented list params [CITED: zoho.com/books/api/v3/invoices/ list parameters]. The list response has no line items (comment at `pos.js:2943-2948`, Phase 64 T-64-01) so line items need a sequential detail fetch, hard-capped (e.g. 6, never request-controlled, like `MAX_DETAIL_FETCH=10` at :2951).
- `detectKitItems` / `findMakersFeeItem` for the Maker's-Fee flag. Recommend: do not drop non-Maker's-Fee invoices outright; return them flagged `has_makers_fee:false` ranked after flagged ones (recipe-sale invoices have no Maker's Fee; discretion area, human confirms anyway).
- Exclude `void`; keep draft/sent/paid/partially_paid/overdue (`CANDIDATE_STATUSES` there is paid/sent/draft only - candidate review must include overdue/partially_paid or it hides real matches).
- Annotate each candidate with `linked_batches: ['SV-B-000063', ...]` from `fetchLiveBatchIndex().byInvoiceNumber` (one `get_batches` call in sheets mode, 12 s timeout, returns null on failure -> treat as "unknown", never "not linked"; show a muted "link status unknown").
- Cache: `cache.get/set(key, value, ttlSeconds)` (Redis) pattern from `queueSyncForRetry`; cache per `(customer, window)` for ~10 min to survive repeated detail-open/close. Never prefetch for all 57 batches (Zoho ~1 req/s guidance + daily quota error code 45 propagates, `zoho-api.js:33`).
- **Customer resolution gap:** manual batches created before this phase have no `customer_id` (the form never sent it). Candidate lookup for them must fall back to the customer **name** (Zoho `customer_name` filter or contact search then id). Exact semantics of the name filter (exact vs contains) were not verifiable from docs this session -> run one read-only live probe in Wave 0 (A3). Walk-In/blank names yield no candidates; the existing "Link to Invoice" search remains the manual fallback.
- Input validation: `batch`-derived params from the client (`customer_id` digits, `customer_name` <=100 chars, `start_date` `YYYY-MM-DD`). The route is read-only, so accepting client-supplied values is the same trust level as `search-invoices`; this avoids a server-side batch read. Window `start_date +/- 60d` computed server-side.

**Confirm / Not this / Mark internal (D-07, D-10):**
- Confirm = `adminApiPost('update_batch', {batch_id, updates:{zoho_so_number}})` + `afterBatchWrite(batchId,{refreshOpenDetail:true})` + reconcile. **Do not call `handleSoSelect` as-is**: it also writes `customer_id`, `customer_name`, `product_name` from the invoice (:2359-2371; `product_name` = first line item name, which could be a fee line) and calls `callSyncZoho(batchId, soId, status)` which writes a single-batch label. Extract a narrow `linkBatchToInvoice(batchId, soNumber)` and keep `handleSoSelect` for the manual search path (or let it opt into the wider write explicitly).
- `cf_batch_status`: linking after the fact already triggers `callSyncZoho` today (handleSoSelect). Recommend reconcile-invoice-status for ALL link writes (create-with-invoice, Confirm, manual link) because it computes the correct "N batches" label for D-09 multi-links; it needs only the invoice number (no invoice_id). It runs against the live batch set, so it must run AFTER `update_batch` resolves.
- Not this = hide candidate for that batch (localStorage, Open Question 3). Mark internal = `update_batch{source:'internal'}`; hide the button when current source is locked (not in {'', manual, internal}).
- Optimistic lock: `update_batch` accepts `expectedVersion`; existing link flow omits it. Pass the batch's `last_updated` for Confirm so two staff cannot confirm different invoices at once (PG `isVersionConflict` is lenient; fine).

### C - Kiosk canning bundle (server + client)

**Verified server facts (`zoho-middleware/routes/pos.js`):**
1. Non-custom lines: `rate = catalogItem.rate` ("authoritative price from catalog", ~:640 sale, ~:1311 confirm). A client-sent `$0` for a can is ignored and the can is invoiced at its catalog rate. **A new server-validated line kind is mandatory.**
2. Custom lines: hard-coded `tax_percentage: taxable ? 5 : 0`, `tax_id = resolveGstTaxId(catalogMap)` (5% services-rule id) in `/api/kiosk/sale` (:590-611) and `/api/kiosk/sale/confirm` (:1264-1290). The client's `item.tax_percentage` is NOT trusted; a client-side 12% would show 12% but be charged/invoiced 5% -> `client_grand_total` mismatch rejection (HTTP 400, no charge; or on confirm, void machinery).
3. `computeTax` (:221) groups by numeric rate then rounds per group; custom lines feed `addTax(li.tax_percentage, discountedLineTotal(li))`. A 12% custom line pools with `can-473`/kit-fee 12% lines in key `"12"`, matching `kioskCalcTotals` per-group rounding (`kiosk-core.js:~870-930`) and Zoho `entity_level`.
4. Discounts: server `resolveDiscount` skips `li.custom` at :146/:155/:168 -> bundle line non-discountable (D-14) with no code change. The `$0` can line is a non-custom line and WOULD enter discount allocation; with a fixed discount, the "last matched line absorbs the remainder" logic (`allocateFixedDiscount` :77, client `kioskCalcTotals` :~865) caps it at the line total (0) while `discountAmount` stays the full fixed value - a client/server-consistent but tax-skewing quirk if the $0 line is last in cart key order. D-14 forbids changing discount code, so pin it with a regression test (bundle + kit + fixed discount) and insert the can line BEFORE other lines or exclude `bundle_can` lines in a way that needs owner sign-off if the test shows drift.
5. Stock relief: `decrementStock` (`lib/inventory-ledger.js:105`, only when `INVENTORY_LEDGER_ENABLED==='true'`) and the Zoho invoice both key on `item_id` + `quantity`, rate-agnostic; custom lines (no `item_id`) are skipped. So a `$0` can line at qty N relieves N. The kiosk catalog (`catalog.js rebuildKioskCatalog`) includes every item with `rate > 0`, so `can-473` (item `109900000001175056`) and `can-355` (`109900000001175045`) are present with `tax_percentage` 12 resolved via the standard rule; the client finds them by SKU like `kioskFindMakersFee` (`kiosk-core.js:749`, upper-case compare).
6. Pre-charge assertion (`processSaleWithPrices` ~:683+): `client_grand_total` vs server `grandTotal`, +/-$0.01, rejects before the Helcim charge and releases the idempotency lock. This is the safety net that makes a mismatch fail closed.
7. Both rebuild sites exist because the client re-sends `items` to `/sale/confirm` after terminal approval. Any new line kind must be implemented in a shared helper and called from both (recipe sale has its own `buildRecipeLineItems`; do not touch).

**Recommended server contract (planner to confirm in a design plan; owner-visible):**
- Bundle line: `{custom:true, bundle_key:'beer-25'|'cider-23', description, quantity:1}`; server IGNORES client `rate`/`taxable`, sets rate from a server table ($40/$35), `tax_percentage:12`, `tax_id = process.env.ZOHO_TAX_STANDARD_ID` (fallback: auto-discover from catalog the way `resolveGstTaxId` does, matching `sales_tax_rule_id === ZOHO_TAX_STANDARD_RULE`), description sanitised like existing custom lines. Fail closed (400) if the id cannot be resolved (same message style).
- Can line: `{item_id, bundle_can:true, quantity:N}`; server requires the item's catalog SKU in {`can-473`,`can-355`} (case-insensitive), integer `1 <= N <= 100` (cap overrides allowed, D-12), forces `rate:0`, still sets `tax_id` from the catalog item. Require that a bundle line is present in the same cart (reject orphan `$0` cans, which would be a free-goods exploit).
- Keep `grandTotal <= 0` rejection (:684) in mind: a bundle-only cart has total > 0; a can-only cart is rejected by the pairing rule anyway.
- Bundle price table lives in server code (one module shared by sale and confirm) and is mirrored client-side for display; client constants must be pinned by a parity test.

**Client (kiosk-core.js / kiosk.js / kiosk.html):**
- Cart is `{ key: {item, qty} }` read through `_kcEnv.getCart()`. Fee lines are keyed by catalog `item_id`; custom lines by `'custom-N'` (`kiosk.js:~893`). Use fixed keys (`bundle-line`, `bundle-can`) so there is at most one bundle per cart, or a counter if multiple bundles per sale must be supported (Open Question 5).
- Bundle can line must be a **shallow copy** of the catalog product with `rate:0` (never mutate the shared catalog object: cart entries hold references to catalog items, comment at `kiosk-core.js:~2604`, and the product grid reads `rate`). Mark with `bundle_can:true`; bundle line `custom:true, bundle_key, tax_percentage:12, taxable:true`.
- Items payload builder (`kiosk-core.js:2640-2670`): custom branch forwards `description/note/quantity/rate/taxable`; add `bundle_key` pass-through for the bundle line and `bundle_can` for the can line (server remains authoritative). The 57-03 phantom-guard (:2685-2697) skips custom lines and checks `kioskFindProductById` for the can item (fine: it is a real catalog item).
- Lifecycle hooks: `kioskRemoveFromCart` (:2060), `kioskSetQty` (:2052), `kioskAddToCart` (:2018), `kioskClearCart` (:2082), qty +/- and input handlers (:2227-2260) are generic by key. Add: removing either bundle key deletes both; qty +/- on the bundle line is a no-op (force qty 1; hide the stepper); qty edits on the can line re-run the cap check (warn via the existing inline-warning idiom; `kioskCheckStockOverflow` uses `confirm()` for stock - consider a non-modal inline warning for the cap per D-12). Discount interplay: client skips `item.custom` (:834) so no client change.
- `KioskCore` is a singleton exported for tests (`_setCart`, `calcTotals`, `syncKitFees` ... `kiosk-core.js:~5739`); add `addCanningBundle` / `removeCanningBundle` exports so jest can drive it without DOM.
- kiosk-core.js is shared by `kiosk.html` and `admin.html` (embedded kiosk panel) - `kiosk-core-parity.test.js` asserts both surfaces send identical sale bodies; the bundle button markup must exist in both surfaces or be injected by core. Both pages need the picker DOM (kiosk.js owns the custom-item modal at `kiosk.js:762`; admin.js has its own env) - Open Question 6.

**Copy (D-18):** `custom-labels.html:161` is the only occurrence of "84 cans" (grep over html/js/md excluding planning/handoffs). `custom-labels.html` is in the `stamp:pages` list so the final `npm run build` re-stamps it.

### D - Recipe pickers

**Five pickers share one pattern** (`fetch('/api/recipes?status=active')`, lazy `_catalog`, `filter(name+style contains term).slice(0, 15)`, `mousedown`/`touchstart` select):
| Surface | Location | In D-19? |
|---------|----------|----------|
| New-batch Recipes tab | `brewpad.js:7683 bindRecipePickerSearch` (shares the product input with the kit search; dropdown opens on `focus` only when `_productPickerTab==='recipes'`) | yes |
| Attach recipe | `brewpad.js:5245-5355` (input `focus` already opens) | yes |
| Waitlist per-row attach | `brewpad.js:8884` (`_waitlistRecipeCatalog`) | no (same defect) |
| Waitlist manual-add | `brewpad.js:9241` (shares `_waitlistRecipeCatalog`) | no (same defect) |
| Kiosk recipe mode | `kiosk-core.js:1109 kioskLoadRecipes`, `:1173 kioskRenderRecipes` - the grid already renders ALL active recipes with no cap; D-19 wants a dropdown/search ABOVE the grid. Markup: `kiosk.html:127` `#kiosk-recipe-grid` | yes |

Recommended: pure helper (sort by name case-insensitive, filter by name+style, `findNameMatches(list, name)` returning exact/near matches) in a new `js/lib/recipe-picker.js` with UMD-style `module.exports` for jest (pattern: `js/lib/recipe-grouping.js`, loaded via `<script>` in `brewpad.html:20`, `kiosk.html:32`, `admin.html:1161`), plus one shared dropdown renderer inside the BrewPad IIFE used by the 2 D-19 pickers (and, at near-zero cost, the 2 waitlist ones - Open Question 4). The CSS list already scrolls (`.bp-vessel-dropdown` `max-height:200px; overflow-y:auto`, `css/brewpad.css:825`); the user-visible change is dropping `.slice(0,15)` and adding a `click` listener (on iPad Safari a tap on an already-focused input does not re-fire `focus`). ~10-13 active recipes exist today [CITED: 89-RESEARCH.md, 85 snapshot: 10 recipes / 117 ingredients on prod; 13 / 145 on staging], so design for ~100 but no virtualisation. Keep ES5 (no arrow functions/let/const/template literals; eslint config applies to `js/`).

**Recipe editor (D-21):** BrewPad editor name field `#bp-recipe-name` (`brewpad.html:181`), populate at `brewpad.js:2745`, new-recipe mode at `openRecipeDetail(null)` (:2703); admin editor `#recipe-name` (`admin.html:567`), `openRecipeDetail(null)` at `admin.js:8610`. Both editors already have a clone path: BrewPad `bpCloneRecipe` (:3093) clones the CURRENTLY OPEN recipe via `bpCloneRecipePayload(recipe, ingredients)` (pure, deep-copies, sets `Copy of ...`, `status:'draft'`); admin `duplicateRecipe` (`admin.js:~9200`) does the same in place. "Start from this recipe" for a DIFFERENT existing recipe therefore needs: fetch `GET /api/recipes/:id` (returns `{recipe, ingredients}`, as `openRecipeDetail` does at :2704-2720) -> `bpCloneRecipePayload` -> same populate/render calls `bpCloneRecipe` uses. D-21's mention of `kioskSaveAsNewRecipe` (admin.js:11726) refers to the kiosk-panel "save modified ingredients as new recipe" flow, not the Recipes editor; it is not the right reuse target for the editor. The duplicate-check list: reuse `_recipesState.list` when the Recipes list view has loaded (it holds the status filter's rows, may be partial) or fetch `status=all` once (precedent `ensureRecipeListForSched`, `brewpad.js:9612`). Warn on case-insensitive trimmed exact match; show near matches (contains). Starting from a recipe overwrites any ingredients already typed - confirm via `showConfirmSheet` when the form is dirty. Phase 89 added `beer_category` to `bpCloneRecipePayload` already (:3064).

### Anti-Patterns to Avoid
- **Reusing `handleSoSelect` for Confirm** - overwrites customer/product (see A2).
- **Sending a client-chosen price/tax_id for the bundle** - server must own both (money path invariant stated in `pos.js:318-331`).
- **Mutating the shared catalog item to rate 0** for the can line.
- **Validating the `source` transition after location writes** in `updateBatch` (partial writes).
- **Treating a failed `fetchLiveBatchIndex` (null) as "not linked".**
- **Writing links on staging against real batches** (shared workbook/Zoho) - see Pitfall 8.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Invoice -> batches reverse index | New get_batches walker | `brewpadIntegration.fetchLiveBatchIndex()` | Already store-mode aware (sheets/postgres), null-on-failure contract |
| cf_batch_status label for N batches | New label logic | `/api/batch/reconcile-invoice-status` (`reconcileInvoiceBatchStatus`) | Handles "N batches", clear/resync, status mapping |
| Kit/Maker's-Fee detection | Regex on names | `detectKitItems`, `checkoutHelpers.findMakersFeeItem` (honours `MAKERS_FEE_ITEM_ID`) | Existing, tested; INV-000137 history |
| Per-rate-group tax rounding | Sum-then-round | `computeTax` (server) / `kioskCalcTotals` (client) | Zoho `entity_level`; INV-000226 drift incident |
| Zoho retries / 429 | Custom retry | `zohoGet` -> `withRetry` | Handles Retry-After, code 1070, daily-quota code 45 |
| Clone a recipe | Custom copy | `bpCloneRecipePayload` | Pure, tested (`brewpad-recipe-list-clone.test.js`), includes beer_category |
| Confirm dialogs in BrewPad | `window.confirm` | `showConfirmSheet` | brewpad.js uses zero native confirms |
| Cache invalidation after batch write | Manual flag resets | `afterBatchWrite` | Handles session snapshot, preload race, detail refresh |
| Idempotent double-tap | Custom debounce | disabled submit button (existing) + server dedup | Already present |

**Key insight:** every hard sub-problem here (reverse index, label sync, tax rounding, clone, confirm UX) already has a tested helper; the phase risk is in the two places the helpers do NOT yet cover: server-side bundle/can line kinds, and the `source` guard in two stores.

## Runtime State Inventory

Not a rename/refactor phase, but one data-state item applies:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Batches sheet/PG rows: 82 legacy rows with blank `source`; 57 unlinked rows (33 manual + 24 blank). No data migration is needed for `'internal'` (free text). | None for deploy; backfill is human-driven through the UI. Guard must allow blank->`manual`/`internal`. |
| Live service config | Zoho `cf_batch_status` on invoices is written by link actions. Staging shares the Zoho org and the workbook with prod. | UAT with throwaway data only (Pitfall 8). |
| OS-registered state | None | None - verified: no scheduler/service names embed `source`. |
| Secrets/env vars | `ZOHO_TAX_STANDARD_ID` / `ZOHO_TAX_STANDARD_RULE` (read by `taxes.js`/`pos.js`); `MAKERS_FEE_ITEM_ID`; `ZOHO_CF_BATCH_STATUS`. Bundle needs the standard tax id to be set in Railway for BOTH envs (or catalog auto-discovery). | Verify env var presence per environment in Wave 0 (names only, never values). |
| Build artifacts | `js/brewpad.min.js`, `js/kiosk-core.min.js`, `js/kiosk.min.js`, `js/admin.min.js`, html `?v=` tokens | One `npm run build` at the end; `scripts/check-artifact-drift.sh` must pass. |

## Common Pitfalls

### Pitfall 1: Bundle shipped client-only
**What goes wrong:** Client shows $40 + 12% and a $0 can line; server re-prices the can at catalog rate and taxes the custom line at 5% -> `client_grand_total` mismatch (sale rejected) or, worse, if the assertion were skipped (old cached JS omits it), an invoice that differs from what was charged.
**Why:** `pos.js` anchors non-custom rates to the catalog and hard-codes custom tax 5/0.
**Avoid:** Server-side bundle/can line kinds in sale AND confirm, test-first (`pos-custom-line.test.js` style), plus client/server parity table test.
**Warning signs:** Any plan task that only edits `kiosk-core.js` for C.

### Pitfall 2: `source` guard rejects the legacy rows it exists to fix
**What goes wrong:** 82 batches have blank `source`; a strict "current must be manual|internal" check blocks "Mark internal" on 24 of the 57 unlinked batches.
**Avoid:** Treat `''` (and missing) as `manual`. Also hide "Mark internal" for locked sources (kiosk/kiosk_recipe/online/zoho_scan/research).

### Pitfall 3: duplicate_so_number on manual create-with-invoice
**What goes wrong:** Second manual batch for the same invoice+SKU (or any batch for the invoice when SKU is empty) is rejected; PG also loses the fingerprint replay protection once `zoho_so_number` is set.
**Avoid:** Handle `duplicate_so_number` explicitly in the create `.catch` (message names the existing batch ids), offer create-without-invoice-then-link, and show the D-09 warning in the picker. Do not silently retry.

### Pitfall 4: Validating late in Apps Script `updateBatch`
**What goes wrong:** VesselHistory append and vessel status flip happen (:2860-2890) before status validation; a source rejection placed after them leaves partial writes.
**Avoid:** Source decision first; pure function + test that no sheet write happens on rejection.

### Pitfall 5: Confirm overwrites batch identity
**What goes wrong:** Reusing `handleSoSelect` writes `product_name` = invoice line[0] name and the invoice's customer.
**Avoid:** Narrow `linkBatchToInvoice`; UAT assertion that product_name/customer are unchanged after Confirm.

### Pitfall 6: Candidate lookup hammering Zoho
**What goes wrong:** Detail fetch per invoice (sequential, ~1/s), daily quota (code 45) consumed by prefetching 57 batches.
**Avoid:** On-open only, cap detail fetches, Redis cache, surface 502 as "Zoho busy, try search".

### Pitfall 7: `fetchLiveBatchIndex` null treated as empty
**Avoid:** null -> "link status unknown" label; never claim "not linked" and never block Confirm on it (human decides).

### Pitfall 8: Staging writes hit production data
**What goes wrong:** Staging shares the Zoho org and the Google workbook; `BATCHES_STORE` is back on sheets on staging (87 rehearsal done) so `update_batch`/`create_batch` UAT writes real prod rows, and link actions PUT `cf_batch_status` on real invoices. Read-only candidate lookups are safe.
**Avoid:** UAT = create a throwaway batch with an obviously-test customer, link a known test invoice, delete after (`delete_batch` then `reconcile-invoice-status` clears the label). Never "Confirm" a real unlinked batch on staging; do the real backfill review on production after deploy (that is the actual deliverable).

### Pitfall 9: Apps Script redeploy is shared
**What goes wrong:** One Apps Script deployment serves staging and prod; the `source` guard goes live for both the moment it is deployed (v62 live, rollback v61 per Phase 87). Middleware PG path ships with the middleware deploy per env.
**Avoid:** Deploy order: Apps Script guard + middleware guard BEFORE the BrewPad build that sends `source`. An older script ignores `source` in `updates` silently (not in allowedFields), so a newer frontend against an older script would show success but not persist - verify via `get_batch` round-trip in the UAT.

### Pitfall 10: Kiosk cached JS
**What goes wrong:** Old cached kiosk JS omits `client_grand_total` or bundle fields; new server must tolerate old clients (assertion is skipped when absent) and reject orphan `bundle_can` lines.
**Avoid:** Server validation independent of client; `?v=` stamp via build.

### Pitfall 11: Fixed-discount + $0 line ordering (D above, C.4)
Pin with a test; do not change discount code (D-14).

### Pitfall 12: Recipe picker `focus` on iPad
Tap on an already-focused input doesn't refire `focus`; add `click`. The new-batch recipe picker shares the product text input with the kit picker (`_productPickerTab` guard) - keep that guard.

### Pitfall 13: Node version / Docker for gates
Local default Node is v20.20.2; project engines 24.x and the Phase 89 gate ran on Node 24 (`source ~/.nvm/nvm.sh && nvm use 24`; v24.21.0 installed). Real-PG DB suites need Docker (daemon is running here). Node 20.20 tzdata treats Vancouver as UTC-8 after 2026-11-01 (memory), so date-window tests must not depend on local TZ.

## Code Examples

Contracts only (no implementation; planner/executor write code test-first).

**Guard truth table (both stores):** `decide(current, next)`:
`next===current -> ok`; `current in {'', 'manual', 'internal'} && next in {'manual','internal'} -> ok`; else `{ok:false,error:'invalid_source'}`.

**Candidate endpoint response shape (proposal):**
`GET /api/batch/link-candidates?customer_id=&customer_name=&start_date=YYYY-MM-DD`
-> `{ candidates: [{ invoice_id, invoice_number, date, total, status, balance, customer_name, has_makers_fee, line_items:[{name,quantity,rate}], linked_batches:[ 'SV-B-000063' ] | null, date_distance_days }], index_available: bool }`.

**Bundle line wire format (proposal):**
`{custom:true, bundle_key:'beer-25', description:'Canning Bundle - Beer 25 L (473 mL)', quantity:1}` + `{item_id:'<can item id>', bundle_can:true, quantity:52}`; server table: `beer-25 -> $40`, `cider-23 -> $35`; can SKUs `can-473`, `can-355`; client-side caps beer 55/72, cider 50/68 (warn only).

**Totals check for the staging proof (D-17), beer bundle alone:** subtotal 40.00, 12% tax 4.80, total 44.80; invoice line qty = actual count at rate 0.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `can` discount alias missing | `can -> packaging` alias in both discount-match mirrors | `eaf0b8cc` (staging 2026-10-14) | Cans classify `ingredient:packaging`; no bundle dependency now |
| Flat 5% custom lines | Needs server bundle kind (this phase) | Phase 90 | Only way to carry 12% on an item-less line |
| Sheet-only batches | `BATCHES_STORE` sheets/postgres (no `dual` - refuses to boot) | Phase 87 | Every batch write needs a sheets AND a PG implementation; there is no "dual" mode for batches |

**Deprecated/outdated assumptions:** CONTEXT/ROADMAP say "sheets/dual/postgres" for batches; `batch-flag.js` shows `dual` is unsupported for batches (refuses to boot). Plan for sheets and postgres only. Prod batches are still on sheets (87-19 pending); staging currently on sheets.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Blank/missing `source` should be treated as `manual` (editable) | A1, Pitfall 2 | If owner wants blank rows locked, 24 unlinked legacy batches cannot be marked internal |
| A2 | Server should own bundle prices ($40/$35) and caps in a server table, ignoring client rate/taxable for bundle lines | C | If owner prefers env-configurable prices, add env override; client-only is rejected by the money-path invariant |
| A3 | Zoho list `/invoices` accepts `customer_id` + `date_start`/`date_end`; `customer_name` filter semantics (exact vs contains) unverified live | A2 | Candidate recall for batches without `customer_id` could be poor; needs a Wave 0 read-only probe |
| A4 | Add `customer_id` to the create_batch payload (not listed in D-01) | A1 | Low; improves future candidate matching. Skip if owner objects |
| A5 | Proxy-level coercion of `source` on create to `manual`/`internal` | A1 | Low; defence in depth. Omit if any staff flow legitimately sets another source via the proxy (none found: only brewpad.js:7596 calls create_batch) |
| A6 | "Not this" persisted in localStorage only | A2, Open Q3 | Dismissals not shared across devices/users; acceptable for an ephemeral review aid |
| A7 | Include non-Maker's-Fee invoices ranked after Maker's-Fee ones | A2 | If owner wants strict D-08 filtering, drop them; recall vs noise tradeoff |
| A8 | `ZOHO_TAX_STANDARD_ID` is set in both Railway envs (value not read here) | C | If unset, fall back to catalog auto-discovery; if both fail the bundle sale 400s (fail-closed) |
| A9 | ~10-13 active recipes today (prod snapshot 10, staging 13 as of 2026-10-07/13) | D | Scale argument only; design still handles ~100 |

## Open Questions (RESOLVED)

1. **Server contract for the bundle (owner-visible design choice)**
   - Known: server must own price, tax, can-line validity (above). Unknown: whether owner wants prices in code vs env, and one vs multiple bundles per cart.
   - Recommendation: constants module, single bundle per cart (fixed keys), revisit if two batches are canned in one sale.
   - RESOLVED: D-22 (owner, plan time): prices are server-side constants in `zoho-middleware/lib/kiosk-bundles.js`; one bundle per cart (Plans 90-02, 90-07).
2. **Customer resolution for the 57 legacy batches lacking `customer_id`**
   - Recommendation: Wave 0 read-only Zoho probe (`GET /invoices?customer_name=...` and contact search) on 2-3 known customers (e.g. Mercer, Lush, Lacheur from the false-positive list) to choose exact vs contains; document in plan.
   - RESOLVED: no blocking probe is needed. Plan 90-05 applies a server-side exact post-filter on the normalised customer name, so the route returns the right invoices whether Zoho's `customer_name` filter matches exactly or by "contains". The probe is optional during Plan 90-05 execution and is re-checked read-only on staging in Plan 90-11; its result is recorded in the SUMMARY, not used as a gate.
3. **Persistence of "Not this"** - localStorage (recommended) vs new column. Recommend localStorage; confirm with owner.
   - RESOLVED: the UI-SPEC default, accepted by the owner: localStorage only (key `bp-link-dismissed:<batchId>`), no schema change (Plan 90-06).
4. **Waitlist recipe pickers** (brewpad.js:8884, :9241) share the 15-cap defect but are not in D-19. Recommend including them if a shared dropdown function is built (near-zero marginal cost); otherwise leave and note.
   - RESOLVED: D-23 (owner, plan time): included (Plan 90-09).
5. **Embedded kiosk (admin.html) bundle button** - `kiosk-core.js` serves both surfaces; confirm whether the admin-embedded kiosk should expose the bundle (parity test says both surfaces build identical sale bodies).
   - RESOLVED: D-25 (owner, plan time): standalone `kiosk.html` only; the admin-embedded kiosk is unchanged (Plan 90-07).
6. **Mirror/replay:** the ops-mirror copies PG batch rows to the sheet in production only; `'internal'` is free text so no change, but confirm `batches-verify.js` treats `source` as plain text (spec `type:'text'`, verified).
   - RESOLVED: verified in the research body: `source` is plain text in `batches-verify.js` and has no CHECK/enum in PG, so no change is needed.
7. **Disabled batches in "Unlinked"** - exclude? (recommend yes).
   - RESOLVED: D-24 (owner, plan time): disabled and deleted batches are excluded (Plan 90-06).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node 24 (nvm) | gates, tzdata | yes | v24.21.0 installed (default shell is v20.20.2) | none - run gates on 24 |
| Docker daemon | real-PG jest (`npm run test:db`) | yes | Docker 28.0.2 (daemon responded) | STOP rather than skip (Phase 89 gate rule) |
| zoho-middleware/node_modules, root node_modules | tests | yes | - | `npm ci` |
| Zoho live API (read-only) | candidate probe | via Railway env only | - | mock in jest |
| Staging hardware terminal (Helcim) | D-17 | owner-provided | - | blocks production, not code |
| gemini CLI | - | broken (IneligibleTierError) | - | grep + Read (used) |

**Missing with no fallback:** staging terminal session is an owner-run gate for C (and for the pending recipe money-path work).

## Validation Architecture

> `workflow.nyquist_validation` is `false` in `.planning/config.json`, but the orchestrator explicitly requested this section.

### Test Framework
| Property | Value |
|----------|-------|
| Frontend | Jest 29 + jsdom, `jest.config.js`, `tests/frontend/**/*.test.js` (179 files) |
| Middleware | Jest 29 node, `zoho-middleware/__tests__/*.test.js` (route tests mock express/zoho-api/cache) |
| Real Postgres | `cd zoho-middleware && npm run test:db` -> `jest.db.config.js` (`__tests__/db/**`, Testcontainers, `describeDb` harness `__tests__/db/helpers/pg-harness`) |
| Apps Script | no runtime; slice functions out of `apps-script/adminApi.gs` via fs + vm (precedents: `tests/frontend/adminapi-phase82-locks.test.js`, `adminapi-acting-user.test.js`, `adminapi-batch-golden.test.js`); pure top-level functions are the testable seam |
| BrewPad seam | `module.exports` `_xForTest` additions at `brewpad.js:10944+` (`_adminApiPostForTest`, `_setRecipesListForTest`, ...) |
| Kiosk seam | `window.KioskCore` singleton via `require('../../js/kiosk.js')` after `jest.resetModules()`; `_setCart`, `calcTotals` (see `kiosk-tax-rounding-entity-level.test.js`) |
| Quick run | `npx jest tests/frontend/<file>` / `cd zoho-middleware && npx jest __tests__/<file>` |
| Full suite | `npm test && npm run lint` and `cd zoho-middleware && npm test` (CLAUDE.md rule 1/2/7); DB: `npm run test:db` (Docker, Node 24) |

### Phase Requirements -> Test Map
| Req | Behavior | Test Type | Command / New file | Exists? |
|-----|----------|-----------|--------------------|---------|
| D-04/D-05 | pure `batchSourceTransitionDecision` truth table incl. blank, locked sources | unit (gs slice) | `tests/frontend/adminapi-batch-source-edit.test.js` | Wave 0 |
| D-05 | `updateBatch` rejects bad transition BEFORE any sheet write; accepts manual<->internal; no-op same value | unit (gs, stubbed sheet) | same file | Wave 0 |
| D-05 | `batch-rules.sourceTransitionDecision` parity with gs fn | unit | `zoho-middleware/__tests__/batch-rules-source.test.js` | Wave 0 |
| D-05 | PG `updateBatch` source accept/reject, nothing written on reject, blank row editable | real-PG | `__tests__/db/batch-pg-update.test.js` (add cases; do not edit existing) -> prefer new `batch-pg-update-source.test.js` | Wave 0 |
| D-04 | PG create with `source:'internal'` persists and round-trips `get_batch` | real-PG | new `__tests__/db/batch-pg-create-internal.test.js` | Wave 0 |
| D-01 / handoff AC | `create_batch` with `zoho_so_number` persists and round-trips (sheets via golden-style slice; PG via db test); duplicate_so_number surfaced | unit + real-PG | extend as new files | Wave 0 |
| D-01..D-03 | create payload includes `zoho_so_number`, `customer_id`, `source:'internal'` when checked; confirm sheet when both empty; picker prefill | jsdom | `tests/frontend/brewpad-create-invoice-link.test.js` | Wave 0 |
| D-02 | `fetchSoSearch` parameterised; detail-view behaviour unchanged (characterization first) | jsdom | `tests/frontend/brewpad-so-search.test.js` | Wave 0 |
| D-06 | `filterBatchesByUnlinked` (blank source counts, internal excluded, all statuses) + chip count | unit | `tests/frontend/brewpad-unlinked-filter.test.js` | Wave 0 |
| D-07/D-10 | Confirm writes ONLY `zoho_so_number`, then reconcile; no write without tap; Not this hides; Mark internal hidden for locked sources | jsdom | `tests/frontend/brewpad-link-review.test.js` | Wave 0 |
| D-08/D-09 | link-candidates route: window math, kit flag, ranking, status filter incl. overdue/partially_paid, linked_batches, index-null path, detail-fetch cap, input validation, auth tier | route unit | `zoho-middleware/__tests__/batch-link-candidates.test.js` (model on `batch-scan-invoices.test.js`, `batch-search-invoices.test.js`) | Wave 0 |
| D-11/D-15 | server: bundle line price/tax 12%/tax_id, ignores client rate/taxable; can line forced $0, SKU allow-list, orphan can rejected; BOTH `/sale` and `/sale/confirm`; tax rounding with mixed 12% lines; grand total | route unit | `zoho-middleware/__tests__/pos-canning-bundle.test.js` (model `pos-custom-line.test.js`, `pos-tax-rounding-entity-level.test.js`) | Wave 0 |
| D-14 | bundle not discounted client + server (cart + type discount, fixed discount ordering with $0 line) | unit both sides | same + `tests/frontend/kiosk-canning-bundle.test.js` | Wave 0 |
| D-11/D-12/D-16 | add pair, count edit only touches can line, cap warning + override, remove either removes both, clear cart | jsdom KioskCore | `tests/frontend/kiosk-canning-bundle.test.js` | Wave 0 |
| D-15 | client/server constants parity (prices, caps, nominal counts) and client total == server total for the same cart | cross-check | both files above | Wave 0 |
| D-17 | real terminal sale: invoice shows bundle + 12% tax, can qty = actual | manual (owner, staging hardware) | checkpoint task | manual-only (hardware) |
| D-18 | custom-labels copy no longer contains "84 cans"; contains 70 x 355 / 52 x 473 | static grep test | `tests/frontend/custom-labels-copy.test.js` | Wave 0 |
| D-19/D-20 | shared helper sort/filter, no cap, N>15 all returned; pickers open on focus+click | unit + jsdom | `tests/frontend/recipe-picker.test.js`, `brewpad-recipe-picker-full-list.test.js`, `kiosk-recipe-picker.test.js` | Wave 0 |
| D-21 | editor duplicate-name warning (case/trim), "Start from this recipe" fetches detail and populates via `bpCloneRecipePayload`, dirty-form confirm; admin parity | jsdom | `tests/frontend/brewpad-recipe-start-from.test.js`, `admin-recipe-start-from.test.js` | Wave 0 |

### Sampling Rate
- **Per task commit:** the single new/affected test file + `npm run lint`.
- **Per wave merge:** root `npm test` and `cd zoho-middleware && npm test` (rule 7 - shared utils touched); middleware `npm run lint`/`migrate:guard` if migrations untouched (none planned).
- **Phase gate (final plan, modelled on 89-08):** one `npm run build` on Node 24 AFTER all code plans; `scripts/check-artifact-drift.sh`; root + middleware suites; `npm run test:db` with Docker; no hand edits to `js/main*.js`/`*.min.js`; stage only intended files (never `links.html`, `HANDOFF-*.md`, `.planning/phases/90-*` per 89-08 rule).

### Wave 0 Gaps
- [ ] All new test files above (none exist).
- [ ] Characterization tests for `fetchSoSearch`/`handleSoSelect` BEFORE refactor (none today).
- [ ] Read-only Zoho probe script/notes for A3 (customer filter semantics).
- [ ] Env presence check (names only) for `ZOHO_TAX_STANDARD_ID`, `MAKERS_FEE_ITEM_ID`, `ZOHO_CF_BATCH_STATUS` in staging/prod Railway.
- Existing tests must stay unmodified (CLAUDE.md rule 10) - add new files rather than editing `batch-pg-update.test.js`, `pos-custom-line.test.js`, etc.

## Security Domain

`security_enforcement` is enabled (absent/true), ASVS level 1, block on high.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no change | existing `authTiers.requireTiers(['legacy','session'])` on the new GET route |
| V3 Session Management | no change | session cookie; device tier excluded for BrewPad routes |
| V4 Access Control | yes | New route session-tier only; kiosk bundle lines honoured only on sale routes already gated by device/session; `source` guard server-side |
| V5 Input Validation | yes | validate `customer_id` (digits), `start_date` regex, `customer_name` length, `bundle_key` enum, `item_id` allow-list, integer qty bounds; sanitise descriptions like existing custom lines (strip control chars, <=100) |
| V6 Cryptography | no | none |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Client-forged bundle price / tax / free cans | Tampering | Server-owned price table + tax_id; `$0` only for allow-listed can SKUs paired with a bundle; `client_grand_total` assertion |
| Staff-set `source:'kiosk'` to hide from the Unlinked audit / bypass guard | Tampering | Transition guard in both stores; optional create-path coercion |
| Zoho quota exhaustion via candidate endpoint | DoS | Hard detail-fetch cap not request-controlled, cache, on-open only (precedent `MAX_DETAIL_FETCH`, `MAX_PAGES`) |
| Path/param injection into Zoho query (`customer_id`, name) | Tampering | Regex-validate ids, pass as `params` (axios encodes), never concatenate paths |
| Unattended link writes | Tampering/Integrity | D-10: no endpoint writes links; all writes are explicit `update_batch` from a tap |
| PII in logs/caches | Info disclosure | Do not log customer names in the new route (repo eventLog is zero-PII); cache key uses ids/hash |

CSP: no new third-party domain is introduced (rule 12 not triggered); any new `<script src="js/lib/recipe-picker.js">` is same-origin.

## Project Constraints (from CLAUDE.md)
- Run `npm test` AND `cd zoho-middleware && npm test`, and `npm run lint`, before every commit; one logical change per commit; regression test first for bug fixes.
- Read code/tests before modifying; grep all usages before changing a function; after changing shared utilities (`js/lib/*.js`, `zoho-middleware/lib/*.js`) run the FULL suites for both.
- Never edit `js/main.js`, `js/main.min.js` (or other built artifacts); edit sources, then `npm run build`. brewpad.js/kiosk-core.js/kiosk.js/admin.js are standalone sources whose `.min.js` are build outputs.
- Do NOT modify existing tests unless explicitly asked.
- Never commit `.env`/credentials. Every public HTML page has a CSP `<meta>`; no new third party here.
- Middleware has its own `node_modules`; always `cd zoho-middleware` first.
- ES5 only in browser JS. Staging first; production only after staging approval; `git push production main --force` only on owner instruction.
- Global instructions: ask/flag rather than assume; simplest solution; do not touch unrelated code (surface smells instead). Smells surfaced here: `handleSoSelect` overwriting product/customer, 5 copy-pasted recipe pickers, create path not sending `customer_id`, `updateBatch` writing history before validation, CONTEXT listing `dual` for batches though it is unsupported.

## Deploy / Proof Constraints (summary for the planner)
- **Order:** (1) Apps Script `updateBatch` guard (shared prod+staging deployment, rollback = previous version) and middleware (PG guard, new route, bundle server kinds) -> (2) frontend build. A new frontend against an old script silently drops `source` updates (field not in allowedFields), so UAT must read back via `get_batch`.
- **Per-env store:** prod batches = sheets until 87-19; staging = sheets (rehearsal flipped back). Both code paths must be implemented and tested; PG path proven by `test:db`.
- **Staging data safety:** shared Zoho org + workbook -> read-only candidate probing OK; create/link/Confirm writes only on throwaway batches; the real 57-batch review happens on production after deploy.
- **D-17:** one staging terminal session proves recipe money-path (auto + manual confirm) AND a bundle sale (invoice: bundle + 12% tax, can qty = actual, status Paid). The Zoho invoice `adjustment` field from the recipe work is separate. Promote together/back-to-back; production deploy of the kiosk server changes also carries `BEER`-era env fixes already pending (`--skip-deploys` set) - flag, do not touch.
- **Related pending prod work not to disturb:** 85-13 pinned `d2c66be9:main` push (memory/STATE); this phase must not be pushed to production via a path that bypasses that pin without the owner.

## Sources

### Primary (HIGH confidence) - live repository, this session
- `js/brewpad.js` (lines cited inline), `js/kiosk-core.js`, `js/kiosk.js`, `js/admin.js`, `kiosk.html`, `brewpad.html`, `admin.html`, `css/brewpad.css`
- `apps-script/adminApi.gs` (createBatch/updateBatch/getBatches/batchDedupDecision)
- `zoho-middleware/routes/pos.js`, `lib/batch-store.js`, `batch-proxy.js`, `batch-flag.js`, `batch-pg-create.js`, `batch-pg-update.js`, `batch-pg-read.js`, `batch-rules.js`, `brewpad-integration.js`, `zoho-api.js`, `inventory-ledger.js`, `routes/catalog.js`, `routes/recipes.js`
- `zoho-middleware/migrations/0005_batches.sql`, `scripts/backfill/specs/batches.js`
- `.planning/phases/90-*/90-CONTEXT.md`, `90-NOTES.md`, HANDOFF-batch-invoice-linking / kiosk-canning-bundle, `.planning/STATE.md`, `ROADMAP.md`, Phase 89 `89-08-PLAN.md`, `89-RESEARCH.md`, `package.json`, `jest*.config.js`
- Project memory notes (phase-87-batches-status, kiosk-recipe-confirm-verification)

### Secondary (MEDIUM confidence)
- [Zoho Books API v3 Invoices - list parameters](https://www.zoho.com/books/api/v3/invoices/) - `customer_id`, `customer_name`, `date_start/date_end`, `date_after/before`, `status` values, `per_page` max 200, `sort_column` values, `search_text` (fetched via WebFetch summary; `customer_name` match semantics not stated)

### Tertiary (LOW confidence)
- None relied on.

## Metadata

**Confidence breakdown:**
- Standard stack / reuse inventory: HIGH - every reused function opened and read.
- Architecture (A, D): HIGH. (C): HIGH on the server gaps (read at the line level), MEDIUM on the exact server contract (a design decision for the owner/planner).
- Pitfalls: HIGH for code-derived; MEDIUM for Zoho customer-name filter behaviour (A3).

**Research date:** 2026-10-14
**Valid until:** 2026-10-28 (fast-moving: pos.js and brewpad.js are edited weekly; line numbers will drift - re-grep symbol names)
