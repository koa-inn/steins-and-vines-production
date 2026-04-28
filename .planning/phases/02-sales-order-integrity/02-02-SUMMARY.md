---
phase: 02-sales-order-integrity
plan: 02
subsystem: frontend
tags: [kiosk, error-handling, stock-display, void, receipt, ux]

# Dependency graph
requires:
  - phase: 02-sales-order-integrity/plan-01
    provides: backend void response with payment_voided and voided_transaction_id fields
provides:
  - full-screen void error display with transaction ID reference on both sale paths
  - post-sale product refresh via kioskLoadProducts(true) on receipt dismiss
  - negative stock number display for staff reorder decisions
affects: [kiosk UX, staff workflow]

# Tech tracking
tech-stack:
  added: []
  patterns: [extra param object for optional error context, if/else if stock label branching]

key-files:
  created: []
  modified:
    - kiosk.html
    - js/kiosk.js
    - js/kiosk.min.js

key-decisions:
  - "Only display opaque transaction ID (Ref: txnId) in error view -- no internal error messages or Zoho details (T-02-06 mitigation)"
  - "kioskLoadProducts(true) fires before view transition in Done handler so refresh starts immediately"
  - "Negative stock uses Math.round(stock) + ' in stock' label while keeping outOfStock flag and card dimming unchanged"

patterns-established:
  - "Extra param pattern: kioskShowError(title, msg, canRetry, extra) where extra is optional object with txnId"
  - "Void detection: check result.data.payment_voided before generic error fallback"

requirements-completed: [STOCK-03]

# Metrics
duration: 3min
completed: 2026-04-28
---

# Phase 02 Plan 02: Kiosk Frontend Void Error, Post-Sale Refresh, and Negative Stock Summary

**Full-screen void error with transaction ID, post-sale product refresh on receipt dismiss, and negative stock number display for staff reorder decisions**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-28T21:30:34Z
- **Completed:** 2026-04-28T21:33:40Z
- **Tasks:** 2
- **Files modified:** 3 (kiosk.html, js/kiosk.js, js/kiosk.min.js)

## Accomplishments
- kiosk.html error view now includes a `kiosk-error-detail` element for transaction ID display
- `kioskShowError` and `kioskShowSoError` accept optional 4th `extra` parameter with txnId
- Confirm flow and SO-pay flow error handlers detect `payment_voided` responses and show "Payment Voided" full-screen error with transaction reference
- Direct sale receipt Done button calls `kioskLoadProducts(true)` for immediate stock refresh
- SO-pay receipt Done button calls `kioskLoadProducts(true)` for immediate stock refresh
- Negative stock values display as actual numbers (e.g., "-3 in stock") instead of generic "Out of stock" while preserving card dimming

## Task Commits

Each task was committed atomically:

1. **Task 1: Error detail element + void scenario display** - `f6d5b9e` (feat) - kiosk.html element, kioskShowError/kioskShowSoError extra param, payment_voided detection in both flows
2. **Task 2: Post-sale refresh + negative stock + build** - `1c903c4` (feat) - kioskLoadProducts(true) in both Done handlers, negative stock label, rebuild kiosk.min.js

## Files Created/Modified
- `kiosk.html` - Added `kiosk-error-detail` paragraph element in error view, updated cache-busting stamps
- `js/kiosk.js` - Enhanced kioskShowError/kioskShowSoError with extra param, void detection in error handlers, product refresh on receipt dismiss, negative stock display
- `js/kiosk.min.js` - Rebuilt minified output

## Decisions Made
- Only display opaque transaction ID ("Ref: txnId") in error view -- no internal error messages, Zoho details, or stack traces shown (T-02-06 mitigation)
- `kioskLoadProducts(true)` fires as first line of Done handler so refresh starts immediately while view transitions
- Negative stock uses `Math.round(stock) + ' in stock'` label (e.g., "-3 in stock") while keeping `outOfStock` flag and `kiosk-product-stock--out` class unchanged for card dimming

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None - all data sources are wired and functional.

## Self-Check: PASSED

All files exist, all commits verified in git log.
