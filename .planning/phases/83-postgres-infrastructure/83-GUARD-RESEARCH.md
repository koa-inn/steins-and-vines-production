# Phase 83: Durable Additive-Only Migration Guard - Research

**Researched:** 2026-10-02
**Domain:** Postgres migration safety gate (D-04): SQL parsing, policy enforcement, DB-level controls
**Confidence:** HIGH for the parser and experiment results (run locally against real PG16). MEDIUM for the Railway build behaviour (reasoned, not deployed). LOW for Railway superuser access (not checked).

## Recommendation

Replace the hand-written tokenizer and regex denylist with a **fail-closed allowlist over the real Postgres parser**. Use `libpg-query@16.7.3`: the official PG16 grammar from libpg_query, compiled to WebAssembly, with zero install scripts and about 1.2 MB installed. Each Up section is parsed into an AST, and **only** these are accepted: an explicit set of statement types, ALTER TABLE subcommands, expression node types and built-in functions. Anything the guard does not recognise, any parse error, and **any backslash** in the Up section is rejected and routed to `migrations-manual/`.

The orchestrator's diagnosis is **confirmed**:
- The current guard accepted 43 of the 87 unsafe payloads I tested.
- In this session alone I found 5 new bypass classes beyond 83-REVIEW.md. All were verified on PG16: an "INSERT-only" or "COMMENT-only" file that drops a table when the database has `standard_conforming_strings=off`; a trigger fired by an allowed INSERT; function calls in DEFAULT/CHECK/index expressions; `INSERT … RETURNING fn()`; and shadowing a table through the `"$user"` schema on the search_path.
- The prototype allowlist rejected **87/87** of those payloads (plus 2 deliberate policy rejections and 1 documented false reject) and accepted **20/20** additive migrations, including `0001_init.sql` and a realistic Phase 84 `0002` gift-card migration. Those were then applied cleanly to PG16.

There is one important refinement to the hypothesis: **a real parser is necessary but not sufficient.** It cannot see server-side lexer state (`standard_conforming_strings`), and it cannot see what objects a name resolves to (search_path, existing functions). Both had to be closed by policy rules: the backslash ban, a `public`-only schema rule, and a function allowlist. A DB-level backstop is not worth building now. Event triggers cannot stop DELETE or TRUNCATE, they need superuser, and owners can always DROP. The real backstop is backups, which Railway Hobby does not provide.

**Trade-offs:**
- **More false rejects, by design.** CREATE FUNCTION/TRIGGER/VIEW, GRANT, CREATE EXTENSION, CREATE SCHEMA, SET, and any backslash (e.g. regex `\d`; write `[0-9]` instead) all go to `migrations-manual/`. Each future widening is a small, reviewable code change instead of another round of regex fixes.
- **One new production dependency** (`libpg-query` plus `@pgsql/types`, MIT, about 1.4M weekly downloads, no install scripts). It must live in `dependencies`, because the pre-deploy step runs after `npm install --production`.
- **Async init.** `parseSync` needs `await loadModule()` first. That is fine for the CLI and new tests, but the existing synchronous `findDestructiveStatements` API cannot be backed by it without a Jest setup hook (see "Existing tests").
- **The parser version must match the server's major version.** Pin `16.7.3`. If Railway moves to PG17+, new syntax fails to parse and is rejected (fails closed) until the dist-tag is bumped.
- Effort: about 1 day (module ~120 lines, new test file, README and `package.json` changes). `[ASSUMED estimate]`

<user_constraints>
## User Constraints (from 83-CONTEXT.md)

### Locked Decisions
- **D-04:** Deploy-time migrations are **additive only**. Anything that drops, renames or rewrites data is a separate, manually triggered step with a backup first. Planner should make this enforceable (convention + review check at minimum).

### Task constraints (from the orchestrator)
- Do not edit `__tests__/migration-guard*.test.js` (CLAUDE.md rule 10).
- Must land before Phase 84 adds migration 0002.
- Node 20.20, CommonJS; the guard runs in the Railway pre-deploy container after `npm install --production`.
</user_constraints>

## Project Constraints (from CLAUDE.md)
- Run `npm test` and `cd zoho-middleware && npm test` before committing. Run `npm run lint`. Middleware commands are always run from `zoho-middleware/`.
- Do not modify existing tests unless explicitly asked. This decides the test strategy below.
- After changing shared utilities, run the full suites for both frontend and middleware.
- All changes go to staging first.
- The gemini CLI is broken (memory), so it was not used.

## Option Comparison

