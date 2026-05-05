---
phase: 07-zoho-audit-trail
plan: 03
status: complete
started: 2026-05-04
completed: 2026-05-04
---

## Summary

Added lifecycle timeline, Link to Invoice UI, and Zoho sync indicator to BrewPad's batch detail view. Completes ZOHO-01, ZOHO-02, and ZOHO-03 frontend requirements.

## What Was Built

1. **Lifecycle Timeline** — Vertical 4-event timeline (Sale & Invoice Created, Batch Created, Fermentation Started, Batch Completed) with filled green dots for completed events and hollow dots with "(pending)" text for future events.

2. **Link to Invoice UI** — "Link to Invoice" button opens inline search (400ms debounced). Selecting an invoice auto-fills customer_name, customer_id, product_name into the batch record via Apps Script. Re-doable via "Change Linked Order" button (D-06).

3. **Sync Indicator** — Shows "syncing…" / "sync failed — will retry" near the Zoho Ref row when callSyncZoho fires.

4. **Status Transition Hook** — callSyncZoho fires inside the status badge click handler's .then() callback, mapping primary/secondary→'active' and complete→'complete'.

5. **Lazy Invoice Date Fetch** — When a batch has zoho_so_number AND customer_name, fetches the invoice date for the Sale event in the timeline. Silently falls back to "(pending)" when not found.

## Key Files

### Created
- `tests/frontend/brewpad-timeline.test.js` — 7 unit tests for buildLifecycleTimeline

### Modified
- `css/brewpad.css` — Timeline, invoice search, and sync indicator CSS (180 lines)
- `js/brewpad.js` — buildLifecycleTimeline (pure helper), callSyncZoho, fetchSoSearch, handleSoSelect, showLinkedSo, showSyncIndicator, mwApiKey helper, renderBatchDetail sections + event listeners
- `css/brewpad.min.css` — Regenerated
- `js/brewpad.min.js` — Regenerated
- `brewpad.html` — Cache version stamp updated

## Self-Check

- [x] Timeline renders 4 events with correct done/pending states
- [x] Invoice search with 400ms debounce
- [x] handleSoSelect updates batch via adminApiPost and fires callSyncZoho
- [x] Status badge click handler fires callSyncZoho after successful update
- [x] escapeHTML wraps all user data in DOM output
- [x] All var declarations (no const/let/arrow functions)
- [x] 293 frontend tests pass (15 suites)
- [x] Lint: 0 errors
- [x] Build: minified assets regenerated

## Deviations

None.

## Dependencies Consumed

- POST /api/batch/sync-zoho (Plan 07-01)
- GET /api/batch/search-invoices (Plan 07-01)
- Apps Script updateBatch extended allowedFields (Plan 07-02)
- fermentation_started_at / completed_at columns (Plan 07-02)
