---
phase: 83-postgres-infrastructure
plan: 03
subsystem: database
tags: [postgres, node-pg-migrate, railway, migrations, ci-gate]

# Dependency graph
requires:
  - phase: 83-postgres-infrastructure (plan 01)
    provides: "Railway config-file path confirmed at repo-root /railway.toml for both services (docs/RUNBOOK.md)"
  - phase: 83-postgres-infrastructure (plan 02)
    provides: "pg + node-pg-migrate installed as production deps; lib/db.js createPool()/sslConfigFor() reused by later backfill/harness plans"
provides:
  - "scripts/migration-guard.js — findDestructiveStatements(sql) + checkMigrationsDir(dir), enforces additive-only Up sections (D-04)"
  - "migrations/0001_init.sql — first applied migration, proves the pipeline on an empty schema (app_meta table)"
  - "npm run migrate = guard && node-pg-migrate up, wired as railway.toml's preDeployCommand (D-03)"
  - "migrations-manual/README.md — backup-first/staging-first/owner-present procedure for destructive changes, never wired into the deploy path"
  - "package.json scripts: migrate, migrate:guard, test:db (config file itself arrives in Plan 83-05)"
affects: [83-05 (Jest DB harness consumes test:db + createPool), 83-08 (first staging/production deploy exercises preDeployCommand for real), 84-88 (every future migration file is guarded by this same script)]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Deploy-time destructive-statement guard: comment/literal-stripped regex scan of only the node-pg-migrate Up section, invoked both from npm test and as the first half of the preDeployCommand", "CLI script with zero devDependency imports so it survives npm install --production in the Railway pre-deploy container"]

key-files:
  created:
    - zoho-middleware/scripts/migration-guard.js
    - zoho-middleware/__tests__/migration-guard.test.js
    - zoho-middleware/migrations-manual/README.md
    - zoho-middleware/migrations/0001_init.sql
  modified:
    - zoho-middleware/package.json
    - railway.toml

key-decisions:
  - "Rule-matching order inside findDestructiveStatements is drop, truncate, rename, alter-type, delete, update (first match wins) — a statement matching multiple keywords (e.g. \"ALTER TABLE x DROP COLUMN y\" contains both alter and drop) is reported once, under its most specific rule, giving each of the plan's 9 destructive-statement behaviors exactly one violation as specified"
  - "Comment/literal stripping happens AFTER locating the -- Up Migration / -- Down Migration markers on the raw text, not before — the markers are themselves -- line comments, so stripping first would erase them before the split could find them"
  - "preDeployCommand wraps npm run migrate (guard THEN node-pg-migrate up), not a bare node-pg-migrate invocation — this is what makes D-04 enforceable at deploy time, not just at npm test time, per the plan's own must_haves"
  - "zoho-middleware/railway.toml (stale nested file, watchPatterns only) left completely untouched per the plan's explicit instruction and 83-01's confirmation that both services read the repo-root file"

patterns-established:
  - "Additive-only migration guard: any future migration file automatically inherits this same enforcement with zero per-file opt-in — checkMigrationsDir() scans the whole migrations/ directory"

requirements-completed: [DB-02]

# Metrics
duration: ~5min (commit span 13:28:01-13:30:46 PDT; includes prior context/research reading)
completed: 2026-09-30
---

# Phase 83 Plan 03: Migration Pipeline as a Deploy Step Summary

**`npm run migrate` (additive-only guard + node-pg-migrate up) wired as Railway's `preDeployCommand`, with the first applied migration (`0001_init.sql`, an `app_meta` table) proving the pipeline on an empty schema, and a fully tested regex-based guard that rejects DROP/TRUNCATE/RENAME/ALTER…TYPE/DELETE/UPDATE in any migration's Up section at both `npm test` time and deploy time.**

## Performance

- **Duration:** ~5 min of commit-to-commit work (13:28:01–13:30:46 PDT), preceded by reading PLAN.md/CONTEXT.md/RESEARCH.md/PATTERNS.md/prior summaries and running `npm ci` in both the root and `zoho-middleware`
- **Tasks:** 2/2 complete (both `type="auto"`, Task 1 `tdd="true"`)
- **Files modified:** 6 (4 created, 2 modified)

