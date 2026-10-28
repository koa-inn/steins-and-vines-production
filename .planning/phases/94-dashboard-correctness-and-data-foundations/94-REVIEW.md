---
phase: 94-dashboard-correctness-and-data-foundations
reviewed: 2026-10-28T01:49:12Z
depth: standard
files_reviewed: 17
files_reviewed_list:
  - brewpad.html
  - css/brewpad.css
  - js/brewpad.js
  - zoho-middleware/lib/batch-pg-create.js
  - zoho-middleware/lib/batch-pg-read.js
  - zoho-middleware/lib/batch-pg-tasks.js
  - zoho-middleware/lib/batch-pg-update.js
  - zoho-middleware/lib/batch-proxy.js
  - zoho-middleware/lib/batch-rules.js
  - zoho-middleware/lib/batch-store.js
  - zoho-middleware/lib/batch-type-hints.js
  - zoho-middleware/migrations/0007_batch_type.sql
  - zoho-middleware/routes/pos.js
  - zoho-middleware/scripts/backfill/batch-cycle-recompute.js
  - zoho-middleware/scripts/backfill/batch-type-backfill.js
  - zoho-middleware/scripts/backfill/batches-replay-to-sheet.js
  - zoho-middleware/scripts/backfill/completed-at-backfill.js
findings:
  critical: 1
  warning: 4
  info: 5
  total: 10
status: issues_found
---

# Phase 94: Code Review Report

**Reviewed:** 2026-10-28T01:49:12Z
**Depth:** standard
**Files Reviewed:** 17
**Status:** issues_found

## Narrative Findings (AI reviewer)

## Summary

I reviewed the Phase 94 hunks (`git diff d5f4731b..HEAD`) and the code they call: the classifier, hint resolution, the create/update/re-derive paths, the trusted backfill channel, completed_at stamping, the `get_dashboard_stats` aggregate and its memo, the proxy wiring, the frontend data layer and the type editor, and the four CLIs.

The trusted channel holds up. `trusted`, `batchTypeSource` and `completedAtSource` can only come from the CLIs, because `batch-store.writeOpts` forwards only `actor` and `now`. No client can set a `*_source` column, and the aggregate SQL whitelists its columns, so no customer, token or notes fields leak.

The main correctness gap is `completed_at` across a status reopen. It is never cleared, so the new dashboard counts a reopened batch as completed, and a later re-completion keeps the stale date. That defeats the B1/B2 goal this phase exists for. The type editor is also unreliable for any batch missing from the cached aggregate, because `get_batch`/`get_batches` never return `batch_type`.

## Critical Issues

### CR-01: completed_at survives a reopen, so the dashboard counts fermenting batches as completed and re-completion keeps a stale date

**File:** `zoho-middleware/lib/batch-pg-update.js:392-401`, `js/brewpad.js:537-540`
**Issue:** The BrewPad status badge cycles `primary → secondary → complete → primary` (js/brewpad.js ~7047-7053). The admin.js status select (js/admin.js:5893) can also move a batch out of `complete`. When that happens, `updateBatch` leaves `completed_at` and `completed_at_source` in place. Phase 94 makes two things depend on that column:
1. `getDashboardData` adds `completed++` for **any** started status (primary/secondary/complete) whose `completed_day` falls in the window (line 537). It does not require `status === 'complete'`. A reopened batch is counted in both "Fermenting now" and "Completed this year", and in `completedByType`.
2. When the batch is completed again through the badge, the new D-23 stamp is skipped because `!row.completed_at` is false. The first, accidental completion date is kept with source `status`. Its cycle time is understated, and it is counted in the cycle tile at the wrong date. If the batch is instead re-completed through the packaging task, `onPackagingCompleted` overwrites the date (batch-pg-tasks.js:165). So the result depends on which path ran.

