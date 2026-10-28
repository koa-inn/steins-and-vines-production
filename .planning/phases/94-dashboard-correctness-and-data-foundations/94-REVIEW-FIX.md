---
phase: 94-dashboard-correctness-and-data-foundations
fixed_at: 2026-10-28T02:30:00Z
review_path: .planning/phases/94-dashboard-correctness-and-data-foundations/94-REVIEW.md
iteration: 1
findings_in_scope: 5
fixed: 5
skipped: 0
status: all_fixed
---

# Phase 94: Code Review Fix Report

**Fixed at:** 2026-10-28T02:30:00Z
**Source review:** .planning/phases/94-dashboard-correctness-and-data-foundations/94-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 5 (1 critical, 4 warnings; Info findings out of scope)
- Fixed: 5
- Skipped: 0

For each fix, a regression test was written first and seen failing before the code change. Final gates on the last commit, all green under Node 24: root `npm test` (2866) + `npm run lint`, middleware `npm test` (3669) + `npm run lint` + `npm run test:db` (427).

## Fixed Issues

### CR-01: completed_at survives a reopen

**Files modified:** `zoho-middleware/lib/batch-pg-update.js`, `zoho-middleware/lib/batch-pg-tasks.js`, `js/brewpad.js`, `js/brewpad.min.js`, `zoho-middleware/__tests__/db/batch-pg-update-completed-reopen.test.js` (new), `tests/frontend/brewpad-dashboard-reopen.test.js` (new), `zoho-middleware/__tests__/db/batch-pg-tasks.test.js` (one assertion changed)
**Commit:** 6c296bcc
**Applied fix:** When `updateBatch` moves a batch to primary/secondary, it now clears `completed_at` and `completed_at_source`. Packaging-task un-completion (`onPackagingUncompleted`) now does the same, so both paths follow one rule. complete → disabled keeps the stamp. A completed_at sent explicitly by the caller still wins. On the frontend, `getDashboardData` now counts a completion only for `status === 'complete'` rows (defence in depth). `brewpad.min.js` was regenerated with terser.
**Existing test changed:** `batch-pg-tasks.test.js` › "un-completing packaging restores secondary and In-Use when a transfer was done". The assertion `expect(row.completed_at.getTime()).toBe(T0.getTime())` became `expect(row.completed_at).toBeNull()`. That test pinned the old Apps Script parity behaviour (keep the stamp on un-completion), which is exactly the CR-01 bug. This only diverges from the Apps Script path in a rollback to the sheet store.
**Status:** fixed: requires human verification (logic change to status-transition semantics)

### WR-01: D-23 stamp fires on complete → complete

**Files modified:** `zoho-middleware/lib/batch-pg-update.js`, `zoho-middleware/__tests__/db/batch-pg-update-completed-reopen.test.js`
**Commit:** 38a71c7e
**Applied fix:** The stamp now also needs `oldStatus !== 'complete'`. Only a transition into complete stamps `now`, so re-sending `status: 'complete'` leaves a D-14 stays-blank row blank.
**Status:** fixed: requires human verification (condition change)

### WR-02: get_batch/get_batches never return batch_type

