'use strict';

/**
 * Real-Postgres createBatch round-trip of source 'internal' and zoho_so_number —
 * Phase 90 Plan 01 (D-01, D-04). Runs only via `npm run test:db`.
 */

var pgHarness = require('./helpers/pg-harness');
var describeDb = pgHarness.describeDb;

describeDb('batch-pg-create-internal', function () {
  var container;
  var pool;
  var create;
  var harness;
  var NOW = new Date('2026-10-09T18:00:00.000Z');

  beforeAll(async function () {
    var started = await pgHarness.startPostgres();
    container = started.container;
    var migrateResult = pgHarness.applyMigrations(started.connectionString);
    if (migrateResult.code !== 0) throw new Error('applyMigrations failed: ' + migrateResult.stderr);
    jest.resetModules();
    var db = require('../../lib/db');
    create = require('../../lib/batch-pg-create');
    pool = db.createPool(started.connectionString);
  }, 120000);

  afterAll(async function () {
    if (pool) await pool.end();
    if (container) await container.stop();
  }, 60000);

  harness = pgHarness.rollbackEachTest(function () { return pool; });

  function client() { return harness.client(); }
  function run(payload) {
    return create.createBatch(client(), payload, { actor: 'staff@example.com', now: NOW });
  }
  async function row(id) {
    return (await client().query('select * from batches where batch_id = $1', [id])).rows[0];
  }

  it('stores source internal', async function () {
    var r = await run({ product_sku: 'SKU-A', customer_name: 'Ann Brewer', source: 'internal' });
    expect(r.ok).toBe(true);
    expect((await row(r.batch_id)).source).toBe('internal');
  });

  it('stores zoho_so_number and rejects a repeat for the same invoice + SKU', async function () {
    var payload = { product_sku: 'SKU-A', customer_name: 'Ann Brewer', zoho_so_number: 'INV-000999' };
    var r = await run(Object.assign({}, payload));
    expect(r.ok).toBe(true);
    expect((await row(r.batch_id)).zoho_so_number).toBe('INV-000999');
    var dup = await run(Object.assign({}, payload));
    expect(dup.ok).toBe(false);
    expect(dup.error).toBe('duplicate_so_number');
  });
});
