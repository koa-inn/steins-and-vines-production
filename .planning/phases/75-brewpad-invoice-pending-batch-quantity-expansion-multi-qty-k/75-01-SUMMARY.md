---
phase: 75-brewpad-invoice-pending-batch-quantity-expansion-multi-qty-k
plan: 01
subsystem: api
tags: [zoho, brewpad, batch-tracking, apps-script, dedup-guard, express]

# Dependency graph
requires: []
provides:
  - "POST /api/batch/bulk-create now expands multi-qty kit lines into fee-slot-capped batch units via planKitBatches (D-04) instead of a raw kitBatchQuantity loop"
  - "unit_total is computed server-side per (invoice, SKU) and set on every Apps Script create_batch payload, feeding the existing count-based dedup guard"
  - "Regression suite (batch-scan-invoices.test.js) with a realistic in-test Apps Script dedup-guard mock reproducing INV-000171 (3-create, converge-from-1, idempotent re-run, fee-slot cap)"
affects: [brewpad-integration, batch-tracking, apps-script-create-batch]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "bulk-create route now mirrors createBatchesFromSale's planKitBatches + unitTotalBySku pattern instead of re-implementing kit expansion"

key-files:
  created: []
  modified:
    - zoho-middleware/routes/pos.js
    - zoho-middleware/__tests__/batch-scan-invoices.test.js

key-decisions:
  - "Did NOT extract a shared payload-building helper between createBatchesFromSale and the bulk-create route (planner discretion, locked in plan) — keeps this fix confined to the one broken route per CLAUDE.md 'don't touch unrelated code'"
  - "Kept the existing early detectKitItems() no_kit_items gate in bulk-create; planKitBatches is called afterward for the fee-slot-capped expansion, with its own empty-array no_kit_items fallback"
  - "Added planKitBatches to the shared jest mock for brewpad-integration with a default expansion (detectKitItems x kitBatchQuantity, no cap) so all 27 pre-existing bulk-create/scan-invoices tests kept passing unmodified once pos.js started calling it; only the new regression tests override it explicitly to exercise fee-slot capping"

requirements-completed: [OWNER-BUG-20260825]

# Metrics
duration: ~10min
completed: 2026-08-26
---

# Phase 75 Plan 01: BrewPad invoice→pending-batch quantity expansion Summary

**Ported the already-fixed INV-000137 sale-path unit_total fix to the bulk-create route: `POST /api/batch/bulk-create` now expands kit lines via `planKitBatches` (fee-slot-capped, D-04) and sets `unit_total` per (invoice, SKU) on every Apps Script create_batch payload, so a paid qty-3 kit line (INV-000171) creates exactly 3 pending batches instead of collapsing to 1.**

## Performance

- **Duration:** ~10 min (task-commit span; excludes upfront reading/research)
- **Completed:** 2026-08-26
- **Tasks:** 2/2 completed
- **Files modified:** 2

## Accomplishments

- Regression suite reproduces INV-000171 with a realistic (not unconditional-stub) Apps Script dedup-guard mock — count-based on (zoho_so_number, product_sku), matching `apps-script/adminApi.gs:1986-2014` exactly
- `pos.js` bulk-create handler now calls `brewpadIntegration.planKitBatches(lineItems)` instead of looping raw `kitBatchQuantity` per kit item, applying the same fee-slot cap (D-04) the sale path already uses
- `unit_total` is computed server-side from the re-fetched Zoho invoice (`unitTotalBySku`) and set on every batch create payload — never read from `req.body` (T-75-01)
- Full middleware suite (1449 tests / 93 suites) + full frontend suite (1134 tests / 82 suites) + both lint configs all green after the fix

## Task Commits

Each task was committed atomically:

1. **Task 1: Write failing regression tests (realistic dedup-guard mock + INV-000171 fixture)** - `8d9e4f29` (test)
2. **Task 2: Fix bulk-create — set unit_total + use planKitBatches (D-01/D-02/D-04)** - `75a91d0c` (fix)

**Plan metadata:** _pending — this commit_ (docs: complete plan)

## Files Created/Modified

- `zoho-middleware/routes/pos.js` — bulk-create handler: replaced the raw per-kit-item `kitBatchQuantity` loop (L3266-3293 pre-fix) with a `planKitBatches`-driven expansion; added `unitTotalBySku` computation and `unit_total` on every `batchPayload`
- `zoho-middleware/__tests__/batch-scan-invoices.test.js` — added `planKitBatches` to the shared `brewpad-integration` mock (default expansion for backward compat) and a new describe block `POST /api/batch/bulk-create unit_total regression (INV-000171)` with Tests A-D

## Decisions Made

- No shared-helper extraction between `createBatchesFromSale` and the bulk-create route — this was a locked planner decision in the plan itself (aligns with RESOLVED RESEARCH Open Question 2), not a new deviation. Recorded here for traceability only.
- Kept `detectKitItems()`'s existing early `no_kit_items` gate in the handler (unchanged from pre-fix) rather than replacing it entirely with `planKitBatches`'s own empty check, since the plan's read_first/action notes described adding a `planKitBatches`-driven expansion "after" the existing kit-item detection, and no test exercises removing the original gate.

## Deviations from Plan

None — plan executed exactly as written. The mock-infrastructure change to `batch-scan-invoices.test.js` (wrapping the `jest.mock('../lib/brewpad-integration', ...)` factory body in a `mockModule` variable to add `planKitBatches`) was explicitly anticipated by the plan's Task 1 `read_first`/`action` instructions (mirror `createBatchesFromSale`'s shape; the mock needed a `planKitBatches` entry point for the route to call), not an unplanned bug fix or missing-functionality addition.

## Issues Encountered

None. The `zoho-middleware/node_modules` and root `node_modules` were absent in this worktree (fresh git worktree, gitignored deps) — ran `npm ci` in both locations to restore the exact locked dependency trees before running any test/lint command. This is tooling setup, not a code change, and nothing was committed for it (`node_modules` remains gitignored).

## User Setup Required

None - no external service configuration required. This phase makes no Apps Script (`apps-script/*.gs`) changes and requires no redeploy — the dedup guard being fed is already deployed and unchanged.

## Owner Operational Follow-up (not part of this plan's code scope)

Per the plan's locked, revised D-01: after this fix deploys to prod middleware, the owner performs a one-time manual backfill for the single pre-fix invoice — re-import INV-000171 once via single-invoice mode (`GET /api/batch/scan-invoices?number=INV-000171` → Create Batches) and confirm BrewPad shows exactly 3 batches for the line, with a 4th re-run creating none. This exercises the live Apps Script guard end-to-end (mocked in this plan's tests). The date-window scan's `alreadyHasBatch` skip filter (`pos.js:3156-3160`) was intentionally left unmodified this phase.

## Next Phase Readiness

- The bulk-create route is now behaviorally aligned with the sale path (`createBatchesFromSale`) for multi-qty kit line expansion and dedup convergence — no further code changes anticipated for this bug.
- Blocker: none. The owner's live INV-000171 re-import backfill (above) is a post-deploy operational step, not a code dependency for future phases.

---
*Phase: 75-brewpad-invoice-pending-batch-quantity-expansion-multi-qty-k*
*Completed: 2026-08-26*

## Self-Check: PASSED

- FOUND: zoho-middleware/routes/pos.js
- FOUND: zoho-middleware/__tests__/batch-scan-invoices.test.js
- FOUND: this SUMMARY.md
- FOUND commit: 8d9e4f29 (Task 1 - test)
- FOUND commit: 75a91d0c (Task 2 - fix)
- FOUND commit: 602ce6b4 (docs - this SUMMARY)
