'use strict';

/**
 * Real-Postgres updateBatch source guard — Phase 90 Plan 01 (D-05).
 * Runs only via `npm run test:db`.
 */

var pgHarness = require('./helpers/pg-harness');
var describeDb = pgHarness.describeDb;

var T0 = new Date('2026-10-01T10:00:00.000Z');
var NOW = new Date('2026-10-09T18:00:00.000Z');
var OPTS = { actor: 'staff@example.com', now: NOW };

describeDb('batch-pg-update-source: updateBatch source guard', function () {
  var container;
  var pool;
  var upd;
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

  async function addBatch(source, notes) {
    seq += 1;
    var id = 'SV-B-8' + String(seq).padStart(5, '0');
    var token = String(seq).padStart(32, 'b');
    await client().query(
      'insert into batches (batch_id, status, access_token, created_at, last_updated, notes, source) ' +
      'values ($1, $2, $3, $4, $4, $5, $6)',
      [id, 'primary', token, T0, notes || '', source]
    );
    return id;
  }

  async function row(id) {
    return (await client().query('select * from batches where batch_id = $1', [id])).rows[0];
  }

  it('flips a blank-source row to internal, then back to manual', async function () {
    var id = await addBatch('');
    var r1 = await upd.updateBatch(client(), { batch_id: id, updates: { source: 'internal' } }, OPTS);
    expect(r1.ok).toBe(true);
    expect((await row(id)).source).toBe('internal');
    var r2 = await upd.updateBatch(client(), { batch_id: id, updates: { source: 'manual' } }, OPTS);
    expect(r2.ok).toBe(true);
    expect((await row(id)).source).toBe('manual');
  });

  it('rejects a kiosk_recipe row with invalid_source and writes nothing', async function () {
    var id = await addBatch('kiosk_recipe', 'orig');
    var before = await row(id);
    var res = await upd.updateBatch(client(), { batch_id: id, updates: { source: 'manual', notes: 'n' } }, OPTS);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('invalid_source');
    var after = await row(id);
    expect(after.source).toBe('kiosk_recipe');
    expect(after.notes).toBe('orig');
    expect(after.last_updated.getTime()).toBe(before.last_updated.getTime());
  });

  it('drops an off-list target (zoho_scan) on a manual row and still succeeds', async function () {
    var id = await addBatch('manual');
    var res = await upd.updateBatch(client(), { batch_id: id, updates: { source: 'zoho_scan', notes: 'kept' } }, OPTS);
    expect(res.ok).toBe(true);
    var after = await row(id);
    expect(after.source).toBe('manual');
    expect(after.notes).toBe('kept');
  });

  it('does not mutate the caller updates object', async function () {
    var id = await addBatch('manual');
    var updates = { source: 'INTERNAL', notes: 'x' };
    await upd.updateBatch(client(), { batch_id: id, updates: updates }, OPTS);
    expect(updates.source).toBe('INTERNAL');
    expect((await row(id)).source).toBe('internal');
  });
});
