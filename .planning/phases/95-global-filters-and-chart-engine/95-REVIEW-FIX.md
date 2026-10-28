---
phase: 95-global-filters-and-chart-engine
fixed_at: 2026-10-28T21:30:00Z
review_path: .planning/phases/95-global-filters-and-chart-engine/95-REVIEW.md
iteration: 1
findings_in_scope: 7
fixed: 6
skipped: 1
status: partial
---

# Phase 95: Code Review Fix Report

**Fixed at:** 2026-10-28T21:30:00Z
**Source review:** .planning/phases/95-global-filters-and-chart-engine/95-REVIEW.md
**Iteration:** 1

**Scope:** WR-01 to WR-06, plus IN-01 (tooltip plural). IN-02 to IN-10 were left out of scope on purpose (see the end of this report).

**Summary:**
- Findings in scope: 7
- Fixed: 6
- Skipped: 1 (WR-05)

Each fix started with a failing regression test in a new test file. No existing test was changed. The new test files are:
- `tests/frontend/brewpad-dashboard-v2-review-fixes.test.js`, with 9 tests covering WR-01, WR-02, WR-03, WR-06 and IN-01.
- `zoho-middleware/__tests__/backfill/staff-batch-backfill-fingerprint.test.js`, with 11 tests covering WR-04.

Final runs: frontend `npm test` 3012/3012 passed and `npm run lint` is clean. Middleware `npm test` 3708/3708 passed, `npm run lint` is clean and `npm run test:db` passed 443/443 (51 suites).

## Fixed Issues

### WR-01: Bulk create from the pull sheet doesn't clear an active drill-down

**Files modified:** `js/brewpad.js`, `js/brewpad.min.js`, `brewpad.html`, `tests/frontend/brewpad-dashboard-v2-review-fixes.test.js`
**Commit:** 76bc5fc4
**Applied fix:** Added `setBatchStatusFilterProgrammatic(status)`, which sets the filter and drops `_dashDrill`. The pull-sheet success path now uses it. I checked the other places that set `_batchStatusFilter`. The v1 pipeline tile and `clearDashDrill` already reset the drill. The chip tap keeps the drill on purpose (D-14 intersection), and the remaining one is a test seam. I also added the `_renderPullCandidatesForTest` seam, so the test can run the real Create Batches click.

### WR-02: Custom range validated against the client's today but evaluated against asOf.today

**Files modified:** `js/brewpad.js`, `js/brewpad.min.js`, `brewpad.html`, test file
**Commit:** 11cb3f2f
**Applied fix:** `buildDashV2Model` now clamps a custom `to` that falls after `asOf.today` (with `from` on or before it) to `asOf.today`. It also takes `periodLabel` from the window it actually used: custom gives start to end, and anything else gives the label for `win.key`. A range that lies wholly after `asOf.today` still falls back to YTD, but the label now says "YTD". `windowFromFilters` is unchanged because an existing test pins its YTD fallback for a `to` past today.
**Status:** fixed: requires human verification (logic change)

### WR-03: v2 renders zero tiles and deltas when no data source is loaded

**Files modified:** `js/brewpad.js`, `js/brewpad.min.js`, `brewpad.html`, test file
**Commit:** b7d50e67
**Applied fix:** `refreshDashV2` now checks for missing data first. If there is no `_dashData`, the list is empty and the list is not marked loaded, it doesn't build a model. Instead it shows a skeleton in the tiles slot and "Loading…" in the two widgets. It then calls `loadBatches()` once and re-renders when that finishes. If that load fails, it shows "Dashboard data could not load…" instead of zeros. When the list loaded and is really empty, it still renders, because those zeros are real. A new `_eagerLoading` flag stops the boot eager load and this path from both fetching the list. In the summary fallback, `setStaffBatch` now also patches `staff_batch` on the matching `_allBatchesData` row before `refreshDashV2()`, so the staff tick shows up in the mix.
**Status:** fixed: requires human verification (state handling)

### WR-04: The backfill `--expect` gate checks only the count

