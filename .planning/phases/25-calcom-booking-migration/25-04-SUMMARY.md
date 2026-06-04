---
phase: 25-calcom-booking-migration
plan: "04"
subsystem: zoho-middleware
tags: [calcom, zoho-removal, cleanup, es5, production-verified]
dependency_graph:
  requires:
    - zoho-middleware/lib/calcom.js (Plan 01)
    - zoho-middleware/routes/bookings.js (Plan 02 — Cal.com-backed endpoints)
    - zoho-middleware/routes/webhooks.js (Plan 03 — HMAC-verified webhook)
  provides:
    - Dead Zoho Bookings code removed (bookingsGet/bookingsPost/BOOKINGS_API_BASE gone)
    - ZOHO_BOOKINGS_* removed from validateEnv OPTIONAL
    - Phase 25 complete — Cal.com migration end-to-end proven in production
  affects:
    - zoho-middleware/lib/zoho-api.js (3 symbols removed from exports)
    - zoho-middleware/lib/validateEnv.js (2 OPTIONAL entries removed)
    - zoho-middleware/__tests__/zoho-api.test.js (dead test block removed)
    - zoho-middleware/__tests__/bookings.test.js (dead mock keys removed)
    - zoho-middleware/lib/calcom.js (stale comment updated)
tech_stack:
  added: []
  patterns:
    - Pre-removal grep-before-modify (CLAUDE.md rule 6): confirmed 0 live refs before removing
    - Full test suite after shared-lib edit (CLAUDE.md rule 7): 573 middleware + 432 frontend
key_files:
  created: []
  modified:
    - zoho-middleware/lib/zoho-api.js
    - zoho-middleware/lib/validateEnv.js
    - zoho-middleware/lib/calcom.js
    - zoho-middleware/__tests__/zoho-api.test.js
    - zoho-middleware/__tests__/bookings.test.js
decisions:
  - "Zoho Bookings removal is safe: Task 2 staging-equivalent proof confirmed Cal.com fully operational before any code removal"
  - "bookings.test.js dead mock keys (bookingsGet/bookingsPost) cleaned; zoho-api.test.js Bookings API describe block removed — required by CLAUDE.md rule 7 (full suite must pass after shared-lib edit)"
  - "calcom.js style comment updated to remove stale bookingsGet/bookingsPost reference (grep returned 1 for the comment-only line; removed to satisfy 0-ref verification)"
  - "Production middleware was deployed in Task 2 (svmiddleware-production on Railway, main/production repo); no separate staging middleware exists — DEPLOYMENT.md staging-api ref is stale"
  - "FERMENT_KIT/BOTTLING env naming confirmed: CALCOM_EVENT_TYPE_FERMENT_KIT (ferment-in-store) + CALCOM_EVENT_TYPE_BOTTLING (bottling appointment) — matches all Railway production env vars"
metrics:
  duration: "~15min"
  completed: "2026-06-04"
  tasks_completed: 1
  tasks_total: 1
  files_created: 0
  files_modified: 5
---

# Phase 25 Plan 04: Zoho Bookings Removal + Phase Completion Summary

Zoho Bookings dead code removed with grep verification (0 live refs), both test suites + lint green. Task 2 (blocking human-verify checkpoint) passed — live Cal.com production booking + confirmation email + webhook HMAC verified empirically, closing the original missing-confirmation issue and all Phase 25 assumptions.

## What Was Built

**Task 3: Remove Zoho Bookings code paths and env refs**

### zoho-middleware/lib/zoho-api.js

Removed:
- `BOOKINGS_API_BASE` constant (line 64)
- `bookingsGet(path, params)` function (lines 185-197)
- `bookingsPost(path, body)` function (lines 203-214)
- All three from `module.exports` (lines 305, 313-314)

Kept: `normalizeTimeTo24h`, `zohoGet`, `zohoPost`, `zohoPut`, all inventory helpers, `withRetry`, `fetchAllItems`, `fetchItemDetailsBulk`

### zoho-middleware/lib/validateEnv.js

Removed two entries from OPTIONAL array:
- `{ name: 'ZOHO_BOOKINGS_SERVICE_ID', desc: 'Zoho Bookings service ID' }`
- `{ name: 'ZOHO_BOOKINGS_STAFF_ID', desc: 'Zoho Bookings staff ID' }`

