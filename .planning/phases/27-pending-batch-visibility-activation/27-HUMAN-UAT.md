---
status: partial
phase: 27-pending-batch-visibility-activation
source: [27-VERIFICATION.md]
started: 2026-06-08T04:12:43Z
updated: 2026-06-11T00:10:00Z
---

## Current Test

number: 2
name: One-click Activate stamps today's date (WR-01)
expected: |
  Activate a pending batch that has a pre-existing start_date in the past, via BOTH the inline row "Activate" button and the batch-detail-modal "Activate" button. After activation, fermentation_started_at (and the start_date column) reflect TODAY's Pacific date — not the old pre-existing date — matching the confirmation dialog's "the start date is set to today" promise.
awaiting: user response

## Tests

### 1. Pending batches appear in the default Active view
expected: With one or more pending batches in BrewPad, the admin batch list (default Active filter) shows them with a distinct purple "Pending" badge, pinned to the top of the list. A dedicated "Pending" filter option is also available.
result: pass

### 2. One-click Activate stamps today's date (WR-01)
expected: Activate a pending batch that has a pre-existing `start_date` in the past, via BOTH the inline row "Activate" button and the batch-detail-modal "Activate" button. After activation, `fermentation_started_at` (and the start_date column) reflect TODAY's Pacific date — not the old pre-existing date — matching the confirmation dialog's "the start date is set to today" promise.

### 3. Schedule & Activate step-2 version conflict reports truthful partial success (CR-01)
expected: Trigger a version conflict during the guided Schedule & Activate flow AFTER step 1 commits (e.g. a concurrent edit between step 1 and step 2). The UI shows the partial-success toast "Batch activated, but the schedule didn't save — assign it from the batch detail", closes the modal, and refreshes the list/detail to the now-active batch. It does NOT show the misleading "refresh and try again" retry toast, and the batch is not left stranded as primary-with-no-schedule with no recovery path.

### 4. Genuine step-1 conflict + happy-path non-today start date
expected: (a) A genuine pre-activation (step-1) version conflict still shows the "refresh and try again" retry toast and does NOT close/refresh as if activation succeeded. (b) On the happy path, choosing a start date other than today causes `fermentation_started_at` and the generated schedule task due dates to honor the chosen date.

## Summary

total: 4
passed: 1
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
