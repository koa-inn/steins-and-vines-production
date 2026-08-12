---
phase: 69-brewpad-batch-view-ux-mark-bottled-reflects-without-refresh-
plan: 01
subsystem: ui
tags: [brewpad, dashboard, cache-freshness, vanilla-js]

# Dependency graph
requires: []
provides:
  - "js/brewpad.js task-checkbox handlers (dashboard, tasks-tab, batch-detail-pane) refetch the dashboard via loadDashboard() after every bulk_update_batch_tasks save"
  - "Structural regression suite (tests/frontend/brewpad-bottled-refetch.test.js) pinning the afterBatchWrite({listAffecting:true}) + loadDashboard() pairing in all three handlers"
affects: [69-02]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Dashboard-affecting write refetch: afterBatchWrite(batchId, { listAffecting: true }); loadDashboard(); applied post-save, alongside (not gating) any optimistic UI animation"

key-files:
  created:
    - tests/frontend/brewpad-bottled-refetch.test.js
  modified:
    - js/brewpad.js
    - js/brewpad.min.js

key-decisions:
  - "Batch-detail-pane handler (~8429) also passes refreshOpenDetail: true to afterBatchWrite so the open detail pane re-renders from fresh server data, not just the dashboard summary — this handler previously called afterBatchWrite not at all."
  - "loadDashboard() is called fire-and-forget alongside the existing optimistic row-removal animation (dashboard/tasks-tab handlers) rather than gating the animation on the fetch — loadDashboard() already fails soft, so a refetch failure cannot wedge the UI."
  - "Reused the existing listAffecting: true opt (no new opts flag introduced) per CONTEXT.md's explicit guidance and the proven precedent at js/brewpad.js:6670-6672/6682-6683."

patterns-established: []

requirements-completed: []

# Metrics
duration: 4min
completed: 2026-08-12
---

# Phase 69 Plan 01: Mark-Bottled Dashboard Refetch Summary

**Fixed BrewPad's mark-bottled staleness by wiring `loadDashboard()` into all three task-checkbox handlers so completing a Bottling/Packaging task refetches (not just re-renders) the dashboard summary — no page reload needed.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-08-12T17:43:53Z
- **Completed:** 2026-08-12T17:47:47Z
- **Tasks:** 3
- **Files modified:** 3 (js/brewpad.js, js/brewpad.min.js, tests/frontend/brewpad-bottled-refetch.test.js)

## Accomplishments
- Checking the Bottling/Packaging task checkbox from the dashboard, the Tasks tab, or the batch-detail pane now triggers a real `loadDashboard()` refetch after the save succeeds, so the batch drops out of Ready-to-Bottle immediately with no page reload.
- The batch-detail-pane handler previously had no `afterBatchWrite` call at all (a materially weaker cache-bust than its two siblings) — it now busts and refetches like the other two, plus re-renders the open detail pane from fresh server data.
- Added a structural regression suite that pins the fix at the source-text level (RED before the fix, GREEN after), matching the established pattern for testing BrewPad's un-exported IIFE-scoped event handlers.

## Task Commits

Each task was committed atomically:

1. **Task 1: Write failing regression tests pinning loadDashboard() in all three handler success paths** - `ecc00b8a` (test)
2. **Task 2: Wire loadDashboard() refetch into all three task-checkbox handlers (GREEN)** - `088aef6c` (feat)
3. **Task 3: Rebuild js/brewpad.min.js and run full gates** - `cd01fead` (chore)

_TDD cycle: RED (ecc00b8a, all 4 tests fail against unmodified source) → GREEN (088aef6c, all 4 tests pass) → no refactor commit needed._

## Files Created/Modified
- `tests/frontend/brewpad-bottled-refetch.test.js` - New structural regression suite: anchors each of the three `adminApiPost('bulk_update_batch_tasks'` call sites via successive `indexOf`, slices a 1500-char window per handler, and asserts `loadDashboard()` + `listAffecting: true` are present in each (plus `afterBatchWrite(` for the batch-detail handler, which had neither before).
- `js/brewpad.js` - Dashboard handler (~8160) and tasks-tab handler (~8329): changed `afterBatchWrite(task.batch_id, { listAffecting: false })` to `{ listAffecting: true }` and added a fire-and-forget `loadDashboard()` call in the success path, preserving the existing optimistic row-removal animation. Batch-detail-pane handler (~8429): added `afterBatchWrite(_selectedBatchId, { listAffecting: true, refreshOpenDetail: true })` + `loadDashboard()` (previously called neither). All three `.catch` rollback blocks are byte-identical to before (verified via `git diff`).
- `js/brewpad.min.js` - Rebuilt via `npm run build` from the edited `js/brewpad.js`; never hand-edited.

## Decisions Made
- Reused the already-proven `afterBatchWrite({listAffecting:true}) + loadDashboard()` pairing (precedent at js/brewpad.js:6670-6672/6682-6683) rather than inventing a new opts flag, per CONTEXT.md's explicit guidance.
- Gave the batch-detail-pane handler `refreshOpenDetail: true` in addition to the dashboard refetch (a discretionary choice per CONTEXT.md) so the open detail pane's task list also reflects fresh server state, not just the dashboard summary.
- `npm run build` re-stamps `?v=` cache-bust query strings across unrelated HTML pages and bumps `js/admin.js`'s `BUILD_TIMESTAMP` as a side effect of the full build pipeline; reverted all of that churn via `git checkout --` (64-02/64-03 precedent) so the final commit contains only the rebuilt `js/brewpad.min.js`.

## Deviations from Plan

None - plan executed exactly as written. `npm ci` was run in both the repo root and `zoho-middleware/` before testing since the worktree lacked `node_modules` in either location (expected per orchestrator note, not a plan deviation).

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required. Pure frontend change; no Apps Script redeploy.

## Next Phase Readiness
- `js/brewpad.js`, `js/brewpad.min.js`, and the new regression suite are committed and green (frontend `npm test`: 1057/1057 passed; middleware `npm test`: 1362/1362 passed; `npm run lint`: clean).
- 69-02 (Ready-to-Bottle filter, wave 2, depends on 69-01) can proceed — its plan already anticipates refactoring `loadDashboard()` to return a promise, which does not conflict with anything changed here (this plan left `loadDashboard()`'s signature untouched, only added call sites).
- Live browser verification (owner sign-off optional) is still pending: drive BrewPad, check a Bottling/Packaging task from all three surfaces (dashboard, Tasks tab, batch-detail pane), confirm the batch leaves Ready-to-Bottle with no page reload.

---
*Phase: 69-brewpad-batch-view-ux-mark-bottled-reflects-without-refresh-*
*Completed: 2026-08-12*
