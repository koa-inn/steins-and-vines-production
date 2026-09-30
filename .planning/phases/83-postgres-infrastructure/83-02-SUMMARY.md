---
phase: 83-postgres-infrastructure
plan: 02
subsystem: database
tags: [postgres, pg, node-pg-migrate, testcontainers, express, railway, health-check]

# Dependency graph
requires:
  - phase: 83-postgres-infrastructure (plan 01)
    provides: DATABASE_URL provisioning checklist, RAILWAY_ENVIRONMENT_NAME confirmation (docs/RUNBOOK.md)
provides:
  - "lib/db.js — the single Postgres gateway (Pool/query/withTransaction/isConfigured/createPool/sslConfigFor/redactConnectionString/close), unit-tested against a mocked pg"
  - "DATABASE_URL required in production via validateEnv.js (D-01)"
  - "GET /health database boolean field, status never flips (D-02)"
affects: [83-03 (migrations), 83-05 (store-flag/dual-write helper), 83-07 (backfill pipeline), Phase 84+ (first real store reads from lib/db.js)]

# Tech tracking
tech-stack:
  added: ["pg@^8.23.1 (prod dep)", "node-pg-migrate@^9.0.0 (prod dep, CLI-only, never required)", "testcontainers@12.0.4 (dev, exact pin)", "@testcontainers/postgresql@12.0.4 (dev, exact pin)"]
  patterns: ["lazy-singleton optional backing service (mirrors lib/cache.js's isConnected()/getClient() shape)", "Promise.race with a clearTimeout'd timer for a bounded-latency health probe", "never-throw pool 'error' handler reporting via lib/sentry-capture.js's captureExceptionSafe"]

key-files:
  created:
    - zoho-middleware/lib/db.js
    - zoho-middleware/__tests__/db-lib.test.js
    - zoho-middleware/__tests__/health-database.test.js
  modified:
    - zoho-middleware/package.json
    - zoho-middleware/package-lock.json
    - zoho-middleware/lib/validateEnv.js
    - zoho-middleware/__tests__/validateEnv.test.js
    - zoho-middleware/server.js

key-decisions:
  - "createPool() merges caller opts over a { max: 5, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000 } base via Object.assign, so the backfill CLI/Testcontainers harness (Plans 83-03/83-05/83-07) can override without re-deriving SSL branching"
  - "sslConfigFor only relaxes rejectUnauthorized for *.proxy.rlwy.net hosts (Railway's public TCP proxy) — private DATABASE_URL and localhost get no SSL config at all"
  - "checkDatabase() in server.js clears its own setTimeout once the query settles either way, so a healthy pool never leaves a dangling timer"

patterns-established:
  - "Optional backing service: isConfigured()/isConnected() lets callers probe without throwing; module load never touches the network (lazy pool construction on first query/withTransaction call)"
  - "Pool 'error' listener is mandatory on every Pool construction (createPool, not just the shared singleton) — an unhandled idle-client error crashes Node"

requirements-completed: [DB-02]

# Metrics
duration: ~25min
completed: 2026-09-30
---

# Phase 83 Plan 02: Postgres Client Library & Health/Boot Wiring Summary

**`lib/db.js` — the single Postgres gateway (Pool/query/withTransaction) every later v4.9 phase reuses — wired into the production boot gate (D-01) and `/health`'s new `database` field (D-02), both fully unit-tested against a mocked `pg`.**

## Performance

- **Duration:** ~25 min (commit span 12:19:34–12:23:33 PDT; includes prior research/context reading)
- **Started:** 2026-09-30T19:19:34Z
- **Completed:** 2026-09-30T19:23:33Z
- **Tasks:** 3 completed (all `type="auto" tdd="true"`)
- **Files modified:** 8 (3 created, 5 modified)

