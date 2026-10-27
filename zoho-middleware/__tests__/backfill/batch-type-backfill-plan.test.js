'use strict';

/**
 * Tests for scripts/backfill/batch-type-backfill.js - Phase 94 Plan 06 (D-05, D-06, D-09, D-22).
 * Fake pool + mocked updateBatch + injected fetchItems: no database, Zoho or sheet is ever reached.
 */

jest.mock('../../lib/batch-pg-update');

var pgUpdate = require('../../lib/batch-pg-update');
var cli = require('../../scripts/backfill/batch-type-backfill');

var ITEMS = [{ sku: 'K1', item_id: '1', cf_type: 'Wine' }];

function row(o) {
  return Object.assign({
    batch_id: 'SV-B-000001', product_sku: '', product_name: '', recipe_id: '', recipe_snapshot: '',
    batch_type: null, batch_type_source: null, schedule_category: '', recipe_beer_category: null,
    recipe_style: null, customer_name: 'Alice Example'
  }, o);
}

function fakePool(rows) {
  var queries = [];
  var client = {
    query: jest.fn(function (sql) {
      queries.push(sql);
      if (/^(begin|begin transaction read only|commit|rollback)$/.test(sql)) return Promise.resolve({ rows: [] });
      if (/from batches b/.test(sql)) return Promise.resolve({ rows: rows });
      return Promise.reject(new Error('unexpected query: ' + sql));
    }),
    release: jest.fn()
  };
  return { queries: queries, client: client, connect: jest.fn(function () { return Promise.resolve(client); }) };
}

function run(rows, opts, extra) {
  var logs = [];
  var pool = fakePool(rows);
  var deps = Object.assign({
    pool: pool,
    log: function (m) { logs.push(m); },
    fetchItems: function () { return Promise.resolve(ITEMS); },
    isProduction: function () { return false; }
  }, extra || {});
  return cli.runBatchTypeBackfill(opts, deps).then(function (result) {
    return { result: result, logs: logs.join('\n'), pool: pool };
  });
}

beforeEach(function () {
  pgUpdate.updateBatch.mockReset();
  pgUpdate.updateBatch.mockResolvedValue({ ok: true });
});

describe('parseArgs', function () {
  it('defaults to a dry run', function () {
    expect(cli.parseArgs([]).apply).toBe(false);
    expect(cli.parseArgs(['--dry-run']).apply).toBe(false);
  });
  it('parses --apply with --expect', function () {
    var o = cli.parseArgs(['--apply', '--expect=150']);
    expect(o.apply).toBe(true);
    expect(o.expect).toBe(150);
  });
  it('requires --expect with --apply', function () {
    expect(function () { cli.parseArgs(['--apply']); }).toThrow(/--expect/);
  });
  it('rejects --dry-run with --apply', function () {
    expect(function () { cli.parseArgs(['--dry-run', '--apply', '--expect=1']); }).toThrow();
  });
  it('refuses a Postgres URL on argv', function () {
    expect(function () { cli.parseArgs(['x=postgres://u:p@h/d']); }).toThrow(/BACKFILL_DATABASE_URL/);
  });
  it('rejects unknown flags and accepts --with-names', function () {
    expect(function () { cli.parseArgs(['--bogus']); }).toThrow();
    expect(cli.parseArgs(['--with-names']).withNames).toBe(true);
  });
});

