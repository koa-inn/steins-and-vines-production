'use strict';

/**
 * Real-Postgres createBatch batch_type / batch_type_source — Phase 94 Plan 03 (B3, D-05..D-08).
 * Runs only via `npm run test:db`.
 */

var pgHarness = require('./helpers/pg-harness');
var describeDb = pgHarness.describeDb;

describeDb('batch-pg-create-type', function () {
  var container;
  var pool;
  var create;
  var harness;
  var NOW = new Date('2026-10-27T18:00:00.000Z');

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
  function run(payload, typeHints) {
    var opts = { actor: 'staff@example.com', now: NOW };
    if (typeHints) opts.typeHints = typeHints;
    return create.createBatch(client(), Object.assign({ customer_name: 'Ann Brewer' }, payload), opts);
  }
  async function row(id) {
    return (await client().query('select * from batches where batch_id = $1', [id])).rows[0];
  }
  async function expectType(r, type, source) {
    expect(r.ok).toBe(true);
    var b = await row(r.batch_id);
    expect(b.batch_type).toBe(type);
    expect(b.batch_type_source).toBe(source);
  }

  it('kiosk create with a zoho hint stores zoho type', async function () {
    var r = await run({ product_sku: 'SKU-1', source: 'kiosk', product_name: 'Thing' }, { zohoCfType: 'wine' });
    await expectType(r, 'wine', 'zoho');
  });

  it('online create classifies by name', async function () {
    var r = await run({ product_sku: 'SKU-2', source: 'online', product_name: 'Apple Cider Kit' });
    await expectType(r, 'cider', 'name');
  });

  it('zoho_scan create with unknown type saves other/other and never rejects (D-07)', async function () {
    var r = await run({ product_sku: 'SKU-3', source: 'zoho_scan', product_name: 'Mystery Kit' });
    await expectType(r, 'other', 'other');
  });

  it('kiosk_recipe uses the recipes row beer_category over a zoho hint', async function () {
    await client().query(
      "insert into recipes (recipe_id, name, status, beer_category, created_at, updated_at) " +
      "values ('SV-R-000901', 'IPA One', 'draft', 'ipa', now(), now())");
    var r = await run({ recipe_id: 'SV-R-000901', source: 'kiosk_recipe', product_name: 'IPA One' },
      { zohoCfType: 'wine' });
    await expectType(r, 'beer', 'recipe');
  });

  it('missing recipes row falls back to the recipe_snapshot style', async function () {
    var r = await run({ recipe_id: 'SV-R-999999', source: 'kiosk_recipe', product_name: 'X',
      recipe_snapshot: '{"style":"Cider"}' });
    await expectType(r, 'cider', 'recipe');
  });

  it('a non-matching snapshot style falls through', async function () {
    var r = await run({ recipe_id: 'SV-R-999998', source: 'kiosk_recipe', product_name: 'Mystery',
      recipe_snapshot: { style: 'Hazy IPA' } });
    await expectType(r, 'other', 'other');
  });

  it('scheduled create uses the schedule category', async function () {
    var s = await client().query(
      "insert into ferm_schedules (name, category, steps, created_at, updated_at) " +
      "values ('S', 'beer', '[]', now(), now()) returning schedule_id");
    var r = await run({ product_sku: 'SKU-4', source: 'manual', product_name: 'Plain',
      schedule_id: s.rows[0].schedule_id, start_date: '2026-10-27' });
    await expectType(r, 'beer', 'schedule');
  });

  it('manual source honours a client batch_type as manual', async function () {
    var r = await run({ product_sku: 'SKU-5', source: 'manual', product_name: 'Z', batch_type: 'seltzer' });
    await expectType(r, 'seltzer', 'manual');
  });

  it('automated source ignores a client batch_type', async function () {
    var r = await run({ product_sku: 'SKU-6', source: 'kiosk', product_name: 'Z', batch_type: 'seltzer' },
      { zohoCfType: 'wine' });
    await expectType(r, 'wine', 'zoho');
  });

  it('invalid client batch_type is ignored on manual', async function () {
    var r = await run({ product_sku: 'SKU-7', source: 'manual', product_name: 'Lager Kit', batch_type: 'rosé' });
    await expectType(r, 'beer', 'name');
  });

  it('fingerprint replay does not change the stored type', async function () {
    var payload = { product_sku: 'SKU-8', source: 'manual', product_name: 'Z', batch_type: 'wine' };
    var first = await run(Object.assign({}, payload));
    var again = await run(Object.assign({}, payload));
    expect(again.idempotent_replay).toBe(true);
    expect(again.batch_id).toBe(first.batch_id);
    await expectType(first, 'wine', 'manual');
  });

  it('kiosk-cache miss never rejects (D-07)', async function () {
    var a = await run({ product_sku: 'SKU-9', source: 'online', product_name: 'Merlot Reserve' }, {});
    await expectType(a, 'other', 'other');
    var b = await run({ product_sku: 'SKU-10', source: 'online', product_name: 'Lager Kit' }, { zohoCfType: '' });
    await expectType(b, 'beer', 'name');
  });
});
