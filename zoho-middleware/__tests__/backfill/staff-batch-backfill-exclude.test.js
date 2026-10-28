'use strict';

/**
 * --exclude for scripts/backfill/staff-batch-backfill.js (Phase 95, 95-09 owner review).
 * The owner can drop name matches that are paying customers from the reviewed list, so the
 * apply writes exactly the approved set. Fake pool + mocked setStaffBatch: no database.
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

function fakePool(rows) {
  var client = {
    query: jest.fn(function (sql) {
      if (/^(begin|begin transaction read only|commit|rollback)$/.test(sql)) return Promise.resolve({ rows: [] });
      if (/for update/.test(sql)) return Promise.resolve({ rows: [{ staff_batch: false }] });
      if (/from batches where staff_batch = false/.test(sql)) return Promise.resolve({ rows: rows });
      return Promise.reject(new Error('unexpected query: ' + sql));
    }),
    release: jest.fn()
  };
  return { connect: jest.fn(function () { return Promise.resolve(client); }) };
}

function run(rows, opts) {
  var logs = [];
  return cli.runStaffBackfill(opts, {
    pool: fakePool(rows), log: function (m) { logs.push(m); }, isProduction: function () { return false; }
  }).then(function (result) { return { result: result, logs: logs.join('\n') }; });
}

var ROWS = [
  row({ batch_id: 'SV-B-000007', customer_name: 'Inn, Koa' }),
  row({ batch_id: 'SV-B-000025', customer_name: 'McLachlan, Katie' }),
  row({ batch_id: 'SV-B-000036', customer_name: 'McLachlan, Paul' }),
  row({ batch_id: 'SV-B-000238', source: 'internal', customer_name: 'Customer, Wayne' })
];

beforeEach(function () {
  pgUpdate.setStaffBatch.mockReset();
  pgUpdate.setStaffBatch.mockResolvedValue(1);
});

describe('parseArgs --exclude', function () {
  it('parses a comma list of batch ids, trimmed and de-duplicated', function () {
    expect(cli.parseArgs(['--exclude=SV-B-000025, SV-B-000238,SV-B-000025']).exclude)
      .toEqual(['SV-B-000025', 'SV-B-000238']);
  });
  it('defaults to no exclusions', function () {
    expect(cli.parseArgs([]).exclude).toEqual([]);
  });
  it('rejects an empty value or a malformed id', function () {
    expect(function () { cli.parseArgs(['--exclude=']); }).toThrow(/--exclude/);
    expect(function () { cli.parseArgs(['--exclude=SV-B-25;drop']); }).toThrow(/--exclude/);
    expect(function () { cli.parseArgs(['--exclude']); }).toThrow();
  });
});

describe('runStaffBackfill with --exclude', function () {
  it('dry run drops excluded ids from the candidate list and count', function () {
    return run(ROWS, { apply: false, exclude: ['SV-B-000025', 'SV-B-000238'] }).then(function (o) {
      expect(o.result.candidates).toBe(2);
      expect(o.logs).toMatch(/excluded SV-B-000025 owner_review/);
      expect(o.logs).toMatch(/excluded SV-B-000238 owner_review/);
      expect(o.logs).not.toMatch(/^SV-B-000025 /m);
      expect(o.logs).toMatch(/candidates: 2/);
      expect(o.logs).toMatch(/--exclude=SV-B-000025,SV-B-000238 --expect=2/);
    });
  });

  it('apply writes only the non-excluded candidates when --expect matches', function () {
    return run(ROWS, { apply: true, expect: 2, exclude: ['SV-B-000025', 'SV-B-000238'] }).then(function (o) {
      expect(o.result).toEqual({ exitCode: 0, candidates: 2, written: 2, skipped: 0 });
      var ids = pgUpdate.setStaffBatch.mock.calls.map(function (c) { return c[1]; });
      expect(ids).toEqual(['SV-B-000007', 'SV-B-000036']);
    });
  });

  it('apply refuses (exit 3) when --expect counts the excluded rows', function () {
    return run(ROWS, { apply: true, expect: 4, exclude: ['SV-B-000025', 'SV-B-000238'] }).then(function (o) {
      expect(o.result.exitCode).toBe(cli.EXIT.CHECKS_FAILED);
      expect(pgUpdate.setStaffBatch).not.toHaveBeenCalled();
    });
  });

  it('refuses (exit 1, no writes) when an excluded id is not a candidate - catches typos', function () {
    return run(ROWS, { apply: true, expect: 3, exclude: ['SV-B-000099'] }).then(function (o) {
      expect(o.result.exitCode).toBe(cli.EXIT.ERROR);
      expect(o.logs).toMatch(/SV-B-000099 is not a candidate/);
      expect(pgUpdate.setStaffBatch).not.toHaveBeenCalled();
    });
  });
});
