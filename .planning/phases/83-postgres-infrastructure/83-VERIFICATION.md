---
phase: 83-postgres-infrastructure
verified: 2026-10-02T00:00:00Z
status: gaps_found
score: 30/33 must-haves verified (all 4 ROADMAP success criteria VERIFIED; 3 plan-level truths FAILED/PARTIAL)
overrides_applied: 0
gaps:
  - truth: "Deploy-time migrations are additive only: a guard rejects DROP/TRUNCATE/RENAME/ALTER…TYPE/DELETE/UPDATE in any Up section, both in `npm test` and inside the pre-deploy command itself (83-03, D-04)"
    status: partial
    reason: "The guard is present and wired (package.json `migrate` = guard && node-pg-migrate up; railway.toml preDeployCommand). It catches the canonical forms, but the verifier reproduced bypasses: `ALTER TABLE t ALTER c TYPE integer` (no COLUMN keyword), `UPDATE ONLY t SET`, `DO $$ BEGIN DELETE FROM t; END $$`, and an unanchored `-- down migration` comment that stops the guard from scanning while node-pg-migrate keeps executing. The guard also reads only `*.sql` files, but node-pg-migrate 9 runs every non-dotfile in migrations/, so `0002_x.js` with pgm.dropTable() is never scanned (REVIEW CR-01, CR-02). It also wrongly flags `ADD COLUMN type text` (IN-01). Phase 84 is the first phase to add real money data and the first to add migration 0002, so this guard has to be reliable before then."
    artifacts:
      - path: "zoho-middleware/scripts/migration-guard.js"
        issue: "Statement rules are anchored and regex-chained; DOWN_MARKER_RE is not line-anchored (does not match node-pg-migrate's /^\\s*--[\\s-]*down\\s+migration/im); non-.sql migration files are ignored instead of rejected"
      - path: "zoho-middleware/__tests__/migration-guard.test.js"
        issue: "No regression cases for any of the bypasses"
    missing:
      - "Fail closed on any non-dotfile in migrations/ that is not *.sql"
      - "Make the up/down marker regexes identical to node-pg-migrate's"
      - "Unanchor the DML rules; cover ALTER [COLUMN] x [SET DATA] TYPE, MERGE, ON CONFLICT DO UPDATE, ALTER SEQUENCE RESTART; reject DO/EXECUTE blocks outright"
      - "Add a single tokenizer for comments and literals ('...', E'...', $tag$...$tag$)"
      - "Add each CR-01 row plus a .js migration file as regression tests"
  - truth: "Every row is normalised in the documented order … rejecting (never coercing) anything unconvertible, with a reason per column (83-06, D-12)"
    status: failed
    reason: "Reproduced by the verifier: normalizeRow(VesselHistory) with notes={cellError:'#REF!'} and vessel_id=true returns ok:true, note:'[object Object]', vessel_id:'true'. normalizeText calls String() on any non-string, and cellToPrimitive returns null for unknown exceljs shapes (sharedFormula, a formula with no cached result), which turns them into silent NULLs (REVIEW CR-03). This contradicts D-12 directly."
    artifacts:
      - path: "zoho-middleware/scripts/backfill/normalize.js"
        issue: "normalizeText (~L269-272) coerces non-string input with String(raw)"
      - path: "zoho-middleware/scripts/backfill/read-xlsx.js"
        issue: "cellToPrimitive (~L28-36) maps unrecognised cell shapes to null instead of a rejectable error"
    missing:
      - "normalizeText: accept strings and finite numbers only; reject cellError, Date, boolean and object values with a reason"
      - "cellToPrimitive: handle sharedFormula and nested hyperlink.text; return a cellError marker instead of null for unknown shapes"
      - "Regression tests for cell-error, Date and boolean values in text columns"
  - truth: "Promotion is … blocked when checks fail (83-07, D-12) — checks must be able to fail on a sheet that loaded nothing or lost a column"
    status: partial
    reason: "computeExpected builds expectations from the ACCEPTED rows only, so 0 accepted of N read gives row_count 0==0, null_count 0==0 and Checks: PASS. With --promote --accept-rejects, promote() inserts 0 rows and exits 0. runBackfill never compares spec.columns[].header with sheetResult.headers (verified: backfill.js has no `headers` reference), so a missing or renamed OPTIONAL column is NULL in every row and still passes (REVIEW CR-04). This exact failure class happened in the 83-08 rehearsal (run 1: 100% rejects caused by header mismatch, plus a missing bin_id header in the live sheet). The rejects report caught it only because the affected columns were required."
    artifacts:
      - path: "zoho-middleware/scripts/backfill/load.js"
        issue: "runChecks/computeExpected have no read-vs-accepted check; promote() does not refuse an empty scratch table"
      - path: "zoho-middleware/scripts/backfill/backfill.js"
        issue: "No header-drift check after readSheet"
    missing:
      - "Abort with EXIT.ERROR when any spec header is missing from the sheet; list unmapped sheet headers"
      - "Add a read_vs_accepted check that fails when read > 0 and accepted === 0"
      - "promote() refuses to run when scratch has 0 rows"
      - "Regression tests for all three"
