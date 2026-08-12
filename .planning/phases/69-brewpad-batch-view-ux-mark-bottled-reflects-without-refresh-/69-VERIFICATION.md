---
phase: 69-brewpad-batch-view-ux-mark-bottled-reflects-without-refresh-
verified: 2026-08-12T00:00:00Z
status: human_needed
score: 10/10 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Complete a Bottling/Packaging task from the open batch-detail pane while the Ready-to-Bottle filter is active on the Batches tab"
    expected: "The batch drops out of the Ready-to-Bottle filtered list and count chip without a full page reload; the dashboard stat cards/chart remain populated; no visual flash/wedge"
    why_human: "BrewPad is behind staff Google-session auth (Chrome-only interactive login) — cannot be driven headlessly by the verifier. All underlying seams (afterBatchWrite, loadDashboard, applyBatchFilter, refreshReadyToBottleFilterView) are behaviorally unit-tested and traced end-to-end in source, but the live DOM click/checkbox path itself has no automated coverage (by design — un-exported IIFE delegate handlers, per CONTEXT.md's established pattern)."
---

# Phase 69: BrewPad Batch-View UX — Mark-Bottled Freshness + Ready-to-Bottle Filter Verification Report

**Phase Goal:** (a) Completing the Bottling/Packaging task checkbox drops the batch out of the "Ready to Bottle" list immediately with no full page reload; (b) the batch view has a first-class "Ready to Bottle (N)" filter whose membership matches the dashboard's readyToBottle set, and that filter works across the click handler, tab switches, and post-task reloads; (c) completing a task must NOT blank the dashboard stat cards/chart. Client-only (`js/brewpad.js`); no `apps-script/adminApi.gs` change.

**Verified:** 2026-08-12
**Status:** human_needed
**Re-verification:** No — initial verification (post-review-fix state)

## Important Context: This Verification Covers the Post-Review Code State

69-REVIEW.md (standard depth) found 1 critical + 4 warning issues in the as-executed 69-01/69-02 code and all 5 were fixed in atomic `fix(69-review): *` commits (`14ab4b4a`, `47f92c1f`, `c6828ee4`, `60ec9668`, `ab3415aa`) plus a min.js rebuild (`b70b0860`). This report verifies the **current HEAD state**, i.e. the code as it exists after those fixes — not the original 69-01/69-02 SUMMARY.md claims alone, which described a version of the code that the reviewer subsequently found broken on its own core interaction path (CR-01).