## Accomplishments
- `scripts/migration-guard.js` — `findDestructiveStatements(sql)` and `checkMigrationsDir(dir)`, CommonJS/fs/path only (zero devDependency imports, verified by grep — it must survive `npm install --production` in the Railway pre-deploy container). Scans only the `-- Up Migration` section (comments and single-quoted literals stripped first) for `drop`/`truncate`/`rename`/`alter-type`/`delete`/`update`; a missing `-- Up Migration` marker is itself flagged (`missing-up-marker`). CLI exits 1 with one `file: rule: statement` line per violation on stderr, or 0 with an `additive-only OK` summary on stdout.
- 23/23 new tests covering every `<behavior>` bullet in the plan: all 4 safe-statement shapes, all 9 destructive-statement shapes (each exactly one violation, correct rule name), the Down-only exemption, all three comment/literal-stripping cases, the missing-marker case, `checkMigrationsDir()`'s multi-file/non-`.sql`-file handling, and both CLI exit codes via `child_process.spawnSync`.
- `migrations-manual/README.md` — the D-04 destructive-change procedure: backup first (and record it — Railway backups are confirmed unavailable on the current Hobby plan per `83-01-SUMMARY.md`), staging first, owner present, run via `node-pg-migrate up -m migrations-manual --migrations-table pgmigrations_manual` (explicit dir **and** a separate tracking table, so a manual run never collides with the next deploy's order check), recorded in `docs/RUNBOOK.md`.
- `migrations/0001_init.sql` — first applied migration: creates `app_meta(key, value, updated_at)`, seeds one row, `Down` drops the table. `checkMigrationsDir('./migrations')` returns `[]` against the real file.
- `npm run migrate` (`migration-guard.js && node-pg-migrate up`) wired into repo-root `railway.toml`'s `[deploy]` as `preDeployCommand` — confirmed this is the correct file (both `svmiddleware-staging` and `svmiddleware-production` read the repo-root file, no Root Directory override, per `83-01-SUMMARY.md`); `zoho-middleware/railway.toml` (the stale nested file) left byte-for-byte untouched (`git diff --stat` empty).
- `package.json` gained `migrate`, `migrate:guard`, and `test:db` scripts with the exact values specified in the plan's `<interfaces>` block (the `test:db` config file itself is Plan 83-05's job — only the script entry is added here, as instructed, so both plans can land without a `package.json` merge conflict).
- Full middleware suite: 117/117 suites, 1751/1751 tests (23 new + 1 added real-dir assertion), lint clean. Full frontend suite: 141/141 suites, 2048/2048 tests, lint clean.

## Task Commits

1. **Task 1: Additive-only migration guard (D-04)**
   - `3b758dcc` test(83-03): add failing tests for migration-guard additive-only rule (D-04) — RED, module missing
   - `ae8dd180` feat(83-03): implement additive-only migration guard + manual-destructive README (D-04) — GREEN, 23/23 passing
2. **Task 2: 0001_init.sql, npm scripts, and the Railway preDeployCommand (D-03)**
   - `03caa5b2` feat(83-03): add 0001_init.sql and wire migrate as Railway's preDeployCommand (D-03)

**Plan metadata:** (this commit, below)

## Files Created/Modified
- `zoho-middleware/scripts/migration-guard.js` — the guard: `findDestructiveStatements`, `checkMigrationsDir`, CLI entry point
- `zoho-middleware/__tests__/migration-guard.test.js` — 24 tests (23 from Task 1 + the real-`migrations/`-dir assertion added in Task 2)
- `zoho-middleware/migrations-manual/README.md` — destructive-change procedure
- `zoho-middleware/migrations/0001_init.sql` — first applied migration (`app_meta` table)
- `zoho-middleware/package.json` — `migrate`, `migrate:guard`, `test:db` scripts added
- `railway.toml` — `preDeployCommand` added to `[deploy]`, with an inline comment on the ephemeral-container/fail-closed-rollback behavior and the 2026-12-01 config-as-code deprecation deadline

