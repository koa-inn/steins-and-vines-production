---
phase: 07-zoho-audit-trail
plan: 02
subsystem: database
tags: [apps-script, google-sheets, batch-tracking, fermentation, lifecycle]

# Dependency graph
requires:
  - phase: 07-zoho-audit-trail
    provides: Phase 7 research and context establishing batch lifecycle date column approach
provides:
  - updateBatch supports 11 fields (was 5) including zoho_so_number, customer_id, customer_name, product_name, fermentation_started_at, completed_at
  - updateBatch writes fermentation_started_at=now on pending-to-non-pending status transition
  - handlePackagingCompletion writes completed_at=timestamp on batch completion
  - createBatch appendRow extended to 24 columns with lifecycle date placeholders
affects: [07-zoho-audit-trail, brewpad-frontend, lifecycle-timeline]

# Tech tracking
tech-stack:
  added: []
  patterns: [apps-script-lifecycle-timestamps, pending-to-active-transition-guard]

key-files:
  created: []
  modified:
    - apps-script/adminApi.gs

key-decisions:
  - "fermentation_started_at is written inside updateBatch (not updateBatchSchedule) because status transitions happen via updateBatch when staff clicks the status badge"
  - "completed_at uses the existing timestamp variable in handlePackagingCompletion for consistency with last_updated"
  - "createBatch writes fermentation_started_at as empty string for pending batches; uses payload.start_date or now for active batches"

patterns-established:
  - "Pattern: lifecycle timestamp columns (fermentation_started_at, completed_at) use headers.indexOf() for safe column lookup — writes are no-ops if the column hasn't been added to the sheet yet"
  - "Pattern: pending-to-active guard uses oldStatus === 'pending' check inside existing status transition block, reusing the already-declared oldStatus variable"

requirements-completed: [ZOHO-01, ZOHO-03]

# Metrics
duration: 15min
completed: 2026-05-04
---

# Phase 7 Plan 02: Zoho Audit Trail — Apps Script Batch Lifecycle Extension

**Apps Script updateBatch extended to 11 allowed fields with fermentation_started_at auto-write on pending-to-active transition; handlePackagingCompletion writes completed_at; createBatch appendRow extended to 24 columns**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-05-04T22:10:00Z
- **Completed:** 2026-05-04T22:25:00Z
- **Tasks:** 2 (committed as 1 atomic commit covering both tasks)
- **Files modified:** 1

## Accomplishments

- Extended `updateBatch` `allowedFields` from 5 to 11 fields: adds `zoho_so_number`, `customer_id`, `customer_name`, `product_name`, `fermentation_started_at`, `completed_at` — enabling manual invoice linking (ZOHO-01) and lifecycle date overrides
- Added `fermentation_started_at` auto-write in `updateBatch`: when `oldStatus === 'pending'` and `updates.status` is set, the column is written with the current ISO timestamp — fires when staff clicks the status badge to activate a pending (kiosk-created) batch
- Extended `createBatch` `appendRow` from 22 to 24 elements: `fermentation_started_at` (col 23, empty for pending / `start_date` or `now` for active) and `completed_at` (col 24, always empty at creation) — preserves column alignment when the Batches sheet header is extended
- Added `completed_at` write in `handlePackagingCompletion`: uses the existing `timestamp` variable written alongside `last_updated` and `status=complete` — provides the lifecycle completion timestamp required by the ZOHO-03 timeline

## Task Commits

Both tasks affected only `adminApi.gs` and were committed atomically:

1. **Task 1: Extend updateBatch allowedFields, fermentation_started_at write, createBatch appendRow** - `3b991c1` (feat)
2. **Task 2: Write completed_at in handlePackagingCompletion** - included in `3b991c1` (same file, same commit)

## Files Created/Modified

- `apps-script/adminApi.gs` - Extended updateBatch allowedFields (line ~1881), added fermentation_started_at write on pending transition (line ~1910), extended createBatch appendRow to 24 columns (line ~1717), added completed_at write in handlePackagingCompletion (line ~2279)

## Decisions Made

- Combined Task 1 and Task 2 into a single atomic commit since both changes affect only `adminApi.gs` and are logically related (batch lifecycle date column writes). No regression tests to run (Apps Script has no test suite — verified by code review only per plan spec).
- Used the preferred approach for `fermentation_started_at`: inserted logic inside the existing `if (updates.status !== undefined)` block, reusing the already-declared `oldStatus` variable, rather than adding a second standalone `if` block.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

**Batches sheet header extension (required before deploying Apps Script):**

The Batches sheet header row must have two new columns added manually in Google Sheets before the deployed Apps Script version goes live:
- Column 23 header: `fermentation_started_at`
- Column 24 header: `completed_at`

The code is safe to deploy without these columns (all writes use `headers.indexOf()` — returns -1 if column is absent, causing the write to be skipped silently). However, new batches created by `createBatch` will have data in wrong columns if `appendRow` has 24 elements but the sheet only has 22 headers.

**Apps Script redeployment required:** After committing this change, the Apps Script must be redeployed as a new version in the Apps Script editor (Deploy → Manage deployments → New version). Until redeployed, the live endpoint serves the previous version.

## Next Phase Readiness

- Plan 07-03 (BrewPad frontend: timeline, link-to-invoice button, sync indicator) can proceed — the date columns and updateBatch fields it depends on are now in place
- Plan 07-01 (Middleware sync endpoint) can proceed independently — no dependency on Apps Script date columns
- Both plans should be preceded by the user adding `fermentation_started_at` and `completed_at` to the Batches sheet header

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries introduced. The `allowedFields` whitelist in `updateBatch` is the tamper control for T-07-06 (verified present). New fields pass through the existing `sanitizeInput(String(updates[field]))` call — no bypass path.

## Self-Check: PASSED

- FOUND: `.planning/phases/07-zoho-audit-trail/07-02-SUMMARY.md`
- FOUND: commit `3b991c1`
- `fermentation_started_at` count: 4 (>= 4 required)
- `completed_at` count: 8 (>= 4 required)

---
*Phase: 07-zoho-audit-trail*
*Completed: 2026-05-04*
