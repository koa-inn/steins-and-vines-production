---
phase: 27-pending-batch-visibility-activation
verified: 2026-06-08T05:30:00Z
status: human_needed
score: 4/4 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 2/4
  gaps_closed:
    - "WR-01: Both one-click Activate payloads now include start_date: todayPacific() (lines 5735, 5925)"
    - "CR-01: var step1Done flag declared, set inside .then(step1Result), catch branches on step1Done before substring matching (lines 7238, 7244, 7264, 7267)"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Pending batches appear in default Active view"
    expected: "Pending batch visible without selecting any filter; purple Pending badge shows; row pinned above primary/secondary rows"
    why_human: "Cannot verify live Google Sheets data or Apps Script execution environment programmatically"
  - test: "One-click Activate stamps today's date (WR-01 fix confirmation)"
    expected: "Create a pending batch with a pre-existing start_date (e.g., last week). Click inline Activate, confirm the dialog, open the batch detail and verify fermentation_started_at equals today's Pacific date (not the pre-existing start_date)"
    why_human: "Behavioral fix only observable in a live Apps Script environment with real batch data"
  - test: "Schedule & Activate — step-2 version conflict shows truthful partial-success (CR-01 fix confirmation)"
    expected: "Open Schedule & Activate for a pending batch; from another tab edit the batch to update last_updated; back in the first tab submit the modal. If step 1 commits before the concurrent edit fires, the catch should show 'Batch activated, but the schedule didn't save — assign it from the batch detail' and refresh the list to the active state (not 'Version conflict — refresh and try again')"
    why_human: "Requires a real concurrent edit in the Apps Script environment; not reproducible via static analysis"
  - test: "Schedule & Activate — full happy path with non-today start date"
    expected: "Pick a schedule template, set start date 7 days from now, optionally select a vessel. Submit. Verify fermentation_started_at equals the chosen date and all generated task due dates are keyed from the chosen date via calculateDueDate"
    why_human: "Requires live Apps Script execution and real task generation"
---

# Phase 27: Pending Batch Visibility & Activation — Verification Report

**Phase Goal:** Staff can see and act on pending batches directly from the admin batch list, promoting them to Primary either instantly (one-click) or through a guided setup flow.
**Verified:** 2026-06-08T05:30:00Z
**Status:** human_needed
**Re-verification:** Yes — after gap closure by plan 27-04

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Pending batches appear in the admin batch list (no longer hidden), and the status filter includes a "Pending" option showing only pending batches | VERIFIED | `adminApi.gs:1319` widens active filter to `s === 'primary' \|\| s === 'secondary' \|\| s === 'pending'`; `admin.html:375` adds `<option value="pending">Pending</option>` to `#batch-status-filter`; `BATCH_STATUSES.pending` at `admin.js:5518` with distinct purple badge; pin-to-top comparator at `admin.js:5642-5645` fires before `batchSortDir` |
| 2 | A pending batch row/detail shows an Activate action that, in one click, flips the batch to Primary with the fermentation start date set to today | VERIFIED | WR-01 closed: inline handler at `admin.js:5735` sends `updates: { status: 'primary', start_date: todayPacific() }`; detail-modal handler at `admin.js:5925` sends the same; confirmation copy at lines 5729 / 5919 is unchanged; `todayPacific()` is in the same IIFE scope; backend priority chain (`updates.start_date > current.start_date > now`) at `adminApi.gs:2204-2214` now receives today unconditionally |
| 3 | A Schedule & activate option lets staff pick a fermentation schedule template, start date, and vessel/location, then promotes the batch to Primary in a single confirmed step | VERIFIED | CR-01 closed: `var step1Done = false` declared at `admin.js:7238` before the promise chain; `step1Done = true` set as first statement inside `.then(step1Result)` at `admin.js:7244`; catch at `admin.js:7262` now branches `if (!step1Done && version_conflict)` at line 7264 → conflict toast only; `else if (step1Done)` at line 7267 → partial-success toast "Batch activated, but the schedule didn't save..." + `closeModal` + all refresh helpers; genuine step-1 conflict still shows retry toast and does not close the modal |
| 4 | After either activation path, the batch immediately reflects Primary status and the chosen start date in the list and detail views without a manual page reload | VERIFIED | Inline activate: `loadBatchesData` + `refreshUpcomingCache` + `loadBatchDashboardSummary` at `admin.js:5737-5740`; detail-modal activate additionally calls `openBatchDetail(batchId)` at `admin.js:5928-5931`; guided flow full-success calls all four plus `closeModal` + `vesselsData = null` at `admin.js:7254-7260`; partial-success path also calls `loadBatchesData` + `refreshUpcomingCache` + `loadBatchDashboardSummary` + conditional `openBatchDetail` at `admin.js:7272-7275` |

