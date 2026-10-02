'use strict';

/**
 * CR-04 regression tests (83-REVIEW.md, 83-VERIFICATION.md gap 3): the backfill CLI must
 * compare spec headers against the sheet's actual row-1 headers right after reading the
 * snapshot, and abort before normalising/loading/connecting when any spec header — required
 * or optional — is missing or renamed in the sheet. Extra sheet headers are surfaced as
 * "unmapped" without blocking anything.
 *
 * Task 2 appends a second describe block covering backfill.js passing the read count into
 * load.runChecks().
 *
 * No Postgres/Docker here — load is mocked; real-Postgres CR-04 coverage (read_vs_accepted,
 * empty-scratch promote refusal, the 100%-rejected end-to-end run) lives in
 * __tests__/db/backfill-gates.test.js.
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

var SPEC_HEADERS = platoSpec.columns.map(function (c) {
  return c.header;
});

var VALID_ROW = [
  'PR-000001',
  'SV-B-000001',
  '2026-01-15T08:00:00Z',
  '12.50',
  '',
  'staff',
  '2026-01-15T08:05:00Z',
  '',
  ''
];

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

var tmpDir;

beforeEach(function () {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-backfill-gates-'));
  load.loadScratch.mockReset().mockResolvedValue({ inserted: 1 });
  load.runChecks.mockReset().mockResolvedValue({
    ok: true,
    results: [{ check: 'row_count', expected: 1, actual: 1, ok: true }]
  });
  load.promote.mockReset().mockResolvedValue({ promoted: 1 });
});

afterEach(function () {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeWorkbook(headers, rows) {
  var filePath = path.join(tmpDir, 'snapshot-' + Math.random().toString(36).slice(2) + '.xlsx');
  var workbook = new ExcelJS.Workbook();
  var ws = workbook.addWorksheet('PlatoReadings');
  ws.addRow(headers);
  rows.forEach(function (r) {
    ws.addRow(r);
  });
  return workbook.xlsx.writeFile(filePath).then(function () {
    return filePath;
  });
}

function opts(filePath, overrides) {
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

function rejectsFilesIn(dir) {
  return fs.readdirSync(dir).filter(function (f) {
    return /^rejects-.*\.json$/.test(f);
  });
}

describe('backfill header drift (CR-04)', function () {
  it('aborts with exit 1 when an optional spec header is missing from the sheet, before connecting or loading', async function () {
    var headersWithoutPh = SPEC_HEADERS.filter(function (h) {
      return h !== 'ph';
    });
    var rowWithoutPh = VALID_ROW.slice(0, -1);
    var filePath = await writeWorkbook(headersWithoutPh, [rowWithoutPh]);
    var log = captureLog();
    var pool = fakePool();

    var result = await backfill.runBackfill(opts(filePath, { dryRun: false }), { pool: pool, log: log });

    expect(result.exitCode).toBe(backfill.EXIT.ERROR);
    expect(
      log.lines.some(function (l) {
        return l.indexOf('missing spec header(s): ph') !== -1;
      })
    ).toBe(true);
    expect(pool.connect).not.toHaveBeenCalled();
    expect(load.loadScratch).not.toHaveBeenCalled();
    expect(rejectsFilesIn(tmpDir)).toEqual([]);
  });

  it('names the missing spec header and lists the renamed sheet header as unmapped', async function () {
    var renamedHeaders = SPEC_HEADERS.map(function (h) {
      return h === 'degrees_plato' ? 'Degrees Plato' : h;
    });
    var filePath = await writeWorkbook(renamedHeaders, [VALID_ROW]);
    var log = captureLog();

    var result = await backfill.runBackfill(opts(filePath), { pool: fakePool(), log: log });

    expect(result.exitCode).toBe(backfill.EXIT.ERROR);
    expect(
      log.lines.some(function (l) {
        return l.indexOf('missing spec header(s): degrees_plato') !== -1;
      })
    ).toBe(true);
    expect(log.lines).toContain('Unmapped sheet header(s): Degrees Plato');
  });

  it('with dryRun:true, an extra sheet column is reported as unmapped but does not block normalisation', async function () {
    var headersPlusExtra = SPEC_HEADERS.concat(['Extra Col']);
    var rowPlusExtra = VALID_ROW.concat(['xyz']);
    var filePath = await writeWorkbook(headersPlusExtra, [rowPlusExtra]);
    var log = captureLog();

    var result = await backfill.runBackfill(opts(filePath, { dryRun: true }), { pool: fakePool(), log: log });

    expect(result.exitCode).toBe(backfill.EXIT.OK);
    expect(log.lines).toContain('Unmapped sheet header(s): Extra Col');
    expect(
      log.lines.some(function (l) {
        return /Read 1, accepted 1, rejected 0/.test(l);
      })
    ).toBe(true);
  });

  it('with exactly the spec headers and dryRun:true, no "Unmapped sheet header(s)" line is printed', async function () {
    var filePath = await writeWorkbook(SPEC_HEADERS, [VALID_ROW]);
    var log = captureLog();

    var result = await backfill.runBackfill(opts(filePath, { dryRun: true }), { pool: fakePool(), log: log });

    expect(result.exitCode).toBe(backfill.EXIT.OK);
    expect(
      log.lines.some(function (l) {
        return l.indexOf('Unmapped sheet header(s)') === 0;
      })
    ).toBe(false);
  });
});

describe('backfill passes the read count into runChecks (CR-04)', function () {
  it('calls load.runChecks with read equal to the number of rows read from the sheet', async function () {
    var filePath = await writeWorkbook(SPEC_HEADERS, [VALID_ROW]);
    var log = captureLog();

    var result = await backfill.runBackfill(opts(filePath, { dryRun: false }), {
      pool: fakePool(),
      log: log
    });

    expect(result.exitCode).toBe(backfill.EXIT.OK);
    expect(load.runChecks).toHaveBeenCalledTimes(1);
    expect(load.runChecks.mock.calls[0][1].read).toBe(1);
  });
});
