---
phase: 36-cross-surface-selection-recipe-modification
plan: 20
subsystem: payments
tags: [helcim, terminal, webhook, redis, kiosk, pos]

# Dependency graph
requires:
  - phase: 36-cross-surface-selection-recipe-modification
    provides: kiosk POS flow, helcim terminal integration, webhook handler
provides:
  - Helcim terminal SUCCESS recognition now works via getCardTransactionById API
  - pollTerminalResult surfaces 401/403 as distinct Railway-visible warning
  - Device-pending fallback path when API scope is missing
affects: [kiosk, pos, webhooks, helcim terminal payments]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Webhook minimal payload resolution: always fetch full record via API; treat event.id as lookup key, not as data source"
    - "Permission error differentiation: 401/403 → log.warn (scope issue); network error → log.info (transient)"
    - "Two-level fallback: API primary → device-pending Redis key → no-op (never fabricate approval)"

key-files:
  created:
    - zoho-middleware/__tests__/helcim-terminal-success.test.js
  modified:
    - zoho-middleware/lib/helcim.js
    - zoho-middleware/routes/webhooks.js

key-decisions:
  - "handleCardTransaction must never fabricate an approval without correlation: API failure + no device-pending = drop the event"
  - "Fallback approval (device-pending only) must emit log.warn so Railway logs surface the permission gap clearly"
  - "processCardTransactionResult is a separate helper to keep the async resolution chain readable and testable"
  - "collect-pending Zoho payment recording preserved unchanged — only the invoice+status resolution path changed"
  - "getCardTransactionById rejects on HTTP error so callers can distinguish failure from a real API response"

patterns-established:
  - "Webhook event handlers for minimal payloads must resolve full record via API, not parse event.data fields"
  - "Two-level fallback: primary API → device-pending Redis key → no-op (no false positives on money path)"

requirements-completed: []

# Metrics
duration: 25min
completed: 2026-06-24
---

# Phase 36 Plan 20: Helcim Terminal Success Recognition Fix Summary

**Fixed Helcim terminal APPROVED recognition: handleCardTransaction now resolves invoice+status via getCardTransactionById API primary path with device-pending Redis fallback, ending permanent "pending" poll loops**

## Performance

- **Duration:** 25 min
- **Started:** 2026-06-24T18:25:00Z
- **Completed:** 2026-06-24T18:50:00Z
- **Tasks:** 2 (test + fix)
- **Files modified:** 3

## Accomplishments

- Added `getCardTransactionById(id)` to `lib/helcim.js` — resolves full transaction record from `GET /v2/card-transactions/{id}`, returning normalized `{status, transactionId, invoiceNumber, cardType, amount}`
- Added `getPendingInvoiceForDevice()` to `lib/helcim.js` — retrieves `helcim:terminal:pending:{DEVICE_CODE}` from Redis for the fallback path
- Rewrote `handleCardTransaction` in `routes/webhooks.js` to use API primary path → device-pending fallback → no-op (never fabricates approval without correlation)
- Distinguished 401/403 errors in `pollTerminalResult` with a `log.warn` so the token scope gap is visible in Railway logs instead of silently swallowed
- 10 regression tests covering all cases (a)–(f); full suite 907 tests passing

## Task Commits

1. **Test (regression RED):** `508632b` (test(36-20): add failing regression tests)
2. **Fix (implementation GREEN):** `6f38ceb` (fix(36-20): fix Helcim terminal SUCCESS recognition)

**Plan metadata:** see next commit (docs(36-20))

## Files Created/Modified

- `zoho-middleware/__tests__/helcim-terminal-success.test.js` — 10 regression tests: cases (a)–(f) + collect-pending flow preserved
- `zoho-middleware/lib/helcim.js` — added `getCardTransactionById`, `getPendingInvoiceForDevice`; improved 401/403 warning in `pollTerminalResult`
- `zoho-middleware/routes/webhooks.js` — rewrote `handleCardTransaction`; extracted `processCardTransactionResult` helper

## Decisions Made

- **No false positives on the money path:** API failure + no device-pending → drop the event, log warn. This is the safest default — if the fallback is unreliable, staff still have the manual confirm flow.
- **Fallback approval is unconfirmed-status:** the fallback treats any pending invoice as APPROVED because Helcim only creates a card-transaction record on an approved auth. This is documented via `log.warn` so it's visible.
- **Collect-pending preserved unchanged:** the webhook handler's second job (recording Zoho `customerpayments` for the collect flow) uses the now-resolved `invoiceNumber`/`status` — no behavioral change to that path.
- **cache.set passes object directly:** the new code passes a JS object to `cache.set` (which handles `JSON.stringify` internally), consistent with all other callers in the codebase.

## Deviations from Plan

None - plan executed exactly as written. Test expectations for case (e) and collect-pending APPROVED were adjusted to match the actual cache.set signature (the terminalCancel handler still passes JSON strings; the new code passes objects — both are correct per the cache.set contract).

## Issues Encountered

- The (f) pollTerminalResult tests needed `jest.isolateModules` to get a fresh module registry with a spy-able real logger, since the file-scope mock of `../lib/logger` applied to the other tests. Resolved using the same `jest.unmock` + `jest.spyOn` pattern established in helcim-webhook.test.js Block A.
- Test case (e) for terminalCancel: existing handler serializes to JSON string when calling `cache.set`; adjusted test matcher to `expect.stringContaining('"CANCELLED"')` instead of `expect.objectContaining`.

## User Setup Required

**Railway env var required for best behavior:**

The device-pending fallback exists because the Helcim API token may lack the `card-transactions READ` scope. To enable the primary path:

1. In Helcim Hub > API Tokens, ensure the token has **card-transactions: read** permission
2. Verify by watching Railway logs for `[helcim] card-transactions API forbidden (401)` — if absent, the primary path is working

If the 401 warning appears in logs, the fallback still handles success events correctly (via device-pending Redis key), but the `cardType` field will be empty in the cached result.

## Next Phase Readiness

- Kiosk terminal APPROVED webhook now correctly caches `helcim:terminal:result:{invoice}` so `pollTerminalResult` resolves immediately on the next poll
- The `confirmSale` frontend flow (guarded by `saleCompleted` flag) will fire correctly with the real `transactionId`
- No frontend changes needed
- No deploy required — middleware-only change, ready for `railway up` when approved

---
*Phase: 36-cross-surface-selection-recipe-modification*
*Completed: 2026-06-24*
