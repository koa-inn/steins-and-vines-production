'use strict';

/**
 * Tests for scripts/backfill/completed-at-backfill.js - Phase 94 Plan 06 (D-14, D-15, D-16).
 * Fake pool + mocked updateBatch: no database is ever reached.
 */

jest.mock('../../lib/batch-pg-update');

var pgUpdate = require('../../lib/batch-pg-update');
var cli = require('../../scripts/backfill/completed-at-backfill');

function row(o) {
  return Object.assign({
    batch_id: 'SV-B-000001', start_date: '2026-09-01',
    latest_task_completed_at: null, latest_task_day: null,
    customer_name: 'Alice Example', last_updated: new Date('2026-10-20T00:00:00Z')
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
    isProduction: function () { return false; }
  }, extra || {});
  return cli.runCompletedAtBackfill(opts, deps).then(function (result) {
    return { result: result, logs: logs.join('\n'), pool: pool };
  });
}

var ROWS = [
  row({ batch_id: 'SV-B-000001', latest_task_completed_at: new Date('2026-09-20T17:00:00Z'), latest_task_day: '2026-09-20' }),
  row({ batch_id: 'SV-B-000002' }),
  row({ batch_id: 'SV-B-000003', start_date: '2026-09-25', latest_task_completed_at: new Date('2026-09-20T17:00:00Z'), latest_task_day: '2026-09-20' })
];

beforeEach(function () {
  pgUpdate.updateBatch.mockReset();
  pgUpdate.updateBatch.mockResolvedValue({ ok: true });
});

describe('parseArgs', function () {
  it('defaults to a dry run', function () {
    expect(cli.parseArgs([]).apply).toBe(false);
    expect(cli.parseArgs(['--dry-run']).apply).toBe(false);
  });
  it('parses --apply with --expect and requires it', function () {
    expect(cli.parseArgs(['--apply', '--expect=2'])).toMatchObject({ apply: true, expect: 2 });
    expect(function () { cli.parseArgs(['--apply']); }).toThrow(/--expect/);
  });
  it('rejects --dry-run with --apply, URLs and unknown flags', function () {
    expect(function () { cli.parseArgs(['--dry-run', '--apply', '--expect=1']); }).toThrow();
    expect(function () { cli.parseArgs(['postgresql://u:p@h/d']); }).toThrow(/BACKFILL_DATABASE_URL/);
    expect(function () { cli.parseArgs(['--bogus']); }).toThrow();
  });
});

describe('dry run', function () {
  it('lists every candidate with its proposal and summary counts, writing nothing', async function () {
    var out = await run(ROWS, { apply: false });
    expect(out.result.exitCode).toBe(0);
    expect(out.logs).toMatch(/SV-B-000001 2026-09-20T17:00:00\.000Z backfill-task/);
    expect(out.logs).toMatch(/SV-B-000002 stays-blank/);
    expect(out.logs).toMatch(/candidates: 3/);
    expect(out.logs).toMatch(/will fill: 2/);
    expect(out.logs).toMatch(/stay blank: 1/);
    expect(out.logs).toMatch(/before start_date: 1/);
    expect(out.logs).toMatch(/Dry run - no writes\. Re-run with --apply --expect=2/);
    expect(pgUpdate.updateBatch).not.toHaveBeenCalled();
  });

  it('never reads last_updated and never prints customer data', async function () {
    var out = await run(ROWS, { apply: false });
    expect(out.logs).not.toMatch(/Alice Example/);
    expect(out.logs).not.toMatch(/2026-10-20/);
    out.pool.queries.forEach(function (q) { expect(q).not.toMatch(/last_updated/); });
  });
});

describe('--apply', function () {
  it('writes each fillable batch through the trusted channel', async function () {
    var out = await run(ROWS, { apply: true, expect: 2 });
    expect(out.result.exitCode).toBe(0);
    expect(pgUpdate.updateBatch).toHaveBeenCalledTimes(2);
    var call = pgUpdate.updateBatch.mock.calls[0];
    expect(call[1]).toEqual({ batch_id: 'SV-B-000001', updates: { completed_at: '2026-09-20T17:00:00.000Z' } });
    expect(call[2].trusted).toBe(true);
    expect(call[2].completedAtSource).toBe('backfill-task');
    expect(call[2].actor).toBe('backfill');
    expect(out.logs).toMatch(/ticked late/);
  });

  it('refuses when --expect differs and writes nothing', async function () {
    var out = await run(ROWS, { apply: true, expect: 3 });
    expect(out.result.exitCode).toBe(3);
    expect(pgUpdate.updateBatch).not.toHaveBeenCalled();
  });

  it('counts already_set as skipped', async function () {
    pgUpdate.updateBatch.mockResolvedValueOnce({ ok: false, error: 'already_set' });
    var out = await run(ROWS, { apply: true, expect: 2 });
    expect(out.result.exitCode).toBe(0);
    expect(out.logs).toMatch(/written: 1/);
    expect(out.logs).toMatch(/skipped: 1/);
  });

  it('prints the replay step only on production', async function () {
    var prod = await run(ROWS, { apply: true, expect: 2 }, { isProduction: function () { return true; } });
    expect(prod.logs).toMatch(/Next: node scripts\/backfill\/batches-replay-to-sheet\.js --since=\S+ --apply/);
    var staging = await run(ROWS, { apply: true, expect: 2 });
    expect(staging.logs).not.toMatch(/batches-replay-to-sheet/);
    expect(staging.logs).toMatch(/Staging: no sheet replay \(staging never mirrors\)\. Next: node scripts\/backfill\/batch-cycle-recompute\.js/);
  });
});
