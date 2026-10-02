---
phase: 83-postgres-infrastructure
reviewed: 2026-10-02T00:00:00Z
depth: standard
files_reviewed: 25
files_reviewed_list:
  - zoho-middleware/lib/db.js
  - zoho-middleware/lib/store-flag.js
  - zoho-middleware/lib/sheet-mirror.js
  - zoho-middleware/lib/dual-write-compare.js
  - zoho-middleware/lib/validateEnv.js
  - zoho-middleware/server.js
  - zoho-middleware/migrations/0001_init.sql
  - zoho-middleware/scripts/migration-guard.js
  - zoho-middleware/scripts/backfill/backfill.js
  - zoho-middleware/scripts/backfill/load.js
  - zoho-middleware/scripts/backfill/normalize.js
  - zoho-middleware/scripts/backfill/read-xlsx.js
  - zoho-middleware/scripts/backfill/rejects.js
  - zoho-middleware/scripts/backfill/specs/index.js
  - zoho-middleware/scripts/backfill/specs/vessel-history.js
  - zoho-middleware/scripts/backfill/specs/plato-readings.js
  - zoho-middleware/scripts/backfill/specs/ferm-schedules.js
  - zoho-middleware/__tests__/db/helpers/pg-harness.js
  - zoho-middleware/jest.config.js
  - zoho-middleware/jest.db.config.js
  - zoho-middleware/package.json
  - railway.toml
  - .github/workflows/tests.yml
  - .github/workflows/gated-deploy.yml
  - .gitignore
findings:
  critical: 4
  warning: 10
  info: 8
  total: 22
status: issues_found
---

# Phase 83: Code Review Report

**Reviewed:** 2026-10-02
**Depth:** standard
**Files Reviewed:** 25
**Status:** issues_found

## Narrative Findings (AI reviewer)

## Summary

I reviewed the Postgres connection layer, the store flag, the Sheet-mirror gate, the dual-write comparator, the additive-only migration guard, the Railway pre-deploy wiring, and the whole backfill pipeline (read, normalise, rejects, load, checks, promote). I checked the behaviour claims against the installed `pg@8.23.1`, `pg-pool@3.14.0`, `pg-connection-string@2.14.1` and `node-pg-migrate@9.0.0` sources. I also ran small probes of the guard and the normaliser.

Things that hold up:
- **Identifier handling in load.js.** Every identifier goes through `escapeIdentifier`, and `assertScratchSchema` is anchored.
- **The production-only mirror gate.** It uses a strict `===` on `NODE_ENV` and on `RAILWAY_ENVIRONMENT_NAME`, and RUNBOOK records `staging` and `production`.
- **pg-harness.js** is clean.

The main problems:
1. **The migration guard can be bypassed in many ways.** I confirmed 13 common destructive patterns that pass it. It also does not scan non-`.sql` files at all, but `node-pg-migrate` runs every file in `migrations/`.
2. **The backfill normaliser quietly changes bad cells, against D-12.** It does not reject them.
3. **Backfill checks pass on empty or partly missing data.** This was already known, and it is wider than reported.
4. **The source of the pg deprecation warning is `load.js`, not pg-harness.** `runChecks`/`runColumnChecks` and `dbStatus` run `Promise.all` over a single checked-out client.

## Critical Issues

### CR-01: Migration guard misses common destructive statements and has parse bypasses

**File:** `zoho-middleware/scripts/migration-guard.js:31-45, 52-58, 68-74`
**Issue:** The guard is the only automated protection behind D-04 on the production pre-deploy. I ran `findDestructiveStatements` on each of the inputs below, and every one returned `[]` (no violation found):

