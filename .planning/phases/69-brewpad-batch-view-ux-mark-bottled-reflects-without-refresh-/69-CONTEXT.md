# Phase 69: BrewPad Batch-View UX — Mark-Bottled Freshness + Ready-to-Bottle Filter - Context

**Gathered:** 2026-08-12 (root cause corrected 2026-08-12 after pattern-map verification)
**Status:** Ready for planning
**Source:** Owner tickets 2026-08-11 (#2 "marking batches as bottled doesn't go through until a full refresh"; #3 "dedicated ready to bottle section filter on batch view, not just secondary") + orchestrator code recon. Owner confirmed 2026-08-12 that "mark bottled" = checking the **Bottling/Packaging task checkbox** (saves via `bulk_update_batch_tasks`).

<domain>
## Phase Boundary

Two related BrewPad batch-view improvements, both fully browser-verifiable (no iPad/kiosk hardware, no Apps Script redeploy):

1. **Freshness bug (#2) — CLIENT-SIDE ONLY.** Completing the Bottling/Packaging task on a batch does not remove it from the "Ready to Bottle" list until a full page reload. Root cause is entirely client-side:
   - The batch dashboard is refetched only by `loadDashboard()` (js/brewpad.js:2817), which calls `get_batch_dashboard_summary` and sets `_dashSummary` + `_dashLoadTime`. `renderDashboard()` (js/brewpad.js:2863) only re-renders the cached `_dashSummary` — it never fetches.
   - The task-checkbox handlers save via `bulk_update_batch_tasks` and then either call `afterBatchWrite(batch_id, { listAffecting: false })` + `renderDashboard()` (dashboard handler ~8144) or don't refresh dashboard state at all — so `_dashSummary` is never refetched and the batch stays in Ready-to-Bottle until a reload runs `loadDashboard()`.
   - **The server side is already correct:** `readyToBottle` is computed by `getBatchDashboardSummary()` (adminApi.gs:1750, list built ~1847-1883) behind cache key `'gbds'`; `bulk_update_batch_tasks` (adminApi.gs:375) already calls `_invalidateBatchCache`, whose key list already includes `'gbds'` (adminApi.gs:3270). So a client refetch after the save returns fresh data with no Apps Script change. (Note: `get_dashboard_summary`/`'gds'`/`getDashboardSummary()` is a SEPARATE endpoint used only by `js/admin.js` — NOT BrewPad. Do not touch it.)

2. **Ready-to-Bottle filter (#3).** The batch view's filter bar (js/brewpad.js ~3440 `filterOpts`) offers pending/active/primary/secondary/complete but no "Ready to Bottle" — staff proxy it with "secondary", which is imprecise. Add a dedicated Ready-to-Bottle filter using the SAME definition as the dashboard's Ready-to-Bottle list.

In scope: `js/brewpad.js` (+ rebuilt `js/brewpad.min.js`) and new frontend tests ONLY. NOT in scope: `apps-script/adminApi.gs` (server cache already busts `gbds` correctly), the readyToBottle predicate, the batch status cycle, anything on the kiosk surface.
</domain>

<decisions>
## Implementation Decisions

### Freshness fix (#2) — client-only
- After a successful `bulk_update_batch_tasks` save, force the dashboard to REFETCH by calling `loadDashboard()` (the only function that refetches `get_batch_dashboard_summary` and rebuilds `_dashSummary`/`_dashLoadTime`) instead of `renderDashboard()` on the stale cached object. Use the already-proven pairing in this file — `afterBatchWrite(batch_id, { listAffecting: true }); loadDashboard();` (precedent at js/brewpad.js:6669-6672 / 6680-6683) — do NOT invent a new opts flag.
- Apply to ALL THREE task-checkbox handlers that can complete a bottling/packaging task (locations to confirm during implementation): the dashboard Ready-to-Bottle handler (~8144, currently `listAffecting:false` + `renderDashboard()`), the Tasks-tab handler (~8313), and the batch-detail-pane handler (~8413, which currently does NOT call `afterBatchWrite` at all and needs it added). Completing any task changes dashboard/readyToBottle counts, so all three are dashboard-affecting.
- Preserve the existing optimistic row-removal animation on the dashboard handler, but back it with the real `loadDashboard()` refetch so the final state is correct (and self-heals if the optimistic guess was wrong). Keep it resilient: `loadDashboard()`'s existing keep-last-good/degrade path means a refetch failure must not wedge the UI.
- Net effect: checking the Bottling/Packaging task drops the batch out of Ready-to-Bottle immediately, no reload — no server change needed.

### Ready-to-Bottle filter (#3)
- Add a "Ready to Bottle" option to the batch-view `filterOpts`, with a count chip like the dashboard section ("Ready to Bottle (N)").
- Define membership by REUSING the server-computed set: a batch is Ready-to-Bottle iff its `batch_id` is in `_dashSummary.readyToBottle` (adminApi.gs:1750/1847-1883). Implement as a new sibling pure function next to `filterBatchesByStatus` (js/brewpad.js:188) that intersects `_allBatchesData` with the `readyToBottle` batch_ids, exported the same dual way as its sibling (`module.exports` block ~8934). Do NOT re-implement the predicate over `_allBatchesData` — the batch-list payload may not carry per-task/packaging-due fields, and duplicating the rule invites drift.
- If `_dashSummary` is not loaded when the filter is selected, call `loadDashboard()` first (reuse the same load path), then apply the filter.
- Count comes from `_dashSummary.readyToBottle.length`.

### Claude's Discretion
- Exact reconciliation of the optimistic animation with the `loadDashboard()` refetch; filter chip styling/placement; the new filter function's name; whether the batch-detail handler adopts `{ refreshOpenDetail: true }` in addition to the dashboard refetch.

### Deploy / sequencing
- Pure frontend change: ships via the normal frontend deploy (staging → prod) and is fully verifiable in Chrome (drive BrewPad, check a bottling task, confirm the batch leaves Ready-to-Bottle without reload; select the new filter, confirm membership + count). No Apps Script redeploy, no human-hardware gate.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Tickets
- `.planning/todos/pending/brewpad-bottled-status-stale-ui.md` (#2)
- `.planning/todos/pending/brewpad-ready-to-bottle-filter.md` (#3)

### Code under change (js/brewpad.js only + rebuilt min)
- `loadDashboard()` js/brewpad.js:2817 (the ONLY refetch path — sets `_dashSummary`/`_dashLoadTime`); `renderDashboard()` :2863 (cache-only render); `_dashLoadTime` gate :2061
- `afterBatchWrite` definition + call sites; the proven `afterBatchWrite(id,{listAffecting:true}) + loadDashboard()` pairing at :6669-6672 / :6680-6683
- Task-checkbox handlers: dashboard ~8144 (`listAffecting:false` + `renderDashboard()`), Tasks-tab ~8313, batch-detail ~8413 (no afterBatchWrite today) — all save via `bulk_update_batch_tasks` (~8160)
- Batch-view filter bar ~3435-3450 (`filterOpts`) + filter-apply over `_allBatchesData`; `filterBatchesByStatus` :188 (sibling to add the new filter next to); exports block ~8934
- Ready-to-Bottle dashboard section ~3210-3236 (`d.readyToBottle` shape: batch_id, product_name, bottling_due, overdue, has_email)
- `js/brewpad.min.js` — build artifact; regenerate via `npm run build`, never hand-edit

### Reference-only (DO NOT modify)
- `apps-script/adminApi.gs` — `getBatchDashboardSummary()` :1750 / readyToBottle :1847-1883; `_cachedGet('gbds', 300, …)` :197; `_invalidateBatchCache` :3268-3277 (already busts `gbds`). Confirms no server change is needed.

### Doctrine
- `CLAUDE.md` — regression-test-first, min.js build rule, both test suites
- Structural/source-text regression tests (`brewpad-activation.test.js`, `brewpad-pull-from-zoho.test.js`) are the established way to pin behavior inside BrewPad's un-exported IIFE event handlers.
</canonical_refs>

<specifics>
## Specific Ideas
- Owner confirmed the control: the Bottling/Packaging task checkbox (→ `bulk_update_batch_tasks`), not the status badge.
- Root cause is purely "the client never refetches the dashboard after a task write" — the fix is to call `loadDashboard()` post-save (server cache already busts `gbds`).
- `readyToBottle` is already a shaped list on `_dashSummary` — ideal to drive the new filter (batch_id intersection).
- The `filterBatchesByStatus`-sibling + intersection approach makes the filter and the dashboard section share one source of truth, so #2's refetch fix keeps the filter fresh too.
</specifics>

<deferred>
## Deferred Ideas
- Broader BrewPad cache-freshness audit (other writes vs other cached reads) — not needed here; `gbds` is correct.
- Exposing readyToBottle as a standalone flag on the batch-list payload — unnecessary given the `_dashSummary.readyToBottle` reuse.
</deferred>

---

*Phase: 69-brewpad-batch-view-ux*
*Context gathered: 2026-08-12; root cause corrected after pattern-map verification (client-only; no Apps Script change)*
