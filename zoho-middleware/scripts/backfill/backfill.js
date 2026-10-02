#!/usr/bin/env node
'use strict';

/**
 * Backfill CLI — Phase 83 Plan 07 (DB-02 SC4).
 *
 * The whole pipeline: read snapshot -> normalise -> rejects report -> load scratch
 * schema -> row-count/min/max/null checks -> (optional, gated) promote. Runs on the
 * owner's Mac (D-10) against BACKFILL_DATABASE_URL — never zero rows touch any real
 * table this phase; promote only ever targets a test-created empty table in CI's
 * Testcontainers run (Task 1/2 of this plan).
 *
 * The target database comes ONLY from the BACKFILL_DATABASE_URL env var, never argv
 * (T-83-07-01) — any argv value that looks like a Postgres connection string is a hard
 * parseArgs error. Terminal output is counts and file paths only; row contents (incl.
 * reject reasons, which may quote a bad cell's raw value) stay in the PII rejects file
 * written by rejects.js (D-13).
 */

var fs = require('fs');
var readline = require('readline');

var db = require('../../lib/db');
var load = require('./load');
var specs = require('./specs');
var readXlsx = require('./read-xlsx');
var normalizeRow = require('./normalize').normalizeRow;
var rejectsLib = require('./rejects');

var EXIT = { OK: 0, ERROR: 1, REJECTS_BLOCK: 2, CHECKS_FAILED: 3 };

// Recorded workbook timezone (docs/RUNBOOK.md, Plan 83-01) — the backfill's --timezone default.
var DEFAULT_TIMEZONE = 'America/Vancouver';
var DEFAULT_SCHEMA = 'scratch_backfill';

var POSTGRES_URL_RE = /postgres(ql)?:\/\//;

var VALID_FLAGS = [
  '--file',
  '--sheet',
  '--schema',
  '--timezone',
  '--out-dir',
  '--promote',
  '--accept-rejects',
  '--status',
  '--dry-run',
  '--yes'
];

var BOOLEAN_FLAGS = {
  '--promote': 'promote',
  '--accept-rejects': 'acceptRejects',
  '--status': 'status',
  '--dry-run': 'dryRun',
  '--yes': 'yes'
};

var VALUE_FLAGS = {
  '--file': 'file',
  '--sheet': 'sheet',
  '--schema': 'schema',
  '--timezone': 'timezone',
  '--out-dir': 'outDir'
};

/**
 * parseArgs(argv) -> { file, sheet, schema, timezone, outDir, promote, acceptRejects,
 *                       status, dryRun, yes }
 *
 * Simple process.argv scanning (no arg-parsing library — matches every other script in
 * this codebase). Any argv entry that looks like a Postgres connection string is a hard
 * error regardless of which flag carried it (T-83-07-01) — the database comes ONLY from
 * BACKFILL_DATABASE_URL.
 */
function parseArgs(argv) {
  var opts = {
    file: undefined,
    sheet: undefined,
    schema: DEFAULT_SCHEMA,
    timezone: DEFAULT_TIMEZONE,
    outDir: rejectsLib.DEFAULT_OUT_DIR,
    promote: false,
    acceptRejects: false,
    status: false,
    dryRun: false,
    yes: false
  };

  argv.forEach(function (arg) {
    if (POSTGRES_URL_RE.test(arg)) {
      throw new Error(
        'pass the database via BACKFILL_DATABASE_URL, never on the command line (got "' +
          arg +
          '")'
      );
    }

    var eqIdx = arg.indexOf('=');
    var flag = eqIdx === -1 ? arg : arg.slice(0, eqIdx);
    var value = eqIdx === -1 ? undefined : arg.slice(eqIdx + 1);

    if (VALID_FLAGS.indexOf(flag) === -1) {
      throw new Error('unknown flag "' + flag + '" — valid flags: ' + VALID_FLAGS.join(', '));
    }

    if (BOOLEAN_FLAGS[flag]) {
      opts[BOOLEAN_FLAGS[flag]] = true;
      return;
    }

    opts[VALUE_FLAGS[flag]] = value;
  });

  if (opts.sheet !== undefined) {
    try {
      specs.getSpec(opts.sheet);
    } catch (e) {
      throw new Error(
        'unknown sheet "' + opts.sheet + '" — valid sheets: ' + specs.listSpecs().join(', ')
      );
    }
  }

  return opts;
}

/**
 * Refuses a snapshot path inside the tracked repo (same repo-boundary rule as the
 * rejects report — D-13: the snapshot is exactly as PII-bearing as the rejects it
 * produces).
 */
function assertSnapshotSafePath(filePath) {
  rejectsLib.assertSafePath(filePath);
}

/**
 * checkHeaders(spec, sheetHeaders) -> { missing: string[], unmapped: string[] }
 *
 * Exact, case-sensitive comparison of spec.columns[].header (required or optional)
 * against the sheet's actual row-1 headers (already trimmed by readSheet). `missing`
 * is every spec header absent from the sheet; `unmapped` is every sheet header that
 * doesn't map to any spec column (CR-04 / VERIFICATION gap 3) — a renamed or deleted
 * OPTIONAL column previously loaded as all-NULL and passed every check silently.
 */
