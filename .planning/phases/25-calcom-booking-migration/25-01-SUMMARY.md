---
phase: 25-calcom-booking-migration
plan: "01"
subsystem: zoho-middleware
tags: [calcom, adapter, webhook, es5, tdd]
dependency_graph:
  requires: []
  provides:
    - zoho-middleware/lib/calcom.js (Cal.com API v2 adapter — all four functions)
    - zoho-middleware/__tests__/calcom.test.js (20 unit tests, 100% coverage)
    - CALCOM_* vars registered in validateEnv OPTIONAL list
  affects:
    - zoho-middleware/lib/validateEnv.js (four CALCOM_* entries added)
tech_stack:
  added: []
  patterns:
    - ES5 adapter matching lib/zoho-api.js style (var, function declarations, module.exports)
    - withRetry from lib/zoho-api wrapping axios calls (429/5xx backoff)
    - HMAC-SHA256 hex webhook verify mirroring lib/helcim.js (fail-open + timingSafeEqual)
key_files:
  created:
    - zoho-middleware/lib/calcom.js
    - zoho-middleware/__tests__/calcom.test.js
  modified:
    - zoho-middleware/lib/validateEnv.js
decisions:
  - "bookings cal-api-version confirmed as 2026-02-25 (verified via gemini fetch of live docs 2026-06-04; matches RESEARCH A3 direct-fetch value)"
  - "env var names match Railway as set by user: CALCOM_EVENT_TYPE_FERMENT_KIT (not FERMENT), CALCOM_EVENT_TYPE_BOTTLING (second type added)"
  - "four CALCOM_* vars registered in validateEnv (plan specified three; bottling added per user's Railway setup)"
metrics:
  duration: "~15min"
  completed: "2026-06-04"
  tasks_completed: 2
  tasks_total: 3
  files_created: 2
  files_modified: 1
---

# Phase 25 Plan 01: Cal.com Adapter Contract Summary

Cal.com API v2 adapter (`lib/calcom.js`) built with all four exported functions, centralized version constants, and 20 unit tests green. `validateEnv.js` registers the four Railway CALCOM_* env vars. Task 1 (free-tier risk gate) was pre-resolved by the user before execution.

## What Was Built

**lib/calcom.js** — ES5 adapter (145 lines) mirroring `lib/zoho-api.js` bookings helper style:
- `CAL_VERSIONS` map: `eventTypes='2024-06-14'`, `slots='2024-09-04'`, `bookings='2026-02-25'`
- `listEventType(id)` — GET `/v2/event-types/{id}`, version `2024-06-14`
- `getSlots(eventTypeId, start, end, timeZone)` — GET `/v2/slots`, version `2024-09-04`, default tz=America/Vancouver
- `createBooking(body)` — POST `/v2/bookings`, version `2026-02-25`
- `verifyWebhook(rawBody, signature)` — HMAC-SHA256 hex, `crypto.timingSafeEqual`, fail-open + `log.warn` when `CALCOM_WEBHOOK_SECRET` unset

All functions wrap axios calls in `withRetry` imported from `lib/zoho-api`. Timeout: 15000ms. No new npm dependencies.

**calcom.test.js** — 20 unit tests covering:
- `CAL_VERSIONS` map values
- Each function's URL, `cal-api-version` header, `Authorization: Bearer` header, timeout
- `getSlots` default and custom `timeZone`
- `verifyWebhook`: valid sig, invalid sig, unset secret (fail-open), length mismatch, empty string, hex digest length
- All four function exports + `CAL_VERSIONS` export shape

**validateEnv.js** — Four CALCOM_* entries added to OPTIONAL array; ZOHO_BOOKINGS_* left in place.

## Free-Tier Risk Gate (Task 1 — Pre-Resolved)

**Status: CLEARED.** The user created a free Cal.com Individual account before execution and confirmed:
- API key creation (Settings → Security → API Keys) is available on the free tier — NOT paywalled.
- Webhook creation (Settings → Developer → Webhooks) is available on the free tier — NOT paywalled.
- Open Question Q1 is answered: both API keys and webhooks are on the free tier.
- Ferment-in-store event type created (60 min, $0 CAD).
- Second event type chosen: **BOTTLING**.
- All credentials already set in Railway by the user (CALCOM_API_KEY, CALCOM_WEBHOOK_SECRET, CALCOM_EVENT_TYPE_FERMENT_KIT, CALCOM_EVENT_TYPE_BOTTLING).

