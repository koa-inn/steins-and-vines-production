---
phase: 27-pending-batch-visibility-activation
verified: 2026-06-07T23:00:00Z
status: gaps_found
score: 3/4 must-haves verified
overrides_applied: 0
gaps:
  - truth: "A 'Schedule & activate' option lets staff pick a fermentation schedule template, start date, and vessel/location, then promotes the batch to Primary in a single confirmed step"
    status: partial
    reason: "CR-01: Two-step orchestration is implemented but the catch handler cannot distinguish a step-2 version conflict from a step-1 failure. If step 1 (update_batch -> primary) succeeds and step 2 (update_batch_schedule) fails with 'Batch was modified', the catch matches the version_conflict branch first ('version_conflict' or 'Batch was modified' substring) and shows 'Version conflict — refresh and try again' — but the batch is already primary with no schedule. No step1Done flag guards this path. After the operator refreshes, the pending-gated buttons are gone (batch is no longer pending) and there is no obvious path to attach the schedule. The batch is left active-but-unscheduled with a misleading error message."
    artifacts:
      - path: "js/admin.js"
        issue: "Catch handler at ~line 7265 checks version_conflict substring BEFORE schedule/tasks substring. A step-2 'Batch was modified' error is misrouted to the version-conflict branch even though step 1 committed. No step1Done flag distinguishes step-1 failures from step-2 failures."
    missing:
      - "Add a `var step1Done = false;` flag before the adminApiPost chain, set it to true inside the .then(step1Result) handler before returning the step-2 call, then reorder the catch: if (!step1Done && version_conflict) show conflict toast; else if (step1Done) always show partial-success path (close modal + refresh list) regardless of error message content."
  - truth: "A pending batch row/detail shows an 'Activate' action that, in one click, flips the batch to Primary with the fermentation start date set to today"
    status: partial
    reason: "WR-01: Both one-click Activate handlers send only { status: 'primary' } with no start_date field. The confirmation copy explicitly states 'the start date is set to today', but the backend fermentation_started_at priority chain is: updates.fermentation_started_at > updates.start_date > current.start_date > now. A pending batch that was created with a start_date (createBatch writes payload.start_date at line 1956) will have fermentation_started_at stamped to that pre-existing start_date, not today — directly contradicting the confirmation copy. The batch's start_date column is also never updated to today."
    artifacts:
      - path: "js/admin.js"
        issue: "Inline handler at line 5735: updates: { status: 'primary' } — no start_date. Modal handler at line 5925: updates: { status: 'primary' } — no start_date. Confirmation copy at lines 5729 and 5919 promises 'start date is set to today' but the payload does not enforce it."
    missing:
      - "Change both one-click activate payloads to include start_date: todayPacific() so that both the start_date column and fermentation_started_at reflect today unconditionally, matching the confirmation copy's promise."
---

# Phase 27: Pending Batch Visibility & Activation — Verification Report

**Phase Goal:** Staff can see and act on pending batches directly from the admin batch list, promoting them to Primary either instantly or through a guided setup.
**Verified:** 2026-06-07T23:00:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Pending batches appear in the admin batch list (no longer hidden), and the status filter includes a "Pending" option showing only pending batches | VERIFIED | `adminApi.gs:1319` widens active filter to `s === 'primary' \|\| s === 'secondary' \|\| s === 'pending'`; `admin.html:375` adds `<option value="pending">Pending</option>` to `#batch-status-filter`; `BATCH_STATUSES.pending` with distinct purple badge at `admin.js:5518`; pin-to-top comparator at `admin.js:5642-5645` fires before `batchSortDir` |
| 2 | A pending batch row/detail shows an "Activate" action that, in one click, flips the batch to Primary with the fermentation start date set to today | PARTIAL — WARNING | Buttons exist and wire correctly. Inline (`batch-activate-btn` at admin.js:5686) and modal (`#batch-activate-detail` at admin.js:5890) both gated on `status === 'pending'`, call `showConfirm` with no-schedule warning, send `update_batch { status: 'primary', expectedVersion }`, call all three refresh helpers on success. **WR-01 defect:** payload omits `start_date: todayPacific()` so the backend priority chain (`current.start_date > now`) means a batch with a pre-existing start_date gets that date stamped, not today — contradicting the confirmation copy |
| 3 | A "Schedule & activate" option lets staff pick a fermentation schedule template, start date, and vessel/location, then promotes the batch to Primary in a single confirmed step | PARTIAL — BLOCKER | Modal (`openScheduleActivateModal` / `_buildScheduleActivateModal`) exists with schedule select + live preview + start date + optional vessel/shelf/bin; two-step orchestration calls `update_batch` then `update_batch_schedule` with chained `newVersion`. **CR-01 defect:** catch handler at `admin.js:7265` checks `'version_conflict'\|\|'Batch was modified'` substring BEFORE `'schedule'\|\|'tasks'` — a step-2 version conflict is misrouted to the retry-conflict branch even though step 1 already committed, leaving the batch primary-with-no-schedule and no recovery UI visible |
| 4 | After either activation path, the batch immediately reflects Primary status and the chosen start date in the list and detail views without a manual page reload | VERIFIED | All success paths confirmed: inline activate calls `loadBatchesData()` + `refreshUpcomingCache()` + `loadBatchDashboardSummary()` (admin.js:5737-5740); modal activate additionally calls `openBatchDetail(batchId)` (admin.js:5928-5931); guided flow calls all four plus `closeModal()` + `vesselsData = null` on full success |

