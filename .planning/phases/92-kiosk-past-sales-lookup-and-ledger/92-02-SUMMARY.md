---
phase: 92-kiosk-past-sales-lookup-and-ledger
plan: 02
subsystem: middleware
tags: [kiosk, past-sales, pure-lib, zoho]
requires: []
provides:
  - zoho-middleware/lib/kiosk-history.js pure helpers (classifier, Vancouver day, tender, slim builders, totals)
  - CACHE_KEYS.KIOSK_HISTORY_{LEDGER,CUSTOMER,INVOICE,TENDER}_PREFIX
affects: [92-03, 92-04]
key-files:
  created:
    - zoho-middleware/lib/kiosk-history.js
    - zoho-middleware/__tests__/kiosk-history-lib.test.js
  modified:
    - zoho-middleware/lib/constants.js
key-decisions:
  - "A-01 third source label 'other'; A-02 'Draft' status kept in ledger; A-03 debitcard->Card, unknown->Other; A-04 created_time bucketed to Vancouver day, fallback to date"
metrics:
  completed: 2026-10-16
---

# Phase 92 Plan 02: Kiosk past-sales helper lib Summary

Pure, I/O-free helper library for Past Sales: in-store/online/other classifier, America/Vancouver day bucketing (no hardcoded offset), tender and status labels, field-by-field D-12 allowlist builders, cents-exact void-excluded totals, plus versioned cache-key prefixes and a contract test guarding the money-path payment-note prefixes.

## Tasks

| Task | Commit |
|------|--------|
| 1 and 2 (combined, one commit) | b052dab1 |

## Deviations from Plan

- Tasks 1 and 2 were committed together as a single commit because both share one test file and one lib file; all behaviors of both tasks are covered by 24 passing tests (1 skipped: Node 24-only tzdata assertion).
- Reworded one comment in the lib so the plan's offset-grep acceptance check returns 0.

## Verification

- `kiosk-history-lib.test.js`: 24 passed, 1 skipped (Node 20).
- Root `npm test` and both lints pass.
- Middleware full suite: 2 failures in `__tests__/vancouver-timezone.test.js`, pre-existing and unrelated (local Node 20 lacks the BC permanent-time tzdata; known issue, prod runs Node 24). Not caused by this plan.

## Known Stubs

None.

## Self-Check: PASSED
