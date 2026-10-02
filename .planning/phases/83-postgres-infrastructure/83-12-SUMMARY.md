---
phase: 83-postgres-infrastructure
plan: 12
subsystem: database
tags: [postgres, backfill, data-integrity, jest, testcontainers]

# Dependency graph
requires:
  - phase: 83-postgres-infrastructure
    provides: "83-07's backfill CLI (read -> normalise -> rejects -> scratch -> checks -> promote) and its runChecks/promote/runBackfill contracts"
provides:
  - "Header-drift abort in backfill.js: runBackfill now compares spec.columns[].header against the sheet's actual row-1 headers right after readSheet, aborting with EXIT.ERROR before normalise/rejects/connect when any required or optional spec header is missing or renamed"
  - "read_vs_accepted check in load.js runChecks: fails when rows were read but none were accepted, closing the vacuous-PASS path for a 100%-rejected sheet"
  - "Empty-scratch refusal in load.js promote: refuses to run when the scratch table has 0 rows, before it ever checks or touches the target"
  - "Two new regression test files: __tests__/backfill/backfill-gates.test.js (Docker-free) and __tests__/db/backfill-gates.test.js (real Postgres via Testcontainers)"
affects: [84-gift-cards-postgres-store, backfill-pipeline, migration-guard-hardening]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "checkHeaders(spec, sheetHeaders) exact case-sensitive comparison, run once right after readSheet, before any normalise/load/connect step"
    - "read_vs_accepted as a zero-query, JS-only check pushed as the first runChecks result, parallel to the existing row_count/null_count/min/max/true_count checks"
    - "promote() precondition checks (source non-empty, target exists, target empty) all run OUTSIDE the transaction, in sequence, before BEGIN"

key-files:
  created:
    - zoho-middleware/__tests__/backfill/backfill-gates.test.js
    - zoho-middleware/__tests__/db/backfill-gates.test.js
  modified:
    - zoho-middleware/scripts/backfill/backfill.js
    - zoho-middleware/scripts/backfill/load.js
    - zoho-middleware/scripts/backfill/README.md

key-decisions:
  - "checkHeaders runs once per runBackfill call, immediately after readSheet resolves, before step [2/6] Normalise — this is the earliest point sheetResult.headers is available and the only point before any row data is touched"
  - "read_vs_accepted is computed entirely in JS from the `read` and `rows.length` already available to runChecks — no new query, keeping D-13's 'never trust the load, compute expected independently' pattern intact"
  - "promote's new empty-scratch check runs before the existing to_regclass/target-empty checks (all still outside BEGIN), so the error precedence is: empty scratch -> missing target -> non-empty target -> insert"
  - "read defaults to rows.length when the caller omits it, preserving back-compat for __tests__/db/backfill.test.js's existing direct runChecks calls (left unmodified per CLAUDE.md rule 10)"

patterns-established:
  - "Header-label-only logging (never cell values) for any new terminal output, consistent with D-13 — commented inline where added"

requirements-completed: [DB-02]

# Metrics
duration: ~25min
completed: 2026-10-02
---

# Phase 83 Plan 12: Backfill zero-row and header-drift gate closure Summary

**Closed REVIEW CR-04 / VERIFICATION gap 3: backfill checks and promote now fail on a sheet that loaded nothing or lost/renamed a spec column, instead of silently passing.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-10-02
- **Tasks:** 2 (both TDD: RED test commit, GREEN implementation commit)
- **Files modified:** 5 (2 created, 3 modified)

## Accomplishments

- `runBackfill` now aborts with `EXIT.ERROR` (1) immediately after reading the snapshot if any spec header — required or optional — is missing from the sheet's row-1 headers, naming the missing header(s) and listing any unmapped sheet headers. A renamed or missing OPTIONAL column (which previously loaded as all-NULL and passed every check) can no longer slip through.
- `runChecks` gained a `read_vs_accepted` check: 0 accepted of N read now gives `Checks: FAIL — read_vs_accepted` and exit 3, not `Checks: PASS`.
- `promote()` now refuses to run against an empty scratch table (`scratch table <schema>.<table> is empty — nothing to promote`) before it ever touches the target. `--promote --accept-rejects` on a 100%-rejected sheet can no longer exit 0 having promoted 0 rows.
- Two new regression test files close the gap the verifier flagged ("no test covers either path"): a Docker-free header-drift/wiring suite and a real-Postgres suite covering `read_vs_accepted`, the empty-scratch promote refusal, and a full 100%-rejected end-to-end run.

## Task Commits

Each task followed RED -> GREEN:

1. **Task 1: Abort on spec-header drift right after reading the snapshot**
   - RED: `9c25920f` test(83-12): add failing tests for backfill spec-header drift
   - GREEN: `5283bf67` fix(83-12): abort backfill when spec headers are missing from the sheet (CR-04)
2. **Task 2: read_vs_accepted check + promote refuses an empty scratch table**
   - RED: `69d11b65` test(83-12): add failing tests for zero-accepted checks and empty-scratch promote
   - GREEN: `69cb7d63` fix(83-12): fail checks on zero accepted rows and refuse empty-scratch promote (CR-04)

_Note: this plan's worktree branch started behind the orchestrator's expected base commit (8c90a03a); the `<worktree_branch_check>` fast-forward reset ran cleanly (HEAD was a strict ancestor of the target, not diverged) before any task work began._

**Plan metadata commit:** intentionally NOT made by this agent — per the parallel-execution contract, STATE.md/ROADMAP.md updates and the final metadata commit are the orchestrator's responsibility after all wave agents complete.

## Files Created/Modified