Kept: all four CALCOM_* entries (CALCOM_API_KEY, CALCOM_WEBHOOK_SECRET, CALCOM_EVENT_TYPE_FERMENT_KIT, CALCOM_EVENT_TYPE_BOTTLING)

### zoho-middleware/__tests__/zoho-api.test.js

Removed "Zoho Bookings API helpers" describe block (5 tests for bookingsGet/bookingsPost/BOOKINGS_API_BASE) and the dead import names from the destructuring require. Required for full suite to pass — the removed functions no longer exist in the module.

### zoho-middleware/__tests__/bookings.test.js

Removed dead mock keys `bookingsGet: jest.fn()` and `bookingsPost: jest.fn()` from the zoho-api mock object. The route no longer calls these functions.

### zoho-middleware/lib/calcom.js

Updated line 8 comment from "Mirrors lib/zoho-api.js bookingsGet/bookingsPost style" to "Follows lib/zoho-api.js style" — the old comment was the only remaining string match for bookingsGet/bookingsPost after removing the function definitions.

## Task 2 Live Verification Results (Staging-Equivalent — Production Verified)

**Context:** There is no separate staging middleware (DEPLOYMENT.md's staging-api reference is stale). The single production middleware is svmiddleware-production on Railway connected to the production repo. All Cal.com verification ran against live production services. Task 2 blocking-human checkpoint passed with the following empirical results:

### Deployment Proof

- Deployed to production middleware via `git push production main --force`
- Env vars confirmed in Railway production: `CALCOM_API_KEY`, `CALCOM_WEBHOOK_SECRET`, `CALCOM_EVENT_TYPE_FERMENT_KIT`, `CALCOM_EVENT_TYPE_BOTTLING`

### Live Read Paths

- `GET /api/bookings/services` returns both event types:
  - Fermentation Batch Start (Kit) — Cal.com id `5904689`, 15 min
  - Bottling Appointment — Cal.com id `5904690`, 30 min
- Availability and slots return correct 12-hour America/Vancouver times (Pitfall 2 timezone handling confirmed working)

### Real Bookings Created (HTTP 201, real Cal.com UIDs, no PENDING- fallback)

- Ferment-in-store: 2026-06-05 2:00 PM — uid `dcVab11tuRNRo1hVhZXChR`
- Bottling (via `service: 'bottling'`): 2026-06-05 11:00 AM — uid `tiuKb1skpu9wMPqFZdZE2m`

### Confirmation Emails (Phase Acceptance Proof)

**CONFIRMED RECEIVED** — Cal.com confirmation emails arrived at the test customer inbox. This closes the original missing-confirmation issue (the phase acceptance criterion for all of Phase 25 and the reason the migration was undertaken). Times are correct (no UTC shift).

### Webhook End-to-End

- `POST /api/webhooks/calcom` returns 401 on bad signature — HMAC guard working
- After cancelling the ferment booking, freed slots reappeared in `GET /api/bookings/slots` for that date — proves:
  - `x-cal-signature-256` raw-body HMAC verification works with the live Cal.com payload (Assumption A2 CLOSED)
  - Cache invalidation on BOOKING_CANCELLED works correctly
  - The three-fallback date extraction path (startTime → booking.start → start) resolved correctly against the real payload

### Assumption Resolution

| Assumption | Status | Result |
|-----------|--------|--------|
| A1: Free-tier API keys + webhooks | CLOSED (Plan 01) | Available on free tier |
| A2: Raw-body HMAC form | CLOSED (Task 2) | Empirically confirmed: cal.com sends raw body; `x-cal-signature-256` header; HMAC-SHA256 hex verified |
| A3: bookings cal-api-version | CLOSED (Plan 01) | `2026-02-25` confirmed via live docs |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed Zoho Bookings test block from zoho-api.test.js**
- **Found during:** Task 3 pre-removal grep
- **Issue:** `zoho-api.test.js` imported `bookingsGet`, `bookingsPost`, `BOOKINGS_API_BASE` and had a 5-test describe block for them. After removing the functions from the module, the tests would fail (undefined is not a function).
- **Fix:** Removed the "Zoho Bookings API helpers" describe block and cleaned the destructuring imports at line 23-25.
- **Files modified:** `zoho-middleware/__tests__/zoho-api.test.js`
- **Commit:** `0f8745d`

**2. [Rule 3 - Blocking] Updated calcom.js style comment**
- **Found during:** Post-removal grep verification
- **Issue:** The plan's verification grep (`grep -rn | grep -v '^\s*//'`) returned count 1 instead of 0 because `grep -rn` prefixes output with `filename:lineno:` which defeats the comment filter. The match was a pure code comment in `calcom.js` referencing `bookingsGet/bookingsPost` in description text.
- **Fix:** Updated the comment text to remove the now-stale function name references.
- **Files modified:** `zoho-middleware/lib/calcom.js`
- **Commit:** `0f8745d`

## Follow-up Actions Required

### (1) MANUAL Railway step — remove ZOHO_BOOKINGS_* env vars

**Action needed:** Log in to Railway → svmiddleware-production → Variables and delete:
- `ZOHO_BOOKINGS_SERVICE_ID`
- `ZOHO_BOOKINGS_STAFF_ID`

These are no longer referenced in the codebase. The `validateEnv.js` OPTIONAL array no longer lists them, so their presence in Railway env is harmless but is dead configuration. This cannot be done automatically — requires Railway dashboard access.

### (2) Deploy Zoho-removal cleanup commit to production

**Action needed:** The Zoho Bookings removal commit (`0f8745d`) is on the local `main` branch and must be deployed:

```bash
# Deploy to production (only remote that exists for middleware)
git push production main --force
```

The middleware changes are safe to deploy at any time — they are purely removals of dead code that was already not being called (replaced by Cal.com in Plans 02-03, which are already in production).

### (3) Tech debt — DEPLOYMENT.md stale staging-api reference

`docs/DEPLOYMENT.md` references a staging middleware API that does not exist. There is no separate staging middleware; the single production Railway instance (`svmiddleware-production`) serves both the staging and production frontend repos. This documentation is stale and should be updated in a follow-up doc cleanup pass.

## Verification Gates (All Passed)

- `grep` (0 live refs in lib/ + routes/ excluding comments): **PASS** — count = 0
- `cd zoho-middleware && npm test` — **PASS** — 573/573 tests pass (27 suites)
- `npm test` (root frontend) — **PASS** — 432/432 tests pass (24 suites)
- `npm run lint` — **PASS** — 0 errors (118 pre-existing ES5 warnings, unchanged)
- `normalizeTimeTo24h`, `zohoGet`, `zohoPost` still exported from zoho-api.js: **PASS**
- `offline-fallback (req.zohoOffline -> PENDING-)` still present in routes/bookings.js (lines 296, 381): **PASS**

## Phase 25 Complete — All Success Criteria Met

| Criterion | Status |
|-----------|--------|
| BOOK-01: Cal.com adapter with full unit tests | Complete (Plan 01) |
| BOOK-02: Staging booking + Cal.com confirmation email | Complete (Task 2 — production-verified) |
| BOOK-03: At least one additional event type bookable | Complete (Task 1 — BOTTLING event type) |
| BOOK-04: Zoho Bookings code removed, no dead refs, offline fallback intact | Complete (Task 3) |
| BOOK-05: Both suites + lint green | Complete (Task 3) |

## Known Stubs

None — all booking endpoints are fully wired to Cal.com with real data. The offline fallback (`PENDING-` prefix) is an intentional degraded-mode path, not a stub.

## Threat Surface Scan

No new network endpoints or auth paths introduced in this plan (Task 3 is pure deletion). The plan's threat model is fully satisfied:
- T-25-11 (CALCOM_* secrets): never committed to git; Railway env only
- T-25-12 (premature Zoho removal): mitigated — removal executed only after Task 2 verification confirmed Cal.com operational
- T-25-13 (webhook signature form): CLOSED — empirically confirmed in Task 2 live verification

## Self-Check: PASSED

- `/Users/koa/Library/CloudStorage/GoogleDrive-hello@steinsandvines.ca/Shared drives/Steins and Vines/5 IT/steins-and-vines-website/zoho-middleware/lib/zoho-api.js` — FOUND (modified)
- `/Users/koa/Library/CloudStorage/GoogleDrive-hello@steinsandvines.ca/Shared drives/Steins and Vines/5 IT/steins-and-vines-website/zoho-middleware/lib/validateEnv.js` — FOUND (modified)
- Commit `0f8745d` (refactor 25-04: remove dead Zoho Bookings code paths) — FOUND