## Accomplishments
- `lib/db.js` is now the only module in the codebase allowed to import `pg` — one lazily-created `Pool`, `query()`, `withTransaction(fn)` (BEGIN/COMMIT/ROLLBACK with release() guaranteed on every path and a ROLLBACK failure never masking the original error), `isConfigured()`, `createPool()`, `sslConfigFor()`, `redactConnectionString()`, `close()` — 15/15 unit tests against a mocked `pg`, 95.55% line coverage
- Production refuses to boot without `DATABASE_URL` (D-01); local dev and CI are unaffected — 32/32 `validateEnv` tests passing including 2 new
- `GET /health` reports a boolean `database` field raced against a 3s timeout (cleared on settle) — `status` never flips, matching the existing Redis/Zoho-auth "report, don't fail" treatment (D-02) — 5/5 new tests passing
- `pg`, `node-pg-migrate`, `testcontainers@12.0.4`, `@testcontainers/postgresql@12.0.4` installed per Research's exact pins; `npm audit --audit-level=high --omit=dev` exits 0

## Task Commits

Each task followed the plan's RED/GREEN TDD cycle with separate commits:

1. **Task 1: Install Postgres deps and build lib/db.js with unit tests**
   - `c17587b5` chore(83-02): install pg, node-pg-migrate, testcontainers deps
   - `b9681a14` test(83-02): add failing tests for lib/db.js (RED — 15/15 failing, module missing)
   - `92d77487` feat(83-02): implement lib/db.js single Postgres pool/query/transaction (GREEN — 15/15 passing)
2. **Task 2: Require DATABASE_URL in production (D-01)**
   - `8349b193` test(83-02): add failing tests for DATABASE_URL boot gate (D-01) (RED — 1 new test failing, 31 pre-existing unaffected)
   - `2c230b05` feat(83-02): require DATABASE_URL in production (D-01) (GREEN — 32/32 passing)
3. **Task 3: Report the database on /health without flipping status (D-02)**
   - `e78592d3` test(83-02): add failing tests for /health database field (D-02) (RED — 5/5 failing)
   - `abcabd0e` feat(83-02): report database on /health without flipping status (D-02) (GREEN — 5/5 passing)

_No separate "plan metadata" commit — SUMMARY.md is committed as part of this plan's final commit per worktree protocol._

## Files Created/Modified
- `zoho-middleware/lib/db.js` — the single Postgres gateway (Pool/query/withTransaction/isConfigured/createPool/sslConfigFor/redactConnectionString/close)
- `zoho-middleware/__tests__/db-lib.test.js` — 15 tests against a mocked `pg`
- `zoho-middleware/lib/validateEnv.js` — `DATABASE_URL` appended to `REQUIRED_IN_PROD`
- `zoho-middleware/__tests__/validateEnv.test.js` — `DATABASE_URL` added to `PROD_SECRETS` + 2 new tests + 2 existing-fixture `setEnv()` extensions (see Deviations)
- `zoho-middleware/server.js` — `var db = require('./lib/db')` alongside the other lib requires; `checkDatabase()` helper; `/health` gains `database: results[1]`
- `zoho-middleware/__tests__/health-database.test.js` — 5 tests against a mocked `lib/db`, supertest against the exported app
- `zoho-middleware/package.json`, `zoho-middleware/package-lock.json` — new deps

## Decisions Made
- `createPool(connectionString, opts)` merges caller `opts` over the base pool config (`max: 5`, `idleTimeoutMillis: 30000`, `connectionTimeoutMillis: 5000`) via `Object.assign` — keeps the SSL-branching logic in one place for the backfill CLI and Testcontainers harness that Plans 83-03/83-05/83-07 will build on `createPool()` directly
- `checkDatabase()` in `server.js` is a named helper (not inlined in the route) so the 3s-timeout-with-clearTimeout logic is easy to read and reuse if Phase 84 ever needs the same bounded-probe shape elsewhere

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Header comments couldn't literally spell `require('pg')` / `require('node-pg-migrate')`**
- **Found during:** Task 1 verification
- **Issue:** The plan's acceptance criteria requires `grep -rn "require('pg')" zoho-middleware/lib zoho-middleware/routes zoho-middleware/server.js` to return **exactly one line** (the real `require`) and the equivalent `node-pg-migrate` grep to return **nothing**. My first draft of `lib/db.js`'s header comment used the literal strings `require('pg')` and `require('node-pg-migrate')` in prose, which matched the grep and would have failed both criteria (3 lines instead of 1; 1 line instead of 0).
- **Fix:** Reworded the comments to describe the constraint ("allowed to import the `pg` package" / "never import `node-pg-migrate`") without using the exact parenthesized call syntax.
- **Files modified:** `zoho-middleware/lib/db.js`
- **Verification:** Re-ran both greps — 1 line (the real import) and 0 lines respectively; re-ran `db-lib.test.js` (15/15 still passing)
- **Committed in:** `92d77487` (Task 1 GREEN commit)