## Decisions Made
- Rule-matching is first-match-wins in a fixed order (drop, truncate, rename, alter-type, delete, update) — keeps each of the plan's 9 destructive-statement test cases to exactly one violation without needing per-statement disambiguation logic
- Comment/literal stripping runs only inside the already-extracted Up section, and only after the Up/Down markers are located on the *raw* text — stripping `--` comments first would have erased the markers themselves
- Did not attempt to reproduce `node-pg-migrate`'s internal filename-acceptance validation logic; instead ran a partial live probe (see Deviations) and deferred full round-trip verification to Plan 83-05's CI Testcontainers harness, exactly as the plan's Docker-unavailable fallback instructs

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Doc-comment containing a literal `/* */` broke the file's own block comment**
- **Found during:** Task 1, GREEN implementation (first `node -c` syntax check)
- **Issue:** The JSDoc-style comment documenting `stripCommentsAndLiterals()` described what it strips using the literal text `/* */` inside the surrounding `/** ... */` block comment, which prematurely closed the outer comment and produced a `SyntaxError: Invalid left-hand side expression in postfix operation`.
- **Fix:** Reworded the comment to say "block comments (slash-star ... star-slash)" instead of using the literal token sequence.
- **Files modified:** `zoho-middleware/scripts/migration-guard.js`
- **Verification:** `node -c scripts/migration-guard.js` → `SYNTAX_OK`; full test file re-run, 23/23 passing
- **Committed in:** `ae8dd180` (Task 1 GREEN commit — caught before the commit, not a follow-up fix)

---

**Total deviations:** 1 auto-fixed (Rule 1, caught during implementation before any commit)
**Impact on plan:** None on the deliverable — a pre-commit syntax slip, not a behavioral or scope change.

## Issues Encountered

**Docker unavailable for Task 2's live round-trip verification.** The plan's Task 2 action asks for a real `postgres:16-alpine` container round-trip (apply `0001_init.sql`, confirm the `pgmigrations`/`app_meta` rows, confirm a second `npm run migrate` is a no-op) "if `docker info` succeeds." `docker info` failed in this worktree's environment (Docker Desktop not running / not installed), and no local `pg_ctl`/`postgres`/`initdb` binaries were found either. Per the plan's explicit fallback ("If Docker is not running, record that and rely on Plan 83-05's CI migrations test"), this was recorded rather than worked around. As a partial substitute, `DATABASE_URL=postgresql://postgres:pg@localhost:1/nonexistent node-pg-migrate up` was run directly — it reached the connection-attempt stage (`ECONNREFUSED`) without raising any filename- or migration-format error first, which is weak but non-zero evidence against a hard filename rejection. **Full verification (the actual apply-then-idempotent-re-run round trip) is deferred to Plan 83-05's Testcontainers-backed CI harness**, which is explicitly designed to run this exact check in an environment where Docker is guaranteed available (GitHub Actions ubuntu runners, per `83-PATTERNS.md`/`83-RESEARCH.md` Pattern 5 and D-14).

## User Setup Required

None for this plan specifically. Two items carried forward from Plan 83-01 remain open and matter before this plan's `preDeployCommand` ever runs for real:
- Both Railway Postgres databases are already provisioned and `DATABASE_URL`-linked (Plan 83-01, complete) — this plan's `preDeployCommand` will only actually execute against a real database once Plan 83-08 deploys.
- **Railway's config-as-code deprecation deadline is 2026-12-01** (noted in `docs/RUNBOOK.md` per Plan 83-01, and now also inline in `railway.toml` itself) — per the orchestrator's instruction for this plan, this was implemented as written (repo-root `railway.toml`, unchanged pattern) and the deadline is flagged here as a follow-up rather than acted on. Whoever executes Plan 83-08 (or a later deploy-settings review) needs to migrate the `preDeployCommand`/`buildCommand`/`startCommand` settings to the Railway dashboard (or another IaC mechanism) before that date, or every subsequent deploy silently stops running migrations.

## Next Phase Readiness
- Plan 83-05 (Jest DB harness) can proceed: `test:db` script entry already exists in `package.json` pointing at `jest.db.config.js` (that config file is 83-05's own deliverable); `lib/db.js`'s `createPool()` (Plan 83-02) is available for the harness to reuse directly.
- Plan 83-08 (first staging/production deploy) can proceed: `preDeployCommand` is wired and guard-clean against the one existing migration; the only remaining verification gap (a real apply-then-idempotent-rerun round trip) will happen for real on that first deploy, backstopped by 83-05's CI harness before then.
- Phases 84-88: every future migration file dropped into `migrations/` is automatically covered by this same guard — no per-migration opt-in needed.
- Nothing pushed to any remote; nothing deployed.

---
*Phase: 83-postgres-infrastructure*
*Completed: 2026-09-30*
