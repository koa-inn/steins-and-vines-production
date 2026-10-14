'use strict';

/**
 * Real-Postgres check of migration 0006 — Phase 89 Plan 04 (D-03, D-07).
 * recipes.beer_category is plain nullable text with NO CHECK constraint; the enum is enforced
 * at the app level (lib/recipe-rules.js). Runs only via `npm run test:db`.
 */

var pgHarness = require('./helpers/pg-harness');
var describeDb = pgHarness.describeDb;
var startPostgres = pgHarness.startPostgres;
var applyMigrations = pgHarness.applyMigrations;

describeDb('migration 0006 recipes.beer_category', function () {
  var container;
  var pool;
  var harness;

  beforeAll(async function () {
    var started = await startPostgres();
    container = started.container;
    var migrateResult = applyMigrations(started.connectionString);
    if (migrateResult.code !== 0) {
      throw new Error('applyMigrations failed (code ' + migrateResult.code + '): ' + migrateResult.stderr);
    }
    jest.resetModules();
    var db = require('../../lib/db');
    pool = db.createPool(started.connectionString);
  }, 120000);

  afterAll(async function () {
    if (pool) await pool.end();
    if (container) await container.stop();
  }, 60000);

  harness = pgHarness.rollbackEachTest(function () {
    return pool;
  });

  it('adds a nullable text column', async function () {
    var client = harness.client();
    var res = await client.query(
      "select data_type, is_nullable from information_schema.columns " +
      "where table_name = 'recipes' and column_name = 'beer_category'");
    expect(res.rows).toEqual([{ data_type: 'text', is_nullable: 'YES' }]);
  });

  it('has no CHECK constraint referencing beer_category', async function () {
    var client = harness.client();
    var res = await client.query(
      "select conname from pg_constraint where conrelid = 'recipes'::regclass and contype = 'c' " +
      "and pg_get_constraintdef(oid) ilike '%beer_category%'");
    expect(res.rows.length).toBe(0);
  });

  it('accepts an arbitrary string at the DB level (enforcement is app-level, D-03)', async function () {
    var client = harness.client();
    var ins = await client.query(
      "insert into recipes (name, status, created_at, updated_at, beer_category) " +
      "values ('X', 'draft', now(), now(), 'anything-at-all') returning beer_category");
    expect(ins.rows[0].beer_category).toBe('anything-at-all');
  });

  it('reads NULL when the column is not supplied', async function () {
    var client = harness.client();
    var ins = await client.query(
      "insert into recipes (name, status, created_at, updated_at) " +
      "values ('Y', 'draft', now(), now()) returning beer_category");
    expect(ins.rows[0].beer_category).toBeNull();
  });
});
