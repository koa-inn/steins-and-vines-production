'use strict';

/**
 * Real-Postgres migration pipeline tests — Phase 83 Plan 05 (DB-02 SC3, D-03 proof).
 *
 * Runs ONLY via `npm run test:db` (jest.db.config.js), gated by describeDb()'s D-14 rule:
 * skipped locally without Docker, never skipped on CI.
 */

var fs = require('fs');
var os = require('os');
var path = require('path');
var pg = require('pg');

var pgHarness = require('./helpers/pg-harness');
var describeDb = pgHarness.describeDb;
var startPostgres = pgHarness.startPostgres;
var applyMigrations = pgHarness.applyMigrations;

var MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations');

function listMigrationFileNames() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter(function (f) {
      return /\.sql$/.test(f);
    })
    .map(function (f) {
      return f.replace(/\.sql$/, '');
    })
    .sort();
}

function connectionStringForDatabase(baseConnectionString, databaseName) {
  var parsed = new URL(baseConnectionString);
  parsed.pathname = '/' + databaseName;
  return parsed.toString();
}

describeDb('migrations/0001_init.sql against real Postgres', function () {
  var container;
  var connectionString;

  beforeAll(async function () {
    var started = await startPostgres();
    container = started.container;
    connectionString = started.connectionString;
  }, 120000);

  afterAll(async function () {
    if (container) await container.stop();
  }, 60000);

  it('applies cleanly to a fresh database; pgmigrations matches migrations/ exactly (by name)', async function () {
    var result = applyMigrations(connectionString);
    expect(result.code).toBe(0);

    var client = new pg.Client({ connectionString: connectionString });
    await client.connect();
    try {
      var rows = await client.query('select name from pgmigrations order by name');
      var appliedNames = rows.rows
        .map(function (r) {
          return r.name;
        })
        .sort();
      expect(appliedNames).toEqual(listMigrationFileNames());
    } finally {
      await client.end();
    }
  });

  it('is idempotent — a second apply exits 0 and adds no new pgmigrations rows', async function () {
    var beforeClient = new pg.Client({ connectionString: connectionString });
    await beforeClient.connect();
    var beforeCount;
    try {
      var beforeResult = await beforeClient.query(
        'select count(*)::int as count from pgmigrations'
      );
      beforeCount = beforeResult.rows[0].count;
    } finally {
      await beforeClient.end();
    }

    var result = applyMigrations(connectionString);
    expect(result.code).toBe(0);

    var afterClient = new pg.Client({ connectionString: connectionString });
    await afterClient.connect();
    try {
      var afterResult = await afterClient.query(
        'select count(*)::int as count from pgmigrations'
      );
      expect(afterResult.rows[0].count).toBe(beforeCount);
    } finally {
      await afterClient.end();
    }
  });

  it('D-03 proof: a failing migration exits non-zero and never records the broken file (transactional apply)', async function () {
    var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrations-broken-'));

    try {
      var initSql = fs.readFileSync(path.join(MIGRATIONS_DIR, '0001_init.sql'), 'utf8');
      fs.writeFileSync(path.join(tmpDir, '0001_init.sql'), initSql);
      fs.writeFileSync(
        path.join(tmpDir, '0002_broken.sql'),
        '-- Up Migration\n' +
          'select * from this_table_does_not_exist_at_all;\n\n' +
          '-- Down Migration\n' +
          'select 1;\n'
      );

      // A SEPARATE fresh database, so this failure can never pollute the pgmigrations
      // table the other two tests in this file assert against.
      var adminClient = new pg.Client({ connectionString: connectionString });
      await adminClient.connect();
      try {
        await adminClient.query('drop database if exists broken_check');
        await adminClient.query('create database broken_check');
      } finally {
        await adminClient.end();
      }

      var brokenConnectionString = connectionStringForDatabase(connectionString, 'broken_check');
      var result = applyMigrations(brokenConnectionString, { dir: tmpDir });
      expect(result.code).not.toBe(0);

      var checkClient = new pg.Client({ connectionString: brokenConnectionString });
      await checkClient.connect();
      try {
        var rows = await checkClient.query('select name from pgmigrations');
        var names = rows.rows.map(function (r) {
          return r.name;
        });
        expect(names.indexOf('0002_broken')).toBe(-1);
      } finally {
        await checkClient.end();
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
