'use strict';

/**
 * Tests for scripts/backfill/batch-cycle-recompute.js - Phase 94 Plan 13 (D-13, D-24).
 * Fake pool only: no real database is ever touched.
 */

var recompute = require('../../scripts/backfill/batch-cycle-recompute');

function fakePool(opts) {
  opts = opts || {};
  var queries = [];
  var params = [];
  var client = {
    query: jest.fn(function (sql, p) {
      queries.push(sql);
      params.push(p);
      if (/^(begin transaction read only|commit|rollback)$/.test(sql)) return Promise.resolve({ rows: [] });
      if (/group by coalesce/.test(sql)) {
        return Promise.resolve({ rows: opts.byType || [
          { batch_type: 'beer', n: '4', median: '14.5', mean: '15.25' },
          { batch_type: 'unclassified', n: '1', median: '20', mean: '20' }
        ] });
      }
      if (/percentile_cont/.test(sql)) {
        return Promise.resolve({ rows: [opts.total || { n: '5', median: '15', mean: '16.2' }] });
      }
      if (/as excluded/.test(sql)) return Promise.resolve({ rows: [{ excluded: '2' }] });
      if (/null_batch_type/.test(sql)) {
        return Promise.resolve({ rows: [{ null_batch_type: '3', needs_a_type: '7' }] });
      }
      return Promise.reject(new Error('unexpected query: ' + sql));
    }),
    release: jest.fn()
  };
  return { queries: queries, params: params, client: client, connect: jest.fn(function () { return Promise.resolve(client); }) };
}

describe('parseArgs', function () {
  it('defaults to the current Vancouver year and accepts --year', function () {
    expect(recompute.parseArgs([]).year).toBeGreaterThanOrEqual(2026);
    expect(recompute.parseArgs(['--year=2026']).year).toBe(2026);
  });

  it('refuses Postgres URLs, unknown flags and a bad year', function () {
    expect(function () { recompute.parseArgs(['--x=postgres://u:p@h/d']); }).toThrow(/BACKFILL_DATABASE_URL/);
    expect(function () { recompute.parseArgs(['--apply']); }).toThrow(/unknown flag/);
    expect(function () { recompute.parseArgs(['--year=abc']); }).toThrow(/--year/);
  });
});

describe('runCycleRecompute', function () {
  it('returns whole-day stats, per-type rows and type-coverage counts', async function () {
    var pool = fakePool();
    var logs = [];
    var res = await recompute.runCycleRecompute({ year: 2026 }, { pool: pool, log: function (m) { logs.push(m); } });
    expect(res.exitCode).toBe(recompute.EXIT.OK);
    expect(res.n).toBe(5);
    expect(res.excluded).toBe(2);
    expect(res.median).toBe(15);
    expect(res.mean).toBe(16);
    expect(res.byType).toEqual([
      { type: 'beer', n: 4, median: 15, mean: 15 },
      { type: 'unclassified', n: 1, median: 20, mean: 20 }
    ]);
    expect(res.null_batch_type).toBe(3);
    expect(res.needs_a_type).toBe(7);
    var out = logs.join('\n');
    expect(out).toMatch(/null_batch_type: 3/);
    expect(out).toMatch(/needs_a_type: 7/);
  });

  it('binds the year as a parameter inside a read-only transaction', async function () {
    var pool = fakePool();
    await recompute.runCycleRecompute({ year: 2026 }, { pool: pool, log: function () {} });
    expect(pool.queries[0]).toBe('begin transaction read only');
    expect(pool.queries[pool.queries.length - 1]).toBe('commit');
    var bound = pool.queries.map(function (s, i) { return [s, pool.params[i]]; })
      .filter(function (x) { return /percentile_cont|as excluded/.test(x[0]); });
    expect(bound.length).toBeGreaterThan(0);
    bound.forEach(function (x) {
      expect(x[1]).toEqual([2026]);
      expect(x[0]).not.toMatch(/2026/);
      expect(x[0]).toMatch(/America\/Vancouver/);
    });
  });

  it('logs counts only, never ids', async function () {
    var logs = [];
    await recompute.runCycleRecompute({ year: 2026 }, { pool: fakePool(), log: function (m) { logs.push(m); } });
    expect(logs.join('\n')).not.toMatch(/SV-B-/);
  });

  it('returns an error exit code and rolls back on failure', async function () {
    var pool = fakePool();
    pool.client.query.mockImplementation(function (sql) {
      if (/^begin/.test(sql) || /rollback/.test(sql)) return Promise.resolve({ rows: [] });
      return Promise.reject(new Error('boom'));
    });
    var res = await recompute.runCycleRecompute({ year: 2026 }, { pool: pool, log: function () {} });
    expect(res.exitCode).toBe(recompute.EXIT.ERROR);
    expect(pool.client.release).toHaveBeenCalled();
  });
});
