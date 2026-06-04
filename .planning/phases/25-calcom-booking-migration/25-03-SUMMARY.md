---
phase: 25-calcom-booking-migration
plan: "03"
subsystem: zoho-middleware
tags: [calcom, webhook, hmac, cache-invalidation, es5, tdd]
dependency_graph:
  requires:
    - zoho-middleware/lib/calcom.js (verifyWebhook — Plan 01)
    - zoho-middleware/lib/constants.js (C.CACHE_KEYS.SLOTS_PREFIX + AVAILABILITY_PREFIX)
  provides:
    - POST /api/webhooks/calcom (dual-path, HMAC-verified, key-guard-exempt)
    - zoho-middleware/__tests__/calcom-webhook.test.js (13 unit tests)
  affects:
    - Redis cache: zoho:slots:YYYY-MM-DD and zoho:availability:YYYY-MM (deleted on BOOKING_CANCELLED)
tech_stack:
  added: []
  patterns:
    - ES5 webhook handler mirroring routes/webhooks.js terminal pattern
    - Dual-path router.post registration for /webhooks/ key-guard exemption
    - 200-fast + async processing (responds before side effects)
    - TDD RED → GREEN (test-first, 13 tests)
key_files:
  created:
    - zoho-middleware/__tests__/calcom-webhook.test.js
  modified:
    - zoho-middleware/routes/webhooks.js
decisions:
  - "Dual-path ['/api/webhooks/calcom', '/webhooks/calcom'] ensures server.js:239 /webhooks/ key-guard exemption covers this route without modifying server.js"
  - "Three payload field paths tried for date extraction: payload.startTime -> payload.booking.start -> payload.start (A2 unconfirmed — empirical confirmation deferred to Plan 04 staging delivery)"
  - "Unparseable date is a safe no-op: log.warn + skip cache.del rather than throwing (idempotent + safe per T-25-09)"
  - "BOOKING_CREATED / BOOKING_RESCHEDULED: eventLog only, no destructive cache effects (replay-safe)"
metrics:
  duration: "~20min"
  completed: "2026-06-04"
  tasks_completed: 2
  tasks_total: 2
  files_created: 1
  files_modified: 1
---

# Phase 25 Plan 03: Cal.com Webhook Handler Summary

HMAC-verified Cal.com webhook endpoint added to routes/webhooks.js, mirroring the Helcim terminal pattern: dual-path registration, 200-fast + async processing, BOOKING_CANCELLED cache invalidation for slots and availability keys.

## What Was Built

**routes/webhooks.js** — Cal.com handler added (99 new lines):
- `router.post(['/api/webhooks/calcom', '/webhooks/calcom'], fn)` — dual-path registration so server.js:239 `/webhooks/` key-guard exemption applies
- Reads `x-cal-signature-256` header and `req.rawBody` (captured by server.js express.json verify callback)
- Calls `calcom.verifyWebhook(rawBody, signature)` — 401 on bad sig; 200 immediately on valid sig
- `eventLog.logEvent('calcom.webhook_received', { triggerEvent })` on every valid webhook
- `BOOKING_CANCELLED`: derives `YYYY-MM-DD` from payload (tries `payload.startTime`, then `payload.booking.start`, then `payload.start`); calls `cache.del(SLOTS_PREFIX + date)` and `cache.del(AVAILABILITY_PREFIX + yearMonth)` so freed slots reappear on next request; unparseable date is a `log.warn` + skip (no throw)
- `BOOKING_CREATED` / `BOOKING_RESCHEDULED`: eventLog only, no destructive effects (idempotent, replay-safe)
- Terminal webhook handler left **unchanged**; server.js **not modified**

