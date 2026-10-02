# Destructive (manual) migrations — D-04

`migrations/` is **additive only** (D-04). Every file in that directory runs automatically on
every deploy (staging and production) through `npm run migrate` (see `package.json` and the root
`railway.toml`'s `preDeployCommand`). That command runs TWO guards, in order, before
`node-pg-migrate up` ever touches the database:

1. `scripts/migration-guard.js` — a first-pass regex/tokenizer denylist kept from 83-03/83-10.
2. `scripts/migration-allowlist.js` — the **authoritative** guard: a fail-closed allowlist built
   on the real Postgres 16 grammar (`libpg-query@16.7.3`, the same C parser Postgres itself uses,
   compiled to WASM). Anything this module does not explicitly name — a statement type, an ALTER
   TABLE subcommand, an expression/function node, or a parse error — is rejected.

Both guards also run in `npm test` (`__tests__/migration-guard*.test.js`,
`__tests__/migration-allowlist.test.js`, `__tests__/migration-allowlist-wiring.test.js`) and via
`npm run migrate:guard` (the same chain, without `node-pg-migrate up`), so the PR-time check and
the deploy-time check are the same code.

## What the allowlist accepts

The allowlist (`scripts/migration-allowlist.js`) only looks at the file's `-- Up Migration`
section — located exactly the way `node-pg-migrate` itself locates it (same marker regex, same
"Down marker before Up marker means Up runs to EOF" rule as `migration-guard.js`). Within that
section, it accepts only:

- **Statement types:** `CREATE TABLE`, `CREATE INDEX`, `CREATE SEQUENCE`, `COMMENT`,
  `CREATE TYPE ... AS ENUM`, `ALTER TYPE ... ADD VALUE` (not `RENAME VALUE`), and
  `INSERT ... VALUES` with an optional `ON CONFLICT DO NOTHING` (no `RETURNING`, no `WITH`, no
  `INSERT ... SELECT`, no sub-selects in a value).
- **ALTER TABLE subcommands:** `ADD COLUMN`, `ADD CONSTRAINT`, `VALIDATE CONSTRAINT`,
  `SET DEFAULT` (not `DROP DEFAULT`), `SET NOT NULL` (not `DROP NOT NULL`). Every other ALTER
  TABLE subcommand (`ALTER COLUMN ... TYPE`, `DETACH PARTITION`, `RENAME ...`, `ENABLE`/
  `DISABLE TRIGGER`, row-level security, etc.) is rejected, and so is `ALTER` on any object that
  is not a plain table (index, sequence, etc.).
- **Functions:** only `now`, `nextval`, `lpad`, `gen_random_uuid`, `lower`, `upper`, `btrim`,
  `length`, `char_length`, `jsonb_typeof` — unqualified or `pg_catalog`-qualified. Any other
  function name, or any qualifier other than `pg_catalog`, is rejected (this includes a
  schema-qualified call to an otherwise-allowed name, e.g. `public.now()`).
- **Schemas:** every relation must be unqualified or explicitly `public`. Any other schema
  (including one shadowing a system schema name) is rejected.

## Rejected outright, use this directory instead

Everything else is rejected, including but not limited to: `DROP`, `TRUNCATE`, `DELETE`,
`UPDATE`, `MERGE`, upsert (`ON CONFLICT ... DO UPDATE`), `RENAME` (table, column, or enum value),
`ALTER ... TYPE` / `SET DATA TYPE`, `SET SCHEMA`, `DETACH PARTITION`, `DROP DEFAULT`,
`DROP NOT NULL`, sequence resets (`RESTART`, `setval(...)`), `DO` blocks, `CALL`, dynamic
`EXECUTE`, any `SELECT` (including one hidden inside a CTE or an `INSERT ... SELECT`), `COPY`,
`LOCK`, `CREATE [OR REPLACE] FUNCTION` / `PROCEDURE` / `TRIGGER` / `RULE` / `VIEW` / `POLICY`,
`ENABLE`/`DISABLE TRIGGER` or row-level security, `CREATE SCHEMA` / `EXTENSION` / `DOMAIN`,
`GRANT`/`REVOKE`, `SET`/`RESET` (including `ALTER DATABASE ... SET`), `ALTER DATABASE` /
`ROLE` / `SYSTEM`, `BEGIN`/`COMMIT`, and `CREATE TABLE AS`.

A few of these are deliberate, no-exception policy choices, not just gaps in the allowlist:

- **Functions and triggers always go through this directory.** `CREATE FUNCTION`,
  `CREATE PROCEDURE`, `CREATE TRIGGER`, `DO`, and `CALL` are always rejected — there is no
  hash-allowlist or other exception mechanism (owner decision 2, 83-GUARD-RESEARCH.md). Even an
  innocuous-looking `updated_at` trigger has to be applied here.
- **Any backslash anywhere in the Up section is rejected** (owner decision 3), before the text is
  even parsed. Backslash lexing inside a string literal depends on the target database's
  `standard_conforming_strings` setting, which this guard has no way to observe, so the only safe
  move is to ban the character outright. Write regex character classes as `[0-9]` instead of
  `\d`; `E'...'` escape strings are unnecessary for additive DDL. If you genuinely need a
  backslash, run the migration here instead.
- **Any NUL byte in the Up section is rejected before parsing** — the parser stops at NUL, so
  anything after it would be invisible to the guard.
- **A parse error rejects the whole file.** The allowlist never tries to recover or skip a
  statement it cannot parse.
- **A non-`.sql` file in `migrations/` rejects the deploy.** `node-pg-migrate` will happily load a
  `.js`/`.cjs`/`.mjs`/`.ts` migration file and run arbitrary `pgm.*` calls with no guard at all —
  both guards treat any non-dotfile, non-`.sql` entry in the directory as its own violation.

## Rule names

Both scripts print one `file: rule: statement` line per violation to stderr. `migration-guard.js`
(the first pass) uses its own older rule names (`drop`, `truncate`, `rename`, `alter-type`,
`delete`, `update`, `merge`, `upsert`, `sequence-reset`, `do-block`, `execute`,
`unterminated-token`, `non-sql-file`) and runs first. `migration-allowlist.js` (the authoritative
guard) uses:

| Rule | Meaning |
|---|---|
| `missing-up-marker` | no `-- Up Migration` marker found in the file at all |
| `backslash` | a backslash was found anywhere in the raw Up section |
| `nul-byte` | a NUL (`\0`) byte was found anywhere in the raw Up section |
| `parse-error` | the Up section did not parse as valid SQL under the real PG16 grammar |
| `statement-not-allowed` | the statement's top-level type is not on the allowlist |
| `alter-not-allowed` | the `ALTER TABLE` subcommand, or the object type being altered, is not allowed |
| `enum-rename` | `ALTER TYPE ... RENAME VALUE` (only `ADD VALUE` is allowed) |
| `insert-shape` | the `INSERT` has a shape other than plain `VALUES` (+ optional `ON CONFLICT DO NOTHING`) — e.g. `RETURNING`, a `WITH` CTE, or `INSERT ... SELECT` |
| `node-not-allowed` | an expression or auxiliary AST node type inside an otherwise-allowed statement is not recognised |
| `function-not-allowed` | the function being called, or its schema qualifier, is not on the allowlist |
| `schema-not-public` | a relation is qualified with a schema other than `public` |
| `unreadable-file` | the file could not be read from disk |
| `non-sql-file` | a non-dotfile entry in the directory is not a `.sql` file |

## Known limits (this is a safety net, not a guarantee)

The allowlist closes the bypass classes found in `83-GUARD-RESEARCH.md` and `83-REVIEW.md`
(parser-differential tricks, functions/triggers hiding destructive bodies, schema shadowing), but
it does not make every migration in `migrations/` consequence-free:

- **Allowed DDL can still change future application behaviour.** A new `SET DEFAULT`,
  `SET NOT NULL`, or `CHECK` constraint can make an existing app write start failing; a foreign
  key with `ON DELETE CASCADE` widens what a future delete touches, even though adding the FK
  itself is additive.
- **Existing triggers and rules created through this directory still fire** on an allowlisted
  `INSERT` — the allowlist only judges the statement actually present in `migrations/`, not every
  side effect the database might run in response to it.
- **The parser's major version must track Railway's Postgres major version.** `libpg-query@16.7.3`
  understands PG16 grammar, but Railway already runs **PostgreSQL 18.x** (checked 2026-10-02).
  PG17/18-only syntax therefore fails to parse and is rejected (fails closed) until this package
  is bumped to the `pg18` dist-tag. The real-Postgres test harness runs `postgres:18-alpine`.
- **Backups are the only control that covers everything, including this manual path.** Neither
  guard — nor this directory's own manual procedure below — is a substitute for a tested restore.

## Widening the allowlist

Adding a new statement type, ALTER TABLE subcommand, or function to `scripts/migration-allowlist.js`
is a code change, reviewed by the owner, and it must come with BOTH a new reject case and a new
accept case in `__tests__/fixtures/migration-allowlist-cases.js` (not just one or the other).
Never add user-defined functions, `SET`, or `CREATE SCHEMA` to the allowlist — 83-GUARD-RESEARCH.md
found concrete ways each of those can smuggle destructive behaviour past a statement-level check.

## Procedure

1. **Take a backup first, and record it.** Railway backups/PITR are not available on this
   workspace's current (Hobby) plan (see `docs/RUNBOOK.md` § Railway Postgres — Backups). Until
   that changes, take a manual `pg_dump` of the target environment's database before running
   anything here, and note where the dump is stored (outside the repo — it may contain customer
   PII, per D-13).

2. **Run against STAGING first.** Confirm the result (row counts, spot-check affected rows) before
   touching production. Staging and production are separate Railway Postgres databases (Plan
   83-01) — a staging-only mistake never reaches production data.

3. **Run by hand, with the owner present.** Either:
   - `railway connect` (or `psql` directly, via the environment's `DATABASE_URL`) and run the SQL
     by hand, or
   - `node-pg-migrate up -m migrations-manual --migrations-table pgmigrations_manual` — note the
     **explicit `-m` directory** (never the default `migrations/`) **and** a **separate tracking
     table** (`pgmigrations_manual`, never the deploy's `pgmigrations`). Recording a manual file in
     the deploy's own tracking table would make the next real deploy's order check fail on a
     migration it has never seen in `migrations/` and cannot resolve.

   Never invoke anything in this directory from `railway.toml`'s `preDeployCommand` or any other
   automated deploy path — it is not wired into `npm run migrate` and must stay that way.

4. **Record it.** Add an entry to `docs/RUNBOOK.md` Deploy History: what ran, when, against which
   environment, who was present, and the backup reference from step 1.

## Why not just edit a file in `migrations/`?

`node-pg-migrate` migrations are meant to be applied exactly once and never edited afterward.
Editing an already-applied file doesn't get re-run — the next environment to deploy would simply
apply it as normal, silently diverging from whatever was hand-run here. Destructive work needs a
human in the loop for every environment it touches, not a deploy pipeline that runs once, applies
cleanly, and moves on.
