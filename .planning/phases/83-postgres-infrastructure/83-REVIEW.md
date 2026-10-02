---
phase: 83-postgres-infrastructure
reviewed: 2026-10-02T21:35:00Z
depth: deep
review_type: re-review (gap closure 83-13 / 83-14, diff a791be59..HEAD)
files_reviewed: 6
files_reviewed_list:
  - zoho-middleware/scripts/migration-allowlist.js
  - zoho-middleware/package.json
  - railway.toml
  - zoho-middleware/migrations-manual/README.md
  - zoho-middleware/__tests__/migration-allowlist-wiring.test.js
  - zoho-middleware/__tests__/db/migration-allowlist-apply.test.js
findings:
  critical: 0
  warning: 1
  info: 3
  total: 4
carried_forward_open: 16
status: issues_found
---

# Phase 83: Code Review Report (re-review after gap closure 83-13 / 83-14)

**Reviewed:** 2026-10-02T21:35:00Z
**Depth:** deep
**Files Reviewed:** 6
**Status:** issues_found

## Narrative Findings (AI reviewer)

## Summary

This review re-examines the migration safety chain after 83-13 (the new
`scripts/migration-allowlist.js`, a fail-closed allowlist over libpg-query's
real PG16 AST) and 83-14 (wiring it into `npm run migrate` after the old
regex guard, plus the real-Postgres apply test). The prior review had found
four Critical tokenizer bypasses (CR-01..CR-04) and two Warnings (WR-01 scs
desync, WR-02 destructive-DDL gap) in the old hand-written guard. The owner's
answer was not to patch the tokenizer but to **add a second, authoritative,
parser-backed allowlist** and keep the old regex guard as a first pass.

I attacked the new allowlist hard, trying to find a single file that passes
**both** `migration-guard.js` and `migration-allowlist.js` yet destroys or
rewrites existing data or alters an existing column's type. I ran candidates
through both guards' module APIs and the full 118-case fixture corpus (0
mismatches), ran the allowlist unit + wiring suites (158 tests pass), and
stood up a real `postgres:16-alpine` container to verify the one parser
differential I found (NUL truncation) end-to-end through node-postgres /
node-pg-migrate. The container was stopped and removed after the probe.

**Result: I could not find a data-destroying bypass.** The allowlist is
genuinely fail-closed. Every attack class the prior review and
83-GUARD-RESEARCH.md identified now rejects, because the allowlist judges the
**statement/node/function type from the real AST** rather than scanning text:

- Fake dollar-quote / fake `E''` (CR-01): the payloads parse as real
  statements; the hidden `DROP`/etc. is a `DropStmt`/`SelectStmt` →
  `statement-not-allowed`. The `E''`/backslash variant also hits the
  backslash pre-parse gate.
- Function/procedure bodies as string literals (CR-02) and swallowed body
  tokenizer errors (CR-03): `CreateFunctionStmt`/`CreateFunctionStmt` +
  `CallStmt` are rejected wholesale (owner decision 2). There is no body
  scanning to desync.
- `U&"balance" TYPE integer` and non-ASCII column names (CR-04): the AST
  subcommand is `AT_AlterColumnType`, which is not in `ALTER_CMDS`, regardless
  of how the identifier is spelled → `alter-not-allowed`.
- `standard_conforming_strings` / backslash lexing (WR-01): any backslash in
  the Up section is rejected pre-parse, and `VariableSetStmt` /
  `AlterDatabaseSetStmt` are `statement-not-allowed`.
- Destructive-but-not-DML DDL (WR-02): `DETACH PARTITION`, `SET SCHEMA`,
  `CREATE OR REPLACE FUNCTION/VIEW`, `CREATE RULE`, `DISABLE/ENABLE TRIGGER`,
  RLS, `CREATE POLICY`, `dblink_exec(...)`, `CALL` all reject.