| Input (Up section) | Why it is missed |
|---|---|
| `ALTER TABLE gift_cards ALTER balance TYPE integer;` | The `COLUMN` keyword is optional in Postgres, but `alter-type` requires it |
| `ALTER TABLE t ALTER c SET DATA TYPE int;` | Same reason |
| `UPDATE gift_cards AS g SET balance = 0;` / `UPDATE ONLY gift_cards SET ...` | `^\s*update\s+\S+\s+set` allows exactly one token before `SET` |
| `WITH d AS (DELETE FROM gift_cards RETURNING 1) SELECT ...` | The `delete`/`update` rules are anchored to the start of the statement |
| `DO $$ BEGIN DELETE FROM gift_cards; END $$;` | Same anchor problem: after splitting on `;` the statement starts with `DO` |
| `DO $$ BEGIN EXECUTE 'truncate gift_cards'; END $$;` | Single-quoted literals are blanked out before matching |
| `MERGE INTO ... WHEN MATCHED THEN DELETE` | No rule for it |
| `INSERT ... ON CONFLICT (code) DO UPDATE SET balance = 0` | No rule; it overwrites existing rows |
| `ALTER SEQUENCE gift_cards_id_seq RESTART WITH 1` | No rule; it causes future primary-key collisions |
| `insert into app_meta values ('a--b','x'); drop table gift_cards;` | Line comments are stripped **before** literals, so the `--` inside the string removes the rest of the line, including the `DROP` |
| `insert ... (E'it\'s','v'); drop table gift_cards; insert ... ('k','v');` | `E''` backslash escapes are not handled; the quotes pair up wrongly and the `DROP` is treated as part of a literal |
| `create table x (a int); -- down migration notes` then `drop table gift_cards;` | `DOWN_MARKER_RE` is not anchored to the start of a line, so the guard stops scanning here. node-pg-migrate's marker regex is `^\s*--[\s-]*down\s+migration` (multiline), so node-pg-migrate keeps executing the `DROP` |

**Fix:**
- Make the marker regexes match node-pg-migrate's exactly: `/^\s*--[\s-]*up\s+migration/im` and the same for `down`.
- Strip comments and literals in a single left-to-right tokenizer that understands `'...'`, `E'...'`, `$tag$...$tag$` and `--`/`/* */`. Do not use chained regexes.
- Make the DML rules unanchored, for example `/\bdelete\s+from\b/i`, `/\bupdate\b[\s\S]*?\bset\b/i`, `/\bmerge\s+into\b/i`, `/\bon\s+conflict\b[\s\S]*\bdo\s+update\b/i`, `/\brestart\b/i`.
- Change `alter-type` to `/\balter\b[\s\S]*?\b(type|set\s+data\s+type)\b/i`, scoped to `ALTER TABLE`.
- Reject any `DO` or `EXECUTE` block outright. The guard cannot reason about dynamic SQL, so these should go through `migrations-manual/` instead.

Add each row of the table above as a regression case in `__tests__/migration-guard.test.js`.

### CR-02: Guard scans only `.sql` files, but node-pg-migrate executes every file in `migrations/`

**File:** `zoho-middleware/scripts/migration-guard.js:114-117, 142`
**Issue:** `checkMigrationsDir` filters to `/\.sql$/i`. In node-pg-migrate 9.0.0, `getMigrationFilePaths` returns every non-dotfile in the directory (the default ignore pattern is `^\..*`). `.js`, `.cjs`, `.mjs` and `.ts` files are loaded through jiti. So `migrations/0002_x.js` containing `pgm.dropTable('gift_cards')` passes the guard (`0 file(s)` scanned) and then runs on deploy. Any stray non-SQL file, such as a README, would make `node-pg-migrate up` fail on the pre-deploy step.
**Fix:** Fail closed. Treat any non-dotfile in `migrations/` that does not end in `.sql` as a violation:
```js
var all = fs.readdirSync(dir).filter(function (f) { return !/^\./.test(f); });
all.forEach(function (f) {
  if (!/\.sql$/i.test(f)) violations.push({ file: f, statement: '(non-SQL migration file)', rule: 'non-sql-file' });
});
```

### CR-03: Normaliser turns error and typed cells into plausible-looking text instead of rejecting them (D-12)

**File:** `zoho-middleware/scripts/backfill/normalize.js:269-272`; `zoho-middleware/scripts/backfill/read-xlsx.js:28-36`
**Issue:** `normalizeText` returns `String(raw)` for any value that is not a string. I confirmed this by running `normalizeRow` on the VesselHistory spec:
- `notes: { cellError: '#REF!' }` is accepted as `note: "[object Object]"`.
- `vessel_id: <exceljs Date 2026-03-04>` is accepted as `"Tue Mar 03 2026 16:00:00 GMT-0800 (Pacific Standard Time)"`. The format depends on the machine's locale and time zone, and the date is a day early, because exceljs dates are wall-clock values stored as UTC.
- `shelf_id: true` is accepted as `"true"`.