| # | Option | Fails closed? | Durability | Effort | New deps | Railway risk | False-reject risk |
|---|--------|---------------|------------|--------|----------|--------------|-------------------|
| 1 | **Real parser (libpg-query PG16 WASM) + allowlist** (recommended) | **Yes.** Unknown statement, node, function, ALTER subcommand or parse error is rejected | High. The grammar is Postgres's own; the policy is a short explicit list | ~1 day | `libpg-query` 16.7.3 + `@pgsql/types` (1.2 MB, no install scripts) | Low. Pure WASM, no compiler `[VERIFIED: package contents]`; Railpack build not exercised `[ASSUMED]` | Medium, by design (functions, triggers, views, grants, extensions, backslashes go to manual) |
| 2 | Keep patching the tokenizer + denylist (83-REVIEW fixes) | No. Unknown constructs pass | Low. 3 review rounds so far, 4 criticals still open, and 5 more classes found here | ~0.5 day per round, indefinitely | none | none | Low |
| 3 | Squawk 2.66.0 (`squawk-cli`) | No. It is a denylist lint focused on lock safety | Low for D-04. Since 2.0 it uses its own error-tolerant Rust parser, not libpg_query `[CITED: squawk CHANGELOG]` | Low | Platform binaries via optionalDependencies | Medium (binary per platform) | Low. But **`DELETE FROM gift_cards` reported 0 issues** in my test, and `TRUNCATE` / the `'…'` function body raised only lock-timeout warnings |
| 4 | Atlas `migrate lint` | No (denylist analyzers) | n/a | Medium | Go binary + dev DB | Medium | n/a. **Pro-only since v0.38** `[CITED: atlasgo.io/community-edition]` |
| 5 | `pgsql-ast-parser` (pure-JS grammar) | Only with an allowlist | Medium-low. It re-implements PG grammar in JS, the same mismatch class as today | ~1 day | 1 pkg | Low | Higher (grammar gaps) |
| 6 | DB-level: separate owner/migrator roles | No | Owners can always DROP: "The right to modify or destroy an object is inherent in being the object's owner, and cannot be granted or revoked" `[CITED: postgresql.org/docs/16/ddl-priv.html]`. ALTER ADD COLUMN needs ownership, so the migrator must own the tables | Medium | none | Medium (role setup per env) | n/a |
| 7 | DB-level: `sql_drop` + `table_rewrite` event triggers | Partial | Blocks DROP TABLE/COLUMN and type-rewriting ALTERs. **Does not** block TRUNCATE or DELETE (verified on PG16; see below). UPDATE, RENAME and CREATE RULE are also outside these two events, because they neither drop objects nor rewrite tables (inferred from the docs, not run). Event triggers only cover DDL `[CITED: docs/16/event-trigger-definition.html]` | Medium | none | **Needs superuser:** "Only superusers can create event triggers" `[CITED: docs/16/sql-createeventtrigger.html]`. Whether Railway's `postgres` user is a superuser was **not checked** | Blocks the owner's own manual migrations unless bypassed by role (a GUC-based bypass is defeated by `SET`, verified) |
| 8 | Dry-run: apply in a transaction, diff catalog + row counts, roll back | Partial | Misses semantic changes that do not shrink anything (rules, triggers, defaults, RLS, schema shadowing). It would mean re-implementing node-pg-migrate's runner and tracking table | High | none | Medium | Low |
| 9 | Backups / PITR (Railway plan upgrade) | n/a. This is recovery, not prevention | The only control that covers everything, including the human-run `migrations-manual/` path | Ops task | none | none | none |

**Recommended combination:** Option 1 as the deploy gate, plus Option 9 (already a known Phase 84 blocker) as the real backstop. Skip 6, 7 and 8 for a one-developer shop: they add operational surface and still leave DML open. If the owner later wants defence in depth, Option 7 is the cheapest add-on, but only after confirming superuser access and keying the bypass on `current_user`, not on a settable GUC.

## Experiment

**Setup:** prototype at `scratchpad/guard-research/allowlist-guard.js` (75 lines, CommonJS, reproduced in the Appendix). `libpg-query@16.7.3` was installed in the scratchpad only, not the repo. The corpus is `cases.js` (110 files, each wrapped in node-pg-migrate Up/Down markers), run by `run.js`. Results were compared with the current `scripts/migration-guard.js`, loaded read-only.

**Environment:** Node v20.20.2 (via nvm) and v20.17.0, CommonJS `require()`; `postgres:16-alpine` (PostgreSQL 16.15) in Docker; node-pg simple-query protocol (the way `pgm.sql` sends the Up section).

**Package facts** `[VERIFIED: npm registry + installed package.json]`:
- `libpg-query@16.7.3` (dist-tag `pg16`, published 2025-12-11). Built from libpg_query `16-5.2.0`; the AST reports `version: 160001`. Main entry is `./wasm/index.cjs` (CJS supported). 8 files, 1,058,610 bytes unpacked. **No preinstall/install/postinstall scripts.** One dependency, `@pgsql/types ^16.1.2` (116 KB). Licence MIT. Repo github.com/constructive-io/libpg-query-node. About 1.42M downloads per week. The `latest` tag is 18.1.5 (PG18); the per-major tags are pg13 to pg18.
- **Load + parse cost:** WASM init 16 ms; all 110 cases parsed and checked in 10 ms; process RSS 77 MB.
- **API:** `loadModule(): Promise<void>`, then `parseSync(sql)`. Calling `parseSync` before init throws "WASM module not initialized. Call `loadModule()` first." (`wasm/index.cjs:123-126`).