**Files modified:** `zoho-middleware/scripts/backfill/staff-batch-backfill.js`, `zoho-middleware/scripts/backfill/README.md`, `docs/RUNBOOK.md` ("Staff batch flag (Phase 95)"), `zoho-middleware/__tests__/backfill/staff-batch-backfill-fingerprint.test.js`
**Commit:** d0c68642
**Applied fix:**
- **Fingerprint:** a new `fingerprintIds(ids)` returns the first 12 hex characters of the sha256 of the sorted, comma-joined batch ids. It is computed after `--exclude`.
- **Dry run:** it prints `fingerprint: <fp>`, and its re-run hint is now `--apply [--exclude=...] --expect=N --expect-ids=<fp>`.
- **CLI flags:** `parseArgs` accepts `--expect-ids=<12 hex>`. It refuses `--apply` without `--expect-ids`, and `--expect-ids` without `--apply`.
- **Apply:** the count check comes first, then the fingerprint check. Either mismatch exits 3 with no writes.
- **Unchanged:** `--expect=N` and `--exclude` work as before, and all existing backfill tests pass unchanged.

The fingerprint is mandatory only on the command line, in `parseArgs`. Calling `runStaffBackfill` directly without `expectIds` still checks only the count, because the existing unit and DB tests call it that way and may not be edited.

### WR-06: Phone/tablet filter-bar mode fixed at render time

**Files modified:** `js/brewpad.js`, `js/brewpad.min.js`, `brewpad.html`, test file
**Commit:** 8259d6ad
**Applied fix:** The first v2 render now binds a listener on `matchMedia('(max-width: 600px)')` once. It uses `addEventListener('change')` and falls back to `addListener` for older iPad Safari. The handler closes any open bottom sheet and calls `updateDashV2Bar()`, which rebuilds the bar when the mode changes. Nothing is bound if `matchMedia` is unavailable, and the guard flag is set only after a listener is actually attached.

### IN-01: Tooltip says "1 batches"

**Files modified:** `js/brewpad.js`, `js/brewpad.min.js`, `brewpad.html`, test file
**Commit:** 73b47976
**Applied fix:** The tooltip label now reads `val + (Number(val) === 1 ? ' batch' : ' batches')`. The litres label and the footer are unchanged.

## Skipped Issues

### WR-05: Staff provenance hint is guessed from the current source

**File:** `js/brewpad.js:8212` (staff hint in the detail pane)
**Reason:** I can't make an honest fix without changing an existing test or the schema. No provenance is stored anywhere: `staff_batch` is a plain boolean (migration 0008), and there is no audit trail for it. So the only fix that doesn't add a migration is the softer wording the review suggests, such as "Internal batch" with no claim about who set it. But `tests/frontend/brewpad-staff-batch-ui.test.js` asserts the exact strings "Set automatically (internal batch)" and "Set automatically (research batch)". Any honest wording would require editing that existing test, which CLAUDE.md rule 10 forbids without an explicit request. A session-only "ticked by hand" marker would still show the wrong text after a reload, so I didn't ship that either. To close it, pick one:
1. Approve editing the two hint assertions in `brewpad-staff-batch-ui.test.js` (lines ~96 and ~101). The copy for internal/research rows would then become something like "Internal batch" / "Research batch", with no claim about who set it.
2. Add a `staff_batch_source` column ('create'|'manual'|'backfill') in a later additive migration, and show "Set automatically" only when it is 'create'.

**Original issue:** `staffHint = STAFF_SOURCE_HINTS[current source] || 'Set by hand'`. A batch whose source was edited to internal and then ticked by hand, or an internal batch that was unticked and ticked again, says "Set automatically", which contradicts D-19.

### Out of scope (Info items left as-is by instruction)

IN-02, IN-03, IN-04, IN-05, IN-06, IN-07, IN-08, IN-09 and IN-10 were not attempted. The fix scope was limited to WR-01 to WR-06 plus IN-01.

## Notes

- After each `npm run build` I reverted the unrelated files it re-stamps (other `*.html`, `js/admin.js`, `js/admin.min.js`). Only `brewpad.html`, `js/brewpad.js` and `js/brewpad.min.js` were committed. `css/brewpad.min.css` was not changed.
- I added two test seams to the `module.exports` test block: `_renderPullCandidatesForTest` and `_setStaffBatchForTest`.

---

_Fixed: 2026-10-28T21:30:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
