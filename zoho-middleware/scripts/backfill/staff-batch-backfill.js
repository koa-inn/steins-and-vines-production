'use strict';

/**
 * Staff batch flag backfill - Phase 95 Plan 02 (D-09, D-18).
 *
 * Flags existing staff / family / R&D batches (batches.staff_batch = true) so the BrewPad v2 mix
 * views can hide them. Candidates: staff_batch = false AND (source is internal / research, OR a
 * customer name column contains McLachlan or Inn as a whole word, case-insensitive).
 *
 * DRY RUN by default: prints batch_id, status, source, the matching reason(s) and field name per
 * candidate, then a count summary. Customer names are never printed unless --with-names. It
 * writes only with --apply --expect=<N>, where N is the candidate count the owner reviewed.
 *
 * Writes go through lib/batch-pg-update.setStaffBatch under a row lock, one transaction per batch.
 * last_updated is NOT bumped (D-18), so no sheet replay is needed and batches-verify stays clean.
 * Env only: BACKFILL_DATABASE_URL.
 *
 *   node scripts/backfill/staff-batch-backfill.js                         # dry run
 *   node scripts/backfill/staff-batch-backfill.js --apply --expect=12
 *   node scripts/backfill/staff-batch-backfill.js --exclude=SV-B-000025,SV-B-000238   # drop reviewed rows
 *
 * --exclude removes owner-rejected rows (e.g. a paying customer who shares a family surname) from
 * both the dry run and the apply, so --expect is the count of the rows that will actually be written.
 * An excluded id that is not a candidate is refused, to catch typos.
 *
 * Exit codes: 0 ok, 1 error, 3 --expect did not match the candidate count.
 */

var backfillCli = require('./backfill');
var batchRules = require('../../lib/batch-rules');
var pgUpdate = require('../../lib/batch-pg-update');
var sheetMirror = require('../../lib/sheet-mirror');

var EXIT = backfillCli.EXIT;
var POSTGRES_URL_RE = /postgres(ql)?:\/\//;
var BATCH_ID_RE = /^SV-B-\d+$/;

// Postgres ARE word boundaries (\m start, \M end), built here and bound as parameters.
var MCLACHLAN_PG = '\\mMcLachlan\\M';
var INN_PG = '\\mInn\\M';
var NAME_FIELDS = ['customer_name', 'customer_firstname', 'customer_lastname'];
var NAME_RULES = [
  { label: 'name:McLachlan', re: /\bmclachlan\b/i },
  { label: 'name:Inn', re: /\binn\b/i }
];

// Constant SQL - no input is interpolated; sources and patterns are bound ($1..$3).
var CANDIDATES_SQL =
  'select batch_id, status, source, customer_name, customer_firstname, customer_lastname ' +
  'from batches where staff_batch = false and (' +
  'lower(trim(source)) = any($1) or ' +
  'customer_name ~* $2 or customer_firstname ~* $2 or customer_lastname ~* $2 or ' +
  'customer_name ~* $3 or customer_firstname ~* $3 or customer_lastname ~* $3) ' +
  'order by length(batch_id), batch_id';

var LOCK_SQL = 'select staff_batch from batches where batch_id = $1 for update';

