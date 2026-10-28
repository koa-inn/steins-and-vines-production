---
phase: 95-global-filters-and-chart-engine
reviewed: 2026-10-28T19:39:16Z
depth: standard
files_reviewed: 25
files_reviewed_list:
  - js/brewpad.js
  - css/brewpad.css
  - brewpad.html
  - js/vendor/README.md
  - zoho-middleware/lib/batch-pg-create.js
  - zoho-middleware/lib/batch-pg-read.js
  - zoho-middleware/lib/batch-pg-update.js
  - zoho-middleware/lib/batch-rules.js
  - zoho-middleware/migrations/0008_staff_batch.sql
  - zoho-middleware/scripts/backfill/batches-parity.js
  - zoho-middleware/scripts/backfill/staff-batch-backfill.js
  - tests/frontend/brewpad-dashboard-v2-chart.test.js
  - tests/frontend/brewpad-dashboard-v2-data.test.js
  - tests/frontend/brewpad-dashboard-v2-delta.test.js
  - tests/frontend/brewpad-dashboard-v2-drill.test.js
  - tests/frontend/brewpad-dashboard-v2-filters.test.js
  - tests/frontend/brewpad-dashboard-v2-shell.test.js
  - tests/frontend/brewpad-dashboard-v2-widgets.test.js
  - tests/frontend/brewpad-staff-batch-ui.test.js
  - zoho-middleware/__tests__/batch-rules-staff.test.js
  - zoho-middleware/__tests__/db/batch-pg-staff-read-create.test.js
  - zoho-middleware/__tests__/db/batch-pg-update-staff.test.js
  - zoho-middleware/__tests__/db/batches-staff-migration.test.js
  - zoho-middleware/__tests__/db/batches-type-migration.test.js
  - zoho-middleware/__tests__/db/staff-batch-backfill.test.js
findings:
  critical: 0
  warning: 6
  info: 10
  total: 16
status: issues_found
---

# Phase 95: Code Review Report

**Reviewed:** 2026-10-28T19:39:16Z
**Depth:** standard
**Files Reviewed:** 25 (plus the backfill CLI tests `staff-batch-backfill-plan`, `-exclude` and `batches-parity-staff-keys`, read for coverage)
**Status:** issues_found

## Summary

I reviewed the Phase 95 diff `4a139aa0..HEAD`. On the frontend that covers the v2 selection layer, filter state and hash, the Chart.js loader and `chart()`, the shell and filter bar, the phone sheet, drill state and banner, the staff checkbox and the v2 widgets. In the middleware it covers the `staff_batch` create/read/update paths, migration 0008, the parity exclusion and the staff backfill CLI.

I checked the areas you asked about and found these sound:

- **XSS / escaping:** every dynamic string reaching `innerHTML` is either a constant or passes through `escapeHTML`, which escapes `& < > " '`. That covers the banner label (brand and subcategory names via `'Wine ' + bk.label`), the legend, delta text and aria, and the period label. Filter-bar summaries and the Custom label use `textContent`, canvas `aria-label` uses `setAttribute`, and Chart.js tooltips draw on canvas.
- **Hash parsing:** `parseDashHash` tolerates malformed `%`-encoding. `sanitizeDashFilters` builds a fresh object from whitelisted literals only, and `from`/`to` must pass `isRealYmd`. A `__proto__=` key is a no-op string assignment and never reaches the state.
- **Chart.js lifetime:** `chart()` destroys any instance already on the canvas. The canvas is persistent per slot, and `dashV2Msg`, `setDashV2(false)` and the shell rebuild all destroy their instances. The only way to orphan an instance is the "Failed to load dashboard" `innerHTML` swap, and the next `renderDashboardV2` reclaims it.
- **Cache staleness:** `setStaffBatch` sends `batch_id` with nested `updates:{}` and calls `afterBatchWrite(..., listAffecting)`. In Postgres mode there is no server-side `gb:` cache on this path.
- **`update_batch` validation:** `normalizeStaffBatch` accepts only `true`/`false`/`'true'`/`'false'`, and the check runs before any write. Create derives the flag from source and never reads it from the payload.
- **Backfill SQL:** the statements are constant, with parameters bound `$1..$3`. `--exclude` ids are regex-checked. Writes lock the row and re-check it.
- **Vendor file:** the Chart.js SHA-256 recorded in `js/vendor/README.md` matches the file on disk (`48444a82…`).