Additive-but-tricky inputs I tried that (correctly) stay accepted and are not
destructive: `CREATE TABLE … (LIKE …)`, `… PARTITION OF`, `… INHERITS`,
`ADD CONSTRAINT … USING INDEX`, `SET NOT NULL`, `ADD COLUMN … DEFAULT now()`
and `ADD COLUMN serial`. Clever evasions that reject: `INSERT … SELECT`,
`INSERT … VALUES ((SELECT …))`, CTE-wrapped INSERT, `ON CONFLICT DO UPDATE`,
`ALTER TYPE … RENAME VALUE`, a disallowed function nested inside an allowed
one (`lower(wipe())`), and a schema-qualified allowlisted name (`public.now()`).

**What is still worth fixing:** one robustness Warning (a NUL byte silently
truncates the allowlist's parse, so its own fail-closed guarantee has a hole —
non-exploitable today only because node-postgres refuses NUL queries), plus
three Info items (lint scope, an operator/cast defense-in-depth asymmetry, and
a conservative `DEFAULT VALUES` false-reject). The prior guard criticals and
warnings are **RESOLVED**. All non-guard findings from the prior review
(backfill client release, numeric→text IDs, etc.) are carried forward
unchanged — those files are outside this diff.

## Status of prior findings (both guards taken together)

