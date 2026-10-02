---
phase: 83-postgres-infrastructure
reviewed: 2026-10-02T19:47:27Z
depth: standard
review_type: re-review (gap closure 83-10 / 83-11 / 83-12, diff 8c90a03a..HEAD)
files_reviewed: 7
files_reviewed_list:
  - zoho-middleware/scripts/migration-guard.js
  - zoho-middleware/migrations-manual/README.md
  - zoho-middleware/scripts/backfill/normalize.js
  - zoho-middleware/scripts/backfill/read-xlsx.js
  - zoho-middleware/scripts/backfill/backfill.js
  - zoho-middleware/scripts/backfill/load.js
  - zoho-middleware/scripts/backfill/README.md
findings:
  critical: 4
  warning: 3
  info: 5
  total: 12
carried_forward_open: 16
status: issues_found
---

# Phase 83: Code Review Report (re-review after gap closure)

**Reviewed:** 2026-10-02T19:47:27Z
**Depth:** standard
**Files Reviewed:** 7
**Status:** issues_found

## Narrative Findings (AI reviewer)

## Summary

This review covers the gap-closure changes from plans 83-10 (migration guard), 83-11 (normaliser and xlsx reader) and 83-12 (header check, `read_vs_accepted`, promoting from an empty scratch table). For each prior finding I re-ran its exact inputs. I then attacked the new guard tokenizer directly.

Every "bypass" marked as verified below was run against a real `postgres:16-alpine` container. Each payload was sent as a single simple-protocol query, which is how node-pg-migrate's `pgm.sql(upSql)` sends it. In every case `findDestructiveStatements()` returned `[]`. I also checked node-pg-migrate 9.0.0 itself (`dist/legacy/sqlMigration.js`, `migration.js`, `migrationLoader.js`). The markers and slicing really are byte-identical. The default loader strategy really is `.sql` → legacySql and `.js/.ts/.cjs/.mjs/.cts/.mts` → jiti. Each Up section is sent as one query string.

**What 83-10/11/12 fixed:** all 12 bypass rows in the old CR-01 table are now rejected; IN-01 is accepted; non-SQL files fail closed; error, Date and boolean cells are now rejected; and missing headers or a run that accepts zero rows can no longer report PASS or promote.

**What is still wrong:** the migration guard can still be bypassed. I found four independent ways to do it that run without any guard violation and destroy data. All four are verified on real Postgres:
1. The tokenizer does not treat `$` as an identifier character, so it opens a fake dollar quote or a fake `E''` string.
2. Function and procedure bodies written as single-quoted strings are never scanned.
3. The 83-10 deviation: when the tokenizer hits an error inside a body, it swallows the error and drops the rest of the body.
4. Writing the column as `U&"…"` slips past `alter-type`.

## Status of prior findings

| Prior ID | Status | Evidence |
|---|---|---|
| **CR-01** (guard bypasses) | **RESOLVED as scoped. Superseded by new CR-01..CR-04.** | I re-ran all 12 rows of the prior table. Each one now returns its expected rule (`alter-type`, `update`, `delete`, `do-block`+`delete`, `do-block`+`execute`, `merge`, `upsert`, `sequence-reset`, `drop` ×3). The markers match node-pg-migrate's `createMigrationCommentRegex` and the `getActions` slicing exactly. However, the guard's goal (nothing destructive runs on deploy) is still **not met**: see the new Critical issues. |
| **CR-02** (non-`.sql` files) | **RESOLVED** | `findUnguardedFiles()` flags every non-dotfile, non-`.sql` entry, and the CLI combines it with `checkMigrationsDir`. This matches node-pg-migrate's `^\..*` ignore pattern and its case-insensitive extension check. There are small edge cases with directories; see IN-02. |
| **CR-03** (normaliser coercion) | **RESOLVED** | `normalizeText` rejects cell errors, Dates, booleans, other objects and non-finite numbers. `cellToPrimitive` handles `sharedFormula`, calls itself on `hyperlink.text`, and returns `{cellError}` instead of `null` for unknown shapes and for formulas with no cached value. Header cells that are not text now raise an error. One related gap remains: numbers in text columns are still converted to text silently (WR-03). |
| **CR-04** (empty/partial data passes) | **RESOLVED** | `checkHeaders` runs before normalising and exits with `EXIT.ERROR` on any missing spec header, before `pool.connect()`, so no client is leaked. `read_vs_accepted` fails when `read > 0 && accepted === 0`. `promote()` refuses an empty scratch table, and its rejection path releases the client. |
| **IN-01** (`ADD COLUMN type` false positive) | **RESOLVED** | `ALTER TABLE t ADD COLUMN type text;` now returns `[]`. A new, smaller false positive was introduced: a table named `type` (IN-01 below). |