describe('dry run', function () {
  var rows = [
    row({ batch_id: 'SV-B-000001', product_sku: 'K1', product_name: 'Alice Cabernet' }),
    row({ batch_id: 'SV-B-000002', product_name: 'Hazy IPA', batch_type: 'beer', batch_type_source: 'name' }),
    row({ batch_id: 'SV-B-000003', batch_type: 'cider', batch_type_source: 'manual' }),
    row({ batch_id: 'SV-B-000004', batch_type: 'beer', batch_type_source: 'recipe', recipe_beer_category: 'ipa' }),
    row({ batch_id: 'SV-B-000005', product_name: 'Mystery' })
  ];

  it('lists every batch, a count table, and writes nothing', async function () {
    var out = await run(rows, { apply: false });
    expect(out.result.exitCode).toBe(0);
    expect(out.logs).toMatch(/SV-B-000001 write wine zoho K1/);
    expect(out.logs).toMatch(/SV-B-000002 unchanged beer name/);
    expect(out.logs).toMatch(/SV-B-000003 skip-manual cider manual/);
    expect(out.logs).toMatch(/SV-B-000004 keep-recipe beer recipe/);
    expect(out.logs).toMatch(/SV-B-000005 write other other/);
    expect(out.logs).toMatch(/needs a type: 1/);
    expect(out.logs).toMatch(/candidates: 2/);
    expect(out.logs).toMatch(/Dry run - no writes\. Re-run with --apply --expect=2/);
    expect(pgUpdate.updateBatch).not.toHaveBeenCalled();
    out.pool.queries.forEach(function (q) { expect(q).not.toMatch(/^(insert|update|delete)/i); });
  });

  it('upgrades a weak name source when zoho now says wine', async function () {
    var out = await run([
      row({ batch_id: 'SV-B-000010', product_sku: 'K1', product_name: 'Hazy IPA', batch_type: 'beer', batch_type_source: 'name' })
    ], { apply: false });
    expect(out.logs).toMatch(/SV-B-000010 write wine zoho K1/);
  });

  it('leaves an unchanged weak row alone', async function () {
    var out = await run([
      row({ batch_id: 'SV-B-000011', product_name: 'Hazy IPA', batch_type: 'beer', batch_type_source: 'name' })
    ], { apply: false });
    expect(out.logs).toMatch(/SV-B-000011 unchanged beer name/);
    expect(out.logs).toMatch(/candidates: 0/);
  });

  it('never prints customer data and prints names only with --with-names', async function () {
    var out = await run(rows, { apply: false });
    expect(out.logs).not.toMatch(/Alice Example/);
    expect(out.logs).not.toMatch(/Alice Cabernet/);
    var named = await run(rows, { apply: false, withNames: true });
    expect(named.logs).toMatch(/Alice Cabernet/);
    expect(named.logs).not.toMatch(/Alice Example/);
  });

  it('uses the recipe style from the snapshot as a fallback hint', async function () {
    var out = await run([
      row({ batch_id: 'SV-B-000012', recipe_id: 'SV-R-000001', recipe_snapshot: JSON.stringify({ style: 'Cider' }) })
    ], { apply: false });
    expect(out.logs).toMatch(/SV-B-000012 write cider recipe/);
  });

  it('exits ERROR when the Zoho item fetch fails', async function () {
    var out = await run(rows, { apply: true, expect: 3 }, {
      fetchItems: function () { return Promise.reject(new Error('zoho down')); }
    });
    expect(out.result.exitCode).toBe(1);
    expect(pgUpdate.updateBatch).not.toHaveBeenCalled();
  });
});

describe('--apply', function () {
  var rows = [
    row({ batch_id: 'SV-B-000001', product_sku: 'K1' }),
    row({ batch_id: 'SV-B-000005', product_name: 'Mystery' }),
    row({ batch_id: 'SV-B-000003', batch_type: 'cider', batch_type_source: 'manual' })
  ];

  it('writes once per candidate through the trusted channel', async function () {
    var out = await run(rows, { apply: true, expect: 2 });
    expect(out.result.exitCode).toBe(0);
    expect(pgUpdate.updateBatch).toHaveBeenCalledTimes(2);
    var call = pgUpdate.updateBatch.mock.calls[0];
    expect(call[1]).toEqual({ batch_id: 'SV-B-000001', updates: { batch_type: 'wine' } });
    expect(call[2].trusted).toBe(true);
    expect(call[2].batchTypeSource).toBe('zoho');
    expect(call[2].actor).toBe('backfill');
    expect(pgUpdate.updateBatch.mock.calls[1][2].batchTypeSource).toBe('other');
  });

  it('refuses when --expect differs from the candidate count', async function () {
    var out = await run(rows, { apply: true, expect: 5 });
    expect(out.result.exitCode).toBe(3);
    expect(pgUpdate.updateBatch).not.toHaveBeenCalled();
  });

  it('counts manual_locked as skipped, not an error', async function () {
    pgUpdate.updateBatch.mockResolvedValueOnce({ ok: false, error: 'manual_locked' });
    var out = await run(rows, { apply: true, expect: 2 });
    expect(out.result.exitCode).toBe(0);
    expect(out.logs).toMatch(/written: 1/);
    expect(out.logs).toMatch(/skipped: 1/);
  });

  it('prints the replay step only on production', async function () {
    var prod = await run(rows, { apply: true, expect: 2 }, { isProduction: function () { return true; } });
    expect(prod.logs).toMatch(/Next: node scripts\/backfill\/batches-replay-to-sheet\.js --since=\S+ --apply/);
    expect(prod.logs).toMatch(/batches-verify/);
    var staging = await run(rows, { apply: true, expect: 2 });
    expect(staging.logs).not.toMatch(/batches-replay-to-sheet/);
    expect(staging.logs).toMatch(/Staging: no sheet replay \(staging never mirrors\)\. Next: node scripts\/backfill\/batch-cycle-recompute\.js/);
  });
});
