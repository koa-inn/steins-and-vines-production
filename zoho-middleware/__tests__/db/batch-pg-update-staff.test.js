'use strict';

/**
 * Real-Postgres staff_batch edits via update_batch, the no-bump setStaffBatch write and the
 * D-19 rule that a source change never sets the flag. Runs only via `npm run test:db`.
 */

var pgHarness = require('./helpers/pg-harness');
var describeDb = pgHarness.describeDb;

var T0 = new Date('2026-10-01T10:00:00.000Z');
var NOW = new Date('2026-10-09T18:00:00.000Z');
var OPTS = { actor: 'staff@example.com', now: NOW };

describeDb('batch-pg-update-staff', function () {
  var container;
  var pool;
  var upd;
  var harness;
  var seq = 0;

  beforeAll(async function () {
    var started = await pgHarness.startPostgres();
    container = started.container;
    var migrateResult = pgHarness.applyMigrations(started.connectionString);
    if (migrateResult.code !== 0) throw new Error('applyMigrations failed: ' + migrateResult.stderr);
    jest.resetModules();
    var db = require('../../lib/db');
    upd = require('../../lib/batch-pg-update');
    pool = db.createPool(started.connectionString);
  }, 120000);

  afterAll(async function () {
    if (pool) await pool.end();
    if (container) await container.stop();
  }, 60000);

  harness = pgHarness.rollbackEachTest(function () { return pool; });

  function client() { return harness.client(); }

  async function addBatch(o) {
    o = o || {};
    seq += 1;
    var id = 'SV-B-7' + String(seq).padStart(5, '0');
    await client().query(
      'insert into batches (batch_id, status, access_token, created_at, last_updated, source, staff_batch) ' +
      'values ($1, $2, $3, $4, $4, $5, $6)',
      [id, 'primary', String(seq).padStart(32, 'e'), T0, o.source || 'manual', !!o.staff_batch]
    );
    return id;
  }
  async function row(id) {
    return (await client().query('select * from batches where batch_id = $1', [id])).rows[0];
  }

  it('sets staff_batch true (boolean and string) and bumps last_updated', async function () {
    var a = await addBatch();
    var b = await addBatch();
    expect((await upd.updateBatch(client(), { batch_id: a, updates: { staff_batch: true } }, OPTS)).ok).toBe(true);
    expect((await upd.updateBatch(client(), { batch_id: b, updates: { staff_batch: 'true' } }, OPTS)).ok).toBe(true);
    var ra = await row(a);
    expect(ra.staff_batch).toBe(true);
    expect(ra.last_updated.getTime()).toBe(NOW.getTime());
    expect((await row(b)).staff_batch).toBe(true);
  });

  it('clears staff_batch with false and the string false', async function () {
    var a = await addBatch({ staff_batch: true });
    var b = await addBatch({ staff_batch: true });
    expect((await upd.updateBatch(client(), { batch_id: a, updates: { staff_batch: false } }, OPTS)).ok).toBe(true);
    expect((await upd.updateBatch(client(), { batch_id: b, updates: { staff_batch: 'false' } }, OPTS)).ok).toBe(true);
    expect((await row(a)).staff_batch).toBe(false);
    expect((await row(b)).staff_batch).toBe(false);
  });

  it('rejects any other value with invalid_input and writes nothing (T-95-02)', async function () {
    var id = await addBatch();
    var before = await row(id);
    var bad = ['yes', 1, 0, '', null];
    for (var i = 0; i < bad.length; i++) {
      var res = await upd.updateBatch(client(), { batch_id: id, updates: { staff_batch: bad[i], notes: 'x' } }, OPTS);
      expect(res.ok).toBe(false);
      expect(res.error).toBe('invalid_input');
    }
    var after = await row(id);
    expect(after.staff_batch).toBe(false);
    expect(after.notes).toBe(before.notes);
    expect(after.last_updated.getTime()).toBe(before.last_updated.getTime());
  });

  it('a source change to internal or research does not set staff_batch (D-19)', async function () {
    var id = await addBatch({ source: 'manual' });
    var res = await upd.updateBatch(client(), { batch_id: id, updates: { source: 'internal' } }, OPTS);
    expect(res.ok).toBe(true);
    var r = await row(id);
    expect(r.staff_batch).toBe(false);
  });

  describe('setStaffBatch', function () {
    it('sets and clears the flag without touching last_updated', async function () {
      var id = await addBatch();
      var before = await row(id);
      expect(await upd.setStaffBatch(client(), id, true)).toBe(1);
      var on = await row(id);
      expect(on.staff_batch).toBe(true);
      expect(on.last_updated.getTime()).toBe(before.last_updated.getTime());
      expect(await upd.setStaffBatch(client(), id, false)).toBe(1);
      var off = await row(id);
      expect(off.staff_batch).toBe(false);
      expect(off.last_updated.getTime()).toBe(before.last_updated.getTime());
    });

    it('returns 0 for an unknown id and throws on a non-boolean', async function () {
      expect(await upd.setStaffBatch(client(), 'SV-B-999999', true)).toBe(0);
      await expect(upd.setStaffBatch(client(), 'SV-B-999999', 'true')).rejects.toThrow(TypeError);
    });
  });
});