**Score:** 4/4 truths verified

### Deferred Items

None.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps-script/adminApi.gs` | Backend active filter includes pending; `start_date` in allowedFields; priority chain for `fermentation_started_at` | VERIFIED | Line 1319: widened predicate confirmed. Line 2164: `'start_date'` in allowedFields. Lines 2204-2214: priority chain `updates.fermentation_started_at > updates.start_date > current.start_date > now` confirmed |
| `admin.html` | `<option value="pending">` in `#batch-status-filter` | VERIFIED | Line 375 confirmed; value is lowercase matching backend exact-match filter |
| `js/admin.js` | `BATCH_STATUSES.pending`; pin-to-top comparator; inline/modal activate with `start_date: todayPacific()`; `openScheduleActivateModal` with `step1Done` flag | VERIFIED | All four checks pass: `BATCH_STATUSES.pending` at line 5518; comparator at lines 5642-5645; both one-click payloads include `start_date: todayPacific()` at lines 5735, 5925; guided submit declares `var step1Done` at line 7238 and sets it at 7244; catch branches on `step1Done` at lines 7264, 7267 |
| `css/admin.css` | `.batch-status--purple` badge class | VERIFIED | Pre-existing from 27-01; line 1838 confirmed |
| `js/admin.min.js` | Rebuilt; contains partial-success literal "Batch activated, but the schedule" | VERIFIED | `grep -q "Batch activated, but the schedule" js/admin.min.js` returns match; `npm run build` produced the file; 432 tests pass |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `#batch-status-filter` dropdown | `getBatches` status param | `loadBatchesData` / `loadBatchInit` passes `batch-status-filter.value` as status | WIRED | Existing wiring at admin.js:5559/5581; `pending` value routes to backend exact-match else branch at adminApi.gs:1322-1324 |
| `renderBatchList` sort | Pending pinning | Status-aware comparator before `batchSortDir` application | WIRED | admin.js:5641-5645 — `aPend !== bPend` guard returns `-1/1` before direction inversion |
| Pending row inline Activate button | `update_batch` with `start_date` today | `adminApiPost update_batch` with `updates.status primary` + `start_date: todayPacific()` + `expectedVersion` | WIRED | admin.js:5732-5736 confirmed; `start_date: todayPacific()` present |
| Detail-modal Activate button | `update_batch` with `start_date` today | Same as inline; `#batch-activate-detail` handler | WIRED | admin.js:5922-5925 confirmed; `start_date: todayPacific()` present |
| Activation success | Live refresh | `loadBatchesData` / `refreshUpcomingCache` / `loadBatchDashboardSummary` / `openBatchDetail` | WIRED | All calls confirmed for all paths |
| Schedule & Activate confirm | `update_batch` then `update_batch_schedule` | Sequenced `adminApiPost` with chained `newVersion`; `step1Done` flag guards partial-success | WIRED | Step sequencing at admin.js:7239-7261; `newVersion` chaining at 7245-7250; `step1Done` flag declared 7238, set 7244, branched 7264/7267 |
| Chosen start date | `fermentation_started_at` + task due dates | `update_batch start_date` field + `updateBatchSchedule` reads `current.start_date` | WIRED | `start_date: startDate` in `batchUpdates` at admin.js:7232; `update_batch_schedule` reads `current.start_date` for due date math at adminApi.gs:2334 |

### Data-Flow Trace (Level 4)

Not applicable — these are user-triggered mutation flows, not data-display rendering flows. All activation paths initiate on button click with no static/disconnected data source concern.

### Behavioral Spot-Checks

Step 7b: SKIPPED — no runnable entry points for the Google Apps Script backend or the admin UI in isolation. Behavioral verification requires human testing against a live admin session.

### Probe Execution