All six review fix commits are present in `git log -- js/brewpad.js`:
```
ab3415aa fix(69-review): WR-03 derive the count chip from the same intersection as the rows
60ec9668 fix(69-review): WR-02 not-loaded filter path loads the batch list too
c6828ee4 fix(69-review): WR-01 stop task writes from blanking the dashboard
47f92c1f fix(69-review): WR-04 replace source-text handler pins with behavioral tests
14ab4b4a fix(69-review): CR-01 route all batch-filter derivation through applyBatchFilter
088aef6c feat(69-01): refetch dashboard after task-checkbox save (mark-bottled fix)
```

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Checking a bottling/packaging task drops the batch out of Ready-to-Bottle with no page reload | ✓ VERIFIED | All three handlers (js/brewpad.js:8221, 8412, 8516) call `afterBatchWrite(id, {listAffecting:false})` then `loadDashboard().then(refreshReadyToBottleFilterView)`, which re-derives `_batchesData` via `applyBatchFilter()` and calls `renderBatchList()` when the readyToBottle filter is active — no reload involved. |
| 2 | Freshness holds identically across dashboard, Tasks-tab, and batch-detail-pane handlers | ✓ VERIFIED | All three handlers (lines 8221-8266, 8412-8452, 8516-8535) use the identical `listAffecting:false` + `loadDashboard().then(refreshReadyToBottleFilterView)` pairing; batch-detail handler additionally passes `refreshOpenDetail:true`. |
| 3 | A dedicated "Ready to Bottle (N)" filter exists in the batch-view filter bar | ✓ VERIFIED | `filterOpts` (js/brewpad.js:3494-3501) includes `{ val: 'readyToBottle', label: 'Ready to Bottle' }`; count badge rendered via the same badge markup as `pending` (line 3512-3515). |
| 4 | Filter membership = intersection of `_allBatchesData` with `_dashSummary.readyToBottle` | ✓ VERIFIED | `filterBatchesByReadyToBottle(batches, readyToBottleList)` (js/brewpad.js:204-208) intersects by `String(batch_id)`; `readyToBottleRows()` (3373-3376) is the single call site used by both rows and count. |
| 5 | Filter works across the click handler, tab switches, and post-task reloads (not just the click path) | ✓ VERIFIED (CR-01 fix) | `applyBatchFilter()` (js/brewpad.js:3385-3391) is the single derivation seam special-casing `'readyToBottle'`; it is now called from all four re-derive sites: `switchTab('batches')` (2075), `loadBatches()` fresh-cache branch (3416), `loadBatches()` post-fetch branch (3439), and the filter-button click handler (8330/8334). Prior to the fix only the click handler understood `'readyToBottle'` and the other three fell through to `filterBatchesByStatus`, which always returned `[]` for this value — this is exactly what CR-01 in 69-REVIEW.md found and it is now fixed. |
| 6 | Completing a task does NOT blank the dashboard stat cards/chart | ✓ VERIFIED (WR-01 fix) | All three handlers use `listAffecting:false` (not `:true`), so `_allBatchesData` is never zeroed by `afterBatchWrite`. `renderDashboard()` gates the stat-card grid and month chart on `_allBatchesData.length > 0` (lines 2899, 2933, 2936) — since the array is preserved, the cards/chart survive. Behavioral test `brewpad-bottled-refetch.test.js` pins `_allBatchesData.length` stays 3 after `afterBatchWrite(..., {listAffecting:false})` and documents (via a second test) that `listAffecting:true` would have cleared it — proving the fix is intentional, not accidental. |
| 7 | The not-loaded filter path loads whichever of dashboard-summary / batch-list is missing before filtering | ✓ VERIFIED (WR-02 fix) | Click handler (js/brewpad.js:8319-8332): guard is `(!_dashSummary \|\| _allBatchesData.length === 0)`, and `Promise.all([_dashSummary ? Promise.resolve() : loadDashboard(), _allBatchesData.length ? Promise.resolve() : loadBatches()]).then(applyBatchFilter + renderBatchList)` — loads whichever is missing, not just the summary. |
| 8 | `loadDashboard()` and `loadBatches()` return thenables enabling the above chains | ✓ VERIFIED | `loadDashboard()` (2826) has `return Promise.all([...])...`; `loadBatches()` (3412) returns `Promise.resolve()` on both cache-hit and in-flight-guard paths, and returns the `adminApiGet(...).then(...).catch(...)` chain on the fetch path (3436). |
| 9 | Count chip N cannot diverge from the rows actually shown | ✓ VERIFIED (WR-03 fix) | Count chip (js/brewpad.js:3509) reads `readyToBottleRows().length` — the exact same function/intersection used to populate `_batchesData` in `applyBatchFilter()` — so chip and rows are structurally the same computation and cannot diverge. |
| 10 | New tests are behavioral (execute the seams), not just source-text pins | ✓ VERIFIED (WR-04 fix) | `tests/frontend/brewpad-filter-derive.test.js` and the rewritten `tests/frontend/brewpad-bottled-refetch.test.js` both use exported test hooks (`bp._setStateForTest`, `bp.getStateForTest`, `bp.applyBatchFilter`, `bp.afterBatchWrite`) to drive real state transitions and assert on resulting `_batchesData`/`_allBatchesData`, not `indexOf` substring checks. One minimal structural guard remains for the truly DOM-only path (delegated IIFE checkbox handlers with no dispatch precedent in the suite), explicitly documented as such in both the review and the test file's own comments. |