**2. [Rule 1 - Bug] Plan's literal "append to PROD_SECRETS array" instruction was insufficient to keep existing tests green**
- **Found during:** Task 2, RED verification
- **Issue:** The plan's action text said the only permitted edit was appending `'DATABASE_URL'` to the `PROD_SECRETS` fixture array. That array, however, is only consumed by `clearEnv(PROD_SECRETS)` in the outer `beforeEach` — it is never used to populate the literal `setEnv({...})` objects that three pre-existing tests use to assert "does NOT exit when all prod secrets are present." Appending only to the array (without touching those objects) would make DATABASE_URL required-in-prod but never supplied in those fixtures, breaking 3 previously-green tests as an unintended side effect of a plan whose file-diff prediction didn't account for how the fixture is actually wired.
- **Fix:** In addition to the array append, added `DATABASE_URL: 'postgresql://test:test@localhost:5432/testdb'` to the two literal `setEnv({...})` objects (D-06 describe's `beforeEach`, and the D-02 describe's "RAILWAY_ENVIRONMENT set and NODE_ENV=production" test) that assert "no exit with all prod secrets present." Zero existing assertions, test names, or lines were removed — only additive lines plus the two new D-01 tests specified by the plan.
- **Files modified:** `zoho-middleware/__tests__/validateEnv.test.js`
- **Verification:** Full `validateEnv.test.js` suite (32/32 passing, all 30 pre-existing assertions unchanged) plus full middleware suite (116/116 suites, 1727/1727 tests) and lint clean
- **Committed in:** `8349b193` (RED) / `2c230b05` (GREEN)

---

**Total deviations:** 2 auto-fixed (both Rule 1 — corrections needed for the plan's own acceptance criteria/fixture assumptions to hold, not scope changes)
**Impact on plan:** No scope creep. Both fixes were required for the plan's own stated acceptance criteria to actually pass; without them, either the grep checks or three pre-existing tests would have failed.

## Issues Encountered
None beyond the two deviations above.

## User Setup Required

None - no external service configuration required for this plan. (Provisioning both Railway Postgres databases and linking `DATABASE_URL`/confirming `RAILWAY_ENVIRONMENT_NAME` is Plan 83-01's owner checklist, already covered there — this plan's `DATABASE_URL` requirement will cause a real boot failure if that checklist isn't done before this middleware deploys, which is expected per D-01/D-15.)

## Next Phase Readiness
- `lib/db.js`'s full contract (`query`, `withTransaction`, `isConfigured`, `createPool`, `sslConfigFor`, `redactConnectionString`, `close`) is live and unit-tested — Plans 83-03 (migrations), 83-05 (store-flag/dual-write), and 83-07 (backfill pipeline) can build directly on it.
- Nothing pushed to any remote; nothing deployed. Staging/production deploys happen in Plan 83-08 per the phase plan, after Plan 83-01's DATABASE_URL linking.
- No Testcontainers-backed integration test exists yet for `lib/db.js` against a real Postgres — that harness (`__tests__/db/`, `jest.db.config.js`) is explicitly out of this plan's task list per RESEARCH.md Pattern 5 and belongs to a later plan in this phase.

## Self-Check: PASSED

All created/modified files verified present on disk; all 7 task/RED/GREEN commit hashes verified present in `git log`.

---
*Phase: 83-postgres-infrastructure*
*Completed: 2026-09-30*
