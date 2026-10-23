# Phase 94: Dashboard correctness and data foundations - Context

**Gathered:** 2026-10-23
**Status:** Ready for planning. Build gated on the Phase 87 production cutover (D-01).

<domain>
## Phase Boundary

Every number on the BrewPad dashboard is correct and consistent, and every batch carries an explicit
type. This phase covers the owner-approved handoff items (§7, ticked 2026-10-23):

- **B1:** cycle-time KPI fix.
- **B2:** `completed_at` backfill for legacy completed batches (production data write).
- **B3:** explicit `batch_type`, set on create and backfilled (production data write).
- **D1:** one dashboard data layer, classifier and date-window helper.
- **S1:** a server-side aggregate replacing the per-batch N+1 `get_batch` calls.

Not in this phase: filters, the chart library, new graphs, beer/cider sections, alerts, and the
responsive/performance pass. Those are Phases 95–99.

</domain>

<decisions>
## Implementation Decisions

### Scope and timing
- **D-01:** Plan now; **build after the Phase 87 batches→Postgres production cutover**. B3 (`batch_type` column) and S1 (aggregate endpoint) target the Postgres batch store only. They do not need to work under `BATCHES_STORE=sheets`, which resolves the 87 collision noted in ROADMAP. If 87 is delayed, Phase 94 waits rather than building dual-mode.
- **D-02:** Approved items are B1, B2, B3, D1 and S1. Every other §7 item stays out of scope until its own phase's discuss step.
- **D-03:** The corrected numbers (B1, D1) go **live on the current dashboard** as soon as Phase 94 ships. They are not behind `?dash=v2`. The `?dash=v2` flag is for the Phase 95+ redesign.

### Batch type (B3)
- **D-04:** Types are `wine | beer | cider | seltzer | other`. Seltzer stays because BrewPad's schedules and month chart already use it (`KNOWN_BATCH_TYPES`, js/brewpad.js:299).
- **D-05:** Automatic derivation order, first match wins:
  1. recipe `style`, for a recipe-linked batch;
  2. Zoho product `cf_type` by SKU/item_id, **never by product name**;
  3. fermentation schedule category, the signal today's `resolveBatchType` uses;
  4. product-name fallback;
  5. `other`.
- **D-06:** Staff can **edit the type on the batch** in the detail pane. A hand-set type is recorded as such, e.g. `batch_type_source = 'manual'`. Automatic rules and backfills **never overwrite** a manual type.
- **D-07:** When no rule matches, save as `other` and list the batch on a **"needs a type"** list so staff can correct it. Unknown type **never blocks** batch creation (kiosk, online, zoho_scan or manual).
- **D-08:** Set the type on create for every path: kiosk, kiosk_recipe, online, zoho_scan and manual. Record which rule decided it (`batch_type_source`: recipe | zoho | schedule | name | other | manual).
- **D-09:** The existing-rows backfill is a production write. It ships as a `--dry-run` script that lists **every** batch with its proposed type and deciding rule. The owner reviews the full list in-session, then OKs the real run.

### Cycle time (B1)
- **D-10:** Cycle time = `completed_at − start_date`, counted only for batches that have `completed_at`. Start is the batch's `start_date`, not `created_at`.
- **D-11:** Tile layout:
  - The big number is the **median** days.
  - Beside it: the **mean**, and "based on N batches, M excluded" (completed but no `completed_at`).
  - Below it: a small row per type (e.g. Wine 63d · Beer 24d · Cider 30d). Types with no completed batches are hidden.
- **D-12:** Staff/family and `source: research` batches **count** toward cycle time (production metric).
- **D-13:** Acceptance: the median and mean are within ±1 day of an independent recompute from the batch data. The handoff's baseline is mean 63 and median 64 over 125 batches; the current tile wrongly shows 173.

