---
phase: 83-postgres-infrastructure
plan: 05
subsystem: database
tags: [postgres, testcontainers, jest, ci, node-pg-migrate, railway]

# Dependency graph
requires:
  - phase: 83-postgres-infrastructure (plan 02)
    provides: "lib/db.js — createPool()/query()/withTransaction()/isConfigured()/close(), reused directly by db.test.js"
  - phase: 83-postgres-infrastructure (plan 03)
    provides: "migrations/0001_init.sql (app_meta seed row), npm run migrate, test:db script entry in package.json"
provides:
  - "jest.db.config.js — isolated Testcontainers-backed Jest config, never run by npm test"
  - "__tests__/db/helpers/pg-harness.js — dockerAvailable/isCiEnv/shouldSkipDbTests/describeDb/startPostgres/applyMigrations/rollbackEachTest, the contract Plan 83-07's backfill test and Phases 84-88's DB tests build on"
  - "__tests__/db/db.test.js + migrations.test.js — real-Postgres proof of lib/db.js and 0001_init.sql (not yet run against real Postgres anywhere — see Verification Status)"
  - "npm run test:db wired into tests.yml and gated-deploy.yml's test-middleware job, no skip path (D-14)"
affects: [83-07 (backfill pipeline's own DB test reuses pg-harness.js), 83-08 (first staging/production deploy — CI proof of test:db happens there), Phases 84-88 (every future DB test reuses pg-harness.js)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "D-14 CI-never-skips gate: shouldSkipDbTests({docker, ci}) is a pure function (unit-tested with explicit booleans); describeDb() derives both inputs itself (dockerAvailable() execSync probe, isCiEnv() from process.env.CI) so the gate cannot be bypassed by a caller forgetting to pass ci:true"
    - "Lazy require of @testcontainers/postgresql inside startPostgres() only — importing pg-harness.js from the main suite never touches Docker or that package (verified via require.cache assertion)"
    - "node-pg-migrate invoked only as a CLI subprocess (child_process.spawnSync of node_modules/.bin/node-pg-migrate) — never require()'d, since v9 is ESM-only"
    - "Jest's non-verbose reporter swallows console.* output captured at collection time (outside any it()/test() block) — the D-14 skip notice uses process.stderr.write directly instead of console.warn so it is visible in plain npm run test:db output"

key-files:
  created:
    - zoho-middleware/jest.db.config.js
    - zoho-middleware/__tests__/db/helpers/pg-harness.js
    - zoho-middleware/__tests__/db-harness-gate.test.js
    - zoho-middleware/__tests__/db/db.test.js
    - zoho-middleware/__tests__/db/migrations.test.js
  modified:
    - zoho-middleware/jest.config.js
    - .github/workflows/tests.yml
    - .github/workflows/gated-deploy.yml

key-decisions:
  - "describeDb()'s skip notice writes directly to process.stderr instead of console.warn — Jest's default (non-verbose) reporter does not surface console output captured at collection time, which would have silently hidden the D-14 'skipped locally' message from a plain npm run test:db run and broken the plan's own verification command"
  - "rollbackEachTest's harness pool cleanup afterAll is registered BEFORE calling rollbackEachTest() itself, relying on Jest's documented reverse-order execution of afterAll hooks within a describe block, so the checked-out client is always released before its pool is ended"
  - "migrations.test.js's D-03 proof runs the broken migration against a SEPARATE freshly created database (broken_check) rather than the shared container database, so a transactional-apply failure can never pollute the pgmigrations table the other two tests in the same file assert against"

patterns-established:
  - "Every later phase's own Testcontainers-backed DB test imports __tests__/db/helpers/pg-harness.js directly — dockerAvailable/shouldSkipDbTests/describeDb/startPostgres/applyMigrations/rollbackEachTest is now the fixed contract (Plan 83-05's interfaces block), not to be reshaped per-phase"

requirements-completed: [DB-02]

# Metrics
duration: ~35min
completed: 2026-09-30
---

# Phase 83 Plan 05: Real-Postgres Jest Harness (Testcontainers) & CI Wiring Summary

**Testcontainers-backed Jest harness (`jest.db.config.js` + `__tests__/db/helpers/pg-harness.js`) isolated from the default `npm test` run, proving `lib/db.js` and `migrations/0001_init.sql` against a real Postgres, with a D-14 gate that skips locally without Docker but has no skip path on CI — wired into both `tests.yml` and `gated-deploy.yml`.**

## Performance

- **Duration:** ~35 min (commit span, plus context/research reading)
- **Tasks:** 3/3 complete (Task 1 `tdd="true"` RED→GREEN; Tasks 2 and 3 `type="auto"`)
- **Files modified:** 8 (5 created, 3 modified)

## Accomplishments

- `jest.db.config.js` — a Jest config Jest never picks up under `npm test` (`testMatch: __tests__/db/**/*.test.js`, `collectCoverage: false`, `testTimeout: 120000`, `maxWorkers: 2`); `jest.config.js` gained `testPathIgnorePatterns: ['/node_modules/', '<rootDir>/__tests__/db/']` with no other change (coverage thresholds byte-for-byte unchanged).
- `__tests__/db/helpers/pg-harness.js` — the full interface contract from the plan: `dockerAvailable()` (execSync `docker info` probe, never throws), `isCiEnv()` (derives CI from `process.env.CI` being non-empty and not the literal `'false'`), `shouldSkipDbTests({docker, ci})` (pure truth-table function), `describeDb(name, fn)` (the D-14 gate — `describe.skip` locally without Docker, plain `describe` otherwise, including on CI where a missing Docker lets the container-start step itself throw), `startPostgres()` (lazy `require('@testcontainers/postgresql')`, `postgres:16-alpine`), `applyMigrations(connectionString, {dir})` (CLI-only `spawnSync` of `node_modules/.bin/node-pg-migrate`, never `require()`'d), `rollbackEachTest(getPool)` (BEGIN/ROLLBACK per test on one checked-out client).
- `__tests__/db-harness-gate.test.js` — runs in the MAIN suite (no Docker needed): the full `shouldSkipDbTests` truth table (4 cases), CI derivation from `process.env.CI` (5 cases: unset, `'false'`, `''`, `'true'`, `'1'`), a `require.cache` assertion that `@testcontainers/postgresql` is never loaded by merely requiring the harness, and a `dockerAvailable()` smoke test. 12/12 passing.
- `__tests__/db/db.test.js` — inside `describeDb('lib/db.js against real Postgres', ...)`: simple round-trip, a hostile parameterised literal proving no SQL injection (ASVS V5, app_meta survives), `withTransaction` commit visible afterward, `withTransaction` rollback NOT visible afterward (error rethrown), the `0001_init` seed row present, and a nested `rollbackEachTest` describe proving per-test isolation (test A inserts into `app_meta`, test B asserts it is absent).
- `__tests__/db/migrations.test.js` — inside its own `describeDb(...)`: fresh apply exits 0 and `pgmigrations` matches `migrations/` exactly by name; a second apply is idempotent (0 new rows); the D-03 proof — a broken migration in a temp dir applied against a **separate** freshly created database exits non-zero and the broken file is never recorded (transactional apply).
- `npm run test:db` wired into both `.github/workflows/tests.yml` and `.github/workflows/gated-deploy.yml`'s `test-middleware` job, immediately after the existing `npm test` step, with no `if:`/`continue-on-error` — `ubuntu-latest` ships Docker, so CI has no skip path.

## Task Commits

1. **Task 1: Jest DB config, harness helper, CI-never-skips gate (D-14)**
   - `ae1239e5` test(83-05): add failing tests for pg-harness CI-never-skips gate (D-14) — RED, 12/12 failing, module missing
   - `6edc3048` feat(83-05): Jest DB config, pg-harness helper, CI-never-skips gate (D-14) — GREEN, 12/12 passing
2. **Task 2: Real-Postgres round-trip and migration tests**
   - `4f5c755a` feat(83-05): real-Postgres round-trip and migration tests (also fixes the console.warn→stderr visibility issue found while verifying Task 2 locally — see Deviations)
3. **Task 3: Run the DB suite on CI in both workflows**
   - `f0aa07ad` feat(83-05): run the real-Postgres suite in both CI workflows (D-14)

## Files Created/Modified

- `zoho-middleware/jest.db.config.js` — isolated Testcontainers-backed Jest config
- `zoho-middleware/jest.config.js` — `testPathIgnorePatterns` added, nothing else changed
- `zoho-middleware/__tests__/db/helpers/pg-harness.js` — the harness contract
- `zoho-middleware/__tests__/db-harness-gate.test.js` — main-suite unit tests for the D-14 gate (12 tests)
- `zoho-middleware/__tests__/db/db.test.js` — real-Postgres `lib/db.js` proof (6 top-level tests + 2 nested isolation tests)
- `zoho-middleware/__tests__/db/migrations.test.js` — real-Postgres migration pipeline proof (3 tests)
- `.github/workflows/tests.yml` — `npm run test:db` step added to `test-middleware`
- `.github/workflows/gated-deploy.yml` — same step added to its `test-middleware` job

## Decisions Made

- `describeDb()`'s skip notice uses `process.stderr.write` instead of `console.warn` (see Deviations — this is the fix, documented here as the decision going forward for any future harness message).
- `rollbackEachTest`'s pool-cleanup `afterAll` is registered in `db.test.js` **before** calling `rollbackEachTest()`, exploiting Jest's documented reverse-order execution of `afterAll` hooks at the same nesting level, so the checked-out client is always released before its dedicated pool is ended.
- `migrations.test.js`'s D-03 proof creates a throwaway `broken_check` database inside the same container rather than reusing the shared database — keeps the two earlier assertions (fresh-apply file list, idempotent re-apply) immune to the deliberately-broken migration's failure.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `console.warn`'s D-14 skip message was invisible in the plan's own verification command**
- **Found during:** Task 2 local verification (`npx jest --config jest.db.config.js 2>&1 | grep -q "skipped locally"`, run per the plan's Task 2 `<verify>` block and re-checked against Task 2's acceptance criteria)
- **Issue:** `describeDb()` (Task 1) called `console.warn(...)` to print the D-14 skip notice. Jest's default, non-verbose reporter only surfaces `console.*` output that was captured *during* a running `it()`/`test()`; `describeDb()` runs at collection time (inside a `describe()` body, before any test executes), so the warning was silently swallowed. Running `npx jest --config jest.db.config.js` (no `--verbose`) produced zero matches for `"skipped locally"` — the exact acceptance criterion in both this plan's Task 1 (`db-harness-gate.test.js passes`) and Task 2 (`Without Docker: ... output contains 'Docker not running — skipped locally'`) would have failed.
- **Fix:** Changed `describeDb()` to `process.stderr.write('[pg-harness] ' + message + '\n')` instead of `console.warn(...)`. Verified with `--verbose` that the message still prints in the same place (confirming the change is purely about default-reporter visibility, not a behavior change), then re-ran the plain (non-verbose) command and confirmed the grep now matches.
- **Files modified:** `zoho-middleware/__tests__/db/helpers/pg-harness.js`
- **Verification:** `npx jest --config jest.db.config.js 2>&1 | grep -q "skipped locally"` exits 0; `db-harness-gate.test.js` still 12/12 passing (no test asserted on the console mechanism specifically, so nothing broke); full middleware `npm test` still 121/121 suites.
- **Committed in:** `4f5c755a` (Task 2 commit — caught and fixed before that commit, not a follow-up)

---

**Total deviations:** 1 auto-fixed (Rule 1 — a bug in the plan's own Task 1 deliverable that would have broken Task 2's acceptance criteria).
**Impact on plan:** No scope creep — the fix makes the plan's own stated verification commands actually pass.

## Issues Encountered

**Docker is not available in this environment** (confirmed: `docker info` exits non-zero; this matches the orchestrator's stated expectation for this execution and the plan's own Task 2/Task 3 fallback instructions). Consequences, all expected and handled per D-14/the plan's own fallback text:

- `db-harness-gate.test.js` (main suite, no Docker required) runs for real: 12/12 passing.
- `__tests__/db/db.test.js` and `__tests__/db/migrations.test.js` correctly **skip** under `npm run test:db` (`npx jest --config jest.db.config.js`) — verified output: 2 suites skipped, 10 tests skipped, both skip messages present (`lib/db.js against real Postgres (Docker not running — skipped locally, runs on CI; D-14)` and `migrations/0001_init.sql against real Postgres (Docker not running — skipped locally, runs on CI; D-14)`).
- **Neither test file has ever actually executed its assertions against a real Postgres container anywhere.** The code paths (`startPostgres`, `applyMigrations` against a live container, the transaction commit/rollback, the D-03 broken-migration-against-a-separate-database proof) are reviewed and syntax-checked (`node -c`) but not runtime-proven. This is the one gap this plan cannot close locally — **the orchestrator must confirm on the FIRST CI run** (when these commits reach GitHub Actions via `tests.yml` or `gated-deploy.yml`) that `npm run test:db` actually passes with the expected ≥9 passing tests and 0 skipped, per this plan's own Task 2 acceptance criteria (`With Docker running: npm run test:db exits 0 with at least 9 passing tests ... and 0 skipped`). If the CI run surfaces a defect in `db.test.js`/`migrations.test.js` (e.g. a real API mismatch this dry-run review missed), that is a follow-up fix, not a regression in this plan's already-verified local behavior.

One flaky pre-existing test (`__tests__/redis-failclosed.test.js`, unrelated to Postgres/DB work — Redis rate-limiter fail-closed behavior) failed once under the full `npm test` run and passed both in isolation and on an immediate full-suite rerun. Not investigated further — out of scope per the scope-boundary rule (this plan touches no Redis code), and not reproducible.

## User Setup Required

None from this plan directly. Carried forward from earlier plans in this phase (83-01/83-02/83-03): both Railway Postgres databases must be provisioned and `DATABASE_URL`-linked before `preDeployCommand` (`npm run migrate`) runs for real on a staging/production deploy — unaffected by this plan.

**New, specific to this plan:** the real-Postgres CI proof is outstanding. Whoever pushes these commits (Plan 83-08 per the phase sequencing) should watch the first `tests.yml` (or `gated-deploy.yml`) run's "Postgres integration tests (Testcontainers, D-14)" step and confirm it is green, not just present.

## Next Phase Readiness

- `__tests__/db/helpers/pg-harness.js`'s full contract (`dockerAvailable`, `isCiEnv`, `shouldSkipDbTests`, `describeDb`, `startPostgres`, `applyMigrations`, `rollbackEachTest`) is live and ready for Plan 83-07's backfill pipeline DB test and every Phase 84-88 DB test to import directly — no reshaping expected.
- `npm run test:db` is wired into both CI workflows; nothing further needed there for this phase.
- Nothing pushed to any remote; nothing deployed. Staging/production deploys and the CI proof happen in Plan 83-08, per the phase plan.
- **Explicit carry-forward item for Plan 83-08 (or whoever runs the first CI pass):** confirm `npm run test:db` passes for real on CI (see Issues Encountered above) before treating DB-02 SC3 as fully proven.

## Verification Status

- `npm test` (middleware, no containers started): 121/121 suites, 1809/1809 tests green, locally reproduced multiple times.
- `npm run test:db` locally (no Docker): both DB test files correctly report as skipped with the D-14 message — this IS the expected/correct local behavior, not a workaround.
- `npm run test:db` against a real Testcontainers Postgres: **not run anywhere yet.** Confirm on the first CI push (Plan 83-08) — see Issues Encountered.
- Root `npm test` + both lints (`npm run lint` at root and in `zoho-middleware`): all green.

## Self-Check: PASSED

- FOUND: zoho-middleware/jest.db.config.js
- FOUND: zoho-middleware/jest.config.js
- FOUND: zoho-middleware/__tests__/db/helpers/pg-harness.js
- FOUND: zoho-middleware/__tests__/db-harness-gate.test.js
- FOUND: zoho-middleware/__tests__/db/db.test.js
- FOUND: zoho-middleware/__tests__/db/migrations.test.js
- FOUND: .github/workflows/tests.yml
- FOUND: .github/workflows/gated-deploy.yml
- FOUND: ae1239e5 (RED commit)
- FOUND: 6edc3048 (Task 1 GREEN commit)
- FOUND: 4f5c755a (Task 2 commit)
- FOUND: f0aa07ad (Task 3 commit)

---
*Phase: 83-postgres-infrastructure*
*Completed: 2026-09-30*
