---
phase: 31-money-path-test-coverage
plan: "04"
subsystem: testing
tags: [jest, coverage, thresholds, money-path, checkout, payments, webhooks, helcim]
dependency_graph:
  requires:
    - phase: 31-01
      provides: routes glob in collectCoverageFrom (D-05)
    - phase: 31-02
      provides: checkout route tests that raise routes/checkout.js coverage
    - phase: 31-03
      provides: helcim webhook tests that raise routes/webhooks.js and lib/helcim.js coverage
  provides:
    - honest global lines threshold (62%) derived from measured 63.04%
    - per-file money-path floors: checkout 52%, payments 36%, webhooks 62%, helcim 25%
    - restored utility floors: validate.js 98%, logger.js 98%
  affects: [zoho-middleware/jest.config.js]
tech_stack:
  added: []
  patterns: [measured-coverage-threshold, per-file-money-path-floor, honest-no-exclusion-coverage]
key_files:
  modified:
    - zoho-middleware/jest.config.js
key_decisions:
  - "[D-06] Global floor set at 62 (measured 63.04%, 1pt headroom) — honest, no inflation"
  - "[D-07] Per-file money-path floors: checkout 52%, payments 36%, webhooks 62%, helcim 25% — each just below measured"
  - "[D-08] No !-prefix exclusions in collectCoverageFrom — routes/**/*.js already in place from Plan 01"
  - "[Restored] validate.js (98%) and logger.js (98%) per-file floors restored — both measured at 100%"
  - "[Worktree merge] Worktree was branched before wave 2/3 merges; merged main into branch to get Plan 01-03 changes before measuring"
requirements-completed: [TEST-03]
duration: 8min
completed: "2026-06-17"
---

# Phase 31 Plan 04: Honest Coverage Thresholds Summary

**Measured post-Phase-31 global line coverage at 63.04%; set honest global floor at 62% and per-file money-path floors (checkout/payments/webhooks/helcim) so the money path cannot silently regress.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-06-17T12:45:00Z
- **Completed:** 2026-06-17T12:53:00Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Merged main branch (containing Plans 01-03 changes) into the worktree branch to get the route tests and updated jest.config.js before measuring
- Ran `npm run test:coverage` and recorded the real measured line coverage for all money-path files
- Set `coverageThreshold.global.lines = 62` (just below measured 63.04%, D-06)
- Added per-file money-path floors (D-07):
  - `./routes/checkout.js`: 52 (measured 53.08%)
  - `./routes/payments.js`: 36 (measured 37.20%)
  - `./routes/webhooks.js`: 62 (measured 62.96%)
  - `./lib/helcim.js`: 25 (measured 26.53%)
- Restored validate.js (98%) and logger.js (98%) per-file floors (both at 100% actual)
- Full test suite passes: 35 suites, 689 tests, exit 0

## Measured Coverage Numbers

| File | % Stmts | % Branch | % Funcs | % Lines |
|------|---------|---------|---------|---------|
| All files (global) | 61.92 | 49.69 | 51.13 | **63.04** |
| routes/checkout.js | 52.37 | 43.39 | 37.77 | **53.08** |
| routes/payments.js | 37.20 | 25.00 | 22.22 | **37.20** |
| routes/webhooks.js | 60.71 | 51.11 | 23.52 | **62.96** |
| lib/helcim.js | 25.92 | 10.00 | 4.00 | **26.53** |
| lib/validate.js | 100 | 100 | 100 | **100** |
| lib/logger.js | 100 | 100 | 100 | **100** |

## Task Commits

Each task was committed atomically:

1. **Task 1: Measure honest coverage and pin global + per-file thresholds (D-06, D-07)** - `a21a304` (chore)

## Files Created/Modified

- `zoho-middleware/jest.config.js` — Added honest global threshold (62%) and per-file money-path floors; restored validate.js/logger.js floors; no !-prefix exclusions

## Decisions Made

- **Global floor at 62**: Measured 63.04% — set 1 point below for minimal headroom without cheating. Whole-number floor only on lines metric (not stmts/branch/funcs) per plan guidance.
- **Per-file floors just-below-measured**: Each money-path floor is set 1-2 points below the measured value. Choosing a larger gap would hide future regressions; choosing 0 headroom risks flapping if coverage varies by a fraction between runs.
- **Restored validate.js/logger.js**: Plan 02 removed ALL thresholds to fix single-file run exit 0. Now that Plan 04 reinstates thresholds on the full suite, re-adding these at 98% is the right move — both measure at 100% so they pass trivially.
- **Worktree branch merge**: This worktree was spawned from `5a2a203` before the wave 2 merge landed on `main` (`8682c30`). Running `git merge main` (fast-forward) brought in all Plan 01-03 changes before coverage measurement.

## Deviations from Plan

None — plan executed exactly as written. The worktree merge was a necessary setup step (standard worktree isolation), not a deviation.

## Issues Encountered

- **Worktree missing node_modules**: Created a symlink `zoho-middleware/node_modules -> /Users/koa/dev/steins-and-vines-website/zoho-middleware/node_modules` so Jest could find its dependencies. This is gitignored and identical to the workaround used in Plans 02 and 03.
- **Worktree branch behind main**: The worktree was branched before the wave 2 merge (Plans 02+03). Required `git merge main` before coverage measurement to get the route tests into the working tree.

## Known Stubs

None — config-only change; no stub patterns introduced.

## Threat Flags

None — jest.config.js is test infrastructure; no new network endpoints, auth paths, file access, or schema changes.

## Self-Check: PASSED

- `zoho-middleware/jest.config.js` modified with coverageThreshold containing all required entries
- Commit `a21a304` present in git log
- `npm run test:coverage` exits 0: 35 suites, 689 tests, 4 todo
- Coverage table confirms rows for routes/checkout.js, routes/payments.js, routes/webhooks.js, lib/helcim.js
- Global threshold (62) <= measured (63.04) — D-06 satisfied
- No `!`-prefix exclusions in collectCoverageFrom — D-08 satisfied
- Per-file entries for all four money-path files present — D-07 satisfied