---

# Phase 83: Postgres Infrastructure Verification Report

**Phase Goal:** Both environments have their own Postgres, the middleware can query it transactionally under test, and the migration, backfill and store-flag machinery every later phase reuses exists and is proven on an empty schema.
**Verified:** 2026-10-02
**Status:** gaps_found
**Re-verification:** No (initial verification)

## Bottom line

All four ROADMAP success criteria (the DB-02 contract) are met in code, by tests the verifier ran itself (unit 1894/1894; real-Postgres 26/26 with `CI=true`, so no tests were skipped), and by the live evidence on record. Both environments are running correctly, and nothing currently in production is at risk.

Three plan-level must-have truths do not hold:
- **The migration guard can be bypassed.** This is truth D-04.
- **The backfill normaliser silently coerces bad cells.** This is truth D-12, and the verifier reproduced it.
- **The backfill checks pass on a sheet that loaded nothing.** This is also D-12.

These do not break SC1–SC4 as worded. They do undermine the phase goal's claim that the migration and backfill machinery "every later phase reuses" is *proven*. Phase 84 is the first phase to put gift-card balances through exactly this guard and this backfill, and no later phase in the roadmap picks up this hardening. That is why they are reported as gaps and not deferred. If the owner prefers to track them as a pre-Phase-84 hardening plan instead, override text is given below.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC1 | Railway Postgres in staging + production with distinct DATABASE_URLs; validateEnv refuses boot without one; /health reports database alongside redis | VERIFIED | `validateEnv.js:25` has DATABASE_URL in REQUIRED_IN_PROD. `server.js:143-188` has checkDatabase() (select 1, raced against 3s) and returns `database:` next to `redis:`. Live (orchestrator, 2026-10-02): staging and prod /health both `database:true`. RUNBOOK records prod DATABASE_URL = `${{Postgres-EMVk.DATABASE_URL}}`; Railway references cannot cross environments. |
| SC2 | lib/db.js single pool, query(), withTransaction(); node-pg-migrate applies 0001_init.sql on deploy as a production step, compatible with `npm install --production` | VERIFIED | `lib/db.js` has a lazy singleton getPool, query and withTransaction (BEGIN/COMMIT/ROLLBACK/release). `pg` and `node-pg-migrate` are in `dependencies`. Root `railway.toml` has `buildCommand ... npm install --production` and `preDeployCommand = "cd zoho-middleware && npm run migrate"`. RUNBOOK records `/railway.toml` as the config path for both services. Live pre-deploy logs on both envs: guard OK, then 0001_init applied. |
| SC3 | Jest harness: real Postgres (Testcontainers) per test process, per-test rollback; CI runs it; round-trip green on CI | VERIFIED | `jest.db.config.js` and `__tests__/db/helpers/pg-harness.js` (startPostgres, rollbackEachTest). `db.test.js` covers round-trip, commit, rollback, and A/B isolation proving ROLLBACK runs between tests. `tests.yml:21` and `gated-deploy.yml:30` both run `npm run test:db` with no skip condition. Local run with CI=true: 3 suites / 26 tests passed. CI evidence: 26/26, 0 skipped. |
| SC4 | Store flag resolves `<STORE>_STORE` to sheets/dual/postgres, default sheets, mirror hard-off on staging; backfill runs end-to-end on a workbook snapshot into scratch with a rejects report, zero rows to real tables | VERIFIED | `lib/store-flag.js` (unset gives sheets; anything invalid exits 1, with no coercion). `lib/sheet-mirror.js` uses strict `===` on NODE_ENV and `RAILWAY_ENVIRONMENT_NAME === 'production'`, with no override. Boot logs: DISABLED on staging, ENABLED on prod, all stores `sheets`. Staging rehearsal: 401/68/11 rows, 0 rejects, Checks PASS, exit 0, no promote; scratch schema dropped afterwards. |
| 5 | RAILWAY_ENVIRONMENT_NAME values recorded (83-01) | VERIFIED | RUNBOOK:460-461 records `staging` and `production`. |
| 6 | Backups/PITR status recorded with a date (83-01, D-16) | VERIFIED | RUNBOOK:463-465 records NOT AVAILABLE (Hobby plan), re-confirmed at cutover. Missing backups block Phase 84, not this phase: none of SC1–SC4 require backups. |
| 7 | Railway config path recorded (83-01) | VERIFIED | RUNBOOK:462 records `/railway.toml` for both. `zoho-middleware/railway.toml` contains only watchPatterns and does not carry the preDeployCommand, which is consistent. |
| 8 | Workbook timezone recorded (83-01) | VERIFIED | RUNBOOK:466 records `America/Vancouver`. |
| 9 | pg and node-pg-migrate are production deps (83-02) | VERIFIED | Listed in package.json `dependencies`. |
| 10 | testcontainers pinned exactly and Node-20 safe (83-02) | VERIFIED (deviation) | Pinned exactly to `11.14.0`, not the planned `12.0.4`. 12.x needs Node ≥22.19 (undici@8). Documented in 83-08-SUMMARY (commit a298a169). This meets the intent of "Node 20 safe". |
| 11 | lib/db.js is the only module requiring `pg` (83-02) | VERIFIED | grep finds `require('pg')` only in `lib/db.js` and two test files. |
| 12 | Idle-client pool error never crashes, never logs the connection string (83-02, D-02) | VERIFIED | `createPool` attaches `on('error')` with a redacted log and Sentry capture. Checked-out clients have no listener (REVIEW WR-05); see warnings. |
| 13 | Guard rejects destructive statements in Up, in npm test and pre-deploy (83-03, D-04) | FAILED (partial) | Wiring is correct, but the verifier reproduced bypasses: `ALTER TABLE t ALTER c TYPE integer`, `UPDATE ONLY t SET`, `DO $$…DELETE…$$` and the comment-marker desync all return `[]`. Non-.sql migrations are never scanned. See gap 1. |
| 14 | Separate manual home for destructive changes, backup first (83-03) | VERIFIED | `migrations-manual/README.md` (47 lines). |
| 15 | node-pg-migrate only ever invoked as a CLI (83-03) | VERIFIED | No `require('node-pg-migrate')` anywhere. The harness spawns `node_modules/.bin/node-pg-migrate`. |
| 16 | Invalid store value, or dual/postgres without DATABASE_URL, refuses boot (83-04, D-06) | VERIFIED | `store-flag.js` resolveStoreMode and validateStoreFlags call process.exit(1) with named messages, and are called at `server.js:13` before routes. |
| 17 | Mirror no-ops unless NODE_ENV=production AND RAILWAY_ENVIRONMENT_NAME exactly 'production'; no override (83-04, D-07) | VERIFIED | `sheet-mirror.js` isProductionEnvironment uses a frozen constant and reads no env flag. |
| 18 | Boot logs one mirror-status line (83-04) | VERIFIED | `sheet-mirror.js:102`, called at `server.js:14`. Seen in staging and prod logs. |
| 19 | Dual-write comparator reports to Sentry, never throws (83-04, D-08) | VERIFIED | `dual-write-compare.js:216` uses captureExceptionSafe. Rounding all numbers to 2 decimals hides drift (WR-07); see warnings. It has no caller yet. |
| 20 | `npm test` never starts a container (83-05) | VERIFIED | `jest.config.js:7` ignores `__tests__/db/`. Main suite: 129 suites, about 8s, no Docker. |
| 21 | Local without Docker skips; CI never skips (83-05, D-14) | VERIFIED | `describeDb` and `shouldSkipDbTests` truth-table tests in the main suite. CI evidence shows 0 skipped. |
| 22 | 0001_init applies fresh, is idempotent, and a failing migration exits non-zero (83-05, D-03) | VERIFIED | `migrations.test.js:54,73,101` pass locally. |
| 23 | Backfill reads a frozen .xlsx, no Sheets credentials (83-06, D-09) | VERIFIED | `read-xlsx.js` uses exceljs readFile. No Google auth in scripts/backfill. |
| 24 | Normalise in order, rejecting (never coercing) anything unconvertible (83-06, D-12) | FAILED | Reproduced: `#REF!` became `"[object Object]"` and boolean `true` became `"true"`, both with ok:true. See gap 2. |
| 25 | Rejects/snapshots never land in a tracked path (83-06, D-13) | VERIFIED | `DEFAULT_OUT_DIR = ~/sv-backfill`. `.gitignore:59-62` covers `*.xlsx`, `backfill-output/` and `rejects-*.json`. Symlink and case-folding edge cases remain (IN-04). |
| 26 | exceljs as a devDependency after a legitimacy check (83-06) | VERIFIED | `exceljs: 4.4.0` in devDependencies. Legitimacy checkpoint recorded in 83-06-SUMMARY. |
| 27 | `npm run backfill` runs read → normalise → rejects → scratch → checks → (optional) promote (83-07, D-10) | VERIFIED | `backfill.js` runBackfill orchestration. `backfill.test.js:453` end-to-end. Live staging rehearsal. |
| 28 | Scratch-only loads; promote is an explicit flag, blocked by rejects (exit 2) and by failed checks, refused into a missing or non-empty target (83-07) | FAILED (partial) | Scratch-only (`SCRATCH_SCHEMA_RE`), the rejects gate and the missing/non-empty refusals are all tested (`backfill.test.js:273,282,501,540`). The checks cannot fail on 0 accepted rows or a missing optional column, so "blocked when checks fail" is vacuous in those cases. See gap 3. |
| 29 | Target DB from BACKFILL_DATABASE_URL only, printed redacted (83-07) | VERIFIED | `parseArgs` rejects a `postgres://` argv. That rejection message echoes the unredacted argv value (WR-03); see warnings. |
| 30 | Terminal output is counts and paths only (83-07, D-13) | VERIFIED | Test at `backfill.test.js:579-611` asserts the output is count lines. |
| 31 | End-to-end real-Postgres backfill test on CI (83-07) | VERIFIED | `backfill.test.js` is included in CI's 26/26. |
| 32 | RUNBOOK documents Postgres rollback (83-08) | VERIFIED | RUNBOOK:135-158, "Postgres (Phase 83)". |
| 33 | Prod rollback target recorded before deploy; prod via gated deploy (83-09, D-17) | VERIFIED | RUNBOOK:197-210 records `14b8afd4-…`, and the Deploy History row at RUNBOOK:62 (run 37049773828, deployment `f104c500-…`). This matches 83-09-SUMMARY and the orchestrator's live evidence. |