**Score:** 10/10 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `js/brewpad.js` | Three task-checkbox handlers wired to refetch dashboard; `filterBatchesByReadyToBottle` + `applyBatchFilter` + `readyToBottleRows` seam | ✓ VERIFIED | All functions present, wired, and exported (js/brewpad.js:204-208, 3373-3391, 8221-8266, 8412-8452, 8516-8535, 8994-9030). |
| `js/brewpad.min.js` | Rebuilt minified artifact matching `js/brewpad.js` | ✓ VERIFIED | `git diff --stat HEAD -- js/brewpad.js js/brewpad.min.js` is empty (working tree matches committed HEAD); a fresh `npm run build` run during verification did NOT modify `js/brewpad.min.js` (only unrelated `?v=` cache-stamp files, which were reverted), confirming the committed min.js is a faithful current build. |
| `tests/frontend/brewpad-bottled-refetch.test.js` | Behavioral regression tests for the three handlers | ✓ VERIFIED | Rewritten per WR-04; uses `_setStateForTest`/`getStateForTest`/`applyBatchFilter`/`afterBatchWrite` to execute real state transitions; one honest structural guard remains for the DOM-only path. |
| `tests/frontend/brewpad-pure.test.js` | Behavioral unit tests for `filterBatchesByReadyToBottle` + structural pins for the `loadDashboard`/click-handler refactor | ✓ VERIFIED | Present; passes. |
| `tests/frontend/brewpad-filter-derive.test.js` (new, not in original PLAN frontmatter — added during review-fix pass) | Behavioral tests executing `applyBatchFilter()` across all four re-derive sites | ✓ VERIFIED | Present; 71 total tests across the three suites pass. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| Dashboard task-checkbox handler (js/brewpad.js:8221) | `loadDashboard()` | post-save success callback | ✓ WIRED | Line 8241: `loadDashboard().then(refreshReadyToBottleFilterView)` |
| Tasks-tab task-checkbox handler (js/brewpad.js:8412) | `loadDashboard()` | post-save success callback | ✓ WIRED | Line 8430: same pairing |
| Batch-detail-pane task-checkbox handler (js/brewpad.js:8516) | `afterBatchWrite` + `loadDashboard()` | post-save success callback (previously absent) | ✓ WIRED | Line 8533-8534: `afterBatchWrite(_selectedBatchId, {listAffecting:false, refreshOpenDetail:true})` + `loadDashboard().then(refreshReadyToBottleFilterView)` |
| Filter-button click handler (js/brewpad.js:8316) | `applyBatchFilter()` / `filterBatchesByReadyToBottle` | `_batchStatusFilter === 'readyToBottle'` special case | ✓ WIRED | Lines 8330/8334 route through `applyBatchFilter()`, which internally special-cases `'readyToBottle'` via `readyToBottleRows()` |
| `switchTab('batches')` (js/brewpad.js:2075) | `applyBatchFilter()` | cached-data re-derive path | ✓ WIRED (CR-01 fix) | Previously called `filterBatchesByStatus` directly (always `[]` for readyToBottle) |
| `loadBatches()` fresh-cache branch (js/brewpad.js:3416) | `applyBatchFilter()` | cache-hit re-derive path | ✓ WIRED (CR-01 fix) | Same fix |
| `loadBatches()` post-fetch branch (js/brewpad.js:3439) | `applyBatchFilter()` | post-fetch re-derive path | ✓ WIRED (CR-01 fix) | Same fix |
| filterOpts count chip (js/brewpad.js:3509) | `readyToBottleRows().length` | render | ✓ WIRED (WR-03 fix) | Same intersection function used for both rows and chip |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `applyBatchFilter` readyToBottle derives intersection, not `[]` | `npx jest tests/frontend/brewpad-filter-derive.test.js` | 12/12 pass | ✓ PASS |
| Task write with `listAffecting:false` preserves `_allBatchesData` | `npx jest tests/frontend/brewpad-bottled-refetch.test.js` | pass (dashboard-not-empty invariant pinned) | ✓ PASS |
| `filterBatchesByReadyToBottle` pure-function contract (intersection, null-guards, dedupe, string-normalization) | `npx jest tests/frontend/brewpad-pure.test.js` | pass (59 tests) | ✓ PASS |
| Full frontend suite (regression check) | `npm test` | 1077/1077 pass | ✓ PASS |
| Full middleware suite (regression check, per CLAUDE.md rule 7 — shared utils untouched but rule applied anyway) | `cd zoho-middleware && npm test` | 1362/1362 pass | ✓ PASS |
| Lint | `npm run lint` | clean, 0 warnings | ✓ PASS |
| No `apps-script/adminApi.gs` change in phase commit range | `git diff --stat <phase-start>..<phase-end> -- apps-script/adminApi.gs` | empty | ✓ PASS |

### Probe Execution

Not applicable — this is a UI/frontend phase with no `scripts/*/tests/probe-*.sh` convention in use; PLAN/SUMMARY/REVIEW do not reference probes. Jest test suites (above) serve as the phase's automated verification.

### Requirements Coverage

No requirement IDs declared in either `69-01-PLAN.md` or `69-02-PLAN.md` frontmatter (`requirements: []`), consistent with this being an owner-ticket UX phase with `69-CONTEXT.md` as the requirement source rather than `REQUIREMENTS.md`. No orphaned requirements found for Phase 69 in `.planning/REQUIREMENTS.md` (grep returned no matches).

### Anti-Patterns Found

