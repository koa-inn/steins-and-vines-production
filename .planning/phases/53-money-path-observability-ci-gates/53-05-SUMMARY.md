---
phase: 53-money-path-observability-ci-gates
plan: 05
subsystem: infra
tags: [npm, ci, github-actions, jest, coverage, node, railway]

# Dependency graph
requires: []
provides:
  - Committed package-lock.json (root) and zoho-middleware/package-lock.json — npm ci works in both workspaces
  - Node 20 pinned via engines field + .nvmrc in both workspaces
  - .github/workflows/tests.yml installs via npm ci (not npm install) in all 3 jobs
  - docs/RUNBOOK.md documents the Railway npm ci auto-detect side effect
  - zoho-middleware/jest.config.js enforces a calibrated routes/pos.js coverage floor (80%)
affects: [53-money-path-observability-ci-gates other plans, future dependency/CI changes]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Committed lockfiles + npm ci everywhere (deterministic installs, no floating deps)"
    - "engines.node + .nvmrc dual-pin convention (root and zoho-middleware)"
    - "Per-file jest coverage floor calibrated ~1pt below measured coverage, self-documenting comment"

key-files:
  created:
    - .nvmrc
    - zoho-middleware/.nvmrc
    - package-lock.json
    - zoho-middleware/package-lock.json
  modified:
    - .gitignore
    - package.json
    - zoho-middleware/package.json
    - .github/workflows/tests.yml
    - docs/RUNBOOK.md
    - zoho-middleware/jest.config.js

key-decisions:
  - "Removed package-lock.json from root .gitignore (was blocking the lockfile from ever being tracked) — Rule 3 blocking-issue auto-fix, in scope of D-07's must_have"
  - "Regenerated both lockfiles fresh via npm install (worktree had no node_modules/lockfiles on disk, unlike the plan's measured baseline) rather than assuming pre-existing files"
  - "routes/pos.js floor set to 80 (measured 81.08%, ~1pt headroom) per D-10 discretion note"

patterns-established:
  - "Dual Node pin: engines.node in package.json + matching .nvmrc, both workspaces"

requirements-completed: [OBS-01]

# Metrics
duration: ~15min
completed: 2026-07-03
---

# Phase 53 Plan 05: CI/Build Dependency Gates Summary

**Committed lockfiles for both workspaces, pinned Node 20 (engines + .nvmrc), switched CI installs to `npm ci`, documented the resulting Railway install-command auto-detect in the RUNBOOK, and added a calibrated `routes/pos.js` coverage floor (80%, measured 81.08%).**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-07-03T15:36:07Z
- **Tasks:** 3/3 completed
- **Files modified:** 10 (4 new: `.nvmrc` x2, both `package-lock.json`; 6 modified: `.gitignore`, both `package.json`, `tests.yml`, `RUNBOOK.md`, `jest.config.js`)

## Accomplishments
- Both `package-lock.json` files are now tracked in git and `npm ci` succeeds cleanly against each (verified twice, including a final re-verify after all commits)
- Node 20 pinned via `engines.node: "20.x"` + `.nvmrc` in root and `zoho-middleware`
- `.github/workflows/tests.yml` installs deterministically via `npm ci` in all 3 jobs that install dependencies (test-middleware, test-frontend, test-e2e) — zero `npm install` occurrences remain
- `docs/RUNBOOK.md` documents that Railway's Nixpacks builder now auto-detects `npm ci` because the middleware lockfile is committed, and warns that deleting the lockfile would silently revert Railway to `npm install`
- `zoho-middleware/jest.config.js` gained a net-new `./routes/pos.js: { lines: 80 }` coverage floor (measured 81.08%) — the money-path `pos.js` file can no longer silently regress in coverage
- Full test suites re-verified green throughout: 947/947 frontend tests, 1239/1239 middleware tests (including with the new pos.js floor enforced), lint clean (0 errors, pre-existing warning counts unchanged: 125 root / 60 middleware — both out of scope for this plan)

## Task Commits

Each task was committed atomically:

1. **Task 1: Pin Node 20 (engines + .nvmrc) and commit both lockfiles** - `b84f5ea` (feat)
2. **Task 2: Switch CI to npm ci + document Railway side effect** - `0161386` (feat)
3. **Task 3: Add routes/pos.js coverage floor (D-10 / L13)** - `b35cd69` (feat)

**Plan metadata:** (this commit, made by orchestrator after wave merge)

