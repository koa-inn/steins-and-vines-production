'use strict';

/**
 * Real-Postgres round-trip tests for lib/db.js — Phase 83 Plan 05 (DB-02 SC3).
 *
 * Runs ONLY via `npm run test:db` (jest.db.config.js), gated by describeDb()'s D-14 rule:
 * skipped locally without Docker, never skipped on CI.
 */

var pgHarness = require('./helpers/pg-harness');
var describeDb = pgHarness.describeDb;
var startPostgres = pgHarness.startPostgres;
var applyMigrations = pgHarness.applyMigrations;
var rollbackEachTest = pgHarness.rollbackEachTest;

describeDb('lib/db.js against real Postgres', function () {
  var container;
  var connectionString;
  var db;
  var harnessPool;
  var SAVED_DATABASE_URL;

  beforeAll(async function () {
    SAVED_DATABASE_URL = process.env.DATABASE_URL;

    var started = await startPostgres();
    container = started.container;
    connectionString = started.connectionString;

    process.env.DATABASE_URL = connectionString;
    jest.resetModules();
    db = require('../../lib/db');

    var migrateResult = applyMigrations(connectionString);
    if (migrateResult.code !== 0) {
      throw new Error(
        'applyMigrations failed (code ' + migrateResult.code + '): ' + migrateResult.stderr
      );
    }
  }, 120000);

  afterAll(async function () {
    if (db) await db.close();
    if (container) await container.stop();

    if (SAVED_DATABASE_URL === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = SAVED_DATABASE_URL;
    }
  }, 60000);

  it('round-trips a simple query (select 1)', async function () {
    var result = await db.query('select 1 as one');
    expect(result.rows[0].one).toBe(1);
  });

  it('round-trips a hostile parameterised value as a literal string (ASVS V5, T-83-05-04)', async function () {
    var hostile = "o'brien; drop table app_meta";
    var result = await db.query('select $1::text as v', [hostile]);
    expect(result.rows[0].v).toBe(hostile);

    // app_meta must still exist — proves the hostile string was never interpolated as SQL.
    var check = await db.query('select count(*)::int as count from app_meta');
    expect(check.rows[0].count).toBeGreaterThan(0);
  });

  it('withTransaction commits an insert that is visible afterwards', async function () {
    await db.query('create table if not exists tx_commit_probe (id int primary key)');
    try {
      await db.withTransaction(function (client) {
        return client.query('insert into tx_commit_probe (id) values (1)');
      });

      var result = await db.query('select id from tx_commit_probe');
      expect(result.rows.length).toBe(1);
      expect(result.rows[0].id).toBe(1);
    } finally {
      await db.query('drop table if exists tx_commit_probe');
    }
  });

  it('withTransaction rolls back on a thrown error; the row is NOT visible afterwards', async function () {
    await db.query('create table if not exists tx_rollback_probe (id int primary key)');
    try {
      await expect(
        db.withTransaction(function (client) {
          return client.query('insert into tx_rollback_probe (id) values (1)').then(function () {
            throw new Error('intentional rollback trigger');
          });
        })
      ).rejects.toThrow('intentional rollback trigger');

      var result = await db.query('select id from tx_rollback_probe');
      expect(result.rows.length).toBe(0);
    } finally {
      await db.query('drop table if exists tx_rollback_probe');
    }
  });

  it('has the 0001_init seed row (schema_initialized_by)', async function () {
    var result = await db.query(
      "select value from app_meta where key = 'schema_initialized_by'"
    );
    expect(result.rows.length).toBe(1);
  });

  describe('rollbackEachTest per-test isolation', function () {
    // Registered BEFORE rollbackEachTest()'s own afterAll so it runs AFTER the client is
    // released (Jest runs afterAll hooks within a describe block in reverse declaration
    // order — the last-registered afterAll runs first).
    afterAll(function () {
      if (harnessPool) {
        var pool = harnessPool;
        harnessPool = null;
        return pool.end();
      }
    });

    var harness = rollbackEachTest(function () {
      if (!harnessPool) {
        harnessPool = db.createPool(connectionString);
      }
      return harnessPool;
    });

    it('test A inserts into app_meta on the harness client', async function () {
      var client = harness.client();
      await client.query("insert into app_meta (key, value) values ('rollback_probe', 'A')");
      var check = await client.query(
        "select value from app_meta where key = 'rollback_probe'"
      );
      expect(check.rows.length).toBe(1);
    });

    it('test B asserts the row from test A is absent (proves ROLLBACK ran between tests)', async function () {
      var client = harness.client();
      var check = await client.query(
        "select value from app_meta where key = 'rollback_probe'"
      );
      expect(check.rows.length).toBe(0);
    });
  });
});
