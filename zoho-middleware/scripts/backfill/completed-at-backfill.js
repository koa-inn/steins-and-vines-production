'use strict';

/**
 * Completed-at backfill - Phase 94 Plan 06 (B2, D-14, D-15, D-16).
 *
 * Fills batches.completed_at for status=complete batches that lack it, using the latest completed
 * task's completed_at. A batch with no completed task stays blank (D-14); the batch's own
 * modified-time column is never used. Filled rows carry completed_at_source 'backfill-task'.
 *
 * DRY RUN by default: lists every candidate with the proposed date or "stays-blank", plus counts.
 * It writes only with --apply --expect=<N> (N = the "will fill" count the owner reviewed). Writes
 * go through lib/batch-pg-update.updateBatch on the trusted channel, one transaction per batch;
 * an already-set completed_at is never overwritten (already_set -> skipped).
 *
 * Output is ids, dates and counts only. Env only: BACKFILL_DATABASE_URL.
 *
 *   node scripts/backfill/completed-at-backfill.js                      # dry run
 *   node scripts/backfill/completed-at-backfill.js --apply --expect=40
 *
 * Exit codes: 0 ok, 1 error, 3 --expect did not match the will-fill count.
 */

var backfillCli = require('./backfill');
var pgUpdate = require('../../lib/batch-pg-update');
var sheetMirror = require('../../lib/sheet-mirror');

var EXIT = backfillCli.EXIT;
var POSTGRES_URL_RE = /postgres(ql)?:\/\//;

// Constant SQL - no input is interpolated.
var CANDIDATES_SQL =
  'select b.batch_id, to_char(b.start_date, \'YYYY-MM-DD\') as start_date, ' +
  'max(t.completed_at) filter (where t.completed) as latest_task_completed_at, ' +
  'to_char(max(t.completed_at) filter (where t.completed) at time zone \'America/Vancouver\', \'YYYY-MM-DD\') ' +
  'as latest_task_day ' +
  'from batches b left join batch_tasks t on t.batch_id = b.batch_id ' +
  'where b.status = \'complete\' and b.completed_at is null ' +
  'group by b.batch_id, b.start_date ' +
  'order by length(b.batch_id), b.batch_id';

function parseArgs(argv) {
  var opts = { apply: false, dryRun: false, expect: null };
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
    } else if (flag === '--expect' && value !== undefined && /^\d+$/.test(value)) {
      opts.expect = parseInt(value, 10);
    } else {
      throw new Error('unknown flag "' + flag + '" - valid flags: --dry-run, --apply, --expect=<n>');
    }
  });
  if (opts.apply && opts.dryRun) throw new Error('--dry-run and --apply cannot be combined');
  if (opts.apply && opts.expect === null) {
    throw new Error('--apply requires --expect=<will fill> from the reviewed dry run');
  }
  if (!opts.apply && opts.expect !== null) throw new Error('--expect is only valid with --apply');
  return opts;
}

async function readRows(pool) {
  var client = await pool.connect();
  try {
    await client.query('begin transaction read only');
    var res = await client.query(CANDIDATES_SQL);
    await client.query('commit');
    return res.rows;
  } catch (err) {
    await client.query('rollback').catch(function () {});
    throw err;
  } finally {
    client.release();
  }
}

async function writeOne(pool, entry, now) {
  var client = await pool.connect();
  try {
    await client.query('begin');
    var res = await pgUpdate.updateBatch(
      client,
      { batch_id: entry.batch_id, updates: { completed_at: entry.iso } },
      { trusted: true, completedAtSource: 'backfill-task', actor: 'backfill', now: now }
    );
    if (res && res.ok) {
      await client.query('commit');
    } else {
      await client.query('rollback');
    }
    return res;
  } catch (err) {
    await client.query('rollback').catch(function () {});
    throw err;
  } finally {
    client.release();
  }
}

function logNext(log, isProduction, since) {
  if (isProduction()) {
    log('Next: node scripts/backfill/batches-replay-to-sheet.js --since=' + since.toISOString() +
      ' --apply, then batches-verify');
  } else {
    log('Staging: no sheet replay (staging never mirrors). Next: node scripts/backfill/batch-cycle-recompute.js');
  }
}

/**
 * runCompletedAtBackfill(opts, deps) -> Promise<{exitCode, candidates, willFill, written, skipped}>.
 * deps: {pool, log, isProduction, now}.
 */
async function runCompletedAtBackfill(opts, deps) {
  deps = deps || {};
  var log = deps.log || console.log;
  var isProduction = deps.isProduction || sheetMirror.isMirrorEnabled;
  try {
    var rows = await readRows(deps.pool);
    var fill = [];
    var blank = 0;
    var beforeStart = 0;
    rows.forEach(function (r) {
      if (!r.latest_task_completed_at) {
        blank++;
        log(r.batch_id + ' stays-blank');
        return;
      }
      var iso = new Date(r.latest_task_completed_at).toISOString();
      fill.push({ batch_id: r.batch_id, iso: iso });
      if (r.start_date && r.latest_task_day && r.latest_task_day < r.start_date) beforeStart++;
      log(r.batch_id + ' ' + iso + ' backfill-task');
    });
    log('candidates: ' + rows.length);
    log('will fill: ' + fill.length);
    log('stay blank: ' + blank);
    log('before start_date: ' + beforeStart);

    if (!opts.apply) {
      log('Dry run - no writes. Re-run with --apply --expect=' + fill.length +
        ' after the owner OKs this list.');
      return { exitCode: EXIT.OK, candidates: rows.length, willFill: fill.length, written: 0, skipped: 0 };
    }
    if (fill.length !== opts.expect) {
      log('Refusing to apply: will fill ' + fill.length + ' != --expect ' + opts.expect +
        '. Re-run the dry run and re-review.');
      return { exitCode: EXIT.CHECKS_FAILED, candidates: rows.length, willFill: fill.length, written: 0, skipped: 0 };
    }

    var applyStart = deps.now ? deps.now() : new Date();
    var written = 0;
    var skipped = 0;
    for (var i = 0; i < fill.length; i++) {
      var res = await writeOne(deps.pool, fill[i], applyStart);
      if (res && res.ok) {
        written++;
      } else if (res && res.error === 'already_set') {
        skipped++;
      } else {
        log('Apply stopped - batch ' + fill[i].batch_id + ' error=' + ((res && res.error) || 'unknown'));
        return { exitCode: EXIT.ERROR, candidates: rows.length, willFill: fill.length, written: written, skipped: skipped };
      }
    }
    log('written: ' + written);
    log('skipped: ' + skipped);
    log('Note: task completion dates are often ticked late; backfilled dates may overstate cycle time (marked backfill-task).');
    logNext(log, isProduction, applyStart);
    return { exitCode: EXIT.OK, candidates: rows.length, willFill: fill.length, written: written, skipped: skipped };
  } catch (err) {
    log('Error: ' + err.message);
    return { exitCode: EXIT.ERROR, candidates: 0, willFill: 0, written: 0, skipped: 0 };
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
  runCompletedAtBackfill(opts, { pool: pool, log: console.log })
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
  runCompletedAtBackfill: runCompletedAtBackfill,
  parseArgs: parseArgs,
  EXIT: EXIT
};