## Files Created/Modified
- `.nvmrc` - Node 20 pin (root), single line `20`
- `zoho-middleware/.nvmrc` - Node 20 pin (middleware), single line `20`
- `package-lock.json` - Committed root lockfile (generated fresh via `npm install`, no dependency version changes — matches existing `package.json`)
- `zoho-middleware/package-lock.json` - Committed middleware lockfile (same generation method)
- `.gitignore` - Removed `package-lock.json` entry that was preventing the root lockfile from ever being tracked
- `package.json` - Added `"engines": { "node": "20.x" }`
- `zoho-middleware/package.json` - Added `"engines": { "node": "20.x" }`
- `.github/workflows/tests.yml` - 3× `npm install` → `npm ci` (test-middleware working-directory step, test-frontend root step, test-e2e root step)
- `docs/RUNBOOK.md` - New note under Overview documenting the Railway `npm ci` auto-detect side effect and the risk of deleting the lockfile
- `zoho-middleware/jest.config.js` - Net-new `'./routes/pos.js': { lines: 80 }` entry in `coverageThreshold`, following the existing per-file comment convention

## Decisions Made
- Root `.gitignore` had a `package-lock.json` line that silently prevented the lockfile from ever being committed. This is the direct blocker for the plan's core must_have ("package-lock.json committed for both root and middleware — D-07"), so it was removed as part of Task 1 (Rule 3 — blocking-issue auto-fix). Not called out separately in the plan's `files_modified` list, but squarely inside D-07's scope.
- The plan's `<measured_baseline>` stated both lockfiles already existed on disk (untracked). In this worktree, neither lockfile nor `node_modules/` existed at all (fresh worktree checkout). Regenerated both via a plain `npm install` in each workspace (equivalent to `npm install --package-lock-only` for lockfile purposes, and also needed to populate `node_modules` so tests/lint/coverage could run locally to verify the plan's other tasks) — no dependency version changes, matches each `package.json` exactly.
- `routes/pos.js` line coverage re-measured at 81.08% (matches the plan's pre-recorded baseline exactly), so the floor was set to 80 per the plan's explicit guidance, no re-derivation needed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Removed `package-lock.json` from root `.gitignore`**
- **Found during:** Task 1 (commit both lockfiles)
- **Issue:** `.gitignore` line 25 (`package-lock.json`) meant `git add package-lock.json` would have been silently ignored, blocking the entire D-07 must_have (lockfile commit) — a hard blocker to completing the task as written.
- **Fix:** Removed the `package-lock.json` line from `.gitignore` (kept `node_modules/`). No other `.gitignore` entries touched.
- **Files modified:** `.gitignore`
- **Verification:** `git ls-files package-lock.json zoho-middleware/package-lock.json` lists both after commit.
- **Committed in:** `b84f5ea` (Task 1 commit)

**2. [Rule 3 - Blocking] Generated both lockfiles from scratch (npm install, not just `--package-lock-only`)**
- **Found during:** Task 1
- **Issue:** Plan's measured baseline assumed both lockfiles existed on disk already; this worktree had neither the lockfiles nor `node_modules/` installed at all, so no verification (tests, lint, coverage) was possible without first installing.
- **Fix:** Ran a full `npm install` (root) and `npm install` (zoho-middleware) — this both generates the lockfile and populates `node_modules` needed for the rest of the plan's verification steps. No dependency versions changed vs. each `package.json`'s existing semver ranges.
- **Files modified:** `package-lock.json`, `zoho-middleware/package-lock.json`
- **Verification:** `npm ci` succeeds cleanly against both committed lockfiles (re-verified after all 3 task commits).
- **Committed in:** `b84f5ea` (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 3 — blocking issues, both prerequisite to completing Task 1 as specified)
**Impact on plan:** No scope creep — both fixes were strictly necessary to land the plan's own must_haves. No dependency versions changed, no new packages added (per the threat model's T-53-SC disposition).

## Issues Encountered
None beyond the two blocking-issue auto-fixes documented above.

## User Setup Required

None — no external service configuration required. The Railway install-command switch to `npm ci` is fully automatic (Nixpacks auto-detects lockfile presence) and is documented in `docs/RUNBOOK.md` for future reference; no action needed by the owner.

## Next Phase Readiness
- CI now installs deterministically (`npm ci`) in every job, both lockfiles are committed and verified npm-ci-clean, Node 20 is pinned in both workspaces, and `routes/pos.js` has a coverage floor that will fail CI if money-path coverage regresses.
- This plan is independent of the Sentry observability work and lint-cleanup work in the same phase (wave 1) — no blockers for those plans.
- Full middleware + frontend test suites confirmed green after all changes (947 + 1239 tests), so this plan does not block phase-level verification.

---
*Phase: 53-money-path-observability-ci-gates*
*Completed: 2026-07-03*