function checkHeaders(spec, sheetHeaders) {
  var specHeaders = spec.columns.map(function (col) {
    return col.header;
  });
  var sheetSet = {};
  sheetHeaders.forEach(function (h) {
    sheetSet[h] = true;
  });
  var specSet = {};
  specHeaders.forEach(function (h) {
    specSet[h] = true;
  });

  return {
    missing: specHeaders.filter(function (h) {
      return !sheetSet[h];
    }),
    unmapped: sheetHeaders.filter(function (h) {
      return !specSet[h];
    })
  };
}

function promptTypeDatabaseName(expectedName) {
  return new Promise(function (resolve, reject) {
    var rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('Type the database name (' + expectedName + ') to continue: ', function (answer) {
      rl.close();
      if (answer.trim() === expectedName) {
        resolve();
      } else {
        reject(new Error('database name confirmation did not match — aborting, nothing written'));
      }
    });
  });
}

function runStatusFlow(deps) {
  var log = deps.log;
  var pool = deps.pool;

  return pool.connect().then(function (client) {
    return load
      .dbStatus(client)
      .then(
        function (status) {
          client.release();
          log('Database: ' + status.database);
          log('Migrations: ' + status.migrations.join(', '));
          log('Scratch schemas: ' + status.scratchSchemas.join(', '));
          return { exitCode: EXIT.OK, rejectsPath: null, counts: null };
        },
        function (err) {
          client.release();
          throw err;
        }
      );
  });
}

/**
 * runBackfill(opts, { pool, log }) -> Promise<{ exitCode, rejectsPath, counts }>
 *
 * Steps print as [1/6]..[6/6]; terminal output is counts and paths ONLY — never row
 * contents (D-13). dryRun never calls pool.connect() (steps 4-6 are skipped entirely
 * before any pool use). promote is gated: rejects > 0 blocks unless --accept-rejects
 * (EXIT.REJECTS_BLOCK); a failing check blocks promote (EXIT.CHECKS_FAILED) regardless
 * of --promote, since a failed check means the scratch load itself is suspect.
 */
function runBackfill(opts, deps) {
  deps = deps || {};
  var log = deps.log || console.log;
  var pool = deps.pool;

  if (opts.status) {
    return runStatusFlow({ pool: pool, log: log });
  }

  try {
    assertSnapshotSafePath(opts.file);
  } catch (err) {
    log('Error: ' + err.message);
    return Promise.resolve({ exitCode: EXIT.ERROR, rejectsPath: null, counts: null });
  }

  if (!opts.file || !fs.existsSync(opts.file)) {
    log('Error: snapshot not found: ' + opts.file);
    return Promise.resolve({ exitCode: EXIT.ERROR, rejectsPath: null, counts: null });
  }

  var spec;
  try {
    spec = specs.getSpec(opts.sheet);
    load.assertScratchSchema(opts.schema);
  } catch (err) {
    log('Error: ' + err.message);
    return Promise.resolve({ exitCode: EXIT.ERROR, rejectsPath: null, counts: null });
  }

  log('[1/6] Read snapshot');
  return readXlsx
    .readSheet(opts.file, spec.sheet)
    .then(function (sheetResult) {
      // Header names are column labels, not row contents, so logging them is
      // consistent with D-13 (only counts/paths/column-and-check-names go to the
      // terminal — never cell values).
      var headerCheck = checkHeaders(spec, sheetResult.headers);
      if (headerCheck.unmapped.length) {
        log('Unmapped sheet header(s): ' + headerCheck.unmapped.join(', '));
      }
      if (headerCheck.missing.length) {
        log(
          'Error: sheet "' +
            spec.sheet +
            '" is missing spec header(s): ' +
            headerCheck.missing.join(', ') +
            ' — the spec and the sheet have drifted; fix the sheet or the spec before loading'
        );
        return { exitCode: EXIT.ERROR, rejectsPath: null, counts: null };
      }

      log('[2/6] Normalise');
      var accepted = [];
      var rejects = [];
      sheetResult.rows.forEach(function (row) {
        var result = normalizeRow(spec, row.values, { timezone: opts.timezone });
        if (result.ok) {
          accepted.push(result.values);
        } else {
          rejects.push({ rowNumber: row.rowNumber, reasons: result.reasons });
        }
      });

      log('[3/6] Rejects report');
      return rejectsLib
        .writeRejectsReport({
          sheet: spec.sheet,
          sourceFile: opts.file,
          rejects: rejects,
          outDir: opts.outDir
        })
        .then(function (rejectsPath) {
          var counts = {
            read: sheetResult.rows.length,
            accepted: accepted.length,
            rejected: rejects.length
          };
          log(
            'Read ' +
              counts.read +
              ', accepted ' +
              counts.accepted +
              ', rejected ' +
              counts.rejected +
              ' — rejects: ' +
              rejectsPath
          );

          if (opts.dryRun) {
            log('[4/6] Load scratch — skipped (--dry-run)');
            log('[5/6] Checks — skipped (--dry-run)');
            log('[6/6] Promote — skipped (--dry-run)');
            return { exitCode: EXIT.OK, rejectsPath: rejectsPath, counts: counts };
          }

          return pool.connect().then(function (client) {
            return runLoadChecksPromote(client, opts, spec, accepted, rejects, rejectsPath, counts, log);
          });
        });
    })
    .catch(function (err) {
      log('Error: ' + err.message);
      return { exitCode: EXIT.ERROR, rejectsPath: null, counts: null };
    });
}