### Results summary

| Source of payloads | Count | Expected | Current guard | Prototype |
|---|---|---|---|---|
| `migration-guard.test.js` destructive + missing marker | 10 | Reject | 10/10 reject | **10/10 reject** |
| `migration-guard.test.js` safe / comments / literals / down-only | 8 | Accept | 8/8 | **8/8** |
| `migration-guard-hardening.test.js` parse bypasses + unterminated + rules | 27 | Reject | 27/27 | **27/27** |
| Hardening "accepted" cases (ADD COLUMN type, SET DEFAULT, enum ADD VALUE, FK on update set null, ON CONFLICT DO NOTHING, nested comment) | 7 | Accept | 7/7 | **7/7** |
| Hardening accepted **policy changes** (CREATE TRIGGER, benign plpgsql function) | 2 | Reject (new policy) | accepted | **reject** |
| 83-REVIEW CR-01a/b, CR-02a/b, CR-03, CR-04 | 6 | Reject | **0/6** | **6/6** |
| 83-REVIEW WR-01 (scs SET, `'\''`, ALTER DATABASE SET) | 3 | Reject | **0/3** | **3/3** |
| 83-REVIEW WR-02 (DETACH PARTITION, SET SCHEMA, CREATE OR REPLACE FUNCTION/VIEW, CREATE RULE DO INSTEAD, DISABLE TRIGGER, CREATE POLICY, ENABLE RLS, dblink_exec, CALL) | 10 | Reject | **0/10** | **10/10** |
| New attacks found in this session (see below) | 31 | Reject | 7/31 | **31/31** |
| `migrations/0001_init.sql` (real file) | 1 | Accept | yes | **yes** |
| Phase 84 `0002` gift cards (DDL from notes §3.1 + sequence-backed `GC-%06d` default, numeric(10,2), CHECKs, FK, bigserial, UNIQUE, index, COMMENT with `$c$`) | 1 | Accept | yes | **yes**, applied OK on PG16 |
| Later additive file (CREATE TYPE enum, ADD COLUMN with default / IF NOT EXISTS / multi-ADD, CHECK NOT VALID + VALIDATE, identity PK, FK ON DELETE RESTRICT, partial unique index, `lower()` expression index, SET DEFAULT, SET NOT NULL, enum ADD VALUE, INSERT … ON CONFLICT DO NOTHING, jsonb CHECK, `gen_random_uuid()`) | 1 | Accept | yes | **yes**, applied OK on PG16 |
| `public.`-qualified CREATE TABLE; regex CHECK written with `[0-9]` | 2 | Accept | yes | **yes** |
| Regex CHECK written with `\d` (documented false reject of the backslash ban) | 1 | Reject (accepted cost) | accepted | reject |
| **Total** | **110** | 90 R / 20 A | 44/90 R, 20/20 A (of the 87 genuinely unsafe payloads: **44/87 rejected, 43 accepted**) | **90/90 R, 20/20 A** |

The prototype result is not a "verified safe" claim. It means every payload I could construct was rejected, and the design rejects anything it does not recognise.

### New bypass classes found in this session (all verified on PG16.15)

| Payload (abridged) | Current guard | Prototype | Verified effect on PG16 |
|---|---|---|---|
| DB has `standard_conforming_strings=off`, then `INSERT INTO notes_t (k) VALUES ('\', '); drop table t; --');` | accept | reject (backslash) | **Table dropped** |
| same, then `COMMENT ON TABLE x IS '\'⏎'; drop table v1; --';` (adjacent-literal concatenation) | accept | reject (backslash). **Was accepted** by the first prototype, whose rule checked only `A_Const` | **Table dropped** |
| same, then `CREATE TYPE e AS ENUM ('\'⏎'); drop table v2; --');` | accept | reject (backslash). Also **accepted** by the first prototype | **Table dropped** |
| `create function stamp() … plpgsql as $$ begin delete from gift_cards; return new; end $$; create trigger … before insert on app_meta …; insert into app_meta …` | reject (function-body scan) | reject (CreateFunctionStmt) | **gift_cards emptied** inside the migration. This is why CREATE FUNCTION + TRIGGER cannot be allowlisted without body analysis |
| `CREATE TABLE postgres.gift_cards (…)` when the app connects as `postgres` (search_path `"$user", public`) | accept | reject (schema ≠ public) | **App's unqualified `gift_cards` now resolves to the empty table** (0 rows visible) |
| `ADD COLUMN x int DEFAULT wipe()` / `GENERATED ALWAYS AS (wipe()) STORED` / `ADD CONSTRAINT CHECK (wipe() …)` / `CREATE INDEX … ((wipe()))` / `… WHERE wipe()` | accept | reject (function allowlist) | evaluated once per existing row (not executed here; standard PG semantics) |
| `INSERT … VALUES ('k', wipe())`, `INSERT … SELECT`, `INSERT … VALUES ((SELECT …))`, `INSERT … RETURNING *` | accept | reject. **RETURNING was accepted** by the first prototype, which walked only some INSERT fields | not run |
| `ALTER TABLE g ADD COLUMN x int, DROP COLUMN balance`; `ALTER INDEX …`; `COPY … FROM PROGRAM`; `LOCK TABLE`; `SELECT pg_terminate_backend(…)`; `CREATE TABLE AS SELECT wipe()`; `REVOKE`; `CREATE EXTENSION dblink`; non-ASCII `café TYPE int` | mixed | all reject | not run |

