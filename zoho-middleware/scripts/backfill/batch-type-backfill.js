'use strict';

/**
 * Batch type backfill - Phase 94 Plan 06 (B3, D-05, D-06, D-09, D-22).
 *
 * Re-classifies every batch with lib/batch-rules.classifyBatchType using recipe hints
 * (recipes.beer_category / style), the Zoho cf_type looked up by SKU / item_id from a live Zoho
 * item list, and the schedule category join - never the product name for rule 2.
 *
 * DRY RUN by default: lists every batch with its action, proposed type, deciding rule and
 * product_sku, then a type x rule count table. It writes only with --apply --expect=<N>, where N
 * is the candidate count the owner reviewed in the dry run.
 *
 * Candidates: rows whose batch_type_source is NULL, 'name' or 'other' and whose proposal differs.
 * Rows sourced from recipe / zoho / schedule are kept; 'manual' rows are never touched (also
 * re-checked under the row lock by updateBatch -> manual_locked). Writes go through
 * lib/batch-pg-update.updateBatch on the trusted channel, one transaction per batch.
 *
 * Output is ids, rules, SKUs and counts only (no customer data). product_name is printed only
 * with --with-names. Env only: BACKFILL_DATABASE_URL (+ Zoho credentials for the item list).
 *
 *   node scripts/backfill/batch-type-backfill.js                         # dry run
 *   node scripts/backfill/batch-type-backfill.js --apply --expect=150
 *
 * Exit codes: 0 ok, 1 error, 3 --expect did not match the candidate count.
 */

var backfillCli = require('./backfill');
var batchRules = require('../../lib/batch-rules');
var pgUpdate = require('../../lib/batch-pg-update');
var sheetMirror = require('../../lib/sheet-mirror');

var EXIT = backfillCli.EXIT;
var POSTGRES_URL_RE = /postgres(ql)?:\/\//;
var WEAK_SOURCES = { name: true, other: true };

// Constant SQL - no input is interpolated.
var CANDIDATES_SQL =
  'select b.batch_id, b.product_sku, b.product_name, b.recipe_id, b.recipe_snapshot, b.batch_type, ' +
  'b.batch_type_source, lower(coalesce(s.category, \'\')) as schedule_category, ' +
  'r.beer_category as recipe_beer_category, r.style as recipe_style ' +
  'from batches b ' +
  'left join ferm_schedules s on s.schedule_id = b.schedule_id ' +
  'left join recipes r on r.recipe_id = nullif(b.recipe_id, \'\') ' +
  'order by length(b.batch_id), b.batch_id';

