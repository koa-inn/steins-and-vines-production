'use strict';

/**
 * Real-Postgres CR-04 regression tests (83-REVIEW.md, 83-VERIFICATION.md gap 3):
 * - runChecks must fail when rows were read but none were accepted (`read_vs_accepted`).
 * - promote() must refuse to run against an empty scratch table, before it ever
 *   touches the target.
 * - An end-to-end 100%-rejected run must exit CHECKS_FAILED (3) and never promote.
 *
 * Runs ONLY via `npm run test:db` (jest.db.config.js), gated by describeDb()'s D-14 rule:
 * skipped locally without Docker, never skipped on CI. Uses its own container (does not
 * share state with __tests__/db/backfill.test.js, which this file does not modify).
 */

var fs = require('fs');
var os = require('os');
var path = require('path');
var ExcelJS = require('exceljs');

var pgHarness = require('./helpers/pg-harness');
var describeDb = pgHarness.describeDb;
var startPostgres = pgHarness.startPostgres;
var applyMigrations = pgHarness.applyMigrations;

var load = require('../../scripts/backfill/load');
var normalizeRow = require('../../scripts/backfill/normalize').normalizeRow;
var platoReadingsSpec = require('../../scripts/backfill/specs/plato-readings');
var backfill = require('../../scripts/backfill/backfill');

var TIMEZONE = 'America/Vancouver';

function captureLog() {
  var lines = [];
  var log = function (msg) {
    lines.push(String(msg));
  };
  log.lines = lines;
  return log;
}

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
    degrees_plato: '12.50',
    notes: '',
    recorded_by: 'staff',
    created_at: '2026-01-15T08:05:00Z',
    temperature: '',
    ph: ''
  };
  Object.assign(base, overrides || {});
  return normalize(platoReadingsSpec, base);
}

// Writes a throwaway .xlsx into os.tmpdir() (no Sheets API, matching D-09) with a
// PlatoReadings sheet built from raw (pre-normalisation) row objects keyed by header.
function buildPlatoReadingsXlsx(rows) {
  var workbook = new ExcelJS.Workbook();
  var worksheet = workbook.addWorksheet('PlatoReadings');
  var headers = platoReadingsSpec.columns.map(function (c) {
    return c.header;
  });
  worksheet.addRow(headers);
  rows.forEach(function (row) {
    worksheet.addRow(
      headers.map(function (h) {
        return row[h] !== undefined ? row[h] : '';
      })
    );
  });
  var filePath = path.join(
    os.tmpdir(),
    'backfill-gates-fixture-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.xlsx'
  );
  return workbook.xlsx.writeFile(filePath).then(function () {
    return filePath;
  });
}