The defects I found are in state interplay: a drill-down hiding newly created batches, custom range against server `asOf`, and zero tiles rendered with no data. There is also one integrity gap in the backfill's `--expect` gate, plus several smaller UI and labelling issues.

## Warnings

### WR-01: Bulk create from the pull sheet doesn't clear an active drill-down, so the new batches are hidden

**File:** `js/brewpad.js:7168-7172` (with `applyBatchFilter` / `drillFilterRows` at ~6326-6345)
**Issue:** After a successful bulk create, the code forces `_batchStatusFilter = 'pending'` so that "freshly created batches are immediately visible". It does not reset `_dashDrill`. If staff drilled in from the dashboard earlier (the drill lasts until it is dismissed, by design), `applyBatchFilter` intersects the pending list with the old drill id set. The new batches can't be in that set, so the list shows "No batches in this set any more." under a dashboard banner, and the batches just created are invisible. Only the v1 pipeline-tile path (`:12575`) and `clearDashDrill` reset the drill. Every other code path that sets `_batchStatusFilter` by program keeps it. No test covers this.
**Fix:** Clear the drill wherever code forces a status filter, ideally through one setter:
```js
function setBatchStatusFilterProgrammatic(status) {
  _dashDrill = null;
  _batchStatusFilter = status;
}
// pull-sheet success path:
if (summary.okCount > 0) {
  setBatchStatusFilterProgrammatic('pending');
  _batchesLoaded = false; _allBatchesData = []; _batchesLoadTime = 0;
  loadBatches();
}
```
Add a drill test: open a drill, run a bulk create, and assert that `_dashDrill === null` and the pending rows render.

### WR-02: A custom range is validated against the client's "today" but evaluated against the server's `asOf.today`, so it can silently fall back to YTD while still labelled as custom

**File:** `js/brewpad.js:555-566` (`windowFromFilters`), `:1173-1193` (`buildDashV2Model`), `:5257-5269` (`refreshDashV2`)
**Issue:** `commitDashV2State` and `sanitizeDashFilters` accept `to <= todayPacific()`. The model then calls `windowFromFilters(st, asOf.today)` with `asOf = _dashData.asOf`, which is the server's day at fetch time. If the aggregate was fetched before midnight and staff then pick a range ending today, `st.to > asOf.today`. `windowFromFilters` then quietly returns the YTD window. But `periodLabel` still comes from `dashPeriodLabel(st)`, which reads e.g. "Oct 1 – Oct 29". The tiles say "Started (Oct 1 – Oct 29)" over YTD numbers, and the delta reads "vs same period last year". The two "today"s need to agree, or the fallback must be visible.
**Fix:** Derive the label from the window that was actually used, and clamp instead of falling back:
```js
// windowFromFilters
if (p === 'custom' && isRealYmd(st.from) && isRealYmd(st.to) && st.from <= st.to) {
  var end = st.to > today ? today : st.to;
  if (st.from <= end) return { key: 'custom', start: st.from, end: end };
}
// buildDashV2Model: periodLabel from win (custom -> dashShortDate(win.start)+' – '+dashShortDate(win.end))
```
Alternatively, pass `todayPacific()` into both, or refetch the aggregate when `asOf.today !== todayPacific()`.

### WR-03: v2 renders zero tiles and deltas as real data when no data source is loaded

