'use strict';

/**
 * Step [5/6] Checks must always print a result line, and a checks failure must set
 * EXIT.CHECKS_FAILED (README exit-code table, code 3).
 *
 * Regression for the 2026-10-02 rehearsal: step [5/6] printed only its heading — no
 * PASS/FAIL — so the operator couldn't tell from the terminal whether the checks ran
 * clean. No Postgres/Docker here: load.loadScratch/runChecks are mocked and the pool is
 * a fake; the real-Postgres path is covered by __tests__/db/backfill.test.js.
 */

var fs = require('fs');
var os = require('os');
var path = require('path');
var ExcelJS = require('exceljs');

jest.mock('../../scripts/backfill/load', function () {
  var actual = jest.requireActual('../../scripts/backfill/load');
  return Object.assign({}, actual, {
    loadScratch: jest.fn(),
    runChecks: jest.fn(),
    promote: jest.fn()
  });
});

var load = require('../../scripts/backfill/load');
var backfill = require('../../scripts/backfill/backfill');
var platoSpec = require('../../scripts/backfill/specs/plato-readings');

var tmpDir;
var filePath;

function fakePool() {
  var client = {
    query: jest.fn(function () {
      return Promise.resolve({ rows: [{ database: 'railway' }] });
    }),
    release: jest.fn()
  };
  return {
    client: client,
    connect: jest.fn(function () {
      return Promise.resolve(client);
    })
  };
}

function captureLog() {
  var lines = [];
  var log = function (msg) {
    lines.push(String(msg));
  };
  log.lines = lines;
  return log;
}

function opts(overrides) {
  return Object.assign(
    {
      file: filePath,
      sheet: 'PlatoReadings',
      schema: 'scratch_backfill',
      timezone: 'America/Vancouver',
      outDir: tmpDir,
      promote: false,
      acceptRejects: false,
      status: false,
      dryRun: false,
      yes: true
    },
    overrides || {}
  );
}

beforeAll(function () {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-backfill-checks-'));
  filePath = path.join(tmpDir, 'snapshot.xlsx');
  var workbook = new ExcelJS.Workbook();
  var ws = workbook.addWorksheet('PlatoReadings');
  ws.addRow(platoSpec.columns.map(function (c) { return c.header; }));
  ws.addRow([
    'PR-000001', 'SV-B-000001', '2026-01-15T08:00:00Z', '12.50', '', 'staff',
    '2026-01-15T08:05:00Z', '', ''
  ]);
  return workbook.xlsx.writeFile(filePath);
});

afterAll(function () {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(function () {
  load.loadScratch.mockReset().mockResolvedValue({ inserted: 1 });
  load.runChecks.mockReset();
  load.promote.mockReset().mockResolvedValue({ promoted: 1 });
});

describe('backfill CLI step [5/6] Checks result line', function () {
  it('prints "Checks: PASS (n checks)" right after the step heading when every check passes', async function () {
    load.runChecks.mockResolvedValue({
      ok: true,
      results: [
        { check: 'row_count', expected: 1, actual: 1, ok: true },
        { check: 'null_count', column: 'plato', expected: 0, actual: 0, ok: true },
        { check: 'min', column: 'plato', expected: 12.5, actual: 12.5, ok: true }
      ]
    });
    var log = captureLog();

    var result = await backfill.runBackfill(opts(), { pool: fakePool(), log: log });

    expect(result.exitCode).toBe(backfill.EXIT.OK);
    var idx = log.lines.indexOf('[5/6] Checks');
    expect(idx).toBeGreaterThan(-1);
    expect(log.lines[idx + 1]).toBe('Checks: PASS (3 checks)');
  });

  it('prints "Checks: FAIL — <failed check names>" and exits CHECKS_FAILED (3) without promoting', async function () {
    load.runChecks.mockResolvedValue({
      ok: false,
      results: [
        { check: 'row_count', expected: 1, actual: 0, ok: false },
        { check: 'null_count', column: 'plato', expected: 0, actual: 0, ok: true },
        { check: 'max', column: 'plato', expected: 12.5, actual: 99, ok: false }
      ]
    });
    var log = captureLog();

    var result = await backfill.runBackfill(opts({ promote: true }), { pool: fakePool(), log: log });

    expect(result.exitCode).toBe(backfill.EXIT.CHECKS_FAILED);
    expect(backfill.EXIT.CHECKS_FAILED).toBe(3);
    expect(load.promote).not.toHaveBeenCalled();
    var idx = log.lines.indexOf('[5/6] Checks');
    expect(idx).toBeGreaterThan(-1);
    expect(log.lines[idx + 1]).toBe('Checks: FAIL — row_count, plato.max (2 of 3 checks failed)');
  });

  it('never prints expected/actual values (may be row data) in the Checks line', async function () {
    load.runChecks.mockResolvedValue({
      ok: false,
      results: [{ check: 'min', column: 'notes', expected: 'secret-alpha', actual: 'secret-beta', ok: false }]
    });
    var log = captureLog();

    await backfill.runBackfill(opts(), { pool: fakePool(), log: log });

    log.lines.forEach(function (line) {
      expect(line).not.toMatch(/secret-/);
    });
  });
});
