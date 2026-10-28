'use strict';

/**
 * Tests for scripts/backfill/staff-batch-backfill.js - Phase 95 Plan 02 (D-09, D-18).
 * Fake pool + mocked setStaffBatch: no database is reached.
 */

jest.mock('../../lib/batch-pg-update');

var pgUpdate = require('../../lib/batch-pg-update');
var cli = require('../../scripts/backfill/staff-batch-backfill');

function row(o) {
  return Object.assign({
    batch_id: 'SV-B-000001', status: 'primary', source: '', customer_name: '',
    customer_firstname: '', customer_lastname: ''
  }, o);
}

function fakePool(rows, lockedFlag) {
  var queries = [];
  var client = {
    query: jest.fn(function (sql) {
      queries.push(sql);
      if (/^(begin|begin transaction read only|commit|rollback)$/.test(sql)) return Promise.resolve({ rows: [] });
      if (/for update/.test(sql)) return Promise.resolve({ rows: [{ staff_batch: !!lockedFlag }] });
      if (/from batches where staff_batch = false/.test(sql)) return Promise.resolve({ rows: rows });
      return Promise.reject(new Error('unexpected query: ' + sql));
    }),
    release: jest.fn()
  };
  return { queries: queries, client: client, connect: jest.fn(function () { return Promise.resolve(client); }) };
}

function run(rows, opts, lockedFlag) {
  var logs = [];
  var pool = fakePool(rows, lockedFlag);
  return cli.runStaffBackfill(opts, {
    pool: pool, log: function (m) { logs.push(m); }, isProduction: function () { return false; }
  }).then(function (result) { return { result: result, logs: logs.join('\n'), pool: pool }; });
}

var ROWS = [
  row({ batch_id: 'SV-B-000001', source: 'Internal' }),
  row({ batch_id: 'SV-B-000002', customer_name: 'Koa Inn' }),
  row({ batch_id: 'SV-B-000003', customer_lastname: 'MCLACHLAN', customer_firstname: 'Jo' })
];

beforeEach(function () {
  pgUpdate.setStaffBatch.mockReset();
  pgUpdate.setStaffBatch.mockResolvedValue(1);
});

describe('parseArgs', function () {
  it('defaults to a dry run', function () {
    expect(cli.parseArgs([]).apply).toBe(false);
  });
  it('refuses a postgres URL on argv', function () {
    expect(function () { cli.parseArgs(['x=postgres://u:p@h/d']); }).toThrow(/BACKFILL_DATABASE_URL/);
  });
  it('requires --expect with --apply and rejects --expect alone', function () {
    expect(function () { cli.parseArgs(['--apply']); }).toThrow(/--expect/);
    expect(function () { cli.parseArgs(['--expect=1']); }).toThrow(/--apply/);
  });
  it('rejects --dry-run with --apply', function () {
    expect(function () { cli.parseArgs(['--dry-run', '--apply', '--expect=1']); }).toThrow();
  });
});

describe('CANDIDATES_SQL', function () {
  it('is parameterised, never interpolated', function () {
    expect(cli.CANDIDATES_SQL).toMatch(/\$1/);
    expect(cli.CANDIDATES_SQL).toMatch(/\$2/);
    expect(cli.CANDIDATES_SQL).toMatch(/\$3/);
    expect(cli.CANDIDATES_SQL).not.toMatch(/mclachlan/i);
  });
});

describe('dry run', function () {
  it('lists candidates with reasons and fields, writes nothing', async function () {
    var out = await run(ROWS, { apply: false });
    expect(out.result.exitCode).toBe(0);
    expect(out.logs).toMatch(/SV-B-000001 primary Internal source:internal\(source\)/);
    expect(out.logs).toMatch(/SV-B-000002 primary \(blank\) name:Inn\(customer_name\)/);
    expect(out.logs).toMatch(/SV-B-000003 .*name:McLachlan\(customer_lastname\)/);
    expect(out.logs).toMatch(/candidates: 3/);
    expect(out.logs).toMatch(/name:Inn: 1/);
    expect(pgUpdate.setStaffBatch).not.toHaveBeenCalled();
    out.pool.queries.forEach(function (q) { expect(q).not.toMatch(/^(insert|update|delete)/i); });
  });

  it('prints customer names only with --with-names', async function () {
    var out = await run(ROWS, { apply: false });
    expect(out.logs).not.toMatch(/Koa Inn/);
    expect(out.logs).not.toMatch(/MCLACHLAN/);
    var named = await run(ROWS, { apply: false, withNames: true });
    expect(named.logs).toMatch(/Koa Inn/);
  });
});

describe('--apply', function () {
  it('exits 3 with zero writes when --expect differs', async function () {
    var out = await run(ROWS, { apply: true, expect: 5 });
    expect(out.result.exitCode).toBe(3);
    expect(pgUpdate.setStaffBatch).not.toHaveBeenCalled();
  });

  it('locks, writes via setStaffBatch and logs the staging next step', async function () {
    var out = await run(ROWS, { apply: true, expect: 3 });
    expect(out.result).toEqual({ exitCode: 0, candidates: 3, written: 3, skipped: 0 });
    expect(pgUpdate.setStaffBatch).toHaveBeenCalledTimes(3);
    expect(pgUpdate.setStaffBatch.mock.calls[0][1]).toBe('SV-B-000001');
    expect(pgUpdate.setStaffBatch.mock.calls[0][2]).toBe(true);
    expect(out.pool.queries.some(function (q) { return /for update/.test(q); })).toBe(true);
    expect(out.logs).toMatch(/staging: no verify \(staging never mirrors\)/);
  });

  it('counts a row flagged under the lock as skipped', async function () {
    var out = await run(ROWS, { apply: true, expect: 3 }, true);
    expect(out.result.written).toBe(0);
    expect(out.result.skipped).toBe(3);
    expect(pgUpdate.setStaffBatch).not.toHaveBeenCalled();
  });

  it('stops with exit 1 on a write error', async function () {
    pgUpdate.setStaffBatch.mockRejectedValueOnce(new Error('boom'));
    var out = await run(ROWS, { apply: true, expect: 3 });
    expect(out.result.exitCode).toBe(1);
    expect(out.result.written).toBe(0);
  });
});
