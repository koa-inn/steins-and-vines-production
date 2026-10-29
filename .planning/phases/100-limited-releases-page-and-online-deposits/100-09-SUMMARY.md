---
phase: 100-limited-releases-page-and-online-deposits
plan: 09
subsystem: kiosk
tags: [kiosk, deposits, zoho, ui]
requires: [100-08, 100-12]
provides:
  - GET /api/kiosk/salesorder-due (read-only deposit/remainder preview)
  - reference_number and is_limited_release on the kiosk SO list
  - kiosk deposit badge and remainder display
key-files:
  modified:
    - zoho-middleware/routes/pos.js
    - zoho-middleware/lib/authTiers.js
    - js/kiosk-core.js
    - js/kiosk-core.min.js
    - kiosk.html
  created:
    - zoho-middleware/__tests__/kiosk-salesorder-due.test.js
    - tests/frontend/kiosk-limited-release-deposit.test.js
decisions:
  - "Non-limited orders keep the original synchronous salesorder-pay fetch (existing idempotency tests require it); only limited-release SOs wait on the preview"
metrics:
  tasks: 2
  completed: 2026-10-29
---

# Phase 100 Plan 09: Kiosk deposit display Summary

Kiosk order book marks limited-release SOs "Limited release · $50 deposit held", and the payment screen shows the real remainder from a read-only `GET /api/kiosk/salesorder-due` that reuses `computeSalesOrderAmountDue`; the pay route still recomputes.

## Commits
- Task 1: d7083785 preview route, SO list fields, authTiers allowlist (kiosk tiers, 401 without credential)
- Task 2: 1566cc2e kiosk-core badge + preview + success-screen deposit row, rebuilt kiosk-core.min.js

## Verification
Middleware 272 suites / 3861 tests green; frontend 236 suites / 3280 tests green; lint clean. Preview proven to make zero zohoPost/zohoPut calls. Fixture test: total 280, advance 50 gives due 230.

## Deviations from Plan
- Worktree base was behind the expected commit; reset to 13d131fe per startup check.
- kiosk.html restamp committed (not in the plan's files list) so it references the new kiosk-core build. All other build restamps were reverted.
- If preview fails the pay POST still proceeds (T-100-48); cancelling during the preview skips the pay POST.
- Assumption: Zoho list rows include `reference_number`; not verified against live Zoho (no calls allowed). The pay and preview routes read the full SO, so only the badge depends on it.

## Known Stubs
None.

## Self-Check: PASSED
