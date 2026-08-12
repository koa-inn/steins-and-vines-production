---
phase: 69-brewpad-batch-view-ux-mark-bottled-reflects-without-refresh-
plan: 02
subsystem: ui
tags: [brewpad, batch-view, filter, cache-freshness, vanilla-js]

# Dependency graph
requires:
  - phase: 69-01
    provides: "loadDashboard() refetch wired into all three task-checkbox handlers, so _dashSummary.readyToBottle stays fresh after task completions"
provides:
  - "First-class 'Ready to Bottle (N)' filter option in the BrewPad batch view, membership sourced from _dashSummary.readyToBottle (server-computed set, not re-derived client-side)"
  - "loadDashboard() returns the Promise.all thenable, enabling chained .then() continuations"
  - "filterBatchesByReadyToBottle pure helper, exported alongside filterBatchesByStatus"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure filter-predicate sibling functions declared outside the IIFE and registered in the outer module.exports block (filterBatchesByReadyToBottle mirrors filterBatchesByStatus)"
    - "loadDashboard() as a chainable thenable for 'load-then-apply' UI flows, while remaining safe for existing fire-and-forget callers"

key-files:
  created: []
  modified:
    - js/brewpad.js
    - js/brewpad.min.js
    - tests/frontend/brewpad-pure.test.js

key-decisions:
  - "loadDashboard() gained a `return` before its Promise.all chain (was previously undefined) so the not-loaded filter path can chain .then(); verified safe by grepping every existing call site (2070, 2812, 2822, 6687, 6699, 8004, 8059, 8194, 8380, 8482) — all fire-and-forget and unaffected by the return value."
  - "Count chip badge markup/behavior for 'Ready to Bottle' reuses the exact pending-badge styling (orange pill), extending the existing single-purpose 'pending only' badge conditional to also cover readyToBottle rather than duplicating the markup block."
  - "Regression tests for the loadDashboard refactor and click-handler wiring live in tests/frontend/brewpad-pure.test.js (per plan instruction) as structural source-text assertions, matching the established pattern for BrewPad's un-exported IIFE-scoped event handlers (brewpad-activation.test.js, brewpad-bottled-refetch.test.js) since there's no DOM-dispatch precedent for the delegated filter-bar click handler."

patterns-established: []

requirements-completed: []

# Metrics
duration: 3min
completed: 2026-08-12
---

# Phase 69 Plan 02: Ready-to-Bottle Filter Summary

**Added a first-class "Ready to Bottle (N)" filter to the BrewPad batch view, backed by the server-computed `_dashSummary.readyToBottle` set via a new `filterBatchesByReadyToBottle` intersection helper, plus a `loadDashboard()` returned-promise refactor so the filter can be applied immediately after a refetch when the dashboard summary isn't yet loaded.**

## Performance

- **Duration:** ~3 min (first commit to last: 10:50:35 → 10:52:51 PDT)
- **Started:** 2026-08-12T17:50:35Z
- **Completed:** 2026-08-12T17:52:51Z
- **Tasks:** 3
- **Files modified:** 3 (js/brewpad.js, js/brewpad.min.js, tests/frontend/brewpad-pure.test.js)

## Accomplishments
- Staff can now select a dedicated "Ready to Bottle (N)" filter chip in the batch view that shows exactly the batches present in the dashboard's Ready-to-Bottle list — no more proxying with the imprecise "Secondary" status filter.
- The filter's membership and count are both driven by the single server-computed source of truth (`_dashSummary.readyToBottle`, adminApi.gs:1847-1883), so it inherits 69-01's refetch-on-task-completion fix automatically — completing a bottling task removes the batch from the filtered view without a page reload.
- `loadDashboard()` now returns its fetch thenable, enabling the "filter selected before dashboard loaded" path to chain `.then()` and apply the filter the moment fresh data arrives, with zero impact on its nine existing fire-and-forget call sites.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add pure filterBatchesByReadyToBottle helper + export + behavioral unit tests (TDD)** - `b98128f2` (test, RED) → `3f623b83` (feat, GREEN)
2. **Task 2: Wire the Ready-to-Bottle option into the filter bar (loadDashboard refactor + option + count chip + click handler)** - `0e0bfa18` (feat)
3. **Task 3: Rebuild js/brewpad.min.js and run full gates** - `0d2c0805` (chore)