A mis-tap from secondary to complete is easy on an iPad. To recover, staff click on to primary and then secondary, which leaves the bad stamp behind. No test covers complete → primary/secondary (`batch-pg-update-completed-stamp.test.js` only tests pending → primary).
**Fix:** Clear the stamp when a batch leaves `complete`, and count completions only for complete rows:
```js
// batch-pg-update.js, after the D-23 block
} else if (values.status !== undefined && values.status !== 'complete' &&
           oldStatus === 'complete' && row.completed_at) {
  values.completed_at = null;
  completedSource = null;
}
```
```js
// brewpad.js getDashboardData
if (it.status === 'complete' && inWindow(row.completed_day, win)) { completed++; ... }
```
Write the regression test first (complete → primary clears; then → complete restamps `now`). Separately, check production for complete-then-reopened rows that already carry a stale `completed_at`.

## Warnings

### WR-01: The D-23 stamp fires on complete → complete, writing "now" onto legacy rows that D-14 says must stay blank

**File:** `zoho-middleware/lib/batch-pg-update.js:399`
**Issue:** The condition `values.status === 'complete' && !row.completed_at` never checks `oldStatus`. Any `update_batch` that re-sends `status: 'complete'` stamps today's date on a batch that is already complete but has no date. Those are exactly the "stays-blank" rows from the B2 backfill (no completed task), which D-14 says must stay excluded. Callers that re-send status include integrations, the admin panel and future edit forms. The test "leaves an existing completed_at" only covers rows that already have a date. The result is a fake cycle time of (today − start), the same class of inflated number that B1 fixed.
**Fix:** `} else if (values.status === 'complete' && oldStatus !== 'complete' && !row.completed_at) {`, plus a test for a complete row with no date that is re-sent `status: 'complete'`.

### WR-02: get_batch/get_batches never return batch_type, so the detail Type control and "Needs a type" use a stale snapshot, and a manual set looks reverted

**File:** `js/brewpad.js:2995-3007` (batchTypeInfo), `js/brewpad.js:598` (filterBatchesByNeedsType), `zoho-middleware/lib/batch-rules.js:160` (serializeBatch emits BATCH_COLUMNS only)
**Issue:** `batch_type`/`batch_type_source` exist only in the `get_dashboard_stats` rows held in `_dashData`. That data is loaded at eager-load and refreshed only while the Dashboard tab is active. For any batch missing from that snapshot (every kiosk/online batch created since the last dashboard load), `batchTypeInfo` falls back to the client heuristic:
- The select pre-selects a guessed type. The hint is either "Not yet classified" or a hard-coded "Set automatically (schedule)", even when the server classified the batch by recipe, Zoho or name, or no schedule exists.
- After `setBatchType` succeeds, `afterBatchWrite(..., {refreshOpenDetail:true})` re-renders from `get_batch`. There is no `batch_type` there and no `_dashData` row to patch, so the control snaps back to the heuristic value. The staff member sees "Type updated" and then the old type.
- The "Needs a type (N)" chip and filter count new batches by heuristic, so they disagree with the server.
**Fix:** Add `batch_type` and `batch_type_source` to the list/detail payloads as PG-only extras appended after `serializeBatch`, outside BATCH_COLUMNS so the mirror is unaffected. Have `batchTypeInfo` prefer `b.batch_type`/`b.batch_type_source`. At minimum, change the fallback hint to "Not yet classified" for every unknown source, not just "other".

### WR-03: The dashStats memo can cache a pre-write result after a write has cleared it

**File:** `zoho-middleware/lib/batch-store.js:148-170` (memo set at 167, cleared at 84)
**Issue:** `finish()` sets `_dashMemo = null`, but a `dashStats()` already in flight started its read before the write committed. When it resolves, it stores `{at: now, value: <pre-write snapshot>}`. Every dashboard load for the next 60 s then serves the old data, for example a just-set type or a just-completed batch. This is the same kind of stale-read report the owner has raised before (memory: "BrewPad list disappears after save", gb cache staleness).
**Fix:** Use a generation counter:
```js
var _dashGen = 0;            // finish(): _dashMemo = null; _dashGen++;
function dashStats() {
  var gen = _dashGen;
  ...then(function (value) { ... if (gen === _dashGen) _dashMemo = { at: _clock(), value: value }; return value; });
}
```

