---
phase: 28-zoho-customer-read-back-path
plan: 01
subsystem: api
tags: [zoho, express, jest, tdd, pos, middleware]

# Dependency graph
requires:
  - phase: 07-batch-zoho-sync
    provides: zohoGet wrapper in lib/zoho-api.js and existing /api/batch/* endpoint patterns
provides:
  - GET /api/batch/customer-by-number endpoint in pos.js
  - Unit tests for all documented paths (success, 404, exact-match-reject, 502, partial-200, 400, 401)
  - TDD RED (d1df996) + GREEN (d142d8f) commit pair
affects: [29-refresh-from-zoho-ui, 29.1-batch-customer-reassignment]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "params-object form for zohoGet list calls: zohoGet(path, { invoice_number: number }) — NOT string concat"
    - "Defensive exact-number match after Zoho list response to neutralize fuzzy filter semantics"
    - "Two-call Zoho chain: document list for customer_id, then /contacts/{id} for email/phone"
    - "D-15 partial-200 pattern: contact-fetch failure returns customer_name + contact_unavailable:true"

key-files:
  created:
    - zoho-middleware/__tests__/batch-customer.test.js
  modified:
    - zoho-middleware/routes/pos.js

key-decisions:
  - "D-06 exact-match: iterate returned docs for case-insensitive equality before use — Zoho filter semantics irrelevant to correctness"
  - "D-07 email fallback: contact.email || primary contact_person.email (INV-000078 production pattern)"
  - "D-04 phone fallback: primary.phone || primary.mobile"
  - "D-11 no caching: always-live reads for refresh semantics"
  - "D-15 partial 200: contact fetch failure yields customer_name preserved + null email/phone + contact_unavailable:true"

patterns-established:
  - "findHandler('get', path) from kiosk-salesorders.test.js is authoritative for pos.js handler tests"
  - "Sequential mockResolvedValueOnce for two-call Zoho sequences"

requirements-completed: []

# Metrics
duration: 3min
completed: 2026-06-11
---

# Phase 28 Plan 01: Zoho Customer Read-Back Path Summary

**`GET /api/batch/customer-by-number` endpoint resolving Zoho INV-/SO- numbers to customer name, email (with contact_persons fallback), and phone via two sequential zohoGet calls — 12 unit tests all GREEN**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-06-11T22:52:12Z
- **Completed:** 2026-06-11T22:55:00Z
- **Tasks:** 3 (TDD: 2 code tasks + 1 verification)
- **Files modified:** 2

## Accomplishments

- New `GET /api/batch/customer-by-number` handler in pos.js with full D-01..D-16 contract (auth, input validation, two-call Zoho chain, exact-match guard, partial-200, 404, 502)
- 12 unit tests covering all documented paths (401 x2, 400 x3, 404-empty, 404-exact-match-reject, success-D07-fallback, D04-phone-fallback, SO-routing, partial-200-D15, 502) — all GREEN
- Full middleware suite (596 tests, 29 suites) passes with zero regressions; lint clean (0 errors, all warnings pre-existing)
- TDD discipline maintained: RED commit (d1df996) before GREEN commit (d142d8f)

## Task Commits

1. **Task 1: Write batch-customer.test.js (RED)** - `d1df996` (test)
2. **Task 2: Implement GET /api/batch/customer-by-number (GREEN)** - `d142d8f` (feat)
3. **Task 3: Full suite + lint verification** - (no new commit — verification-only)

## Files Created/Modified

- `zoho-middleware/__tests__/batch-customer.test.js` - 12 unit tests using _routeRegistry/findHandler pattern from kiosk-salesorders.test.js
- `zoho-middleware/routes/pos.js` - Added `router.get('/api/batch/customer-by-number', ...)` handler (lines ~1369–1483)

## Decisions Made

- Used `filterParams[filterKey] = number` (params-object form) — NOT string concat — to ensure organization_id merging in zohoGet works correctly (Pitfall 2)
- Defensive exact-match loop iterates returned docs before use — neutralizes Zoho fuzzy filter semantics (D-06, Open Question 3 resolution)
- No caching added (D-11): refresh semantics require always-live data
- No new rate limiter added (D-11): global apiLimiter at 60 req/min already covers /api/*
- ES5 style throughout: `var`, no arrow functions, no template literals — matches surrounding pos.js code

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None. The test suite ran at 596 tests (vs the ~323 mentioned in research context); the growth is from other test files added since the research was written, not a discrepancy.

## User Setup Required

None — no external service configuration required. The new endpoint uses the existing MW_API_KEY and zohoGet infrastructure.

## Threat Surface Scan

No new threat surface beyond what the plan's threat model covers. The new endpoint is gated by x-api-key (T-28-01), uses D-16 regex validation (T-28-03), and logs only doc number and customer_id — never email or phone (T-28-04).

## Next Phase Readiness

- Phase 28 Plan 02 (Apps Script allowedFields extension for customer_email/customer_phone in adminApi.gs) can proceed immediately
- Phase 29 "Refresh from Zoho" button UI depends on this endpoint being live — the read path is now implemented and unit-tested
- Endpoint ready to test manually: `curl -H "x-api-key: $MW_API_KEY" "http://localhost:3001/api/batch/customer-by-number?number=INV-000123"`

---
*Phase: 28-zoho-customer-read-back-path*
*Completed: 2026-06-11*
