'use strict';

/**
 * Real-Postgres completed_at stamp on status -> complete — Phase 94 Plan 04 (D-23, B2).
 * Runs only via `npm run test:db`.
 */

var pgHarness = require('./helpers/pg-harness');
var describeDb = pgHarness.describeDb;

var T0 = new Date('2026-10-01T10:00:00.000Z');
var NOW = new Date('2026-10-09T18:00:00.000Z');
var OPTS = { actor: 'staff@example.com', now: NOW };

describeDb('batch-pg-update-completed-stamp: status -> complete stamps completed_at', function () {
  var container;
  var pool;
  var upd;
  var tasks;
  var harness;
  var seq = 0;

  beforeAll(async function () {
    var started = await pgHarness.startPostgres();
    container = started.container;
    var migrateResult = pgHarness.applyMigrations(started.connectionString);
    if (migrateResult.code !== 0) {
      throw new Error('applyMigrations failed: ' + migrateResult.stderr);
    }
    jest.resetModules();
    var db = require('../../lib/db');
    upd = require('../../lib/batch-pg-update');
    tasks = require('../../lib/batch-pg-tasks');
    pool = db.createPool(started.connectionString);
  }, 120000);

  afterAll(async function () {
    if (pool) await pool.end();
    if (container) await container.stop();
  }, 60000);

  harness = pgHarness.rollbackEachTest(function () {
    return pool;
  });

  function client() { return harness.client(); }

  async function addBatch(status, completedAt, completedSource) {
    seq += 1;
    var id = 'SV-B-7' + String(seq).padStart(5, '0');
    await client().query(
      'insert into batches (batch_id, status, access_token, created_at, last_updated, completed_at, ' +
      'completed_at_source) values ($1, $2, $3, $4, $4, $5, $6)',
      [id, status, String(seq).padStart(32, 'c'), T0, completedAt || null, completedSource || null]
    );
    return id;
  }

  async function row(id) {
    return (await client().query('select * from batches where batch_id = $1', [id])).rows[0];
  }

  it('stamps completed_at = now with source status when blank and none supplied', async function () {
    var id = await addBatch('secondary');
    var res = await upd.updateBatch(client(), { batch_id: id, updates: { status: 'complete' } }, OPTS);
    expect(res.ok).toBe(true);
    var r = await row(id);
    expect(r.completed_at.getTime()).toBe(NOW.getTime());
    expect(r.completed_at_source).toBe('status');
  });

  it('leaves an existing completed_at and its source unchanged', async function () {
    var id = await addBatch('complete', T0, 'task');
    var res = await upd.updateBatch(client(), { batch_id: id, updates: { status: 'complete' } }, OPTS);
    expect(res.ok).toBe(true);
    var r = await row(id);
    expect(r.completed_at.getTime()).toBe(T0.getTime());
    expect(r.completed_at_source).toBe('task');
  });

  it('keeps a supplied completed_at and marks the source manual', async function () {
    var id = await addBatch('secondary');
    await upd.updateBatch(client(), {
      batch_id: id, updates: { status: 'complete', completed_at: '2026-05-01T12:00:00Z' }
    }, OPTS);
    var r = await row(id);
    expect(r.completed_at.toISOString()).toBe('2026-05-01T12:00:00.000Z');
    expect(r.completed_at_source).toBe('manual');
  });

  it('does not touch completed_at on a change to primary', async function () {
    var id = await addBatch('pending');
    await upd.updateBatch(client(), { batch_id: id, updates: { status: 'primary' } }, OPTS);
    var r = await row(id);
    expect(r.completed_at).toBeNull();
    expect(r.completed_at_source).toBeNull();
  });

  it('marks packaging-task completion with source task', async function () {
    var id = await addBatch('secondary');
    var t = await client().query(
      'insert into batch_tasks (batch_id, step_number, title, day_offset, is_packaging, completed, ' +
      'last_updated) values ($1, 1, $2, 1, true, false, $3) returning task_id',
      [id, 'Package', T0]
    );
    await tasks.updateBatchTask(client(), {
      task_id: t.rows[0].task_id, updates: { completed: true }
    }, OPTS);
    var r = await row(id);
    expect(r.status).toBe('complete');
    expect(r.completed_at.getTime()).toBe(NOW.getTime());
    expect(r.completed_at_source).toBe('task');
  });
});
