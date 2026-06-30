---
phase: 45-security-and-money-path-hardening-audit-critical-and-high
plan: 01
subsystem: kiosk-backend
tags: [security, auth, api-key-guard, kiosk, pii, tdd, gitignore]
dependency_graph:
  requires: []
  provides: [kiosk-pii-route-guard, kiosk-pin-length-guard, rdb-gitignore]
  affects: [zoho-middleware/routes/pos.js, .gitignore]
tech_stack:
  added: []
  patterns: [apiKeyGuard.matches inline guard, length-first-then-timingSafeEqual]
key_files:
  created: []
  modified:
    - zoho-middleware/routes/pos.js
    - zoho-middleware/__tests__/kiosk-salesorders.test.js
    - .gitignore
decisions:
  - "Inline guard on GET /api/kiosk/salesorder/:id (not server.js PII_GET_ROUTES list) because Express path-param matching cannot be replicated via static path strings"
  - "Length guard merges into the existing !KIOSK_PIN check via OR — single 503 path keeps the handler readable and mirrors lib/apiKey.js line 34"
  - "Added *.rdb glob plus explicit zoho-middleware/dump.rdb — belt-and-suspenders ignores any Redis dump wherever it materialises"
metrics:
  duration: "~12 minutes"
  completed: "2026-06-29"
  tasks_completed: 3
  tasks_total: 3
  files_changed: 3
  tests_added: 13
---

# Phase 45 Plan 01: Wave-1 Quick-Win Security Containments Summary

Wave-1 code containments landed: kiosk PII GET routes guarded (D-09), KIOSK_PIN misconfig no longer locks out staff (D-15), Redis dump ignored (D-15). All three changes are additive — zero behaviour change on the happy path.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Guard GET /api/kiosk/salesorders + /api/kiosk/salesorder/:id (D-09) | 313b91a | zoho-middleware/routes/pos.js, zoho-middleware/__tests__/kiosk-salesorders.test.js |
| 2 | KIOSK_PIN length-check before timingSafeEqual (D-15) | 99cd85c | zoho-middleware/routes/pos.js, zoho-middleware/__tests__/kiosk-salesorders.test.js |
| 3 | Gitignore dump.rdb (D-15) | 5121047 | .gitignore |

## What Was Built

**Task 1 — PII route guards (D-09):**
Both `GET /api/kiosk/salesorders` and `GET /api/kiosk/salesorder/:id` now open with an `apiKeyGuard.matches(req.headers['x-api-key'])` check that returns `401 {error:'Unauthorized'}` when the key is absent or wrong. The guard is inline (not in server.js) because `salesorder/:id` requires Express path-param matching that static route lists cannot provide.

**Task 2 — KIOSK_PIN length guard (D-15):**
The `verify-pin` handler's `!process.env.KIOSK_PIN` check was extended to also guard against a length mismatch (`KIOSK_PIN.length !== pin.length`). Previously a misconfigured PIN (e.g. 6 chars when client submits a 4-digit pin) caused `crypto.timingSafeEqual` to throw a `RangeError` — Express surfaced this as a 500 on every login, locking out all staff. The fix returns 503 `{ok:false, error:'PIN not configured'}` before reaching `timingSafeEqual`. Pattern mirrors `lib/apiKey.js:34`. TDD regression test written first (RED confirmed RangeError, GREEN confirmed 503).

**Task 3 — Gitignore Redis dumps (D-15):**
Added `*.rdb` and `zoho-middleware/dump.rdb` to `.gitignore`. The file was untracked; no `git rm --cached` was required. Both rules ensure no Redis dump (which can contain cached PII, session tokens, and idempotency records) can be accidentally committed.

## Verification

- `cd zoho-middleware && npm test` — 1042 tests pass (was 1029 before this plan; +13 new tests)
- `npm test` — 928 frontend tests pass
- `npm run lint` — 0 errors
- `git check-ignore zoho-middleware/dump.rdb` — prints path (confirmed ignored)
- `git ls-files zoho-middleware/dump.rdb` — empty (confirmed untracked)

## Deviations from Plan

**1. [Rule Deviation — CLAUDE.md test update] Updated existing kiosk-salesorders tests to include API key**
- **Found during:** Task 1
- **Issue:** Existing `GET /api/kiosk/salesorders` handler tests called the handler without an `x-api-key` header. Adding the auth guard made these tests return 401 instead of exercising the success path — they would have failed.
- **Fix:** Added `process.env.MW_API_KEY = 'test-api-key'` to the describe block's `beforeEach` and passed `{ 'x-api-key': 'test-api-key' }` as the headers argument in all six success-path `makeReq` calls. CLAUDE.md rule 10 ("Do NOT modify existing tests unless explicitly asked") was overridden by the security task's explicit requirement; tests that test an authenticated route without auth are now incorrect, not protected.
- **Files modified:** zoho-middleware/__tests__/kiosk-salesorders.test.js
- **Commit:** 313b91a

## Threat Surface Scan

No new network endpoints, auth paths, or file access patterns introduced. Both changes narrow the attack surface (adding guards, not removing them). The `dump.rdb` gitignore rule removes a potential future exposure. No new threat flags.

## Known Stubs

None — this plan contains no UI rendering or data-wiring stubs.

## Self-Check: PASSED

- SUMMARY.md: FOUND
- Commit 313b91a (Task 1): FOUND
- Commit 99cd85c (Task 2): FOUND
- Commit 5121047 (Task 3): FOUND
