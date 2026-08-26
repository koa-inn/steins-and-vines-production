---
phase: 75-brewpad-invoice-pending-batch-quantity-expansion-multi-qty-k
plan: 02
subsystem: ui
tags: [brewpad, frontend, jest, es5, batch-list]

# Dependency graph
requires: []
provides:
  - "computeUnitLabel(batch, allBatches) pure helper in js/brewpad.js — derives 'Unit X of N' ordinal from sibling batch_id order within a (zoho_so_number, product_sku) group"
  - "Per-batch 'Unit X of N' label wired into both BrewPad batch-list render paths (table + card views)"
affects: [75-01, brewpad-batch-list, future D-03 follow-ups]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Module-scope pure render-helper (mirrors shouldShowKioskBadge) exported via the module.exports Object.assign block for Jest coverage"

key-files:
  created:
    - tests/frontend/brewpad-unit-label.test.js
  modified:
    - js/brewpad.js
    - js/brewpad.min.js
    - brewpad.html

key-decisions:
  - "Ordinal derived purely client-side from existing sequential batch_id — no new backend field, no schema change"
  - "Grouping key is exactly (zoho_so_number, product_sku); empty/missing zoho_so_number never groups, even with another empty value"
  - "Label sourced from the full unfiltered _allBatchesData, not the current filtered view, so N always reflects all siblings"

patterns-established:
  - "Pure per-batch label helpers live near shouldShowKioskBadge and are exported alongside it for frontend Jest tests requiring '../../js/brewpad'"

requirements-completed: [OWNER-BUG-20260825]

# Metrics
duration: 9min
completed: 2026-08-26
---

# Phase 75 Plan 02: BrewPad multi-unit "Unit X of N" label Summary

**Added a client-side-only `computeUnitLabel` helper to js/brewpad.js that groups pending batches by (zoho_so_number, product_sku) and labels each sibling "Unit X of N" in both the BrewPad table and card batch-list views, with no backend/schema change.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-08-26T20:53:00Z
- **Completed:** 2026-08-26T21:02:00Z
- **Tasks:** 2 completed
- **Files modified:** 4 (1 created, 3 modified)

## Accomplishments
- `computeUnitLabel(batch, allBatches)` pure helper: filters siblings sharing a non-empty `zoho_so_number` and matching `product_sku`, sorts ascending by `String(batch_id)`, returns `'Unit X of N'` (or `''` for groups of size <= 1)
- Wired into `renderBatchList`'s table view (product-name cell) and card view (`bp-batch-card-name`), both reading `_allBatchesData` so the group size reflects all siblings regardless of the active filter
- Test-first: 5 failing tests written and confirmed RED before the helper existed, then confirmed GREEN after implementation (TDD gate satisfied)
- Rebuilt `js/brewpad.min.js` and re-stamped `brewpad.html` via `npm run build` (never hand-edited); reverted all unrelated build-artifact side effects (other pages' cache-busters, `js/admin.js` BUILD_TIMESTAMP) that the monolithic build script also touches, keeping the commit scoped to this plan's `files_modified`

## Task Commits

Each task was committed atomically:

1. **Task 1: Write failing tests for computeUnitLabel ordinal derivation** - `37345b7a` (test)
2. **Task 2: Add computeUnitLabel, wire into render, rebuild bundle** - `0ec23ef1` (feat)

**Plan metadata:** pending (this SUMMARY commit, made by the orchestrator after wave merge per worktree mode)

_Note: TDD task — commits follow test → feat (no refactor needed)._

## Files Created/Modified
- `tests/frontend/brewpad-unit-label.test.js` - New Jest suite covering 3-unit contiguous group (shuffled input), 1-unit no-label, empty-SO non-grouping, independent-SKU groups, batch_id-sorted ordinal
- `js/brewpad.js` - Added `computeUnitLabel` near `shouldShowKioskBadge`, exported it, wired into table + card render sites
- `js/brewpad.min.js` - Regenerated via `npm run build` (contains `computeUnitLabel` + `Unit ` string ×2, `bp-batch-unit` class ×2)
- `brewpad.html` - Cache-buster for `brewpad.min.css`/`brewpad.min.js` re-stamped by the same build

## Decisions Made
- No new `bp-batch-unit` CSS rule added — the plan's `files_modified` scope did not include a CSS file, and the span renders as plain inline text without one, which satisfies the acceptance criteria (label text visible) without expanding scope beyond what was planned.
- `npm run build` regenerates far more than this plan's files (all pages' cache-busters, `js/admin.js` timestamp, all `.min.js`/`.min.css` bundles). Only `js/brewpad.js`, `js/brewpad.min.js`, and `brewpad.html` were staged/committed; all other build side effects were reverted with `git checkout -- <file>` per file (never a blanket reset) to keep the commit scoped to this plan.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed zoho-middleware dependencies via `npm ci`**
- **Found during:** Task 2 verification (`cd zoho-middleware && npm test`)
- **Issue:** `zoho-middleware/node_modules` did not exist in this worktree — `npm test` failed on `Cannot find module '@sentry/node'` across 80 test suites (an environment/setup gap, not a code defect; no new package was added, `@sentry/node` was already pinned in `package.json`)
- **Fix:** Ran `npm ci` in `zoho-middleware/` to hydrate the existing lockfile-pinned dependencies (not a new/arbitrary package install — excluded from the Rule 3 package-legitimacy carve-out since it installs only what `package-lock.json` already specifies)
- **Files modified:** none (only `node_modules/`, gitignored)
- **Verification:** `cd zoho-middleware && npm test` then passed 93/93 suites, 1445/1445 tests
- **Committed in:** N/A (no tracked files changed)

---

**Total deviations:** 1 auto-fixed (1 blocking/environment)
**Impact on plan:** No code or scope changes; unblocked the CLAUDE.md rule 1 requirement that both suites pass before every commit.

## Issues Encountered
- The monolithic `npm run build` script regenerates cache-busters and build artifacts across the entire site (all HTML pages, `js/admin.js` BUILD_TIMESTAMP, every `.min.js`/`.min.css`), not just BrewPad. Resolved by running the full build (required to regenerate `js/brewpad.min.js` correctly) then reverting every file outside this plan's `files_modified` scope with per-file `git checkout --` before staging/committing.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- The "Unit X of N" label is live in both BrewPad batch-list views and will render correctly as soon as real multi-unit batches exist.
- Live visual confirmation (owner follow-up, not a code task per the plan) still requires: Plan 01 deployed to prod middleware + INV-000171 backfilled via the revised-D-01 one-time manual re-import, then a browser check (not `curl`, per STATE.md anti-pattern #2) against staging/prod that the three sibling batches render contiguous `Unit 1 of 3` / `Unit 2 of 3` / `Unit 3 of 3`.
- No blockers for other Phase 75 plans — this plan touched no files shared with Plan 01.

---
*Phase: 75-brewpad-invoice-pending-batch-quantity-expansion-multi-qty-k*
*Completed: 2026-08-26*

## Self-Check: PASSED

- FOUND: tests/frontend/brewpad-unit-label.test.js
- FOUND: computeUnitLabel in js/brewpad.js
- FOUND: 'Unit ' label string in js/brewpad.min.js
- FOUND: SUMMARY.md
- FOUND commit: 37345b7a (Task 1)
- FOUND commit: 0ec23ef1 (Task 2)
- FOUND commit: a062213b (SUMMARY)
