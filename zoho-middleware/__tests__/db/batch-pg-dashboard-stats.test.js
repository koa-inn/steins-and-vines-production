'use strict';

/**
 * Real-Postgres getDashboardStats — Phase 94 Plan 05 (S1, D-21). Runs only via `npm run test:db`.
 */

var pgHarness = require('./helpers/pg-harness');
var describeDb = pgHarness.describeDb;

var LEAN_KEYS = [
  'batch_id', 'status', 'batch_type', 'batch_type_source', 'start_date', 'completed_day',
  'completed_at', 'completed_at_source', 'vessel_id', 'source', 'product_sku', 'product_name',
  'product_subcategory', 'product_brand', 'product_manufacturer', 'recipe_id', 'schedule_id',
  'schedule_category', 'target_volume_l', 'tasks_total', 'tasks_done'
].sort();

describeDb('batch-pg-dashboard-stats', function () {
  var container;
  var pool;
  var read;
  var harness;
  var NOW = new Date('2026-10-23T06:30:00.000Z');

  beforeAll(async function () {
    var started = await pgHarness.startPostgres();
    container = started.container;
    var migrateResult = pgHarness.applyMigrations(started.connectionString);
    if (migrateResult.code !== 0) throw new Error('applyMigrations failed: ' + migrateResult.stderr);
    jest.resetModules();
    var db = require('../../lib/db');
    read = require('../../lib/batch-pg-read');
    pool = db.createPool(started.connectionString);
  }, 120000);

  afterAll(async function () {
    if (pool) await pool.end();
    if (container) await container.stop();
  }, 60000);

  harness = pgHarness.rollbackEachTest(function () { return pool; });

  function client() { return harness.client(); }

  function tok(n) {
    var s = String(n);
    while (s.length < 32) s = 'a' + s;
    return s;
  }

  async function insertBatch(n, fields) {
    var f = Object.assign({
      status: 'primary', start_date: '2026-10-01', completed_at: null, schedule_id: null,
      batch_type: 'wine', batch_type_source: 'name', target_volume_l: null,
      customer_name: 'Secret Person', notes: 'private note', schedule_snapshot: '{"x":1}',
      recipe_snapshot: '{"y":2}'
    }, fields || {});
    var id = 'SV-B-' + String(n).padStart(6, '0');
    await client().query(
      'insert into batches (batch_id, status, start_date, completed_at, schedule_id, batch_type, ' +
      'batch_type_source, target_volume_l, customer_name, notes, schedule_snapshot, recipe_snapshot, ' +
      'access_token, created_at, last_updated, vessel_id, source, product_sku, product_name) ' +
      "values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now(), now(), 'V1', 'kiosk', 'SKU-1', 'Kit')",
      [id, f.status, f.start_date, f.completed_at, f.schedule_id, f.batch_type, f.batch_type_source,
        f.target_volume_l, f.customer_name, f.notes, f.schedule_snapshot, f.recipe_snapshot, tok(n)]);
    return id;
  }

  async function insertTask(id, step, due, completed) {
    await client().query(
      'insert into batch_tasks (batch_id, step_number, day_offset, due_date, completed, completed_at, last_updated) ' +
      'values ($1, $2, 0, $3, $4, $5, now())',
      [id, step, due, completed, completed ? '2026-10-10T12:00:00Z' : null]);
  }

  it('returns lean rows, string dates, Vancouver completed_day, and no PII keys', async function () {
    await client().query(
      "insert into ferm_schedules (schedule_id, name, category, steps, created_at, updated_at) " +
      "values ('FS-0001', 'S', 'Wine', '[]'::jsonb, now(), now())");
    var a = await insertBatch(1, { status: 'pending' });
    var b = await insertBatch(2, { status: 'primary', schedule_id: 'FS-0001', target_volume_l: '23.5' });
    var c = await insertBatch(3, { status: 'secondary' });
    var d = await insertBatch(4, { status: 'complete', completed_at: '2026-04-06T05:30:00Z' });
    var e = await insertBatch(5, { status: 'complete' });
    var f = await insertBatch(6, { status: 'disabled' });
    await insertTask(b, 1, '2026-10-24', true);
    await insertTask(b, 2, '2026-10-25', false);

    var res = await read.getDashboardStats(client(), { now: NOW });
    expect(res.ok).toBe(true);
    var rows = res.data.batches;
    expect(rows.map(function (r) { return r.batch_id; })).toEqual([a, b, c, d, e, f]);
    rows.forEach(function (r) {
      expect(Object.keys(r).sort()).toEqual(LEAN_KEYS);
      Object.keys(r).forEach(function (k) {
        expect(k).not.toMatch(/^customer_|access_token|notes|snapshot/);
      });
      expect(r.product_subcategory).toBe('');
      expect(r.product_brand).toBe('');
      expect(r.product_manufacturer).toBe('');
    });
    expect(rows[1].start_date).toBe('2026-10-01');
    expect(rows[1].schedule_category).toBe('wine');
    expect(rows[0].schedule_category).toBe('');
    expect(rows[1].target_volume_l).toBe(23.5);
    expect(rows[0].target_volume_l).toBeNull();
    expect(rows[1].tasks_total).toBe(2);
    expect(rows[1].tasks_done).toBe(1);
    expect(rows[0].tasks_total).toBe(0);
    expect(rows[3].completed_day).toBe('2026-04-05');
    expect(rows[4].completed_day).toBeNull();
  });

  it('tasks only for primary/secondary batches, with string due dates', async function () {
    var a = await insertBatch(1, { status: 'primary' });
    var b = await insertBatch(2, { status: 'complete' });
    await insertTask(a, 1, '2026-10-24', false);
    await insertTask(b, 1, '2026-10-24', false);
    var res = await read.getDashboardStats(client(), { now: NOW });
    expect(res.data.tasks).toHaveLength(1);
    expect(res.data.tasks[0].batch_id).toBe(a);
    expect(res.data.tasks[0].due_date).toBe('2026-10-24');
    expect(Object.keys(res.data.tasks[0]).sort()).toEqual(
      ['batch_id', 'completed', 'completed_day', 'due_date', 'is_packaging', 'is_transfer', 'task_id']);
  });

  it('latestReadings: newest per active batch only', async function () {
    var a = await insertBatch(1, { status: 'primary' });
    var b = await insertBatch(2, { status: 'complete' });
    var ins = 'insert into plato_readings (batch_id, reading_at, degrees_plato, temperature, ph, created_at) ' +
      'values ($1, $2, $3, $4, $5, now())';
    await client().query(ins, [a, '2026-10-01T10:00:00Z', '20', '18', '3.4']);
    await client().query(ins, [a, '2026-10-05T10:00:00Z', '12.5', null, null]);
    await client().query(ins, [b, '2026-10-05T10:00:00Z', '5', null, null]);
    var res = await read.getDashboardStats(client(), { now: NOW });
    expect(res.data.latestReadings).toHaveLength(1);
    expect(res.data.latestReadings[0].batch_id).toBe(a);
    expect(res.data.latestReadings[0].degrees_plato).toBe(12.5);
    expect(res.data.latestReadings[0].temperature).toBeNull();
  });

  it('summary equals getDashboardSummary and asOf is Vancouver', async function () {
    await insertBatch(1, { status: 'primary' });
    var res = await read.getDashboardStats(client(), { now: NOW });
    var summary = await read.getDashboardSummary(client(), { now: NOW });
    expect(res.data.summary).toEqual(summary.data);
    expect(res.data.asOf).toEqual({ today: '2026-10-22', year: 2026, tz: 'America/Vancouver' });
  });
});
