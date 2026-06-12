---
phase: 29-refresh-from-zoho-admin-ui
plan: "04"
subsystem: zoho-refresh
tags: [bug-fix, case-normalization, middleware, frontend, zsync]
dependency_graph:
  requires: []
  provides: [CR-01-fix, case-insensitive-zoho-ref-contract]
  affects: [zoho-middleware/routes/pos.js, js/brewpad.js, js/admin.js]
tech_stack:
  added: []
  patterns: [case-normalization, 400-error-handling, regression-tests]
key_files:
  created: []
  modified:
    - zoho-middleware/routes/pos.js
    - zoho-middleware/__tests__/batch-customer.test.js
    - js/brewpad.js
    - js/admin.js
    - tests/frontend/brewpad-zoho-refresh.test.js
    - tests/frontend/admin-zoho-refresh.test.js
decisions:
  - "CR-01 closed: middleware normalizes to uppercase before regex check, aligning with frontend case-insensitive gate — single coherent contract"
  - "400 handler added to both refresh fetch chains as defense-in-depth against future contract drift"
  - "False doc comment in brewpad.js and admin.js JSDoc both corrected to document the CR-01 normalization contract"
metrics:
  duration: 236s
  completed: "2026-06-12"
  tasks_completed: 2
  tasks_total: 2
---

# Phase 29 Plan 04: CR-01 Case Contract Fix Summary

One-liner: Middleware case-normalization (`toUpperCase` before regex) aligns with frontend `/^(INV|SO)-\d+$/i` gate, closing the case-sensitivity contract mismatch that caused lowercase-ref batches to hit unhandled 400s.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Normalize Zoho ref case in middleware validation + regression test | 8611ffd | zoho-middleware/routes/pos.js, zoho-middleware/__tests__/batch-customer.test.js |
| 2 | Add 400 invalid_number handling in both frontend refresh handlers + fix false doc comment + align tests | 13708bd | js/brewpad.js, js/admin.js, tests/frontend/brewpad-zoho-refresh.test.js, tests/frontend/admin-zoho-refresh.test.js |

## What Was Done

### Task 1: Middleware case normalization

Changed `zoho-middleware/routes/pos.js` line 1379 from:
```js
var number = (req.query.number || '').trim();
```
to:
```js
var number = (req.query.number || '').trim().toUpperCase();
```

This means `inv-000123` and `so-42` now pass the `/^INV-\d+$/` and `/^SO-\d+$/` regexes (which are still case-sensitive, but now receive an uppercased value). The accepted character set is unchanged — only `INV`/`SO` + digits survive. Downstream exact-match at line 1409 lowercases both sides, so uppercase normalization is compatible.

Two regression tests added to `batch-customer.test.js`:
- `lowercase inv-000123 does NOT return 400 invalid_number`
- `lowercase so-42 does NOT return 400 invalid_number`

All 14 middleware batch-customer tests pass; full middleware suite (598 tests) green.

### Task 2: Frontend 400 handler + doc comment fixes

**brewpad.js:**
- Added `if (r.status === 400)` branch in fetch chain (line 2585) throwing `{ status: 400, error }`
- Added `if (err && err.status === 400)` branch in outer catch (line 2677) showing distinct toast: "This Zoho reference is not a valid INV/SO number"
- Corrected doc comment at ~line 43-47: removed "a 400 invalid_number response can never fire from the UI"; replaced with CR-01 middleware normalization contract statement

**admin.js:**
- Added `if (r.status === 400)` branch in fetch chain (line 6072) throwing `{ status: 400, error }`
- Added `if (err && err.status === 400)` branch in catch (line 6127) showing same distinct toast message
- Corrected JSDoc at ~line 9564-9571: removed "matches the format the ... endpoint accepts" false claim; replaced with CR-01 contract description

**Test suites:**
- Added 2 new assertions to `brewpad-zoho-refresh.test.js`: `isValidZohoNumber('inv-000123')` and `isValidZohoNumber('so-42')` return `true`, labeled as CR-01 contract assertions
- Added 2 new assertions to `admin-zoho-refresh.test.js`: same contract assertions
- All existing assertions preserved; both suites now 57 tests green

## Verification

- `cd zoho-middleware && npx jest __tests__/batch-customer.test.js` — 14/14 pass
- `npx jest tests/frontend/brewpad-zoho-refresh.test.js tests/frontend/admin-zoho-refresh.test.js --no-coverage` — 57/57 pass
- `grep -n "toUpperCase" zoho-middleware/routes/pos.js` — line 1379 (in validation block)
- `grep -n "status === 400" js/brewpad.js js/admin.js` — present in fetch chain and catch in each file
- Full middleware suite: 598 pass; full frontend suite: 489 pass

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Threat Flags

No new trust boundaries introduced. The `toUpperCase()` normalization does not widen the accepted character set — only INV/SO + digits pass the regex (T-29-04-01 mitigated as planned).

## Self-Check: PASSED

- zoho-middleware/routes/pos.js: FOUND (modified)
- zoho-middleware/__tests__/batch-customer.test.js: FOUND (modified)
- js/brewpad.js: FOUND (modified)
- js/admin.js: FOUND (modified)
- tests/frontend/brewpad-zoho-refresh.test.js: FOUND (modified)
- tests/frontend/admin-zoho-refresh.test.js: FOUND (modified)
- Commit 8611ffd: FOUND
- Commit 13708bd: FOUND
