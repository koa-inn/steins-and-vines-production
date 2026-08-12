# Phase 69: BrewPad Batch-View UX — Mark-Bottled Freshness + Ready-to-Bottle Filter - Context

**Gathered:** 2026-08-12
**Status:** Ready for planning
**Source:** Owner tickets 2026-08-11 (#2 "marking batches as bottled doesn't go through until a full refresh"; #3 "dedicated ready to bottle section filter on batch view, not just secondary") + orchestrator code recon. Owner confirmed 2026-08-12 that "mark bottled" = checking the **Bottling/Packaging task checkbox** (saves via `bulk_update_batch_tasks`).

<domain>
## Phase Boundary

Two related BrewPad batch-view improvements, both browser-verifiable (no iPad/kiosk hardware):

1. **Freshness bug:** completing the Bottling/Packaging task on a batch does not remove it from the "Ready to Bottle" list (or update batch/dashboard state) until a full page reload. Root cause is two-layered:
   - **Server (apps-script/adminApi.gs):** `_invalidateBatchCache(batchId)` (called after `bulk_update_batch_tasks`, adminApi.gs:375) busts keys `['gbl','gtu','gbds','gbi','gfs']` + per-batch `gb:`/`gbp:` — but NOT `'gds'`, the `get_dashboard_summary` cache key (adminApi.gs:170, 60s TTL) that holds `readyToBottle`. So the Ready-to-Bottle list stays cached-stale for up to 60s after a task write.
   - **Client (js/brewpad.js):** the dashboard task-checkbox handler (~8144) calls `afterBatchWrite(task.batch_id, { listAffecting: false })` then `renderDashboard()`. `afterBatchWrite` with `listAffecting: false` deliberately does NOT reset `_dashLoadTime`/list caches (afterBatchWrite ~ the opts.listAffecting branch), and `renderDashboard()` renders the cached `_dashSummary` object without refetching `get_dashboard_summary`. So the batch never leaves Ready-to-Bottle until a reload rebuilds `_dashSummary`.

2. **Ready-to-Bottle filter:** the batch view's filter bar (js/brewpad.js ~3440 `filterOpts`) offers pending/active/primary/secondary/complete but no "Ready to Bottle" — staff currently proxy it with "secondary", which is imprecise. Add a dedicated Ready-to-Bottle filter that uses the SAME definition as the dashboard's Ready-to-Bottle list.

In scope: `js/brewpad.js` (+ rebuilt `js/brewpad.min.js`), `apps-script/adminApi.gs` (the `_invalidateBatchCache` key list), frontend tests. Out of scope: reworking the readyToBottle predicate itself; the batch status cycle; anything on the kiosk surface.
</domain>

<decisions>
## Implementation Decisions

### Freshness fix (#2)
- **Server:** add `'gds'` to the `_invalidateBatchCache` key list (adminApi.gs) so any task/reading write that changes dashboard counts (incl. readyToBottle) busts the dashboard-summary cache. This is the smallest correct change; it also fixes staleness for the other writes routed through `_invalidateBatchCache` (add_batch_task, plato readings). Requires an owner Apps Script redeploy (no CI for `.gs` — same human-action gate as phase 64-03).
- **Client:** completing a task IS dashboard-affecting (it changes readyToBottle / counts). After a successful `bulk_update_batch_tasks` save, force the dashboard summary to REFETCH (reset `_dashLoadTime = 0` and re-run whatever loads `_dashSummary` from `get_dashboard_summary`) rather than calling `renderDashboard()` on the stale cached object. Preserve the existing optimistic row-removal animation, but back it with a real refetch so the state is correct after the animation (and self-heals if the optimistic guess was wrong). Apply to BOTH task-checkbox handlers (the dashboard Ready-to-Bottle handler ~8144 and the batch-detail task handler ~8315) since both change dashboard state. Keep it resilient: a refetch failure must not wedge the UI (keep-last-good).
- Net effect: checking the Bottling/Packaging task drops the batch out of Ready-to-Bottle immediately, no reload — with both the client refetch AND the server `gds` bust in place so the refetch returns fresh data.

### Ready-to-Bottle filter (#3)
- Add a "Ready to Bottle" option to the batch-view `filterOpts`, with a count chip like the dashboard section ("Ready to Bottle (N)").
- Define membership by REUSING the server-computed set: a batch is Ready-to-Bottle iff its `batch_id` is in `_dashSummary.readyToBottle` (adminApi.gs:1852-1883 already computes it: active batch with an incomplete packaging task AND (all non-packaging tasks done OR bottling date reached)). Do NOT re-implement the predicate client-side over `_allBatchesData` — the batch-list payload may not carry per-task/packaging-due fields, and duplicating the rule invites drift. Filtering `_allBatchesData` to `{ batch_id ∈ readyToBottle }` keeps one source of truth and auto-syncs with the dashboard once #2's refetch is fixed.
- If `_dashSummary` is not loaded when the filter is selected, load/refetch it first (reuse the same dashboard load path).

### Claude's Discretion
- The exact dashboard-refetch call/function name and how the optimistic animation is reconciled with the refetch; the filter chip styling/placement; whether the filter count comes from `readyToBottle.length` directly; the precise flag/opts used to signal "dashboard-affecting" in `afterBatchWrite` (e.g. a new `opts.dashAffecting` vs reusing `listAffecting: true` for task writes).

### Deploy / sequencing
- Client changes (brewpad.js) are browser-verifiable and ship via the normal frontend deploy; the filter and the client refetch can be demonstrated in Chrome.
- The `adminApi.gs` `gds` bust needs an owner Apps Script redeploy to take full effect (until then, the client refetch still improves things but can hit the 60s `gds` TTL). Structure so the Apps Script change is an explicit human-action step (mirror 64-03).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Tickets
- `.planning/todos/pending/brewpad-bottled-status-stale-ui.md` (#2)
- `.planning/todos/pending/brewpad-ready-to-bottle-filter.md` (#3)

### Code under change
- `js/brewpad.js` — dashboard task-checkbox handler ~8144-8200 (`afterBatchWrite(..., { listAffecting: false })` + `renderDashboard()`), batch-detail task handler ~8315; `afterBatchWrite` definition (search `function afterBatchWrite`); `renderDashboard` ~2863 (renders `_dashSummary`, no refetch); dashboard load path that sets `_dashSummary`/`_dashLoadTime`; batch-view filter bar ~3435-3450 (`filterOpts`); the filter-apply logic over `_allBatchesData`; the Ready-to-Bottle dashboard section ~3210-3236 (`d.readyToBottle`)
- `apps-script/adminApi.gs` — `_invalidateBatchCache` (~the key-list function, `['gbl','gtu','gbds','gbi','gfs']`); `get_dashboard_summary` → `_cachedGet('gds', 60, getDashboardSummary)` (adminApi.gs:170); `getDashboardSummary` readyToBottle computation (adminApi.gs:1847-1883); `bulk_update_batch_tasks` case (adminApi.gs:373-377)
- `js/brewpad.min.js` — build artifact; regenerate via `npm run build`, never hand-edit

### Doctrine
- `CLAUDE.md` — regression-test-first, min.js build rule, both test suites
- Phase 64-03 — the Apps Script owner-redeploy human-action pattern (no CI for `.gs`)
</canonical_refs>

<specifics>
## Specific Ideas
- Owner confirmed the control: the Bottling/Packaging task checkbox (→ `bulk_update_batch_tasks`), not the status badge.
- The single missing cache key server-side is `'gds'`; the client simply never refetches the summary after a task write.
- readyToBottle is already a shaped list on `_dashSummary` (batch_id, product_name, bottling_due, overdue, …) — ideal to drive the filter.
</specifics>

<deferred>
## Deferred Ideas
- Broader BrewPad cache-freshness audit (other writes vs other cached reads) — only touch `gds` here.
- Making the Ready-to-Bottle predicate available as a standalone flag on the batch-list payload — unnecessary given the `_dashSummary.readyToBottle` reuse.
</deferred>

---

*Phase: 69-brewpad-batch-view-ux*
*Context gathered: 2026-08-12 via owner tickets + owner clarification + code recon*
