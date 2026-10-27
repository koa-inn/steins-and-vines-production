---
phase: 94-dashboard-correctness-and-data-foundations
plan: 05
subsystem: middleware/batches
tags: [dashboard, aggregate, postgres, memo, proxy]
requires: [94-01, 94-03]
provides: [get_dashboard_stats action, getDashboardStats, store dashStats]
affects: [plan 94-07 dashboard, Phases 95-98]
key-files:
  created:
    - zoho-middleware/__tests__/db/batch-pg-dashboard-stats.test.js
    - zoho-middleware/__tests__/batch-store-dash-stats.test.js
    - zoho-middleware/__tests__/batch-dash-stats-route.test.js
  modified:
    - zoho-middleware/lib/batch-pg-read.js
    - zoho-middleware/lib/batch-rules.js
    - zoho-middleware/lib/batch-store.js
    - zoho-middleware/lib/batch-proxy.js
    - zoho-middleware/routes/pos.js
decisions:
  - "Memo treats age <= 60000 ms as fresh; re-read at 60001 ms"
  - "STATS_ACTION_TO_OP kept separate so the pinned 17-key ACTION_TO_OP is untouched"
metrics:
  tasks: 3
  completed: 2026-10-27
---

# Phase 94 Plan 05: Dashboard stats aggregate Summary

`get_dashboard_stats` on `/api/batch/admin-proxy` returns lean PII-free batch rows, active-batch tasks, latest reading per active batch, the existing summary and a Vancouver asOf; Postgres-only, memoised 60 s and cleared by every successful batch-store write.

## Commits
- 70ce3e54: `getDashboardStats` whitelist SQL read (+ real-PG test)
- a37b44d4: `batch-store.dashStats` memo, `finish()` invalidation, kiosk-cache enrichment
- 32e0c146: `STATS_ACTION_TO_OP`, allowlist in `ADMIN_PROXY_ACTIONS` and `ADMIN_PROXY_READS` only

## Verification (Node 24)
- Root `npm test` (2830) and `npm run lint` green; middleware `npm test` (3628), lint, and full `npm run test:db` (411) green.
- Pinned batch-proxy-routes, admin-proxy, batch-admin-proxy, batch-single-issuer and batch-pg-read golden tests pass unedited.

## Deviations from Plan
- **[Rule 3] Exported `formatDay` from `lib/batch-rules.js`.** The plan calls `batchRules.formatDay` but it was not exported. Additive one-line export.
- Worktree base was wrong at start (HEAD 8dbfa2ac, missing waves 1-2); reset to f4cab065 per the branch check, then `npm ci` in both package roots.
- The store test file was first written after the implementation (an initial Write call failed); the first run exposed a TTL boundary (`<` vs `<=`), fixed in the implementation to match the stated 60000/60001 behaviour.
- No existing tests modified.

## Known Stubs
None. `product_subcategory/brand/manufacturer` are '' from the SQL read by design and filled in the store.

## Self-Check: PASSED
