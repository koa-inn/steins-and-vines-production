---
phase: 27-pending-batch-visibility-activation
plan: "01"
subsystem: admin-batch-ui
tags: [batch, admin, visibility, filter, status-badge]
dependency_graph:
  requires: []
  provides: [pending-batch-visibility, pending-status-badge, pending-filter-option, pending-pin-to-top]
  affects: [apps-script/adminApi.gs, admin.html, js/admin.js, css/admin.css]
tech_stack:
  added: []
  patterns: [status-aware-comparator, pending-pin-before-sort-direction]
key_files:
  created: []
  modified:
    - apps-script/adminApi.gs
    - admin.html
    - js/admin.js
    - css/admin.css
    - js/admin.min.js
    - css/admin.min.css
decisions:
  - "Purple chosen for pending badge color (#f3e5f5 bg / #6a1b9a text) — visually distinct from blue/amber/green/gray"
  - "Pending pin returned before batchSortDir application so direction cannot override pin"
  - "Pending option placed after Active (first dedicated single-status option) in dropdown"
metrics:
  duration: 125s
  completed: "2026-06-07"
  tasks_completed: 4
  tasks_total: 4
  files_modified: 6
requirements: [BATCH-01]
---

# Phase 27 Plan 01: Pending Batch Visibility Activation Summary

**One-liner:** Pending batches now appear in the default Active admin list with a purple badge, a dedicated filter option, and always pinned to top.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Widen backend active filter to include pending | 19e13f0 | apps-script/adminApi.gs |
| 2 | Add Pending option to status filter dropdown | 613c003 | admin.html |
| 3 | Add pending badge to BATCH_STATUSES and pin pending rows to top | 6806094 | js/admin.js, css/admin.css |
| 4 | Rebuild frontend bundle | 9aa097e | js/admin.min.js, css/admin.min.css + all stamped HTML files |

## What Was Built

**BATCH-01 implementation:** Pending batches were previously silently excluded from the default Active view (`getBatches` active branch filtered to only `primary`/`secondary`). Staff had no way to see work waiting to be activated.

Four coordinated changes surface pending batches:

1. **Backend filter widened** (`adminApi.gs:1318`): Active branch now includes `s === 'pending'` alongside primary/secondary. The generic exact-match else branch (for the dedicated Pending filter) is unchanged.

2. **Dropdown option added** (`admin.html:374`): `<option value="pending">Pending</option>` inserted after the Active option in `#batch-status-filter`. Lowercase `pending` value matches backend exact-match filter.

3. **Status badge added** (`js/admin.js BATCH_STATUSES`): `pending: { label: 'Pending', color: 'purple' }` entry added. CSS class `.batch-status--purple` added to `css/admin.css` (`#f3e5f5` background, `#6a1b9a` text) — distinct from all existing badge colors.

4. **Pending rows pinned to top** (`renderBatchList` comparator): Before any field comparison, the comparator now checks if either row is pending and returns -1/1 immediately. This pin is applied before the `batchSortDir === 'desc' ? -cmp : cmp` line, so sort direction cannot invert it. Pending batches with no `start_date` no longer sink to the bottom under date-desc sort.

## Deviations from Plan

**1. [Rule 2 - Missing artifact] css/admin.css requires .batch-status--purple**
- **Found during:** Task 3
- **Issue:** Plan specified `pending: { label: 'Pending', color: 'purple' }` but `.batch-status--purple` did not exist in css/admin.css (only blue/amber/green/gray existed).
- **Fix:** Added `.batch-status--purple { background: #f3e5f5; color: #6a1b9a; }` to css/admin.css adjacent to other batch-status color classes — essential for the badge to render distinctly.
- **Files modified:** css/admin.css
- **Commit:** 6806094

**2. [Rule 3 - Build side-effects] Build stamps version hash on all HTML files**
- **Found during:** Task 4
- **Issue:** `npm run build` (stamp step) regenerates version query strings on all public HTML files. All 22 HTML files were updated.
- **Fix:** Staged all build-modified HTML files in the Task 4 commit — this is the expected build behavior documented in CLAUDE.md.
- **Commit:** 9aa097e

## Known Stubs

None — no placeholder data or TODO stubs introduced.

## Threat Flags

None — changes are within existing admin trust boundary; no new network endpoints, auth paths, or schema changes introduced. The T-27-02 mitigation (frontend sends fixed lowercase literal; backend already lowercases and exact-matches) is correctly implemented.

## Verification Checklist

- [x] `grep -c "s === 'primary' || s === 'secondary' || s === 'pending'" apps-script/adminApi.gs` returns 1
- [x] `<option value="pending">Pending</option>` exists in #batch-status-filter
- [x] BATCH_STATUSES contains `pending: { label: 'Pending', color: 'purple' }`
- [x] Pending pin comparator fires before `batchSortDir` direction inversion
- [x] `.batch-status--purple` CSS class exists in admin.css
- [x] `npm run lint` — 0 errors (118 pre-existing warnings)
- [x] `npm run build` exits 0
- [x] admin.min.js contains "Pending" string
- [x] `npm test` — 432 tests passing

## Self-Check: PASSED

- apps-script/adminApi.gs exists and contains widened predicate: FOUND
- admin.html contains `<option value="pending">`: FOUND
- js/admin.js BATCH_STATUSES contains `pending:`: FOUND
- css/admin.css contains `.batch-status--purple`: FOUND
- Commits 19e13f0, 613c003, 6806094, 9aa097e: FOUND in git log
