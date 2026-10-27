'use strict';

/**
 * Batch cycle-time recompute - Phase 94 Plan 13 (D-13, D-24).
 *
 * READ-ONLY, independent check of the dashboard's calendar-YTD cycle time: median and mean
 * (completed day - start day, both in America/Vancouver) computed with SQL percentile_cont so it
 * shares no code with the JS dashboard math. Used for the +/-1 day acceptance check on staging and
 * production. It also reports type coverage (rows with NULL batch_type; rows that still need a
 * type) so staging can be verified from Postgres alone, with no sheet replay.
 *
 *   node scripts/backfill/batch-cycle-recompute.js [--year=2026]
 *
 * Env only: BACKFILL_DATABASE_URL. Output is counts and whole-day statistics only, never ids.
 * Exit codes: 0 ok, 1 error.
 */

var backfillCli = require('./backfill');

var EXIT = backfillCli.EXIT;
var POSTGRES_URL_RE = /postgres(ql)?:\/\//;

// Constant SQL - the only input is the bound $1 (year).
var VAN_DAY = "(completed_at at time zone 'America/Vancouver')::date";
var IN_YTD =
  "status = 'complete' and completed_at is not null and start_date is not null and " +
  VAN_DAY + " between make_date($1,1,1) and (now() at time zone 'America/Vancouver')::date";
var DAYS = VAN_DAY + ' - start_date';

var BY_TYPE_SQL =
  "select coalesce(batch_type, 'unclassified') as batch_type, count(*) as n, " +
  'percentile_cont(0.5) within group (order by days) as median, avg(days) as mean ' +
  'from (select batch_type, ' + DAYS + ' as days from batches where ' + IN_YTD + ') c ' +
  "where days >= 0 group by coalesce(batch_type, 'unclassified') order by 1";

var TOTAL_SQL =
  'select count(*) as n, percentile_cont(0.5) within group (order by days) as median, avg(days) as mean ' +
  'from (select ' + DAYS + ' as days from batches where ' + IN_YTD + ') c where days >= 0';

var EXCLUDED_SQL =
  'select count(*) as excluded from batches where status = \'complete\' and ' +
  'extract(year from start_date) = $1 and (' +
  'completed_at is null or ' + DAYS + ' < 0)';

var COVERAGE_SQL =
  'select count(*) filter (where batch_type is null) as null_batch_type, ' +
  "count(*) filter (where batch_type = 'other' and batch_type_source is distinct from 'manual') as needs_a_type " +
  'from batches';

function vancouverYear() {
  var parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver', year: 'numeric' })
    .formatToParts(new Date());
  return parseInt(parts[0].value, 10);
}

function parseArgs(argv) {
  var opts = { year: vancouverYear() };
  argv.forEach(function (arg) {
    if (POSTGRES_URL_RE.test(arg)) {
      throw new Error('pass the database via BACKFILL_DATABASE_URL, never on the command line');
    }
    var eq = arg.indexOf('=');
    var flag = eq === -1 ? arg : arg.slice(0, eq);
    var value = eq === -1 ? undefined : arg.slice(eq + 1);
    if (flag === '--year' && value !== undefined) {
      if (!/^\d{4}$/.test(value)) throw new Error('--year must be a four-digit year, e.g. --year=2026');
      opts.year = parseInt(value, 10);
    } else {
      throw new Error('unknown flag "' + flag + '" - valid flags: --year=<yyyy>');
    }
  });
  return opts;
}

function whole(v) {
  return v === null || v === undefined ? null : Math.round(Number(v));
}

/**
 * runCycleRecompute(opts, deps) -> Promise<{exitCode, n, excluded, median, mean, byType,
 * null_batch_type, needs_a_type}>. deps: {pool, log}.
 */
async function runCycleRecompute(opts, deps) {
  var log = deps.log || console.log;
  var client;
  try {
    client = await deps.pool.connect();
    await client.query('begin transaction read only');
    var byType = (await client.query(BY_TYPE_SQL, [opts.year])).rows;
    var total = (await client.query(TOTAL_SQL, [opts.year])).rows[0];
    var excluded = (await client.query(EXCLUDED_SQL, [opts.year])).rows[0];
    var cov = (await client.query(COVERAGE_SQL)).rows[0];
    await client.query('commit');

    var res = {
      exitCode: EXIT.OK,
      n: Number(total.n),
      excluded: Number(excluded.excluded),
      median: whole(total.median),
      mean: whole(total.mean),
      byType: byType.map(function (r) {
        return { type: r.batch_type, n: Number(r.n), median: whole(r.median), mean: whole(r.mean) };
      }),
      null_batch_type: Number(cov.null_batch_type),
      needs_a_type: Number(cov.needs_a_type)
    };

    log('Calendar-YTD ' + opts.year + ' cycle time (Vancouver days, completed batches)');
    log('n: ' + res.n + '  excluded: ' + res.excluded + '  median: ' + res.median + 'd  mean: ' + res.mean + 'd');
    res.byType.forEach(function (r) {
      log('  ' + r.type + ': n=' + r.n + ' median=' + r.median + 'd mean=' + r.mean + 'd');
    });
    log('null_batch_type: ' + res.null_batch_type);
    log('needs_a_type: ' + res.needs_a_type);
    return res;
  } catch (err) {
    if (client) await client.query('rollback').catch(function () {});
    log('Error: ' + err.message);
    return { exitCode: EXIT.ERROR };
  } finally {
    if (client) client.release();
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

  var pool = db.createPool(process.env.BACKFILL_DATABASE_URL, { max: 1 });
  runCycleRecompute(opts, { pool: pool, log: console.log })
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
  runCycleRecompute: runCycleRecompute,
  parseArgs: parseArgs,
  EXIT: EXIT
};