**Carried forward, re-checked in files in scope and still open (not fixed by 83-10/11/12):**
- **WR-01**: the `Promise.all` calls over one client are still there: `load.js:378-382` (`runChecks`) and `load.js:474-481` (`dbStatus`).
- **WR-02**: `backfill.js:407-411` still never releases the client when `promptTypeDatabaseName`, `loadScratch` or `runChecks` fails. The comment there talks about guarding against a double release, but no release happens at all, so `pool.end()` hangs. There is still no detection of duplicate primary keys.
- **WR-03**: `backfill.js:91-96` still puts the raw connection string, including its password, into the error message.
- **WR-09**: the empty-target check in `promote()` still runs outside the transaction (`load.js:427-437`).
- **IN-03**: `--promote=false` still turns promote on (`backfill.js:107-110`).
- **IN-08**: `to_regclass` is still given an unquoted, concatenated name (`load.js:425`).

**Carried forward, not re-reviewed (files outside this scope):** WR-04, WR-05, WR-06, WR-07, WR-08 and IN-02, IN-04, IN-05, IN-06, IN-07 (in `lib/db.js`, `server.js`, `lib/dual-write-compare.js`, `lib/sheet-mirror.js`, `rejects.js`, `normalize.js` timestamp handling and the `load.js` collation compare).

**WR-10** (test gaps) is partly closed. Tests now exist for CR-01..CR-04. There is still no test for WR-02 (a CLI error path followed by `pool.end()`), and none for the new bypasses below.

## Critical Issues

### CR-01: Tokenizer desync — `$` is a Postgres identifier character, so a fake dollar quote or fake `E''` string hides a top-level `DROP TABLE`

**File:** `zoho-middleware/scripts/migration-guard.js:76-78` (`isIdentChar`), `:139` (E-string check), `:223-224` (dollar-quote check)
**Issue:** In Postgres, identifiers continue with `[A-Za-z0-9_$\200-\377]` (`scan.l` `ident_cont`), so `a$$t$` and `a$e` are each a single identifier. `isIdentChar` leaves out `$` and non-ASCII letters. As a result, a `$` that follows a `$` (or a non-ASCII letter) is treated as the start of a new token, which Postgres never does. I found two single-file exploits. In both, the guard returns `[]` and Postgres drops the table:

```sql
-- Up Migration
select 1 as a$$t$;          -- PG: identifier a$$t$.  Guard: opens dollar quote $t$
select 1 as b$$$;           -- PG: identifier b$$$.   Guard (inside "body"): opens $$, never closed -> error swallowed (CR-03)
drop table gift_cards;      -- PG: EXECUTES.          Guard: discarded with the rest of the "body"
-- $t$
```

```sql
-- Up Migration
CREATE DOMAIN a$e AS text;
select a$e'\';drop table gift_cards;--';   -- PG: type a$e + plain string '\'; DROP EXECUTES.
                                           -- Guard: prev char '$' is not an ident char -> reads e'...' as an E-string, \' escapes, DROP is "inside the literal"
```

The second exploit does not depend on CR-03 at all.

**Fix:** Tokenize identifiers as whole units, the way Postgres's lexer does. When `ch` is an identifier-start character, consume the whole identifier before checking for `E'`, `U&'`, `$tag$` or anything else:

```js
var IDENT_START_RE = /[A-Za-z_\u0080-\uFFFF]/;
var IDENT_CONT_RE  = /[A-Za-z0-9_$\u0080-\uFFFF]/;
// at top of loop, before the E'' branch:
if (IDENT_START_RE.test(ch) && !((ch === 'E' || ch === 'e') && next === "'") &&
    !((ch === 'U' || ch === 'u') && next === '&')) {
  var k = i + 1;
  while (k < n && IDENT_CONT_RE.test(sql[k])) k++;
  // E'..' is only an escape string when the identifier is exactly "E"
  cleaned += sql.slice(i, k); i = k; continue;
}
```

