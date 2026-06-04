---
phase: 25-calcom-booking-migration
plan: "02"
subsystem: zoho-middleware
tags: [calcom, bookings, routes, tdd, es5, shape-translation]
dependency_graph:
  requires:
    - zoho-middleware/lib/calcom.js (Plan 01 — listEventType, getSlots, createBooking)
  provides:
    - zoho-middleware/routes/bookings.js (Cal.com-backed booking endpoints, legacy contract)
    - zoho-middleware/__tests__/bookings.test.js (15 tests: 2 cache + 13 Cal.com shape regressions)
  affects:
    - GET /api/bookings/services
    - GET /api/bookings/availability
    - GET /api/bookings/slots
    - POST /api/bookings
tech_stack:
  added: []
  patterns:
    - Thin route + adapter (routes/bookings.js delegates I/O to lib/calcom.js; route owns shape translation)
    - Single-call month availability (one getSlots range, no per-day fan-out)
    - ISO slot -> 12h label via toLocaleTimeString('en-US', {hour12:true, timeZone:'America/Vancouver'})
    - UTC start construction via Intl.DateTimeFormat offset trick (Pitfall 2 mitigation)
    - CALCOM_EVENT_TYPE_FERMENT_KIT + CALCOM_EVENT_TYPE_BOTTLING env var names (actual Railway names)
key_files:
  created: []
  modified:
    - zoho-middleware/routes/bookings.js
    - zoho-middleware/__tests__/bookings.test.js
decisions:
  - "CALCOM_EVENT_TYPE_FERMENT_KIT used (not CALCOM_EVENT_TYPE_FERMENT) per deviation directive and Railway env reality"
  - "CALCOM_EVENT_TYPE_BOTTLING surfaced as second service in GET /api/bookings/services (BOOK-03)"
  - "buildUtcStart uses Intl.DateTimeFormat offset trick to correctly convert Vancouver wall-clock to UTC ISO (Pitfall 2)"
  - "bookingsGet/bookingsPost removed from all four booking handlers; normalizeTimeTo24h/zohoGet/zohoPost kept (contacts still needs them)"
  - "services test sets process.env.CALCOM_EVENT_TYPE_FERMENT_KIT='101' inline to drive listEventType mock"
metrics:
  duration: "~4min"
  completed: "2026-06-04"
  tasks_completed: 2
  tasks_total: 2
  files_created: 0
  files_modified: 2
---

# Phase 25 Plan 02: Cal.com Booking Routes Summary

Cal.com-backed booking routes replacing all four Zoho Bookings handlers in routes/bookings.js, with identical legacy response shapes. TDD: regression tests written first (RED), implementation made them green. All validation, caching, and offline fallback preserved byte-for-byte.

## What Was Built

**routes/bookings.js** — rewritten four handlers (POST /api/contacts unchanged):

- **GET /api/bookings/services**: reads `CALCOM_EVENT_TYPE_FERMENT_KIT` and `CALCOM_EVENT_TYPE_BOTTLING` from env; calls `calcom.listEventType(id)` per configured id (skips any unset); maps each event-type to `{id, title, slug, duration, description, price, currency, bookingUrl}`; responds `{ services:[...], staff:[] }`; 24h Redis cache (BOOKING_SERVICES).

- **GET /api/bookings/availability**: ONE `calcom.getSlots(eventTypeId, startDate, endDate, 'America/Vancouver')` call for the whole month (no per-day fan-out — Pitfall 3 avoided); groups `data` object by date key; emits only days with `length > 0` as `{date, available:true, slots_count:N}`; responds `{ source:'calcom', dates:[...] }`; 5-min Redis cache (AVAILABILITY_PREFIX).

- **GET /api/bookings/slots**: `calcom.getSlots(eventTypeId, date, date, 'America/Vancouver')` for single day; converts each ISO `start` via `toLocaleTimeString('en-US', {hour:'numeric', minute:'2-digit', hour12:true, timeZone:'America/Vancouver'})`; responds `{ date, slots:[{time:"9:00 AM"}] }`; 5-min Redis cache (SLOTS_PREFIX).

- **POST /api/bookings**: all existing validation and `req.zohoOffline -> PENDING-` fallback kept verbatim; `buildUtcStart(date, time24)` uses Intl.DateTimeFormat offset trick to convert Vancouver wall-clock to UTC ISO with trailing Z; calls `calcom.createBooking({start, eventTypeId, attendee:{name, email, timeZone:'America/Vancouver', language:'en'}, metadata:{notes, phone}})`; maps `data.uid -> booking_id`; invalidates availability + slots caches; responds `201 { ok:true, booking_id, timeslot }`.

