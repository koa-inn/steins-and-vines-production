---
phase: 29-refresh-from-zoho-admin-ui
plan: "01"
subsystem: brewpad-frontend
tags: [zoho-sync, brewpad, tdd, frontend]
one_liner: "BrewPad refresh-from-Zoho: pure helpers (isValidZohoNumber/buildRefreshUpdates/compareRefreshFields), Email/Phone info rows, and format-gated Refresh button with in-place update handler"

dependency_graph:
  requires:
    - "Phase 28 /api/batch/customer-by-number endpoint (shipped, verified live)"
    - "Apps Script update_batch with customer_email/customer_phone in allowedFields (commit c3f7a72)"
  provides:
    - "ZSYNC-01: Refresh-from-Zoho button in BrewPad detail pane"
    - "ZSYNC-02: Button hidden when no valid zoho_so_number"
    - "Pure helpers exported for unit testing: isValidZohoNumber, buildRefreshUpdates, compareRefreshFields"
  affects:
    - "js/brewpad.js — detail pane render and event binding"
    - "tests/frontend/brewpad-zoho-refresh.test.js — new test file"

tech_stack:
  added: []
  patterns:
    - "TDD RED/GREEN cycle for pure helper functions"
    - "ES5 vanilla JS — var, function expressions, no arrow functions"
    - "In-place DOM patch pattern via id-targeted span elements"
    - "Optimistic locking via expectedVersion=last_updated in update_batch"
    - "escapeHTML on all Zoho-sourced strings before DOM insertion (XSS gate T-29-01)"

key_files:
  created:
    - path: tests/frontend/brewpad-zoho-refresh.test.js
      description: "27 unit tests for isValidZohoNumber, buildRefreshUpdates, compareRefreshFields"
  modified:
    - path: js/brewpad.js
      description: "Added 3 exported pure helpers at top level; Email/Phone info rows with span ids; conditional Refresh button in Invoice section; refresh click handler with fetch → compare → update_batch → in-place patch flow"

decisions:
  - "compareRefreshFields returns true (no-change) when buildRefreshUpdates produces an empty object — avoids a no-op update_batch call (D-12)"
  - "nameNode uses textContent + escapeHTML rather than innerHTML for defense-in-depth, consistent with how other patch nodes are updated"
  - "Refresh handler captures soNumber from _currentBatchDetail at click time to handle concurrent pane updates"
  - "catch branch handles optimistic-lock 'version' errors with a distinct 'please reload' toast"

metrics:
  duration_seconds: 238
  completed_date: "2026-06-12"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 2
---

# Phase 29 Plan 01: BrewPad Refresh-from-Zoho — Pure Helpers + UI Summary

## What Was Built

Added the Refresh-from-Zoho feature to the BrewPad batch detail pane in `js/brewpad.js` and accompanying unit tests. This implements ZSYNC-01 (the refresh action) and ZSYNC-02 (hidden when no usable link) for the BrewPad surface.

### Changes

**`js/brewpad.js`** — 177 lines added:

1. Three top-level pure helpers (outside the IIFE, alongside existing helpers):
   - `isValidZohoNumber(num)` — regex gate `/^(INV|SO)-\d+$/i`; returns false for null/empty/malformed values
   - `buildRefreshUpdates(fetched)` — builds update_batch payload with only non-empty trimmed fields from `customer_name/email/phone`; never emits blank values (D-13 / Phase 28 D-02)
   - `compareRefreshFields(fetched, batch)` — trimmed case-insensitive no-change check; returns true when nothing would change (D-12); returns true for empty updates
   - All three added to the existing `module.exports` guard

2. Info grid additions (renderBatchDetail ~line 2269):
   - `id="bp-detail-customer"` added to Customer value span (enables in-place name patching)
   - New Email row: `id="bp-detail-email"`, shows `b.customer_email || '—'`
   - New Phone row: `id="bp-detail-phone"`, shows `b.customer_phone || '—'`

3. Invoice section: Refresh button rendered only when `isValidZohoNumber(b.zoho_so_number)` is true (ZSYNC-02/D-07/D-08); class `btn-secondary bp-btn-sm`, id `bp-zoho-refresh-btn`

4. Refresh click handler:
   - Fetches `GET /api/batch/customer-by-number?number=...` with `x-api-key: mwApiKey()`
   - Maps 404/502/!ok to typed error objects before JSON parse
   - Calls `compareRefreshFields` — shows "Already up to date" and skips update_batch on no-change (D-12)
   - Calls `adminApiPost('update_batch', { batch_id, expectedVersion, updates })` with version from `_currentBatchDetail.last_updated` (D-13)
   - On success: bumps `_currentBatchDetail.last_updated`; in-place patches `_currentBatchDetail`, `b`, DOM nodes, `_batchesData`, `_allBatchesData`; busts sessionStorage snapshot (D-05/D-06)
   - Toast mapping: full success / partial (contact_unavailable) / voided doc / no-change / 404 / 502 (D-10/D-11)

**`tests/frontend/brewpad-zoho-refresh.test.js`** — 209 lines, 27 tests:
- `isValidZohoNumber`: 12 cases covering valid, invalid, case-insensitive, null/undefined
- `buildRefreshUpdates`: 8 cases covering blank/null/undefined omission, trim, all fields
- `compareRefreshFields`: 7 cases covering no-change, case/whitespace normalization, empty updates

## Verification

All acceptance criteria confirmed:

- `grep -n "bp-zoho-refresh-btn"` shows button rendered inside `if (isValidZohoNumber(...)` guard (line 2286-2288)
- `grep -n "bp-detail-email\|bp-detail-phone\|bp-detail-customer"` shows all three span ids (lines 2269-2271, 2617-2627)
- `grep -n "customer-by-number"` shows fetch using `'x-api-key': mwApiKey()` (line 2576-2577)
- `grep -n "expectedVersion"` confirms refresh handler passes `expectedVersion: batchVersion` (line 2600)
- `grep -n "compareRefreshFields\|Already up to date"` shows short-circuit skips update_batch (lines 2589-2594)
- `npm run lint -- js/brewpad.js` — 0 errors, 118 pre-existing warnings only
- `npx jest tests/frontend/brewpad-zoho-refresh.test.js` — 27/27 passed
- Full frontend suite: 459/459 passed, 25 test suites

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. All data flows from live `_currentBatchDetail` batch object; display values are read from actual batch fields.

## Threat Surface Scan

No new network endpoints introduced. All Zoho-sourced strings (`customer_name`, `customer_email`, `customer_phone`, `document_status`, `document_number`) are run through `escapeHTML` before DOM insertion, mitigating T-29-01. The `soNumber` from `_currentBatchDetail` is only used in `encodeURIComponent` for the query string (T-29-02 already covered). T-29-03 and T-29-04 mitigated by `buildRefreshUpdates` (omits blanks) and `compareRefreshFields` (skips no-ops). T-29-05 mitigated by `expectedVersion` in the update_batch payload with a distinct toast for version conflicts.

## TDD Gate Compliance

- RED commit: `0d09a47` — `test(29-01): add failing tests for isValidZohoNumber, buildRefreshUpdates, compareRefreshFields`
- GREEN commit: `c1d6f80` — `feat(29-01): add isValidZohoNumber, buildRefreshUpdates, compareRefreshFields to brewpad.js`
- Implementation commit: `ec27342` — `feat(29-01): add Email/Phone rows, Refresh button and handler to BrewPad detail pane`

## Self-Check: PASSED
