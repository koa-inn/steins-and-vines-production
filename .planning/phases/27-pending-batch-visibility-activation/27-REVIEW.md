---
phase: 27-pending-batch-visibility-activation
reviewed: 2026-06-07T22:10:00Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - apps-script/adminApi.gs
  - js/admin.js
  - admin.html
  - css/admin.css
findings:
  critical: 1
  warning: 5
  info: 4
  total: 10
status: issues_found
---

# Phase 27: Code Review Report

**Reviewed:** 2026-06-07T22:10:00Z
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found

## Summary

Reviewed the phase 27 changes: `getBatches` active-filter widening to include `pending`, the Pending filter/badge/pin-to-top in the batch list, the one-click Activate action (inline + detail modal), the guided Schedule & Activate modal, and the `updateBatch` `start_date` handling.

The code is generally well-structured and reuses existing patterns (optimistic locking, `showConfirm`, `escapeHTML`, cache invalidation via `_invalidateBatchCache`). No XSS, injection, or auth-bypass vulnerabilities were found in the new code — user content flows through `escapeHTML` on render and `sanitizeInput` on write, and the new `start_date` field is added to the server-side `allowedFields` allowlist rather than blindly accepted.

The primary concerns are correctness defects in the two-step guided activation orchestration (partial-failure handling) and a behavioral contradiction between what the "Activate now" confirmation promises and what the server actually writes for the start date. Both can produce data that surprises the operator (wrong fermentation start date, batch silently activated without a schedule while the UI reports "version conflict, refresh").

## Critical Issues

### CR-01: Guided activation reports a step-2 version conflict as a recoverable "refresh" error after the batch has already been activated (partial failure, data inconsistency)

**File:** `js/admin.js:7239-7270` (the `sa-submit` `.catch` handler) and `apps-script/adminApi.gs:2302`

**Issue:** The guided "Schedule & Activate" submit performs two sequential, independently-committed Apps Script writes:

1. `update_batch` → sets `status: 'primary'`, `start_date`, optional vessel/shelf/bin, and writes a new `last_updated` (`newVersion`).
2. `update_batch_schedule` → generates tasks using `expectedVersion: newVersion`.

If step 1 succeeds but step 2 fails with a version conflict (another user touched the row between the two requests), `updateBatchSchedule` returns `message: 'Batch was modified. Refresh and try again.'` (adminApi.gs:2302). The client catch matches this on `msg.indexOf('Batch was modified') !== -1` and routes it to the **version_conflict** branch, showing "Version conflict — refresh and try again." But step 1 already committed: the batch is now `primary` with a start date and **no schedule/tasks**. After the operator refreshes, the batch is no longer `pending`, so the inline Activate / Schedule & activate buttons (which are gated on `status === 'pending'`) disappear, leaving no obvious path to attach the schedule. The operator is told to retry an operation that already half-succeeded, and the batch is left in an inconsistent "active but unscheduled" state.

The catch comment claims "a step1-only success would have already proceeded to step2," which is true, but it overlooks that a *step-2* failure also lands in the same catch with no way to distinguish it from a *step-1* failure. The ordering of the `if/else if` checks means the version-conflict branch wins over the schedule-failure branch even when the batch was successfully activated.

**Fix:** Track which step failed using a flag captured in the promise chain, and treat any step-2 failure (including a version conflict) as a partial success — i.e., always run the "Batch activated but schedule failed — assign schedule from the detail modal" path so the UI refreshes to the now-active state and the toast tells the truth:

```javascript
var step1Done = false;
adminApiPost('update_batch', { batch_id: batchId, expectedVersion: batch.last_updated, updates: batchUpdates })
  .then(function (step1Result) {
    step1Done = true;
    var newVersion = step1Result.newVersion || batch.last_updated;
    return adminApiPost('update_batch_schedule', {
      batch_id: batchId, expectedVersion: newVersion, schedule_snapshot: schedSteps
    });
  })
  .then(function (step2Result) { /* full success path */ })
  .catch(function (err) {
    var msg = err.message || 'Unknown error';
    if (!step1Done && (msg.indexOf('version_conflict') !== -1 || msg.indexOf('Batch was modified') !== -1)) {
      showToast('Version conflict — refresh and try again', 'error');
    } else if (step1Done) {
      // Step 1 committed; batch is active but schedule generation failed (incl. step-2 conflict)
      showToast('Batch activated but schedule failed — assign schedule from the detail modal', 'warning');
      closeModal(); loadBatchesData(); refreshUpcomingCache(); loadBatchDashboardSummary();
      if (fromDetailModal) openBatchDetail(batchId);
    } else {
      showToast('Failed: ' + msg, 'error');
    }
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Schedule & Activate'; }
  });
```

