---
phase: 04-sales-order-management
plan: 01
subsystem: kiosk-middleware
tags: [zoho-api, sales-orders, kiosk, pos]
dependency_graph:
  requires: []
  provides: [GET-kiosk-salesorders-4status, PUT-kiosk-salesorder-update]
  affects: [kiosk-frontend-so-tab, kiosk-frontend-cart-import]
tech_stack:
  added: []
  patterns: [zohoPut-destructured-import, 4-status-parallel-fetch, reduce-concat]
key_files:
  created: []
  modified:
    - zoho-middleware/routes/pos.js
    - zoho-middleware/__tests__/kiosk-salesorders.test.js
    - zoho-middleware/__tests__/pos-cache.test.js
decisions:
  - "Used reduce+concat for combining 4-status results instead of manual array concatenation"
  - "PUT endpoint returns generic error message on Zoho failure (T-04-03 mitigation)"
metrics:
  duration: "4m 21s"
  completed: "2026-04-28T14:27:26Z"
  tasks_completed: 2
  tasks_total: 2
  tests_added: 12
  tests_total: 374
---

# Phase 04 Plan 01: Kiosk SO Middleware Extension Summary

Extended GET /api/kiosk/salesorders to fetch all four Zoho statuses (open, draft, closed, confirmed) and preserve item_id in line items. Added new PUT /api/kiosk/salesorder-update endpoint with auth, validation, Zoho update, cache bust, and event logging.

## Tasks Completed

| Task | Name | Commit | Key Changes |
|------|------|--------|-------------|
| 1 | Extend GET handler + add PUT endpoint | 22f9ae9 | 4-status fetch, item_id in line_items, zohoPut import, PUT /api/kiosk/salesorder-update |
| 2 | Add tests for GET extension and PUT endpoint | b356c2d | 12 new tests (2 GET extension, 10 PUT endpoint), router mock extended with put |

## What Changed

### GET /api/kiosk/salesorders
- Now fetches 4 statuses in parallel: open, draft, closed, confirmed (was: open, draft only)
- Uses `reduce` + `concat` to combine results from all 4 Zoho responses
- Each line_item now includes `item_id` field (needed for cart import in Plan 02)
- Cache key and TTL unchanged

### PUT /api/kiosk/salesorder-update (NEW)
- Auth: requires `x-api-key` header matching `MW_API_KEY` env var
- Validation: salesorder_id (non-empty string), items (non-empty array), each item's item_id (string), quantity (>0), rate (>=0)
- Calls `zohoPut('/salesorders/' + soId, { line_items: [...] })`
- On success: busts SO cache, logs `kiosk.salesorder_updated` event, returns `{ ok, salesorder_id, salesorder_number, total, balance }`
- On failure: returns 502 with generic error, logs detailed error server-side

### Import Changes
- Added `var zohoPut = zohoApi.zohoPut;` destructured import in pos.js

## Test Coverage

- 12 new tests added to kiosk-salesorders.test.js
- GET extension: item_id presence, 4-status fetch verification
- PUT endpoint: 401 (wrong key), 400 (missing soId, empty items, non-array items, missing item_id, zero qty, negative rate), 200 (happy path with cache bust), 502 (Zoho error), multi-item payload
- All 374 middleware tests pass

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] pos-cache.test.js router mock missing put method**
- **Found during:** Task 1
- **Issue:** Adding `router.put(...)` in pos.js caused `router.put is not a function` in pos-cache.test.js which also requires pos.js
- **Fix:** Added `put: jest.fn()` to the router mock in pos-cache.test.js
- **Files modified:** zoho-middleware/__tests__/pos-cache.test.js
- **Commit:** 22f9ae9

**2. [Rule 3 - Blocking] Existing GET tests only mocked 2 zohoGet calls**
- **Found during:** Task 2
- **Issue:** Two existing tests ("returns list of open sales orders" and "filters by search param") only provided 2 `mockResolvedValueOnce` calls, but the handler now makes 4 parallel zohoGet calls. The 3rd/4th calls returned undefined, causing TypeError.
- **Fix:** Added 2 additional `.mockResolvedValueOnce({ salesorders: [] })` calls to each test's mock setup (no assertion changes)
- **Files modified:** zoho-middleware/__tests__/kiosk-salesorders.test.js
- **Commit:** b356c2d

## Threat Model Compliance

All mitigations from the plan's threat model are implemented:
- **T-04-01** (Tampering - auth): PUT endpoint validates x-api-key against MW_API_KEY
- **T-04-02** (Tampering - body): PUT endpoint validates all input fields with specific error messages
- **T-04-03** (Info disclosure): PUT endpoint returns generic "Failed to update sales order" on Zoho error; detailed error logged server-side only
- **T-04-04** (Spoofing - GET): Accepted risk, unchanged
- **T-04-05** (XSS): Accepted, deferred to Plan 02 frontend

## Self-Check: PASSED