function parseArgs(argv) {
  var opts = { apply: false, dryRun: false, expect: null, withNames: false, exclude: [] };
  argv.forEach(function (arg) {
    if (POSTGRES_URL_RE.test(arg)) {
      throw new Error('pass the database via BACKFILL_DATABASE_URL, never on the command line');
    }
    var eq = arg.indexOf('=');
    var flag = eq === -1 ? arg : arg.slice(0, eq);
    var value = eq === -1 ? undefined : arg.slice(eq + 1);
    if (flag === '--apply' && value === undefined) {
      opts.apply = true;
    } else if (flag === '--dry-run' && value === undefined) {
      opts.dryRun = true;
    } else if (flag === '--with-names' && value === undefined) {
      opts.withNames = true;
    } else if (flag === '--expect' && value !== undefined && /^\d+$/.test(value)) {
      opts.expect = parseInt(value, 10);
    } else if (flag === '--exclude' && value !== undefined) {
      var ids = value.split(',').map(function (s) { return s.trim(); });
      if (!ids.length || ids.some(function (id) { return !BATCH_ID_RE.test(id); })) {
        throw new Error('--exclude needs a comma list of batch ids like SV-B-000025');
      }
      ids.forEach(function (id) { if (opts.exclude.indexOf(id) === -1) opts.exclude.push(id); });
    } else {
      throw new Error('unknown flag "' + flag + '" - valid flags: --dry-run, --apply, --expect=<n>, --exclude=<ids>, --with-names');
    }
  });
  if (opts.apply && opts.dryRun) throw new Error('--dry-run and --apply cannot be combined');
  if (opts.apply && opts.expect === null) {
    throw new Error('--apply requires --expect=<candidates> from the reviewed dry run');
  }
  if (!opts.apply && opts.expect !== null) throw new Error('--expect is only valid with --apply');
  return opts;
}

function str(v) {
  return v === null || v === undefined ? '' : String(v);
}

/** Reasons for one row: [{reason, field}] computed in JS from the returned columns. */
function reasonsFor(r) {
  var out = [];
  var src = str(r.source).trim().toLowerCase();
  if (batchRules.STAFF_AUTO_SOURCES.indexOf(src) !== -1) out.push({ reason: 'source:' + src, field: 'source' });
  NAME_RULES.forEach(function (rule) {
    NAME_FIELDS.forEach(function (f) {
      if (rule.re.test(str(r[f]))) out.push({ reason: rule.label, field: f });
    });
  });
  return out;
}

function planRows(rows) {
  return rows.map(function (r) {
    var names = [];
    NAME_FIELDS.forEach(function (f) { if (str(r[f])) names.push(str(r[f])); });
    return {
      batch_id: r.batch_id, status: str(r.status), source: str(r.source).trim() || '(blank)',
      reasons: reasonsFor(r), names: names
    };
  });
}

async function readRows(pool) {
  var client = await pool.connect();
  try {
    await client.query('begin transaction read only');
    var res = await client.query(CANDIDATES_SQL, [batchRules.STAFF_AUTO_SOURCES, MCLACHLAN_PG, INN_PG]);
    await client.query('commit');
    return res.rows;
  } catch (err) {
    await client.query('rollback').catch(function () {});
    throw err;
  } finally {
    client.release();
  }
}

/** Returns 'written' or 'skipped'. */
async function writeOne(pool, entry) {
  var client = await pool.connect();
  try {
    await client.query('begin');
    var locked = await client.query(LOCK_SQL, [entry.batch_id]);
    if (!locked.rows.length || locked.rows[0].staff_batch === true) {
      await client.query('rollback');
      return 'skipped';
    }
    await pgUpdate.setStaffBatch(client, entry.batch_id, true);
    await client.query('commit');
    return 'written';
  } catch (err) {
    await client.query('rollback').catch(function () {});
    throw err;
  } finally {
    client.release();
  }
}

function logNext(log, isProduction) {
  if (isProduction()) {
    log('production: run batches-verify; expect 0 mismatches (no replay: last_updated unchanged)');
  } else {
    log('staging: no verify (staging never mirrors)');
  }
}

/**
 * runStaffBackfill(opts, deps) -> Promise<{exitCode, candidates, written, skipped}>.
 * deps: {pool, log, isProduction}.
 */