## Confirmed API Version

**`bookings` cal-api-version: `2026-02-25`** — confirmed via Gemini fetch of live cal.com/docs/api-reference/v2/bookings/create-a-booking on 2026-06-04. This matches the research doc's high-confidence direct-fetch value (Assumption A3 confirmed). The older value `2024-08-13` from search snippets is superseded.

## Deviations from Plan

### Deviation 1 — CALCOM_EVENT_TYPE_FERMENT_KIT (env var name)

**Rule: Deviation directive from orchestrator**
- **Plan spec:** `CALCOM_EVENT_TYPE_FERMENT`
- **Actual:** `CALCOM_EVENT_TYPE_FERMENT_KIT` — name used by the user in Railway
- **Reason:** The user set the Railway env var with the `_KIT` suffix before execution. Code must match live Railway env.
- **Impact:** validateEnv.js registers `CALCOM_EVENT_TYPE_FERMENT_KIT`; routes/bookings.js (Plan 02) will read this name when mapping event types.

### Deviation 2 — CALCOM_EVENT_TYPE_BOTTLING (fourth CALCOM_* var)

**Rule: Deviation directive from orchestrator**
- **Plan spec:** Three vars (CALCOM_API_KEY, CALCOM_EVENT_TYPE_FERMENT, CALCOM_WEBHOOK_SECRET)
- **Actual:** Four vars — added `CALCOM_EVENT_TYPE_BOTTLING` for the user's chosen second event type.
- **Reason:** The user chose BOTTLING as the additional event type and set `CALCOM_EVENT_TYPE_BOTTLING` in Railway.
- **Files modified:** `zoho-middleware/lib/validateEnv.js`

### Note: lib/calcom.js does NOT hardcode event-type env var names

`lib/calcom.js` functions take `eventTypeId` as a parameter — no env var names appear in the adapter itself. The mapping of `CALCOM_EVENT_TYPE_FERMENT_KIT` / `CALCOM_EVENT_TYPE_BOTTLING` to numeric IDs happens in `routes/bookings.js` (Plan 02).

## Verification Gates (All Passed)

- `cd zoho-middleware && npm test -- calcom.test.js` — 20/20 tests pass
- `cd zoho-middleware && npm test` — 547/547 tests pass (26 suites), no regression
- `cd zoho-middleware && npm run lint` — 0 errors (only pre-existing warnings across codebase, same pattern as helcim.js)
- `grep -n "cal-api-version" zoho-middleware/lib/calcom.js` — shows centralized `CAL_VERSIONS` map (not hardcoded per-call)
- `grep -c -E "CALCOM_API_KEY|CALCOM_EVENT_TYPE_FERMENT_KIT|CALCOM_EVENT_TYPE_BOTTLING|CALCOM_WEBHOOK_SECRET" zoho-middleware/lib/validateEnv.js` → returns 4
- `ZOHO_BOOKINGS_SERVICE_ID` and `ZOHO_BOOKINGS_STAFF_ID` still present in validateEnv.js

## TDD Gate Compliance

- **RED:** Tests written and confirmed failing (20 tests, "Cannot find module '../lib/calcom'") before implementation
- **GREEN:** lib/calcom.js implemented; all 20 tests pass; 100% coverage on calcom.js
- Both commits committed in correct order.

## Threat Surface Scan

No new network endpoints added in this plan (lib/calcom.js is a client library, not a route). No new auth paths. The threat model in the plan covers this plan's scope:
- T-25-01: CALCOM_API_KEY server-side only (Railway env) — satisfied; never in frontend code
- T-25-02: verifyWebhook HMAC-SHA256 hex + timingSafeEqual — implemented and unit-tested
- T-25-03: timingSafeEqual timing protection — implemented

## Self-Check: PASSED

- `/Users/koa/Library/CloudStorage/GoogleDrive-hello@steinsandvines.ca/Shared drives/Steins and Vines/5 IT/steins-and-vines-website/zoho-middleware/lib/calcom.js` — FOUND
- `/Users/koa/Library/CloudStorage/GoogleDrive-hello@steinsandvines.ca/Shared drives/Steins and Vines/5 IT/steins-and-vines-website/zoho-middleware/__tests__/calcom.test.js` — FOUND
- Commit `ed517b8` (feat 25-01: adapter + tests) — FOUND
- Commit `fc0973e` (chore 25-01: validateEnv CALCOM_*) — FOUND
