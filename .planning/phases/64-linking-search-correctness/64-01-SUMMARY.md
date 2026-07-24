---
phase: 64-linking-search-correctness
plan: 01
subsystem: api
tags: [zoho, express, middleware, jest, tdd]

# Dependency graph
requires:
  - phase: 57-rate-limit-discipline
    provides: MAX_PAGES server-side cap precedent (WR-02 quota discipline) reused as MAX_DETAIL_FETCH
provides:
  - GET /api/batch/search-invoices now returns real, populated line_items (item name/quantity/rate/amount) instead of an always-empty array
  - Hard server-side MAX_DETAIL_FETCH=10 cap preventing unbounded Zoho detail-fetch fan-out from a single search
  - Regression test suite (batch-search-invoices.test.js) covering line_items merge, cap enforcement, short-query guard, Zoho-error path, response-shape stability, and auth
affects: [64-linking-search-correctness (plans 02/03), brewpad link-order UI]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Search-then-detail with hard server-side cap: list endpoint resolves candidate IDs, capped detail-fetch loop enriches each with real data, sequential Promise chain (not Promise.all) respects Zoho's ~1/s quota"

key-files:
  created:
    - zoho-middleware/__tests__/batch-search-invoices.test.js
  modified:
    - zoho-middleware/routes/pos.js

key-decisions:
  - "Detail-fetch error path returns 502 (matching the existing list-search-failure catch) rather than degrading to per-invoice empty line_items — keeps failure behavior consistent and simple, avoids a partial/misleading response to the BrewPad UI"
  - "MAX_DETAIL_FETCH hard-coded to 10 (inline constant, never request-controlled), matching the MAX_PAGES precedent at pos.js:2413"

patterns-established:
  - "Capped search-then-detail pattern for any future Zoho list-endpoint field that is always empty on the list response"

requirements-completed: [OPS-03]

# Metrics
duration: ~18min
completed: 2026-07-24
---

# Phase 64 Plan 01: Real line_items in search-invoices Summary

**GET /api/batch/search-invoices now detail-fetches each matched invoice (hard-capped at 10) so line_items carry real Zoho kit contents instead of an always-empty array off the list endpoint.**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-07-24T13:53:00-07:00 (approx, base commit 983503d8)
- **Completed:** 2026-07-24T14:01:00-07:00
- **Tasks:** 3
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments
- Closed OPS-03 SC#1: `line_items` on `/api/batch/search-invoices` is now real (item name/sku-adjacent name/quantity/rate/amount), not the permanently-empty field from Zoho's list endpoint
- Added a hard, server-side, non-request-controlled `MAX_DETAIL_FETCH = 10` cap so a search can never fan out into unbounded ~1/s Zoho calls (T-64-01)
- New regression suite locks in the fix: real-merge, cap enforcement, short-query guard, Zoho-error 502 path, response-shape stability, and auth-tier preservation
- Verified no regression in the sibling `scan-invoices`/`bulk-create` suite (same file, same detail-fetch conventions)

## Task Commits

Each task was committed atomically:

1. **Task 1: Write the regression test for real, capped line_items** - `0406264f` (test) — RED, confirmed failing against the pre-fix route (3/6 tests failed as expected: real-merge, cap-enforced, 502-on-error; the other 3 unrelated assertions — auth, short-query, shape — passed unchanged)
2. **Task 2: Detail-fetch line_items in search-invoices, hard-capped** - `c7335114` (feat) — GREEN, all 6 tests pass
3. **Task 3: Full gate — both suites + lint** - no commit (verification-only task, no code changes produced)

**Plan metadata:** committed separately by the orchestrator after wave completion (worktree mode — this executor does not write STATE.md/ROADMAP.md).

## Files Created/Modified
- `zoho-middleware/__tests__/batch-search-invoices.test.js` - New regression test file (6 tests) mirroring the mocking/handler-invocation style of `batch-scan-invoices.test.js`
- `zoho-middleware/routes/pos.js` - Rewrote `/api/batch/search-invoices` handler: capped, sequential search-then-detail chain producing real `line_items`

## Decisions Made
- **Zoho detail-fetch error behavior:** chose 502 (matching the existing list-search-failure catch at the same route) over a per-invoice soft-fallback to `[]`. The plan explicitly allowed either; 502 keeps the failure mode consistent with the rest of the route and avoids silently showing an invoice with no kit contents to BrewPad staff.
- **Cap value and mechanism:** `MAX_DETAIL_FETCH = 10` as an inline constant, following the exact `MAX_PAGES` convention already established at `pos.js:2413` for scan-invoices — never derived from the request, per T-64-01.

## Deviations from Plan

**None** — plan executed as written. The only environment-level action taken (not a plan deviation) was installing `node_modules` for both the root project and `zoho-middleware/` in this worktree via `npm ci`, since a fresh worktree checkout does not carry over installed dependencies from the main repo. This was necessary to run any test/lint verification and is not a change to project code, config, or plan scope.

## Issues Encountered
- Fresh worktree had no `node_modules` in either the repo root or `zoho-middleware/` (worktrees don't inherit installed dependencies). Resolved by running `npm ci --no-audit --no-fund` in both locations before running any verification command. No `package.json`/`package-lock.json` changes resulted — installs matched the committed lockfiles exactly.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- OPS-03 SC#1 is closed; the BrewPad link-order UI's search-invoices consumer can now rely on populated `line_items` without any client-side change (response shape unchanged).
- No blockers for plans 02/03 of phase 64.

---
*Phase: 64-linking-search-correctness*
*Completed: 2026-07-24*