Separately, `cellToPrimitive` returns `null` for exceljs value shapes it doesn't recognise:
- `{ sharedFormula, result }`
- a formula with no cached `result`
- any other unknown object

`null` is then treated as empty, so optional columns are quietly set to NULL and required columns get a misleading `required` rejection. A hyperlink whose `text` is itself rich text is returned as a raw object, and becomes `"[object Object]"`.

These cases are the "silently-NULLed / silently-coerced" failures the module header says must never happen. Phase 84+ will promote rows from this pipeline into real tables.
**Fix:**
```js
function normalizeText(raw) {
  if (typeof raw === 'string') return { ok: true, value: raw.trim() };
  if (typeof raw === 'number' && isFinite(raw)) return { ok: true, value: String(raw) };
  if (raw && raw.cellError) return { ok: false, reason: 'cell error: ' + raw.cellError };
  return { ok: false, reason: 'expected text, got ' + (raw instanceof Date ? 'date' : typeof raw) };
}
```
In `cellToPrimitive`:
- handle `sharedFormula` the same way as `formula`;
- recurse on `hyperlink.text`;
- return `{ cellError: 'unsupported cell value' }` instead of `null` for unknown objects and for formulas with no cached result.

### CR-04: Checks pass and promote succeeds with zero accepted rows; spec headers are never checked against the sheet

**File:** `zoho-middleware/scripts/backfill/load.js:148-193, 342-377`; `zoho-middleware/scripts/backfill/backfill.js:280-300, 333-355`; `zoho-middleware/scripts/backfill/normalize.js:291`
**Issue:** I confirmed the known problem, and it reaches further than reported.
1. `computeExpected` builds its expected values from the **accepted** rows only. With 0 accepted out of N read:
   - `row_count` compares 0 with 0;
   - every `null_count` compares 0 with 0;
   - min/max checks are skipped.

   The result is `Checks: PASS`. With `--promote --accept-rejects`, `promote()` inserts 0 rows into the empty target and exits 0. A sheet that rejected 100% of its rows is reported as a successful promotion.
2. `runBackfill` never compares `spec.columns[].header` with `sheetResult.headers`. If a header is renamed or missing in the sheet, `rawValuesByHeader[col.header]` is `undefined` for every row. A **required** column then rejects every row, which loops back into item 1. An **optional** column is quietly NULL for every row, and the null-count check passes, because the expected nulls come from the same NULLed rows. Extra columns in the sheet are quietly ignored.
3. No test covers either path. Every DB test uses 3 accepted out of 4 read.

**Fix:**
- In `runBackfill`, right after `readSheet`, abort with `EXIT.ERROR` if any `spec.columns[].header` is missing from `sheetResult.headers`. Also list any unmapped sheet headers.
- In `runChecks`, add a `read_vs_accepted` check that takes `counts.read` and fails when `accepted === 0 && read > 0`.
- Make `promote()` refuse to run when the scratch row count is 0.
- Add regression tests for all three.

## Warnings

### WR-01: Source of the pg `client.query()` deprecation warning — concurrent queries on one client

**File:** `zoho-middleware/scripts/backfill/load.js:200-306` (`runColumnChecks`), `:362-366` (`runChecks`), `:451-457` (`dbStatus`)
**Issue:** There are three call sites, all in `load.js`:
- `runColumnChecks` starts the `null_count` query and the min/max (or true_count) query on the same `client` together inside `Promise.all`.
- `runChecks` then runs `runColumnChecks` for **every column** at once with `Promise.all(colChecks)`, so up to about 18 queries are queued on one client.
- `dbStatus` sends 4 `client.query` calls through `Promise.all` on the single client that `runStatusFlow` checked out (`backfill.js:155-157`). This is the warning seen on `backfill --status`.

pg 8.23 sends the warning through `queryQueueLengthDeprecationNotice` (`node_modules/pg/lib/client.js:34`). The calls are safe on pg 8 because they are queued, but pg@9 removes this behaviour. `pg-harness.js` is **not** a source: it always issues one query at a time.
**Fix:** Run the queries one after another with a reduce chain, or `async`/`await`:
```js
return spec.columns.reduce(function (chain, col) {
  return chain.then(function (acc) {
    return runColumnChecks(client, qualifiedTable, col, expected.columns[col.name])
      .then(function (r) { return acc.concat(r); });
  });
}, Promise.resolve([]));
```
Inside `runColumnChecks`, chain its two queries instead of putting them in `Promise.all`. Do the same for `dbStatus`. Alternatively, `dbStatus` can use `pool.query` per statement instead of a single checked-out client.

