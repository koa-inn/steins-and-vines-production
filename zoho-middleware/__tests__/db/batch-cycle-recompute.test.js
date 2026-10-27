'use strict';

/**
 * Real-Postgres test for scripts/backfill/batch-cycle-recompute.js - Phase 94 Plan 13.
 * Testcontainers only; no live database is reached.
 */

var pgHarness = require('./helpers/pg-harness');
var describeDb = pgHarness.describeDb;

describeDb('batch-cycle-recompute against real Postgres', function () {
  var container;
  var pool;
  var cli;

  beforeAll(async function () {
    var started = await pgHarness.startPostgres();
    container = started.container;
    var migrateResult = pgHarness.applyMigrations(started.connectionString);
    if (migrateResult.code !== 0) {
      throw new Error('applyMigrations failed: ' + migrateResult.stderr);
    }
    jest.resetModules();
    var db = require('../../lib/db');
    cli = require('../../scripts/backfill/batch-cycle-recompute');
    pool = db.createPool(started.connectionString);
  }, 120000);

  afterAll(async function () {
    if (pool) await pool.end();
    if (container) await container.stop();
  }, 60000);

  var seq = 0;
  async function seed(status, start, completedAt, type, source) {
    seq += 1;
    var id = 'SV-B-9' + String(seq).padStart(5, '0');
    await pool.query(
      'insert into batches (batch_id, status, access_token, created_at, last_updated, start_date, completed_at, batch_type, batch_type_source) ' +
      'values ($1, $2, $3, now(), now(), $4, $5, $6, $7)',
      [id, status, String(seq).padStart(32, 'e'), start, completedAt, type, source]
    );
  }

  it('computes Vancouver-day median/mean, exclusions and type coverage', async function () {
    // 10 days (UTC date is Jan 12 but Vancouver date is Jan 11), 20 days, 30 days.
    await seed('complete', '2026-01-01', '2026-01-12T03:00:00Z', 'beer', 'recipe');
    await seed('complete', '2026-01-01', '2026-01-21T18:00:00Z', 'beer', 'recipe');
    await seed('complete', '2026-01-01', '2026-01-31T18:00:00Z', null, null);
    // excluded: complete but no completed_at
    await seed('complete', '2026-02-01', null, 'other', 'other');
    // not complete: not counted anywhere in cycle stats
    await seed('primary', '2026-02-01', null, 'other', 'manual');

    var res = await cli.runCycleRecompute({ year: 2026 }, { pool: pool, log: function () {} });
    expect(res.exitCode).toBe(cli.EXIT.OK);
    expect(res.n).toBe(3);
    expect(res.median).toBe(20);
    expect(res.mean).toBe(20);
    expect(res.excluded).toBe(1);
    expect(res.null_batch_type).toBe(1);
    expect(res.needs_a_type).toBe(1);
    var beer = res.byType.filter(function (r) { return r.type === 'beer'; })[0];
    expect(beer).toEqual({ type: 'beer', n: 2, median: 15, mean: 15 });
    var unc = res.byType.filter(function (r) { return r.type === 'unclassified'; })[0];
    expect(unc.n).toBe(1);
  });
});
