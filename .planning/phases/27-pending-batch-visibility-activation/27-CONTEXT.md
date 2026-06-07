# Phase 27: Pending Batch Visibility & Activation - Context

**Gathered:** 2026-06-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Make pending batches visible in the admin BrewPad batch list and give staff two ways to promote a pending batch to **Primary**: a one-click instant activation (start = today) and a guided "Schedule & Activate" flow (schedule template + start date + optional vessel/location). Covers requirements BATCH-01, BATCH-02, BATCH-03.

**In scope:** admin-facing batch list/filter visibility for pending; inline + modal activation actions; one-click and guided activation paths; live UI refresh after activation.

**Out of scope:** changes to how pending batches are *created* (handled at order/intake time); Zoho customer read-back/refresh (Phases 28–29); any customer-facing batch page changes.

</domain>

<decisions>
## Implementation Decisions

### Default-view visibility (BATCH-01)
- **D-01:** Pending batches appear in the **default "Active" view** alongside Primary/Secondary — nothing is hidden on load. The backend `active` filter (`getBatches`, `adminApi.gs:1316`) currently returns only `primary`/`secondary`; it must be widened to also include `pending` (or the frontend default changed) so pending shows by default.
- **D-02:** Add a dedicated **"Pending"** option to the `#batch-status-filter` dropdown (`admin.html:373`). The backend already supports an exact-match `pending` filter via the generic `else` branch — no backend filter work needed for the dedicated filter itself.
- **D-03:** Pending batches get a **distinct status badge**. `BATCH_STATUSES` (`admin.js:5517`) has no `pending` entry today — add one (label "Pending", a distinct color, e.g. purple/gray) so pending rows visually stand out.
- **D-04:** Pending batches are **pinned to the top** of the list regardless of the active sort column. They have no `start_date`, so under the default date-desc sort they would otherwise fall to the bottom — pin them so the work that needs doing is the first thing staff see.

### Activation action placement (BATCH-02/03)
- **D-05:** Activation actions appear **both inline on the pending batch row** (in the list) **and inside the batch detail modal**. Inline buttons replace/augment the current per-row "QR" action cell for pending rows; the same actions are added to the detail modal's `batch-detail-actions` block (`admin.js:5825`). Two actions exposed: "Activate" (one-click) and "Schedule & activate" (guided).

### One-click activation safety (BATCH-02)
- **D-06:** One-click "Activate" shows a **confirmation dialog** before flipping (use the existing `showConfirm()` pattern). The confirm copy must warn that **no schedule will be attached** (pending batches are created without a schedule/tasks — see code_context). On confirm: flip status to `primary`, start date = today.
- **D-07:** The transition reuses the existing `update_batch` action with `updates: { status: 'primary' }`. The backend already stamps `fermentation_started_at = now` on the `pending → active` transition (`adminApi.gs:2202`) — correct for the one-click "today" case.

