---
phase: 27-pending-batch-visibility-activation
reviewed: 2026-06-08T05:00:00Z
depth: standard
files_reviewed: 1
files_reviewed_list:
  - js/admin.js
findings:
  critical: 0
  warning: 2
  info: 2
  total: 4
status: issues_found
---

# Phase 27: Code Review Report (Plan 04 Gap-Closure Re-Review)

**Reviewed:** 2026-06-08T05:00:00Z
**Depth:** standard
**Files Reviewed:** 1 (`js/admin.js` — plan-04 changes only)
**Status:** issues_found

## Summary

This re-review covers the plan-04 gap-closure changes to `js/admin.js`:

1. **WR-01 (BATCH-02) fix:** `start_date: todayPacific()` added to both one-click Activate payloads — inline `.batch-activate-btn` handler (~line 5735) and detail-modal `#batch-activate-detail` handler (~line 5925).
2. **CR-01 (BATCH-03) fix:** `var step1Done = false` declared before the guided `sa-submit` two-step `adminApiPost` chain; set to `true` as the first statement inside `.then(step1Result)`; `.catch` now branches on `step1Done` before matching error-message substrings.

**Both targeted fixes are correctly implemented.** The original CR-01 (misrouted step-2 version conflict) and WR-01 (start date mismatch) are now closed. The logic is sound: `step1Done` cannot misroute a genuine pre-activation step-1 conflict to the partial-success path (it is `false` until step 1's `.then` fires), and cannot misroute a post-activation step-2 failure to the conflict-retry toast (it is `true` whenever the `.catch` fires after step 1 committed). The guided flow's `start_date: startDate` (line 7232) is unchanged; the one-click handlers exclusively use `todayPacific()`.

No new XSS or injection surface: `showToast` uses `textContent` throughout; `todayPacific()` produces a server-timezone YYYY-MM-DD string from an existing trusted helper with no user input. ES5 style (`var`, no arrow functions) is preserved across all changed lines.

Two pre-existing issues from the original review (WR-02 and WR-04) remain open and are documented below as they were not addressed by plan-04. Two info items (also pre-existing) are preserved for continuity.

---

## Structural Findings (fallow)

No structural pre-pass was provided for this review.

---

## Narrative Findings (AI reviewer)

### Plan-04 specific findings

The two plan-04 targeted fixes are clean. No new Critical or Warning defects are introduced by the plan-04 changes themselves. The findings below are residual issues from the original phase-27 code base that plan-04 did not address.

---

## Warnings

### WR-01 (CLOSED by plan-04): One-click Activate start-date mismatch

**Status: FIXED.** Both one-click handlers now send `updates: { status: 'primary', start_date: todayPacific() }` (lines 5735 and 5925). The backend priority chain (`updates.start_date > current.start_date > now`) will always stamp today, honoring the confirmation copy. No action required.

---

### WR-02: Inline Activate retains stale optimistic-lock version after a conflict failure

**File:** `js/admin.js:5726-5744`
**Severity:** WARNING
**Status:** Pre-existing; not addressed by plan-04.

**Issue:** The inline `.batch-activate-btn` handler reads `var ver = btn.getAttribute('data-version')` (line 5727) — a value baked into the DOM at list-render time. On a version-conflict error, the `.catch` at line 5741-5744 shows the toast and re-enables the button, but `ver` still holds the stale version. A second click immediately fails again with the same conflict error; the user is stuck until they manually reload. The detail-modal handler (`#batch-activate-detail`, line 5911) has the same issue: `batchVersion` is captured at modal-open time and never refreshed on conflict.

**Fix:** In the `.catch` block, on a version-conflict error, call `loadBatchesData()` (inline) or `openBatchDetail(batchId)` (modal) to get fresh versions. For example, the inline catch:

```javascript
}).catch(function (err) {
  showToast('Failed: ' + err.message, 'error');
  if ((err.message || '').indexOf('modified') !== -1 || (err.message || '').indexOf('version_conflict') !== -1) {
    loadBatchesData(); // re-render list with fresh data-version attributes
  } else {
    btn.disabled = false; // only re-enable for non-conflict errors
  }
});
```

---

### WR-04: Schedule & Activate fallback fetch can open the modal with an incomplete batch object, silently bypassing optimistic locking

**File:** `js/admin.js:5759-5768`
**Severity:** WARNING
**Status:** Pre-existing; not addressed by plan-04.

**Issue:** When a batch row is not found in `batchesData`, the code falls back to a `get_batch` API call and opens the modal with `(result.data && result.data.batch) || { batch_id: bid }` (line 5763). If `result.data.batch` is absent or null (unexpected response shape, not-found edge case), the modal opens with `{ batch_id: bid }` only. The submit at line 7241 sends `expectedVersion: batch.last_updated`, which is `undefined`. On the server, a falsy `expectedVersion` silently skips optimistic-locking and the write proceeds unchecked, clobbering any concurrent edits.

**Fix:** Guard the fallback so the modal only opens with a real, complete batch object:

```javascript
.then(function (result) {
  var b = result.data && result.data.batch;
  if (!b || !b.last_updated) {
    showToast('Could not load batch details — please refresh', 'error');
    return;
  }
  openScheduleActivateModal(b, false);
})
```

---

## Info

### IN-01: `data-batch-id` attribute interpolated without `escapeHTML` (inconsistent with `data-version`)

**File:** `js/admin.js:5676, 5684, 5687`
**Status:** Pre-existing; not addressed by plan-04.

**Issue:** `<tr data-batch-id="' + b.batch_id + '">` and adjacent button attributes interpolate `b.batch_id` raw, while `data-version` on the same line uses `escapeHTML`. Batch IDs are server-generated (`SV-B-NNNNNN`) so there is no current exploit path, but the inconsistency is a latent foothold if the ID format changes.

**Fix:** Wrap all `b.batch_id` attribute interpolations in `escapeHTML(String(b.batch_id))` to match the `data-version` treatment.

---

### IN-02: Step-2 submit-button re-enable runs on a detached DOM node in the partial-success path

**File:** `js/admin.js:7267-7282`
**Status:** Newly introduced by plan-04; harmless but untidy.

**Issue:** In the `step1Done` partial-success branch, `closeModal()` is called at line 7271, which removes the `#sa-submit` button from the live DOM. The shared `if (submitBtn)` re-enable block at lines 7279-7282 then runs on the now-detached `submitBtn` reference. `submitBtn` is not null (it was assigned at line 7227 before the chain started), so the `if` guard passes and `submitBtn.disabled = false` executes on a detached node. This has no observable effect — the modal is gone — but it is dead code.

**Fix:** Move the submit-button re-enable inside only the branches where the modal stays open (conflict-retry and generic-failure), and omit it from the partial-success path where `closeModal()` is called:

```javascript
}).catch(function (err) {
  var msg = err.message || 'Unknown error';
  if (!step1Done && (msg.indexOf('version_conflict') !== -1 || msg.indexOf('Batch was modified') !== -1)) {
    showToast('Version conflict — refresh and try again', 'error');
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Schedule & Activate'; }
  } else if (step1Done) {
    showToast('Batch activated, but the schedule didn\'t save — assign it from the batch detail', 'warning');
    closeModal();
    loadBatchesData();
    refreshUpcomingCache();
    loadBatchDashboardSummary();
    if (fromDetailModal) openBatchDetail(batchId);
    // no submitBtn re-enable needed — modal is closed
  } else {
    showToast('Failed: ' + msg, 'error');
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Schedule & Activate'; }
  }
});
```

---

## Previously Open Findings — Status After Plan-04

| Finding | Original Severity | Plan-04 Status |
|---------|------------------|----------------|
| CR-01 (BATCH-03): Guided activation misroutes step-2 conflict to retry toast | CRITICAL | **CLOSED** — `step1Done` flag + catch reorder fully implemented |
| WR-01 (BATCH-02): One-click Activate sends no `start_date` | WARNING | **CLOSED** — `todayPacific()` added to both one-click payloads |
| WR-02: Stale `data-version` after conflict failure (inline + modal) | WARNING | Still open |
| WR-03: Pending pin-to-top is client-side only; server pagination can hide old pending batches | WARNING | Still open (pre-plan-04 scope) |
| WR-04: Fallback fetch opens modal with incomplete batch, bypasses optimistic locking | WARNING | Still open |
| WR-05: `vesselsData` cache not invalidated on modal open, stale vessel picker | WARNING | Still open (pre-plan-04 scope) |
| IN-01: `data-batch-id` interpolated without `escapeHTML` | INFO | Still open |
| IN-02: Duplicated activate logic between inline and modal handlers | INFO | Still open (pre-plan-04 scope) |
| IN-03: Schedule step JSON parse silently swallows errors | INFO | Still open (pre-plan-04 scope) |
| IN-04: `start_date` format coupling across two endpoints with no validation | INFO | Still open (pre-plan-04 scope) |

---

_Reviewed: 2026-06-08T05:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