**Score:** 2/4 truths fully verified (2 partial — 1 BLOCKER, 1 WARNING)

### Deferred Items

None.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps-script/adminApi.gs` | Backend active filter includes pending; `start_date` in allowedFields; priority chain for `fermentation_started_at` | VERIFIED | Line 1319: widened predicate confirmed. Line 2164: `'start_date'` added to allowedFields. Lines 2204-2215: priority chain `updates.fermentation_started_at > updates.start_date > current.start_date > now` confirmed |
| `admin.html` | `<option value="pending">` in `#batch-status-filter` | VERIFIED | Line 375 confirmed; value is lowercase matching backend exact-match filter |
| `js/admin.js` | `BATCH_STATUSES.pending`; pin-to-top comparator; inline/modal activate buttons; `openScheduleActivateModal` | VERIFIED (with defects noted in truths 2 and 3) | All identifiers present; logic defects documented above |
| `css/admin.css` | `.batch-status--purple` badge class | VERIFIED | Line 1838: `.batch-status--purple { background: #f3e5f5; color: #6a1b9a; }` — distinct from all other badge colors |
| `js/admin.min.js` | Contains activate and schedule-activate strings | VERIFIED | `grep -c "batch-activate"` returns 1 (minified); `grep -c "schedule-activate"` returns 1; 432 tests pass |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `#batch-status-filter` dropdown | `getBatches` status param | `loadBatchesData` / `loadBatchInit` passes `batch-status-filter.value` as status | WIRED | Confirmed by existing wiring at admin.js:5559/5581; new `pending` value routes to backend exact-match else branch (adminApi.gs:1322-1324) |
| `renderBatchList` sort | Pending pinning | Status-aware comparator before `batchSortDir` application | WIRED | admin.js:5641-5645 — `aPend !== bPend` guard returns before direction inversion |
| Pending row Activate button | `update_batch` action | `adminApiPost update_batch` with `updates.status primary` + `expectedVersion` | WIRED | admin.js:5732-5736: confirmed. Defect: `start_date` not included (WR-01) |
| Activation success | Live refresh | `loadBatchesData` / `refreshUpcomingCache` / `loadBatchDashboardSummary` / `openBatchDetail` | WIRED | All four calls confirmed for all paths |
| Schedule & Activate confirm | `update_batch` then `update_batch_schedule` | Sequenced `adminApiPost` with chained `newVersion` | PARTIAL | Step sequencing is correct; `newVersion` chaining confirmed at admin.js:7244-7248. Catch handler defect (CR-01) can misroute step-2 failures |
| Chosen start date | `fermentation_started_at` + task due dates | `update_batch start_date` field + `updateBatchSchedule` reads `current.start_date` | WIRED | `start_date` in `batchUpdates` at admin.js:7232; `update_batch_schedule` reads `current.start_date` for due date math (adminApi.gs:2321) |

### Data-Flow Trace (Level 4)

Not applicable — these are action/mutation flows, not data-display rendering flows. All activation paths are user-triggered and have no static/disconnected data source concern.

### Behavioral Spot-Checks

Step 7b: SKIPPED — no runnable entry points for the Google Apps Script backend or the admin UI in isolation. Behavioral verification requires human testing against a live admin session.

### Probe Execution

