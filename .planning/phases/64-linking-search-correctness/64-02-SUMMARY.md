---
phase: 64-linking-search-correctness
plan: 02
subsystem: api
tags: [zoho, express, brewpad, jest, tdd, frontend]

# Dependency graph
requires:
  - phase: 64-linking-search-correctness (plan 01)
    provides: MAX_PAGES/MAX_DETAIL_FETCH server-side cap precedent and the search-then-detail /
      Apps-Script-dedup patterns (pos.js:2484-2497) this plan's reconcile core reuses
provides:
  - reconcileInvoiceBatchStatus core (brewpad-integration.js) — counts live batches per invoice,
    clears cf_batch_status when none remain, re-syncs to the correct label otherwise; single
    dryRun-aware decision path shared by both new routes
  - POST /api/batch/reconcile-invoice-status — delete-hook, one invoice, called by both
    brewpad.js delete sites
  - POST /api/batch/reconcile-stale-batch-status — bounded (MAX_PAGES=4) dry-run-capable
    one-time cleanup for the existing INV-000151-class stale refs
  - Both brewpad.js delete sites (admin batch-detail + Needs-Scheduling) now capture
    zoho_so_number pre-delete and fire the reconcile hook fire-and-forget on success
affects: [64-linking-search-correctness (plan 03 if any), BrewPad batch-delete UX, Zoho invoice
  cf_batch_status accuracy]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single dryRun-aware core function shared by a dry-run report route and its live-apply
       route, so the two can never drift from each other's decision logic"
    - "formatBatchStatusLabel extracted as the one place that renders a cf_batch_status label,
       reused by both the original per-sale sync path and the new reconcile path"
    - "Frontend delete-flow regression testing via document.dispatchEvent(new Event('DOMContentLoaded'))
       to re-fire a module's already-elapsed bootstrap listener (re-wires event delegation onto a
       freshly-reset jsdom fixture) without adding a test-only hook to the source file"

key-files:
  created:
    - zoho-middleware/__tests__/batch-reconcile-status.test.js
    - tests/frontend/brewpad-delete-reconcile.test.js
  modified:
    - zoho-middleware/lib/brewpad-integration.js
    - zoho-middleware/routes/pos.js
    - js/brewpad.js
    - js/brewpad.min.js
    - brewpad.html

key-decisions:
  - "reconcileInvoiceBatchStatus takes an opts.dryRun flag rather than duplicating the
     clear-vs-resync decision logic in the cleanup route — guarantees the dry-run report and the
     live apply can never diverge"
  - "Added brewpad-integration.js:resolveInvoiceByNumber (uses zohoGet) instead of duplicating
     the search-then-detail number resolution inline in pos.js, matching the interface note to
     bind zohoGet in the lib and giving it a legitimate, lint-clean use"
  - "cf_batch_status status vocabulary mapping (mapBatchStatusForZoho) confirmed against
     apps-script/adminApi.gs: batch.status is 'pending'|'primary'|'secondary'|'complete'
     (lowercase); primary/secondary both map to Zoho's 'active'"
  - "Needs-Scheduling delete site's data-batch-id button carries no zoho_so_number attribute —
     resolution goes through _allBatchesData BEFORE showConfirmSheet is even called, not just
     before delete_batch fires, so the lookup value can't go stale between render and confirm"

patterns-established:
  - "cf_batch_status label formatting has exactly one implementation (formatBatchStatusLabel);
     any future writer of that field must route through it or reconcile's idempotency check
     (skip-if-already-correct) will silently never match"

requirements-completed: [OPS-03]

# Metrics
duration: ~30min
completed: 2026-07-24
---

# Phase 64 Plan 02: Batch-Delete cf_batch_status Reconcile Summary

**A reconcile core (brewpad-integration.js) plus two Express routes close the INV-000151 class of bug — deleting a batch no longer strands the linked Zoho invoice's cf_batch_status — and both brewpad.js delete sites now fire the hook fire-and-forget after a successful delete.**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-07-24T14:05:00-07:00 (approx)
- **Completed:** 2026-07-24T14:35:00-07:00 (approx)
- **Tasks:** 4 code tasks complete; Task 5 (owner-observed prod checkpoint) pending
- **Files modified:** 7 (2 test files created, 5 source files modified)

## Accomplishments
- Closed OPS-03 SC#2 (delete-hook half): a deleted batch's invoice reference is now
  re-derived server-side from the live batch set the moment either delete site succeeds —
  never trusts a client-supplied status (T-64-04/T-64-07)
