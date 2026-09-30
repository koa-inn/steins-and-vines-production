'use strict';

/**
 * Real-Postgres tests for the backfill pipeline's scratch-schema loader, checks,
 * promote gate and status — Phase 83 Plan 07 (DB-02 SC4).
 *
 * Runs ONLY via `npm run test:db` (jest.db.config.js), gated by describeDb()'s D-14 rule:
 * skipped locally without Docker, never skipped on CI.
 *
 * Task 2 extends this same file with backfill.js's CLI-level runBackfill() end-to-end
 * cases (xlsx-generated fixtures, exit codes, promote gate) — see the second describeDb
 * block below.
 */

var pgHarness = require('./helpers/pg-harness');
var describeDb = pgHarness.describeDb;
var startPostgres = pgHarness.startPostgres;
var applyMigrations = pgHarness.applyMigrations;

var load = require('../../scripts/backfill/load');
var normalizeRow = require('../../scripts/backfill/normalize').normalizeRow;
var platoReadingsSpec = require('../../scripts/backfill/specs/plato-readings');
var fermSchedulesSpec = require('../../scripts/backfill/specs/ferm-schedules');

var TIMEZONE = 'America/Vancouver';

// Builds a normalised row object from raw fixture values via the real normalizeRow
// pipeline (no .xlsx needed for this task — Task 2 adds the real-file round trip).
function normalize(spec, rawValuesByHeader) {
  var result = normalizeRow(spec, rawValuesByHeader, { timezone: TIMEZONE });
  if (!result.ok) {
    throw new Error('fixture failed to normalise: ' + JSON.stringify(result.reasons));
  }
  return result.values;
}

function platoRow(overrides) {
  var base = {
    reading_id: 'PR-000001',
    batch_id: 'SV-B-000001',
    timestamp: '2026-01-15T08:00:00Z',
    plato: '12.50',
    notes: '',
    recorded_by: 'staff',
    created_at: '2026-01-15T08:05:00Z',
    temperature: '',
    ph: ''
  };
  Object.assign(base, overrides || {});
  return normalize(platoReadingsSpec, base);
}

function fermRow(overrides) {
  var base = {
    schedule_id: 'FS-0001',
    name: 'Ale Primary',
    description: '',
    category: 'ale',
    steps: '[{"day":1,"action":"pitch"}]',
    active: 'TRUE',
    created_at: '2026-01-01T00:00:00Z',
    created_by: 'staff',
    updated_at: '2026-01-01T00:00:00Z'
  };
  Object.assign(base, overrides || {});
  return normalize(fermSchedulesSpec, base);
}