Step 7c: SKIPPED — no `scripts/*/tests/probe-*.sh` files found; no probes declared in PLAN files.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| BATCH-01 | 27-01-PLAN.md | Staff can see pending batches in the admin batch list, including a "Pending" option in the status filter | SATISFIED | Backend filter widened; filter option added; distinct badge; pin-to-top — all verified in codebase |
| BATCH-02 | 27-02-PLAN.md | Staff can activate a pending batch with one click — quick flip to Primary with start date set to today | PARTIALLY SATISFIED | One-click mechanism works but WR-01: `start_date` not sent in payload means "today" is only guaranteed when batch has no existing start_date |
| BATCH-03 | 27-03-PLAN.md | Staff can activate a pending batch via a guided flow that sets a fermentation schedule template, start date, and vessel/location before promoting to Primary | PARTIALLY SATISFIED | Guided flow implemented but CR-01: step-2 version conflict misrouted, leaving batch active-but-unscheduled with a misleading toast |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `js/admin.js` | 5735 | `updates: { status: 'primary' }` — no `start_date` | WARNING (WR-01) | Batch may get wrong fermentation start date; confirmation copy says "today" but backend uses `current.start_date` if present |
| `js/admin.js` | 7265-7275 | Catch handler checks `version_conflict` / `Batch was modified` before `schedule`/`tasks` | BLOCKER (CR-01) | Step-2 version conflict misrouted to retry toast; batch left active-but-unscheduled, no recovery UI |
| `apps-script/adminApi.gs` | 1196, 1672, 1783, 1808 | `TBD` comments | PRE-EXISTING | All four TBD occurrences (`// TBD for packaging`, `TBD packaging at end`, etc.) are confirmed pre-existing before phase-27 commits (present in parent of `19e13f0`). Not introduced by this phase. Not a gate violation. |

### Human Verification Required

1. **Pending batches appear in default Active view**
   **Test:** Open the admin BrewPad batches tab with at least one pending batch in the sheet. Confirm it appears without selecting any filter.
   **Expected:** Pending batch visible, purple "Pending" badge, pinned above any primary/secondary rows.
   **Why human:** Cannot verify the live Google Sheets data or Apps Script execution environment programmatically.

2. **One-click Activate — fermentation start date behavior**
   **Test:** Create a pending batch that has a pre-existing `start_date` (e.g., a date last week). Click the inline Activate button, confirm the dialog, then open the batch detail and note `fermentation_started_at`.
   **Expected (per WR-01):** Current implementation will set `fermentation_started_at` to the pre-existing `start_date`, NOT today. The confirmation dialog says "today" but that is only true when the batch has no existing `start_date`. This mismatch should be acknowledged or fixed.
   **Why human:** WR-01 is a behavioral bug that only manifests with a pending batch that has a non-empty `start_date`; requires a real Apps Script environment to observe.

3. **Schedule & Activate — step-2 version conflict path**
   **Test:** Simulate a concurrent edit by: (a) opening the Schedule & Activate modal for a pending batch, (b) from another tab, editing the same batch to update `last_updated`, (c) back in the first tab, submitting the modal. If step 1 succeeds before the concurrent edit, a step-2 version conflict fires.
   **Expected (per CR-01 defect):** Current code shows "Version conflict — refresh and try again" but the batch is already primary. The desired behavior is "Batch activated but schedule failed — assign schedule from the detail modal."
   **Why human:** Requires a real concurrent edit in the Apps Script environment; not reproducible via static analysis.

4. **Schedule & Activate — full happy path with non-today start date**
   **Test:** Pick a schedule template, set a start date 7 days from now, optionally select a vessel. Submit. Check the batch detail for `fermentation_started_at` and check the generated tasks' due dates.
   **Expected:** `fermentation_started_at` = chosen date (not today); all task due dates keyed to chosen date via `calculateDueDate`.
   **Why human:** Requires live Apps Script execution and real task generation.

### Gaps Summary

Two gaps block full goal achievement:

**Gap 1 — BLOCKER (CR-01): Guided activation partial-failure misrouting**

The `Schedule & Activate` two-step orchestration lacks a `step1Done` flag to distinguish step-1 failures from step-2 failures. If step 1 commits and step 2 gets a version conflict (`"Batch was modified"`), the current catch handler routes it to the retry-conflict branch ("Version conflict — refresh and try again") instead of the partial-success branch. After refreshing, the batch is `primary` with no schedule and no `pending`-gated buttons, leaving staff no obvious recovery path.

Root cause: catch handler checks `'version_conflict' || 'Batch was modified'` before `'schedule' || 'tasks'` with no step-tracking state.

Fix: add `var step1Done = false;` before the promise chain, set it inside the first `.then()`, and reorder the catch to branch on `step1Done` first.

**Gap 2 — WARNING (WR-01): One-click Activate start date mismatch**

Both one-click activate handlers send `{ status: 'primary' }` only. The confirmation copy says "start date is set to today" but the backend stamps `fermentation_started_at` from `current.start_date` when non-empty, not `now`. A batch created with a start_date (a real scenario per `adminApi.gs:1899`) gets the wrong fermentation timestamp.

Fix: add `start_date: todayPacific()` to both one-click activate payloads.

These two gaps share a single concern category (activation correctness) and can be fixed in one targeted plan. The code review (27-REVIEW.md) documents the same issues as CR-01 and WR-01 with ready-to-apply fix patterns.

---

_Verified: 2026-06-07T23:00:00Z_
_Verifier: Claude (gsd-verifier)_
