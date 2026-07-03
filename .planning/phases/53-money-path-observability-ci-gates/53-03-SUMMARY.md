---
phase: 53-money-path-observability-ci-gates
plan: 03
subsystem: testing
tags: [eslint, eqeqeq, no-unused-vars, lint-gate, jest]

# Dependency graph
requires:
  - phase: 53-money-path-observability-ci-gates (plan 02)
    provides: Sentry captureException instrumentation in checkout.js/pos.js/webhooks.js/money-path.js
provides:
  - Middleware workspace (routes/, lib/, server.js) lints at 0 warnings/0 errors
  - Behavior-neutral removal of 41 no-unused-vars + suppression of 19 intentional eqeqeq (!= null) warnings
affects: [53-06 (lint gate --max-warnings 0 flip), any future middleware route/lib changes]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Unused catch bindings converted to bindingless `catch {}` (ES2019 optional catch binding, valid at project's ecmaVersion 2020) instead of `catch (e) {}`"
    - "Intentional `!= null` loose-equality checks suppressed with inline `eslint-disable-line eqeqeq -- reason` rather than converted to `!==` (converting would silently drop the undefined-matching behavior)"

key-files:
  created: []
  modified:
    - zoho-middleware/routes/catalog.js
    - zoho-middleware/routes/checkout.js
    - zoho-middleware/routes/pos.js
    - zoho-middleware/routes/webhooks.js
    - zoho-middleware/routes/auth.js
    - zoho-middleware/routes/consignment.js
    - zoho-middleware/routes/payments.js
    - zoho-middleware/routes/pos-recipe.js
    - zoho-middleware/routes/recipes.js
    - zoho-middleware/routes/taxes.js
    - zoho-middleware/lib/cache.js
    - zoho-middleware/lib/calcom.js
    - zoho-middleware/lib/checkout-helpers.js
    - zoho-middleware/lib/helcim.js
    - zoho-middleware/lib/recipe-scaling.js
    - zoho-middleware/lib/reconcile.js
    - zoho-middleware/lib/zohoAuth.js

key-decisions:
  - "All 19 eqeqeq warnings were `!= null` sites (0 `==`); every one was an intentional loose-equality null/undefined check, so all were suppressed with eslint-disable-line rather than tightened to `!==` (would have changed semantics)"
  - "Unused catch(e) bindings converted to bindingless `catch {}` rather than renamed to `_e` — project's eslint config has no caughtErrorsIgnorePattern, and ecmaVersion 2020 supports optional catch binding natively"
  - "Removed a dead unexported function (callAppsScriptGet in recipes.js) and its backing unused const (INGREDIENTS_FILE_CACHE) — verified neither was referenced or exported anywhere in the file"
  - "Dropped the unused trailing catalogMap param from processSaleWithPrices (routes/pos.js) at both signature and its single call site — confirmed via grep no other call sites exist"

patterns-established:
  - "Prerequisite lint-cleanup commits are split into two atomic commits (eqeqeq suppression, then no-unused-vars removal) so the 53-06 gate-flip diff has a clean, already-audited baseline"

requirements-completed: [OBS-01]

# Metrics
duration: ~25min
completed: 2026-07-03
---

# Phase 53 Plan 03: Middleware Lint Cleanup (eqeqeq + no-unused-vars) Summary

**Cleared all 60 pre-existing eslint warnings in zoho-middleware (19 eqeqeq, 41 no-unused-vars) across two behavior-neutral commits — full 1245-test suite stays green, unblocking the 53-06 `--max-warnings 0` CI gate.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-07-03T16:08:57Z
- **Tasks:** 2
- **Files modified:** 17

## Accomplishments
- `eslint routes/ lib/ server.js` now reports 0 problems (was 60: 41 no-unused-vars + 19 eqeqeq)
- All 76 middleware Jest suites / 1245 tests still pass after cleanup — proves zero behavior change
- Confirmed measured baseline matched the plan's pre-recorded count exactly (60), so 53-02's Sentry additions introduced no new warnings in checkout.js/pos.js/webhooks.js

## Task Commits

Each task was committed atomically:

1. **Task 1: Clear eqeqeq warnings (19) via safe autofix + review** - `d4544b7` (chore)
2. **Task 2: Clear no-unused-vars warnings (41) + verify 0 total** - `e9c1bc5` (chore)

**Plan metadata:** SUMMARY commit (this file) — see below.

## Files Created/Modified
- `zoho-middleware/routes/catalog.js` — 18 `!= null` eqeqeq suppressions (bulk of the warnings), 8 catch-binding removals, 1 dead `inventoryGet` alias removed
- `zoho-middleware/routes/checkout.js` — 1 `!= null` eqeqeq suppression, 1 catch-binding removal (`cacheCheckErr`)
- `zoho-middleware/routes/pos.js` — 1 catch-binding removal, 1 unused `status` local removed, unused trailing `catalogMap` param removed from `processSaleWithPrices` (signature + its one call site)
- `zoho-middleware/routes/webhooks.js` — 1 catch-binding removal, unused `mailer` require removed (verified no side effects at require-time)
- `zoho-middleware/routes/auth.js` — unused `crypto` and `axios` requires removed (neither referenced anywhere in file)
- `zoho-middleware/routes/consignment.js` — 1 catch-binding removal
- `zoho-middleware/routes/payments.js` — unused `.then(function (result) {...})` param dropped
- `zoho-middleware/routes/pos-recipe.js` — 1 catch-binding removal
- `zoho-middleware/routes/recipes.js` — dead unexported `callAppsScriptGet` function removed, dead `INGREDIENTS_FILE_CACHE` const removed, 2 catch-binding removals
- `zoho-middleware/routes/taxes.js` — 1 catch-binding removal
- `zoho-middleware/lib/cache.js`, `lib/calcom.js`, `lib/checkout-helpers.js` (x2), `lib/helcim.js` (x5), `lib/reconcile.js` (x2), `lib/zohoAuth.js` (x5) — catch-binding removals
- `zoho-middleware/lib/recipe-scaling.js` — dead `isContinuous` local removed from `scaleIngredient` (computed and reassigned but never read; `isDiscrete` alone drives the rounding branch, confirmed by reading the full function body and its doc comment)

## Decisions Made
- All 19 eqeqeq sites were `!= null` (not `==`); suppressed via `eslint-disable-line eqeqeq -- reason` instead of tightening to `!==`, preserving the intentional null-and-undefined match.
- Unused `catch (e)` bindings converted to bindingless `catch {}` (ES2019 optional catch binding — valid under the project's `ecmaVersion: 2020` eslint config) rather than prefixing with underscore, since no `caughtErrorsIgnorePattern` exists in `eslint.config.js`.
- Confirmed each removed binding/function had no side effects and no other references via targeted `grep` before deleting (e.g., `inventoryGet = zohoApi.inventoryGet` is a pure property read; `require('../lib/mailer')` has no top-level side effects; `callAppsScriptGet` was never exported or called).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed missing zoho-middleware node_modules via `npm ci`**
- **Found during:** Task 1 verification (running `npm test` to confirm eqeqeq suppression was behavior-neutral)
- **Issue:** `zoho-middleware/node_modules` did not exist in this worktree — `npm test` failed with "Cannot find module 'axios'"/"'express'" across 63 of 76 suites, blocking the behavior-neutral verification the plan requires after every task.
- **Fix:** Ran `npm ci` inside `zoho-middleware/` — installs strictly from the existing, already-committed `package-lock.json` (no new dependency added, no version resolution). This is standard environment setup, not the package-manager-install exclusion the deviation rules carve out (that exclusion targets *installing an unvetted new package name referenced by a plan task*, not restoring a lockfile-pinned `node_modules` in a fresh worktree).
- **Files modified:** None tracked (node_modules is gitignored)
- **Verification:** `npm test` went from 63 failed/13 passed suites to 76/76 passed, 1245/1245 tests, before any lint-cleanup edits were made — confirming the pre-existing baseline was green and any subsequent failure would be attributable to my edits.

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary to run the plan's own required verification (`npm test`) at all in this worktree. No scope creep — no dependency versions changed, lockfile untouched.

## Issues Encountered
- `npx eslint routes/ lib/ server.js --fix` made zero automatic changes (0 files touched) — ESLint's eqeqeq autofixer only fires for statically type-safe comparisons and does not touch `!= null` patterns. Task 1 therefore required manual, line-by-line review of all 19 sites, which confirmed every one was an intentional null/undefined check appropriate for suppression rather than autofix.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Middleware workspace (`routes/`, `lib/`, `server.js`) lints at a clean 0 problems, unblocking 53-06's `--max-warnings 0` CI gate flip with an already-audited zero-warning baseline.
- Full middleware test suite (76 suites / 1245 tests) verified green both before and after cleanup — no coverage floor regression observed.
- No blockers for downstream phase-53 plans.

---
*Phase: 53-money-path-observability-ci-gates*
*Completed: 2026-07-03*

## Self-Check: PASSED

- FOUND: `.planning/phases/53-money-path-observability-ci-gates/53-03-SUMMARY.md`
- FOUND commit `d4544b7` (Task 1: eqeqeq suppression)
- FOUND commit `e9c1bc5` (Task 2: no-unused-vars cleanup)
- FOUND commit `c9ba5e6` (this SUMMARY)
- Re-verified at self-check time: `eslint routes/ lib/ server.js` → 0 problems
- Re-verified at self-check time: `npm test` → 76/76 suites, 1245/1245 tests passed
