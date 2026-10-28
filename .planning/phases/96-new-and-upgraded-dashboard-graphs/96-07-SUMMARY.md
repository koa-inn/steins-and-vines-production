---
phase: 96-new-and-upgraded-dashboard-graphs
plan: 07
subsystem: ui
tags: [brewpad, dashboard, chartjs, es5]
requires:
  - phase: 96-02
    provides: taskRows on get_dashboard_stats
  - phase: 96-04
    provides: DASH_V2_WIDGETS registry and widget helpers
provides:
  - G5 Workload (buildG5Model, renderDashV2Workload) in bp-dash-v2-workload
  - G7 Task health (buildG7Model, renderDashV2Tasks) in bp-dash-v2-tasks
key-files:
  created: [tests/frontend/brewpad-dashboard-v2-floor.test.js]
  modified: [js/brewpad.js, js/brewpad.min.js, css/brewpad.css, css/brewpad.min.css, brewpad.html]
key-decisions:
  - "Registry keys g5 and g7; both declare needs ['taskRows'] so a missing array shows the not-available message"
  - "Added opt-in chart() option boldTick (index) for the Today tick; no other chart() behaviour changed"
duration: ~35min
completed: 2026-10-28
---

# Phase 96 Plan 07: G5 Workload and G7 Task health Summary

Floor today now shows open tasks due per day for 14 or 30 days stacked by task kind, plus overdue ageing (1-3, 4-7, 8+ days) and tasks ticked off over time, with no on-time rate and no per-staff view.

## Commits
- 5271087d: builders, renderers, CSS, build artifacts, floor test file

## Behaviour notes
- Tasks join to batches via dashClassifyRows with global Type and Source (staff included); open = not completed on a primary/secondary batch, so pending-batch tasks are ignored.
- G5 overdue note and G7 ageing total share the same rule (due_date before Vancouver today) and are tested equal for several filter combinations.
- Overdue note renders under the Workload chart/table (`.bp-dash-foot-note`).
- Ageing chart uses a single series with a per-bar ink ramp colour array; one Chart/Table toggle drives both Task health blocks.
- Task titles are only classified, never rendered (T-96-19); no completed_by anywhere (T-96-20); explicit tick-lag note (T-96-21).

## Deviations from Plan
- Tasks 1 and 2 landed in one commit (shared files); tests written alongside code.
- [Rule 3] Added `boldTick` option to chart() because the Today bold tick had no existing hook. Opt-in only.
- Middleware tests not run (no middleware changes; worktree has no zoho-middleware node_modules). Frontend: 229 suites / 3146 tests pass, lint clean. Unrelated build-stamped pages reverted. No edits to any pre-phase test.

## Known Stubs
None.

## Threat Flags
None.

## Self-Check: PASSED
