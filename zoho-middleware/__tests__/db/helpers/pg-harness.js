'use strict';

/**
 * Real-Postgres Jest harness helpers — Phase 83 Plan 05 (DB-02 SC3, D-14).
 *
 * Consumed by __tests__/db/*.test.js (run via `npm run test:db`, jest.db.config.js) and by
 * later phases' own DB tests (Plan 83-07's backfill test, Phases 84-88).
 *
 * D-14: when Docker is not running LOCALLY, DB test files skip with a clear message and the
 * rest of the suite (npm test) still runs. On CI (process.env.CI set to anything truthy other
 * than the literal string 'false' — GitHub Actions sets CI=true), there is NO skip path: a
 * missing Docker must fail the job, not silently pass.
 *
 * @testcontainers/postgresql is require()'d lazily, ONLY inside startPostgres() — importing
 * this module (e.g. from the main suite's db-harness-gate.test.js, or from describeDb() before
 * a container is ever started) must never touch Docker.
 */

var path = require('path');
var childProcess = require('child_process');

/**
 * Probes for a running Docker daemon via `docker info`. Never throws — returns false on any
 * failure (binary missing, daemon not running, permission denied, etc).
 */
function dockerAvailable() {
  try {
    childProcess.execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * True when process.env.CI is set to a non-empty value other than the literal string 'false'.
 * GitHub Actions sets CI=true by default on every runner.
 */
function isCiEnv() {
  var ci = process.env.CI;
  return !!ci && ci !== 'false';
}

/**
 * D-14 truth table: skip ONLY when Docker is unavailable AND we are not on CI. On CI, a
 * missing Docker must fail the job (no skip path) — the caller (describeDb) lets the
 * container-start step throw instead.
 */
function shouldSkipDbTests(opts) {
  opts = opts || {};
  var docker = !!opts.docker;
  var ci = !!opts.ci;
  return !docker && !ci;
}

/**
 * Wraps Jest's describe()/describe.skip() with the D-14 gate. Locally, without Docker, the
 * suite is skipped with a clear console.warn + describe.skip message. On CI (or with Docker
 * present locally), the suite runs for real — if Docker is unavailable on CI, the container
 * start inside the suite throws and the file fails, which is the intended D-14 behaviour.
 */
function describeDb(name, fn) {
  var docker = dockerAvailable();
  var ci = isCiEnv();

  if (shouldSkipDbTests({ docker: docker, ci: ci })) {
    var message = name + ' (Docker not running — skipped locally, runs on CI; D-14)';
    // Jest's default (non-verbose) reporter only surfaces console.* output captured during
    // a running test — describeDb() runs at collection time, outside any it()/test() block,
    // so console.warn here is silently swallowed unless --verbose is passed. Write directly
    // to stderr instead so the "skipped locally" message is always visible in plain
    // `npm run test:db` output, matching the plan's verification command.
    process.stderr.write('[pg-harness] ' + message + '\n');
    return describe.skip(message, fn);
  }

  return describe(name, fn);
}

/**
 * Starts a throwaway postgres:16-alpine container via Testcontainers. Only ever called from
 * inside a describeDb() block that has already decided not to skip — lazy require keeps the
 * package out of the main suite's module graph entirely.
 */
function startPostgres() {
  var PostgreSqlContainer = require('@testcontainers/postgresql').PostgreSqlContainer;
  return new PostgreSqlContainer('postgres:16-alpine').start().then(function (container) {
    return {
      container: container,
      connectionString: container.getConnectionUri()
    };
  });
}

/**
 * Applies migrations/*.sql via the node-pg-migrate CLI binary (never require()'d — v9 is
 * ESM-only, see lib/db.js's header comment and Research Pitfall 1). Shells out with
 * DATABASE_URL set to the target connection string.
 */
function applyMigrations(connectionString, opts) {
  opts = opts || {};
  var dir = opts.dir || path.join(__dirname, '..', '..', '..', 'migrations');
  var binPath = path.join(__dirname, '..', '..', '..', 'node_modules', '.bin', 'node-pg-migrate');

  var result = childProcess.spawnSync(binPath, ['up', '-m', dir], {
    env: Object.assign({}, process.env, { DATABASE_URL: connectionString }),
    encoding: 'utf8'
  });

  return {
    code: result.status,
    stdout: result.stdout,
    stderr: result.stderr
  };
}

/**
 * Registers beforeAll/beforeEach/afterEach/afterAll hooks that check out ONE client from the
 * given pool, BEGIN in beforeEach, ROLLBACK in afterEach, and release in afterAll — giving
 * every test in the describe block a clean slate without paying container-startup cost per
 * test. getPool is a function (not a pool) so it can be called lazily, after beforeAll has
 * constructed the pool for the container under test.
 */
function rollbackEachTest(getPool) {
  var checkedOutClient = null;

  beforeAll(function () {
    return getPool().connect().then(function (client) {
      checkedOutClient = client;
    });
  });

  beforeEach(function () {
    return checkedOutClient.query('BEGIN');
  });

  afterEach(function () {
    return checkedOutClient.query('ROLLBACK');
  });

  afterAll(function () {
    if (checkedOutClient) {
      checkedOutClient.release();
      checkedOutClient = null;
    }
  });

  return {
    client: function () {
      return checkedOutClient;
    }
  };
}

module.exports = {
  dockerAvailable: dockerAvailable,
  isCiEnv: isCiEnv,
  shouldSkipDbTests: shouldSkipDbTests,
  describeDb: describeDb,
  startPostgres: startPostgres,
  applyMigrations: applyMigrations,
  rollbackEachTest: rollbackEachTest
};