### WR-02: Backfill error paths never release the client, so the CLI hangs; duplicate primary keys abort the whole load

**File:** `zoho-middleware/scripts/backfill/backfill.js:302-362, 384-390`
**Issue:** In `runLoadChecksPromote`, the final `.catch` only logs. These failures all reach it **without** calling `client.release()`:
- a rejection from `promptTypeDatabaseName` (the operator mistyped the database name);
- a failure in `loadScratch`;
- a failure in `runChecks`.

The comment at line 358 talks about guarding against a double release, but no release happens on this path at all. `main()` then awaits `pool.end()`. pg-pool's `end()` only resolves once `_clients.length === 0` (`pg-pool/index.js:139-143`), so the process prints the error and hangs forever.

A likely trigger: Sheets does not enforce unique IDs, and nothing in normalise or rejects detects duplicate `primaryKey` values. A duplicate ID therefore causes a `23505` error inside `loadScratch`. That rolls back the whole load instead of producing a reject, and then hits the hang.
**Fix:**
- Release the client in one place, using a flag so it cannot be released twice.
- Release with the error (`client.release(err)`) on failure paths, so a client left in a bad state is destroyed rather than returned to the pool.
- In `runBackfill`, detect duplicate `spec.primaryKey` values after normalising, and send them to `rejects` with reason `duplicate primary key`.

### WR-03: The argv connection-string guard prints the credential it is meant to protect

**File:** `zoho-middleware/scripts/backfill/backfill.js:91-96`
**Issue:** When an argument matches `postgres(ql)?://`, the thrown message includes the full argument, and `main()` prints it to stderr (line 369). The password ends up in terminal scrollback and in any CI or `tee` log. T-83-07-01 exists to prevent exactly this.
**Fix:** `throw new Error('pass the database via BACKFILL_DATABASE_URL, never on the command line (got "' + db.redactConnectionString(arg) + '")');`, or leave the value out of the message entirely.

### WR-04: The TLS relaxation is decided by a substring match anywhere in the URL; `sslmode` in the URL silently overrides it

**File:** `zoho-middleware/lib/db.js:38-43`
**Issue:**
- `/\.proxy\.rlwy\.net/` is tested against the whole connection string. It matches the password, the database name and query parameters, not just the host. I confirmed that `sslConfigFor('postgres://u:p@evil.example.com:5432/db?application_name=x.proxy.rlwy.net')` returns `{ rejectUnauthorized: false }`. This turns off certificate checking for any host, which breaks T-83-02-05's "scoped to the Railway public proxy ONLY" promise.
- `pg` merges `parse(connectionString)` over the explicit config (`pg/lib/connection-parameters.js:59-60`). Any `sslmode=` parameter replaces `ssl` with `{}` (`pg-connection-string/index.js:77-79`). So the function's return value is not authoritative.
**Fix:** Parse the hostname and check its suffix:
```js
function sslConfigFor(cs) {
  try {
    var host = new URL(cs).hostname;
    if (/\.proxy\.rlwy\.net$/.test(host)) return { rejectUnauthorized: false };
  } catch (e) { /* fall through */ }
  return false;
}
```
Also document, or reject, `sslmode` in `DATABASE_URL` / `BACKFILL_DATABASE_URL`.

### WR-05: `withTransaction` returns broken connections to the pool, and a checked-out client has no error listener

**File:** `zoho-middleware/lib/db.js:111-132`
**Issue:**
1. If `ROLLBACK` or `COMMIT` fails (connection lost, or the backend was terminated), line 130 calls `client.release()` with no argument. The client goes back into the pool's idle list with an unknown transaction state.
2. pg-pool removes its `idleListener` when a client is checked out (`pg-pool/index.js` `_acquireClient`: `client.removeListener('error', idleListener)`). If the backend drops while `fn(client)` is between queries, for example while awaiting non-DB work in a Phase 84 store, pg emits `'error'` on the client with no listener attached. Node crashes, which breaks D-02.

