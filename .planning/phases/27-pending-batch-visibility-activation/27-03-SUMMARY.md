---
phase: 27-pending-batch-visibility-activation
plan: "03"
subsystem: admin-batch-ui
tags: [batch, admin, activation, schedule, guided-flow, start-date, optimistic-locking]
dependency_graph:
  requires: [27-01, 27-02]
  provides: [schedule-activate-modal, guided-pending-promotion, start-date-footgun-fix]
  affects: [apps-script/adminApi.gs, js/admin.js, js/admin.min.js]
tech_stack:
  added: []
  patterns: [two-step-sequenced-promote, chained-expectedVersion, lazy-data-load-guard]
key_files:
  created: []
  modified:
    - apps-script/adminApi.gs
    - js/admin.js
    - js/admin.min.js
decisions:
  - "openScheduleActivateModal delegates to _buildScheduleActivateModal after lazy-loading schedules+vessels in parallel where possible"
  - "fromDetailModal boolean flag controls whether success path re-opens the detail modal"
  - "Partial-failure path (step1 ok, step2 fails) shows a specific toast and still closes modal + refreshes list so staff know the batch is activated"
  - "saVesselHidden.value checked to decide whether to include vessel_id in update_batch payload — omitted entirely if blank (not sent as empty string)"
metrics:
  duration: 180s
  completed: "2026-06-07"
  tasks_completed: 3
  tasks_total: 3
  files_modified: 21
requirements: [BATCH-03]
---

# Phase 27 Plan 03: Guided Schedule & Activate Flow Summary

**One-liner:** Pending batches can now be promoted to Primary via a Schedule & Activate modal that picks a template (with live preview), a start date, and optional vessel/location — generating tasks with due dates keyed to the chosen date, not today.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Backend — honor chosen start date on pending->active | 7d86be3 | apps-script/adminApi.gs |
| 2 | Schedule & Activate modal + single-step promote orchestration | 19f8f41 | js/admin.js |
| 3 | Rebuild frontend bundle | b5a5310 | js/admin.min.js + 20 HTML files (stamp) |

## What Was Built

**BATCH-03 implementation:** Staff now have a guided path to activate a pending batch with a real fermentation schedule, a chosen start date, and an optional vessel/location.

### Task 1 — Backend footgun fix (adminApi.gs)

`updateBatch` unconditionally stamped `fermentation_started_at = now` whenever a pending batch transitioned to active. Two targeted edits fix this:

1. **`start_date` added to `allowedFields`** (line 2164): The generic `allowedFields` loop now writes `start_date` to the batch row via the existing `sanitizeInput` path. This is the field `updateBatchSchedule` already reads (`current.start_date`) to compute task due dates — so setting it before calling `update_batch_schedule` is sufficient to wire the chosen date into the entire task timeline.

2. **`fermentation_started_at` stamp uses priority chain** (lines 2202–2218): Instead of always writing `now`, the transition now checks in order: `updates.fermentation_started_at` → `updates.start_date` → `current.start_date` → `now`. The one-click activate path (sends no `start_date`) still falls through to `now`, keeping D-07 behavior intact.

### Task 2 — Schedule & Activate modal (js/admin.js)

**`openScheduleActivateModal(batch, fromDetailModal)`** — entry point that lazy-loads `fermSchedulesData` and `vesselsData` (both in parallel if both missing) then delegates to `_buildScheduleActivateModal`.

**`_buildScheduleActivateModal(batch, fromDetailModal)`** — renders a dedicated modal (not `buildCreateBatchFormInner`) showing:
- Read-only product + customer summary pre-filled from the batch
- Schedule template `<select id="sa-schedule-select">` populated from `fermSchedulesData` + a live preview `<div id="sa-schedule-preview">` wired with the same `steps_parsed` / `steps` rendering as the New Batch form
- Start date `<input type="date" id="sa-start-date">` defaulting to `todayPacific()`
- Optional vessel search + shelf + bin block using `bindVesselSearch` / `bindShelfInput` / `bindBinInput`
- Required: schedule + start date only; vessel optional (D-09)