**Lesson from the two first-prototype misses:** fail-closed has to apply at the **field** level as well as the statement level.
1. Always walk the **entire** statement body; never hand-pick fields.
2. Check unwrapped typed fields by shape (e.g. any object with `relname`), not by wrapper key. libpg-query emits `relation`, `typeName` and `onConflictClause` unwrapped.
3. For any statement with special rules (INSERT), keep an allowlist of its known keys and reject unknown ones.
4. Judge each statement from its AST node. My compatibility shim first re-sliced statement text and re-ran marker detection, which turned the `-- down migration notes` comment into a fake Down marker.

### DB-level backstop probe (PG16.15, superuser creates triggers, `migrator` owns the table)

| Command as `migrator` | Result with `sql_drop` + `table_rewrite` event triggers |
|---|---|
| `DROP TABLE victim` | blocked |
| `ALTER TABLE victim DROP COLUMN bal` | blocked |
| `ALTER COLUMN bal TYPE integer` (rewrite) | blocked |
| `ALTER COLUMN bal TYPE numeric(12,2)` (no rewrite) | allowed (benign here, but shows that only rewrites are caught) |
| `TRUNCATE victim` / `DELETE FROM victim` | **allowed: 1 row → 0 rows** |
| `ALTER EVENT TRIGGER … DISABLE` | refused (not owner): good |
| bypass via `SET migrations.allow_destructive = on` | any session can set a custom GUC, so this is **not a safe escape hatch**. Key on `current_user`/`session_user` instead |

### Compatibility check: existing test files run unchanged against an allowlist-backed shim

The two test files were copied unchanged to the scratchpad. Their require path was pointed at a shim that maps rejected statements back to the legacy rule names (`drop`, `truncate`, `rename`, `alter-type`, `sequence-reset`, `do-block`, `execute`, `merge`, `upsert`, `delete`, `update`, `unterminated-token`, `missing-up-marker`) and reuses `findUnguardedFiles`. Jest `setupFilesAfterEnv` pre-awaited `loadModule()`. Result: **63 passed, 4 failed of 67.**

| Failing test (unedited) | Why | Nature |
|---|---|---|
| hardening › "still flags drop around an empty dollar-quoted string literal ($$'$$)", expects exactly 1 violation | The allowlist also rejects both `SELECT $$'$$` statements (3 violations) | Policy (SELECT not allowed) |
| hardening › "recursively scans a dollar-quoted SQL function body for a hidden delete", expects rule `delete` | Rejected as `CreateFunctionStmt` (not-allowlisted). Could be satisfied by also parsing `LANGUAGE sql` bodies just to name the rule | Cosmetic; fixable |
| hardening › "passes a benign plpgsql trigger function body", expects `[]` | CREATE FUNCTION goes to manual | Policy |
| hardening › accepted › `CREATE TRIGGER … EXECUTE FUNCTION set_updated_at()`, expects `[]` | CREATE TRIGGER goes to manual | Policy |

All CLI tests (exit codes, `0001_bad.sql: drop:` stderr, `non-sql-file`, `1 file(s) additive-only OK`) passed through the shim.

## Proposed Allowlist