### WR-04: The trusted type backfill re-checks only `manual`, so a row upgraded between dry run and apply is downgraded

**File:** `zoho-middleware/lib/batch-pg-update.js:335-343`, `zoho-middleware/scripts/backfill/batch-type-backfill.js:154-162`
**Issue:** The plan is computed from a read-only snapshot. Under the row lock, the trusted branch then rejects only `batch_type_source === 'manual'`. Suppose that between the dry run (or the read) and the write, staff attach a recipe or schedule and `rederiveType` upgrades the row to `recipe`/`schedule`. The backfill then overwrites it with its stale weak proposal, e.g. `other`/`name`. The `--expect` gate does not catch this, because the candidate set is re-read from the same stale snapshot at apply time. D-06 says automatic rules never downgrade stronger sources.
**Fix:** In the trusted path, reject unless the locked row's source is still NULL, `name` or `other` (e.g. `fail('source_changed', ...)`, counted as skipped by the CLI). Better still, pass the expected stored source and compare it under the lock.

## Info

### IN-01: The memo is not invalidated by writes outside batch-store.finish

**File:** `zoho-middleware/lib/batch-store.js:84`
**Issue:** Schedule category edits (ferm-schedule-store feed `schedule_category`), the kiosk product cache refresh (subcategory/brand) and the backfill CLIs, which run in a separate process, do not clear `_dashMemo`. Staleness is bounded at 60 s. Note it for operators: after a backfill, the dashboard may lag by up to a minute.
**Fix:** Optionally export an `invalidateDashStats()` and call it from the ferm-schedule write path.

### IN-02: "excluded (no completion date)" also counts negative spans and differs from the recompute's excluded

**File:** `js/brewpad.js:546-560`, `zoho-middleware/scripts/backfill/batch-cycle-recompute.js:40-43`
**Issue:** The dashboard's excluded count includes rows whose completion is before `start_date` (span < 0), but the label says "no completion date". The recompute CLI defines excluded by start year, while the dashboard uses completion day in the window or start day for blank rows. The two "excluded" numbers can legitimately differ, which may confuse a D-13 style comparison.
**Fix:** Either relabel ("no usable completion date") or align both definitions.

### IN-03: Changing product_name does not re-derive a name-sourced type

**File:** `zoho-middleware/lib/batch-pg-update.js:417-420`
**Issue:** `rederiveType` runs only when `recipe_id` changes (or on a schedule change). Linking an SO (`handleSoSelect`) or a Zoho refresh rewrites `product_name`, but a `name`/`other`-sourced type is never re-classified from the new name.
**Fix:** Also call `rederiveType` when `values.product_name !== undefined` (passing the new name).

### IN-04: The replay production gate checks the Railway environment, not the target database

**File:** `zoho-middleware/scripts/backfill/batches-replay-to-sheet.js:200-209`
**Issue:** `assertProductionEnvironment` proves the process runs in production Railway. It does not prove that `BACKFILL_DATABASE_URL` points at the production database. If the staging DB URL is run from the production container, staging rows would still go into the shared production workbook.
**Fix:** Optionally compare the DB host/name against `DATABASE_URL` in the same environment, or require that they are equal.

### IN-05: The trusted backfills bump last_updated, causing version_conflict in open BrewPad sessions

**File:** `zoho-middleware/lib/batch-pg-update.js:426` (via both backfill CLIs)
**Issue:** Every backfilled row gets `last_updated = applyStart`. Any BrewPad tab holding the old `expectedVersion` gets "Batch was modified by another user" on its next edit. This is harmless but worth noting in the runbook, since it is also why the sheet replay was needed for columns the sheet does not even carry.
**Fix:** Document it in the runbook. Optionally skip the `last_updated` bump for trusted type-only writes.

---

_Reviewed: 2026-10-28T01:49:12Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
