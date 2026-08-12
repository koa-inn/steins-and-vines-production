---
phase: 69-brewpad-batch-view-ux-mark-bottled-reflects-without-refresh-
reviewed: 2026-08-12T00:00:00Z
depth: standard
files_reviewed: 3
files_reviewed_list:
  - js/brewpad.js
  - tests/frontend/brewpad-bottled-refetch.test.js
  - tests/frontend/brewpad-pure.test.js
findings:
  critical: 1
  warning: 4
  info: 1
  total: 6
status: issues_found
---

# Phase 69: Code Review Report

**Reviewed:** 2026-08-12
**Depth:** standard
**Files Reviewed:** 3
**Status:** issues_found

## Summary

Phase 69 has two parts: (a) the three task-checkbox handlers now call
`afterBatchWrite(batchId, {listAffecting:true})` + `loadDashboard()` after a
`bulk_update_batch_tasks` save, and `loadDashboard()` was refactored to RETURN
its `Promise.all` chain; (b) a new `filterBatchesByReadyToBottle` pure helper is
wired into the batch-view filter bar with a count chip and a `loadDashboard().then()`
fallback.

Focus-question verdicts:

1. **loadDashboard() returned-promise refactor is SAFE.** All 7 other call sites
   (2070, 2812, 2822, 6687, 6699, 8004, 8059, 8194, 8380, 8482) are statement-position
   fire-and-forget; none read the return value or test its truthiness. The only
   consumer of the returned promise is the new fallback at 8279. Timing is unchanged
   (the fetch still fires synchronously; only the return value changed from `undefined`
   to a thenable). No caller is broken.
2. **The not-loaded fallback is throw-safe.** `loadDashboard()` never rejects (the
   outer `.catch` swallows all failures and its inner promise also `.catch`es), so
   the `.then()` at 8279 always fires. The null-guard `(_dashSummary && _dashSummary.readyToBottle) || []`
   plus the internal `readyToBottleList || []` in the helper double-guard against a throw. BUT see WR-02 — the fallback only refetches `_dashSummary`, never `_allBatchesData`.
3. **Double render exists** (loadDashboard's `renderDashboard()` + the 400 ms optimistic
   `renderDashboard()`); both are idempotent but wasteful and can flash stale data (IN-01).
4. **The pure intersection is correct** — string-normalized match, empty/missing
   `readyToBottle` → empty list (not all), dedupe via object keys, no mutation. Well tested.
5. **Optimistic reconciliation is correct** for the task row, but the Ready-to-Bottle
   card/list drop is not optimistic — it waits on `loadDashboard()` latency.

The headline defect is CR-01: the new `'readyToBottle'` filter value is only
understood by the batch-list click handler. Every other path that re-derives
`_batchesData` runs it through `filterBatchesByStatus`, which returns an empty
list for `'readyToBottle'` — so the brand-new filter silently empties on a routine
tab-switch or reload.

## Critical Issues

### CR-01: Ready-to-Bottle filter silently empties on any re-derive path (tab switch / reload / post-write)

**File:** `js/brewpad.js:2075`, `js/brewpad.js:3373`, `js/brewpad.js:3396` (root: `filterBatchesByStatus` at `js/brewpad.js:188`)
**Issue:** The `'readyToBottle'` filter value is special-cased in exactly ONE place:
the batch-list click handler (8272–8283, using `filterBatchesByReadyToBottle`).
Every other site that rebuilds `_batchesData` does so with
`filterBatchesByStatus(_allBatchesData, _batchStatusFilter)`:

- `switchTab('batches')` at 2075 (when `_allBatchesData` is already cached)
- `loadBatches()` fresh-cache branch at 3373
- `loadBatches()` post-fetch branch at 3396

`filterBatchesByStatus(batches, 'readyToBottle')` falls through to
`batches.filter(b => String(b.status).toLowerCase() === 'readyToBottle')`. No batch
has status `readyToBottle` (statuses are `primary`/`secondary`/`complete`/…), and
the `filter` argument is not even lower-cased, so this **always returns `[]`**.

Reproduction: select the "Ready to Bottle" filter (list shows N batches) → switch to
the Tasks tab → switch back to Batches. `switchTab` re-derives via 2075 and the list
is now empty, while the filter chip still renders as active (2075/3530 compare to
`_batchStatusFilter`). The same empty result occurs on the primary mark-bottled flow:
completing a task clears `_allBatchesData` (see WR-01), so returning to the Batches tab
calls `loadBatches()` → 3396 → `filterBatchesByStatus('readyToBottle')` → `[]`. The
feature is broken on its own core interaction path.

**Fix:** Route ALL filter application through one helper that understands
`readyToBottle`, e.g.:
```javascript
function applyBatchFilter() {
  if (_batchStatusFilter === 'readyToBottle') {
    _batchesData = filterBatchesByReadyToBottle(
      _allBatchesData, (_dashSummary && _dashSummary.readyToBottle) || []);
  } else {
    _batchesData = filterBatchesByStatus(_allBatchesData, _batchStatusFilter);
  }
}
```
Replace the three `filterBatchesByStatus(_allBatchesData, _batchStatusFilter)`
re-derive sites (2075, 3373, 3396) and the click handler with `applyBatchFilter()`.
(This also fixes the click-handler duplication at 8274/8280/8285.)

## Warnings

### WR-01: `listAffecting:true` clears `_allBatchesData` but nothing reloads it — dashboard stat cards vanish after completing a task

