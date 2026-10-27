'use strict';

/**
 * Real-Postgres test for scripts/backfill/batch-type-backfill.js - Phase 94 Plan 06.
 * Testcontainers only; the Zoho item list is injected, no live service is reached.
 */

var pgHarness = require('./helpers/pg-harness');
var describeDb = pgHarness.describeDb;

var T0 = new Date('2026-10-01T10:00:00.000Z');

describeDb('batch-type-backfill against real Postgres', function () {
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
      [id, id.replace(/\D/g, '').padStart(32, 'e'), T0, o.sku || '', o.name || '',
        o.type || null, o.source || null]
    );
  }

  async function row(id) {
    return (await pool.query('select batch_type, batch_type_source from batches where batch_id = $1', [id])).rows[0];
  }

  it('applies the proposals, upgrades a weak row and leaves manual alone', async function () {
    await seed('SV-B-700001', { sku: 'K1', name: 'Mystery' });
    await seed('SV-B-700002', { name: 'Hazy IPA', type: 'beer', source: 'name' });
    await seed('SV-B-700003', { sku: 'K1', name: 'Hazy IPA', type: 'beer', source: 'name' });
    await seed('SV-B-700004', { sku: 'K1', type: 'cider', source: 'manual' });
    await seed('SV-B-700005', { name: 'Unknown thing' });

    var logs = [];
    var deps = {
      pool: pool,
      log: function (m) { logs.push(m); },
      fetchItems: function () { return Promise.resolve([{ sku: 'K1', item_id: '1', cf_type: 'Wine' }]); },
      isProduction: function () { return false; }
    };

    var dry = await cli.runBatchTypeBackfill({ apply: false }, deps);
    expect(dry.exitCode).toBe(0);
    expect(dry.candidates).toBe(3);
    expect((await row('SV-B-700001')).batch_type).toBeNull();

    var res = await cli.runBatchTypeBackfill({ apply: true, expect: 3 }, deps);
    expect(res.exitCode).toBe(0);
    expect(res.written).toBe(3);

    expect(await row('SV-B-700001')).toEqual({ batch_type: 'wine', batch_type_source: 'zoho' });
    expect(await row('SV-B-700002')).toEqual({ batch_type: 'beer', batch_type_source: 'name' });
    expect(await row('SV-B-700003')).toEqual({ batch_type: 'wine', batch_type_source: 'zoho' });
    expect(await row('SV-B-700004')).toEqual({ batch_type: 'cider', batch_type_source: 'manual' });
    expect(await row('SV-B-700005')).toEqual({ batch_type: 'other', batch_type_source: 'other' });
    expect(logs.join('\n')).not.toMatch(/batches-replay-to-sheet/);
  });
});