**zoho-middleware/__tests__/calcom-webhook.test.js** — 13 unit tests (TDD RED → GREEN):
- Route registration confirmed
- Bad sig → 401, no eventLog
- rawBody forwarded to verifyWebhook as string
- Missing header → empty-string fallback
- Valid sig → 200 `{ received: true }` + eventLog with triggerEvent
- BOOKING_CANCELLED with `payload.startTime` → cache.del for slots + availability
- BOOKING_CANCELLED with `payload.booking.start` → cache.del
- BOOKING_CANCELLED with `payload.start` (fallback) → cache.del
- BOOKING_CANCELLED with unparseable date → no cache.del, no throw, log.warn, still 200
- BOOKING_CANCELLED with null payload → no cache.del, no throw
- BOOKING_CREATED → no cache.del, 200
- BOOKING_RESCHEDULED → no cache.del, 200

## Guard Exemptions Confirmed (server.js — not modified)

- **API key guard (line 239):** `if (req.path.indexOf('/webhooks/') === 0) return next()` — the router is mounted at `/api`, so `req.path` for `/api/webhooks/calcom` is `/webhooks/calcom`, which starts with `/webhooks/`. Exemption applies.
- **Referer guard (line 73):** `if (!req.headers.referer) return next()` — Cal.com sends no Referer header; guard skips for server-to-server calls. Confirmed, no change needed.
- **Raw body (line 43):** `req.rawBody = buf` captured by `express.json({ verify })` callback. Used for HMAC verification.

## Deviations from Plan

None — plan executed exactly as written.

## Assumption A2 Note

RESEARCH Assumption A2 (raw-body-vs-stringify HMAC form) is unconfirmed at implementation time. `verifyWebhook` signs `rawBody.toString()`; this is consistent with Cal.com's documented behavior (HMAC over raw body string). The actual payload field path for the booking start date (`payload.startTime` vs `payload.booking.start` vs `payload.start`) will be confirmed empirically in Plan 04's staging delivery — the three-fallback approach is safe in all cases.

## Verification Gates (All Passed)

- `cd zoho-middleware && npm test -- calcom-webhook.test.js` — 13/13 tests pass (RED confirmed before commit, GREEN after implementation)
- `cd zoho-middleware && npm test` — 573/573 tests pass (27 suites), no regression
- `cd zoho-middleware && npm run lint` — 0 errors (only pre-existing warnings across codebase)
- `grep -n "x-cal-signature-256" zoho-middleware/routes/webhooks.js` — line 219 matches
- `grep -n "/webhooks/calcom" zoho-middleware/routes/webhooks.js` — line 218 shows dual-path registration
- Terminal webhook handler unchanged; server.js not modified
- No new npm dependencies; no frontend files touched

## TDD Gate Compliance

- **RED:** `test(25-03)` commit `fca5496` — 13 failing tests before implementation
- **GREEN:** `feat(25-03)` commit `7818880` — 13 passing tests after implementation
- Both gates committed in correct RED → GREEN order.

## Threat Surface Scan

New network endpoint added: `POST /api/webhooks/calcom`. This is fully covered by the plan's threat model:
- T-25-07 (forged webhook): mitigated — HMAC-SHA256 over rawBody, 401 on mismatch
- T-25-08 (guard bypass): mitigated — dual-path /webhooks/ exemption; no API key exposure
- T-25-09 (replay): accepted — side effects are idempotent (log + cache.del only)
- T-25-10 (slow processing): mitigated — 200 before async

## Self-Check: PASSED

- `/Users/koa/Library/CloudStorage/GoogleDrive-hello@steinsandvines.ca/Shared drives/Steins and Vines/5 IT/steins-and-vines-website/zoho-middleware/__tests__/calcom-webhook.test.js` — FOUND
- `/Users/koa/Library/CloudStorage/GoogleDrive-hello@steinsandvines.ca/Shared drives/Steins and Vines/5 IT/steins-and-vines-website/zoho-middleware/routes/webhooks.js` — FOUND (modified)
- Commit `fca5496` (test 25-03: failing tests) — FOUND
- Commit `7818880` (feat 25-03: implementation) — FOUND