**File:** `js/brewpad.js:8193`, `js/brewpad.js:8379` (+ `afterBatchWrite` at 2008–2013, `renderDashboard` at 2899)
**Issue:** The three handlers were changed from `listAffecting:false` to
`listAffecting:true` (commit 088aef6c). `afterBatchWrite` with `listAffecting:true`
sets `_allBatchesData = []` and `_batchesLoaded = false` (2009–2010), but
`loadDashboard()` refetches only `_dashSummary`/`_upcomingTasks` — it does NOT
repopulate `_allBatchesData`. `renderDashboard()` gates the stat-card grid
("Fermenting now", "Started this year", …) and the client-side stacked
"Batches by Month" chart on `if (_allBatchesData.length > 0)` (2899, 2936). So after
completing a task on the dashboard tab, those cards disappear and stay gone until the
user visits the Batches tab (only `switchTab('batches')` at 2078–2079 triggers a
reload). This is a regression versus the prior `listAffecting:false` behavior, which
preserved `_allBatchesData`. Note the dashboard's Ready-to-Bottle list is driven by
`_dashSummary.readyToBottle`, not `_allBatchesData`, so clearing the batch cache is
unnecessary for the mark-bottled fix itself — it only needs `_dashLoadTime` reset.
**Fix:** After the write, also refresh the batch cache (e.g. call `loadBatches()` /
include `get_batches` in the refetch), or have `renderDashboard` tolerate the stale-but-
present cache, or use a lighter reset that resets `_dashLoadTime`/`_batchesLoaded`
without zeroing `_allBatchesData` until the reload resolves.

### WR-02: Not-loaded filter fallback refetches only the summary, never the batch list

**File:** `js/brewpad.js:8279`
**Issue:** The fallback `loadDashboard().then(function () { _batchesData = filterBatchesByReadyToBottle(_allBatchesData, …) })`
assumes `_allBatchesData` is already populated. `loadDashboard()` fetches
`get_batch_dashboard_summary` + `get_tasks_upcoming` only — never `get_batches`. If the
user reaches the Ready-to-Bottle filter while `_allBatchesData` is empty/stale (e.g.
right after a task write cleared it per WR-01), the fallback resolves `_dashSummary` but
`filterBatchesByReadyToBottle([], …)` returns `[]` — an empty list with no error.
**Fix:** In the not-loaded path, ensure the batch list is loaded too before filtering,
e.g. `Promise.all([loadDashboard(), _allBatchesData.length ? Promise.resolve() : loadBatches()]).then(applyBatchFilter)`,
or fold this into the CR-01 `applyBatchFilter` helper with a guard that reloads batches
when `_allBatchesData.length === 0`.

### WR-03: Count chip overstates visible rows (chip from `_dashSummary`, rows from intersection)

**File:** `js/brewpad.js:3464`
**Issue:** The chip count is `((_dashSummary && _dashSummary.readyToBottle) || []).length`,
but the rows actually rendered are the intersection
`filterBatchesByReadyToBottle(_allBatchesData, _dashSummary.readyToBottle)`. When a
`readyToBottle` batch_id is absent from `_allBatchesData` (data gap, or the cache was
just cleared per WR-01), the chip shows a higher number than the rows displayed — e.g.
chip "3", list shows 0–2. The pure test at brewpad-pure.test.js:200 explicitly pins
that phantom ids are dropped from the list, confirming this divergence is possible.
**Fix:** Derive the chip count from the same intersection the list uses:
`filterBatchesByReadyToBottle(_allBatchesData, (_dashSummary && _dashSummary.readyToBottle) || []).length`.

### WR-04: Three-handler "regression" tests are source-text pins, not behavioral tests

**File:** `tests/frontend/brewpad-bottled-refetch.test.js:43-63`
**Issue:** All four tests are `indexOf` substring assertions over the raw source
(`window.indexOf('loadDashboard()')`, `'listAffecting: true'`, `'afterBatchWrite('`).
They never execute the handlers, dispatch a change event, or assert any runtime effect.
They therefore CANNOT catch: CR-01 (readyToBottle re-derive emptying the list), WR-01
(stat cards disappearing), the double-render (IN-01), or a regression where
`loadDashboard()`'s promise stops resolving. They also break on unrelated edits that
shift the 1500-char window or rename a local. Passing these tests gives false confidence
that "mark-bottled reflects without refresh" actually works end-to-end. The pure-function
tests in brewpad-pure.test.js are genuine and good; the handler tests are not.
**Fix:** Add at least one behavioral test that seeds `_dashSummary.readyToBottle` +
`_allBatchesData`, drives a checkbox change (or invokes an extracted handler), stubs
`adminApiPost`/`adminApiGet`, and asserts the batch drops out of the rendered list and
that a refetch occurred. Extracting the filter-application into `applyBatchFilter`
(CR-01 fix) makes this directly unit-testable.

## Info

### IN-01: Redundant double `renderDashboard()` with possible stale intermediate frame

**File:** `js/brewpad.js:8194` + `js/brewpad.js:8207`
**Issue:** On the dashboard handler's success path, `loadDashboard()` (8194) will call
`renderDashboard()` when its fetch resolves, and the optimistic-removal branch also
schedules `setTimeout(renderDashboard, 400)` (8207). Both fully rebuild
`#bp-dashboard-inner`. If `loadDashboard()` resolves after 400 ms, the 400 ms render runs
against a still-stale `_dashSummary` (the just-bottled batch still appears in the
Ready-to-Bottle card) and an already-emptied `_allBatchesData`, then re-renders again on
resolve — a visible flash and wasted work.
**Fix:** Render once — either chain the optimistic cleanup off `loadDashboard().then(...)`,
or skip the standalone 400 ms `renderDashboard()` when a refetch is already in flight.

---

_Reviewed: 2026-08-12_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