describeDb('backfill pipeline against real Postgres', function () {
  var container;
  var connectionString;
  var db;
  var pool;
  var client;

  beforeAll(async function () {
    var started = await startPostgres();
    container = started.container;
    connectionString = started.connectionString;

    var migrateResult = applyMigrations(connectionString);
    if (migrateResult.code !== 0) {
      throw new Error(
        'applyMigrations failed (code ' + migrateResult.code + '): ' + migrateResult.stderr
      );
    }

    jest.resetModules();
    db = require('../../lib/db');
    pool = db.createPool(connectionString);
    client = await pool.connect();
  }, 120000);

  afterAll(async function () {
    if (client) client.release();
    if (pool) await pool.end();
    if (container) await container.stop();
  }, 60000);

  afterEach(async function () {
    // Tests each manage their own schema/table lifecycle via loadScratch's
    // drop+create-on-every-load, but clean up scratch schemas and any test-created
    // public tables between tests so "no stray table" assertions hold.
    await client.query("drop schema if exists scratch_test cascade");
    await client.query('drop table if exists public.plato_readings');
    await client.query('drop table if exists public.ferm_schedules');
  });

  describe('assertScratchSchema', function () {
    it('throws on non-scratch-prefixed or unsafe names', function () {
      ['public', 'pg_catalog', 'scratch', 'scratch_x;drop', 'Scratch_1'].forEach(function (bad) {
        expect(function () {
          load.assertScratchSchema(bad);
        }).toThrow();
      });
    });

    it('accepts valid scratch_* names', function () {
      expect(load.assertScratchSchema('scratch_83')).toBe('scratch_83');
      expect(load.assertScratchSchema('scratch_rehearsal_1')).toBe('scratch_rehearsal_1');
    });
  });

  describe('loadScratch', function () {
    it('loads normalised PlatoReadings rows with typed columns; a second load REPLACES them', async function () {
      var rows = [
        platoRow({ reading_id: 'PR-000001' }),
        platoRow({ reading_id: 'PR-000002' }),
        platoRow({ reading_id: 'PR-000003' })
      ];

      var result = await load.loadScratch(client, {
        schema: 'scratch_test',
        spec: platoReadingsSpec,
        rows: rows
      });
      expect(result.inserted).toBe(3);

      var countCheck = await client.query('select count(*)::int as count from scratch_test.plato_readings');
      expect(countCheck.rows[0].count).toBe(3);

      var typeCheck = await client.query(
        "select data_type from information_schema.columns where table_schema='scratch_test' and table_name='plato_readings' and column_name='plato'"
      );
      expect(typeCheck.rows[0].data_type).toBe('numeric');
      var tsTypeCheck = await client.query(
        "select data_type from information_schema.columns where table_schema='scratch_test' and table_name='plato_readings' and column_name='timestamp'"
      );
      expect(tsTypeCheck.rows[0].data_type).toBe('timestamp with time zone');

      // Second load replaces, does not append.
      var secondRows = [platoRow({ reading_id: 'PR-000099' })];
      var secondResult = await load.loadScratch(client, {
        schema: 'scratch_test',
        spec: platoReadingsSpec,
        rows: secondRows
      });
      expect(secondResult.inserted).toBe(1);

      var afterSecond = await client.query('select count(*)::int as count from scratch_test.plato_readings');
      expect(afterSecond.rows[0].count).toBe(1);
    });

    it('loads FermSchedules rows with steps as jsonb (array) and active as boolean', async function () {
      var rows = [fermRow({ schedule_id: 'FS-0001' })];

      await load.loadScratch(client, {
        schema: 'scratch_test',
        spec: fermSchedulesSpec,
        rows: rows
      });

      var check = await client.query(
        "select jsonb_typeof(steps) as steps_type, active, pg_typeof(active)::text as active_type from scratch_test.ferm_schedules"
      );
      expect(check.rows[0].steps_type).toBe('array');
      expect(check.rows[0].active).toBe(true);
      expect(check.rows[0].active_type).toBe('boolean');
    });
  });

  describe('runChecks', function () {
    it('returns ok:true after a clean load', async function () {
      var rows = [
        platoRow({ reading_id: 'PR-000001', plato: '12.50' }),
        platoRow({ reading_id: 'PR-000002', plato: '11.00' })
      ];
      await load.loadScratch(client, { schema: 'scratch_test', spec: platoReadingsSpec, rows: rows });

      var result = await load.runChecks(client, {
        schema: 'scratch_test',
        spec: platoReadingsSpec,
        rows: rows
      });
      expect(result.ok).toBe(true);
    });

    it('returns ok:false naming the column and check after a tampered value', async function () {
      var rows = [platoRow({ reading_id: 'PR-000001', plato: '12.50' })];
      await load.loadScratch(client, { schema: 'scratch_test', spec: platoReadingsSpec, rows: rows });

      await client.query("update scratch_test.plato_readings set plato = '99.00' where reading_id = 'PR-000001'");

      var result = await load.runChecks(client, {
        schema: 'scratch_test',
        spec: platoReadingsSpec,
        rows: rows
      });
      expect(result.ok).toBe(false);
      var badResults = result.results.filter(function (r) {
        return !r.ok;
      });
      expect(badResults.length).toBeGreaterThan(0);
      expect(badResults.some(function (r) { return r.column === 'plato'; })).toBe(true);
    });
  });

  describe('text min/max collation', function () {
    it('agrees between JS default sort and Postgres COLLATE "C" for mixed-case values', async function () {
      var rows = [
        fermRow({ schedule_id: 'FS-0001', name: 'apple' }),
        fermRow({ schedule_id: 'FS-0002', name: 'Banana' }),
        fermRow({ schedule_id: 'FS-0003', name: 'cherry' })
      ];
      await load.loadScratch(client, { schema: 'scratch_test', spec: fermSchedulesSpec, rows: rows });

      var result = await load.runChecks(client, { schema: 'scratch_test', spec: fermSchedulesSpec, rows: rows });
      expect(result.ok).toBe(true);
    });
  });

  describe('promote', function () {
    it('throws when the target table does not exist', async function () {
      var rows = [platoRow({ reading_id: 'PR-000001' })];
      await load.loadScratch(client, { schema: 'scratch_test', spec: platoReadingsSpec, rows: rows });

      await expect(
        load.promote(client, { schema: 'scratch_test', spec: platoReadingsSpec, targetSchema: 'public' })
      ).rejects.toThrow('target table public.plato_readings does not exist');
    });

    it('promotes into an empty test-created public table; refuses a non-empty target with no rows added', async function () {
      var rows = [
        platoRow({ reading_id: 'PR-000001' }),
        platoRow({ reading_id: 'PR-000002' })
      ];
      await load.loadScratch(client, { schema: 'scratch_test', spec: platoReadingsSpec, rows: rows });

      await client.query(
        'create table public.plato_readings (' +
          'reading_id text primary key, batch_id text, "timestamp" timestamptz, ' +
          'plato numeric(5,2), notes text, recorded_by text, created_at timestamptz, ' +
          'temperature numeric(5,2), ph numeric(4,2))'
      );

      var result = await load.promote(client, {
        schema: 'scratch_test',
        spec: platoReadingsSpec,
        targetSchema: 'public'
      });
      expect(result.promoted).toBe(2);

      var countCheck = await client.query('select count(*)::int as count from public.plato_readings');
      expect(countCheck.rows[0].count).toBe(2);

      // Now non-empty — a second promote must refuse, no rows added.
      await expect(
        load.promote(client, { schema: 'scratch_test', spec: platoReadingsSpec, targetSchema: 'public' })
      ).rejects.toThrow('not empty');

      var countAfter = await client.query('select count(*)::int as count from public.plato_readings');
      expect(countAfter.rows[0].count).toBe(2);
    });
  });

  describe('dbStatus', function () {
    it('reports migrations, appMeta and scratch schemas on a freshly migrated container', async function () {
      var rows = [platoRow({ reading_id: 'PR-000001' })];
      await load.loadScratch(client, { schema: 'scratch_test', spec: platoReadingsSpec, rows: rows });

      var status = await load.dbStatus(client);
      expect(status.migrations).toContain('0001_init');
      expect(status.appMeta.schema_initialized_by).toBeDefined();
      expect(status.scratchSchemas).toContain('scratch_test');
    });
  });

  describe('table hygiene', function () {
    it('no table other than the test-created target exists in public except app_meta and pgmigrations', async function () {
      var rows = [platoRow({ reading_id: 'PR-000001' })];
      await load.loadScratch(client, { schema: 'scratch_test', spec: platoReadingsSpec, rows: rows });

      var tables = await client.query(
        "select table_name from information_schema.tables where table_schema='public' order by table_name"
      );
      var names = tables.rows.map(function (r) {
        return r.table_name;
      });
      names.forEach(function (n) {
        expect(['app_meta', 'pgmigrations'].indexOf(n)).not.toBe(-1);
      });
    });
  });
});
