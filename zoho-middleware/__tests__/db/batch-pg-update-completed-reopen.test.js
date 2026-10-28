'use strict';

/**
 * Real-Postgres completed_at across a reopen and a re-sent complete. Phase 94 review CR-01 and WR-01.
 * Runs only via `npm run test:db`.
 */

var pgHarness = require('./helpers/pg-harness');
var describeDb = pgHarness.describeDb;

var T0 = new Date('2026-10-01T10:00:00.000Z');
var NOW = new Date('2026-10-09T18:00:00.000Z');
var LATER = new Date('2026-10-20T18:00:00.000Z');
var OPTS = { actor: 'staff@example.com', now: NOW };

describeDb('batch-pg-update completed_at: reopen clears, re-sent complete does not stamp', function () {
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
    var id = 'SV-B-8' + String(seq).padStart(5, '0');
    await client().query(
      'insert into batches (batch_id, status, access_token, created_at, last_updated, completed_at, ' +
      'completed_at_source) values ($1, $2, $3, $4, $4, $5, $6)',
      [id, status, String(seq).padStart(32, 'd'), T0, completedAt || null, completedSource || null]
    );
    return id;
  }

  async function row(id) {
    return (await client().query('select * from batches where batch_id = $1', [id])).rows[0];
  }

  it('CR-01: complete -> primary clears completed_at and its source', async function () {
    var id = await addBatch('complete', T0, 'status');
    var res = await upd.updateBatch(client(), { batch_id: id, updates: { status: 'primary' } }, OPTS);
    expect(res.ok).toBe(true);
    var r = await row(id);
    expect(r.status).toBe('primary');
    expect(r.completed_at).toBeNull();
    expect(r.completed_at_source).toBeNull();
  });

  it('CR-01: complete -> secondary clears completed_at and its source', async function () {
    var id = await addBatch('complete', T0, 'task');
    await upd.updateBatch(client(), { batch_id: id, updates: { status: 'secondary' } }, OPTS);
    var r = await row(id);
    expect(r.completed_at).toBeNull();
    expect(r.completed_at_source).toBeNull();
  });

  it('CR-01: reopen then re-complete stamps the new date, not the stale one', async function () {
    var id = await addBatch('complete', T0, 'status');
    await upd.updateBatch(client(), { batch_id: id, updates: { status: 'primary' } }, OPTS);
    await upd.updateBatch(client(), { batch_id: id, updates: { status: 'complete' } },
      { actor: 'staff@example.com', now: LATER });
    var r = await row(id);
    expect(r.completed_at.getTime()).toBe(LATER.getTime());
    expect(r.completed_at_source).toBe('status');
  });

  it('CR-01: complete -> disabled keeps completed_at', async function () {
    var id = await addBatch('complete', T0, 'task');
    await upd.updateBatch(client(), { batch_id: id, updates: { status: 'disabled' } }, OPTS);
    var r = await row(id);
    expect(r.completed_at.getTime()).toBe(T0.getTime());
    expect(r.completed_at_source).toBe('task');
  });

  it('CR-01: packaging-task uncompletion clears completed_at and its source', async function () {
    var id = await addBatch('complete', T0, 'task');
    var t = await client().query(
      'insert into batch_tasks (batch_id, step_number, title, day_offset, is_packaging, completed, ' +
      'last_updated) values ($1, 1, $2, 1, true, true, $3) returning task_id',
      [id, 'Package', T0]
    );
    await tasks.updateBatchTask(client(), {
      task_id: t.rows[0].task_id, updates: { completed: false }
    }, OPTS);
    var r = await row(id);
    expect(r.status).toBe('primary');
    expect(r.completed_at).toBeNull();
    expect(r.completed_at_source).toBeNull();
  });

  it('WR-01: re-sending complete on a complete row with no date does not stamp now', async function () {
    var id = await addBatch('complete');
    var res = await upd.updateBatch(client(), { batch_id: id, updates: { status: 'complete' } }, OPTS);
    expect(res.ok).toBe(true);
    var r = await row(id);
    expect(r.completed_at).toBeNull();
    expect(r.completed_at_source).toBeNull();
  });
});