## Warnings

### WR-01: "Activate now" confirmation promises "start date is set to today" but the server uses the existing start_date

**File:** `js/admin.js:5728-5735` (inline) and `js/admin.js:5916-5934` (detail modal); server logic at `apps-script/adminApi.gs:2205-2220`

**Issue:** Both one-click Activate paths send only `updates: { status: 'primary' }` (no `start_date`). The confirmation dialog text states: *"…the start date is set to today."* But `updateBatch`'s `fermentation_started_at` priority is `updates.fermentation_started_at > updates.start_date > current.start_date > now`. A batch can be `pending` solely because it lacks a `schedule_id` while still having a `start_date` (see adminApi.gs:1899 `isPending = !payload.schedule_id || !payload.start_date`, and createBatch writes `payload.start_date || ''` at line 1956). For such a batch, `fermentation_started_at` is set to the pre-existing `current.start_date`, **not** today — directly contradicting the confirmation text. Worse, the batch's `start_date` column itself is never updated to today, so the displayed start date also stays as-is.

**Fix:** Make the behavior match the promise. Either (a) explicitly send `start_date: <today>` in the one-click activate payloads so both `start_date` and `fermentation_started_at` reflect today, or (b) change the confirmation copy to "…the start date will be the batch's existing start date (or today if none is set)." Option (a) is the least surprising:

```javascript
updates: { status: 'primary', start_date: todayPacific() }
```

### WR-02: Inline Activate uses a stale optimistic-lock version captured at render time; failures are silent beyond a generic toast

**File:** `js/admin.js:5686` (render) and `js/admin.js:5727,5734` (use)

**Issue:** The inline Activate button caches the version in a `data-version` attribute at render time (`b.last_updated`). Because `get_batches` is cached server-side for 300s and the list is only re-rendered on explicit reload, the cached version can be several minutes old. On a real conflict, `update_batch` returns a `version_conflict`, the catch shows "Failed: Batch was modified by another user. Refresh and try again." and re-enables the button — but the button still carries the same stale `data-version`, so a second click fails identically with no automatic refresh. The user is stuck retrying with a permanently-stale version until they manually reload.

