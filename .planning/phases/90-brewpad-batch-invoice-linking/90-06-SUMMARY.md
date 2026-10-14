---
phase: 90-brewpad-batch-invoice-linking
plan: 06
subsystem: ui
tags: [brewpad, invoice-link, unlinked-filter, vanilla-js, jest]
requires: [90-03]
provides:
  - filterBatchesByUnlinked, isBatchSourceEditable, shouldShowInternalBadge (top-level, exported)
  - Unlinked (n) chip with live count and empty state
  - Possible invoices review section in unlinked batch detail
  - linkBatchToInvoice (zoho_so_number only), markBatchSource
affects: [90-09, 90-10, 90-11]
key-files:
  created:
    - tests/frontend/brewpad-unlinked-filter.test.js
    - tests/frontend/brewpad-link-review.test.js
  modified:
    - js/brewpad.js
    - css/brewpad.css
requirements-completed: [D-05, D-06, D-07, D-08, D-09, D-10, D-24]
completed: 2026-10-14
---

# Phase 90 Plan 06: Unlinked filter and guided invoice review Summary

Staff can filter BrewPad to unlinked batches and, from each batch detail, review up to 3 suggested invoices and link, dismiss or mark Internal with one tap per decision; the link write sends only the invoice number.

PLAN_BASE: 0c7e91cdd990105527e90d7e6c91e5b9197531c2 (the worktree started on b34d96ee; reset to this base per the branch check).

## Commits
- a1c8f22c feat(90-06): Unlinked filter chip, empty state and Internal badge (Task 1)
- f61b73bc feat(90-06): Possible invoices review section in batch detail (Task 2)
- c540516d feat(90-06): link invoice, mark internal and mark not internal actions (Task 3)

## What was built
- Task 1: pure helpers beside filterBatchesByStatus; applyBatchFilter `unlinked` branch; chip "Unlinked (n)" always shown and refreshed on every render (the chip shell persists, so the count is updated in the "update filter button states" loop); empty-state copy; Internal badge at both list render sites; `_renderBatchListForTest` seam.
- Task 2: `#bp-link-review` under the manual Link to Invoice control; fetch of `/api/batch/link-candidates`; skeleton/empty/no-customer/error states; Not this persisted in localStorage `bp-link-dismissed:<batchId>`; uninspected hint; Search all invoices forwards to `#bp-link-so-btn`; late responses for another batch are ignored; `_loadLinkCandidatesForTest`.
- Task 3: `linkBatchToInvoice` (update_batch `{zoho_so_number}` + expectedVersion = batch.last_updated, then afterBatchWrite, then reconcile), `markBatchSource`, delegated click handlers, Internal badge in detail header, Mark as not internal; `_linkBatchToInvoiceForTest`, `_markBatchSourceForTest`.

## Deviations from Plan
**1. [Rule 3 - Blocking] Chip click with an empty cache.** afterBatchWrite empties `_allBatchesData`, so selecting Unlinked then would falsely show "Every batch is linked". The filter click handler now loads batches first for `unlinked` when the cache is empty (same pattern as readyToBottle).

**2. [Rule 1 - Bug, found by an existing test] fetch mock returning undefined.** `brewpad-invite-tracking.test.js` renders detail with a global fetch mock that returns undefined; `loadLinkCandidates` wraps the call in `Promise.resolve(...)` and treats a missing response as a lookup failure instead of throwing.

**3. Test-first not strictly followed.** Task 1 and 2 tests were written after the implementation in the same sitting, so no RED output was recorded (same honest deviation as 90-03). Task 3 tests were also written after the code. All pass; the tests assert the behaviour bullets.

Mark internal omits expectedVersion (the plan specifies `{batch_id, updates:{source}}`); only link sends it.

## Verification
- Commit gate (Node 24.21): root `npm test` 186 suites / 2480 tests, `npm run lint` clean; zoho-middleware `npm test` 218 suites / 3308 tests, `npm run lint` clean, run after each task.
- Transient: zoho-middleware `vancouver-timezone.test.js` failed (2 tests) in one parallel gate run during Task 1 and passed on rerun (3/3); unrelated to this plan (middleware untouched).
- Acceptance greps: `/api/batch/link-candidates` 1, `Possible invoices` 1, `bp-link-dismissed:` 1, `Every batch is linked` 1, `val: 'unlinked'` 1; linkBatchToInvoice body has no customer_id/customer_name/product_name; only the two new test files changed under tests/frontend.
- No existing test edited; no build, no *.min.js, js/main.js or ?v= changes; STATE.md and ROADMAP.md untouched; nothing pushed.

## Known Stubs
None.

## Notes for 90-09 / 90-10
- New IIFE-scope block "Phase 90-06: guided invoice review" sits just above "Cache-busting helpers" in js/brewpad.js; detail render gained the review container, header badge and `#bp-unmark-internal`.
- CSS appended at the end of css/brewpad.css (.bp-source-badge--internal, .bp-link-*, .bp-pill*); css/brewpad.min.css not rebuilt (90-10).
- Real-server verification is still needed against the 90-05 route (contract was mocked): candidate `status` values, `date_distance_days` sign and `linked_batches` shape follow the plan contract.
- Mark internal / locked-source rules rely on the Plan 90-01 server guards for the authoritative check (UI only hides the button).

## Threat Flags
None. T-90-24: every interpolated value goes through escapeHTML (tested with markup in invoice number, line items and linked batches); the one dynamic error row uses textContent. T-90-25/26: write only inside tap handlers, key set asserted. T-90-27: Mark internal hidden for locked sources, invalid_source surfaced inline.

## Self-Check: PASSED
Created files and commits a1c8f22c, f61b73bc, c540516d verified present.
