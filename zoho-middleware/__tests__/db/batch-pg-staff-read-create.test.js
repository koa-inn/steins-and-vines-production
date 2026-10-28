'use strict';

/**
 * Real-Postgres staff_batch: auto-set on create from source only (D-08/D-19), exposed on
 * list/detail extras and as dashboard staffBatchIds. Runs only via `npm run test:db`.
 */

var pgHarness = require('./helpers/pg-harness');
var describeDb = pgHarness.describeDb;

describeDb('batch-pg staff_batch create + read', function () {
  var container;
  var pool;
  var create;
  var read;
  var rules;
  var harness;
  var NOW = new Date('2026-10-28T18:00:00.000Z');

  beforeAll(async function () {
    var started = await pgHarness.startPostgres();
    container = started.container;
    var migrateResult = pgHarness.applyMigrations(started.connectionString);
    if (migrateResult.code !== 0) throw new Error('applyMigrations failed: ' + migrateResult.stderr);
    jest.resetModules();
    var db = require('../../lib/db');
    create = require('../../lib/batch-pg-create');
    read = require('../../lib/batch-pg-read');
    rules = require('../../lib/batch-rules');
    pool = db.createPool(started.connectionString);
  }, 120000);

  afterAll(async function () {
    if (pool) await pool.end();
    if (container) await container.stop();
  }, 60000);

  harness = pgHarness.rollbackEachTest(function () { return pool; });

  function client() { return harness.client(); }
  var n = 0;
  function run(payload) {
    n += 1;
    var p = Object.assign({ customer_name: 'Ann Brewer', product_sku: 'SKU-S' + n, product_name: 'Thing ' + n }, payload);
    return create.createBatch(client(), p, { actor: 'staff@example.com', now: NOW });
  }
  async function staffOf(id) {
    return (await client().query('select staff_batch from batches where batch_id = $1', [id])).rows[0].staff_batch;
  }

  it('internal and research sources store staff_batch true', async function () {
    var a = await run({ source: 'internal' });
    var b = await run({ source: 'research' });
    expect(a.ok).toBe(true);
    expect(await staffOf(a.batch_id)).toBe(true);
    expect(await staffOf(b.batch_id)).toBe(true);
  });

  it('other sources and a missing source store false', async function () {
    var ids = [];
    ids.push((await run({ source: 'kiosk' })).batch_id);
    ids.push((await run({ source: 'online' })).batch_id);
    ids.push((await run({ source: 'manual' })).batch_id);
    ids.push((await run({})).batch_id);
    for (var i = 0; i < ids.length; i++) expect(await staffOf(ids[i])).toBe(false);
  });

  it('a payload staff_batch:true on a kiosk source is ignored (T-95-01)', async function () {
    var r = await run({ source: 'kiosk', staff_batch: true });
    expect(r.ok).toBe(true);
    expect(await staffOf(r.batch_id)).toBe(false);
  });

  it('list/detail carry staff_batch only with includeType', async function () {
    var s = await run({ source: 'internal' });
    var k = await run({ source: 'kiosk' });
    var list = await read.listBatches(client(), { status: 'all', includeType: true });
    var byId = {};
    list.data.batches.forEach(function (b) { byId[b.batch_id] = b; });
    expect(byId[s.batch_id].staff_batch).toBe(true);
    expect(byId[k.batch_id].staff_batch).toBe(false);
    var detail = await read.getBatchDetail(client(), s.batch_id, { includeType: true });
    expect(detail.data.batch.staff_batch).toBe(true);
    var plain = await read.getBatchDetail(client(), s.batch_id);
    expect(plain.data.batch).not.toHaveProperty('staff_batch');
    var plainList = await read.listBatches(client(), { status: 'all' });
    expect(plainList.data.batches[0]).not.toHaveProperty('staff_batch');
  });

  it('getBatchBundle keys still equal BATCH_COLUMNS', async function () {
    var s = await run({ source: 'internal' });
    var bundle = await read.getBatchBundle(client(), s.batch_id);
    expect(Object.keys(bundle.batch)).toEqual(rules.BATCH_COLUMNS);
  });

  it('getDashboardStats returns staffBatchIds and keeps rows lean', async function () {
    var s1 = await run({ source: 'internal' });
    await run({ source: 'kiosk' });
    var s2 = await run({ source: 'research' });
    var res = await read.getDashboardStats(client(), { now: NOW });
    expect(res.data.staffBatchIds).toEqual([s1.batch_id, s2.batch_id]);
    res.data.batches.forEach(function (r) {
      expect(r).not.toHaveProperty('staff_batch');
      Object.keys(r).forEach(function (key) { expect(key).not.toMatch(/^customer_/); });
    });
  });
});
