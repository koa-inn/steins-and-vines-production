'use strict';

/**
 * Real-Postgres proof for the chained pre-deploy guard (D-04, 83-14).
 *
 * Runs ONLY via `npm run test:db` (jest.db.config.js), gated by describeDb()'s D-14 rule:
 * skipped locally without Docker, never skipped on CI.
 *
 * Proves, against a real Postgres 16 container:
 *   (a) the 5 allowlist-accepted `apply: true` fixtures (in their array order) apply
 *       cleanly through BOTH guards and node-pg-migrate, and the resulting schema/data
 *       are correct;
 *   (b) the exact chained-command shape used by `npm run migrate` blocks a migration
 *       the OLD guard alone would accept (REVIEW CR-02a) BEFORE node-pg-migrate ever
 *       touches the database;
 *   (c) `npm run migrate` itself — not a hand-assembled shell command — runs both
 *       guards and then applies migrations/.
 */

var fs = require('fs');
var os = require('os');
var path = require('path');
var childProcess = require('child_process');
var pg = require('pg');

var pgHarness = require('./helpers/pg-harness');
var describeDb = pgHarness.describeDb;
var startPostgres = pgHarness.startPostgres;
var applyMigrations = pgHarness.applyMigrations;

var allCases = require('../fixtures/migration-allowlist-cases.js');

var MIDDLEWARE_ROOT = path.join(__dirname, '..', '..');
var MIGRATIONS_DIR = path.join(MIDDLEWARE_ROOT, 'migrations');
var GUARD_SCRIPT = path.join(MIDDLEWARE_ROOT, 'scripts', 'migration-guard.js');
var ALLOWLIST_SCRIPT = path.join(MIDDLEWARE_ROOT, 'scripts', 'migration-allowlist.js');
var NODE_PG_MIGRATE_BIN = path.join(MIDDLEWARE_ROOT, 'node_modules', '.bin', 'node-pg-migrate');

// Local copy of migrations.test.js's connectionStringForDatabase helper (not imported from
// a test file — each test file in this directory keeps its own copy).
function connectionStringForDatabase(baseConnectionString, databaseName) {
  var parsed = new URL(baseConnectionString);
  parsed.pathname = '/' + databaseName;
  return parsed.toString();
}

function createDatabase(baseConnectionString, databaseName) {
  return Promise.resolve()
    .then(function () {
      var client = new pg.Client({ connectionString: baseConnectionString });
      return client.connect().then(function () {
        return client
          .query('create database ' + databaseName)
          .then(function () {
            return client.end();
          })
          .catch(function (err) {
            return client.end().then(function () {
              throw err;
            });
          });
      });
    })
    .then(function () {
      return connectionStringForDatabase(baseConnectionString, databaseName);
    });
}

