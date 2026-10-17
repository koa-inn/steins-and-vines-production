---
phase: 93-kiosk-ledger-week-and-month-views
plan: 03
subsystem: ui
tags: [kiosk, past-sales, ledger, vanilla-js, jest]

requires:
  - phase: 93-02
    provides: "/api/kiosk/past-sales/range response contract (mocked in tests)"
provides:
  - "Day/Week/Month chips on the kiosk Ledger tab"
  - "Range load/render with per-day rows, adaptive date-bar label, footer, truncation and partial handling"
affects: [93-04]

tech-stack:
  added: []
  patterns: ["Shared _kioskPsLedgerSeq counter invalidates stale day and range responses", "Date labels computed from YYYY-MM-DD strings via Date.UTC, never string-parsed Dates"]

key-files:
  created: [tests/frontend/kiosk-past-sales-range.test.js]
  modified: [kiosk.html, css/kiosk.css, css/kiosk.min.css, js/kiosk-core.js, js/kiosk.js, js/kiosk-core.min.js, js/kiosk.min.js]

key-decisions:
  - "setMode('day') also nulls _kioskPsRange so a later tab switch does not reuse stale range data"
  - "Loading message month name comes from anchor, else loaded range period_start, else ledger today, else 'this week/month'"

requirements-completed: [PSL-11, PSL-14, PSL-15]

duration: 25min
completed: 2026-10-17
---

# Phase 93 Plan 03: Kiosk Ledger Week/Month UI Summary

Ledger tab now offers Day / Week / Month chips with per-day rows, adaptive date-bar label, server-anchor stepping, date-input period jump, and a truncation-aware footer, all driven by the 93-02 range contract.

## Tasks

1. Markup and styles (chips, range label, back link, day-row CSS): e1a54704
2. TDD: RED test cb1f62d8 (19 of 20 failing), GREEN 74090474 (kiosk-core.js, kiosk.js, rebuilt min files)

## Verification

- New suite: 20 tests pass. Full `npm test`: 203 suites pass. `npm run lint`: 0 warnings.
- Existing test files untouched (only the new test file added).
- Middleware suite not run: no middleware files changed (middleware node_modules absent in worktree).

## Deviations from Plan

None - plan executed as written. The back link element (`#kiosk-ps-backlink`) is markup only; wiring is 93-04.

## Build churn left unstaged

`npm run build` restamped about, admin, beer, brewpad, contact, custom-labels, index, ingredients, privacy, products, refunds, reservation, terms, warranty, wine HTML, products/*.html, and rebuilt js/admin.js and js/admin.min.js; all were reverted with `git checkout --`. main.js/main.min.js did not change. links.html not touched. kiosk.html (restamp included) was committed as a plan file.

## Known Stubs

None.

## Self-Check: PASSED

Files and commits e1a54704, cb1f62d8, 74090474 verified present.