- `zoho-middleware/scripts/backfill/backfill.js` — added `checkHeaders(spec, sheetHeaders)`; wired the header-drift abort into `runBackfill`'s `readSheet().then()` before step `[2/6]`; passes `read: counts.read` into `load.runChecks(...)`.
- `zoho-middleware/scripts/backfill/load.js` — `runChecks` now takes an optional `read` and pushes a `read_vs_accepted` result ahead of `row_count`; `promote` now runs a `count(*)` on the scratch table before the existing target checks and throws if it's 0.
- `zoho-middleware/scripts/backfill/README.md` — documented the header-drift abort and its exit-1 row in the exit-code table; documented `read_vs_accepted` in the Checks result-line description; added "or the scratch table is empty" to the promotion-refusal sentence.
- `zoho-middleware/__tests__/backfill/backfill-gates.test.js` (new) — Docker-free: 4 header-drift cases (missing optional column, renamed required column, extra column with/without dryRun) plus 1 case asserting `load.runChecks.mock.calls[0][1].read === 1`.
- `zoho-middleware/__tests__/db/backfill-gates.test.js` (new) — real Postgres via Testcontainers: `read_vs_accepted` fails on 0-accepted/N-read, passes on read=0 and on a clean load, defaults correctly when omitted; `promote` rejects on an empty scratch table with the target left at 0 rows; a full `runBackfill` end-to-end run on a 3-row, 100%-rejected (`timestamp: 'not-a-real-date'`) fixture with `--promote --accept-rejects` exits `CHECKS_FAILED` (3), never reaches `[6/6] Promote`, and leaves the target at 0 rows.

## Decisions Made

- `checkHeaders` does an exact, case-sensitive string comparison with no normalisation beyond what `readSheet` already does (trim) — matches the plan's interface note and avoids a new class of near-miss header matching bugs.
- The empty-scratch check in `promote()` was placed as the very first precondition (before `to_regclass`), so a caller gets the most specific error (`is empty — nothing to promote`) rather than a less informative "target does not exist" when both conditions happen to be true in a test.
- Left `__tests__/db/backfill.test.js` and `__tests__/backfill/cli-checks-output.test.js` / `cli-args.test.js` completely untouched, per CLAUDE.md rule 10 and the plan's explicit `git diff --exit-code 677162fe` acceptance criteria — verified with `git diff --exit-code 677162fe -- <paths>` after every change.

## Deviations from Plan

None - plan executed exactly as written. `zoho-middleware/node_modules` was absent in this freshly-created worktree; ran `npm ci` there before any test command, consistent with the parallel-execution setup instructions (not a plan deviation).

## Issues Encountered

None. Docker was available locally, so `CI=true npx jest --config jest.db.config.js` ran for real (not skipped) and gave 32/32 passing, 0 skipped, including the 2 pre-existing suites (`backfill.test.js`, `migrations.test.js`, `db.test.js`) left unmodified plus the new `backfill-gates.test.js`.

## User Setup Required

None - no external service configuration required.

## Verification Evidence

- `cd zoho-middleware && npx jest __tests__/backfill/` — 8 suites / 88 tests passed.
- `cd zoho-middleware && CI=true npx jest --config jest.db.config.js` — 4 suites / 32 tests passed, 0 skipped (real Postgres via Testcontainers, Docker confirmed running).
- `cd zoho-middleware && npm test` — 130 suites / 1899 tests passed.
- `cd /Users/koa/dev/steins-and-vines-website && npm test` — 141 suites / 2048 tests passed (frontend, unaffected by this plan but run per CLAUDE.md rule 1).
- `npm run lint` (root, frontend `js/`) and `cd zoho-middleware && npm run lint` (`routes/ lib/ server.js`) both clean. Note: neither lint config covers `zoho-middleware/scripts/` or `__tests__/`, so this plan's changed files aren't linted by either script — consistent with the existing repo setup (not introduced by this plan).
- `grep -n "sheetResult.headers" zoho-middleware/scripts/backfill/backfill.js` → 1 match (verifier's "no `headers` reference" finding closed; a second match is in the explanatory comment above it).
- `grep -c "missing from the sheet" zoho-middleware/scripts/backfill/README.md` → 1.
- `grep -c "read_vs_accepted" zoho-middleware/scripts/backfill/load.js` → 2; `grep -n "read: counts.read" zoho-middleware/scripts/backfill/backfill.js` → 1 match.
- `grep -n "is empty — nothing to promote" zoho-middleware/scripts/backfill/load.js` → 1 match.
- `git diff --exit-code 677162fe -- zoho-middleware/__tests__/backfill/cli-checks-output.test.js zoho-middleware/__tests__/backfill/cli-args.test.js zoho-middleware/__tests__/db/backfill.test.js` → clean (all three pre-existing test files unchanged).
- Post-commit deletion check (`git diff --diff-filter=D --name-only HEAD~1 HEAD`) ran after every task commit — no unexpected deletions.

## Next Phase Readiness

- Verification gap 3 (REVIEW CR-04 / VERIFICATION.md "Promotion is blocked when checks fail") can now be re-verified as VERIFIED: a sheet that loaded nothing or lost/renamed a spec column can no longer produce `Checks: PASS` or a silent 0-row promote.
- This plan does not touch CR-01/CR-02 (migration guard bypasses) or CR-03 (normaliser coercion) — those are gaps 1 and 2, owned by sibling plans 83-10 and 83-11 running in parallel in their own worktrees on disjoint files.
- No blockers for Phase 84. The backfill pipeline's promote gate is now provably non-vacuous for the empty/lost-column failure class that actually occurred in the 83-08 rehearsal.

---
*Phase: 83-postgres-infrastructure*
*Completed: 2026-10-02*