**Score:** 30/33 truths verified (ROADMAP SCs: 4/4).

### Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `zoho-middleware/lib/db.js` | VERIFIED | Exports all 7 planned functions. Wired into server.js, store-flag.js, backfill.js and the harness. |
| `zoho-middleware/lib/validateEnv.js` | VERIFIED | DATABASE_URL entry present. |
| `zoho-middleware/server.js` (/health) | VERIFIED | `database:` field; `status` stays 'ok' (D-02). |
| `zoho-middleware/migrations/0001_init.sql` | VERIFIED | `-- Up Migration`; creates `app_meta` and inserts a seed row. |
| `zoho-middleware/scripts/migration-guard.js` | PARTIAL | Exists and is wired. Detection gaps (gap 1). |
| `railway.toml` (root) | VERIFIED | preDeployCommand present. |
| `zoho-middleware/migrations-manual/README.md` | VERIFIED | Present. |
| `zoho-middleware/lib/store-flag.js` | VERIFIED | Exports match the plan. |
| `zoho-middleware/lib/sheet-mirror.js` | VERIFIED | Exports match the plan. |
| `zoho-middleware/lib/dual-write-compare.js` | VERIFIED (no consumer yet) | Expected: Phase 84 is its first consumer. |
| `zoho-middleware/jest.db.config.js` and `__tests__/db/*` | VERIFIED | 26 tests pass against a real container. |
| `zoho-middleware/scripts/backfill/{normalize,read-xlsx,rejects,load,backfill}.js` and `specs/*` | PARTIAL | End-to-end works. Coercion and vacuous-check gaps (gaps 2, 3). |
| `.github/workflows/tests.yml`, `gated-deploy.yml` | VERIFIED | Both run `npm run test:db`. |
| `docs/RUNBOOK.md` | VERIFIED | Provisioning record, rollback, staging verification, production cutover. |

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| server.js /health | lib/db.js | `db.query('select 1')` raced against 3s | WIRED |
| lib/db.js | pg Pool error | `newPool.on('error', …)` | WIRED |
| railway.toml preDeployCommand | package.json `migrate` | `cd zoho-middleware && npm run migrate` | WIRED |
| `migrate` script | guard, then node-pg-migrate | `node scripts/migration-guard.js && node-pg-migrate up` | WIRED (the guard only sees *.sql files, gap 1) |
| server.js boot | validateStoreFlags() and logMirrorStatus() | top-level, lines 13-14 | WIRED |
| dual-write-compare | sentry-capture | captureExceptionSafe | WIRED |
| CI workflows | `npm run test:db` | step without skip | WIRED |
| pg-harness | node-pg-migrate CLI | spawn of `.bin/node-pg-migrate` | WIRED |
| backfill.js | db.createPool / redact | require('../../lib/db') | WIRED |
| package.json `backfill` | scripts/backfill/backfill.js | npm script | WIRED |

