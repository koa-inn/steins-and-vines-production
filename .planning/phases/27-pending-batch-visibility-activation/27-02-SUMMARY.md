---
phase: 27-pending-batch-visibility-activation
plan: "02"
subsystem: admin-batch-ui
tags: [batch, admin, activation, pending, one-click, optimistic-locking]
dependency_graph:
  requires: [27-01]
  provides: [pending-batch-inline-activate, pending-batch-modal-activate]
  affects: [js/admin.js, js/admin.min.js]
tech_stack:
  added: []
  patterns: [showConfirm-guard, optimistic-locking-expectedVersion, post-mutation-live-refresh]
key_files:
  created: []
  modified:
    - js/admin.js
    - js/admin.min.js
decisions:
  - "Tasks 1 and 2 committed together (single admin.js file, changes were interleaved during implementation; combined commit rather than forced split)"
  - "Activate button styled as .btn (primary) not .btn-secondary — visually distinct to signal this is a primary action"
  - "Row-click handler gates on both .batch-qr-btn and .batch-activate-btn to prevent detail-modal open on activate click"
metrics:
  duration: 90s
  completed: "2026-06-07"
  tasks_completed: 3
  tasks_total: 3
  files_modified: 21
requirements: [BATCH-02]
---

# Phase 27 Plan 02: Pending Batch One-Click Activation Summary

**One-liner:** Pending batch rows and the detail modal now each have an Activate button that flips to Primary with start date = today after a no-schedule safety confirm.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1+2 | Inline + modal Activate buttons with confirm + flip | aa73412 | js/admin.js |
| 3 | Rebuild frontend bundle | 688e6b4 | js/admin.min.js + 20 HTML files (stamp) |

## What Was Built

**BATCH-02 implementation:** Staff can now activate a pending batch in one confirmed click from the batch list or from the detail modal — no form, no navigation.

### Inline Activate (Task 1)

For every pending row in `renderBatchList`, an **Activate** button (`class="btn admin-btn-sm batch-activate-btn"`) is now rendered alongside the existing QR button. The button carries:

- `data-batch-id` — the batch ID to mutate
- `data-version` — `b.last_updated` (opaque ISO timestamp for optimistic locking per T-27-05)

The row-click handler was updated to also gate on `.batch-activate-btn` so clicking Activate does not simultaneously open the detail modal.

The click handler:
1. Calls `e.stopPropagation()` to prevent row-click bubbling (mirrors QR handler pattern)
2. Shows `showConfirm()` with the explicit no-schedule warning: *"Activate this batch now? It has no fermentation schedule, so no tasks will be created and the start date is set to today. Use 'Schedule & activate' if you need a schedule."* (D-06)
3. On confirm: disables the button, calls `adminApiPost('update_batch', { batch_id, expectedVersion: ver, updates: { status: 'primary' } })` (D-07)
4. On success: `showToast` + `loadBatchesData()` + `refreshUpcomingCache()` + `loadBatchDashboardSummary()` (D-11)
5. On error (including version_conflict): `showToast` with error message + re-enables button

### Modal Activate (Task 2)

In `renderBatchDetailModal`, when `b.status === 'pending'`, an **Activate** button (`id="batch-activate-detail"`, `class="btn admin-btn-sm"`) is injected into the `.batch-detail-actions` block, placed before the Change Status dropdown so it is the first visible action for pending batches.

The binding region (after `openModal`, where `batchId` and `batchVersion` are in scope) wires the click with the identical confirm copy and `update_batch primary` flip pattern. The success path additionally re-calls `openBatchDetail(batchId)` so the modal itself refreshes to show Primary status and start date (D-11).

### Threat mitigations applied

- **T-27-04 (version conflict):** Both handlers pass `expectedVersion` from the rendered data; the Apps Script optimistic-lock check rejects stale writes — the handler surfaces the conflict via `showToast` and re-enables the button
- **T-27-05 (data-version injection):** `b.last_updated` rendered via `escapeHTML()`; backend re-validates — tampered value yields only a version_conflict, never an unguarded write

## Deviations from Plan

**1. [Process] Tasks 1 and 2 combined into a single commit**
- **Reason:** Both tasks modify only `js/admin.js`. The changes were implemented in sequence without an intermediate commit checkpoint. Since the file is modified atomically, splitting would require interactive staging — committed as one cohesive unit.
- **Impact:** None functional. All acceptance criteria for both tasks are met. The commit message explicitly documents both tasks.

## Known Stubs

None — no placeholder data or TODO stubs introduced.

## Threat Flags

None — changes remain within the existing authenticated admin trust boundary. No new endpoints, auth paths, or schema changes introduced.

## Verification Checklist

- [x] `grep -c "batch-activate-btn" js/admin.js` returns 3 (render, row-click guard, handler bind)
- [x] `grep -ci "no fermentation schedule" js/admin.js` returns 2 (inline + modal confirm copy)
- [x] `status: 'primary'` used in both activate handlers (not 'active')
- [x] `expectedVersion` passed in both activate `adminApiPost` calls
- [x] Inline handler: `loadBatchesData` + `refreshUpcomingCache` + `loadBatchDashboardSummary` on success
- [x] Modal handler: `openBatchDetail` + `loadBatchesData` + `refreshUpcomingCache` + `loadBatchDashboardSummary` on success
- [x] Row-click guard updated to also return early for `.batch-activate-btn`
- [x] `batch-activate-detail` rendered only when `b.status === 'pending'`
- [x] `npm run lint` — 0 errors (118 pre-existing warnings unchanged)
- [x] `npm run build` exits 0
- [x] `grep -c "batch-activate-btn\|batch-activate-detail" js/admin.min.js` returns 1 (minified — combined into single match)
- [x] `npm test` — 432 tests passing

## Self-Check: PASSED

- js/admin.js contains batch-activate-btn (3 occurrences): FOUND
- js/admin.js contains batch-activate-detail (2 occurrences): FOUND
- js/admin.js contains no fermentation schedule warning (2 occurrences): FOUND
- js/admin.min.js regenerated with activate strings: FOUND
- Commits aa73412, 688e6b4: FOUND in git log