**Submit orchestration (D-10, single confirmed step):**
1. Validates schedule + start date present; builds `schedule_snapshot` from the selected template's `steps_parsed`
2. `adminApiPost('update_batch', { status: 'primary', start_date, vessel/shelf/bin? })` — sets `start_date` BEFORE tasks are generated, causing the backend to stamp `fermentation_started_at` to the chosen date (Task 1)
3. On success, captures `result.newVersion` and calls `adminApiPost('update_batch_schedule', { expectedVersion: newVersion, schedule_snapshot })` — tasks get due dates derived from the chosen `start_date` already written to the row
4. On full success: `showToast` with task count, `closeModal()`, `vesselsData = null`, then `loadBatchesData()` + `refreshUpcomingCache()` + `loadBatchDashboardSummary()` (+ `openBatchDetail` when `fromDetailModal`) (D-11)
5. Partial failure (step 2 fails): shows explicit toast "Batch activated but schedule failed — assign schedule from the detail modal"; still refreshes list
6. Version conflict: surfaced as clear toast "Version conflict — refresh and try again"

**Launchers added:**
- Inline on pending rows: `class="btn-secondary admin-btn-sm batch-schedule-activate-btn"` beside Activate button; row-click guard updated to also gate on this class
- Detail modal actions: `id="batch-schedule-activate-detail"` beside the existing Activate button; calls `openScheduleActivateModal(b, true)`

### Task 3 — Bundle rebuild

`npm run build` regenerated `js/admin.min.js` and stamped version hashes on 20 HTML files. The minified artifact contains `schedule-activate` and `update_batch_schedule` strings.

## Deviations from Plan

**1. [Rule 2 - Missing detail] Partial-failure recovery distinguishes step1-ok/step2-fail explicitly**
- **Found during:** Task 2 implementation
- **Issue:** The plan specifies surfacing a clear toast if step1 succeeds but step2 fails. The catch handler in the submit sequence needs to distinguish a schedule-assignment failure from a pre-activation failure.
- **Fix:** Error message inspection in the `.catch()` handler: if the error text references "schedule" or "tasks", treat it as a step-2 failure (batch already activated, close modal + refresh); a version-conflict yields the conflict toast; anything else shows the raw error and re-enables the submit button.
- **Files modified:** js/admin.js

## Known Stubs

None — no placeholder data or TODO stubs introduced.

## Threat Flags

None — all changes remain within the existing authenticated admin trust boundary. The `start_date` field writes through the existing `sanitizeInput` path (T-27-06 mitigated). The two-step promote uses chained `expectedVersion` (T-27-07 mitigated). The partial-failure state is documented as accepted (T-27-08).

## Verification Checklist

- [x] `'start_date'` appears in updateBatch allowedFields array (adminApi.gs)
- [x] Pending->active branch uses priority chain: fermentation_started_at > start_date > current.start_date > now
- [x] updateBatchSchedule is unchanged
- [x] `grep -c "openScheduleActivateModal\|batch-schedule-activate-btn\|batch-schedule-activate-detail\|sa-schedule-select\|sa-start-date\|update_batch_schedule" js/admin.js` returns 15
- [x] `openScheduleActivateModal` renders only schedule select + preview + start date + optional vessel (D-08)
- [x] Submit validates schedule + start date as required only (D-09)
- [x] Step 1 sets start_date BEFORE Step 2 generates tasks (D-10)
- [x] Both inline (batch-schedule-activate-btn) and detail (batch-schedule-activate-detail) launchers exist
- [x] Row-click guard updated for batch-schedule-activate-btn
- [x] Success path: loadBatchesData + refreshUpcomingCache + loadBatchDashboardSummary (+ openBatchDetail from modal) (D-11)
- [x] `npm run lint` — 0 errors, 118 pre-existing warnings unchanged
- [x] `npm run build` exits 0
- [x] admin.min.js contains "schedule-activate" and "update_batch_schedule"
- [x] `npm test` — 432 tests passing

## Self-Check: PASSED

- apps-script/adminApi.gs contains 'start_date' in allowedFields: FOUND
- apps-script/adminApi.gs contains updates.start_date priority chain: FOUND
- js/admin.js contains openScheduleActivateModal (3 occurrences): FOUND
- js/admin.js contains batch-schedule-activate-btn (3 occurrences): FOUND
- js/admin.js contains batch-schedule-activate-detail (2 occurrences): FOUND
- js/admin.min.js contains schedule-activate: FOUND
- Commits 7d86be3, 19f8f41, b5a5310: FOUND in git log
