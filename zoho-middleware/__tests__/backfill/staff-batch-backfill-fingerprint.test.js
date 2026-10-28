'use strict';

/**
 * --expect-ids for scripts/backfill/staff-batch-backfill.js (Phase 95 review WR-04).
 * --expect=N alone only checks the count: if one reviewed candidate drops out and a new row
 * appears between the dry run and the apply, the count still matches and an unreviewed row is
 * written. The dry run prints a fingerprint of the exact id set (after --exclude) and --apply
 * must repeat it. Fake pool + mocked setStaffBatch: no database.
 */

jest.mock('../../lib/batch-pg-update');

var crypto = require('crypto');
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

function expectedFp(ids) {
  return crypto.createHash('sha256').update(ids.slice().sort().join(',')).digest('hex').slice(0, 12);
}

var REVIEWED = [
  row({ batch_id: 'SV-B-000007', customer_name: 'Inn, Koa' }),
  row({ batch_id: 'SV-B-000025', customer_name: 'McLachlan, Katie' }),
  row({ batch_id: 'SV-B-000036', customer_name: 'McLachlan, Paul' })
];
// Same count, different set: SV-B-000036 was flagged by hand, a new customer matched.
var DRIFTED = [
  row({ batch_id: 'SV-B-000007', customer_name: 'Inn, Koa' }),
  row({ batch_id: 'SV-B-000025', customer_name: 'McLachlan, Katie' }),
  row({ batch_id: 'SV-B-000400', customer_name: 'Inn, New Customer' })
];

beforeEach(function () {
  pgUpdate.setStaffBatch.mockReset();
  pgUpdate.setStaffBatch.mockResolvedValue(1);
});

describe('fingerprintIds', function () {
  it('is the first 12 hex of sha256 over the sorted, comma-joined ids', function () {
    expect(cli.fingerprintIds(['SV-B-000036', 'SV-B-000007'])).toBe(expectedFp(['SV-B-000007', 'SV-B-000036']));
    expect(cli.fingerprintIds(['SV-B-000036', 'SV-B-000007'])).toBe(cli.fingerprintIds(['SV-B-000007', 'SV-B-000036']));
    expect(cli.fingerprintIds(['SV-B-000007'])).toMatch(/^[0-9a-f]{12}$/);
    expect(cli.fingerprintIds(['SV-B-000007'])).not.toBe(cli.fingerprintIds(['SV-B-000008']));
  });
});

describe('parseArgs --expect-ids', function () {
  it('parses a 12-hex fingerprint alongside --apply --expect', function () {
    var o = cli.parseArgs(['--apply', '--expect=3', '--expect-ids=0123456789ab']);
    expect(o.expect).toBe(3);
    expect(o.expectIds).toBe('0123456789ab');
  });
  it('--apply requires --expect-ids', function () {
    expect(function () { cli.parseArgs(['--apply', '--expect=3']); }).toThrow(/--expect-ids/);
  });
  it('--expect-ids is only valid with --apply', function () {
    expect(function () { cli.parseArgs(['--expect-ids=0123456789ab']); }).toThrow(/--apply/);
  });
  it('rejects a malformed fingerprint', function () {
    expect(function () { cli.parseArgs(['--apply', '--expect=3', '--expect-ids=xyz']); }).toThrow();
    expect(function () { cli.parseArgs(['--apply', '--expect=3', '--expect-ids']); }).toThrow();
  });
  it('still works with --exclude', function () {
    var o = cli.parseArgs(['--apply', '--exclude=SV-B-000025', '--expect=2', '--expect-ids=0123456789ab']);
    expect(o.exclude).toEqual(['SV-B-000025']);
    expect(o.expectIds).toBe('0123456789ab');
  });
});

describe('runStaffBackfill fingerprint', function () {
  it('dry run prints the fingerprint and the full apply command', function () {
    return run(REVIEWED, { apply: false }).then(function (o) {
      var fp = expectedFp(['SV-B-000007', 'SV-B-000025', 'SV-B-000036']);
      expect(o.logs).toMatch(new RegExp('fingerprint: ' + fp));
      expect(o.logs).toMatch(new RegExp('--apply --expect=3 --expect-ids=' + fp));
    });
  });

  it('dry run fingerprint is taken after --exclude', function () {
    return run(REVIEWED, { apply: false, exclude: ['SV-B-000025'] }).then(function (o) {
      var fp = expectedFp(['SV-B-000007', 'SV-B-000036']);
      expect(o.logs).toMatch(new RegExp('fingerprint: ' + fp));
      expect(o.logs).toMatch(new RegExp('--exclude=SV-B-000025 --expect=2 --expect-ids=' + fp));
    });
  });

  it('apply writes when count and fingerprint both match', function () {
    var fp = expectedFp(['SV-B-000007', 'SV-B-000025', 'SV-B-000036']);
    return run(REVIEWED, { apply: true, expect: 3, expectIds: fp }).then(function (o) {
      expect(o.result).toEqual({ exitCode: 0, candidates: 3, written: 3, skipped: 0 });
    });
  });

  it('apply refuses (exit 3, no writes) when the set changed but the count did not', function () {
    var fp = expectedFp(['SV-B-000007', 'SV-B-000025', 'SV-B-000036']);
    return run(DRIFTED, { apply: true, expect: 3, expectIds: fp }).then(function (o) {
      expect(o.result.exitCode).toBe(cli.EXIT.CHECKS_FAILED);
      expect(o.result.written).toBe(0);
      expect(o.logs).toMatch(/fingerprint/);
      expect(pgUpdate.setStaffBatch).not.toHaveBeenCalled();
    });
  });

  it('apply with --exclude matches the fingerprint of the remaining set', function () {
    var fp = expectedFp(['SV-B-000007', 'SV-B-000036']);
    return run(REVIEWED, { apply: true, expect: 2, expectIds: fp, exclude: ['SV-B-000025'] }).then(function (o) {
      expect(o.result).toEqual({ exitCode: 0, candidates: 2, written: 2, skipped: 0 });
      var ids = pgUpdate.setStaffBatch.mock.calls.map(function (c) { return c[1]; });
      expect(ids).toEqual(['SV-B-000007', 'SV-B-000036']);
    });
  });
});