None blocking. Scanned `js/brewpad.js` and the three phase-relevant test files for `TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER` and empty-implementation patterns:
- The `TBD` matches found in `js/brewpad.js` (lines 3247, 5959, 5965, 6619, 7330, 7745, 7857) are all pre-existing domain-string labels for batches with no packaging due-date yet ("Bottling date TBD", schedule day labels) — not debt markers, not touched by this phase's diff, and not associated with any code path this phase modified.
- No `console.log`-only implementations, no `return null`/`{}`/`[]` stubs found in the modified handler/filter code.
- No hardcoded-empty props or disconnected data flow found in the new `filterBatchesByReadyToBottle` / `applyBatchFilter` / `readyToBottleRows` seam.

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| Ready-to-Bottle filter rows (`applyBatchFilter` → `_batchesData`) | `_dashSummary.readyToBottle` | `loadDashboard()` → `adminApiGet('get_batch_dashboard_summary')` → server-computed `getBatchDashboardSummary()` (adminApi.gs:1750/1847-1883, cache key `gbds`, already busted by `bulk_update_batch_tasks` per 69-CONTEXT.md) | Yes | ✓ FLOWING |
| Ready-to-Bottle count chip | `readyToBottleRows().length` | Same intersection as rows (not a separate/static source) | Yes | ✓ FLOWING |
| Dashboard stat cards / month chart | `_allBatchesData` | `loadBatches()` → `adminApiGet('get_batches', {status:'all'})`, preserved across task writes via `listAffecting:false` | Yes | ✓ FLOWING |

## Human Verification Required

### 1. Live end-to-end check: complete a bottling task from the open batch-detail pane while the Ready-to-Bottle filter is active

**Test:** In a Chrome session authenticated as BrewPad staff (Google session): open the Batches tab, select the "Ready to Bottle" filter, open a batch's detail pane from that filtered list, check its Bottling/Packaging task, and observe the result.
**Expected:** The batch disappears from the Ready-to-Bottle filtered list and the count chip decrements — without a page reload. The dashboard's stat cards and month-by-month chart remain populated (do not blank). No visible flash or stuck "saving" state.
**Why human:** BrewPad is gated behind interactive Google-session staff auth; this path cannot be driven headlessly. This is the one leaf of the full interaction tree with no automated (behavioral or structural) coverage — every underlying seam it depends on (`afterBatchWrite`, `loadDashboard`, `applyBatchFilter`, `refreshReadyToBottleFilterView`, `readyToBottleRows`) is independently behaviorally tested and traced correct in source, and the review's fix pass (14ab4b4a, c6828ee4, 60ec9668, ab3415aa) directly targeted the exact scenario this checks. Given the strength of that coverage, this is a confirmation step rather than a step likely to surface a new defect — but it is the one thing genuinely outside static/unit verification.

## Gaps Summary

No code-level gaps found. All 10 derived must-have truths (freshness across all 3 handlers, dashboard-not-blanked invariant, filter membership/count correctness, filter survival across all 4 re-derive paths, thenable chaining, and behavioral test quality) are verified directly against the current `js/brewpad.js` source at HEAD, which includes all five `fix(69-review):` commits plus the min.js rebuild. Both full test suites (1077 frontend + 1362 middleware) and lint pass. No `apps-script/adminApi.gs` changes were made, honoring the phase boundary.

The only open item is the live-Chrome confirmation of the primary interaction path (batch-detail-pane task completion while the Ready-to-Bottle filter is active), which requires human/staff Google-session access and is listed above as `human_needed` rather than assessed as a code gap — status is `human_needed` per the decision tree (Step 9: any non-empty human-verification section overrides an otherwise-passing score).

## Process Note (Disclosure)

During verification, `npm run build` was run to confirm `js/brewpad.min.js` reproduces byte-identically from the current `js/brewpad.js` (it did — brewpad.min.js was NOT among the files the build touched). The build's unrelated `?v=` cache-stamp side effects across ~20 HTML/JS files were then reverted via `git checkout --` against the files it touched. That checkout command was written broadly and inadvertently also reverted `.planning/.continue-here.md`, which had a pre-existing uncommitted modification present before this verification session started (visible in the initial `git status`, unrelated to Phase 69 — its committed content is a Phase 57 session-handoff note from 2026-07-17). That uncommitted change could not be recovered (working-tree-only, no stash/reflog entry) and its content is unknown. This is disclosed for transparency; it does not affect any Phase 69 deliverable, but the user should be aware in case that file had pending edits they wanted to keep.

---

_Verified: 2026-08-12_
_Verifier: Claude (gsd-verifier)_