Step 7c: SKIPPED — no `scripts/*/tests/probe-*.sh` files found; no probes declared in any PLAN file for this phase.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| BATCH-01 | 27-01-PLAN.md | Staff can see pending batches in the admin batch list, including a "Pending" option in the status filter | SATISFIED | Backend filter widened at adminApi.gs:1319; filter option at admin.html:375; distinct purple badge at admin.js:5518; pin-to-top at admin.js:5642-5645 |
| BATCH-02 | 27-02-PLAN.md | Staff can activate a pending batch with one click — quick flip to Primary with start date set to today | SATISFIED | WR-01 closed: both one-click handlers send `start_date: todayPacific()` at admin.js:5735, 5925; backend priority chain at adminApi.gs:2204-2214 stamps today unconditionally; confirmation copy matches behavior |
| BATCH-03 | 27-03-PLAN.md | Staff can activate a pending batch via a guided flow that sets a fermentation schedule template, start date, and vessel/location before promoting to Primary | SATISFIED | CR-01 closed: `openScheduleActivateModal` at admin.js:7096; `step1Done` flag at 7238, 7244; catch correctly routes step-2 failures to partial-success path at 7267-7275; `update_batch_schedule` call with chained `newVersion` at 7248-7251 |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `js/admin.js` | 5763 | Fallback fetch opens modal with `(result.data && result.data.batch) \|\| { batch_id: bid }` — if `result.data.batch` is null, `last_updated` is undefined, silently skipping optimistic locking | WARNING (WR-04, pre-existing from 27-03, not introduced by 27-04) | Edge case: unexpected get_batch response shape bypasses version check; low-severity since a missing batch is improbable after a list render |
| `js/admin.js` | 5726-5744 | Inline `.batch-activate-btn` catch re-enables button but does not refresh stale `data-version`; second click after version conflict fails again until list reload | WARNING (WR-02, pre-existing, not in this phase's scope) | Operator stuck on conflict until manual list reload; UX friction, not data corruption |
| `apps-script/adminApi.gs` | 1196, 1672, 1783, 1808 | `TBD` comments (packaging-related) | PRE-EXISTING | Confirmed pre-existing before phase-27 commits; all four reference packaging steps, not the activation paths. Not a debt-marker gate violation. |

### Human Verification Required

1. **Pending batches appear in default Active view**

   **Test:** Open the admin BrewPad batches tab with at least one pending batch in the Google Sheet. Confirm it appears without selecting any filter.
   **Expected:** Pending batch visible with purple "Pending" badge, pinned above any primary/secondary rows.
   **Why human:** Cannot verify live Google Sheets data or Apps Script execution environment programmatically.

2. **One-click Activate stamps today's date (WR-01 fix confirmation)**

   **Test:** Create a pending batch that has a pre-existing `start_date` (e.g., a date from last week). Click the inline Activate button in the batch list, confirm the dialog, then open the batch detail and check `fermentation_started_at`.
   **Expected:** `fermentation_started_at` equals today's Pacific date (not the pre-existing `start_date`). The `start_date` column should also reflect today.
   **Why human:** Behavioral fix only observable in a live Apps Script environment with real batch data containing a pre-existing `start_date`.

3. **Schedule & Activate — step-2 version conflict shows truthful partial-success (CR-01 fix confirmation)**

   **Test:** Open Schedule & Activate modal for a pending batch. From another browser tab, edit the same batch to change `last_updated`. Back in the first tab, submit the modal. If step 1 (update_batch) commits before the second tab's edit is processed, step 2 (update_batch_schedule) will get a "Batch was modified" version conflict.
   **Expected:** UI shows "Batch activated, but the schedule didn't save — assign it from the batch detail" warning toast, closes the modal, and refreshes the list (batch appears as Primary). Does NOT show "Version conflict — refresh and try again".
   **Why human:** Requires a real concurrent edit in the Apps Script environment; not reproducible via static analysis.

4. **Schedule & Activate — full happy path with non-today start date**

   **Test:** Pick a schedule template, set a start date 7 days from now, optionally select a vessel. Submit.
   **Expected:** Batch detail shows `fermentation_started_at` = chosen date (not today); generated task due dates all offset from the chosen date via `calculateDueDate`.
   **Why human:** Requires live Apps Script execution and real task generation to observe.

### Gaps Summary

No automated gaps remain. All four must-haves are verified in the codebase:

- WR-01 (BATCH-02): Both one-click Activate payloads now send `start_date: todayPacific()`. The backend priority chain (`updates.start_date > current.start_date > now`) will always stamp today regardless of any pre-existing `start_date`. Closed by plan 27-04 Task 1 (commit `ba4bb9f`).
- CR-01 (BATCH-03): `var step1Done = false` declared, set inside `.then(step1Result)`, and the catch branches on the flag before any substring matching. A genuine step-1 conflict still shows the retry toast without closing the modal. A step-2 failure of any kind (including a "Batch was modified" version conflict) shows the truthful partial-success toast and refreshes the list. Closed by plan 27-04 Task 2 (commit `bcddd34`).
- `npm test`: 432/432 passing. `npm run lint`: 0 errors (118 pre-existing warnings).
- `js/admin.min.js` rebuilt and contains the partial-success literal "Batch activated, but the schedule didn't save..." confirming the minified bundle reflects the source fixes.

Status is `human_needed` because human UAT is required to confirm the live Apps Script behavior of both fixes in a real admin session — not because any automated check failed.

Two pre-existing warnings (WR-02 stale data-version on conflict re-enable; WR-04 fallback fetch skips optimistic locking) remain open but were scoped out of phase 27 gap closure. They do not block the phase goal.

---

_Verified: 2026-06-08T05:30:00Z_
_Verifier: Claude (gsd-verifier)_