Parse **exactly** what node-pg-migrate 9.0.0 executes. `getActions()` slices the Up section (the existing marker regexes are byte-identical to node-pg-migrate's). Then `pgm.sql()` runs `createTransformer` (a no-op with no args) and **appends `;` if the text doesn't already end with one** `[VERIFIED: node_modules/node-pg-migrate/dist/bundle/index.js:276-281, 1237-1244]`. Mirror that append. Separately: when there is no Up marker, node-pg-migrate runs the **whole file** as Up (`sqlMigration.js` `getActions`). The current guard's comment says it is a no-op. Rejecting a file with no Up marker is still correct.

**Pre-parse gates (whole Up section):**
- No `-- Up Migration` marker → reject.
- Any `\` character → reject. Lexing of backslashes depends on the server's `standard_conforming_strings`, which a parser cannot see. Workaround: `[0-9]` instead of `\d`, `E'…'` is unnecessary.
- Parse error → reject.

**Statement types allowed:**

| Statement node | Extra conditions |
|---|---|
| `CreateStmt` (CREATE TABLE, incl. TEMP, PARTITION OF, LIKE, INHERITS) | Relation unqualified or `public` |
| `IndexStmt` (CREATE [UNIQUE] INDEX, partial, expression) | Expressions pass the node/function allowlist. `CONCURRENTLY` will fail inside node-pg-migrate's transaction anyway (harmless failure) |
| `CreateSeqStmt` | — |
| `CommentStmt` | — |
| `CreateEnumStmt` | — |
| `AlterEnumStmt` | `newVal` set and no `oldVal` (ADD VALUE only; RENAME VALUE rejected) |
| `AlterTableStmt` | `objtype === 'OBJECT_TABLE'` (rejects ALTER INDEX/SEQUENCE/VIEW sharing the node) and **every** subcommand in the list below |
| `InsertStmt` | Keys limited to `relation, cols, selectStmt, onConflictClause, override`. `selectStmt` is VALUES-only (keys `valuesLists, limitOption, op`). `onConflictClause` absent or `ONCONFLICT_NOTHING`. No WITH, no RETURNING |

**ALTER TABLE subcommands allowed:** `AT_AddColumn`, `AT_AddConstraint` (CHECK/FK/UNIQUE/PK, incl. NOT VALID), `AT_ValidateConstraint`, `AT_ColumnDefault` **only when setting** a default (DROP DEFAULT rejected), `AT_SetNotNull`.

**Expression/aux node types allowed inside those statements:** `RangeVar, ColumnDef, TypeName, String, Integer, Float, Boolean, BitString, A_Const, Constraint, TypeCast, A_Expr, BoolExpr, NullTest, ColumnRef, IndexElem, List, ResTarget, CollateClause, A_ArrayExpr, CoalesceExpr, SQLValueFunction, DefElem, FuncCall (restricted), AlterTableCmd (restricted), PartitionBoundSpec, PartitionSpec, PartitionElem, TableLikeClause, ObjectWithArgs, CaseExpr, CaseWhen, MinMaxExpr, SetToDefault`. Anything else (`SubLink`, `SelectStmt` outside INSERT VALUES, `CommonTableExpr`, …) is rejected.

**Functions allowed** (unqualified or `pg_catalog.`): `now, nextval, lpad, gen_random_uuid, lower, upper, btrim, length, char_length, jsonb_typeof`. `current_timestamp` and similar are `SQLValueFunction` nodes and need no listing. Grow this list deliberately: every entry must be a side-effect-free built-in, except `nextval`, which only advances a sequence.

**Routed to `migrations-manual/` (everything else), notably:**
- DROP, TRUNCATE, DELETE, UPDATE, MERGE, upsert
- RENAME, ALTER … TYPE, SET SCHEMA, DETACH PARTITION, DROP DEFAULT / DROP NOT NULL / any `AT_Drop*`
- ALTER SEQUENCE / RESTART / `setval`
- DO, CALL, EXECUTE / PREPARE, any SELECT, COPY, LOCK
- CREATE [OR REPLACE] FUNCTION / PROCEDURE / TRIGGER / RULE / VIEW / POLICY, ENABLE/DISABLE TRIGGER / RLS
- CREATE SCHEMA, CREATE EXTENSION, CREATE DOMAIN, GRANT/REVOKE
- SET / RESET, ALTER DATABASE/ROLE/SYSTEM, transaction control (BEGIN/COMMIT)
- CREATE TABLE AS
- Any relation outside `public`, any backslash

**Phase 84 impact:** the notes' §3.1 DDL passes unchanged, including a sequence-backed `GC-000001` default (verified). Things that would need the manual path or a later allowlist widening: an `updated_at` trigger, GRANTs to a separate app role, `CREATE EXTENSION`, regex CHECKs written with `\d`. `setval` after the backfill belongs in the backfill tooling, not a migration.

## Existing Tests: What Happens

CLAUDE.md rule 10 forbids editing `__tests__/migration-guard.test.js` (17 tests) and `__tests__/migration-guard-hardening.test.js` (50 tests).

| Approach | Old tests | Notes |
|---|---|---|
| **A. New module `scripts/migration-allowlist.js`; `migrate` = `node scripts/migration-guard.js && node scripts/migration-allowlist.js && node-pg-migrate up`** (recommended) | **67/67 still pass**: `migration-guard.js` is untouched | New tests in a new file use `beforeAll(() => loadModule())`. The old guard becomes a redundant first pass. It can only add rejections (its only known false positive is IN-01, a table named `type`). The owner can retire it and its tests later by explicit decision. Also apply IN-02 (dirent filtering) to the new module's non-SQL file check. |
| B. Swap `migration-guard.js` internals to the allowlist with legacy rule-name mapping | **63/67** (measured), and only with a Jest `setupFilesAfterEnv` hook added to `jest.config.js` to pre-load the WASM | 4 failures are policy conflicts (listed above). Requires the owner's explicit permission to edit or delete those 4 tests. The CLI must become async. |
| C. B without the Jest hook | All 46 tests that call `findDestructiveStatements` / `checkMigrationsDir` in-process would throw "WASM module not initialized" | Not viable. |

## Common Pitfalls

1. **Treating the parser as a silver bullet.** Server state still changes meaning: `standard_conforming_strings` (lexing), search_path (`"$user"` schema shadowing), existing functions/operators (resolution). The backslash ban, `public`-only relations and the function allowlist cover these. Warning sign: any proposal to allow `SET`, `CREATE SCHEMA` or user-defined function calls.
2. **Partial AST walks.** Always walk the whole node. Check unwrapped fields by shape. Use key allowlists for special-cased statements (both first-prototype misses came from this).
3. **Parsing text that differs from what's executed.** Mirror node-pg-migrate's Up slicing and its trailing `;`. Never re-slice statement text to re-run checks.
4. **Version skew.** Pin `libpg-query` exactly (`16.7.3`, not `^`/`latest`, because `latest` is PG18). Add a test asserting `parseSync('select 1').version` is in the 160000 range. Bump it together with any Railway PG major upgrade.
5. **Dependency placement.** It must be in `dependencies`. The pre-deploy runs after `npm install --production`, so a devDependency is absent there, the require fails and the deploy aborts. That fails closed, but it blocks every deploy.
6. **Allowlisting CREATE FUNCTION + CREATE TRIGGER.** Verified: a trigger fired by an allowlisted INSERT in the same migration runs a destructive body. Do not allow these without body analysis (libpg-query's PL/pgSQL parse API is PG18-only per its README) or an exact-statement hash allowlist reviewed by the owner.
7. **Event-trigger escape hatches via custom GUCs.** Any session can `SET` them (verified).

## Residual Risks the Allowlist Does Not Address
- Allowed DDL can still change **future** behaviour without destroying existing rows: SET DEFAULT, SET NOT NULL or a new CHECK can make app writes fail; an FK with ON DELETE CASCADE extends future deletes. This is within D-04's literal wording ("drops, renames or rewrites data"), but worth a line in the README.
- Operators in expressions (`||`, `~`, `>`) resolve to functions. User-defined operators could only exist via the manual path. `[ASSUMED low risk]`
- Existing triggers and rules created through `migrations-manual/` still fire on allowlisted INSERTs. They were human-reviewed, but the guard cannot see them.
- The app and migrations probably share one `DATABASE_URL` role, likely superuser. `[ASSUMED, not checked]` This is a least-privilege issue outside this guard.

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---|---|---|---|---|---|---|
| `libpg-query` 16.7.3 | npm | created 2021-03-19; this version 2025-12-11 | ~1.42M/wk | github.com/constructive-io/libpg-query-node | [OK] | Approved. Pin exactly; production dependency |
| `@pgsql/types` 16.1.2 (transitive) | npm | created 2024-03-30 | (transitive) | github.com/constructive-io/libpg-query-node | [OK] | Approved (transitive) |
| `squawk-cli` 2.66.0 | npm | — | ~857k/wk | github.com/sbdchd/squawk | [OK] | Evaluated only. **Not recommended** |

No postinstall/install/preinstall scripts on libpg-query 16.7.3 or @pgsql/types 16.1.2 `[VERIFIED: npm view … scripts]`. Packages removed for slop: none. Flagged suspicious: none.

## Environment Availability

| Dependency | Required by | Available | Version | Fallback |
|---|---|---|---|---|
| Node 20.x | guard CLI | ✓ | 20.20.2 (nvm), 20.17.0 default | — |
| Docker + `postgres:16-alpine` | DB-backed tests | ✓ | PG 16.15 | — |
| WebAssembly in Node | libpg-query | ✓ | built into Node 20 | — |
| Railway pre-deploy with libpg-query | production gate | not tested | — | Verify on the first staging deploy: the pre-deploy log must show `additive-only OK` |
| Railway superuser (only for optional event triggers) | Option 7 | unknown | — | Owner can run `select rolsuper from pg_roles where rolname = current_user;` over the tunnel |

## Assumptions Log

| # | Claim | Risk if wrong |
|---|---|---|
| A1 | Railway's Railpack/Nixpacks build installs libpg-query with no extra steps (pure WASM, no scripts) | First deploy's pre-deploy fails. That fails closed, so the cost is a blocked deploy, not data loss |
| A2 | Railway Postgres is PG16.x, matching the parser's major version | On 17+, new syntax is rejected (fails closed); bump the dist-tag |
| A3 | PG minor releases do not change grammar relevantly between the parser's 16.1 base and the server's 16.x | Negligible; fails closed on unknown syntax |
| A4 | The app connects as a superuser `postgres` role | Affects the schema-shadowing severity and the event-trigger feasibility only |
| A5 | About 1 day of effort | Planning only |

## Open Questions for the Owner

1. **Retire the old guard?** Do you want to keep `migration-guard.js` and its 67 tests as a redundant first pass (approach A, no test edits)? Or authorise replacing it, which means editing or deleting 4 tests that encode the old policy?
2. **Functions and triggers.** Is an `updated_at` trigger needed in Phase 84+? If so: always use the manual path? Or add an "exact-statement SHA-256 allowlist" that you approve per function?
3. **Widening the allowlist.** CREATE VIEW (non-replace), GRANT, and `CREATE EXTENSION pgcrypto/citext`: allow later, or always manual?
4. **Backslash ban.** Acceptable to write regexes as `[0-9]` instead of `\d`? The alternative is a runtime check that the target database's `standard_conforming_strings` is `on` before migrating. That needs a DB connection inside the guard.
5. **Backups.** Railway Hobby has no backups/PITR. Upgrading (or a scheduled off-box `pg_dump`) is the only backstop for both deploy migrations and the human-run `migrations-manual/` path. Should that be a hard prerequisite for Phase 84?

## Security Domain

| ASVS category | Applies | Control |
|---|---|---|
| V5 Input validation | yes | Allowlist over a real parser's AST; reject on parse error or unknown input |
| V1/V14 Config / build integrity | yes | Exact-pinned production dependency, no install scripts, lockfile committed |
| V4 Access control | partial | DB roles do not stop owner DROPs (documented). Least-privilege app role is an open item |

| Threat | STRIDE | Mitigation |
|---|---|---|
| Destructive SQL disguised by lexer desync | Tampering | Real PG grammar plus a backslash ban |
| Destructive code via functions, triggers or rules | Tampering / Elevation | Statement and function allowlists; FUNCTION/TRIGGER/RULE go to manual |
| Name-resolution hijack (schema shadowing) | Spoofing / Tampering | `public`-only relations; CREATE SCHEMA goes to manual |

## Sources

### Primary (HIGH)
- npm registry: `npm view libpg-query dist-tags / @16.7.3 scripts, dependencies, dist` (run 2026-10-02); installed `node_modules/libpg-query/package.json`, `wasm/index.cjs`, `wasm/index.d.ts`, README
- https://github.com/constructive-io/libpg-query-node: WASM-only, per-major dist-tags, MIT, built on pganalyze libpg_query
- https://www.postgresql.org/docs/16/ddl-priv.html: owner's right to modify/destroy is not grantable
- https://www.postgresql.org/docs/16/sql-createeventtrigger.html: "Only superusers can create event triggers."
- https://www.postgresql.org/docs/16/event-trigger-definition.html: events are ddl_command_start/end, table_rewrite and sql_drop only
- node-pg-migrate 9.0.0 installed source: `dist/legacy/sqlMigration.js` (getActions), `dist/bundle/index.js:276-281, 1237-1244` (createTransformer, sql)
- Local experiments: Docker `postgres:16-alpine` (16.15); scratchpad `guard-research/` (`allowlist-guard.js`, `cases.js`, `run.js`, `results.txt`, `apply.js`, `scs.js`, `scs2.js`, `compat/`)

### Secondary (MEDIUM)
- https://github.com/sbdchd/squawk/blob/master/CHANGELOG.md: 2.0.0 (2025-05-07) new parser, dropped libpg_query
- https://squawkhq.com/docs/rules: denylist rule set (ban-drop-*, changing-column-type, …)
- https://atlasgo.io/community-edition and https://atlasgo.io/versioned/lint: `migrate lint` is Atlas Pro from v0.38
- https://supabase.com/blog/event-triggers-wo-superuser: event triggers need superuser on managed PG

## Metadata
- Standard stack: HIGH (registry and installed-package verified; ran on Node 20.20.2 CJS)
- Architecture/allowlist: HIGH for the tested corpus; inherently open to new attack classes, but fails closed
- Pitfalls: HIGH (each was reproduced locally)
- Railway build behaviour: MEDIUM/unverified
- Valid until: about 30 days, or until a Railway PG major upgrade

## Appendix: Prototype (`scratchpad/guard-research/allowlist-guard.js`, final)

```js
'use strict';
// PROTOTYPE — fail-closed allowlist migration guard on the real PG16 parser (libpg-query@16.7.3, WASM).
var pg = require('libpg-query');
var UP_RE = /^\s*--[\s-]*up\s+migration/im, DOWN_RE = /^\s*--[\s-]*down\s+migration/im; // == node-pg-migrate 9

var STMTS = {
  CreateStmt: 1, IndexStmt: 1, CreateSeqStmt: 1, CommentStmt: 1, CreateEnumStmt: 1,
  AlterTableStmt: function (s) { return s.objtype === 'OBJECT_TABLE' || 'ALTER on non-table ' + s.objtype; },
  AlterEnumStmt: function (s) { return (s.newVal && !s.oldVal) || 'enum rename'; },
  InsertStmt: function (s) {
    var extra = Object.keys(s).filter(function (k) { return ['relation', 'cols', 'selectStmt', 'onConflictClause', 'override'].indexOf(k) < 0; });
    if (extra.length) return 'INSERT with ' + extra.join(',');
    if (s.onConflictClause && s.onConflictClause.action !== 'ONCONFLICT_NOTHING') return 'ON CONFLICT DO UPDATE';
    var sel = s.selectStmt && s.selectStmt.SelectStmt;
    if (!sel || !sel.valuesLists || Object.keys(sel).some(function (k) { return ['valuesLists', 'limitOption', 'op'].indexOf(k) < 0; })) return 'INSERT not VALUES-only';
    return true;
  }
};
var ALTER_CMDS = { AT_AddColumn: 1, AT_AddConstraint: 1, AT_ValidateConstraint: 1, AT_SetNotNull: 1,
  AT_ColumnDefault: function (c) { return !!c.def || 'DROP DEFAULT'; } };
var NODES = ['RangeVar', 'ColumnDef', 'TypeName', 'String', 'Integer', 'Float', 'Boolean', 'BitString', 'A_Const', 'Constraint',
  'TypeCast', 'A_Expr', 'BoolExpr', 'NullTest', 'ColumnRef', 'IndexElem', 'List', 'ResTarget', 'CollateClause', 'A_ArrayExpr',
  'CoalesceExpr', 'SQLValueFunction', 'DefElem', 'FuncCall', 'AlterTableCmd', 'PartitionBoundSpec', 'PartitionSpec',
  'PartitionElem', 'TableLikeClause', 'ObjectWithArgs', 'CaseExpr', 'CaseWhen', 'MinMaxExpr', 'SetToDefault'];
var FUNCS = { now: 1, nextval: 1, lpad: 1, gen_random_uuid: 1, lower: 1, upper: 1, btrim: 1, length: 1, char_length: 1, jsonb_typeof: 1 };

function walk(n, out) {
  if (Array.isArray(n)) return n.forEach(function (x) { walk(x, out); });
  if (!n || typeof n !== 'object') return;
  if ('relname' in n && n.schemaname && n.schemaname !== 'public') out.push('relation outside public: ' + n.schemaname + '.' + n.relname);
  Object.keys(n).forEach(function (k) {
    var v = n[k];
    if (/^[A-Z]/.test(k)) {
      if (NODES.indexOf(k) < 0) return out.push('node ' + k);
      if (k === 'FuncCall') {
        var parts = v.funcname.map(function (p) { return p.String.sval; });
        var name = parts[parts.length - 1];
        if (!FUNCS[name] || (parts.length > 1 && parts[0] !== 'pg_catalog')) out.push('function ' + parts.join('.'));
      }
      if (k === 'AlterTableCmd') {
        var ok = ALTER_CMDS[v.subtype];
        ok = typeof ok === 'function' ? ok(v) : !!ok || v.subtype;
        if (ok !== true) out.push('ALTER TABLE ' + ok);
      }
    } else if (k === 'withClause' || k === 'returningList') out.push(k);
    walk(v, out);
  });
}

function checkStmt(stmt) {
  var type = Object.keys(stmt)[0], body = stmt[type], rule = STMTS[type];
  var ok = typeof rule === 'function' ? rule(body) : !!rule || 'statement ' + type;
  if (ok !== true) return [ok];
  var inner = [];
  walk(type === 'InsertStmt' ? [body.relation, body.cols, body.selectStmt.SelectStmt.valuesLists, body.onConflictClause] : body, inner);
  return inner.map(function (m) { return type + ': ' + m; });
}

function check(fileText) {
  var up = fileText.search(UP_RE);
  if (up < 0) return ['missing -- Up Migration marker'];
  var down = fileText.search(DOWN_RE);
  var sql = fileText.slice(up, down < up ? undefined : down);
  // A backslash is the only character whose lexing depends on server state (standard_conforming_strings).
  if (sql.indexOf('\\') >= 0) return ['backslash in Up section (lexing depends on standard_conforming_strings)'];
  var tree;
  try { tree = pg.parseSync(sql); } catch (e) { return ['parse error: ' + e.message]; }
  var errs = [];
  (tree.stmts || []).forEach(function (s, i) {
    checkStmt(s.stmt).forEach(function (m) { errs.push('#' + (i + 1) + ' ' + m); });
  });
  return errs;
}

module.exports = { check: check, checkStmt: checkStmt, ready: pg.loadModule };
```

Production version must-dos not in the prototype:
- Append `;` the way `pgm.sql` does.
- Map rejections to legacy rule names in CLI output.
- Make the CLI `await loadModule()`.
- Reuse and fix (IN-02) `findUnguardedFiles`.
- Add the parser-major-version assertion test.
- For InsertStmt, walk the whole body after the key check, rather than the hand-picked field list still visible in `checkStmt`. The key allowlist makes the subset safe today, but walking everything is the robust form.
