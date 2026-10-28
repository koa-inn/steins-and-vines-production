---
phase: 95-global-filters-and-chart-engine
plan: 04
subsystem: brewpad-dashboard
tags: [dashboard, filters, deltas, tdd, es5]
requires: [95-03]
provides: [DASH_FILTER_DEFAULTS, parseDashHash, sanitizeDashFilters, resolveDashFilters, serializeDashFilters, dashV2FlagFrom, dashPeriodLabel, dashFilterSummary, countNonDefaultFilters, formatDelta, dashDrillLabel, mergeWineSkuLookup, wineBreakdownBuckets]
affects: [95-06, 95-07, 95-08]
key-files:
  modified: [js/brewpad.js, js/brewpad.min.js, brewpad.html]
  created: [tests/frontend/brewpad-dashboard-v2-filters.test.js, tests/frontend/brewpad-dashboard-v2-delta.test.js]
decisions:
  - "A hash containing dash=v2 or any filter key is authoritative (missing keys = defaults); localStorage is only used when the URL carries no dash state"
  - "Litres measure appends ' (N L)' to the drill banner; batch count stays authoritative"
  - "wineBreakdownBuckets expects rows already gated to wine and window (as the v1 render does); v1 code untouched"
metrics:
  completed: 2026-10-28
---

# Phase 95 Plan 04: Filter state, deltas and wine buckets Summary

Pure, exported ES5 helpers for the v2 dashboard: whitelisted hash/localStorage filter state with URL-authoritative precedence, the v2 opt-in flag, period/summary strings, the trend delta formatter (UI-SPEC copy), the drill banner label, and id-carrying wine breakdown buckets that mirror v1's top-8 + Other + Unknown-last rules.

## Commit
- 93915662 feat(95-04): filter state, deltas, drill labels, wine buckets (32 new tests; RED run showed all 32 failing first)

Both plan tasks were committed together because they share js/brewpad.js and the build artifacts.

## Verification
- Full `npm test` 2924 passed (218 suites), no existing test modified; `npm run lint` clean; `npm run build` ran.
- Functions confirmed pure: test spies on `Storage.prototype.getItem` and `history.replaceState`.
- Threats T-95-15/16/17 mitigated: state built from whitelisted literals only, malformed decode and JSON caught, custom range validated (real date, from <= to <= today).

## Deviations from Plan
- Worktree base was not 9f0ffdf3; reset to it per startup check.
- `npm run build` re-stamped many unrelated HTML files and admin.js/min.js; reverted, committed only brewpad.html, brewpad.js, brewpad.min.js. css/brewpad.min.css unchanged.
- Purity test spies on `Storage.prototype` / `window.history` because jsdom ignores replacing the globals.

## Deferred Issues
- `zoho-middleware/__tests__/vancouver-timezone.test.js` fails 2 tests locally (Node 20 vs prod Node 24); pre-existing, middleware untouched.

## Known Stubs
None.

## Self-Check: PASSED
