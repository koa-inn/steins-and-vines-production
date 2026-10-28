---
phase: 95-global-filters-and-chart-engine
plan: 06
subsystem: brewpad-dashboard
tags: [dashboard, filters, v2-optin, tdd, es5]
requires: [95-05]
provides: [buildDashV2Model, isDashV2, setDashV2, syncDashSwitch, renderDashboardV2, refreshDashV2, destroyDashV2Charts, readDashFiltersFromEnv, writeDashFiltersToEnv, "#bp-dash-v2 shell ids"]
affects: [95-07, 95-08]
key-files:
  created: [tests/frontend/brewpad-dashboard-v2-shell.test.js]
  modified: [js/brewpad.js, js/brewpad.min.js, css/brewpad.css, css/brewpad.min.css, brewpad.html]
decisions:
  - "Filter bar mode (tablet row vs phone Filters button) is chosen in JS from matchMedia, rebuilt only when the mode changes, so radiogroups are never duplicated in the DOM"
  - "Switch button click is a single document-level delegated listener so it works under Jest and in prod without initDelegation"
  - "eagerLoad skeleton write is skipped when #bp-dash-v2 exists so the shell survives eager loads"
metrics:
  completed: 2026-10-28
---

# Phase 95 Plan 06: v2 shell and global filter bar Summary

Per-device v2 opt-in (`?dash=v2`, `#dash=v2`, in-app switch), a two-statement dispatch at the top of the frozen v1 `renderDashboard`, and a persistent v2 shell with a sticky accessible filter bar (tablet segmented controls, custom range row, phone bottom-sheet) whose state lives in the hash (replaceState) and localStorage and recomputes `buildDashV2Model` on every change.

## Commit
- Single commit for both tasks (they edit the same js/brewpad.js and build artifacts); see git log "feat(95-06)".

## Verification
- New shell suite 20/20; full `npm test` 2958 passed (220 suites); `npm run lint` clean; `npm run build` ran.
- v1 diff inside renderDashboard: only `syncDashSwitch();` and `if (isDashV2()) { return renderDashboardV2(); }`. One extra guard in eagerLoad (skeleton skipped when the v2 shell exists).
- `.bp-dash-filters` uses `top: 0` (not `--bp-shell-height`), per the plan.

## Deviations from Plan
- Worktree base was wrong; reset to e1638172 per startup check.
- Tasks 1 and 2 committed together (shared files), not as two commits.
- `npm run build` re-stamped unrelated HTML and admin.js/min.js; reverted, committed only plan files (brewpad.html also carries the cache-buster stamp).
- Tests use jsdom's real `window.localStorage` (the module ignores a replaced `global.localStorage`).
- Tablet-hide media rule not needed (JS picks the mode); CSS keeps only the phone nowrap/chart-height rules.
- Middleware tests not run (untouched; vancouver-timezone failure pre-existing).

## Known Stubs
- `#bp-dash-v2-tiles`, `-period`, `-wine` are empty containers; plan 08 fills them (intentional).

## Threat Flags
None. T-95-22/23/25 mitigated and tested (hash-injected markup yields no elements; throwing storage handled; replaceState uses pathname + search + serialised whitelisted state).

## Self-Check: PASSED
