'use strict';

/**
 * Regression tests for CR-03 (83-REVIEW.md) / D-12: cellToPrimitive must fail closed
 * on exceljs value shapes it does not recognise, instead of returning null (which the
 * pipeline treats as an empty/optional cell). sharedFormula is unwrapped like formula,
 * a hyperlink whose text is itself rich text is flattened, and formulas with no cached
 * result, text-less hyperlinks, and genuinely unknown shapes become { cellError }.
 */

var fs = require('fs');
var os = require('os');
var path = require('path');
var ExcelJS = require('exceljs');
var readXlsx = require('../../scripts/backfill/read-xlsx');
var normalize = require('../../scripts/backfill/normalize');
var specs = require('../../scripts/backfill/specs');

var TMP_DIR;

beforeEach(function () {
  TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-backfill-cellshapes-'));
});

afterEach(function () {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

describe('cellToPrimitive fails closed on unhandled exceljs shapes (CR-03, D-12)', function () {
  test('sharedFormula with a result unwraps like formula', function () {
    expect(readXlsx.cellToPrimitive({ sharedFormula: 'A2', result: 'x' })).toBe('x');
  });

  test('sharedFormula whose result is an error unwraps to { cellError }', function () {
    expect(readXlsx.cellToPrimitive({ sharedFormula: 'A2', result: { error: '#N/A' } }))
      .toEqual({ cellError: '#N/A' });
  });

  test('a formula with no cached result becomes { cellError: "formula has no cached result" }', function () {
    expect(readXlsx.cellToPrimitive({ formula: 'A1+1' }))
      .toEqual({ cellError: 'formula has no cached result' });
  });

  test('a sharedFormula with no result becomes { cellError: "formula has no cached result" }', function () {
    expect(readXlsx.cellToPrimitive({ sharedFormula: 'A2' }))
      .toEqual({ cellError: 'formula has no cached result' });
  });

  test('a hyperlink whose text is rich text is flattened', function () {
    expect(readXlsx.cellToPrimitive({
      hyperlink: 'http://x',
      text: { richText: [{ text: 'a' }, { text: 'b' }] }
    })).toBe('ab');
  });

  test('a hyperlink with no text becomes { cellError: "hyperlink has no display text" }', function () {
    expect(readXlsx.cellToPrimitive({ hyperlink: 'http://x' }))
      .toEqual({ cellError: 'hyperlink has no display text' });
  });

  test('an empty object becomes { cellError: "unsupported cell value" }', function () {
    expect(readXlsx.cellToPrimitive({})).toEqual({ cellError: 'unsupported cell value' });
  });

  test('an unrecognised object shape becomes { cellError: "unsupported cell value" }', function () {
    expect(readXlsx.cellToPrimitive({ foo: 1 })).toEqual({ cellError: 'unsupported cell value' });
  });

  test('a bigint becomes { cellError: "unsupported cell value" }', function () {
    expect(readXlsx.cellToPrimitive(BigInt(1))).toEqual({ cellError: 'unsupported cell value' });
  });

  test('existing expectations still hold: null/number/string/boolean passthrough', function () {
    expect(readXlsx.cellToPrimitive(null)).toBeNull();
    expect(readXlsx.cellToPrimitive(undefined)).toBeNull();
    expect(readXlsx.cellToPrimitive('x')).toBe('x');
    expect(readXlsx.cellToPrimitive(5)).toBe(5);
    expect(readXlsx.cellToPrimitive(false)).toBe(false);
  });

  test('existing expectations still hold: formula/result and hyperlink/text unwrap', function () {
    expect(readXlsx.cellToPrimitive({ formula: '1+1', result: 2 })).toBe(2);
    expect(readXlsx.cellToPrimitive({ text: 'label', hyperlink: 'http://x' })).toBe('label');
  });
});

describe('real .xlsx round trip: unreadable cells reject through normalizeRow (CR-03)', function () {
  test('a cell-error notes cell and a boolean vessel_id cell both reject after readSheet + normalizeRow', function () {
    var vesselHistorySpec = specs.getSpec('VesselHistory');
    var headers = vesselHistorySpec.columns.map(function (c) { return c.header; });

    var wb = new ExcelJS.Workbook();
    var ws = wb.addWorksheet('VesselHistory');
    ws.addRow(headers);
    var dataRow = ws.addRow([
      'VH-000002', 'SV-B-000001', true, '', '',
      new Date(Date.UTC(2026, 8, 2, 21, 3)), '', ''
    ]);
    // notes is the last column — set it to a cell-error object directly.
    dataRow.getCell(headers.length).value = { error: '#REF!' };

    var filePath = path.join(TMP_DIR, 'vessel-history.xlsx');
    return wb.xlsx.writeFile(filePath).then(function () {
      return readXlsx.readSheet(filePath, 'VesselHistory');
    }).then(function (result) {
      expect(result.rows).toHaveLength(1);
      var row = result.rows[0];
      var normalized = normalize.normalizeRow(vesselHistorySpec, row.values, { timezone: 'America/Vancouver' });
      expect(normalized.ok).toBe(false);
      var columns = normalized.reasons.map(function (r) { return r.column; });
      expect(columns).toEqual(expect.arrayContaining(['note', 'vessel_id']));
    });
  });
});

describe('readSheet rejects unreadable header cells (CR-03)', function () {
  test('an error-object header cell throws "unreadable header"', function () {
    var wb = new ExcelJS.Workbook();
    var ws = wb.addWorksheet('Sheet1');
    var headerRow = ws.addRow(['a', 'b']);
    headerRow.getCell(1).value = { error: '#REF!' };
    ws.addRow(['1', '2']);

    var filePath = path.join(TMP_DIR, 'bad-header.xlsx');
    return wb.xlsx.writeFile(filePath).then(function () {
      return expect(readXlsx.readSheet(filePath, 'Sheet1')).rejects.toThrow(/unreadable header in column 1/);
    });
  });
});
