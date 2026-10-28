---
phase: 96-new-and-upgraded-dashboard-graphs
plan: 02
subsystem: zoho-middleware
tags: [postgres, dashboard, get_dashboard_stats]
requires: []
provides: [taskRows, readings, vessels, batchMeta on get_dashboard_stats]
affects: [96 frontend widgets G3-G8, G10]
key-files:
  modified: [zoho-middleware/lib/batch-pg-read.js]
  created:
    - zoho-middleware/__tests__/db/batch-pg-dashboard-stats-96.test.js
    - zoho-middleware/__tests__/batch-store-dash-stats-96.test.js
decisions:
  - Extended the existing get_dashboard_stats action (one payload, one 60 s memo) rather than adding an action
metrics:
  completed: 2026-10-28
---

# Phase 96 Plan 02: Dashboard stats extra arrays Summary

`get_dashboard_stats` now also returns `taskRows` (titles, open-on-active plus all completed), `readings` (every reading of primary/secondary batches), `vessels` (incl. archived) and `batchMeta` (invoice-link flag, planned days, parsed recipe name/style/OG/target FG), all with explicit column whitelists; existing keys are unchanged.

## Commits
- feat(96-02): SQL constants, `parseDashSnapshot`, getDashboardStats keys, real-PG tests
- test(96-02): memo pass-through test (no change needed in lib/batch-store.js)

## Deviations from Plan
None. Tasks 1 and 2 were committed as feature+tests together (RED observed first: all 5 new DB cases failed before implementation).

## Dormant features (important)
No snapshot writer records OG or target FG today, so `og` and `target_fg` are always null in live data. The G8 expected curve, attenuation and ABV stay dormant until a recipe/snapshot writer records OG and target FG. The parser is ready (keys `og`, `target_fg`/`fg`, range 2..40 Plato).

**Owner question:** Track OG/target FG capture on recipes as a follow-up?

## Verification
- New db tests (5) and existing dashboard-stats db tests pass (9/9), run alone.
- `npm test` (middleware): 3707 pass; 2 failures in `__tests__/vancouver-timezone.test.js` are pre-existing (local Node tzdata gives UTC-8 after 2026-11-01), unrelated to this plan.
- `npm run test:db` full run: `batch-pg-dashboard-stats.test.js` (existing, untouched) timed out at container start (120 s) when run in parallel with 50 other DB suites; it passes (9/9) when run alone. Resource contention, not a code failure.
- `npm run lint` passes. Existing test files untouched.

## Known Stubs
None.

## Threat Flags
None. Mitigations T-96-03/05 implemented (whitelists, leak-guard test, try/catch parse).

## Self-Check: PASSED