Nothing calls `withTransaction` yet, but Phase 84 will.
**Fix:**
```js
return getPool().connect().then(function (client) {
  var onErr = function (e) { log.error('[db] checked-out client error: ' + e.message); };
  client.on('error', onErr);
  var failed = null;
  return client.query('BEGIN')
    /* ... */
    .catch(function (err) {
      return client.query('ROLLBACK').catch(function (rbErr) { failed = rbErr; }).then(function () { throw err; });
    })
    .finally(function () { client.removeListener('error', onErr); client.release(failed || undefined); });
});
```

### WR-06: Public `/health` can use up the DB pool; queries that time out keep holding connections

**File:** `zoho-middleware/server.js:143-166, 168-188`
**Issue:**
- `/health` has no authentication and is registered before every rate limiter (`server.js:197+`).
- Every hit runs `select 1` through the shared pool, which has `max: 5`.
- The 3 s race only stops waiting on the query; it does not cancel it. So while Postgres is slow, each probe keeps holding a pool slot or a queue entry for up to 5 s (`connectionTimeoutMillis`). There is also no `statement_timeout`, so a probe query that is already running can hold its slot even longer.

During Phase 84, a burst of `/health` requests from Railway or an attacker can starve real store queries.
**Fix:** Run at most one DB probe at a time and cache the result for a short period:
```js
var dbProbe = { at: 0, value: false, inflight: null };
function checkDatabase() {
  if (!db.isConfigured()) return Promise.resolve(false);
  if (Date.now() - dbProbe.at < 5000) return Promise.resolve(dbProbe.value);
  if (!dbProbe.inflight) { dbProbe.inflight = /* existing race */ .then(function (v) { dbProbe = { at: Date.now(), value: v, inflight: null }; return v; }); }
  return dbProbe.inflight;
}
```
Also set `statement_timeout` (for example `options: '-c statement_timeout=5000'`) in `createPool`.

### WR-07: The dual-write comparator rounds every number to 2 decimals and hides real drift

**File:** `zoho-middleware/lib/dual-write-compare.js:94-96`
**Issue:** The money normalisation (`toFixed(2)`) runs whenever **either** side is a number, and that includes number-vs-number. With this "generic" comparator:
- `1.0505` vs `1.0512` (gravity) match;
- `0.001` vs `0.004` match;
- `2.333` vs `2.334` (litres, quantities) match.

For any non-money numeric field, a discrepancy is reported as `match: true`, which defeats D-08.
**Fix:** Only round fields the caller declares as money, for example `params.moneyKeys`. Otherwise compare `Number(a) === Number(b)`, or compare against the column's actual scale.

### WR-08: Discrepancy paths can carry PII or bearer codes into logs and Sentry, with no cap on the log line

**File:** `zoho-middleware/lib/dual-write-compare.js:130-133, 195-202`
**Issue:**
- The module promises "paths and types only, never raw values". But a path is made of object **keys**. If a Phase 84 store compares maps keyed by data (gift-card code, email, customer name), those values go straight into the log line and into Sentry `extra.paths`. Gift-card codes are bearer credentials.
- The `log.warn` at line 196 joins **all** the paths with no cap. `MAX_REPORTED_PATHS` only limits what goes to Sentry.
- A key that contains `.` also breaks `getAtPath` (line 156) and the `reportValuesFor` matching.
**Fix:** Before reporting, replace any key segment that is not in an allowlisted schema with a placeholder (for example, replace segments that match a code or email shape with `<key>`). Cap the log list at `MAX_REPORTED_PATHS` as well. Document that callers must pass arrays or fixed-key records, never data-keyed maps.

### WR-09: Promote checks that the target is empty outside the transaction, without a lock (TOCTOU)

**File:** `zoho-middleware/scripts/backfill/load.js:401-444`
**Issue:** `to_regclass` and `count(*) = 0` run before `BEGIN`. In Phase 84+ the app may write to the target (for example in `dual` mode) between the check and the insert. The promote then merges into a table that is no longer empty, which can cause a partial primary-key conflict or rows mixed with live data.
**Fix:** Inside the transaction, run `LOCK TABLE <target> IN EXCLUSIVE MODE`, then re-check `count(*) = 0`, then insert. If the check fails, `ROLLBACK`.

### WR-10: Tests miss the failure modes above

