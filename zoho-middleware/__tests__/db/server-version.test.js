'use strict';

/**
 * The real-Postgres harness must run the same major version as the Railway databases.
 * Staging and production both run PostgreSQL 18.x (checked 2026-10-02); the harness had been
 * on postgres:16-alpine, so DB tests were proving behaviour on a version prod doesn't run.
 *
 * Runs ONLY via `npm run test:db` (jest.db.config.js), gated by describeDb()'s D-14 rule.
 */

var pg = require('pg');
var pgHarness = require('./helpers/pg-harness');

var PROD_MAJOR = 18;

pgHarness.describeDb('pg-harness server version', function () {
  var container;
  var client;

  beforeAll(async function () {
    var started = await pgHarness.startPostgres();
    container = started.container;
    client = new pg.Client({ connectionString: started.connectionString });
    await client.connect();
  }, 120000);

  afterAll(async function () {
    if (client) await client.end();
    if (container) await container.stop();
  });

  test('harness Postgres major version matches production (' + PROD_MAJOR + ')', async function () {
    var res = await client.query('SHOW server_version_num');
    var major = Math.floor(Number(res.rows[0].server_version_num) / 10000);
    expect(major).toBe(PROD_MAJOR);
  });
});
