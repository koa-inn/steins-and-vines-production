'use strict';

/**
 * Real-Postgres: the trusted type channel never downgrades a row whose source got stronger
 * between the backfill read and its write (Phase 94 review WR-04, D-06).
 * Runs only via `npm run test:db`.
 */

var pgHarness = require('./helpers/pg-harness');
var describeDb = pgHarness.describeDb;

var T0 = new Date('2026-10-01T10:00:00.000Z');
var NOW = new Date('2026-10-09T18:00:00.000Z');

describeDb('trusted batch_type channel vs a concurrent upgrade', function () {
  var container;
  var pool;
  var upd;
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
    upd = require('../../lib/batch-pg-update');
    cli = require('../../scripts/backfill/batch-type-backfill');
    pool = db.createPool(started.connectionString);
  }, 120000);

  afterAll(async function () {
    if (pool) await pool.end();
    if (container) await container.stop();
  }, 60000);

  async function seed(id, o) {
    await pool.query(
      'insert into batches (batch_id, status, access_token, created_at, last_updated, product_sku, ' +
      'product_name, batch_type, batch_type_source) values ($1, \'primary\', $2, $3, $3, $4, $5, $6, $7)',
      [id, id.replace(/\D/g, '').padStart(32, 'f'), T0, o.sku || '', o.name || '',
        o.type || null, o.source || null]
    );
  }

  async function row(id) {
    return (await pool.query('select batch_type, batch_type_source from batches where batch_id = $1', [id])).rows[0];
  }

  it('updateBatch trusted rejects a row already sourced from recipe/schedule/zoho', async function () {
    var strong = ['recipe', 'schedule', 'zoho'];
    for (var i = 0; i < strong.length; i++) {
      var id = 'SV-B-71000' + (i + 1);
      await seed(id, { type: 'beer', source: strong[i] });
      var c = await pool.connect();
      var res;
      try {
        res = await upd.updateBatch(c, { batch_id: id, updates: { batch_type: 'other' } },
          { trusted: true, batchTypeSource: 'other', now: NOW });
      } finally {
        c.release();
      }
      expect(res.ok).toBe(false);
      expect(res.error).toBe('source_changed');
      expect(await row(id)).toEqual({ batch_type: 'beer', batch_type_source: strong[i] });
    }
  });

  it('updateBatch trusted rejects when the stored source differs from expectedTypeSource', async function () {
    await seed('SV-B-710010', { type: 'beer', source: 'name' });
    var c = await pool.connect();
    var res;
    try {
      res = await upd.updateBatch(c, { batch_id: 'SV-B-710010', updates: { batch_type: 'wine' } },
        { trusted: true, batchTypeSource: 'name', expectedTypeSource: null, now: NOW });
    } finally {
      c.release();
    }
    expect(res.error).toBe('source_changed');
    expect(await row('SV-B-710010')).toEqual({ batch_type: 'beer', batch_type_source: 'name' });
  });

  it('the CLI skips a row upgraded to recipe between its read and its write', async function () {
    await pool.query('delete from batches');
    await seed('SV-B-710020', { name: 'Unknown thing' });
    var connects = 0;
    var racingPool = {
      connect: async function () {
        connects++;
        if (connects === 2) {
          await pool.query(
            "update batches set batch_type = 'cider', batch_type_source = 'recipe' where batch_id = $1",
            ['SV-B-710020']
          );
        }
        return pool.connect();
      }
    };
    var deps = {
      pool: racingPool,
      log: function () {},
      fetchItems: function () { return Promise.resolve([]); },
      isProduction: function () { return false; }
    };
    var res = await cli.runBatchTypeBackfill({ apply: true, expect: 1 }, deps);
    expect(res.exitCode).toBe(0);
    expect(res.written).toBe(0);
    expect(res.skipped).toBe(1);
    expect(await row('SV-B-710020')).toEqual({ batch_type: 'cider', batch_type_source: 'recipe' });
  });
});