With this change, `isIdentChar(prev)` is no longer needed for the E-string and dollar-quote branches. Add both payloads above as regression cases in `__tests__/migration-guard-hardening.test.js`.

### CR-02: Function and procedure bodies written as single-quoted strings are never scanned — `CREATE FUNCTION … AS 'DELETE …'; SELECT f();` passes

**File:** `zoho-middleware/scripts/migration-guard.js:168-192` (plain string), `:138-166` (E-string), `:376-378` (only dollar bodies are recursed)
**Issue:** Only `$tag$` bodies go into `bodies[]` for the recursive scan. Postgres also accepts a function or procedure body as an ordinary `'…'` or `E'…'` literal. The tokenizer replaces those literals with `''`, so their contents are never checked. Both of these were verified on real Postgres (guard returns `[]`, data destroyed):

```sql
-- Up Migration
CREATE FUNCTION wipe() RETURNS void LANGUAGE sql AS 'DELETE FROM gift_cards';
SELECT wipe();                              -- gift_cards: 1 row -> 0 rows
```
```sql
-- Up Migration
CREATE PROCEDURE p() LANGUAGE sql AS 'TRUNCATE gift_cards';
CALL p();                                   -- gift_cards emptied
```

The comment in the header says recursion "catches a destructive statement hidden inside a `LANGUAGE sql` function body". That is only true for dollar-quoted bodies.
**Fix:** In any statement matching `/\bcreate\s+(?:or\s+replace\s+)?(?:function|procedure)\b/i`, push the decoded payload of every string literal into `bodies` as well as every dollar body. To do this, have the string and E-string branches record their raw payload alongside `cleaned`. Undo `''` doubling, and for E-strings undo `\'` and `\\`. Then check the payloads once the statement boundary is known. Alternatively, as a simpler policy that fails closed, reject `CREATE [OR REPLACE] FUNCTION|PROCEDURE` whose body is not dollar-quoted, and reject `CALL` outright.

### CR-03: 83-10 deviation — swallowing tokenizer errors inside a body means the rest of the body is never scanned

**File:** `zoho-middleware/scripts/migration-guard.js:58-66` (header rationale), `:333-347` (`scanBody`)
**Issue:** The deviation is justified on the grounds that "the outer scan already knows exactly where that body starts and ends". Knowing the body's **bounds** is not the problem. When `tokenize(body)` hits an unterminated construct, it sets `i = n` and **throws away everything after that point in the body**. Any statement after the error inside a code body is therefore never matched against `RULES`. The guard cannot tell a string-literal body (`$$it's$$`) from a code body (a function or DO body), so swallowing the error turns every tokenizer/Postgres disagreement inside a code body into a silent pass. A safe design would fail closed in that case.

Verified on real Postgres (guard returns `[]`, rows deleted):
```sql
-- Up Migration
CREATE FUNCTION wipe() RETURNS void LANGUAGE sql AS $f$ select 1 as b$$$; delete from gift_cards; $f$;
SELECT wipe();
```
This exploit, and the first payload in CR-01, both depend on this behaviour. Fixing CR-01 removes today's trigger, but the next tokenizer gap would become silent again. The `$$'$$` test case the deviation was built to satisfy can be met without swallowing errors.
**Fix:** When a body fails to tokenize, fall back to a conservative scan of the body's raw text instead of dropping it:
```js
function scanBody(body) {
  var tokenized = tokenize(body);
  var violations = [];
  if (tokenized.errors.length) {
    // Cannot parse the body reliably: rule-match the RAW text (literals not stripped).
    var raw = body.replace(/\s+/g, ' ');
    var rule = matchRule(raw);
    if (rule) violations.push({ statement: '(unparseable body) ' + raw.slice(0, 200), rule: rule });
    return violations;
  }
  /* existing statement + nested-body scan */
}
```
`$$'$$` and `$$it's$$` still produce no violation, because the raw text contains no destructive keyword. `b$$$; delete from gift_cards;` is flagged as `delete`.

### CR-04: `alter-type` misses a Unicode-escaped column identifier — `ALTER COLUMN U&"balance" TYPE integer` silently truncates money