### Behavioral Spot-Checks (run by the verifier)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Main middleware suite (no Docker) | `cd zoho-middleware && npm test` (Node 20.20) | 129 suites / 1894 tests passed | PASS |
| Real-Postgres suite, CI mode | `CI=true npx jest -c jest.db.config.js` | 3 suites / 26 tests passed, 0 skipped; pg `client.query()` deprecation warning (WR-01) | PASS |
| Guard catches canonical DROP | `findDestructiveStatements('-- Up Migration\nDROP TABLE t;')` | `[{rule:'drop'}]` | PASS |
| Guard catches `ALTER … TYPE` shorthand / `UPDATE ONLY` / `DO $$ DELETE` / comment-marker desync | `findDestructiveStatements(...)` | `[]` for all four | FAIL |
| Guard false positive on `ADD COLUMN type text` | same | flagged `alter-type` | FAIL (info) |
| Normaliser rejects error/boolean cells in text columns | `normalizeRow(VesselHistory, {..., vessel_id:true, notes:{cellError:'#REF!'}})` | `ok:true`, `vessel_id:"true"`, `note:"[object Object]"` | FAIL |

### Probe Execution

No `scripts/*/tests/probe-*.sh` files are declared or present for this phase. Skipped.

### Live Evidence (recorded by the orchestrator, cross-checked)

