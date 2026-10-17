---
phase: 93-kiosk-ledger-week-and-month-views
plan: 02
subsystem: zoho-middleware
tags: [kiosk, past-sales, range-route, tdd]
requires: [93-01]
provides:
  - GET /api/kiosk/past-sales/range (week|month per-day summary)
  - buildLedger on hist.ledgerRowsForDay
affects: [93-03, 93-04]
key-files:
  created:
    - zoho-middleware/__tests__/kiosk-history-range.test.js
  modified:
    - zoho-middleware/routes/kiosk-history.js
    - zoho-middleware/lib/constants.js
    - zoho-middleware/lib/authTiers.js
decisions:
  - Range cache key uses the nominal period start so any anchor in a period shares one build
  - Payments fetch skipped only when no in-window invoice needsPaymentNotes
metrics:
  completed: 2026-10-17
requirements: [PSL-08, PSL-09, PSL-10, PSL-13, PSL-14]
---

# Phase 93 Plan 02: Range route Summary

Capped, cached, self-gated `GET /api/kiosk/past-sales/range?type=week|month[&date][&bust]` returning one zero-filled row per day (newest first) built through the same `ledgerRowsForDay` chain as the day ledger, so per-day figures equal `/ledger` (proven by a fixture test).

## Tasks

| Task | Commit |
| ---- | ------ |
| 1. buildLedger refactor, range cache key, allowlist entry, caps | b67f3be8 |
| 2. RED tests | 307ebb96 |
| 2. GREEN buildRange + route | 2d4d3475 |

## Verification

- `kiosk-history*` suites: 150 passed, 2 skipped (Node-24-gated). No existing test file edited.
- Frontend `npm test`: 203 suites passed. `npm run lint` clean.
- Middleware full suite: only the 2 known Node 20 `vancouver-timezone.test.js` failures (pre-existing).

## Deviations from Plan

- Worktree base was not 85f581d3 at start; reset to it per the branch check (tree was clean).
- The day ledger now also applies the invoice/payment `date` window filters inside `ledgerRowsForDay` (previously only `createdDay === day`). This is the intended D-12 unification; existing tests pass unchanged.

## Smell surfaced (not fixed)

`buildCustomer` skips payments only for `/^\d+$/` references, narrower than `classify`, so a non-digit reference with an in-store payment note is labelled 'other' in customer history but in-store in the ledger. `hist.needsPaymentNotes` would be the consistent predicate.

## Known Stubs

None.

## Self-Check: PASSED