describeDb('backfill gates against real Postgres (CR-04)', function () {
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
    process.env.BACKFILL_DATABASE_URL = connectionString;
  }, 120000);

  afterAll(async function () {
    delete process.env.BACKFILL_DATABASE_URL;
    if (client) client.release();
    if (pool) await pool.end();
    if (container) await container.stop();
  }, 60000);

  afterEach(async function () {
    await client.query('drop schema if exists scratch_test cascade');
    await client.query('drop schema if exists scratch_backfill cascade');
    await client.query('drop table if exists public.plato_readings');
  });

  describe('runChecks read_vs_accepted', function () {
    it('fails when rows were read but none were accepted', async function () {
      await load.loadScratch(client, { schema: 'scratch_test', spec: platoReadingsSpec, rows: [] });

      var result = await load.runChecks(client, {
        schema: 'scratch_test',
        spec: platoReadingsSpec,
        rows: [],
        read: 4
      });

      expect(result.ok).toBe(false);
      var readVsAccepted = result.results.filter(function (r) {
        return r.check === 'read_vs_accepted';
      });
      expect(readVsAccepted.length).toBe(1);
      expect(readVsAccepted[0].ok).toBe(false);
      expect(typeof readVsAccepted[0].expected).toBe('number');
      expect(typeof readVsAccepted[0].actual).toBe('number');
    });

    it('passes when read is 0 — an empty sheet is not a drift signal; promote refuses it separately', async function () {
      await load.loadScratch(client, { schema: 'scratch_test', spec: platoReadingsSpec, rows: [] });

      var result = await load.runChecks(client, {
        schema: 'scratch_test',
        spec: platoReadingsSpec,
        rows: [],
        read: 0
      });

      var readVsAccepted = result.results.filter(function (r) {
        return r.check === 'read_vs_accepted';
      });
      expect(readVsAccepted[0].ok).toBe(true);
    });

    it('passes when rows were read and accepted', async function () {
      var r1 = platoRow({ reading_id: 'PR-000001' });
      await load.loadScratch(client, { schema: 'scratch_test', spec: platoReadingsSpec, rows: [r1] });

      var result = await load.runChecks(client, {
        schema: 'scratch_test',
        spec: platoReadingsSpec,
        rows: [r1],
        read: 2
      });

      var readVsAccepted = result.results.filter(function (r) {
        return r.check === 'read_vs_accepted';
      });
      expect(readVsAccepted[0].ok).toBe(true);
      expect(result.ok).toBe(true);
    });

    it('defaults read to rows.length for back-compat when the caller omits it', async function () {
      var r1 = platoRow({ reading_id: 'PR-000001' });
      await load.loadScratch(client, { schema: 'scratch_test', spec: platoReadingsSpec, rows: [r1] });

      var result = await load.runChecks(client, {
        schema: 'scratch_test',
        spec: platoReadingsSpec,
        rows: [r1]
      });

      expect(result.ok).toBe(true);
    });
  });

  describe('promote refuses an empty scratch table', function () {
    it('rejects before touching the target; target row count stays 0', async function () {
      await load.loadScratch(client, { schema: 'scratch_test', spec: platoReadingsSpec, rows: [] });
      await client.query(
        'create table public.plato_readings (' +
          'reading_id text primary key, batch_id text, "timestamp" timestamptz, ' +
          'plato numeric(5,2), notes text, recorded_by text, created_at timestamptz, ' +
          'temperature numeric(5,2), ph numeric(4,2))'
      );

      await expect(
        load.promote(client, { schema: 'scratch_test', spec: platoReadingsSpec, targetSchema: 'public' })
      ).rejects.toThrow(/scratch table scratch_test\.plato_readings is empty/);

      var countCheck = await client.query('select count(*)::int as count from public.plato_readings');
      expect(countCheck.rows[0].count).toBe(0);
    });
  });

  describe('end-to-end: 100% rejected sheet', function () {
    it('exits CHECKS_FAILED (3) on read_vs_accepted, never reaches promote, target stays at 0 rows', async function () {
      var filePath = await buildPlatoReadingsXlsx([
        {
          reading_id: 'PR-000001',
          batch_id: 'SV-B-000001',
          timestamp: 'not-a-real-date',
          degrees_plato: '12.50',
          notes: '',
          recorded_by: 'staff',
          created_at: '2026-01-15T08:05:00Z',
          temperature: '',
          ph: ''
        },
        {
          reading_id: 'PR-000002',
          batch_id: 'SV-B-000001',
          timestamp: 'not-a-real-date',
          degrees_plato: '11.00',
          notes: '',
          recorded_by: 'staff',
          created_at: '2026-01-16T08:05:00Z',
          temperature: '',
          ph: ''
        },
        {
          reading_id: 'PR-000003',
          batch_id: 'SV-B-000001',
          timestamp: 'not-a-real-date',
          degrees_plato: '10.50',
          notes: '',
          recorded_by: 'staff',
          created_at: '2026-01-17T08:05:00Z',
          temperature: '',
          ph: ''
        }
      ]);
      var outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-backfill-gates-out-'));
      var log = captureLog();

      await client.query(
        'create table public.plato_readings (' +
          'reading_id text primary key, batch_id text, "timestamp" timestamptz, ' +
          'plato numeric(5,2), notes text, recorded_by text, created_at timestamptz, ' +
          'temperature numeric(5,2), ph numeric(4,2))'
      );

      try {
        var result = await backfill.runBackfill(
          {
            file: filePath,
            sheet: 'PlatoReadings',
            schema: 'scratch_backfill',
            timezone: TIMEZONE,
            outDir: outDir,
            promote: true,
            acceptRejects: true,
            status: false,
            dryRun: false,
            yes: true
          },
          { pool: pool, log: log }
        );

        expect(result.exitCode).toBe(backfill.EXIT.CHECKS_FAILED);
        expect(
          log.lines.some(function (l) {
            return /^Checks: FAIL — read_vs_accepted/.test(l);
          })
        ).toBe(true);
        expect(
          log.lines.some(function (l) {
            return l === '[6/6] Promote';
          })
        ).toBe(false);

        var countCheck = await client.query('select count(*)::int as count from public.plato_readings');
        expect(countCheck.rows[0].count).toBe(0);
      } finally {
        fs.unlinkSync(filePath);
        fs.rmSync(outDir, { recursive: true, force: true });
      }
    });
  });
});