| Claim | Orchestrator evidence | RUNBOOK / SUMMARY | Consistent |
|-------|----------------------|-------------------|------------|
| Staging and prod /health `database:true` | yes | RUNBOOK staging and prod sections; 83-08/83-09 SUMMARY | Yes |
| Gated Deploy #23, run 37049773828, deployment f104c500…, rollback 14b8afd4… | yes | RUNBOOK:62, 197-210; 83-09-SUMMARY:31,52-53 | Yes |
| Pre-deploy: guard OK, then 0001_init applied, both envs | yes | RUNBOOK staging and prod log sections | Yes |
| Mirror DISABLED on staging, ENABLED on prod; all stores sheets | yes | RUNBOOK; 83-08/83-09 SUMMARY | Yes |
| CI test:db 26/26, 0 skipped | yes | 83-08-SUMMARY:80; the verifier's local run gives the same count | Yes |
| Rehearsal 401/68/11, 0 rejects, PASS, exit 0, scratch dropped | yes | RUNBOOK rehearsal table; 83-08-SUMMARY:85 | Yes |

### Requirements Coverage

| Requirement | Source Plans | Status | Evidence |
|-------------|--------------|--------|----------|
| DB-02 | 83-01 … 83-09 | SATISFIED as written. Hardening gaps are listed above. | Every clause holds: Postgres in staging and production, lib/db.js pool/query/transaction, node-pg-migrate on deploy, DATABASE_URL validated, Testcontainers harness on CI, per-store flag with the mirror off on staging, backfill snapshot → normalise → rejects → scratch → promote. REQUIREMENTS.md:129 is still `[ ]`; ticking it is the orchestrator's decision once the gaps are resolved or overridden. |

No orphaned requirements. REQUIREMENTS.md maps only DB-02 to Phase 83.

### Code Review Blockers: Classification

