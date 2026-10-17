---
phase: 93-kiosk-ledger-week-and-month-views
plan: 01
subsystem: zoho-middleware
tags: [kiosk, past-sales, pure-helpers, tdd]
requires: []
provides:
  - weekStart, monthStart, monthEnd, periodBounds
  - inDayQueryWindow, paymentInDayWindow, invoiceBelongsToDay
  - needsPaymentNotes, ledgerRowsForDay
affects: [93-02]
tech-stack:
  added: []
  patterns: [string-only date arithmetic, classify-derived predicate]
key-files:
  created:
    - zoho-middleware/__tests__/kiosk-history-range-lib.test.js
  modified:
    - zoho-middleware/lib/kiosk-history.js
decisions:
  - needsPaymentNotes derived from classify itself so it cannot drift (D-12 refinement)
metrics:
  completed: 2026-10-17
requirements: [PSL-09, PSL-10]
---

# Phase 93 Plan 01: Range helpers Summary

Pure ES5 helpers for Mon-Sun week / calendar month bounds, day-window predicates, a classify-derived `needsPaymentNotes`, and the shared `ledgerRowsForDay` chain, exported from `zoho-middleware/lib/kiosk-history.js`.

## Tasks

| Task | Status | Commit |
| ---- | ------ | ------ |
| 1. Add PSL-08..PSL-15 to ROADMAP | completed by orchestrator (8f37bd6e) | 8f37bd6e |
| 2. Helpers (TDD) | done | RED 54ad2c8c, GREEN d4384785 |

## Verification

- `kiosk-history` suites: 6 passed (117 passed, 2 skipped Node-24-gated).
- Full middleware suite: only the known Node 20 `vancouver-timezone.test.js` failures.
- Frontend suite: 202 suites passed. Lint clean.
- No existing test file modified.

## Deviations from Plan

- The worktree base was not 8f37bd6e at start; reset to it per the branch-check instructions.
- `buildLedger` in the route was not refactored to call `ledgerRowsForDay` (not in this plan's scope; 93-02 owns that).

## Known Stubs

None.

## Self-Check: PASSED