**File:** `zoho-middleware/scripts/migration-guard.js:267`
**Issue:** `ALTER_TYPE_CLAUSE_RE` only accepts `"q"` or `[A-Za-z_]\w*` as the column token. The tokenizer turns `U&"balance"` into `U&"q"`, and that matches neither pattern. Verified on Postgres: `ALTER TABLE gift_cards ALTER COLUMN U&"balance" TYPE integer;` passes the guard and changes `balance` from `numeric` to `integer`, rounding away every cent. That is exactly the data loss D-04 exists to stop. Non-ASCII column names (`café`) slip through the same way.
**Fix:** Remove the `ALTER TABLE [IF EXISTS] [ONLY] <name> [*]` prefix first, then match any single non-space token as the column. This also fixes IN-01 below:
```js
function hasAlterType(stmt) {
  var m = /^\s*alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?\S+\s*\*?\s*([\s\S]*)$/i.exec(stmt);
  if (!m) return false;
  return /(?:^|,)\s*alter\s+(?:column\s+)?\S+\s+(?:set\s+data\s+)?type\b/i.test(m[1]);
}
```
Alternatively, have the tokenizer replace `U&"…"` (and its optional `UESCAPE '…'`) with `"q"`.

## Warnings

### WR-01: Changing the lexer setting `standard_conforming_strings` in one migration desyncs the guard for later migrations

**File:** `zoho-middleware/scripts/migration-guard.js:168-192`
**Issue:** The tokenizer assumes `standard_conforming_strings = on`, so a backslash inside a plain `'…'` string is an ordinary character. node-pg-migrate runs every migration in a single `up` on **one** client (`runner.js`), and a session-level `SET` made inside a migration's transaction stays in force after `COMMIT`. `ALTER DATABASE … SET` / `ALTER ROLE … SET` make the change permanent. Verified on Postgres. Each of these files passes the guard on its own:
```sql
-- 0002: Up Migration
SET standard_conforming_strings = off;
-- 0003: Up Migration
select '\'';
drop table gift_cards;        -- executed (with scs=off, '\'' is a closed one-char string)
-- '
```
The two must be separate files, because a SET inside the same query string does not affect how that string is lexed. This needs two files (or one existing DB/role setting), so it is a Warning rather than a Blocker. `ALTER DATABASE … SET standard_conforming_strings = off` would also change string handling for the live app, and the guard does not flag it.
**Fix:** Add a rule rejecting `/\b(standard_conforming_strings|backslash_quote|escape_string_warning)\b/i`, and reject `ALTER (DATABASE|ROLE|USER|SYSTEM) … SET|RESET` outright. A more defensive option: treat `\'` inside a plain string as ambiguous and fail closed.

### WR-02: The rules still miss destructive or redefining DDL that is not DML

**File:** `zoho-middleware/scripts/migration-guard.js:270-300`; `zoho-middleware/migrations-manual/README.md:28`
**Issue:** Each of these passes the guard (I probed every one). Each one makes existing data unreachable, or silently changes behaviour for existing rows or future writes:
- `ALTER TABLE gift_cards DETACH PARTITION gc_2026;` — the rows disappear from the parent table.
- `ALTER TABLE gift_cards SET SCHEMA archive;` — the table disappears from the app's `search_path`. This is a rename in all but name.
- `CREATE OR REPLACE FUNCTION existing_trigger_fn() … RETURN NULL …` — redefines an existing trigger, so every future insert is silently dropped. The same applies to `CREATE OR REPLACE VIEW|RULE|TRIGGER`.
- `CREATE RULE r AS ON INSERT TO gift_cards DO INSTEAD NOTHING;` — silently discards every future write.
- `ALTER TABLE … DISABLE TRIGGER …`, `CREATE POLICY … ; ALTER TABLE … ENABLE ROW LEVEL SECURITY` — existing rows become invisible to the app role.
- `SELECT dblink_exec('…', 'delete from gift_cards')` and `CALL some_existing_proc()` — dynamic SQL hidden inside string arguments.