async function runStaffBackfill(opts, deps) {
  deps = deps || {};
  var log = deps.log || console.log;
  var isProduction = deps.isProduction || sheetMirror.isMirrorEnabled;
  try {
    var plan = planRows(await readRows(deps.pool));
    var exclude = opts.exclude || [];
    var candidateIds = plan.map(function (e) { return e.batch_id; });
    var missing = exclude.filter(function (id) { return candidateIds.indexOf(id) === -1; });
    if (missing.length) {
      log('Refusing: ' + missing.join(', ') + ' is not a candidate. Check the --exclude list against the dry run.');
      return { exitCode: EXIT.ERROR, candidates: 0, written: 0, skipped: 0 };
    }
    exclude.forEach(function (id) { log('excluded ' + id + ' owner_review'); });
    plan = plan.filter(function (e) { return exclude.indexOf(e.batch_id) === -1; });
    var counts = {};
    plan.forEach(function (e) {
      var seen = {};
      var desc = e.reasons.map(function (x) { return x.reason + '(' + x.field + ')'; }).join(',');
      log(e.batch_id + ' ' + e.status + ' ' + e.source + ' ' + desc +
        (opts.withNames ? ' ' + JSON.stringify(e.names.join(' | ')) : ''));
      e.reasons.forEach(function (x) {
        if (!seen[x.reason]) { seen[x.reason] = true; counts[x.reason] = (counts[x.reason] || 0) + 1; }
      });
    });
    log('--- reasons ---');
    Object.keys(counts).sort().forEach(function (k) { log(k + ': ' + counts[k]); });
    log('candidates: ' + plan.length);

    if (!opts.apply) {
      log('Dry run - no writes. Re-run with --apply ' +
        (exclude.length ? '--exclude=' + exclude.join(',') + ' ' : '') + '--expect=' + plan.length +
        ' after the owner OKs this list.');
      return { exitCode: EXIT.OK, candidates: plan.length, written: 0, skipped: 0 };
    }
    if (plan.length !== opts.expect) {
      log('Refusing to apply: candidates ' + plan.length + ' != --expect ' + opts.expect +
        '. Re-run the dry run and re-review.');
      return { exitCode: EXIT.CHECKS_FAILED, candidates: plan.length, written: 0, skipped: 0 };
    }

    var written = 0;
    var skipped = 0;
    for (var i = 0; i < plan.length; i++) {
      var outcome;
      try {
        outcome = await writeOne(deps.pool, plan[i]);
      } catch (err) {
        log('Apply stopped - batch ' + plan[i].batch_id + ' error=' + err.message);
        return { exitCode: EXIT.ERROR, candidates: plan.length, written: written, skipped: skipped };
      }
      if (outcome === 'written') {
        written++;
      } else {
        log('skipped ' + plan[i].batch_id + ' already_flagged');
        skipped++;
      }
    }
    log('written: ' + written);
    log('skipped: ' + skipped);
    logNext(log, isProduction);
    return { exitCode: EXIT.OK, candidates: plan.length, written: written, skipped: skipped };
  } catch (err) {
    log('Error: ' + err.message);
    return { exitCode: EXIT.ERROR, candidates: 0, written: 0, skipped: 0 };
  }
}

function main() {
  var db = require('../../lib/db');
  var opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error('Error: ' + err.message);
    process.exit(EXIT.ERROR);
    return;
  }
  if (!process.env.BACKFILL_DATABASE_URL) {
    console.error('Error: BACKFILL_DATABASE_URL must be set');
    process.exit(EXIT.ERROR);
    return;
  }

  var pool = db.createPool(process.env.BACKFILL_DATABASE_URL, { max: 2 });
  runStaffBackfill(opts, { pool: pool, log: console.log })
    .then(function (result) {
      return pool.end().then(function () { return result; });
    })
    .then(function (result) { process.exit(result.exitCode); })
    .catch(function (err) {
      console.error('Fatal: ' + err.message);
      pool.end().catch(function () {}).then(function () { process.exit(EXIT.ERROR); });
    });
}

if (require.main === module) {
  main();
}

module.exports = {
  runStaffBackfill: runStaffBackfill,
  parseArgs: parseArgs,
  CANDIDATES_SQL: CANDIDATES_SQL,
  EXIT: EXIT
};