| Review item | Bears on | Classification | Reasoning |
|-------------|----------|----------------|-----------|
| CR-01: guard bypasses | 83-03 truth (D-04); goal: "migration machinery … proven" | **Gap 1 (BLOCKER for Phase 84 readiness)** | SC2 itself holds: 0001_init applies on deploy. The plan explicitly promised that ALTER…TYPE, DELETE and UPDATE are rejected, and the common shorthand forms are not. Prod currently holds only `app_meta`, so nothing is at risk today. Phase 84's 0002 is the first migration that runs next to money data. |
| CR-02: .js migrations unguarded | same | **Gap 1** (same root cause) | node-pg-migrate executes any non-dotfile. A `.js` migration skips the guard completely, and a stray README would break the pre-deploy step. |
| CR-03: text coercion | 83-06 truth (D-12) | **Gap 2 (BLOCKER)** | Reproduced. This is the "silently-coerced" failure the module header says must never happen. Phase 84+ promotes rows from this pipeline into real tables. |
| CR-04: zero-accept / header drift | 83-07 truth ("blocked when checks fail"); D-12 silent NULL | **Gap 3 (BLOCKER)** | This failure class happened in the real rehearsal (100% rejects from header mismatch, plus a missing live-sheet header). It was caught only because the affected columns were required. The 83-08-SUMMARY lists it as a known follow-up. No later phase owns it. |
| WR-01…WR-10, IN-01…IN-08 | — | WARNING / follow-up | Do not falsify any SC or plan truth for an empty schema. WR-02 (CLI hang on error path plus duplicate-PK abort), WR-05 (withTransaction broken-client release, no checked-out error listener) and WR-07 (comparator rounding) should be fixed before Phase 84 uses withTransaction and the comparator in anger. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (phase files scanned) | — | TBD/FIXME/XXX | — | None found |
| scripts/backfill/load.js | 322, 362-366, 451-457 | Concurrent `client.query` on one client (`Promise.all`) | WARNING | pg deprecation warning seen in the verifier's run; breaks on pg@9 (WR-01) |
| scripts/backfill/backfill.js | 302-362 | Client not released on error path, so `pool.end()` hangs | WARNING | Owner's CLI hangs on a mistyped DB name or load failure (WR-02) |
| lib/db.js | 38-43 | TLS relaxation matched by substring anywhere in the URL | WARNING | Not exploitable with owner-supplied URLs; violates T-83-02-05's scoping promise (WR-04) |
| server.js | 143-188 | Unauthenticated /health uses the shared 5-slot pool on every hit | WARNING | Pool starvation risk once Phase 84 stores read Postgres (WR-06) |

### Human Verification Required

None outstanding. The live checks a human would do (/health, pre-deploy logs, mirror boot lines, CI test:db, rehearsal) were already gathered by the orchestrator, and they match the RUNBOOK and SUMMARYs.

### Gaps Summary

The infrastructure goal is met. Two Postgres databases are live, the middleware queries them transactionally under real-Postgres tests on CI, migrations run on deploy, the store flag and mirror gate work, and the backfill has run end-to-end on real data with zero rows outside scratch.

The shortfall is in how much the reusable machinery can be trusted, which is the part the goal says later phases inherit. There are two root causes:

1. **Migration guard (gap 1, CR-01 and CR-02).** It is the only automated D-04 barrier on the production pre-deploy step, and it can be bypassed by common SQL forms and by non-.sql files.
2. **Backfill integrity (gaps 2 and 3, CR-03 and CR-04).** The normaliser coerces bad cells instead of rejecting them, and the checks/promote gate cannot detect a sheet that loaded nothing or lost an optional column.

Both should be fixed with regression tests first, per CLAUDE.md, before Phase 84 writes migration 0002 or promotes any backfill into a real table. None of the later milestone phases (84–88) owns these fixes, so nothing was deferred.

**If the owner prefers to accept Phase 83 as done and fold these into a Phase 84 "Wave 0" hardening plan, add to this file's frontmatter:**

```yaml
overrides:
  - must_have: "Deploy-time migrations are additive only: a guard rejects DROP/TRUNCATE/RENAME/ALTER…TYPE/DELETE/UPDATE in any Up section"
    reason: "Only app_meta exists in either database; guard hardening (CR-01/CR-02) scheduled as Phase 84 Wave 0 before migration 0002"
    accepted_by: "<owner>"
    accepted_at: "<ISO timestamp>"
  - must_have: "Every row is normalised in the documented order rejecting (never coercing) anything unconvertible"
    reason: "No backfill has been promoted; CR-03 fix scheduled before the first Phase 84 promote"
    accepted_by: "<owner>"
    accepted_at: "<ISO timestamp>"
  - must_have: "Promotion is blocked when checks fail — checks must be able to fail on a sheet that loaded nothing or lost a column"
    reason: "No backfill has been promoted; CR-04 fix scheduled before the first Phase 84 promote"
    accepted_by: "<owner>"
    accepted_at: "<ISO timestamp>"
```

---

_Verified: 2026-10-02_
_Verifier: Claude (gsd-verifier)_
