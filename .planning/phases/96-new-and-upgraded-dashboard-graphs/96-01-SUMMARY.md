---
phase: 96-new-and-upgraded-dashboard-graphs
plan: 01
subsystem: planning
tags: [approval, tests, governance]
requires: []
provides: [owner test-edit decision, research §7 Phase 96 note]
key-files:
  created:
    - .planning/phases/96-new-and-upgraded-dashboard-graphs/96-TEST-DECISION.md
  modified:
    - .planning/research/brewpad-dashboard-v2.md
decisions:
  - "Owner approved updating exactly the listed Phase 95 assertions in tests/frontend/brewpad-dashboard-v2-widgets.test.js (items 1-6); no other existing test file may change"
metrics:
  tasks: 2
  completed: 2026-10-28
---

# Phase 96 Plan 01: Owner test-edit decision Summary

Owner approved (2026-10-28) the six assertion groups in the Phase 95 widgets test that D-15/D-16 and the UI-SPEC force to change. The approved list is in 96-TEST-DECISION.md, with each edit assigned to plan 04, 05 or 06. Line numbers were re-grepped at 05dc48bf and match the plan.

## Tasks

1. **Owner decision** — `Owner decision: approve` recorded with the final assertion list and the unaffected assertions (tile drills L214-233, Feb whole-column drill L330-331, slot ids, copy).
2. **Research §7 owner note** — added the 2026-10-28 Phase 96 bullet with amendments D-02/D-03, D-04, D-08/D-09, D-14. Ticks unchanged (10 G items [x]; Phase D, A1-A5, Phase F unticked).

## Deviations from Plan

Ran inline by the orchestrator (decision checkpoint + one doc edit) instead of a spawned executor.

## Self-Check: PASSED