**File:** `zoho-middleware/__tests__/migration-guard.test.js`, `zoho-middleware/__tests__/db/backfill.test.js`, `zoho-middleware/__tests__/backfill/normalize.test.js`
**Issue:**
- None of the bypass inputs in CR-01 are tested.
- There is no test for a non-SQL migration file (CR-02).
- There is no test for cell-error, Date or boolean values in a text column (CR-03).
- There is no test for 0 accepted rows or a missing header (CR-04).
- There is no test for a failure on the CLI error path (for example a wrong database-name confirmation) followed by `pool.end()` (WR-02). A test with that shape would hang and so expose the leak.

Every end-to-end DB test uses the same well-formed 3-accepted/4-read fixture.
**Fix:** Add a regression test for each finding before fixing it, as the project's CLAUDE.md requires.

## Info

### IN-01: The `alter-type` rule wrongly flags a column named `type`
**File:** `zoho-middleware/scripts/migration-guard.js:42`
**Issue:** `ALTER TABLE t ADD COLUMN type text;` is reported as `alter-type` (confirmed). This blocks a legitimate additive migration.
**Fix:** Covered by the CR-01 rewrite: match `ALTER [COLUMN] <ident> [SET DATA] TYPE`, not "contains column ... type".

### IN-02: `mirrorFireAndForget` assumes any thenable has `.catch`; it logs raw error messages
**File:** `zoho-middleware/lib/sheet-mirror.js:83-86, 75`
**Issue:** A thenable without `.catch` throws a TypeError. That error gets reported, and the real rejection goes unhandled. Apps Script error messages logged at line 75 can echo back request payloads, which may include customer data.
**Fix:** `Promise.resolve(result).catch(reportFailure)`. Truncate or scrub `message` before `log.warn`.

### IN-03: Boolean CLI flags ignore their value
**File:** `zoho-middleware/scripts/backfill/backfill.js:107-110`
**Issue:** `--promote=false` and `--promote=no` both turn promote **on**.
**Fix:** If a boolean flag is given with `=value`, raise an error.

### IN-04: `assertSafePath` does not follow symlinks and is case-sensitive
**File:** `zoho-middleware/scripts/backfill/rejects.js:19-42`
**Issue:**
- `path.resolve` does not follow symlinks.
- macOS APFS is case-insensitive by default, so `/Users/koa/dev/Steins-And-Vines-Website/...` is treated as outside the repo even though it is the same directory.

Either one lets a PII rejects file land inside the repo. `.gitignore` covers only `rejects-*.json` and `*.xlsx`.
**Fix:** Run `fs.realpathSync` on the existing parent directory, and compare in lowercase on darwin.

### IN-05: The text min/max check compares JS UTF-16 sort order with Postgres `COLLATE "C"` (UTF-8 byte) order
**File:** `zoho-middleware/scripts/backfill/load.js:165-170, 224-228`
**Issue:** The two orderings differ for astral characters (for example emoji in notes) compared with U+E000–U+FFFF characters. This gives spurious `min`/`max` failures.
**Fix:** Compare with `Buffer.compare(Buffer.from(a), Buffer.from(b))`.

### IN-06: Date cells lose sub-second precision by truncation, not rounding
**File:** `zoho-middleware/scripts/backfill/normalize.js:78-82`
**Issue:** exceljs converts serial dates to milliseconds with float error, which can produce values like `10:29:59.999`. `getUTCSeconds()` truncates the milliseconds, giving `10:29:59`, one second early. Wall-clock times that fall in the DST spring-forward gap are also quietly shifted rather than rejected.
**Fix:** Round to the nearest second before splitting the value into components. Reject wall-clock times whose round trip doesn't match.

### IN-07: `redactConnectionString` misses passwords passed as query parameters
**File:** `zoho-middleware/lib/db.js:52-55`
**Issue:** `postgres://host/db?password=secret` is returned unchanged.
**Fix:** Also replace `([?&]password=)[^&]*` with `$1***`.

### IN-08: `to_regclass` gets an unquoted, concatenated name
**File:** `zoho-middleware/scripts/backfill/load.js:402`
**Issue:** `targetSchema + '.' + spec.table` is folded to lower case and parsed as SQL. It fails for any future table name that needs quoting.
**Fix:** `select to_regclass($1)` with `qualify(client, targetSchema, spec.table)` as the parameter.

---

_Reviewed: 2026-10-02_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
