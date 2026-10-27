'use strict';

/**
 * Real-Postgres test for scripts/backfill/completed-at-backfill.js - Phase 94 Plan 06.
 * Testcontainers only; no live database or sheet is reached.
 */

var pgHarness = require('./helpers/pg-harness');
var describeDb = pgHarness.describeDb;

var T0 = new Date('2026-10-01T10:00:00.000Z');
var LATE = new Date('2026-10-05T20:00:00.000Z');
var EARLY = new Date('2026-10-03T20:00:00.000Z');

describeDb('completed-at-backfill against real Postgres', function () {
  var container;
  var pool;
  var cli;
  var taskSeq = 0;

  beforeAll(async function () {
    var started = await pgHarness.startPostgres();
    container = started.container;
    var migrateResult = pgHarness.applyMigrations(started.connectionString);
    if (migrateResult.code !== 0) {
      throw new Error('applyMigrations failed: ' + migrateResult.stderr);
    }
    jest.resetModules();
    var db = require('../../lib/db');
    cli = require('../../scripts/backfill/completed-at-backfill');
    pool = db.createPool(started.connectionString);
  }, 120000);

  afterAll(async function () {
    if (pool) await pool.end();
    if (container) await container.stop();
  }, 60000);

  async function seedBatch(id, status, completedAt) {
    await pool.query(
      'insert into batches (batch_id, status, access_token, created_at, last_updated, start_date, completed_at) ' +
      'values ($1, $2, $3, $4, $4, \'2026-10-01\', $5)',
      [id, status, id.replace(/\D/g, '').padStart(32, 'f'), T0, completedAt || null]
    );
  }

  async function seedTask(batchId, completed, at) {
    taskSeq += 1;
    await pool.query(
      'insert into batch_tasks (task_id, batch_id, step_number, day_offset, completed, completed_at, last_updated) ' +
      'values ($1, $2, 1, 0, $3, $4, $5)',
      ['BT-9' + String(taskSeq).padStart(5, '0'), batchId, completed, at, T0]
    );
  }

  async function row(id) {
    return (await pool.query(
      'select completed_at, completed_at_source from batches where batch_id = $1', [id]
    )).rows[0];
  }

  it('fills from the latest completed task, leaves the rest blank', async function () {
    await seedBatch('SV-B-800001', 'complete');
    await seedTask('SV-B-800001', true, EARLY);
    await seedTask('SV-B-800001', true, LATE);
    await seedTask('SV-B-800001', false, null);
    await seedBatch('SV-B-800002', 'complete');
    await seedBatch('SV-B-800003', 'complete', new Date('2026-10-04T00:00:00Z'));
    await seedBatch('SV-B-800004', 'primary');
    await seedTask('SV-B-800004', true, LATE);

    var logs = [];
    var deps = {
      pool: pool,
      log: function (m) { logs.push(m); },
      isProduction: function () { return false; }
    };

    var dry = await cli.runCompletedAtBackfill({ apply: false }, deps);
    expect(dry.exitCode).toBe(0);
    expect(dry.candidates).toBe(2);
    expect(dry.willFill).toBe(1);
    expect((await row('SV-B-800001')).completed_at).toBeNull();

    var res = await cli.runCompletedAtBackfill({ apply: true, expect: 1 }, deps);
    expect(res.exitCode).toBe(0);
    expect(res.written).toBe(1);

    var filled = await row('SV-B-800001');
    expect(filled.completed_at.toISOString()).toBe(LATE.toISOString());
    expect(filled.completed_at_source).toBe('backfill-task');
    expect((await row('SV-B-800002')).completed_at).toBeNull();
    expect((await row('SV-B-800003')).completed_at_source).toBeNull();
    expect((await row('SV-B-800004')).completed_at).toBeNull();
  });
});
