---
phase: 06-kiosk-to-brewpad-integration
plan: 02
subsystem: api
tags: [express, redis, apps-script, axios, jest, middleware, batch-creation, retry-queue]

# Dependency graph
requires:
  - phase: 05-form-state-protection
    provides: stable middleware and auth infrastructure
provides:
  - brewpad-integration.js module with fire-and-forget batch creation and Redis retry queue
  - pos.js sale/confirm hook triggering batch creation on kit sales with Makers Fee
  - 5-minute retry sweep for failed batch creation calls
  - BATCH_RETRY_PREFIX constant in constants.js
affects: [06-kiosk-to-brewpad-integration]

# Tech tracking
tech-stack:
  added: []
  patterns: [fire-and-forget Apps Script call with Redis retry queue, skipRetryQueue parameter to prevent double-queueing]

key-files:
  created:
    - zoho-middleware/lib/brewpad-integration.js
    - zoho-middleware/__tests__/brewpad-integration.test.js
  modified:
    - zoho-middleware/lib/constants.js
    - zoho-middleware/routes/pos.js
    - zoho-middleware/server.js

key-decisions:
  - "Used skipRetryQueue parameter in callAppsScriptCreateBatch to prevent double-queueing during retry sweep"
  - "Placed retry sweep setInterval outside Zoho auth conditional since it calls Apps Script, not Zoho"
  - "callAppsScriptCreateBatch returns { ok: true/false } so retry sweep can distinguish success from app-level error"

patterns-established:
  - "Fire-and-forget with Redis retry: callAppsScriptCreateBatch pattern for any future Apps Script side-effects"
  - "skipRetryQueue flag pattern: callers during retry context suppress auto-queueing to avoid duplicate keys"

requirements-completed: [INTG-01]

# Metrics
duration: 6min
completed: 2026-05-03
---

# Phase 6 Plan 02: Middleware Brewpad Integration Summary

**Fire-and-forget batch creation from kiosk kit sales via Apps Script with Redis retry queue (max 3 attempts, 24h TTL)**

## Performance

- **Duration:** 6 min
- **Started:** 2026-05-03T21:30:16Z
- **Completed:** 2026-05-03T21:36:14Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- New brewpad-integration.js module exports createBatchesFromSale, retryPendingBatches, detectKitItems, callAppsScriptCreateBatch
- Kiosk sale/confirm handler now triggers batch creation fire-and-forget for every kit item when Makers Fee is present
- Redis retry queue with 24h TTL and max 3 attempts, swept every 5 minutes by server.js setInterval
- 23 unit tests covering all exported functions and edge cases (no customer_email in payload, Walk-in Customer default, skipRetryQueue behavior)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create brewpad-integration.js module and update constants.js** - `53b3770` (feat)
2. **Task 2: Hook pos.js sale/confirm handler and add retry sweep to server.js with unit tests** - `a5d6150` (feat)

## Files Created/Modified
- `zoho-middleware/lib/brewpad-integration.js` - New module: batch creation, retry queue, kit detection
- `zoho-middleware/lib/constants.js` - Added BATCH_RETRY_PREFIX to CACHE_KEYS
- `zoho-middleware/routes/pos.js` - Import brewpadIntegration, call createBatchesFromSale in paymentChain.then()
- `zoho-middleware/server.js` - Import brewpadIntegration, register 5-minute retry sweep setInterval
- `zoho-middleware/__tests__/brewpad-integration.test.js` - 23 unit tests for the new module

## Decisions Made
- Used `skipRetryQueue` boolean parameter to prevent double-queueing during retry sweep (avoids duplicate Redis keys when Apps Script returns ok:false during a retry attempt)
- Placed retry sweep outside the Zoho auth conditional block since it calls Apps Script (APPS_SCRIPT_URL), not Zoho APIs
- callAppsScriptCreateBatch returns `{ ok: true/false }` to enable retry sweep to distinguish HTTP success + app error from HTTP success + app success
- Re-set mock implementations in beforeEach (not just clearAllMocks) to fix Jest test isolation for stateful mock overrides

## Deviations from Plan

None - plan executed exactly as written. The skipRetryQueue + return value refinement was already specified in the plan's action section.

## Issues Encountered
- Jest mock isolation: `jest.clearAllMocks()` does not reset mock implementations set via `.mockReturnValue()` in prior tests. The "does nothing when Redis is not connected" test set `cache.isConnected.mockReturnValue(false)` which persisted into subsequent retry tests. Fixed by explicitly re-setting all mock implementations in `beforeEach`.

## User Setup Required
None - no external service configuration required. The module uses existing APPS_SCRIPT_URL and APPS_SCRIPT_SERVER_TOKEN env vars already configured on Railway.

## Next Phase Readiness
- Middleware integration complete: kiosk kit sales with Makers Fee now trigger Apps Script batch creation
- Plan 06-01 (Apps Script pending mode) and Plan 06-03 (BrewPad UI) can proceed
- Apps Script must accept `create_batch` action in its server-token branch (Plan 06-01) for the end-to-end flow to work
- BrewPad UI must display pending batches with kiosk badge (Plan 06-03)

## Self-Check: PASSED

All 6 files verified present. Both task commits (53b3770, a5d6150) found in git log.

---
*Phase: 06-kiosk-to-brewpad-integration*
*Completed: 2026-05-03*
