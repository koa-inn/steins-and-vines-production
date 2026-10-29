---
phase: 100-limited-releases-page-and-online-deposits
plan: 05
subsystem: zoho-middleware
tags: [zoho, deposits, sales-orders, limited-releases]
requires: [100-02, 100-03, 100-04]
provides:
  - lib/limited-releases-deposit.js (sole sanctioned salesorders_to_apply use)
  - salesorders-to-apply-guard repo-scan test
affects: [100-06, 100-07, 100-08, 100-09]
tech-stack:
  added: []
  patterns: [lazy-getter deps, zohoPostOnce for creates, best-effort cleanup returning leftovers]
key-files:
  created:
    - zoho-middleware/lib/limited-releases-deposit.js
    - zoho-middleware/__tests__/limited-releases-deposit.test.js
    - zoho-middleware/__tests__/salesorders-to-apply-guard.test.js
  modified:
    - zoho-middleware/lib/money-path.js
key-decisions:
  - "Deposit link is the payment description 'LIMITED-2026-27 deposit <SO number> (Helcim <txn>)'; lookup matches it with a digit-boundary regex so SO-000082 never matches SO-000820"
  - "reference_number on the payment is the plain Helcim txn id (duplicates accepted per LV6)"
  - "cleanupDepositSet takes an optional second arg txnId for log lines only"
metrics:
  tasks: 2
  completed: 2026-10-29
---

# Phase 100 Plan 05: Limited-release deposit library Summary

One guarded file books limited-release deposits as Zoho advances: per-kit SO (kit at live rate + MAKERS-FEE + MAT-FEE), one $50 advance per SO, all-or-nothing creation with payment-then-SO cleanup, and an advance lookup for brew day.

## Commits
- 86a7f4eb: lib, Task 1 tests, money-path cross-reference comment
- 817c74e8: createDepositSet/cleanupDepositSet tests and the repo-scan guard (the functions themselves were written in the first commit)

## Spike-driven choices
- description (not notes) carries the SO link; payment notes are dropped by Zoho (LV6).
- Lookup: GET /customerpayments?customer_id=&search_text=<SO number>, filter on description + unused_amount > 0, then GET /customerpayments/{id} for a fresh unused_amount.
- One payment per SO (LV10). Cleanup: DELETE payment, DELETE SO, fallback POST /salesorders/{id}/status/void (LV8).

## Guard proof
Appending a code line containing salesorders_to_apply to routes/checkout.js made the guard fail; reverted. Guard passes on the clean tree. No non-comment occurrences exist elsewhere.

## Verification
Middleware suite 266 suites / 3779 tests green on Node 24; root lint clean. Phase 71 ban tests and money-path tests unedited and green. Frontend `npm test` not run (no frontend files touched).

## Deviations from Plan
- [Rule 3] Worktree base was behind the expected commit; reset to 159d39e2 per the startup check. node_modules installed with npm ci.
- Task 1 commit also contains createDepositSet/cleanupDepositSet (single module written at once); Task 2 commit holds their tests and the guard. Tests were written after the code rather than strictly test-first.

## Notes for downstream plans
- Fee SO lines carry no tax_id; Zoho applies item taxes (LV9 shows fees taxed at 5%/12%).
- createDepositSet errors carry created[], possibleOrphan, failedStep; the route decides on the staff alert.
- pos.js may import only findDepositAdvanceForSalesOrder / isLimitedReleaseSalesOrder (enforced by guard).

## Known Stubs
None.

## Self-Check: PASSED