| Prior ID | Status | Evidence |
|---|---|---|
| **CR-01** (`$`/`E''` tokenizer desync hides a top-level DROP) | **RESOLVED** | Fixture `CR-01a` (`a$$t$` fake dollar quote) and `CR-01b` (`a$e'…'` fake E-string) both reject under the allowlist. The real AST exposes the hidden `drop table gift_cards` as a `DropStmt` → `statement-not-allowed`; `CR-01b` additionally trips the backslash gate. Verified via the corpus run (0 mismatches). |
| **CR-02** (fn/proc body as `'…'` string, then `SELECT`/`CALL`) | **RESOLVED** | `CreateFunctionStmt` and `CallStmt` are not in `STMTS` → rejected outright (owner decision 2). Fixtures `CR-02a`/`CR-02b` reject. There is no body-string scan left to bypass. |
| **CR-03** (swallowed tokenizer error drops the rest of a body) | **RESOLVED / moot** | The allowlist never tokenizes bodies; `CREATE FUNCTION` is rejected whole. Fixture `CR-03` rejects. |
| **CR-04** (`U&"balance" TYPE integer` / non-ASCII column slips past `alter-type`) | **RESOLVED** | Column-type change is `AT_AlterColumnType` in the AST, absent from `ALTER_CMDS` → `alter-not-allowed`, independent of identifier spelling. Fixture `CR-04` and the `café` case reject. |
| **WR-01** (changing `standard_conforming_strings` desyncs string lexing) | **RESOLVED** | Backslash pre-parse gate (owner decision 3) rejects any `\` in the Up section; `SET …` (`VariableSetStmt`) and `ALTER DATABASE … SET` (`AlterDatabaseSetStmt`) are `statement-not-allowed`. Fixtures `WR-01-scs-set`, `WR-01-backslash`, `ALTER DATABASE … SET scs off` all reject. |
| **WR-02** (destructive/redefining DDL that is not DML) | **RESOLVED** | Every item the prior review listed rejects: `DETACH PARTITION`/`DISABLE TRIGGER`/RLS → `alter-not-allowed`; `SET SCHEMA`/`CREATE OR REPLACE FUNCTION`/`VIEW`/`RULE`/`POLICY`/`CALL`/`dblink_exec` (a `SelectStmt`) → `statement-not-allowed`. All present in the fixture corpus and rejecting. |

Prior Info items on the **old guard** (IN-01 `alter-type` false-positive on a
table named `type`; IN-02 directories / `x.sql` dirent handling) are not
re-adjudicated: the old guard is unchanged by owner decision 1 / CLAUDE.md
rule 10. The **allowlist** does not reproduce either bug — it keys off the AST
subcommand (no `type`-name confusion) and uses `withFileTypes` dirents
(directories, including one named `x.sql`, are ignored, matching
node-pg-migrate).

## Carried forward, NOT re-reviewed (outside this diff; still open)

Unchanged from the prior review — these live in files not touched by 83-13/14
(`scripts/backfill/*.js`, `scripts/backfill/load.js`, `lib/db.js`, `server.js`,
`lib/dual-write-compare.js`, `lib/sheet-mirror.js`, `rejects.js`):

- **WR-01 (backfill):** `Promise.all` over one shared client — `load.js:378-382`
  (`runChecks`), `load.js:474-481` (`dbStatus`).
- **WR-02 (backfill):** `backfill.js:407-411` never releases the client when
  `promptTypeDatabaseName` / `loadScratch` / `runChecks` fails, so `pool.end()`
  hangs; no duplicate-primary-key detection.
- **WR-03 (backfill):** `backfill.js:91-96` puts the raw connection string
  (including password) into the error message.
- **WR-03 (normaliser, numeric→text IDs):** `normalize.js:277-280` still coerces
  finite numbers to `String(raw)`, so zero-padded text IDs (`007`) lose padding
  (Trap 3, D-12). Any new text-column backfill remains exposed.
- **WR-09 (backfill):** empty-target check in `promote()` runs outside the
  transaction (`load.js:427-437`).
- **IN-03 (backfill):** `--promote=false` still enables promote (`backfill.js:107-110`).
- **IN-08 (backfill):** `to_regclass` given an unquoted, concatenated name
  (`load.js:425`).
- Plus the remaining prior carried-forward set (WR-04..WR-08, IN-02, IN-04..IN-07)
  in `lib/*`, `server.js`, `rejects.js`, and the `load.js` collation compare.

## Warnings

### WR-01: A NUL byte silently truncates the allowlist's parse — its own fail-closed guarantee has a hole (non-exploitable today, but only by luck)

**File:** `zoho-middleware/scripts/migration-allowlist.js:297-320` (pre-parse gate + `pg.parseSync`)
**Issue:** `libpg-query` compiles the libpg_query C parser to WASM, and the C
parser treats the input as a NUL-terminated string. Everything after the
**first `\0`** in the Up section is never parsed. The allowlist's only
pre-parse gate is the backslash check; it does not reject NUL. So a file like:

```
-- Up Migration
CREATE TABLE ok (a int);<NUL>CREATE OR REPLACE FUNCTION existing_trigger_fn() RETURNS trigger LANGUAGE plpgsql AS '...';
```

parses as a single `CreateStmt` and the allowlist returns `[]` (accept) — the
`CREATE OR REPLACE FUNCTION` after the NUL is invisible to it. I confirmed the
truncation directly: `pg.parseSync('CREATE TABLE ok (a int);\0DROP TABLE gift_cards;')`
returns only `CreateStmt`, and `checkSql()` on the NUL file returns `[]`.

This directly contradicts the module's own stated contract ("Fail-closed by
construction", "A parse error is a violation") and the README's "A parse error
rejects the whole file" — a NUL is not a parse error, it is a silent cut.

I verified on a real `postgres:16-alpine` container that this does **not**
cause data loss **through the current pipeline**: replicating node-pg-migrate's
`getActions` → `pgm.sql` and running the resulting Up string through
node-postgres, the driver rejects the query with `invalid message format`
(the PG wire protocol's Query message is itself NUL-terminated), so the whole
migration errors and the deploy aborts; `gift_cards` and its row survived.
The old regex guard also scans the full JS string (past the NUL) and would
flag a `DROP`/`DELETE`/etc. So today the NUL case is contained by two
incidental backstops — **neither of which is the allowlist's own doing**, and
the allowlist is explicitly the *authoritative* guard (README). A future
driver swap, a `psql \i`/`COPY`-based runner, or a post-NUL payload the old
regex guard does not recognise (exactly the class the allowlist exists to
catch) would turn this into a real bypass.
**Fix:** Mirror the backslash gate — reject NUL (and ideally validate the
bytes are UTF-8) before parsing:
```js
if (upSection.indexOf('\0') >= 0) {
  return [{ statement: 'a NUL byte was found in the Up section — the parser '
    + 'truncates at NUL, so anything after it would be unscanned', rule: 'nul-byte' }];
}
```
Add a reject fixture (`CREATE TABLE ok (a int);\0DROP TABLE gift_cards;`) to
`__tests__/fixtures/migration-allowlist-cases.js`.

## Info

### IN-01: `npm run lint` does not cover `scripts/`, so neither migration guard is linted
**File:** `zoho-middleware/package.json:11`
**Issue:** `"lint": "eslint routes/ lib/ server.js --max-warnings 0"`. The new
`scripts/migration-allowlist.js` (and `scripts/migration-guard.js`) live under
`scripts/`, which is not in the lint target list, so the pre-commit lint gate
(CLAUDE.md "Run `npm run lint` before committing") never checks the very code
that gates every production deploy. A lint error or an unused var here ships
unflagged.
**Fix:** Add `scripts/` to the lint target: `eslint routes/ lib/ scripts/ server.js --max-warnings 0` (and confirm the existing scripts pass, or scope to `scripts/migration-*.js` if the other scripts are intentionally excluded).

### IN-02: `A_Expr` operators and `TypeCast` cast functions are not name-checked the way `FuncCall` is (defense-in-depth asymmetry; not exploitable in the current threat model)
**File:** `zoho-middleware/scripts/migration-allowlist.js:128-144, 194-203`
**Issue:** The walk checks `FuncCall` names against `FUNCS`, but `A_Expr`
(operators, e.g. `'a' OPERATOR(pg_catalog.||) 'b'`) and `TypeCast` (which can
invoke a cast function) are allowed node types whose underlying
function/operator name is never checked. Likewise, unqualified `FuncCall`
names are matched by last-name-part only, so an unqualified `lower(...)` is
accepted regardless of which `lower` overload `search_path` resolves to. This
is **not** a reachable bypass: installing a destructive operator
(`CREATE OPERATOR`/`DefineStmt`), cast (`CreateCastStmt`), or shadowing
function (`CreateFunctionStmt`) all require statements the allowlist rejects,
so the malicious callable can only pre-exist via the manual
`migrations-manual/` path or direct DB access — the same accepted residual as
owner decision 2's "a pre-existing trigger fired by an allowed INSERT". Worth
recording so a future allowlist widening (e.g. admitting more node types)
doesn't quietly open it.
**Fix:** None required now; if `A_Expr`/`TypeCast` coverage is ever tightened,
name-check the operator (`A_Expr.name`) and cast target the same way `FuncCall`
is checked. Otherwise, note the residual next to owner decision 2 in the module
header / README "Known limits".

### IN-03: `INSERT … DEFAULT VALUES` is rejected as `insert-shape` (conservative false-reject)
**File:** `zoho-middleware/scripts/migration-allowlist.js:99-100`
**Issue:** `InsertStmt` requires `body.selectStmt.SelectStmt.valuesLists`;
`INSERT INTO app_meta DEFAULT VALUES` has no `selectStmt`, so it rejects with
`insert-shape` even though it is purely additive (inserts one all-defaults
row). This is a safe, fail-closed direction, not a bug — but it will route a
legitimate additive seed to `migrations-manual/` with a confusing rule name.
**Fix:** Optional. If `DEFAULT VALUES` seeds are wanted, allow the case where
`body.selectStmt` is absent entirely (no `onConflictClause` issue), or document
it as a deliberate non-support in the README's accept list.

---

_Reviewed: 2026-10-02T21:35:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