/**
 * summarizeChecks(checksResult) -> { ok, line }
 *
 * The step [5/6] result line — always printed, PASS or FAIL. Names failed checks as
 * `row_count` or `<column>.<check>` only; never expected/actual values, which can be
 * row contents (D-13). Fails closed: a missing/empty result set or any failed entry is
 * a FAIL even if `ok` claims otherwise.
 */
function summarizeChecks(checksResult) {
  var results = (checksResult && checksResult.results) || [];
  var failed = results.filter(function (r) {
    return !r.ok;
  });
  var ok = Boolean(checksResult && checksResult.ok) && results.length > 0 && failed.length === 0;

  if (ok) {
    return { ok: true, line: 'Checks: PASS (' + results.length + ' checks)' };
  }

  var names = failed.map(function (r) {
    return r.column ? r.column + '.' + r.check : r.check;
  });
  var detail = names.length > 0 ? names.join(', ') : 'no check results';
  return {
    ok: false,
    line:
      'Checks: FAIL — ' + detail + ' (' + failed.length + ' of ' + results.length + ' checks failed)'
  };
}

function runLoadChecksPromote(client, opts, spec, accepted, rejects, rejectsPath, counts, log) {
  return client
    .query('select current_database() as database')
    .then(function (r) {
      var databaseName = r.rows[0].database;
      log('Target: ' + db.redactConnectionString(process.env.BACKFILL_DATABASE_URL || '') + ' database=' + databaseName);
      return opts.yes ? Promise.resolve() : promptTypeDatabaseName(databaseName);
    })
    .then(function () {
      log('[4/6] Load scratch ' + opts.schema + '.' + spec.table);
      return load.loadScratch(client, { schema: opts.schema, spec: spec, rows: accepted });
    })
    .then(function () {
      log('[5/6] Checks');
      return load.runChecks(client, { schema: opts.schema, spec: spec, rows: accepted, read: counts.read });
    })
    .then(function (checksResult) {
      var summary = summarizeChecks(checksResult);
      log(summary.line);
      if (!summary.ok) {
        log('[6/6] Promote — skipped (checks failed)');
        client.release();
        return { exitCode: EXIT.CHECKS_FAILED, rejectsPath: rejectsPath, counts: counts };
      }

      if (!opts.promote) {
        log('[6/6] Promote — skipped — pass --promote');
        client.release();
        return { exitCode: EXIT.OK, rejectsPath: rejectsPath, counts: counts };
      }

      if (rejects.length > 0 && !opts.acceptRejects) {
        log(
          'Promotion blocked: ' +
            rejects.length +
            ' reject(s) — review ' +
            rejectsPath +
            ', fix the sheet and re-download, or re-run with --accept-rejects'
        );
        client.release();
        return { exitCode: EXIT.REJECTS_BLOCK, rejectsPath: rejectsPath, counts: counts };
      }

      log('[6/6] Promote');
      return load.promote(client, { schema: opts.schema, spec: spec, targetSchema: 'public' }).then(
        function () {
          client.release();
          return { exitCode: EXIT.OK, rejectsPath: rejectsPath, counts: counts };
        },
        function (err) {
          client.release();
          throw err;
        }
      );
    })
    .catch(function (err) {
      // client may already be released on the known-error branches above; guard double-release.
      log('Error: ' + err.message);
      return { exitCode: EXIT.ERROR, rejectsPath: rejectsPath, counts: counts };
    });
}

function main() {
  var opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error('Error: ' + err.message);
    process.exit(EXIT.ERROR);
    return;
  }

  var pool = null;
  if (!opts.dryRun) {
    if (!process.env.BACKFILL_DATABASE_URL) {
      console.error('Error: BACKFILL_DATABASE_URL must be set (unless --dry-run)');
      process.exit(EXIT.ERROR);
      return;
    }
    pool = db.createPool(process.env.BACKFILL_DATABASE_URL, { max: 2 });
  }

  runBackfill(opts, { pool: pool, log: console.log })
    .then(function (result) {
      var finish = pool ? pool.end() : Promise.resolve();
      return finish.then(function () {
        return result;
      });
    })
    .then(function (result) {
      process.exit(result.exitCode);
    })
    .catch(function (err) {
      console.error('Fatal: ' + err.message);
      var finish = pool ? pool.end().catch(function () {}) : Promise.resolve();
      finish.then(function () {
        process.exit(EXIT.ERROR);
      });
    });
}

if (require.main === module) {
  main();
}

module.exports = { parseArgs: parseArgs, runBackfill: runBackfill, EXIT: EXIT };
