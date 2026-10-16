---
phase: 92-kiosk-past-sales-lookup-and-ledger
plan: 06
subsystem: kiosk-frontend
tags: [kiosk, past-sales, ledger, d-11]
requirements: [PSL-01, PSL-04, PSL-06, PSL-07]
key-files:
  modified:
    - js/kiosk-core.js
    - js/kiosk.js
    - js/kiosk-core.min.js
    - js/kiosk.min.js
    - kiosk.html
  created:
    - tests/frontend/kiosk-past-sales.test.js
metrics:
  tasks: 2
  completed: 2026-10-16
---

# Phase 92 Plan 06: Past Sales view lifecycle and Ledger tab Summary

Past Sales view in the kiosk frontend: Ledger tab (server-dated day, arrows, date jump, count/gross footer, void rows, tender), shared tap-to-expand detail with in-memory cache, bust-refresh, and D-11 clearing at the kioskShowView choke point plus the lock screen.

## Commits
- 79a0938d: Task 1 and wiring: kiosk-core.js Past Sales block, kiosk.js wiring and lock clear, tests
- 2ad83574: rebuilt kiosk-core.min.js, kiosk.min.js, restamped kiosk.html

## Details
- `kioskShowView` registers `past-sales`, calls `kioskPastSalesClear()` for any other name, and hides `#kiosk-past-sales-btn` in `browse-customer`; `kioskShowPastSales` refuses from Customer View.
- A generation counter makes responses arriving after a clear resolve to null and render nothing. All fetches go through `_kcMergeAuth` with `r.ok` checks.
- Day navigation uses only server `today`/`prev_date`/`next_date`; no client date maths.
- Footer: `N sales · $X` (local thousands-separator formatter; `kioskFmt` untouched) plus the `classification_incomplete` / `unclassified_count` notice. `truncated` and `tender_incomplete` notices go in the message area.
- `_kioskPsCustomerClear` / `_kioskPsCustomerRefresh` no-op hooks, and `kioskPsRowHtml` / `kioskPsToggleDetail` (shared detail) are in place for 92-07 to extend.
- No reprint/resend/refund/void controls (D-13); admin.html and js/admin.js untouched.
- Tests (19) load the real Past Sales markup from kiosk.html; kiosk-core-parity and kiosk-html-escaping still pass unchanged. Root `npm test` (2605) and `npm run lint` pass.

## Deviations from Plan
- **[Rule 3 - Blocking]** Added two additive test hooks to the kiosk.js `module.exports` (`_initKioskSaleTab`, `_showLockScreen`) so tests can exercise button wiring and the lock-screen clear; neither was exported before.
- `npm run build` restamped ~25 unrelated HTML files and rebuilt admin.js/admin.min.js (timestamp only). Only kiosk.html, kiosk-core.min.js and kiosk.min.js were committed; the rest was left uncommitted/reverted.
- Middleware `vancouver-timezone.test.js` fails on local Node 20 (pre-existing, known); no other middleware failures.
- The kiosk.js wiring was committed together with Task 1 (the wiring test needs both); Task 2's second commit holds only the build artifacts.

## Known Stubs
`_kioskPsCustomerClear` and `_kioskPsCustomerRefresh` are intentional no-ops until 92-07; the By customer panel is empty by design.

## Self-Check: PASSED