describeDb('migration-allowlist chain against real Postgres 16 (D-04, 83-14)', function () {
  var container;
  var baseConnectionString;

  beforeAll(async function () {
    var started = await startPostgres();
    container = started.container;
    baseConnectionString = started.connectionString;
  }, 120000);

  afterAll(async function () {
    if (container) await container.stop();
  }, 60000);

  it('allowlist-accepted fixtures apply cleanly to PG16', async function () {
    var applyCases = allCases.filter(function (c) {
      return c.apply === true;
    });
    expect(applyCases.length).toBe(5);

    var fileNames = [
      '0001_init.sql',
      '0002_gift_cards.sql',
      '0003_later_additive.sql',
      '0004_public_qualified.sql',
      '0005_regex_check.sql'
    ];

    var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-allowlist-apply-'));
    try {
      applyCases.forEach(function (c, index) {
        fs.writeFileSync(path.join(tmpDir, fileNames[index]), c.sql);
      });

      var guardResult = childProcess.spawnSync('node', [GUARD_SCRIPT, tmpDir], {
        cwd: MIDDLEWARE_ROOT,
        encoding: 'utf8'
      });
      expect(guardResult.status).toBe(0);

      var allowlistResult = childProcess.spawnSync('node', [ALLOWLIST_SCRIPT, tmpDir], {
        cwd: MIDDLEWARE_ROOT,
        encoding: 'utf8'
      });
      expect(allowlistResult.status).toBe(0);

      var dbUrl = await createDatabase(baseConnectionString, 'allowlist_apply_accepted');
      var applyResult = applyMigrations(dbUrl, { dir: tmpDir });
      expect(applyResult.code).toBe(0);

      var client = new pg.Client({ connectionString: dbUrl });
      await client.connect();
      try {
        var tableNames = [
          'gift_cards',
          'gift_card_transactions',
          'gc_adjustments',
          'ferm_schedules',
          'vessel_history'
        ];
        for (var i = 0; i < tableNames.length; i++) {
          var regclass = await client.query('select to_regclass($1) as reg', ['public.' + tableNames[i]]);
          expect(regclass.rows[0].reg).toBe(tableNames[i]);
        }

        var migrationsCount = await client.query('select count(*)::int as count from pgmigrations');
        expect(migrationsCount.rows[0].count).toBe(5);

        var appMetaRow = await client.query("select value from app_meta where key = 'gift_cards_store'");
        expect(appMetaRow.rows.length).toBe(1);
      } finally {
        await client.end();
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('chained pre-deploy command blocks a migration the old guard alone would accept (REVIEW CR-02a)', async function () {
    var bypassCase = allCases.filter(function (c) {
      return c.id === 'CR-02a';
    })[0];
    expect(bypassCase).toBeDefined();

    var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-allowlist-bypass-'));
    try {
      var initSql = fs.readFileSync(path.join(MIGRATIONS_DIR, '0001_init.sql'), 'utf8');
      fs.writeFileSync(path.join(tmpDir, '0001_init.sql'), initSql);
      fs.writeFileSync(path.join(tmpDir, '0002_bypass.sql'), bypassCase.sql);

      // Document the gap the old guard alone leaves: it accepts this file on its own.
      var oldGuardAlone = childProcess.spawnSync('node', [GUARD_SCRIPT, tmpDir], {
        cwd: MIDDLEWARE_ROOT,
        encoding: 'utf8'
      });
      expect(oldGuardAlone.status).toBe(0);

      var dbUrl = await createDatabase(baseConnectionString, 'allowlist_apply_bypass');

      var chained = childProcess.spawnSync(
        'sh',
        ['-c', 'node scripts/migration-guard.js "$D" && node scripts/migration-allowlist.js "$D" && "$BIN" up -m "$D"'],
        {
          cwd: MIDDLEWARE_ROOT,
          encoding: 'utf8',
          env: Object.assign({}, process.env, {
            D: tmpDir,
            BIN: NODE_PG_MIGRATE_BIN,
            DATABASE_URL: dbUrl
          })
        }
      );

      expect(chained.status).not.toBe(0);
      expect(chained.stderr).toContain('0002_bypass.sql: statement-not-allowed:');

      var client = new pg.Client({ connectionString: dbUrl });
      await client.connect();
      try {
        var pgmigrationsReg = await client.query("select to_regclass('pgmigrations') as reg");
        expect(pgmigrationsReg.rows[0].reg).toBeNull();

        var appMetaReg = await client.query("select to_regclass('app_meta') as reg");
        expect(appMetaReg.rows[0].reg).toBeNull();
      } finally {
        await client.end();
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("npm run migrate runs both guards then applies migrations/", async function () {
    var dbUrl = await createDatabase(baseConnectionString, 'allowlist_apply_npm_migrate');

    var result = childProcess.spawnSync('npm', ['run', 'migrate'], {
      cwd: MIDDLEWARE_ROOT,
      encoding: 'utf8',
      env: Object.assign({}, process.env, { DATABASE_URL: dbUrl })
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('migration-guard: ');
    expect(result.stdout).toContain('migration-allowlist: ');

    var client = new pg.Client({ connectionString: dbUrl });
    await client.connect();
    try {
      var rows = await client.query("select name from pgmigrations where name = '0001_init'");
      expect(rows.rows.length).toBe(1);
    } finally {
      await client.end();
    }
  });
});