_TDD cycle (Task 1): RED (b98128f2, 10 new tests fail — `filterBatchesByReadyToBottle is not a function`) → GREEN (3f623b83, all 59 tests in the suite pass) → no refactor commit needed._

## Files Created/Modified
- `js/brewpad.js` -
  - New top-level pure function `filterBatchesByReadyToBottle(batches, readyToBottleList)` at line ~188, sibling to `filterBatchesByStatus`, intersecting on `String(batch_id)`; exported in the outer `module.exports` block.
  - `loadDashboard()` (line 2826) now `return`s its `Promise.all([...])` chain (previously returned `undefined`); internal `.then`/`.catch` behavior unchanged.
  - `filterOpts` (~3451) gained `{ val: 'readyToBottle', label: 'Ready to Bottle' }`; the pending-badge conditional was extended to also render a count badge for `readyToBottle`, reading `(_dashSummary && _dashSummary.readyToBottle || []).length` — not re-derived from `_allBatchesData`.
  - Filter-button click handler (~8269) special-cases `_batchStatusFilter === 'readyToBottle'`: applies `filterBatchesByReadyToBottle` immediately if `_dashSummary` is loaded, otherwise calls `loadDashboard().then(...)` to refetch first, then applies the filter and re-renders. All other filters still route through unchanged `filterBatchesByStatus`.
- `tests/frontend/brewpad-pure.test.js` - New `describe('filterBatchesByReadyToBottle')` suite (10 tests: intersection, empty/null/undefined `readyToBottle`, null/undefined `batches`, absent-in-batches, duplicate ids, string/numeric id normalization, no-mutation) plus a new `describe('Ready-to-Bottle filter wiring (structural)')` suite (2 tests) pinning `return Promise` in `loadDashboard()` and `loadDashboard().then(` in the not-loaded filter branch via source-text assertions.
- `js/brewpad.min.js` - Rebuilt via `npm run build` from the edited `js/brewpad.js`; never hand-edited. Unrelated `?v=` cache-bust stamp churn across 18 HTML files and `js/admin.js`'s `BUILD_TIMESTAMP` bump (side effects of the full build pipeline) were reverted via `git checkout --` (64-02/64-03 precedent) so the final commit contains only the rebuilt `js/brewpad.min.js`.

## Decisions Made
- Reused the exact pending-badge markup/styling for the new readyToBottle count chip rather than introducing a second badge style, per CONTEXT.md's "Claude's discretion" on chip styling/placement.
- Kept `filterBatchesByStatus` completely untouched (no overloading) — the plan explicitly required a new sibling pure function to preserve its directly-unit-tested pure-status contract.
- Structural regression tests for the loadDashboard/click-handler wiring were placed in `brewpad-pure.test.js` (per the plan's explicit file target) rather than a new file, alongside the new behavioral suite for the pure helper.

## Deviations from Plan

None - plan executed exactly as written. `npm ci` was run in both the repo root and `zoho-middleware/` before testing since the worktree lacked `node_modules` in either location (expected per orchestrator note, not a plan deviation).

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required. Pure frontend change; no Apps Script redeploy (no `apps-script/adminApi.gs` changes in this plan).

## Next Phase Readiness
- `js/brewpad.js`, `js/brewpad.min.js`, and the extended `tests/frontend/brewpad-pure.test.js` are committed and green (frontend `npm test`: 1069/1069 passed; middleware `npm test`: 1362/1362 passed; `npm run lint`: clean).
- Phase 69 is now feature-complete across both plans (69-01 mark-bottled refetch + 69-02 Ready-to-Bottle filter). Live browser verification (owner sign-off optional) is still pending: open the batch view, confirm the "Ready to Bottle (N)" filter chip appears with the correct count, select it, confirm membership matches the dashboard's Ready-to-Bottle list, complete a bottling task, and confirm the batch drops out of the filtered view without a page reload.

---
*Phase: 69-brewpad-batch-view-ux-mark-bottled-reflects-without-refresh-*
*Completed: 2026-08-12*