**File:** `js/brewpad.js:5257-5269` (`refreshDashV2`)
**Issue:** `rows = _dashData ? _dashData.batches : toDashRows(_allBatchesData)`. Whenever `_dashData` is null and `_allBatchesData` is empty, v2 renders "Fermenting now 0", "Started 0" and deltas such as "▼ 41 vs same period last year" as though they were real. `_dashData` is null when `get_dashboard_stats` fails and the summary fallback is used. `_allBatchesData` is empty after any `afterBatchWrite(listAffecting)`, which sets it to `[]`, or before the first load. It also happens when `setDashV2(true)` is clicked before eager load finishes. The UI spec says "Widgets render only once data is present; no zero placeholders". In the same fallback mode, `setStaffBatch` calls `refreshDashV2()` before the list is refreshed, and the list row's `staff_batch` was never updated, so the staff tick has no visible effect.
**Fix:** Guard the render:
```js
if (!_dashData && !_allBatchesData.length) {
  var t = document.getElementById('bp-dash-v2-tiles');
  if (t) t.innerHTML = '<div class="bp-skeleton-block"></div>';
  if (!_batchesLoaded) loadBatches();   // or loadDashboard()
  return;
}
```

### WR-04: The backfill `--expect` gate checks only the candidate count, not which rows are candidates

**File:** `zoho-middleware/scripts/backfill/staff-batch-backfill.js:174-208`
**Issue:** `--apply` recomputes the candidate list from live data and compares only `plan.length !== opts.expect`. Suppose one reviewed candidate drops out between the owner's dry run and the apply (say, flagged by hand in BrewPad, now that the checkbox ships in the same release) and one new row appears. A new row appears if a new customer matches `\mInn\M` or `\mMcLachlan\M`, or a new internal/research batch is created. The count still matches, and the CLI writes a row the owner never reviewed. That can hide a paying customer's batch from the mix charts. D-09 requires the owner to approve the actual list, not just its size.
**Fix:** Print a fingerprint in the dry run and require it on apply:
```js
var fp = require('crypto').createHash('sha256')
  .update(plan.map(function (e) { return e.batch_id; }).join(',')).digest('hex').slice(0, 12);
log('candidates: ' + plan.length + ' fingerprint: ' + fp);
// parseArgs: --expect-fingerprint=<hex>, required with --apply
if (opts.apply && fp !== opts.expectFingerprint) { /* refuse, EXIT.CHECKS_FAILED */ }
```
Alternatively, accept `--ids=<reviewed list>` and write only that intersection.

### WR-05: The staff provenance hint is guessed from the current source, so it can contradict D-19

**File:** `js/brewpad.js:8200-8207`
**Issue:** `staffHint = STAFF_SOURCE_HINTS[current source] || 'Set by hand'`. There is no stored provenance, so a batch that was manual at creation, later edited to `internal`, and then ticked by hand shows "Set automatically (internal batch)". D-19 says a source edit never sets the flag, so that hint is false. Likewise, an internal batch that was unticked and re-ticked by hand says "automatically". Staff use this hint to judge whether the flag is trustworthy.
**Fix:** Either show the "automatic" hint only when the server can prove it, by adding a `staff_batch_source` ('create'|'manual'|'backfill') column in a later additive migration, or soften the copy for internal/research rows to something like "Internal batch" with no claim about who set it.

### WR-06: The phone/tablet filter-bar mode is fixed at render time

**File:** `js/brewpad.js:5139-5141`, `:5173-5186`, `:5209-5233`
**Issue:** `dashV2IsPhone()` is read only when the bar refreshes, and nothing listens for `resize`, `orientationchange` or a `matchMedia` change. With iPad Split View or Slide Over (window ≤600 px), or on rotation, the bar keeps its old mode until the next filter tap or data refresh. In phone mode the tablet controls are absent, and an open bottom sheet stays open in tablet layout.
**Fix:**
```js
var mq = window.matchMedia && window.matchMedia('(max-width: 600px)');
if (mq) (mq.addEventListener ? mq.addEventListener('change', onMode) : mq.addListener(onMode));
function onMode() { if (isDashV2()) { closeDashV2Sheet(false); updateDashV2Bar(); } }
```
`addListener` is the fallback for older iPad Safari versions.

## Info

### IN-01: The tooltip doesn't use the singular for one batch
**File:** `js/brewpad.js:1486`. `val + ' batches'` renders "Wine: 1 batches". Use `val === 1 ? ' batch' : ' batches'`, as `dashDrillLabel` already does.