- Added a bounded (MAX_PAGES=4, never request-controlled — T-64-05), dry-run-default-true
  one-time cleanup route for the existing INV-000151-class stale refs, reporting exactly which
  invoices it changed (or would change) — T-64-06 repudiation mitigation
- Both brewpad.js delete sites (admin batch-detail AND Needs-Scheduling) proven wired by an
  automated frontend test that drives the real confirm-sheet -> adminApiPost('delete_batch')
  flow end-to-end, not a grep
- Full RED->GREEN TDD discipline on both the middleware core/routes (19 new tests) and the
  frontend wiring (4 new tests) — verified via a manual stash-free RED gate (temporarily
  reverted the two source files via `git checkout --`, confirmed the test file fails for the
  right reason, restored, confirmed GREEN) since `git stash` is prohibited in worktree mode
- Full middleware suite (85 suites / 1332 tests) and full frontend suite (68 suites / 1028
  tests) green; both lints clean

## Task Commits

Each task was committed atomically:

1. **Task 1: Reconcile core + routes (RED->GREEN) in middleware**
   - `c0214462` (test) — RED: 19 tests against the pre-fix middleware; failed with "No POST
     handler registered" (routes didn't exist yet)
   - `2401f95d` (feat) — GREEN: reconcileInvoiceBatchStatus core + clearInvoiceBatchStatus +
     fetchLiveBatchIndex + resolveInvoiceByNumber + mapBatchStatusForZoho +
     formatBatchStatusLabel in brewpad-integration.js; two new routes in pos.js; all 19 tests
     pass, full middleware suite green, lint clean