**__tests__/bookings.test.js** — extended with 13 new Cal.com regression tests (2 original cache tests preserved per CLAUDE.md rule #10):
- services: legacy shape from listEventType mock
- availability: `{ source:'calcom', dates }` from getSlots mock; empty days excluded; 400 on missing year/month; 502 on adapter rejection
- slots: 12-hour regex match on each slot.time; 502 on adapter rejection
- POST happy path: `booking_id` from `data.uid`, `timeslot` as `date+' '+time`
- POST offline: PENDING- without calling createBooking
- POST validation: 400 on bad date, missing email, missing date body
- POST upstream failure: 502 `{ error }`

## Deviations from Plan

### Deviation 1 — CALCOM_EVENT_TYPE_FERMENT_KIT (env var name, inherited from Plan 01)

**Rule: Deviation directive from orchestrator**
- **Plan spec:** `CALCOM_EVENT_TYPE_FERMENT`
- **Actual:** `CALCOM_EVENT_TYPE_FERMENT_KIT` — name used by the user in Railway
- **Impact:** All four handlers read `process.env.CALCOM_EVENT_TYPE_FERMENT_KIT` as the primary ferment event type ID.

### Deviation 2 — CALCOM_EVENT_TYPE_BOTTLING surfaced in services

**Rule: Deviation directive from orchestrator (BOOK-03 requirement)**
- **Plan spec:** Enumerate "CALCOM_EVENT_TYPE_* env ids" generically
- **Actual:** Explicitly reads `CALCOM_EVENT_TYPE_FERMENT_KIT` + `CALCOM_EVENT_TYPE_BOTTLING`; both surfaced in GET /api/bookings/services as separate service objects.
- **Impact:** Frontend receives both event types (ferment-in-store + bottling) in the services list.

### Deviation 3 — services test sets env var inline

**Rule: Auto-fix (test correctness)**
- **Issue:** Test for services handler: mock `CALCOM_EVENT_TYPE_FERMENT_KIT` was undefined at test time, so handler returned empty `serviceData=[]` and the test failed.
- **Fix:** Set `process.env.CALCOM_EVENT_TYPE_FERMENT_KIT = '101'` before calling the handler in the test (restored after). Standard Jest pattern for env-driven handlers.
- **Files modified:** `zoho-middleware/__tests__/bookings.test.js`

## Verification Gates (All Passed)

- `cd zoho-middleware && npm test -- bookings.test.js` — 15/15 tests pass (RED then GREEN)
- `cd zoho-middleware && npm test` — 560/560 tests pass (26 suites), no regression (was 547 before Plan 02)
- `npm test` (root frontend) — 432/432 tests pass, no frontend regression
- `npm run lint` — 0 errors (118 pre-existing warnings only)
- `grep -n "calcom" zoho-middleware/routes/bookings.js` — shows adapter required on line 3 and used in handlers
- `grep -c "bookingsGet\|bookingsPost" zoho-middleware/routes/bookings.js` — returns 0
- `grep -n "zohoOffline" zoho-middleware/routes/bookings.js` — shows offline fallback at lines 288 (bookings POST) and 363 (contacts POST)
- POST /api/contacts handler unchanged (verified: zohoGet/zohoPost still used, no calcom calls)

## TDD Gate Compliance

- **RED:** Task 1 wrote 13 new failing tests; 5 failing confirmed by test run before implementation
- **GREEN:** Task 2 implemented routes; all 15 tests green after `jest.resetModules()` isolation fix for services env var
- Both commits in correct order: `test(25-02)` then `feat(25-02)`

## Known Stubs

None. All four endpoints are backed by live Cal.com adapter calls; services lists both configured event types; availability derives real slot counts from a single range call.

## Threat Surface Scan

No new network endpoints added (routes already existed). No new auth paths. Threats T-25-04, T-25-05, T-25-06 from plan threat model are addressed:
- T-25-04: All existing strict POST validation preserved verbatim (date regex, email, name/phone/notes length caps)
- T-25-05: Single month-range getSlots call (not per-day fan-out) + 5-min Redis cache
- T-25-06: booking_id mapped from stable Cal.com data.uid

## Self-Check: PASSED

- `/Users/koa/Library/CloudStorage/GoogleDrive-hello@steinsandvines.ca/Shared drives/Steins and Vines/5 IT/steins-and-vines-website/zoho-middleware/routes/bookings.js` — FOUND
- `/Users/koa/Library/CloudStorage/GoogleDrive-hello@steinsandvines.ca/Shared drives/Steins and Vines/5 IT/steins-and-vines-website/zoho-middleware/__tests__/bookings.test.js` — FOUND
- Commit `f738d10` (test 25-02: regression tests RED) — FOUND
- Commit `d6b7254` (feat 25-02: routes rewrite GREEN) — FOUND