**Files modified:** `zoho-middleware/lib/batch-pg-read.js`, `zoho-middleware/lib/batch-store.js`, `zoho-middleware/scripts/backfill/batches-parity.js`, `js/brewpad.js`, `js/brewpad.min.js`, new tests `zoho-middleware/__tests__/db/batch-pg-read-type.test.js`, `zoho-middleware/__tests__/batch-store-list-type.test.js`, `zoho-middleware/__tests__/backfill/batches-parity-type-keys.test.js`, `tests/frontend/brewpad-batch-type-server.test.js`; `zoho-middleware/__tests__/batch-store.test.js` (two assertions changed)
**Commit:** 2e2a4938
**Applied fix:** `listBatches` and `getBatchDetail` take an opt-in `includeType` option that appends `batch_type`/`batch_type_source` (null when unclassified). Only `batch-store` list/detail/batchInit pass it, which serve the proxy actions get_batches, get_batch and get_batch_init. The default shape is unchanged, so these stay untouched: the golden parity tests, the parity tool's direct-PG side, `getBatchBundle` (used by the mirror, which still matches BATCH_COLUMNS exactly, and a test asserts this), and `listAllForIndex`. `batches-parity.js` now ignores the two keys as well as `access_token`, so `--via=proxy --against-snapshot` still compares only sheet columns. In BrewPad, `batchTypeInfo` and `filterBatchesByNeedsType` prefer the server type on the row when `batch_type_source` is present, and fall back to the `_dashData` overlay and then the heuristic. The NULL-source hint text was left as is because an existing UI test pins it.
**Existing tests changed:** In `batch-store.test.js`, "reads run normally" now expects `getBatchDetail(CLIENT, 'SV-B-000001', { includeType: true })`. "dispatches list/dashboard/..." now expects `listBatches(CLIENT, { status: 'active', limit: 5, offset: 1, includeType: true })`. Both are exact-argument assertions that change only because of the new option.
**Status:** fixed

### WR-03: dashStats memo can cache a pre-write result

**Files modified:** `zoho-middleware/lib/batch-store.js`, `zoho-middleware/__tests__/batch-store-dash-memo-race.test.js` (new)
**Commit:** 995afa30
**Applied fix:** Added a `_dashGen` counter that `finish()` bumps on every successful write. `dashStats()` records the generation before it reads, and memoises only if the generation is unchanged when the read resolves.
**Status:** fixed

### WR-04: trusted type backfill can downgrade an upgraded row

**Files modified:** `zoho-middleware/lib/batch-pg-update.js`, `zoho-middleware/scripts/backfill/batch-type-backfill.js`, `zoho-middleware/__tests__/db/batch-type-backfill-race.test.js` (new)
**Commit:** 73970cfb
**Applied fix:** Under the row lock, the trusted type channel now writes only when the locked row's source is still NULL, `name` or `other`. Otherwise it fails with `source_changed`. If the caller passes `expectedTypeSource`, the stored source must also still equal it. The CLI records the source each plan entry was built from (`entry.stored`), passes it as `expectedTypeSource`, and counts `source_changed` as skipped (logging only the batch_id), the same way it counts `manual_locked`.
**Status:** fixed: requires human verification (guard logic)

---

Notes for the owner:
- This is code only and has not been pushed or deployed. Per the orchestrator, production had 0 CR-01-affected rows as of 2026-10-27, so no data fix is needed.
- Not fixed (Info, out of scope): IN-01..IN-05. IN-03 (re-derive a name-sourced type on a product_name change) still looks worth doing.

_Fixed: 2026-10-28T02:30:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_

## Staging verification (2026-10-28, `e1aec934`, Railway `92760dbb`)

Ran on the throwaway batch SV-B-000248 (SKU `ZZTEST94`, source `internal`, no customer and no invoice, so no Zoho writes)
through the staging admin-proxy. The owner was signed in, and the rows were read from staging Postgres.

| Check | Result |
|-------|--------|
| Create | status `pending`; `get_batch` returns `batch_type: other`, `batch_type_source: other` (WR-02 server) |
| pending to secondary to complete | `completed_at` 02:29:23.169Z stamped |
| CR-01 reopen to secondary | `completed_at` cleared |
| complete again | new `completed_at` 02:29:26.978Z, `completed_at_source: status` |
| WR-01 re-send `complete` | `completed_at` unchanged (02:29:26.978Z) |
| WR-02 set type `beer` | `get_batch` and `get_batches` both return beer/manual. After a full reload the detail pane shows the Type select = Beer with hint "Set by hand" |
| Cleanup | `delete_batch` ok; row gone, tombstone written, staging back to 215 batches |

WR-03 (memo race) and WR-04 (backfill downgrade) are covered by their regression tests only; neither can be
triggered by hand.
