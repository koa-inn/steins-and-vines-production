---
phase: 53-money-path-observability-ci-gates
plan: 06
subsystem: infra
tags: [eslint, npm, lint, ci-gates, es5]

# Dependency graph
requires:
  - phase: 53-03
    provides: middleware eslint cleanup (0 warnings)
  - phase: 53-04
    provides: frontend eslint cleanup (0 warnings) + ES6 syntax removal
  - phase: 53-05
    provides: engines/.nvmrc package.json edits
provides:
  - Both npm lint scripts enforce --max-warnings 0 (CI gate is live, not decorative)
  - Root eslint.config.js js/ block enforces ecmaVersion 5 (ES5-only frontend, D-06)
affects: [ci-workflow, future-frontend-js-changes]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Lint gate flip is a config-only, isolated commit sequenced last after all prerequisite cleanups land"
    - "ecmaVersion split by workspace: root js/ = 5 (ES5, iPad Safari + vanilla JS constraint), middleware = 2020 (legit await/const)"

key-files:
  created: []
  modified:
    - package.json
    - zoho-middleware/package.json
    - eslint.config.js

key-decisions:
  - "--max-warnings 0 added via the lint script string in each package.json (not a tests.yml edit) — CI's existing `npm run lint` steps in both jobs inherit the gate automatically with no workflow change"
  - "zoho-middleware/eslint.config.js left untouched at ecmaVersion 2020 per D-06 — middleware legitimately uses await/const"

requirements-completed: [OBS-01]

# Metrics
duration: ~15min
completed: 2026-07-03
---

# Phase 53 Plan 06: Lint Gate Flip (--max-warnings 0 + ES5) Summary

**Flipped the lint CI gate from decorative to enforcing: both npm lint scripts now fail on any warning, and the frontend eslint config rejects ES6 syntax — landed as a clean, green diff on top of the 53-03/53-04/53-05 cleanups.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-03T15:58:00Z (approx)
- **Completed:** 2026-07-03T16:13:31Z
- **Tasks:** 2/2 completed
- **Files modified:** 3

## Accomplishments
- `npm run lint` (root) and `cd zoho-middleware && npm run lint` both now exit non-zero on any single warning (`--max-warnings 0`)
- Root `eslint.config.js` js/ block enforces `ecmaVersion: 5` — ES6 syntax (const/let/arrow functions/optional chaining) is now a hard parse error, matching the project's vanilla-ES5 constraint (CLAUDE.md)
- Middleware `eslint.config.js` confirmed untouched at `ecmaVersion: 2020` (await/const remain legal there)
- Both gates verified GREEN today (precheck + post-change), and both negative checks (injected warning, injected `const`) confirmed the gate actually fires before being reverted
- Full test suites re-verified green after the config changes: frontend 947/947 (53 suites), middleware 1245/1245 (76 suites) — no behavior regression from a lint-only change

## Task Commits

Each task was committed atomically:

1. **Task 1: Enforce --max-warnings 0 on both lint scripts** - `a016d8b` (feat)
2. **Task 2: Enforce ES5 on the frontend eslint block** - `4bd21e1` (feat)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified
- `package.json` - root `scripts.lint`: `eslint js/` → `eslint js/ --max-warnings 0`
- `zoho-middleware/package.json` - middleware `scripts.lint`: `eslint routes/ lib/ server.js` → `eslint routes/ lib/ server.js --max-warnings 0`
- `eslint.config.js` - root `js/**/*.js` block: `ecmaVersion: 2020` → `ecmaVersion: 5`

## Decisions Made
- `--max-warnings 0` implemented as a CLI flag appended to each `package.json` lint script rather than a `.github/workflows/tests.yml` edit — the existing `Lint frontend`/`Lint middleware` CI steps already invoke `npm run lint`, so they inherit the gate with zero workflow changes, per the plan's interface note.
- No change to `zoho-middleware/eslint.config.js` — confirmed it must stay `ecmaVersion: 2020` (D-06) since the middleware legitimately uses `await`/`const`; only the root frontend block was touched.

## Deviations from Plan

None - plan executed exactly as written. Both tasks' precheck, edit, verify, and negative-check steps were followed literally as specified in the plan.

One environment note (not a deviation from the plan's instructions, just a setup step needed to run the full verification): `zoho-middleware/node_modules` was absent in this fresh worktree (gitignored, not present in worktree checkout). Ran `npm ci` in `zoho-middleware/` to install from the existing lockfile before running `npm test` there — this is dependency installation from an already-committed lockfile, not a new package addition, so it falls outside the Rule 3 package-manager-install exclusion. No `package.json`/`package-lock.json` changes resulted.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required. This plan is CI-config-only; the next `git push` will exercise the flipped gate in GitHub Actions on the existing `test-frontend`/`test-middleware` jobs.

## Next Phase Readiness
- OBS-01 (Phase 53's H-7 target) is now closed: `--max-warnings 0` (D-05/L12) and ES5 enforcement (D-06) are both live and green.
- This was the last plan in Phase 53's wave 4 (depends_on 53-03/53-04/53-05, all satisfied). No blockers for phase wrap-up.
- CI will now fail hard on any future warning or ES6 construct introduced in `js/**/*.js`, and any warning in `zoho-middleware/{routes,lib}/**` or `server.js` — this is intentional, ongoing enforcement, not a one-time check.

---
*Phase: 53-money-path-observability-ci-gates*
*Completed: 2026-07-03*

## Self-Check: PASSED

- FOUND: package.json
- FOUND: zoho-middleware/package.json
- FOUND: eslint.config.js
- FOUND: a016d8b
- FOUND: 4bd21e1
