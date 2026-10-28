'use strict';

/**
 * Real-Postgres: get_batches / get_batch carry batch_type + batch_type_source only when asked
 * (Phase 94 review WR-02). The default shape (golden parity, mirror bundle) is unchanged.
 * Runs only via `npm run test:db`.
 */

var pgHarness = require('./helpers/pg-harness');
var describeDb = pgHarness.describeDb;

var T0 = new Date('2026-10-01T10:00:00.000Z');

describeDb('batch-pg-read: batch_type extras on list/detail', function () {
  var container;
  var pool;
  var read;
  var rules;
  var harness;

  beforeAll(async function () {
    var started = await pgHarness.startPostgres();
    container = started.container;
    var migrateResult = pgHarness.applyMigrations(started.connectionString);
    if (migrateResult.code !== 0) {
      throw new Error('applyMigrations failed: ' + migrateResult.stderr);
    }
    jest.resetModules();
    var db = require('../../lib/db');
    read = require('../../lib/batch-pg-read');
    rules = require('../../lib/batch-rules');
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

  async function seed() {
    await client().query(
      'insert into batches (batch_id, status, access_token, created_at, last_updated, batch_type, ' +
      'batch_type_source) values ($1, $2, $3, $4, $4, $5, $6), ($7, $2, $8, $4, $4, null, null)',
      ['SV-B-900001', 'primary', 'a'.repeat(32), T0, 'beer', 'recipe', 'SV-B-900002', 'b'.repeat(32)]
    );
  }

  it('listBatches with includeType adds both keys (null when unclassified)', async function () {
    await seed();
    var res = await read.listBatches(client(), { status: 'all', includeType: true });
    var byId = {};
    res.data.batches.forEach(function (b) { byId[b.batch_id] = b; });
    expect(byId['SV-B-900001'].batch_type).toBe('beer');
    expect(byId['SV-B-900001'].batch_type_source).toBe('recipe');
    expect(byId['SV-B-900002'].batch_type).toBeNull();
    expect(byId['SV-B-900002'].batch_type_source).toBeNull();
  });

  it('listBatches without includeType keeps the sheet shape', async function () {
    await seed();
    var res = await read.listBatches(client(), { status: 'all' });
    expect(res.data.batches[0]).not.toHaveProperty('batch_type');
    expect(res.data.batches[0]).not.toHaveProperty('batch_type_source');
  });

  it('getBatchDetail with includeType adds both keys; without, it does not', async function () {
    await seed();
    var withType = await read.getBatchDetail(client(), 'SV-B-900001', { includeType: true });
    expect(withType.data.batch.batch_type).toBe('beer');
    expect(withType.data.batch.batch_type_source).toBe('recipe');
    var plain = await read.getBatchDetail(client(), 'SV-B-900001');
    expect(plain.data.batch).not.toHaveProperty('batch_type');
  });

  it('getBatchBundle (mirror) never carries batch_type', async function () {
    await seed();
    var bundle = await read.getBatchBundle(client(), 'SV-B-900001');
    expect(Object.keys(bundle.batch)).toEqual(rules.BATCH_COLUMNS);
  });
});
