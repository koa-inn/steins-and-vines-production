---
phase: 52-fail-closed-sweep
plan: 01
subsystem: infra
tags: [redis, fail-closed, resilience, tdd, jest]

# Dependency graph
requires:
  - phase: 45-security-money-path-hardening
    provides: lib/money-path.js discriminated-result / fail-closed contract (the pattern this helper mirrors)
provides:
  - "lib/redis-guard.js exporting closedOnRedisError(fn, opts) — single shared fail-closed-on-Redis-error helper"
  - "Unit test proving the helper returns { status: 'failclosed' } on throw (prod / alwaysClosed) and { status: 'value', value } otherwise"
affects: [52-02-fail-closed-sweep]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "closed-on-Redis-error helper: async fn wrapped in try/catch, discriminated { status: 'value'|'failclosed' } result, never throws to caller — same contract as lib/money-path.js"
    - "opts.isProd override pattern: ('isProd' in opts) ? !!opts.isProd : (process.env.NODE_ENV === 'production') — lets tests force prod/dev branches without touching NODE_ENV"

key-files:
  created:
    - zoho-middleware/lib/redis-guard.js
    - zoho-middleware/__tests__/redis-guard.test.js
  modified: []

key-decisions:
  - "Mirrored lib/money-path.js's discriminated-result shape exactly ({ status: 'value'|'failclosed' }) so 52-02's M1/M4/M5 call-sites read a contract identical to the existing money-path guards"
  - "opts.alwaysClosed always fails closed regardless of isProd, matching assertTxnNotReplayed's no-dev-distinction rule for the money/security invariant class of guard"
  - "opts.devFallback carries the dev fail-open value explicitly rather than re-running fn or returning undefined, so callers control what 'open' means in their own domain"

patterns-established:
  - "closedOnRedisError(fn, opts) as the single place the fail-closed decision is made for any guarded Redis operation — callers pass isProd/alwaysClosed/devFallback/label instead of hand-rolling try/catch"

requirements-completed: [RESIL-01]

# Metrics
duration: 2min
completed: 2026-07-03
---

# Phase 52 Plan 01: Shared Closed-on-Redis-Error Helper Summary

**New `lib/redis-guard.js` exporting `closedOnRedisError(fn, opts)` — a discriminated-result, never-throws wrapper mirroring `lib/money-path.js`'s fail-closed contract, TDD RED→GREEN with a 4-test unit suite and full 63/1191 middleware regression green.**

## Performance

- **Duration:** 2 min (commit-to-commit; task work itself)
- **Started:** 2026-07-03T05:29:13Z (first commit)
- **Completed:** 2026-07-03T05:30:38Z (second commit)
- **Tasks:** 2/2 completed
- **Files modified:** 2 created

## Accomplishments
- Built the single shared "closed-on-Redis-error" helper that Plan 52-02 (M1 promo / M4 rate-limit mid-op / M5 loopback skip) will call, so the fail-closed-under-Redis invariant lives in one tested place instead of leaking per call-site (AUDIT §4 insight 2).
- Contract mirrors `lib/money-path.js` byte-for-byte in shape: `{ status: 'value', value }` / `{ status: 'failclosed' }`, `isProd` override via `opts`, `alwaysClosed` for the no-dev-distinction money/security guard class.
- TDD RED→GREEN: failing contract test committed first (module missing), then the implementation, confirmed GREEN.
- Full middleware suite green: 63 suites / 1191 tests (baseline 62/1187 + 4 new `redis-guard` tests). `redis-guard.js` at 100% statement/branch/function/line coverage. `npx eslint lib/redis-guard.js` clean (0 problems).

## Task Commits

Each task was committed atomically:

1. **Task 1: RED — failing unit test defining the redis-guard contract** - `19a7615` (test)
2. **Task 2: GREEN — implement lib/redis-guard.js** - `0e4dd41` (feat)

**Plan metadata:** (this commit, immediately following)

_Note: TDD plan — RED (test) then GREEN (feat), no REFACTOR needed._

## Files Created/Modified
- `zoho-middleware/lib/redis-guard.js` - Exports `closedOnRedisError(fn, opts)`; try/await/catch wrapper that returns `{ status: 'value', value }` on success, `{ status: 'failclosed' }` on throw when `opts.alwaysClosed || isProd`, else `{ status: 'value', value: opts.devFallback }` in dev. `isProd` derived from `opts.isProd` override or `NODE_ENV`.
- `zoho-middleware/__tests__/redis-guard.test.js` - New test file (4 tests): happy-path value passthrough, prod fail-closed on throw, `alwaysClosed` fail-closed regardless of `isProd`, dev fail-open with `devFallback`.

## Decisions Made
- Mirrored `lib/money-path.js`'s exact discriminated-result shape and `isProd` override pattern rather than inventing a new contract — keeps 52-02's call-sites and future readers pattern-matching a single style across the codebase (see `key-decisions` in frontmatter).
- `opts.devFallback` is explicit (not "just re-throw" or "return undefined") so each caller in 52-02 controls what "fail open" means in its own domain (e.g., promo: no discount; rate-limit: some sane default count).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Restored missing `node_modules` in the worktree via `npm install`**
- **Found during:** Task 2 verification (`cd zoho-middleware && npm test`)
- **Issue:** The fresh git worktree had no `zoho-middleware/node_modules` (gitignored, not present in a freshly-created worktree), so 50/63 test suites failed with `Cannot find module 'express'` (and similar) — a worktree setup gap, not a code defect. No `package-lock.json` is tracked for the middleware, so `npm ci` was unavailable.
- **Fix:** Ran `npm install` in `zoho-middleware/` (no new dependency added — `package.json` was not modified; this restores the existing dependency tree already used by the main checkout's `node_modules`). This is a package-manager *restore* against an unmodified `package.json`, not a new/unvetted package install, so it falls outside the Rule 3 install-exclusion (which targets slopsquat risk on newly-referenced package names).
- **Files modified:** None tracked (`node_modules/` is gitignored; no `package.json`/lockfile change).
- **Verification:** `npm test` then ran cleanly: 63 suites / 1191 tests passed.
- **Committed in:** N/A (no trackable file changes — `node_modules/` stays gitignored).

---

**Total deviations:** 1 auto-fixed (1 blocking — worktree environment setup, not a code change)
**Impact on plan:** No scope creep; required only to execute the plan's own verification commands. No files were added to git as a result.

## Issues Encountered
None beyond the `node_modules` restore documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `closedOnRedisError` is ready for Plan 52-02 to consume for M1 (promo fail-closed), M4 (rate-limit mid-op fail-closed), and M5 (loopback skip gated to non-prod).
- No blockers. 52-02 `depends_on: [52-01]` per phase context — this plan's helper and its test are committed and green.

---
*Phase: 52-fail-closed-sweep*
*Completed: 2026-07-03*

## Self-Check: PASSED

- FOUND: zoho-middleware/lib/redis-guard.js
- FOUND: zoho-middleware/__tests__/redis-guard.test.js
- FOUND: .planning/phases/52-fail-closed-sweep/52-01-SUMMARY.md
- FOUND: 19a7615 (test commit)
- FOUND: 0e4dd41 (feat commit)
- FOUND: 4915764 (docs/summary commit)