### IN-02: An existing test was modified, against CLAUDE.md rule 10, and is now coupled to migration order
**File:** `zoho-middleware/__tests__/db/batches-type-migration.test.js:78`. `migrate('down', 1)` became `migrate('down', 2)` (commit 33de0d35). The change is needed, but it breaks rule 10 without recorded approval, and the 0007 test must be edited again for every new migration. Better: roll down until 0007 is removed (by name), or assert on 0007's columns after `down` to `0006`.

### IN-03: The drill can intersect with a batch list up to 10 minutes old
**File:** `js/brewpad.js:6351-6363`, `:3916-3922`. `openDashDrill` sets `_batchesLoaded = false`, but `switchTab('batches')` still uses `_allBatchesData` whenever it is non-empty, which can be up to `CACHE_TTL_LONG` (10 min) old. The dashboard ids may be newer, so the banner count ("33 batches") and the list ("32 batches shown") can differ. That breaks the D-14 promise "the count always matches". To fix, refetch when `_batchesLoadTime < _dashLoadTime`.

### IN-04: `insufficient` ignores the type and source filters
**File:** `js/brewpad.js:1192`. `earliestStart` covers every started row before filtering. So with Type=Cider, where the first cider was this year, the delta shows "▲ 5 vs same period last year" against an empty prior window instead of "No earlier data to compare". Consider computing `earliestStart` over the filtered items as well.

### IN-05: The cycle-time delta says "No earlier data" when the current period is the one with no data
**File:** `js/brewpad.js:1224` and the cycle tile (~`:5313`). `formatDelta(null, prev)` returns the "No earlier data to compare" text when the *current* median is null. A dash, or no delta line, would be more accurate.

### IN-06: The phone bottom sheet declares `aria-modal` but doesn't trap focus
**File:** `js/brewpad.js:5568-5589`. Tab can leave the dialog and reach the page behind it. Add a Tab/Shift+Tab wrap inside `.bp-dash-sheet-panel`.

### IN-07: Phone sheet: tapping "Custom" and then "Apply Filters" silently drops the custom choice
**File:** `js/brewpad.js:5663-5676`, `:5607-5612`. Custom shows as selected (`rangeOpen=true`), but `_dashV2Stage.period` changes only after "Apply Date Range". Apply Filters then commits the previous period. Disable Apply Filters while the range row is open and unapplied, or apply the valid range as part of Apply Filters. Also, on tablet the range row (`:5152`) isn't prefilled with the current `from`/`to`.

### IN-08: The backfill's JS and Postgres word-boundary rules differ
**File:** `zoho-middleware/scripts/backfill/staff-batch-backfill.js:38-45`. Postgres `\m...\M` treats accented letters as word characters, while JS `\b` without the `u` flag does not. A row the SQL returns can therefore print with an empty reason list (`desc === ''`), which is confusing during owner review. Log a `reason:unknown` placeholder when `reasons` is empty.

### IN-09: The aggregate's batches and staff ids are read without a shared snapshot
**File:** `zoho-middleware/lib/batch-pg-read.js:268-305`. `DASH_STATS_BATCHES_SQL` and `DASH_STATS_STAFF_SQL` are separate statements. Unless `runPg` wraps them in a transaction, a concurrent staff tick can land between them. The effect is harmless (one stale flag until the next refresh), but `begin transaction isolation level repeatable read read only` would make the aggregate self-consistent.

### IN-10: The staff flag is accepted server-side for disabled/deleted batches and in non-Postgres modes
**File:** `zoho-middleware/lib/batch-pg-update.js:361-367`. Only the UI hides the checkbox for disabled/deleted batches. Separately, under a `dual`/sheet rollback, `batch-proxy.intercept` falls through to Apps Script with `updates.staff_batch`, which the sheet has no column for, and I haven't verified what happens to it. Document the rollback behaviour in the RUNBOOK. Optionally, reject `staff_batch` for `status in ('deleted')` to match the UI rule.

---

_Reviewed: 2026-10-28T19:39:16Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