function parseArgs(argv) {
  var opts = { apply: false, dryRun: false, expect: null, withNames: false };
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
    } else {
      throw new Error('unknown flag "' + flag + '" - valid flags: --dry-run, --apply, --expect=<n>, --with-names');
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

// Zoho cf_type index keyed by SKU and item_id (never by name, D-05).
function buildZohoIndex(items) {
  var index = {};
  (items || []).forEach(function (p) {
    if (!p) return;
    var cf = str(p.cf_type).trim();
    var sku = str(p.sku).trim();
    var itemId = str(p.item_id).trim();
    if (sku) index[sku] = cf;
    if (itemId) index[itemId] = cf;
  });
  return index;
}

function snapshotStyle(snapshot) {
  if (!snapshot) return '';
  try {
    var parsed = JSON.parse(snapshot);
    return parsed && parsed.style ? String(parsed.style) : '';
  } catch {
    return '';
  }
}

function hintsFor(r, zohoIndex) {
  var sku = str(r.product_sku).trim();
  return {
    recipeBeerCategory: str(r.recipe_beer_category),
    recipeStyle: str(r.recipe_style) || snapshotStyle(r.recipe_snapshot),
    zohoCfType: sku && zohoIndex[sku] ? zohoIndex[sku] : '',
    scheduleCategory: str(r.schedule_category)
  };
}

/** One plan entry per batch: {batch_id, sku, name, action, type, rule}. */
function planRows(rows, zohoIndex) {
  return rows.map(function (r) {
    var stored = r.batch_type_source;
    var entry = {
      batch_id: r.batch_id, sku: str(r.product_sku), name: str(r.product_name),
      action: 'unchanged', type: str(r.batch_type) || 'other', rule: stored || 'none',
      stored: stored || null
    };
    if (stored === 'manual') {
      entry.action = 'skip-manual';
      return entry;
    }
    if (stored && !WEAK_SOURCES[stored]) {
      entry.action = 'keep-' + stored;
      return entry;
    }
    var proposal = batchRules.classifyBatchType({ product_name: r.product_name }, hintsFor(r, zohoIndex));
    var differs = !stored || proposal.type !== r.batch_type || proposal.source !== stored;
    entry.type = proposal.type;
    entry.rule = proposal.source;
    entry.action = differs ? 'write' : 'unchanged';
    return entry;
  });
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
      { batch_id: entry.batch_id, updates: { batch_type: entry.type } },
      {
        trusted: true, batchTypeSource: entry.rule, expectedTypeSource: entry.stored,
        actor: 'backfill', now: now
      }
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

function logTable(plan, log) {
  var counts = {};
  var needs = 0;
  plan.forEach(function (e) {
    var key = e.type + ' ' + e.rule;
    counts[key] = (counts[key] || 0) + 1;
    if (e.type === 'other') needs++;
  });
  log('--- type x rule ---');
  Object.keys(counts).sort().forEach(function (k) { log(k + ': ' + counts[k]); });
  log('needs a type: ' + needs);
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
 * runBatchTypeBackfill(opts, deps) -> Promise<{exitCode, candidates, written, skipped}>.
 * deps: {pool, log, fetchItems, isProduction, now}.
 */
async function runBatchTypeBackfill(opts, deps) {
  deps = deps || {};
  var log = deps.log || console.log;
  var isProduction = deps.isProduction || sheetMirror.isMirrorEnabled;
  var fail = function (candidates) {
    return { exitCode: EXIT.ERROR, candidates: candidates || 0, written: 0, skipped: 0 };
  };
  try {
    // Fetch Zoho first: without it rule 2 would silently vanish, so abort before anything else.
    var items = await deps.fetchItems();
    var plan = planRows(await readRows(deps.pool), buildZohoIndex(items));
    var candidates = plan.filter(function (e) { return e.action === 'write'; });

    plan.forEach(function (e) {
      log(e.batch_id + ' ' + e.action + ' ' + e.type + ' ' + e.rule + ' ' + e.sku +
        (opts.withNames ? ' ' + JSON.stringify(e.name) : ''));
    });
    logTable(plan, log);
    log('candidates: ' + candidates.length);

    if (!opts.apply) {
      log('Dry run - no writes. Re-run with --apply --expect=' + candidates.length +
        ' after the owner OKs this list.');
      return { exitCode: EXIT.OK, candidates: candidates.length, written: 0, skipped: 0 };
    }
    if (candidates.length !== opts.expect) {
      log('Refusing to apply: candidates ' + candidates.length + ' != --expect ' + opts.expect +
        '. Re-run the dry run and re-review.');
      return { exitCode: EXIT.CHECKS_FAILED, candidates: candidates.length, written: 0, skipped: 0 };
    }

    var applyStart = deps.now ? deps.now() : new Date();
    var written = 0;
    var skipped = 0;
    for (var i = 0; i < candidates.length; i++) {
      var res = await writeOne(deps.pool, candidates[i], applyStart);
      if (res && res.ok) {
        written++;
      } else if (res && (res.error === 'manual_locked' || res.error === 'source_changed')) {
        // source_changed: upgraded (or re-set) since the read; never downgrade it (WR-04).
        log('skipped ' + candidates[i].batch_id + ' ' + res.error);
        skipped++;
      } else {
        log('Apply stopped - batch ' + candidates[i].batch_id + ' error=' + ((res && res.error) || 'unknown'));
        return { exitCode: EXIT.ERROR, candidates: candidates.length, written: written, skipped: skipped };
      }
    }
    log('written: ' + written);
    log('skipped: ' + skipped);
    logNext(log, isProduction, applyStart);
    return { exitCode: EXIT.OK, candidates: candidates.length, written: written, skipped: skipped };
  } catch (err) {
    log('Error: ' + err.message);
    return fail();
  }
}

async function bootstrapZoho() {
  var cache = require('../../lib/cache');
  var zohoAuth = require('../../lib/zohoAuth');
  await cache.init();
  await zohoAuth.init();
  if (!zohoAuth.isAuthenticated()) {
    throw new Error('Zoho is not authenticated - complete the OAuth flow first');
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
  bootstrapZoho()
    .then(function () {
      var zohoApi = require('../../lib/zoho-api');
      return runBatchTypeBackfill(opts, {
        pool: pool,
        log: console.log,
        fetchItems: function () { return zohoApi.fetchAllItems(); }
      });
    })
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
  runBatchTypeBackfill: runBatchTypeBackfill,
  parseArgs: parseArgs,
  EXIT: EXIT
};
