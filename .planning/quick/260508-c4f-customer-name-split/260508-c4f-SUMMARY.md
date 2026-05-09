---
phase: quick
plan: 260508-c4f
subsystem: brewpad
tags: [batch-management, customer-data, name-split]
dependency_graph:
  requires: []
  provides: [customer-firstname-lastname-fields]
  affects: [apps-script/adminApi.gs, zoho-middleware/lib/brewpad-integration.js, js/brewpad.js, js/admin.js]
tech_stack:
  added: []
  patterns: [header-lookup-write, name-split-utility, display-helper-fallback]
key_files:
  created: []
  modified:
    - apps-script/adminApi.gs
    - zoho-middleware/lib/brewpad-integration.js
    - zoho-middleware/__tests__/brewpad-integration.test.js
    - js/brewpad.js
    - js/admin.js
    - js/brewpad.min.js
    - js/admin.min.js
decisions:
  - Used header-lookup for Sheet writes instead of changing positional appendRow (avoids breakage if columns reordered)
  - getCustomerDisplayName duplicated in both files rather than extracting to shared module (minimal overhead, avoids cross-file dependency)
  - BrewPad new-customer form split into first/last fields; admin batch form uses hidden fields populated from search selection
metrics:
  duration: 7m 28s
  completed: 2026-05-09T01:55:15Z
  tasks_completed: 2
  tasks_total: 2
  files_modified: 7
---

# Quick Plan 260508-c4f: Customer Name Split Summary

Split customer_name into customer_firstname + customer_lastname across the batch creation stack, with backward-compatible display fallback for legacy single-name records.

## Task Commits

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Apps Script + Middleware data layer | ebfccd6 | adminApi.gs, brewpad-integration.js, brewpad-integration.test.js |
| 2 | Frontend form inputs and display | 0494ff5 | brewpad.js, admin.js, build artifacts |

## Changes Made

### Task 1: Data Layer

- **Apps Script createBatch**: Validation accepts `customer_firstname` as alternative to `customer_name`. Auto-composes `customer_name` from first+last for backward compat. After appendRow, writes firstname/lastname via header-lookup (avoids positional coupling).
- **Apps Script updateBatch**: Added `customer_firstname` and `customer_lastname` to allowedFields.
- **Apps Script getTasksCalendar + getTasksUpcoming**: Task enrichment objects now include `customer_firstname` and `customer_lastname` from the batch record.
- **Middleware splitCustomerName**: New utility splits "Jane Doe" into {first: "Jane", last: "Doe"}, handles single names, multi-part last names, empty strings, and extra whitespace. Exported from module.
- **Middleware createBatchesFromSale**: Splits customerName and passes `customer_firstname` + `customer_lastname` in the batch payload. Walk-in customers get "Walk-in" / "Customer".
- **Tests**: 5 new splitCustomerName tests + updated assertions on 2 existing createBatchesFromSale tests.

### Task 2: Frontend

- **BrewPad batch form**: Added `bp-new-customer-firstname-hidden` and `bp-new-customer-lastname-hidden` fields. New Customer sub-form split into separate First/Last name inputs. Customer search dropdown selection populates split fields. Submit handler reads split fields with fallback to text-input splitting.
- **Admin batch form**: Added `batch-customer-firstname` and `batch-customer-lastname` hidden fields. selectCustomer splits name. Clear handler resets new fields. doCreateBatch includes split fields in payload. Kiosk auto-batch-creation splits `_kioskCustomer.name`.
- **Display helper**: `getCustomerDisplayName(b)` added to both files. Prefers firstname+lastname, falls back to customer_name for legacy records.
- **All display locations updated**: Batch list (table + cards), batch detail (skeleton + full), task calendar/upcoming, task list, task search filter, batch search filter, QR modal, print label, PDF label, SO search term, kiosk label.
- **Form drafts**: Save/restore includes new hidden fields.

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

- Middleware tests: 469 passed (including 5 new + 2 updated)
- Frontend tests: 348 passed
- ESLint: 0 errors (78 pre-existing warnings)
- Build: succeeded

## Self-Check: PASSED
