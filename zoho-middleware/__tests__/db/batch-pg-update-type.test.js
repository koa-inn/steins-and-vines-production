'use strict';

/**
 * Real-Postgres batch_type edits, trusted backfill channel and type re-derivation —
 * Phase 94 Plan 04 (D-06, D-15, D-16). Runs only via `npm run test:db`.
 */

var pgHarness = require('./helpers/pg-harness');
var describeDb = pgHarness.describeDb;

var T0 = new Date('2026-10-01T10:00:00.000Z');
var NOW = new Date('2026-10-09T18:00:00.000Z');
var OPTS = { actor: 'staff@example.com', now: NOW };

describeDb('batch-pg-update-type: manual type, trusted channel, re-derive', function () {
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

  async function addBatch(o) {
    o = o || {};
    seq += 1;
    var id = 'SV-B-6' + String(seq).padStart(5, '0');
    await client().query(
      'insert into batches (batch_id, status, access_token, created_at, last_updated, product_name, ' +
      'batch_type, batch_type_source, completed_at, completed_at_source) ' +
      'values ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9)',
      [id, o.status || 'primary', String(seq).padStart(32, 'd'), T0, o.product_name || '',
        o.batch_type || null, o.batch_type_source || null, o.completed_at || null,
        o.completed_at_source || null]
    );
    return id;
  }

  async function row(id) {
    return (await client().query('select * from batches where batch_id = $1', [id])).rows[0];
  }

  describe('manual batch_type', function () {
    it('stores a valid type lower-cased with source manual', async function () {
      var id = await addBatch();
      var res = await upd.updateBatch(client(), { batch_id: id, updates: { batch_type: 'Beer' } }, OPTS);
      expect(res.ok).toBe(true);
      var r = await row(id);
      expect(r.batch_type).toBe('beer');
      expect(r.batch_type_source).toBe('manual');
    });

    it('rejects an invalid type with invalid_input and writes nothing', async function () {
      var id = await addBatch({ batch_type: 'wine', batch_type_source: 'name' });
      var before = await row(id);
      var res = await upd.updateBatch(client(), { batch_id: id, updates: { batch_type: 'rose', notes: 'x' } }, OPTS);
      expect(res.ok).toBe(false);
      expect(res.error).toBe('invalid_input');
      var after = await row(id);
      expect(after.batch_type).toBe('wine');
      expect(after.last_updated.getTime()).toBe(before.last_updated.getTime());
    });

    it('ignores client-supplied source columns', async function () {
      var id = await addBatch({ batch_type: 'wine', batch_type_source: 'name' });
      var res = await upd.updateBatch(client(), {
        batch_id: id, updates: { batch_type_source: 'zoho', completed_at_source: 'backfill-task', notes: 'n' }
      }, OPTS);
      expect(res.ok).toBe(true);
      var r = await row(id);
      expect(r.batch_type_source).toBe('name');
      expect(r.completed_at_source).toBeNull();
    });
  });

  describe('trusted channel', function () {
    it('sets a non-manual source on a NULL-typed row', async function () {
      var id = await addBatch();
      var res = await upd.updateBatch(client(), { batch_id: id, updates: { batch_type: 'wine' } },
        { trusted: true, batchTypeSource: 'zoho', actor: 'backfill', now: NOW });
      expect(res.ok).toBe(true);
      var r = await row(id);
      expect(r.batch_type).toBe('wine');
      expect(r.batch_type_source).toBe('zoho');
    });

    it('never overwrites a manual type', async function () {
      var id = await addBatch({ batch_type: 'cider', batch_type_source: 'manual' });
      var before = await row(id);
      var res = await upd.updateBatch(client(), { batch_id: id, updates: { batch_type: 'wine' } },
        { trusted: true, batchTypeSource: 'zoho', now: NOW });
      expect(res.ok).toBe(false);
      expect(res.error).toBe('manual_locked');
      var after = await row(id);
      expect(after.batch_type).toBe('cider');
      expect(after.last_updated.getTime()).toBe(before.last_updated.getTime());
    });

    it('sets completed_at with source backfill-task when blank', async function () {
      var id = await addBatch({ status: 'complete' });
      var res = await upd.updateBatch(client(), {
        batch_id: id, updates: { completed_at: '2026-04-05T20:00:00Z' }
      }, { trusted: true, completedAtSource: 'backfill-task', now: NOW });
      expect(res.ok).toBe(true);
      var r = await row(id);
      expect(r.completed_at.toISOString()).toBe('2026-04-05T20:00:00.000Z');
      expect(r.completed_at_source).toBe('backfill-task');
    });

    it('never overwrites an existing completed_at', async function () {
      var id = await addBatch({ status: 'complete', completed_at: T0, completed_at_source: 'task' });
      var res = await upd.updateBatch(client(), {
        batch_id: id, updates: { completed_at: '2026-04-05T20:00:00Z' }
      }, { trusted: true, completedAtSource: 'backfill-task', now: NOW });
      expect(res.ok).toBe(false);
      expect(res.error).toBe('already_set');
      var r = await row(id);
      expect(r.completed_at.getTime()).toBe(T0.getTime());
      expect(r.completed_at_source).toBe('task');
    });

    it('rejects source values outside the allowed lists', async function () {
      var id = await addBatch();
      var r1 = await upd.updateBatch(client(), { batch_id: id, updates: { batch_type: 'wine' } },
        { trusted: true, batchTypeSource: 'manual', now: NOW });
      expect(r1.error).toBe('invalid_input');
      var r2 = await upd.updateBatch(client(), { batch_id: id, updates: { batch_type: 'wine' } },
        { trusted: true, now: NOW });
      expect(r2.error).toBe('invalid_input');
      var r3 = await upd.updateBatch(client(), { batch_id: id, updates: { completed_at: '2026-04-05T20:00:00Z' } },
        { trusted: true, completedAtSource: 'manual', now: NOW });
      expect(r3.error).toBe('invalid_input');
      expect((await row(id)).batch_type).toBeNull();
    });

    it('ignores trusted source options when trusted is not true', async function () {
      var id = await addBatch();
      await upd.updateBatch(client(), { batch_id: id, updates: { batch_type: 'wine' } },
        { batchTypeSource: 'zoho', now: NOW });
      expect((await row(id)).batch_type_source).toBe('manual');
    });
  });
});
