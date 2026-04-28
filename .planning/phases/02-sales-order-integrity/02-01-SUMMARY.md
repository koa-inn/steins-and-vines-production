---
phase: 02-sales-order-integrity
plan: 01
subsystem: api
tags: [zoho, tax, invoice, pos, kiosk, sales-order]

# Dependency graph
requires:
  - phase: 01-catalog-stock-display
    provides: kiosk product catalog with tax_id/tax_percentage in cache
provides:
  - per-item tax_id on invoice line items for both direct sale and confirm endpoints
  - SO-to-Invoice conversion in salesorder-pay endpoint for stock deduction
  - KIOSK_TAX_RATE fallback for items without tax configuration
affects: [02-sales-order-integrity plan 02, kiosk frontend]

# Tech tracking
tech-stack:
  added: []
  patterns: [per-item tax via catalog tax_id, non-fatal SO-to-Invoice chain, per-item tax computation with fallback]

key-files:
  created:
    - zoho-middleware/__tests__/pos-tax.test.js
  modified:
    - zoho-middleware/routes/pos.js

key-decisions:
  - "tax_id read from server-side catalogMap only, never from request body (T-02-01 mitigation)"
  - "Invoice creation from SO is non-fatal -- SO is paid even if invoice fails (Pitfall 3)"
  - "KIOSK_TAX_RATE kept as fallback for items with no tax_id and no tax_percentage (D-04)"
  - "Confirm endpoint tax computation accounts for discount-adjusted line totals"

patterns-established:
  - "Per-item tax: li.tax_id = catalogItem.tax_id when truthy, omit when empty"
  - "Non-fatal Zoho chain: promise.catch logs error, continues to response"
  - "SO-to-Invoice: zohoPost fromsalesorder then submit, bust products cache"

requirements-completed: [SO-01, SO-02, SO-03]

# Metrics
duration: 5min
completed: 2026-04-28
---

# Phase 02 Plan 01: Per-Item Tax and SO-to-Invoice Summary

**Per-item tax_id on kiosk invoice line items replacing flat 5% rate, plus SO-to-Invoice conversion for stock deduction on all payment paths**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-28T21:22:30Z
- **Completed:** 2026-04-28T21:27:23Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Both processSale and /api/kiosk/sale/confirm include per-item tax_id from catalog cache on invoice line items
- Terminal charge amount computed using per-item tax_percentage with KIOSK_TAX_RATE fallback
- salesorder-pay endpoint creates Invoice from SO via /invoices/fromsalesorder and submits it for stock deduction
- Kiosk products cache busted after SO-pay invoice creation for immediate stock refresh
- 8 regression tests covering per-item tax behavior and SO-to-Invoice conversion

## Task Commits

Each task was committed atomically:

1. **Task 1: Replace flat tax with per-item tax_id** (TDD)
   - RED: `5a250e0` (test) - 6 failing tests for per-item tax behavior
   - GREEN: `0d57bbf` (feat) - per-item tax_id implementation in both endpoints
2. **Task 2: Add SO-to-Invoice conversion** - `189ee2a` (feat) - SO-to-Invoice chain + 2 tests

## Files Created/Modified
- `zoho-middleware/__tests__/pos-tax.test.js` - 8 tests for per-item tax and SO-to-Invoice behavior
- `zoho-middleware/routes/pos.js` - per-item tax_id on line items in processSale and confirm, SO-to-Invoice in salesorder-pay

## Decisions Made
- tax_id read from server-side catalogMap only, never from request body (threat T-02-01 mitigation)
- Invoice creation from SO is non-fatal per Pitfall 3 from research -- SO is paid even if invoice fails
- KIOSK_TAX_RATE kept as fallback for items with no tax_id and no tax_percentage (D-04)
- Confirm endpoint per-item tax computation accounts for discount-adjusted line totals (not just raw rate * qty)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None - all data sources are wired and functional.

## Next Phase Readiness
- Backend tax and invoice conversion complete, ready for plan 02 (frontend error handling, stock refresh, negative stock display)
- Per-item tax computation is server-authoritative; frontend estimate may differ slightly (documented in Pitfall 2 from research)

---
*Phase: 02-sales-order-integrity*
*Completed: 2026-04-28*
