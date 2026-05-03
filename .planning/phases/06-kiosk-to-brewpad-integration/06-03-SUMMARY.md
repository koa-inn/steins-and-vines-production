---
phase: 06-kiosk-to-brewpad-integration
plan: 03
subsystem: ui
tags: [vanilla-js, css, brewpad, status-badge, kiosk-badge, filter, unit-tests]

# Dependency graph
requires:
  - phase: 05-auth-reliability
    provides: BrewPad IIFE structure, module.exports pattern, pure helper pattern
  - phase: 06-kiosk-to-brewpad-integration (plans 01-02)
    provides: Batch source/status/zoho_so_number fields from Apps Script and middleware
provides:
  - Pending status badge rendering (neutral grey) in batch list
  - Kiosk source badge rendering (blue-slate, pending-only) in batch list
  - Pending filter button in BrewPad filter bar
  - Zoho Ref row in batch detail view
  - shouldShowKioskBadge pure helper function (exported, tested)
  - Custom empty state for pending filter
affects: [07-zoho-audit-trail]

# Tech tracking
tech-stack:
  added: []
  patterns: [status-badge--neutral CSS variant, conditional badge rendering with pure helper]

key-files:
  created:
    - tests/frontend/brewpad-pending.test.js
  modified:
    - css/brewpad.css
    - js/brewpad.js
    - css/brewpad.min.css
    - js/brewpad.min.js
    - brewpad.html

key-decisions:
  - "Neutral warm grey for Pending badge (not amber/warning) to avoid semantic collision with Secondary fermentation status"
  - "shouldShowKioskBadge defined outside IIFE for testability and export, matching existing pure helper pattern"
  - "Custom empty state for Pending filter only, using existing _batchStatusFilter check (no new system)"

patterns-established:
  - "Conditional badge rendering via exported pure helper function (shouldShowKioskBadge)"
  - "Status badge color variants: --neutral for non-urgent states needing attention"

requirements-completed: [INTG-02, INTG-03]

# Metrics
duration: 5min
completed: 2026-05-03
---

# Phase 6 Plan 3: BrewPad Pending Status and Kiosk Badge UI Summary

**Pending batch status badge (neutral grey), Kiosk source badge (blue-slate, pending-only), Pending filter button, Zoho Ref in detail view, and shouldShowKioskBadge tested with 6 unit test cases**

## Performance

- **Duration:** 5 min
- **Started:** 2026-05-03T21:30:22Z
- **Completed:** 2026-05-03T21:35:30Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- BrewPad batch list renders Pending status with a neutral warm grey badge distinct from existing amber/warning (Secondary) status
- Kiosk source badge ("Kiosk" in blue-slate) appears in both table and card views only for kiosk-sourced batches still in pending status (per D-11)
- Pending filter button added as first option in the filter bar for fast access to newly auto-created batches
- Batch detail view conditionally shows "Zoho Ref" row when zoho_so_number is present (per D-12)
- shouldShowKioskBadge pure helper exported and tested with 6 test cases covering all badge visibility conditions

## Task Commits

Each task was committed atomically:

1. **Task 1: Add CSS rules and JS modifications** - `7b85147` (feat)
2. **Task 2: Add frontend unit tests and run build** - `7528bbe` (test)

## Files Created/Modified
- `css/brewpad.css` - Added .bp-status-badge--neutral and .bp-kiosk-badge CSS rules
- `js/brewpad.js` - Added pending to STATUS_LABELS/STATUS_COLORS, Pending filter option, Kiosk badge in table+card views, Zoho Ref in detail view, shouldShowKioskBadge helper, custom empty state
- `tests/frontend/brewpad-pending.test.js` - 6 test cases for shouldShowKioskBadge (true/false/edge cases)
- `css/brewpad.min.css` - Rebuilt with new CSS rules
- `js/brewpad.min.js` - Rebuilt with new JS
- `brewpad.html` - Cache version stamp updated

## Decisions Made
- Used neutral warm grey (rgba(154,134,114,0.10) + var(--ink-secondary)) for Pending badge instead of warning amber, which is already used by Secondary fermentation status. This avoids semantic collision per UI-SPEC decision.
- Placed shouldShowKioskBadge outside the IIFE (like all other exported pure helpers: escapeHTML, fmtDate, filterBatchesByStatus, etc.) so it can be tested via require().
- Added custom empty state message for pending filter ("No pending batches / Kiosk sales with Maker's Fee will appear here automatically") using existing _batchStatusFilter check without introducing a new empty state framework.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed smart quote syntax error in empty state string**
- **Found during:** Task 2 (running tests)
- **Issue:** The empty state string for pending filter used Unicode curly/smart quotes (U+2018/U+2019) as JS string delimiters instead of ASCII single quotes, causing Babel parser to fail
- **Fix:** Replaced smart quotes with ASCII single quotes and used HTML entity &#39; for the apostrophe in "Maker's Fee"
- **Files modified:** js/brewpad.js
- **Verification:** All 270 frontend tests pass after fix
- **Committed in:** 7528bbe (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Single character-encoding fix necessary for test suite to parse the file. No scope creep.

## Issues Encountered
None beyond the smart quote bug documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- BrewPad frontend is ready to display pending batches from kiosk sales once plans 06-01 (Apps Script) and 06-02 (middleware) are complete
- All UI elements (badges, filter, detail view) will work as soon as batch data includes source, status=pending, and zoho_so_number fields
- Phase 7 (Zoho Audit Trail) can build on the Zoho Ref display added in this plan

## Self-Check: PASSED

All 6 created/modified files exist. Both task commits (7b85147, 7528bbe) verified in git log. SUMMARY.md exists.

---
*Phase: 06-kiosk-to-brewpad-integration*
*Completed: 2026-05-03*
