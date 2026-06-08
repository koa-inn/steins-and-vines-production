---
phase: 27-pending-batch-visibility-activation
plan: 04
subsystem: ui
tags: [admin, batch-tracking, js, es5, vanilla-js]

requires:
  - phase: 27-pending-batch-visibility-activation
    provides: "Plans 27-01/02/03 built pending batch visibility, one-click activate, and guided Schedule & Activate flow in js/admin.js"

provides:
  - "WR-01 closed: both one-click Activate handlers now send start_date: todayPacific() so fermentation_started_at is always stamped to today"
  - "CR-01 closed: guided Schedule & Activate catch now branches on step1Done flag before substring matching, truthfully reporting partial success when step 1 committed but step 2 failed"
  - "Rebuilt js/admin.min.js reflecting both fixes; partial-success toast literal present in minified bundle"

affects: [batch-tracking, admin-ui, brewpad]

tech-stack:
  added: []
  patterns:
    - "step1Done flag pattern for two-step promise chain catch disambiguation"
    - "todayPacific() helper called directly in mutation payloads for calendar-aligned timestamps"

key-files:
  created: []
  modified:
    - js/admin.js
    - js/admin.min.js
    - css/admin.min.css

key-decisions:
  - "Used todayPacific() directly in both one-click activate update_batch payloads rather than changing confirmation copy — behavior now matches the existing promise"
  - "step1Done flag declared before the promise chain (not inside it) so the catch closure reliably captures the committed state even on step-2 errors including version conflicts"
  - "Removed obsolete msg.indexOf('schedule')/msg.indexOf('tasks') substring branch — step1Done now drives partial-success detection, eliminating fragile string matching"

patterns-established:
  - "Two-step promise chain partial-failure detection: declare var stepNDone = false before chain, set true as first statement in .then(stepNResult), branch on flag before message-substring matching in .catch"

requirements-completed: [BATCH-02, BATCH-03]

duration: 30min
completed: 2026-06-08
---

# Phase 27 Plan 04: Batch Activation Gap Closure Summary

**Fixed two batch-activation correctness gaps: one-click Activate now stamps today's Pacific date (WR-01), and guided Schedule & Activate partial-failure is detected via a step1Done flag rather than mismatched error-substring matching (CR-01)**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-06-08T03:30:00Z
- **Completed:** 2026-06-08T04:00:43Z
- **Tasks:** 3
- **Files modified:** 23 (js/admin.js, js/admin.min.js, css/admin.min.css, 20 HTML cache-stamp files)

## Accomplishments

- WR-01 (BATCH-02): Added `start_date: todayPacific()` to both one-click Activate payloads (`batch-activate-btn` inline handler and `#batch-activate-detail` modal handler), so the server-side priority chain (`updates.start_date > current.start_date > now`) always stamps today even when the batch has a pre-existing start_date
- CR-01 (BATCH-03): Declared `var step1Done = false` before the guided `update_batch` call, set it true inside `.then(step1Result)`, and rewrote the `.catch` to branch on `step1Done` first — a genuine step-1 conflict still shows the retry toast; any step-2 failure (including a "Batch was modified" version conflict) now shows the truthful partial-success toast and refreshes the UI to the active batch state
- Task 3: Rebuilt `js/admin.min.js` via `npm run build`; `npm run lint` exits 0 (0 errors, 118 pre-existing warnings); all 432 frontend tests pass

## Task Commits

Each task was committed atomically:

1. **Task 1: WR-01 — stamp start_date=today in both one-click Activate payloads** - `ba4bb9f` (fix)
2. **Task 2: CR-01 — add step1Done flag and reorder guided submit catch** - `bcddd34` (fix)
3. **Task 3: Rebuild minified assets, lint, and verify green test suite** - `86a038a` (chore)

## Files Created/Modified

- `js/admin.js` - Added `start_date: todayPacific()` to both one-click activate payloads; added `var step1Done = false` + flag set + reordered catch in guided sa-submit handler
- `js/admin.min.js` - Rebuilt via `npm run build` reflecting both fixes (partial-success toast literal present: "Batch activated, but the schedule didn't save...")
- `css/admin.min.css` - Rebuilt as part of `npm run build`
- HTML files (20 pages) - Cache-busting `?v=` stamps updated by `npm run build`

## Decisions Made

- Used `todayPacific()` directly in both one-click activate `updates` objects rather than modifying the confirmation copy. The plan specified option (a) from WR-01's fix options: make behavior match the existing promise.
- The `step1Done` flag is declared in the same function scope as the promise chain (not inside a nested closure), ensuring reliable capture by the `.catch` handler regardless of whether the rejection originates from step 1 or step 2.
- Removed the now-obsolete `msg.indexOf('schedule') || msg.indexOf('tasks')` substring branch. This branch was the original partial-success path, but it was unreachable when a step-2 "Batch was modified" conflict fired (the version-conflict branch matched first). `step1Done` subsumes this detection with higher fidelity.
- The full-success `.then(step2Result)` path was not touched — it retains `vesselsData = null`, `closeModal()`, `loadBatchesData()`, `refreshUpcomingCache()`, `loadBatchDashboardSummary()`, and `openBatchDetail()` on `fromDetailModal`.

## Deviations from Plan

None - plan executed exactly as written.

One plan inconsistency noted but not blocking: the Task 1 automated verify requires `grep -c "start_date: todayPacific()" js/admin.js` >= 3, but the acceptance criteria explanation states "two newly-added one-click payloads plus none that pre-existed" (which equals 2). The actual count is 2. The acceptance criteria narrative (which aligns with the task action) was treated as authoritative; the `>= 3` threshold in the automated verify appears to be a copy/paste error in the plan. Both handlers are correctly modified.

## Issues Encountered

- Worktree was initially at commit `30630cd` (before the `d4afcc44` base commit that added the plan file). The `<worktree_branch_check>` reset it to `d4afcc44` before execution, which brought in the admin.js with the phase 27-03 work (11049 lines) required by this plan.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- BATCH-02 and BATCH-03 requirements are now fully satisfied
- Human verification still needed per 27-VERIFICATION.md items 2 and 3 (live Apps Script environment required to confirm fermentation_started_at behavior and step-2 version conflict routing)
- Phase 27 is ready for final verification sign-off

---
*Phase: 27-pending-batch-visibility-activation*
*Completed: 2026-06-08*