**Fix:** On a version-conflict failure, call `loadBatchesData()` to re-render with fresh versions (mirroring CR-01's recommendation), instead of only re-enabling the button:

```javascript
}).catch(function (err) {
  showToast('Failed: ' + err.message, 'error');
  if ((err.message || '').indexOf('modified') !== -1) { loadBatchesData(); }
  else { btn.disabled = false; }
});
```

### WR-03: Pending pin-to-top is client-side only; server pagination can drop old pending batches before the client ever sees them

**File:** `js/admin.js:5641-5645` (client pin) and `apps-script/adminApi.gs:1347-1356` (server sort + paginate)

**Issue:** The D-04 "pending rows always pin to top" logic runs in `renderBatchList` on `batchesData` — i.e., only on the page already returned by the server. `getBatches` sorts strictly by `created_at` descending and then paginates (`batches.slice(offset, offset + limit)`). If a `limit` is ever applied and there are more batches than the page size, an old-but-still-`pending` batch (created long ago, never activated) is sorted below newer batches and can be sliced off before reaching the client, so the client-side pin never has it to pin. The visibility guarantee the phase is meant to deliver ("pending batches are always surfaced") is not actually enforced server-side.

**Fix:** Either confirm the admin batch list is always fetched unpaginated (`limit <= 0`), and add a code comment to that effect, or push the pending-first ordering into `getBatches` so pending batches survive pagination:

```javascript
batches.sort(function (a, b) {
  var ap = String(a.status||'').toLowerCase()==='pending';
  var bp = String(b.status||'').toLowerCase()==='pending';
  if (ap !== bp) return ap ? -1 : 1;
  return String(b.created_at || '').localeCompare(String(a.created_at || ''));
});
```

### WR-04: Schedule & Activate fallback fetch can open the modal with an incomplete batch object (missing last_updated), guaranteeing a version conflict on submit

**File:** `js/admin.js:5759-5766`

**Issue:** When the batch is not found in `batchesData`, the fallback fetches via `get_batch` and on success opens the modal with `(result.data && result.data.batch) || { batch_id: bid }`. If `get_batch` returns `ok: true` but `result.data.batch` is null/absent (e.g., a not-found edge case that still returns ok, or an unexpected response shape), the modal opens with `{ batch_id: bid }` only. The submit then sends `expectedVersion: batch.last_updated` which is `undefined`. On the server, `if (payload.expectedVersion)` is falsy, so optimistic locking is silently **skipped** — the write proceeds with no concurrency protection. This both defeats the locking guarantee and can clobber concurrent edits.

**Fix:** Guard the fallback so the modal only opens with a real batch object; otherwise show an error:

```javascript
.then(function (result) {
  var b = result.data && result.data.batch;
  if (!b || !b.last_updated) { showToast('Could not load batch details', 'error'); return; }
  openScheduleActivateModal(b, false);
})
```

### WR-05: `vesselsData` cache is not invalidated when the modal opens, so the vessel picker can show stale availability

**File:** `js/admin.js:7095-7110` (`openScheduleActivateModal`) and `js/admin.js:7196` (cache invalidated only after submit)

**Issue:** `openScheduleActivateModal` only loads vessels when `!vesselsData`. The cache is invalidated (`vesselsData = null`) after a *successful* submit, but not when the modal is opened or when a submit is cancelled. If a vessel is assigned to another batch elsewhere (or freed) after the cache is first populated, the picker offers a stale list, and an operator can pick a vessel that is no longer free. The server-side `checkLocationConflict` (adminApi.gs:2116) will reject it, but only after the operator has filled out and submitted the whole form, surfacing as a late "Location already in use" failure.

**Fix:** Either drop the `vesselsData` cache and always reload on modal open, or add a short TTL. At minimum, document that the conflict is caught server-side so the stale picker is an annoyance rather than a data risk. A simple reload:

```javascript
function openScheduleActivateModal(batch, fromDetailModal) {
  vesselsData = null; // always fetch fresh availability for the picker
  ...
}
```

## Info

### IN-01: `data-batch-id` interpolated without escapeHTML (inconsistent with adjacent escaped attributes)

**File:** `js/admin.js:5676, 5684, 5687`

**Issue:** The `<tr data-batch-id="' + b.batch_id + '">` and the QR / Activate / Schedule buttons interpolate `b.batch_id` raw, while the new `data-version` attribute on the same line (5686) is wrapped in `escapeHTML`. Batch IDs are server-generated (`SV-B-NNNNNN`) so this is not currently exploitable, but the inconsistency is a latent XSS foothold if the ID format ever changes and is the kind of thing that fails a security audit. This pre-dates phase 27 for the QR button but the phase added two more unescaped instances.

**Fix:** Wrap `b.batch_id` in `escapeHTML(String(b.batch_id))` in all attribute interpolations, matching the `data-version` treatment.

### IN-02: Duplicated activate logic between inline buttons and detail-modal buttons

**File:** `js/admin.js:5723-5748` and `js/admin.js:5914-5938`

**Issue:** The one-click Activate flow (showConfirm → `update_batch {status:'primary'}` → toast → reload trio) is copy-pasted between the inline list button and the detail-modal button, with only the version source and post-success refresh differing. Two copies means the CR-01/WR-01/WR-02 fixes must be applied in both places, and they will drift.

**Fix:** Extract a single `activateBatchNow(batchId, version, onSuccess)` helper and call it from both sites.

### IN-03: Schedule-step JSON parse fallback silently swallows errors

**File:** `js/admin.js` schedule preview handler (`try { steps = JSON.parse(sched.steps); } catch (e) {}`) and the submit handler's identical block

**Issue:** When `steps_parsed` is absent and `sched.steps` fails to parse, the empty catch leaves `steps`/`schedSteps` empty. In the preview this renders a blank preview; in the submit it falls through to "Schedule has no steps." The operator gets a confusing empty/blocked state with no indication the template's data is malformed.

**Fix:** Log the parse error (`console.warn('[Admin] schedule steps parse failed', e)`) so a malformed template is diagnosable, rather than presenting as "no steps."

### IN-04: `start_date` written through `sanitizeInput` then read back for due-date math relies on undocumented format coupling

**File:** `apps-script/adminApi.gs:2211-2212` (write) and `apps-script/adminApi.gs:2334` (`toDateOnly(current.start_date)` read in `updateBatchSchedule`)

**Issue:** The guided flow writes `start_date` from an `<input type="date">` (value `YYYY-MM-DD`) via `sanitizeInput(String(updates.start_date))`, and the subsequent `update_batch_schedule` call reads it back through `toDateOnly()` to compute task due dates. This works today (a date-only string survives `sanitizeInput` and parses cleanly), but the correctness of every generated task's due date hinges on this implicit format contract across two separate endpoints with no validation that `start_date` is a parseable date. A future change that writes a different date format here would silently produce wrong due dates.

**Fix:** Validate `start_date` format in `updateBatch` (reject non-`YYYY-MM-DD` / unparseable values with an explicit error) so a bad value fails loudly at write time rather than corrupting downstream due-date math.

---

_Reviewed: 2026-06-07T22:10:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
