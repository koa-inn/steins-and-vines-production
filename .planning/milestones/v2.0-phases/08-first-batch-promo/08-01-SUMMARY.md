---
phase: 08-first-batch-promo
plan: 01
subsystem: zoho-middleware
tags: [promo, redis, api, kiosk]
dependency_graph:
  requires: []
  provides: [POST /api/promo/validate, DELETE /api/promo/redemption/:email, POST /api/promo/seed-kiosk, PROMO_REDEEMED_PREFIX]
  affects: [zoho-middleware/server.js, zoho-middleware/lib/constants.js]
tech_stack:
  added: []
  patterns: [Redis per-email redemption tracking, fail-open Redis error handling, idempotent kiosk preset seeding]
key_files:
  created:
    - zoho-middleware/routes/promo.js
    - zoho-middleware/__tests__/promo.test.js
  modified:
    - zoho-middleware/lib/constants.js
    - zoho-middleware/server.js
decisions:
  - "Fail-open on Redis error for /api/promo/validate — Redis unavailable should not block legitimate customers"
  - "Kiosk seed-kiosk endpoint is idempotent — returns 200 with existing preset if FIRSTBATCH already exists, 201 on creation"
  - "Per D-07: no per-email gate on kiosk staff operations — trusted staff path bypasses customer-facing redemption check"
metrics:
  duration: 12min
  completed_date: "2026-05-04"
  tasks_completed: 2
  files_changed: 4
---

# Phase 08 Plan 01: Promo Code Backend Infrastructure Summary

**One-liner:** FIRSTBATCH promo code validation with per-email Redis redemption tracking, admin reset, and kiosk preset seeding endpoints.

## What Was Built

Created the server-side infrastructure for the FIRSTBATCH promo code:

- `zoho-middleware/routes/promo.js` — Three endpoints:
  - `POST /api/promo/validate` (public, no API key): normalizes code/email, checks Redis for prior redemption, returns `{ ok:true, discountPct:20, code:'FIRSTBATCH' }` on success, fails open on Redis error
  - `DELETE /api/promo/redemption/:email` (admin, API key required): clears a per-email redemption record from Redis
  - `POST /api/promo/seed-kiosk` (admin, API key required): seeds FIRSTBATCH as a kiosk discount preset, idempotent
- `zoho-middleware/lib/constants.js` — Added `PROMO_REDEEMED_PREFIX: 'promo:firstbatch:redeemed:'`
- `zoho-middleware/server.js` — API key bypass for `/promo/validate` + route registration
- `zoho-middleware/__tests__/promo.test.js` — 16 unit tests covering all endpoints

## Tests

- 16 new promo tests added; all pass
- Full suite: 426 tests, 19 suites — all pass, no regressions

## Deviations from Plan

None — plan executed exactly as written.

## Threat Surface Scan

No new trust boundaries beyond those documented in the plan's threat_model. All three endpoints align with the T-08-xx mitigations:
- T-08-01/T-08-05: Public validate endpoint relies on existing /api rate limiter
- T-08-04: Error messages do not reveal whether email exists in system
- T-08-06/T-08-15: Admin endpoints (DELETE, seed-kiosk) require x-api-key

## Self-Check: PASSED

- `zoho-middleware/routes/promo.js` — EXISTS
- `zoho-middleware/__tests__/promo.test.js` — EXISTS
- `zoho-middleware/lib/constants.js` contains PROMO_REDEEMED_PREFIX — VERIFIED
- `zoho-middleware/server.js` contains `/promo/validate` bypass — VERIFIED
- Commit a7509fb (Task 1) — EXISTS
- Commit bb9be1c (Task 2) — EXISTS