The README (line 28) says a destructive change "is rejected before `node-pg-migrate` ever touches the database". That overstates what the guard does.
**Fix:** Add rules for `\bdetach\s+partition\b`, `\bset\s+schema\b`, `\bor\s+replace\b`, `\bcreate\s+rule\b`, `\b(disable|enable)\s+(trigger|rule|row\s+level\s+security)\b`, `\bcall\b`, and `\bdblink(_exec)?\s*\(`. Each of these sends the change to `migrations-manual/`. Reword README line 28 to describe the guard as a safety net with a list of known limits, not a guarantee.

### WR-03: `normalizeText` still converts numbers silently, so zero-padded IDs lose their padding (Trap 3)

**File:** `zoho-middleware/scripts/backfill/normalize.js:277-280`
**Issue:** Any finite number is accepted as `String(raw)`. VesselHistory's `vessel_id`, `shelf_id` and `bin_id` are `type: 'text'` columns. If an ID such as `007` or `01` was typed into a Sheets cell with automatic formatting, it is stored as the number `7` or `1` and loaded as `"7"`. That is exactly Trap 3, the leading-zero loss which D-12 says must be rejected, not converted. A formula result such as `0.1+0.2` becomes `"0.30000000000000004"`, and large values become `"1e+21"`. (The prior review's suggested fix allowed numbers. That was too loose for ID-like text columns.)
**Fix:** Let each spec column choose (`acceptNumber: true` only for columns where a number is legitimate). By default, reject numbers in `text` columns with `'expected text, got number'`. At minimum, reject non-integers and anything whose `String()` contains `e`.

## Info

### IN-01: `alter-type` wrongly flags a table named `type`
**File:** `zoho-middleware/scripts/migration-guard.js:267`
**Issue:** `ALTER TABLE type ADD COLUMN x int;` is reported as `alter-type`. The regex treats `table` as the column and the table name `type` as the TYPE keyword. This blocks a legitimate additive migration.
**Fix:** The CR-04 fix (removing the `ALTER TABLE <name>` prefix first) fixes this as well.

### IN-02: `findUnguardedFiles` flags directories, which node-pg-migrate ignores, and a directory ending in `.sql` crashes the guard
**File:** `zoho-middleware/scripts/migration-guard.js:388-397, 420-434`
**Issue:** node-pg-migrate only loads `dirent.isFile() || dirent.isSymbolicLink()`. The guard flags any directory, such as `migrations/archive/`, as `non-sql-file`. That is a harmless false positive. A directory named `x.sql` makes `readFileSync` throw `EISDIR`, which the CLI does not catch, so it prints a stack trace and exits 1. That still fails closed, but the output is confusing.
**Fix:** Use `readdirSync(dir, { withFileTypes: true })`, and filter both functions to `isFile() || isSymbolicLink()`, as node-pg-migrate does.

### IN-03: The header sets are plain objects, so `Object.prototype` names give wrong results
**File:** `zoho-middleware/scripts/backfill/backfill.js:150-166`; `zoho-middleware/scripts/backfill/read-xlsx.js:93-104` (unchanged in this diff, same pattern)
**Issue:** `sheetSet['constructor']` and `specSet['toString']` are truthy through the prototype. A spec header named `constructor` would never be reported missing, a sheet header named `toString` would never be reported unmapped, and `readSheet` would wrongly reject a `constructor` header as a duplicate. No current spec uses such names.
**Fix:** Use `Object.create(null)` or a `Set`.

### IN-04: `read_vs_accepted` only catches 100% loss
**File:** `zoho-middleware/scripts/backfill/load.js:358-365`
**Issue:** With 1 row accepted out of 1000 read, checks PASS. `--accept-rejects` then promotes the single row. This is by design (rejects are gated by a flag), but the operator only sees counts at step 3, and nothing says "99.9% rejected".
**Fix:** Optionally print the reject percentage, and require `--accept-rejects` to be confirmed again when more than N% of rows were rejected.

### IN-05: The migrations-manual README's closing summary contradicts its own rule list
**File:** `zoho-middleware/migrations-manual/README.md:30-32`
**Issue:** The closing summary says that "DO blocks, dynamic `EXECUTE`, and sequence resets" are rejected outright. It leaves out MERGE and upsert, which the guard's code comment (`migration-guard.js:252-259`) and the rule list above it both treat the same way.
**Fix:** Add MERGE and upsert to that sentence.

---

_Reviewed: 2026-10-02T19:47:27Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
