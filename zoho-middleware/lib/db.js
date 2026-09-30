'use strict';

/**
 * Postgres connection layer — Phase 83 (DB-02).
 *
 * This is the ONLY module in this codebase allowed to import the `pg`
 * package. Every Postgres access — now and in every later v4.9 phase — goes
 * through query()/withTransaction() here; no route or lib file should
 * `new Pool()` or import `pg` directly.
 *
 * Never import `node-pg-migrate` anywhere in app code — it is ESM-only on
 * v9 and is CLI-only (invoked via railway.toml's preDeployCommand, see
 * Plan 83-03; Research Pitfall 1, D-03).
 *
 * All callers must use `$1..$n` placeholders — never string-built SQL
 * (ASVS V5, T-83-02-04).
 *
 * Connects lazily on first use (module load must never block app.listen —
 * D-02). If Postgres is unreachable at runtime, callers get a rejected
 * promise; the process does not crash and /health reports it (server.js).
 */

var Pool = require('pg').Pool;
var log = require('./logger');
var sentryCapture = require('./sentry-capture');

var pool = null;

/**
 * Railway's public TCP proxy (*.proxy.rlwy.net) presents a self-signed
 * certificate — pg's default TLS verification (and even `?sslmode=require`
 * alone) rejects it. This relaxation is scoped to the Railway public proxy
 * ONLY (short-lived, owner-initiated, credential-bearing connection over
 * Railway's own infrastructure) and must NOT be reused for any other TLS
 * connection in this codebase (T-83-02-05, accepted risk). The in-Railway
 * private DATABASE_URL (internal network) needs no TLS config at all.
 */
function sslConfigFor(connectionString) {
  if (connectionString && /\.proxy\.rlwy\.net/.test(connectionString)) {
    return { rejectUnauthorized: false };
  }
  return false;
}

/**
 * Replace the password segment of a Postgres connection string with '***'.
 * Safe on non-string input (returns it unchanged). Used any time a
 * connection-string-derived value might be logged or sent to Sentry —
 * DATABASE_URL/DATABASE_PUBLIC_URL must never appear in plaintext in logs
 * (T-83-02-01).
 */
function redactConnectionString(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/:\/\/([^:/@]+):([^@/]+)@/, '://$1:***@');
}

/**
 * Build a standalone pg.Pool — used both for the shared lazy singleton below
 * and directly by the backfill CLI / Testcontainers-backed tests (Plans
 * 83-03/83-05/83-07). Always attaches a pool 'error' handler — without one,
 * an idle-client error crashes Node (T-83-02-02, violates D-02).
 */
function createPool(connectionString, opts) {
  var baseOpts = {
    connectionString: connectionString,
    ssl: sslConfigFor(connectionString),
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  };
  var mergedOpts = Object.assign({}, baseOpts, opts || {});
  var newPool = new Pool(mergedOpts);

  newPool.on('error', function (err) {
    var message = (err && err.message) || String(err);
    log.error('[db] idle client error: ' + redactConnectionString(message));
    sentryCapture.captureExceptionSafe(err, { tags: { component: 'db' } });
  });

  return newPool;
}

/**
 * Lazily create the shared pool from process.env.DATABASE_URL on first use
 * (not at module load — server.js requires this module in every
 * supertest-based test, and module-load-time connection would slow/hang
 * every test run).
 */
function getPool() {
  if (!pool) {
    pool = createPool(process.env.DATABASE_URL);
  }
  return pool;
}

function isConfigured() {
  return !!process.env.DATABASE_URL;
}

function query(text, params) {
  if (!isConfigured()) {
    return Promise.reject(new Error('DATABASE_URL not configured'));
  }
  return getPool().query(text, params);
}

function withTransaction(fn) {
  if (!isConfigured()) {
    return Promise.reject(new Error('DATABASE_URL not configured'));
  }
  return getPool().connect().then(function (client) {
    return client.query('BEGIN')
      .then(function () {
        return fn(client);
      })
      .then(function (result) {
        return client.query('COMMIT').then(function () {
          return result;
        });
      })
      .catch(function (err) {
        // ROLLBACK failure must never mask the original error.
        return client.query('ROLLBACK').then(
          function () { throw err; },
          function () { throw err; }
        );
      })
      .then(
        function (result) { client.release(); return result; },
        function (err) { client.release(); throw err; }
      );
  });
}

/**
 * Ends the shared pool and resets the singleton so a later query()/
 * withTransaction() call lazily constructs a fresh one. Used by tests and
 * the backfill CLI, not by normal app request handling.
 */
function close() {
  if (!pool) return Promise.resolve();
  var current = pool;
  pool = null;
  return current.end();
}

module.exports = {
  query: query,
  withTransaction: withTransaction,
  isConfigured: isConfigured,
  createPool: createPool,
  sslConfigFor: sslConfigFor,
  redactConnectionString: redactConnectionString,
  close: close
};
