---
phase: 54-gift-card-management-on-the-kiosk-surface
plan: 01
subsystem: auth
tags: [express, jest, kiosk, device-token, gift-card]

# Dependency graph
requires:
  - phase: 46-auth-re-architecture
    provides: 3-tier credential dispatch (legacy/device/session) in zoho-middleware/lib/authTiers.js, KIOSK_ROUTES explicit allowlist, isKioskRoute()
provides:
  - "/api/kiosk/gift-card/void reachable with a bare kiosk device token (D-54-GC)"
  - "Regression coverage proving the scope widening (both auth-tiers-guard.test.js and pos-auth-tier.test.js flipped) without weakening any other admin-grade device-403 negative"
affects: [54-02-kiosk-gift-card-panel, 54-03-regression-test]

# Tech tracking
tech-stack:
  added: []
  patterns: ["KIOSK_ROUTES membership-only scope changes: no route-handler edit required when a route relies solely on the global /api guard"]

key-files:
  created: []
  modified:
    - zoho-middleware/lib/authTiers.js
    - zoho-middleware/__tests__/auth-tiers-guard.test.js
    - zoho-middleware/__tests__/pos-auth-tier.test.js

key-decisions:
  - "D-54-GC executed as planned: /api/kiosk/gift-card/void added to KIOSK_ROUTES, superseding D-46-02/T-46-07"
  - "D-54-GC-a executed as planned: the two device-403 void tests flipped to not-403; all other admin-grade device-403 negatives (PII-GET /api/contacts, BrewPad-GET /api/batch/search-invoices, admin-GET /api/orders/recent) left untouched"

patterns-established: []

requirements-completed: [KIOSK-GC-54]

# Metrics
duration: 1min
completed: 2026-07-08
---

# Phase 54 Plan 01: Kiosk Gift-Card Void Auth Scope Widening Summary

**Widened the kiosk device-token allowlist to include `/api/kiosk/gift-card/void` by adding one literal path to `KIOSK_ROUTES`, then flipped the two `device→403` void tests to `not.toBe(403)` — no route-handler code changed.**

## Performance

- **Duration:** ~1 min (two atomic commits, 55s apart)
- **Started:** 2026-07-08T20:41:00Z (approx)
- **Completed:** 2026-07-08T20:42:40-07:00
- **Tasks:** 2/2 completed
- **Files modified:** 3

## Accomplishments
- `POST /api/kiosk/gift-card/void` with a valid `x-device-token` is no longer rejected 403 — the kiosk can now void a gift certificate with just the device token.
- The T-46-07 comment block in `authTiers.js` now records the D-54-GC reversal while explicitly preserving the "explicit list, not a `/api/kiosk/*` prefix" rationale for any future kiosk route.
- Device-token negative-scope coverage is intact and proven: PII GET `/api/contacts`, BrewPad GET `/api/batch/search-invoices`, and admin GET `/api/orders/recent` all still return 403 for a bare device token (unchanged, re-verified via full suite run).
- Both `isKioskRoute()` and `requireTiers()` function bodies are byte-unchanged — the auth-scope change is a pure allowlist-membership edit, confirming the void route's own inline handler (no `requireTiers` call, relies on the global guard) needed no code change.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add `/api/kiosk/gift-card/void` to KIOSK_ROUTES and correct the T-46-07 comment** - `e9a7aa4` (feat)
2. **Task 2: Flip the two device→403 void tests to not-403; keep all other negatives; dual-suite gate** - `df98cfb` (test)

**Plan metadata:** commit pending (this docs commit, made after this SUMMARY)

_Note: Task 2 is documented as a single `test` commit (not RED→GREEN) because the plan is `type: execute`, not `type: tdd` — the plan explicitly instructs flipping existing assertions to match the already-shipped Task 1 scope change, and Task 1 (the "GREEN" behavior) was already committed and verified working before Task 2's test edit._

## Files Created/Modified
- `zoho-middleware/lib/authTiers.js` - Added `/api/kiosk/gift-card/void` to `KIOSK_ROUTES` with an inline D-54-GC comment; rewrote the T-46-07 comment block to record the reversal while keeping the "explicit list, not a prefix" rationale for future routes.
- `zoho-middleware/__tests__/auth-tiers-guard.test.js` - Test (3) flipped from `toBe(403)` to `not.toBe(403)`; title/comment updated to name D-54-GC. Tests (4), (7a), (7b) untouched.
- `zoho-middleware/__tests__/pos-auth-tier.test.js` - Test (3) flipped from `toBe(403)` to `not.toBe(403)`; title/describe comment updated to name D-54-GC. Tests (4), (5), (6a/b), (7a/b), (8a/b/c) untouched.

## Decisions Made
- Followed the plan exactly for both D-54-GC (scope widening) and D-54-GC-a (test flip). No new decisions required — the plan's `<interfaces>` block gave exact insertion points and the pattern map (`54-PATTERNS.md`) gave exact line numbers, both of which matched the live code precisely.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. Both target tests failed with the expected pre-change assertion (`toBe(403)`, confirmed via a pre-Task-2 test run showing only test (3) failing in each file — a natural RED-style confirmation even though this plan is not `tdd="true"`), then passed cleanly after the flip.

## User Setup Required

None - no external service configuration required. This is a backend auth-scope change; no env vars, no Apps Script redeploy, no Railway config.

## Verification Evidence

- `grep "'/api/kiosk/gift-card/void'" zoho-middleware/lib/authTiers.js` → 1 match inside `KIOSK_ROUTES`.
- `cd zoho-middleware && npm test` → **77 suites / 1258 tests, all green.**
- `npm test` (frontend, repo root) → **54 suites / 955 tests, all green.**
- `npm run lint` → clean (`--max-warnings 0`).
- `grep -c "expect(res.status).toBe(403)"` → 3 matches remain in each test file (the untouched negatives: PII-GET, BrewPad-GET/admin-GET, and the fail-closed session-rejection test in `auth-tiers-guard.test.js`; BrewPad-GET + admin-GET in `pos-auth-tier.test.js`), confirming no negative-scope test was weakened.

## Next Phase Readiness

- Backend scope change is independently deployable and unblocks Plan 02 (the kiosk-native `kgcm-` lookup+void panel in `js/kiosk-core.js`), which depends on this route being device-token-reachable.
- No blockers. Plan 02 can proceed immediately; Plan 03 (regression test for the frontend panel) follows Plan 02.

---
*Phase: 54-gift-card-management-on-the-kiosk-surface*
*Completed: 2026-07-08*
