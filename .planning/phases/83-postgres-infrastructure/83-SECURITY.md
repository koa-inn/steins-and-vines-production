---
phase: 83
slug: postgres-infrastructure
status: verified
threats_open: 0
asvs_level: 1
created: 2026-10-02
---

# Phase 83 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Railway dashboard -> repo docs (docs/RUNBOOK.md) | Owner-read provisioning facts copied into a publicly-hosted repo | Service names/dates/booleans only; connection strings/hosts/passwords excluded |
| middleware -> Postgres (`lib/db.js`) | `DATABASE_URL` is a bearer credential to the whole database | SQL query text + params |
| internet -> `GET /health` | Unauthenticated endpoint now touches the database | boolean `database` field only |
| repo `migrations/*.sql` -> Railway pre-deploy (`npm run migrate`) | Any committed file executes against staging then production Postgres with full DDL/DML rights, unattended | SQL DDL/DML |
| owner's Mac -> Railway public TCP proxy (backfill CLI) | Credential-bearing connection over the internet (`BACKFILL_DATABASE_URL`) | Postgres wire protocol, connection string |
| owner's downloaded `.xlsx` -> backfill pipeline | Untrusted/semi-trusted spreadsheet content (hand-edited cells, formulas, errors) | Customer/operational data incl. PII (names, notes) |
| staging middleware -> shared production Google Sheet workbook | The mirror is the only path by which staging could write production data | Mirrored write payloads |
| production Postgres -> Cloudflare R2 (`infra/pg-backup/`, built outside any plan) | Nightly `pg_dump` leaves Railway's private network, is encrypted, then stored off-platform | Full database dump (encrypted at rest and in transit before upload) |
| GitHub Actions -> production repo / Railway (gated-deploy) | The gated workflow force-pushes and triggers the production deploy | Code, deploy credentials |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-83-01-01 | Information Disclosure | docs/RUNBOOK.md provisioning record | mitigate | No `postgres://`, `railway.internal`, or `proxy.rlwy.net:<port>` literal found in docs/RUNBOOK.md or any 83-*.md (`grep -rn "postgres://" docs/RUNBOOK.md .planning/phases/83-*` → 0 real matches, only plan-text describing the check itself). Record uses names/dates/yes-no (RUNBOOK.md:457-464). | closed |
| T-83-01-02 | Tampering | D-07 mirror gate | mitigate | docs/RUNBOOK.md:460-461 records distinct `RAILWAY_ENVIRONMENT_NAME` values (`staging` vs `production`); `lib/sheet-mirror.js:35,42-45` compares against the frozen recorded production name with strict `===`. | closed |
| T-83-01-03 | Denial of Service | staging/prod middleware boot (D-01) | mitigate | `lib/validateEnv.js` `REQUIRED_IN_PROD` includes `DATABASE_URL` (fails boot if unlinked in prod); docs/RUNBOOK.md:457,459 record both staging and production `DATABASE_URL` linked before any Phase 83 push. | closed |
| T-83-01-04 | Repudiation / data loss | Postgres backups (D-16) | mitigate | Originally recorded as a Phase 84 blocker (docs/RUNBOOK.md:499 "NOT AVAILABLE"); now actually closed by `infra/pg-backup/` (Railway cron, production only) — first backup + restore drill passed 2026-10-02 (docs/RUNBOOK.md:510-512, 83-HUMAN-UAT.md test 2, infra/pg-backup/README.md drill history table). | closed |
| T-83-02-01 | Information Disclosure | lib/db.js error paths | mitigate | `lib/db.js:52-55` `redactConnectionString`; `lib/db.js:74-78` pool `error` handler logs only the redacted message. | closed |
| T-83-02-02 | Denial of Service | pg Pool idle-client error | mitigate | `lib/db.js:74` `newPool.on('error', ...)` always registered inside `createPool`. | closed |
| T-83-02-03 | Denial of Service | GET /health | mitigate | `server.js:143-166` `checkDatabase()` races `db.query('select 1')` against a 3s timeout, always resolves (never rejects); `lib/db.js:67-69` pool `max:5`, `connectionTimeoutMillis:5000`. | closed |
| T-83-02-04 | Tampering | future query() callers | mitigate | `lib/db.js:100-105` `query(text, params)` forwards params to `pg` placeholders unchanged; header comment (lib/db.js:15-16) forbids string-built SQL; `__tests__/db/db.test.js:58` asserts a hostile parameter round-trips as a literal (T-83-05-04). | closed |
| T-83-02-05 | Tampering (MITM) | sslConfigFor public proxy | accept | See Accepted Risks Log. | closed |
| T-83-02-06 | Denial of Service | boot gate (D-01) | mitigate | `lib/validateEnv.js` `REQUIRED_IN_PROD` entry for `DATABASE_URL`; `railway.toml` `preDeployCommand` runs `npm run migrate` against the same env. | closed |
| T-83-02-SC | Tampering | npm installs (pg, node-pg-migrate, testcontainers x2) | mitigate | 83-RESEARCH Package Legitimacy Audit all [OK]; `package.json` pins `testcontainers`/`@testcontainers/postgresql` to exact `11.14.0` (no range operator — note: plan text said "12.0.4", installed/pinned version is 11.14.0; the security property being verified, an exact pin with no `^`/`~`, holds regardless of the specific version number); CI runs `npm audit --audit-level=high --omit=dev` as a non-optional step (.github/workflows/tests.yml:27,42; gated-deploy.yml:36,54). | closed |
| T-83-03-01 | Tampering / data loss | migrations/*.sql on deploy | mitigate | `package.json` `scripts.migrate` = `node scripts/migration-guard.js && node scripts/migration-allowlist.js && node-pg-migrate up`; same chain runs in `npm test` and `railway.toml`'s `preDeployCommand`. See also T-83-13/14 (authoritative chain). | closed |
| T-83-03-02 | Denial of Service | failing migration | mitigate | `railway.toml` `preDeployCommand` non-zero exit aborts deploy (D-03, documented in railway.toml comment); node-pg-migrate's own per-migration transaction. | closed |
| T-83-03-03 | Elevation / tampering | destructive manual changes | mitigate | `migrations-manual/README.md:127-149` "Procedure": backup first, staging first, owner present, recorded in RUNBOOK; directory never referenced by `npm run migrate`. | closed |
| T-83-03-04 | Denial of Service | ESM-only node-pg-migrate | mitigate | `grep -rn "require(['\"]node-pg-migrate" zoho-middleware --include="*.js"` (excl. node_modules) → 0 matches; invoked only as CLI binary via npm script. | closed |
| T-83-04-01 | Tampering / Information Disclosure | lib/sheet-mirror.js on staging (D-07) | mitigate | `lib/sheet-mirror.js:42-45` strict `===` against frozen `production` name, no env override; `logMirrorStatus()` (lib/sheet-mirror.js:99-103) confirmed live: docs/RUNBOOK.md:166-167 `mirror DISABLED (environment=staging)`; docs/RUNBOOK.md:215 `mirror ENABLED (environment=production)`. | closed |
| T-83-04-02 | Tampering (config integrity) | lib/store-flag.js | mitigate | `lib/store-flag.js:44-52` reject-not-coerce, `process.exit(1)` on invalid value; `lib/store-flag.js:73-84` dual/postgres without `DATABASE_URL` also exits. | closed |
| T-83-04-03 | Information Disclosure | lib/dual-write-compare.js Sentry payload | mitigate | `lib/dual-write-compare.js:195-212` reports paths/types by default; values only for keys in `reportValuesFor`. | closed |
| T-83-04-04 | Denial of Service | dual-write / mirror on the write path | mitigate | `lib/sheet-mirror.js:70-92` and `lib/dual-write-compare.js:179-229` both wrap all work in try/catch, use `captureExceptionSafe`, never throw/await into the caller. | closed |
| T-83-05-01 | Repudiation (false green) | D-14 skip path | mitigate | `__tests__/db/helpers/pg-harness.js:36-49` `shouldSkipDbTests` returns false whenever `CI` is truthy (not `'false'`); `.github/workflows/tests.yml:21` and `gated-deploy.yml:27` run `npm run test:db` with no `if:`/`continue-on-error`. | closed |
| T-83-05-02 | Tampering | tests touching a real environment database | mitigate | Harness uses only the Testcontainers connection string it started (pg-harness.js); no workflow step exposes Railway credentials to test jobs (reviewed tests.yml/gated-deploy.yml). | closed |
| T-83-05-03 | Tampering (supply chain) | postgres:16-alpine image pull | accept | See Accepted Risks Log. | closed |
| T-83-05-04 | Tampering | SQL injection regression | mitigate | `__tests__/db/db.test.js:58` "round-trips a hostile parameterised value as a literal string (ASVS V5, T-83-05-04)". | closed |
| T-83-06-01 | Information Disclosure | rejects.js / snapshots (D-13) | mitigate | `scripts/backfill/rejects.js:13` `DEFAULT_OUT_DIR` = `~/sv-backfill`; `rejects.js:26-39` `assertSafePath` refuses in-repo paths outside the one allowed git-ignored dir; `rejects.js:85` `{mode:0o600}`; `.gitignore:60-62` `*.xlsx`, `backfill-output/`, `rejects-*.json`. | closed |
| T-83-06-02 | Tampering (silent corruption) | normalize.js | mitigate | `scripts/backfill/normalize.js:120-121,275-282` reject-not-coerce typed reasons for cellError/boolean/object/non-finite. | closed |
| T-83-06-03 | Tampering | exceljs parsing hostile/odd cells | mitigate | `scripts/backfill/read-xlsx.js:14-46` `cellToPrimitive` whitelists value shapes; formulas use only cached result; error cells become `{cellError}`. | closed |
| T-83-06-SC | Tampering | npm install exceljs | mitigate | devDependency only (not in production deps shipped to Railway); confirmed via package.json; `xlsx` not present anywhere in package.json. | closed |
| T-83-07-01 | Information Disclosure | BACKFILL_DATABASE_URL handling (D-10) | mitigate | `scripts/backfill/backfill.js:93` rejects any argv value matching a postgres URL shape with a message pointing to the env var; README documents `read -s` + `unset`; backfill.js:357 logs only `db.redactConnectionString(...)`. | closed |
| T-83-07-02 | Information Disclosure | TLS to public proxy | mitigate | `lib/db.js:38-43` `sslConfigFor` scopes `rejectUnauthorized:false` to `*.proxy.rlwy.net` only (same accepted scope as T-83-02-05). | closed |
| T-83-07-03 | Tampering / data loss | writes to a real environment database | mitigate | `scripts/backfill/load.js:22-25` `SCRATCH_SCHEMA_RE`/`assertScratchSchema`; `load.js:406-437` `promote()` requires non-empty source, existing+empty target, checked outside the transaction; `backfill.js:169` `promptTypeDatabaseName`, `opts.yes` gate. | closed |
| T-83-07-04 | Tampering (SQL injection) | load.js | mitigate | `scripts/backfill/load.js:12-13,35,40,42,53,197,415` — every identifier via `client.escapeIdentifier`, values parameterised. | closed |
| T-83-07-05 | Information Disclosure | CLI output (D-13) | mitigate | `__tests__/db/backfill.test.js:388-430` fixture rows carry `notes: 'fixture-note-*'`; test at line 492-494 asserts `log.lines` never match `/fixture-note-/`. | closed |
| T-83-08-01 | Tampering | staging mirror (D-07) | mitigate | docs/RUNBOOK.md:166-167 confirms live staging log line `mirror DISABLED (environment=staging)`. | closed |
| T-83-08-02 | Denial of Service | staging boot (D-01) | mitigate | docs/RUNBOOK.md:457 staging `DATABASE_URL` linked before push; `railway.toml` preDeployCommand aborts deploy on failure (D-03). | closed |
| T-83-08-03 | Information Disclosure | backfill rehearsal (D-10, D-13) | mitigate | docs/RUNBOOK.md:168-180 records only sheet names/counts/exit codes from the rehearsal, no URLs or row contents; no `postgres://` literal present. | closed |
| T-83-08-04 | Repudiation (false green) | CI DB tests | mitigate | docs/RUNBOOK.md references `test:db` passing with real suites; `.github/workflows/tests.yml:21` step has no conditional skip; VERIFICATION.md independently reran `CI=true npm run test:db` → 5 suites/35 tests, 0 skipped. | closed |
| T-83-08-05 | Tampering | unrelated local changes shipped | mitigate | Preflight convention documented in 83-08-PLAN/RUNBOOK; current git status shows only `links.html` modified outside this audit's scope, consistent with the documented exception. | closed |
| T-83-09-01 | Denial of Service | production boot / kiosk (D-01, D-02) | mitigate | docs/RUNBOOK.md:189-216 — prod `DATABASE_URL` linked, rollback target recorded (`14b8afd4-...`) before dispatch; `server.js:181` `/health` never flips `status` on `database:false`. | closed |
| T-83-09-02 | Tampering | wrong SHA shipped | mitigate | docs/RUNBOOK.md:198-201 records dispatch targeting staging-verified SHA `d47dab8`, fresh dispatch (web UI, not Re-run). | closed |
| T-83-09-03 | Tampering | staging DB linked into production | mitigate | docs/RUNBOOK.md:195-197 confirms production `DATABASE_URL` references `${{Postgres-EMVk.DATABASE_URL}}` (cannot cross environments). | closed |
| T-83-09-04 | Repudiation / data loss | backups (D-16) | mitigate | Same closure as T-83-01-04 — `infra/pg-backup/` live in production, restore drill passed 2026-10-02 (docs/RUNBOOK.md:510-512). | closed |
| T-83-09-05 | Information Disclosure | deploy records | mitigate | docs/RUNBOOK.md:189-216 records only ids/SHAs/booleans; no connection string literal present (grep confirmed). | closed |
| T-83-10-01 | Tampering | migration-guard.js marker detection | mitigate | `scripts/migration-guard.js:72-73` `UP_MARKER_RE` byte-identical to node-pg-migrate's; mirrored again independently in `scripts/migration-allowlist.js` (GUARD-RESEARCH.md: "the existing marker regexes are byte-identical to node-pg-migrate's"). Judged against the combined chain per orchestrator context. | closed |
| T-83-10-02 | Tampering | comment/literal stripping | mitigate | The hand-written tokenizer this threat targeted is superseded as the authoritative check: `scripts/migration-allowlist.js` parses the real PG16 AST via `libpg-query` instead of tokenizing, eliminating the lexer-desync bypass class. 83-REVIEW.md (deep re-review) confirms 0 Criticals remain and CR-01/CR-01b (the tokenizer-desync bypasses) are RESOLVED under the combined chain. | closed |
| T-83-10-03 | Tampering / DoS (data loss) | RULES (unanchored delete/update, ALTER TYPE, merge/upsert, DO/EXECUTE) | mitigate | `scripts/migration-allowlist.js` allowlists only specific statements/subcommands (migrations-manual/README.md:38-46 "Rejected outright" list enumerates all of these); 83-REVIEW.md confirms WR-02 class (destructive-but-not-DML DDL) all reject under the new allowlist. | closed |
| T-83-10-04 | Elevation of privilege | non-.sql files in migrations/ | mitigate | `scripts/migration-guard.js:420` `findUnguardedFiles` AND `scripts/migration-allowlist.js:404-413` `findUnguardedFiles` (independently reimplemented, IN-02 dirent fix) both fail closed on any non-`.sql` file. | closed |
| T-83-10-05 | Tampering | CREATE FUNCTION calling a pre-existing destructive function by name | accept | See Accepted Risks Log. | closed |
| T-83-10-06 | Denial of service | false positives blocking a legitimate additive deploy | accept | See Accepted Risks Log. | closed |
| T-83-11-01 | Tampering (data integrity) | normalize.js normalizeText | mitigate | `scripts/backfill/normalize.js:275-293` rejects cellError/Date/boolean/object/non-finite with typed reason. | closed |
| T-83-11-02 | Tampering (data integrity) | read-xlsx.js cellToPrimitive | mitigate | `scripts/backfill/read-xlsx.js:22-46` unwraps sharedFormula; unknown shapes become `{cellError}`, never null. | closed |
| T-83-11-03 | Information disclosure | reject reasons | mitigate | normalize.js/read-xlsx.js reasons are type-only strings (e.g. "cell error: #REF!"); written only to the D-13-gated rejects file (rejects.js), never console (T-83-07-05 test covers this path). | closed |
| T-83-11-04 | Tampering | header row | mitigate | `scripts/backfill/read-xlsx.js:80-86` throws "unreadable header in column N of sheet..." on Error/Date/boolean header cells. | closed |
| T-83-11-05 | Denial of service (operator) | stricter rejects on rehearsal re-run | accept | See Accepted Risks Log. | closed |
| T-83-12-01 | Tampering (data integrity) | runBackfill header mapping | mitigate | `scripts/backfill/backfill.js:254-264` aborts with `EXIT.ERROR` listing unmapped headers, before normalise/load/connect. | closed |
| T-83-12-02 | Tampering (data integrity) | runChecks vacuous pass | mitigate | `scripts/backfill/load.js:336-360` `read_vs_accepted` check fails when `read>0 && accepted===0`; `backfill.js:366` always passes `counts.read`. | closed |
| T-83-12-03 | Tampering | promote() of an empty scratch table | mitigate | `scripts/backfill/load.js:417-423` refuses before touching target when source count is 0, checked before BEGIN. | closed |
| T-83-12-04 | Information disclosure | new terminal lines | mitigate | `backfill.js:254` prints only header labels/check names, no cell values (consistent with T-83-07-05 verified behavior). | closed |
| T-83-12-05 | Tampering | runChecks callers omitting `read` | accept | See Accepted Risks Log. | closed |
| T-83-12-06 | Tampering | partial-reject sheets | accept | See Accepted Risks Log. | closed |
| T-83-13-01 | Tampering | Up section lexed differently by guard vs Postgres | mitigate | `scripts/migration-allowlist.js` parses with `libpg-query` (real PG16 grammar); VERIFICATION.md independently reran CR-01a/CR-02a/CR-04 reproductions against `checkSql()` — all rejected. | closed |
| T-83-13-02 | Tampering | standard_conforming_strings-dependent backslash lexing | mitigate | `scripts/migration-allowlist.js:311-320` rejects any backslash in the Up section before parsing (rule `backslash`); VERIFICATION.md reran `checkSql()` on `CHECK (a ~ '\d')` → single `backslash` violation. | closed |
| T-83-13-03 | Tampering / Elevation | Destructive code via function/procedure/trigger/DO/CALL/rule | mitigate | Statement allowlist (`STMTS` in migration-allowlist.js) excludes `CreateFunctionStmt`/`CallStmt`/etc. entirely, no exception mechanism; 83-REVIEW.md confirms DO/CALL/CREATE TRIGGER all `statement-not-allowed`. | closed |
| T-83-13-04 | Tampering | User-function calls in DEFAULT/CHECK/GENERATED/index expressions, INSERT VALUES, RETURNING | mitigate | `scripts/migration-allowlist.js` walks the whole AST (not hand-picked fields, per GUARD-RESEARCH lesson), `FUNCS` allowlist checked on every `FuncCall`; `InsertStmt` key allowlist excludes RETURNING/WITH. | closed |
| T-83-13-05 | Spoofing | search_path "$user" schema shadowing | mitigate | `scripts/migration-allowlist.js` walk() rejects any `relname`-bearing node with `schemaname` not `public`. | closed |
| T-83-13-06 | Tampering | Guard parses different text than node-pg-migrate executes | mitigate | `scripts/migration-allowlist.js:324` mirrors `pgm.sql`'s trailing `;` append; byte-identical marker regexes; no re-slicing (GUARD-RESEARCH.md common pitfall 3 addressed). | closed |
| T-83-13-07 | Denial of Service | WASM fails to load in Railway pre-deploy container | accept | See Accepted Risks Log — now additionally verified working (83-HUMAN-UAT.md test 1). | closed |
| T-83-13-SC | Tampering | npm install of libpg-query 16.7.3 (+ @pgsql/types 16.1.2) | mitigate | GUARD-RESEARCH.md Package Legitimacy Audit both [OK], no install scripts; `package.json` dependencies pin exact `16.7.3`, lockfile committed. | closed |
| T-83-13-08 | Tampering | Allowed DDL changes future behaviour | accept | See Accepted Risks Log. | closed |
| T-83-14-01 | Tampering | package.json migrate script silently unwired | mitigate | `__tests__/migration-allowlist-wiring.test.js` (part of VERIFICATION's reran 225-test subset) pins exact script strings + `railway.toml` preDeployCommand. | closed |
| T-83-14-02 | Tampering | Old guard accepts a bypass and node-pg-migrate runs it | mitigate | `package.json scripts.migrate` `&&` chain confirmed via `node -e`; VERIFICATION.md reran `npm run migrate:guard` directly — both OK lines print, exit 0; `__tests__/db/migration-allowlist-apply.test.js` proves CR-02a blocked end-to-end on real PG16 (neither `pgmigrations` nor `app_meta` created). | closed |
| T-83-14-03 | Denial of Service | libpg-query WASM fails in Railway's build/pre-deploy | accept | See Accepted Risks Log — now verified working on staging (83-HUMAN-UAT.md test 1: `railway ssh` into staging container confirmed Node v20.20.2, libpg-query 16.7.3 loads, both guards print OK). | closed |
| T-83-14-04 | Tampering | Shell injection via temp path / URL in sh -c test command | mitigate | `__tests__/migration-allowlist-wiring.test.js` / `__tests__/db/migration-allowlist-apply.test.js` pass values through env (`"$D"`, `"$BIN"`, `DATABASE_URL`), never string-interpolated (per plan; VERIFICATION reran this suite). | closed |
| T-83-14-05 | Repudiation / Info | README over-claims protection | mitigate | `migrations-manual/README.md:98` "Known limits" section present; VERIFICATION.md confirmed via grep the over-claim sentence is gone (count 0) and "Known limits" is present. | closed |
| T-83-BK-01 | Information Disclosure | R2 credential exposure (`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`) | mitigate | `infra/pg-backup/backup.sh:32-40` reads credentials only from env, exports to `rclone` config in-process, never echoed/logged; `infra/pg-backup/README.md` "Variables" table stores literal values only "in the owner's password manager", not in the repo (confirmed: `git ls-files infra/pg-backup/` shows only Dockerfile/README/backup.sh/restore-drill.sh, no credential files; grep of all four files for key-shaped secrets found none). | closed |
| T-83-BK-02 | Information Disclosure / Elevation | age private key custody | mitigate | `infra/pg-backup/README.md` "One-time setup" step 1: private key generated on owner's Mac, stored in password manager, local file deleted; `AGE_RECIPIENT` (public key only) is the only age-related value in the Railway `pg-backup` service variables table — no `AGE_IDENTITY_FILE`/private key configured on the cron service itself, so a Railway/R2 compromise alone cannot decrypt backups. `restore-drill.sh:17` requires `AGE_IDENTITY_FILE` as a locally-mounted, read-only file, never an env var holding the key material. | closed |
| T-83-BK-03 | Information Disclosure | backup confidentiality (plaintext dump exposure) | mitigate | `infra/pg-backup/backup.sh:62-64` encrypts with `age` before any upload, then `rm -f "$DUMP"` deletes the plaintext; only the `.age` file is ever passed to `rclone copyto` (line 67). 83-UAT.md test 4 independently confirmed the uploaded R2 object is unreadable/encrypted. | closed |
| T-83-BK-04 | Elevation / Tampering | DATABASE_URL exposure to the backup job | mitigate | `infra/pg-backup/README.md` "Variables" table: `DATABASE_URL` = `${{Postgres-EMVk.DATABASE_URL}}` (Railway private-network reference variable, not a copied literal). | closed |
| T-83-BK-05 | Tampering / data loss | backup integrity (corrupt or empty dump reported as success) | mitigate | `infra/pg-backup/backup.sh:57-60` `pg_restore --list` must succeed and report >0 TOC entries before encryption; lines 70-72 re-check the uploaded object's size matches the local encrypted file before logging success; `restore-drill.sh` performs a full restore into a scratch DB and prints row counts — drill passed 2026-10-02 matching production (`infra/pg-backup/README.md` drill history table, 83-HUMAN-UAT.md test 2). | closed |
| T-83-BK-06 | Tampering / DoS | backup deletion by a leaked R2 token | mitigate | `infra/pg-backup/README.md` "Cloudflare R2" setup step 4 + "R2 bucket" note: bucket lock rule on `production/` keeps objects undeletable for their first 7 days; R2 API token scoped to Object Read & Write on this bucket only (cannot create/delete buckets, cannot act on other buckets); `backup.sh:42` sets `RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true` consistent with a token that lacks bucket-admin rights. | closed |
| T-83-BK-07 | Information Disclosure | public exposure (bucket or committed secrets) | mitigate | 83-UAT.md test 4: R2 bucket public access confirmed "Disabled" in the live console; `git ls-files infra/pg-backup/` + content review of all four committed files found no embedded access keys, tokens, or private key material — only the `AGE_RECIPIENT` public key and non-secret config names appear in the public GitHub Pages repo. | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

No `transfer`-disposition threats were declared for this phase.

### Unregistered Flags (SUMMARY.md `## Threat Flags`)

None. No `83-*-SUMMARY.md` file for this phase contains a `## Threat Flags` section (checked all 14: 83-01 through 83-14).

### Note on the 83-10 threats (orchestrator-directed judgment)

T-83-10-01 through T-83-10-04 were originally mitigated solely by `scripts/migration-guard.js`, which 83-REVIEW.md's prior round found individually bypassable (CR-01..CR-04). Per orchestrator instruction, these four are judged here against the **combined chain** (`migration-guard.js && migration-allowlist.js`, wired in both `npm run migrate` and `npm test`) rather than the old guard alone. The fresh, independent 83-REVIEW.md re-review (depth: deep, 2026-10-02T21:35:00Z) found 0 Criticals and confirmed all four original bypass classes (CR-01..CR-04) and two Warnings (WR-01, WR-02) are RESOLVED under the combined chain; VERIFICATION.md independently reproduced the same result by calling `checkSql()` directly. On that basis T-83-10-01..04 are CLOSED.

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-01 | T-83-02-05 | `rejectUnauthorized:false` is scoped by regex to `*.proxy.rlwy.net` only (Railway's self-signed public TCP proxy), used for short-lived, owner-initiated connections (backfill CLI) over Railway's own infrastructure; the in-Railway private `DATABASE_URL` path needs no TLS relaxation. Verified scoped in `lib/db.js:38-43`. | Owner (Phase 83 plan 83-02) | 2026-10-02 |
| AR-02 | T-83-05-03 | `postgres:16-alpine` is the official Docker Hub Postgres image, pulled only into throwaway Testcontainers for tests; no secrets are ever placed inside it. | Owner (Phase 83 plan 83-05) | 2026-10-02 |
| AR-03 | T-83-10-05 | A migration that `CREATE FUNCTION`s a wrapper calling an *already-existing* destructive function by name is not catchable by static analysis of the new file alone; creating that destructive function in the first place is itself a rejected statement (`CreateFunctionStmt` always rejected, owner decision 2, 83-GUARD-RESEARCH.md). Code review remains the backstop per D-04's literal wording ("convention + review check at minimum"). | Owner (83-GUARD-RESEARCH.md Owner Decision 2) | 2026-10-02 |
| AR-04 | T-83-10-06 | The guard fails closed by design; false positives route legitimate work to `migrations-manual/` rather than silently allowing anything. Additive forms that matter (ADD COLUMN type, FK ON UPDATE SET NULL, ON CONFLICT DO NOTHING, trigger EXECUTE FUNCTION as a manual-path item) are pinned as accepted by the test fixture corpus. | Owner (83-GUARD-RESEARCH.md) | 2026-10-02 |
| AR-05 | T-83-11-05 | Stricter, reject-not-coerce normalisation (D-12) means previously-silently-coerced sheet values now surface as rejects on a rehearsal re-run. This is the intended outcome — the owner fixes the sheet or passes `--accept-rejects` — not a defect. | Owner (Phase 83 plan 83-11) | 2026-10-02 |
| AR-06 | T-83-12-05 | `runChecks` defaults `read` to `rows.length` only for back-compat with existing direct callers/tests; the sole production caller (`backfill.js`) always passes the real `read` count explicitly, pinned by a Docker-free test. | Owner (Phase 83 plan 83-12) | 2026-10-02 |
| AR-07 | T-83-12-06 | Partial-reject sheets (e.g. 1 of 400 rows accepted) are not a vacuous pass: the rejects gate (`exit 2` without `--accept-rejects`) and the PII-protected rejects report already surface them. Choosing to proceed anyway via `--accept-rejects` is an explicit, logged owner action under D-12. | Owner (Phase 83 plan 83-12) | 2026-10-02 |
| AR-08 | T-83-13-07 / T-83-14-03 | libpg-query's WASM load inside Railway's actual build/pre-deploy container had never been observed at plan time (research assumption A1); the guard fails closed (a load failure aborts the deploy, previous release keeps serving), so the cost of being wrong is a blocked deploy, not data loss. **Update 2026-10-02:** now empirically verified working — 83-HUMAN-UAT.md test 1 confirms via `railway ssh` into the live staging container that Node v20.20.2 loads libpg-query 16.7.3 and both guards print `additive-only OK`. Risk realized as zero; residual risk (future Railway build-image change) remains accepted on the same fail-closed basis. | Owner (83-GUARD-RESEARCH.md; confirmed 83-HUMAN-UAT.md) | 2026-10-02 |
| AR-09 | T-83-13-08 | Allowed additive DDL (SET NOT NULL, a new CHECK, FK ON DELETE CASCADE) can change *future* write/delete behaviour without dropping, renaming, or rewriting *existing* data — within D-04's literal wording. Documented as a residual risk in `migrations-manual/README.md`'s "Known limits" section (confirmed present, VERIFICATION.md). | Owner (83-GUARD-RESEARCH.md) | 2026-10-02 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-10-02 | 80 (73 plan-time + 7 new T-83-BK for the unplanned `infra/pg-backup/` service) | 80 | 0 | gsd-security-auditor |

Note on count: the orchestrator's register description cited "74 plan-time threats"; this auditor's re-extraction of all fourteen `<threat_model>` blocks found 73 distinct threat IDs (the discrepancy is not security-relevant — every ID actually present in a PLAN.md was individually verified below; none was found missing from a plan but present elsewhere).

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-10-02