2. **Task 2: Frontend regression test for the delete-hook wiring (RED)** - `55554146` (test) —
   3 of 4 tests fail against the unwired brewpad.js as expected (the 4th, "no zoho_so_number ->
   no call", already passes and validates the test harness itself)
3. **Task 3: Wire the delete-hook into both brewpad.js delete sites + rebuild (GREEN)** -
   `e394cc2c` (feat) — all 4 frontend tests pass; brewpad.js/brewpad.min.js/brewpad.html rebuilt
   (scoped: `npm run stamp:brewpad` + the brewpad.js terser step only, then reverted every other
   file the unscoped `npm run build` touched — its cache-stamp/timestamp churn across other
   pages and js/admin.js was out of this task's scope)
4. **Task 4: Full gate — both suites + lint** - no commit (verification-only): frontend
   68/68 suites (1028 tests) green, middleware 85/85 suites (1332 tests) green, both lints clean

**Plan metadata:** committed separately by the orchestrator after wave completion (worktree
mode — this executor does not write STATE.md/ROADMAP.md).

## Files Created/Modified
- `zoho-middleware/lib/brewpad-integration.js` - reconcileInvoiceBatchStatus core + supporting
  helpers (clearInvoiceBatchStatus, fetchLiveBatchIndex, resolveInvoiceByNumber,
  mapBatchStatusForZoho, formatBatchStatusLabel — the latter also now shared by the existing
  syncBatchToZoho)
- `zoho-middleware/routes/pos.js` - two new routes: POST /api/batch/reconcile-invoice-status
  (delete-hook) and POST /api/batch/reconcile-stale-batch-status (bounded scan/cleanup)
- `zoho-middleware/__tests__/batch-reconcile-status.test.js` - 19 new tests (core rule +
  both routes' success/error/auth/dry-run paths)
- `js/brewpad.js` - new reconcileInvoiceStatusAfterDelete(soNum) helper; wired into both
  delete sites (admin batch-detail captures b.zoho_so_number at listener-wire time; Needs-
  Scheduling resolves from _allBatchesData by batch_id before showConfirmSheet)
- `js/brewpad.min.js` - regenerated (terser, scoped to brewpad.js only)
- `brewpad.html` - cache-bust stamp updated (scoped via `npm run stamp:brewpad`)
- `tests/frontend/brewpad-delete-reconcile.test.js` - 4 new tests covering both delete sites,
  fire-and-forget failure tolerance, and the no-link no-call case

## Decisions Made
- **dryRun as a core-function opt, not route-level duplication:** reconcileInvoiceBatchStatus's
  clear-vs-resync decision runs identically whether or not it's allowed to write — the dry-run
  cleanup route and its live-apply counterpart literally cannot diverge in what they'd report vs.
  what they'd do, because they call the exact same function.
- **resolveInvoiceByNumber added to brewpad-integration.js** rather than inlining the
  search-then-detail number resolution in pos.js's new route — satisfies the plan's interface
  note to bind zohoGet in the lib with an actual, lint-clean (max-warnings 0) use, and keeps the
  invoice-number->record lookup in one place for any future caller.
- **Batch status vocabulary verified against source-of-truth**, not assumed: read
  `apps-script/adminApi.gs` directly to confirm live values are lowercase
  'pending'|'primary'|'secondary'|'complete' before writing mapBatchStatusForZoho.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking, worktree constraint] Manual RED-gate verification without `git stash`**
- **Found during:** Task 1
- **Issue:** The standard TDD RED-verification technique (stash the implementation, run the
  test, unstash) uses `git stash`, which is explicitly prohibited in worktree mode (shared
  `refs/stash` across sibling worktrees, #3542).
- **Fix:** Backed up the two source files to the session scratchpad directory, used
  `git checkout -- <file>` to revert them to the last commit (safe — reverts to a committed
  state, not a blanket working-tree wipe), ran the test suite to confirm RED, then restored the
  backed-up implementation from the scratchpad and re-ran to confirm GREEN.
- **Files affected:** none (verification-only technique, no source change)
- **Verification:** Test suite output confirmed the exact expected RED failure ("No POST
  handler registered for /api/batch/reconcile-invoice-status") before GREEN was verified.
- **Committed in:** N/A (process only; the RED/GREEN commits `c0214462`/`2401f95d` reflect the
  verified states)

**2. [Rule 3 - Blocking] Scoped `npm run build` output to brewpad.js/brewpad.min.js/brewpad.html only**
- **Found during:** Task 3
- **Issue:** `npm run build` (as literally specified in the plan's action text) is a single
  monolithic script that cache-stamps every public HTML page and rebuilds every JS bundle
  (main.js/admin.js/batch.js/kiosk*.js), producing unrelated diffs across ~20 files outside this
  task's declared file scope (js/brewpad.js, js/brewpad.min.js, brewpad.html).
- **Fix:** Ran the full `npm run build` once to get a correct brewpad.min.js/brewpad.html,
  then `git checkout --` every other file it touched (about.html, admin.html, contact.html,
  custom-labels.html, index.html, ingredients.html, kiosk.html, products*.html,
  reservation.html, js/admin.js, js/admin.min.js) — reverting them to their last-committed
  state. package.json also exposes a scoped `stamp:brewpad` script confirming this narrower
  scope is the intended per-surface granularity.
- **Files affected:** brewpad.html, js/brewpad.min.js only (final state)
- **Verification:** `git status --short` after the revert showed exactly the plan's declared
  file scope; grep count for "reconcile-invoice-status" in brewpad.min.js = 1.
- **Committed in:** `e394cc2c` (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking/worktree-constraint process adaptation, 1
blocking/scope-correction). Neither changed the plan's intended code outcome; both kept the
change set aligned to the plan's declared `files_modified`.
**Impact on plan:** None on functionality — process-only adaptations to worktree constraints
and build-tooling granularity.

## Issues Encountered
None beyond the deviations documented above.

## User Setup Required
None - no external service configuration required for Tasks 1-4. Task 5 (owner-observed prod
cleanup + live-delete verification) requires the middleware change to have reached prod Railway
first (rides the next prod deploy — no separate staging middleware, per the v4.2-era decision
already recorded in STATE.md).

## Next Phase Readiness
- OPS-03 SC#2's code is complete and fully tested; the delete-hook is live in the codebase and
  will start reconciling cf_batch_status the moment this ships to prod.
- **Task 5 (checkpoint:human-verify, gate="blocking") is NOT yet satisfied** — the one-time
  stale-ref cleanup route mutates PRODUCTION Zoho invoices (no staging middleware exists) and
  must be dry-run-then-apply-verified by the owner post-deploy, per the plan's checkpoint. This
  plan is not considered fully closed until that checkpoint returns "approved".
- No blockers for any sibling wave-2 plan in phase 64.

---
*Phase: 64-linking-search-correctness*
*Completed: 2026-07-24*

## Self-Check: PASSED

All created/modified files and commit hashes verified present:
- `zoho-middleware/lib/brewpad-integration.js` - FOUND
- `zoho-middleware/routes/pos.js` - FOUND
- `zoho-middleware/__tests__/batch-reconcile-status.test.js` - FOUND
- `js/brewpad.js` - FOUND
- `js/brewpad.min.js` - FOUND
- `brewpad.html` - FOUND
- `tests/frontend/brewpad-delete-reconcile.test.js` - FOUND
- `c0214462` (test, RED) - FOUND
- `2401f95d` (feat, GREEN) - FOUND
- `55554146` (test, RED) - FOUND
- `e394cc2c` (feat, GREEN) - FOUND