### Completed-date backfill (B2)
- **D-14:** Source is the **latest task `completed_at`** on the batch. If a batch has no completed task, **leave `completed_at` blank** and it stays excluded. **No `last_updated` fallback**, because it often reflects unrelated edits.
- **D-15:** Backfilled dates are marked as estimated with a source field, e.g. `completed_at_source = 'backfill-task'`, so they can be told apart from real completions and excluded later.
- **D-16:** Ships as a `--dry-run` script listing every batch with its proposed date and source. The owner reviews the full list in-session, then OKs the real run. Writes go through the batch store's update path with nested `updates:{}`.

### Totals and the data layer (D1)
- **D-17:** Totals count **started batches only**: primary, secondary and complete. Pending, disabled and deleted are excluded. Pending keeps its own count where the dashboard already shows one.
- **D-18:** Month and year bucketing uses **`start_date`** for "started" counts and **`completed_at`** for "completed" counts.
- **D-19:** "This year" is the **calendar year**, Jan 1 to today, in America/Vancouver time.
- **D-20:** One `getDashboardData(filters)` layer, one classifier using the stored `batch_type`, and one date-window helper feed every widget. Type totals must agree across widgets by construction; this fixes F4 (120 vs 122 vs 204).

### Server aggregate (S1)
- **D-21:** The dashboard loads from one lean aggregate call through the admin-proxy seam, cached about 60 s. It replaces the per-batch `get_batch` N+1. It returns lean rows: id, type, status, dates, vessel, source, product, subcategory, volume, task due/complete dates, latest reading. Postgres-backed per D-01.

### Post-research decisions (owner, 2026-10-23, during plan-phase)
- **D-22:** Recipe rule (D-05 rule 1) = recipe `beer_category` present → `beer`; otherwise only **exact style-word matches** (e.g. `cider`, `wine`, `seltzer`, `beer`) decide; no broad style inference (IPA/lager/merlot guessing). Anything else falls through to rule 2 (Zoho `cf_type`). Resolves RESEARCH Open Question 1 consistently with Phase 89's rejection of style inference.
- **D-23:** `updateBatch` stamps `completed_at` (only when blank) when status changes to `complete`, e.g. from the BrewPad status badge, so the B2 gap does not regrow. The source marker is `completed_at_source = 'status'` (or equivalent). A regression test comes first. This is a deliberate, approved change to the Phase 87 batch store module.
- **D-24:** The cycle-time tile covers the **calendar year to date** (America/Vancouver), using the shared date-window helper (D-19/D-20), and is bucketed by `completed_at` (D-18).

### Claude's Discretion
- Field names for the source markers (`batch_type_source`, `completed_at_source`) and the migration shape. These follow the existing migration conventions (`zoho-middleware/migrations/000N_*.sql`) and the Apps Script mirror column rules.
- Whether S1 extends the existing `get_batch_dashboard_summary` / `getDashboardSummary` path or adds a new action.
- Exactly how the "needs a type" list surfaces in Phase 94. A minimal list or filter is enough; the full data-health card is G10 in Phase 96.
- Recipe `style` → type mapping details. Use recipe `beer_category` from Phase 89 where present.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Source handoff
- `.planning/research/brewpad-dashboard-v2.md`. The owner's handoff:
  - §2: current dashboard and available data.
  - §3: data findings F1–F10.
  - §4 Phase A: B1, B2, B3, D1, S1.
  - §5: constraints. Classify by `cf_type`/SKU, never name. Staff batches. No writes without an OK. `--dry-run`.
  - §7: approvals, with the 2026-10-23 owner note.

### Roadmap and phase interactions
- `.planning/ROADMAP.md`: "Phase 94: Dashboard correctness and data foundations" (draft success criteria), and the v5.0 milestone header (phasing and the 87 interaction).
- `.planning/phases/87-batches-batchtasks-platoreadings-vesselhistory-postgres/`: the batch store design, mirror, and cutover runsheet. Phase 94 builds on its Postgres batch store (D-01).
- `.planning/phases/89-*/`: recipe `beer_category` (input to type derivation).

