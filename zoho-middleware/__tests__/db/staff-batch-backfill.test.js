'use strict';

/**
 * Real-Postgres test for scripts/backfill/staff-batch-backfill.js - Phase 95 Plan 02.
 * Testcontainers only.
 */

var pgHarness = require('./helpers/pg-harness');
var describeDb = pgHarness.describeDb;

var T0 = new Date('2026-10-01T10:00:00.000Z');

describeDb('staff-batch-backfill against real Postgres', function () {
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
    cli = require('../../scripts/backfill/staff-batch-backfill');
    pool = db.createPool(started.connectionString);
  }, 120000);

  afterAll(async function () {
    if (pool) await pool.end();
    if (container) await container.stop();
  }, 60000);

  async function seed(id, o) {
    await pool.query(
      'insert into batches (batch_id, status, access_token, created_at, last_updated, source, ' +
      'customer_name, customer_firstname, customer_lastname) ' +
      'values ($1, \'primary\', $2, $3, $3, $4, $5, $6, $7)',
      [id, id.replace(/\D/g, '').padStart(32, 'd'), T0, o.source || '', o.name || '',
        o.first || '', o.last || '']
    );
  }

  async function row(id) {
    return (await pool.query('select staff_batch, last_updated from batches where batch_id = $1', [id])).rows[0];
  }

  it('flags only true candidates, keeps last_updated, and is idempotent', async function () {
    await seed('SV-B-800001', { source: 'internal' });
    await seed('SV-B-800002', { source: ' Research ' });
    await seed('SV-B-800003', { name: 'Koa Inn' });
    await seed('SV-B-800004', { last: 'MCLACHLAN', first: 'Jo' });
    await seed('SV-B-800005', { name: 'Dinner' });
    await seed('SV-B-800006', { name: 'Winn' });
    await seed('SV-B-800007', { name: 'Innes' });
    await seed('SV-B-800008', { name: 'McLachlane' });
    await seed('SV-B-800009', { source: 'customer', name: 'Alice Example' });

    var logs = [];
    var deps = { pool: pool, log: function (m) { logs.push(m); }, isProduction: function () { return false; } };

    var dry = await cli.runStaffBackfill({ apply: false }, deps);
    expect(dry.exitCode).toBe(0);
    expect(dry.candidates).toBe(4);
    expect((await row('SV-B-800001')).staff_batch).toBe(false);
    expect(logs.join('\n')).not.toMatch(/Koa Inn|Alice/);

    var refused = await cli.runStaffBackfill({ apply: true, expect: 3 }, deps);
    expect(refused.exitCode).toBe(3);
    expect((await row('SV-B-800001')).staff_batch).toBe(false);

    var res = await cli.runStaffBackfill({ apply: true, expect: 4 }, deps);
    expect(res.exitCode).toBe(0);
    expect(res.written).toBe(4);

    for (var id of ['SV-B-800001', 'SV-B-800002', 'SV-B-800003', 'SV-B-800004']) {
      var r = await row(id);
      expect(r.staff_batch).toBe(true);
      expect(r.last_updated.getTime()).toBe(T0.getTime());
    }
    for (var no of ['SV-B-800005', 'SV-B-800006', 'SV-B-800007', 'SV-B-800008', 'SV-B-800009']) {
      expect((await row(no)).staff_batch).toBe(false);
    }

    var again = await cli.runStaffBackfill({ apply: false }, deps);
    expect(again.candidates).toBe(0);
  });
});