### Guided "Schedule & Activate" flow (BATCH-03)
- **D-08:** A **dedicated "Schedule & Activate" modal**, not the full New Batch form. It shows only the relevant pickers — schedule template (with the existing schedule **preview**), start date, and vessel/location — reusing the New Batch modal's existing picker components (vessel search, schedule preview, shelf/bin validation). Pre-fill the batch's known info.
- **D-09:** Required fields = **schedule template + start date only**. Vessel/location is **optional** (staff can assign it later via the detail modal's existing "Save location" path). Mirrors existing New Batch validation.
- **D-10:** Confirming the modal promotes the batch to Primary in a **single confirmed step**: assign the chosen schedule (generating tasks — pending batches have none yet), set the chosen start date, set vessel/location if provided, flip status to `primary`.

### Live refresh (success criterion #4)
- **D-11:** After either activation path, the list and detail views must reflect Primary status + start date **without a manual page reload**. Reuse existing post-mutation refresh calls (`loadBatchesData()`, `refreshUpcomingCache()`, `loadBatchDashboardSummary()`, and re-`openBatchDetail()` when acting from the modal).

### Claude's Discretion
- Exact badge color for the new "Pending" status.
- Whether widening pending visibility is done backend-side (broaden the `active` filter) or frontend-side (default filter value) — planner picks the cleanest approach consistent with `getBatches`.
- Precise button styling/placement within the row's action cell.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

No external ADRs/specs for this phase. The authoritative references are the existing implementation files below.

### Admin frontend (BrewPad batch UI)
- `js/admin.js` §~5510–7250 — batch module: `BATCH_STATUSES` map (5517), `loadBatchInit`/`loadBatchesData` status-filter wiring (5558–5605), `renderBatchList` row rendering + sort (5618–5690), `openBatchDetail` + `batch-detail-actions` and status-change handler (5825–5925), `openCreateBatchModal` schedule/date/vessel pickers + `create_batch` submit (~6800–6970), `initBatchControls` filter binding (7950).
- `admin.html` §~373 — `#batch-status-filter` dropdown (add "Pending" option here).

### Backend (Apps Script)
- `apps-script/adminApi.gs` — `getBatches` status filter incl. `active` branch (~1310–1345); `updateBatch` incl. pending→active `fermentation_started_at` stamping (~2072, ~2200–2210); `create_batch` pending-batch creation that skips schedule/tasks (~1900–2070); `updateBatchSchedule` / schedule-snapshot + task generation (~2268+).

### Requirements
- `.planning/REQUIREMENTS.md` — BATCH-01, BATCH-02, BATCH-03.
- `.planning/ROADMAP.md` §"Phase 27" — goal + 4 success criteria.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **New Batch modal pickers** (`openCreateBatchModal`): schedule-template `<select>` + live schedule preview, start-date input, vessel search dropdown, shelf/bin validated inputs — directly reusable for the "Schedule & Activate" modal.
- **`update_batch` action**: already handles status change and stamps `fermentation_started_at` on pending→active. The detail-modal "Change Status…" dropdown handler (`admin.js:5913`) is the existing pattern for status mutation.
- **`showConfirm()`**: existing confirmation-dialog pattern (used by Regenerate token / Delete) — reuse for one-click activate guard.
- **Post-mutation refresh helpers**: `loadBatchesData()`, `refreshUpcomingCache()`, `loadBatchDashboardSummary()`, `openBatchDetail(id)` — reuse for live refresh.
- **Pipeline / attention-list** (`renderBatchPipeline`, `addBatchAttentionItems`): existing pattern if a pending count nudge is later wanted (not in scope now).

### Established Patterns
- **Server-side status filtering**: the list calls `get_batches`/`get_batch_init` with a `status` param; filtering happens in `adminApi.gs`. The default `active` filter intentionally excludes pending today — this is the exact gate being changed for BATCH-01.
- **Pending batches have no schedule and no tasks** — they are created with `create_batch` where schedule validation is skipped (`adminApi.gs:1909`) and status set to `pending`. The guided flow must therefore *generate* tasks from the chosen schedule, not assume they exist.
- **Optimistic locking**: batch mutations use `expectedVersion` / `last_updated`. New activation calls must pass `expectedVersion` like existing handlers.

### Integration Points
- `#batch-status-filter` dropdown ↔ `getBatches` status param.
- Inline row action cell in `renderBatchList` (currently the "QR" button cell) ↔ new activate buttons for pending rows.
- `batch-detail-actions` block in `openBatchDetail` ↔ new modal activate actions.
- Guided modal ↔ schedule assignment/task generation path (`updateBatchSchedule` or equivalent) + `update_batch` status flip + start_date.

### ⚠ Planner note — chosen start date vs stamped date
The backend stamps `fermentation_started_at = now` on the pending→primary transition (`adminApi.gs:2202`), ignoring any chosen date. This is correct for the one-click "today" path (D-07) but the **guided flow lets staff pick a different start date (D-08/D-10)**. The planner must confirm the chosen start date is honored (set `start_date` and/or `fermentation_started_at` to the chosen value, not overwritten with `now`) — likely a small `adminApi.gs` adjustment.

</code_context>

<specifics>
## Specific Ideas

- "One-click" should be genuinely one click from the list (D-05 inline buttons), not "open modal then click."
- Pending must be impossible to miss: default-visible + distinct badge + pinned to top (D-01/D-03/D-04).
- The empty-schedule footgun is a known concern — the one-click confirm explicitly warns about it (D-06).

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. (A pending-count "attention" nudge / pipeline stage was raised as an option but not chosen for this phase; the existing attention-list machinery remains available if desired later.)

</deferred>

---

*Phase: 27-Pending Batch Visibility & Activation*
*Context gathered: 2026-06-07*