### Infrastructure and conventions
- `HANDOFF-infrastructure.md`: stack, build and deploy. Untracked, at the repo root.
- `docs/RUNBOOK.md`: Phase 87 sections on batch store flags, the mirror, and rollback.
- `CLAUDE.md`: test, lint and build rules. Never edit `js/brewpad.min.js` by hand. CSP rule.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `js/brewpad.js:299-357`: `KNOWN_BATCH_TYPES`, `buildScheduleCategoryById`, `resolveBatchType` (category → schedule → snapshot → other). This becomes the client-side fallback or is replaced by the stored `batch_type`. Its schedule step is rule 3 of D-05.
- `js/brewpad.js:358`: `bucketBatchesByMonthType`, the month bucketing for the chart. It should move onto the shared date-window helper (D-20).
- `js/brewpad.js:3939-4060`: `loadDashboard` / `renderDashboard`. The cycle-time bug is at lines ~4015–4034 (`completedWithDays` / `avgDays`).
- `zoho-middleware/lib/batch-pg-read.js`: `getDashboardSummary` (`DASHBOARD_BATCHES_SQL` + `ACTIVE_BATCH_TASKS_SQL`) and `listBatches`. This is the natural home for the S1 aggregate.
- `zoho-middleware/lib/batch-rules.js:743`: `buildDashboardSummary`, the shared summary builder. Sheets and Postgres parity rules live here.
- `zoho-middleware/lib/batch-proxy.js`: `ACTION_TO_OP` routes admin-proxy actions such as `get_batch_dashboard_summary` to the batch store.

### Established Patterns
- **Admin-proxy seam.** BrewPad calls `/api/batch/admin-proxy` with an action. The middleware answers from Postgres when the store flag is on, and writes are mirrored to the Sheet.
- **Additive migrations** in `zoho-middleware/migrations/`. The Sheet mirror needs new columns added to the Batches tab header; the missing-header reject trap was seen in Phase 89.
- **Backfill CLIs** run in-container with `--dry-run` / `--promote` and print ids, counts and field names only (Phase 85–87 pattern).
- **Frontend.** ES5, edit `js/brewpad.js`, then `npm run build`. Tests in `tests/frontend/` use the brewpad test seams (`_setStateForTest`, `getStateForTest`).

### Integration Points
- Batch create paths, for setting `batch_type` on create: kiosk sale, kiosk_recipe, online checkout, zoho_scan, and BrewPad manual create (`zoho-middleware/lib/brewpad-integration.js`, the routes, and the batch store create).
- BrewPad batch detail pane: the type edit control (D-06).
- The dashboard render: the cycle-time tile (D-11) and every total (D-17–D-20).

</code_context>

<specifics>
## Specific Ideas

- Today's wrong figures to verify against after the fix:
  - avg days to complete shows 173; the true mean is ~63 and the median ~64;
  - type totals disagree: 120 vs 122 vs 204.
- Example per-type row style under the cycle-time tile: "Wine 63d · Beer 24d · Cider 30d".
- Lagers and ales differ a lot in cycle time, which is why the per-type split is wanted now.

</specifics>

<deferred>
## Deferred Ideas

- Every other §7 item is decided at its own phase: D2–D5 (Phase 95), G1–G10 (96), beer/cider sections (97), A1–A5 (98), responsive/perf (99).
- A richer "data health" card is G10 in Phase 96. Phase 94 only needs a minimal "needs a type" list.

### Reviewed Todos (not folded)
- `todo.match-phase 94` returned 19 keyword matches, every one scoring ≤ 0.6 on generic keywords: kiosk, gift-card, Cal.com, gated-deploy, etc. None is about dashboard correctness, batch typing or the aggregate, so none was folded. The BrewPad ready-to-bottle and bottled-status items were already addressed in Phase 69 and later work.

</deferred>

---

*Phase: 94-dashboard-correctness-and-data-foundations*
*Context gathered: 2026-10-23*
