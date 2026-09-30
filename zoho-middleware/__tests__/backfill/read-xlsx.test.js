'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');
var ExcelJS = require('exceljs');
var readXlsx = require('../../scripts/backfill/read-xlsx');

var TMP_DIR;

beforeEach(function () {
  TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-backfill-test-'));
});

afterEach(function () {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

function buildWorkbook() {
  var wb = new ExcelJS.Workbook();
  var ws = wb.addWorksheet('Sheet1');

  ws.addRow([
    'str_col', 'num_col', 'date_col', 'bool_col',
    'rich_col', 'formula_col', 'hyperlink_col', 'error_col'
  ]);

  var dataRow = ws.addRow([
    'hello', 42, new Date(Date.UTC(2026, 8, 2, 14, 3)), true,
    null, null, null, null
  ]);
  dataRow.getCell(5).value = { richText: [{ text: 'foo ' }, { text: 'bar' }] };
  dataRow.getCell(6).value = { formula: 'A1+A1', result: 99 };
  dataRow.getCell(7).value = { text: 'Click me', hyperlink: 'http://example.com' };
  dataRow.getCell(8).value = { error: '#REF!' };

  // Fully empty row — real cells present (blank strings), every mapped value empty.
  ws.addRow(['', '', '', '', '', '', '', '']);

  return wb;
}

describe('readSheet', function () {
  test('reads headers from row 1, unwraps every cell type via cellToPrimitive, skips+counts the empty row', function () {
    var filePath = path.join(TMP_DIR, 'snapshot.xlsx');
    return buildWorkbook().xlsx.writeFile(filePath).then(function () {
      return readXlsx.readSheet(filePath, 'Sheet1');
    }).then(function (result) {
      expect(result.headers).toEqual([
        'str_col', 'num_col', 'date_col', 'bool_col',
        'rich_col', 'formula_col', 'hyperlink_col', 'error_col'
      ]);

      expect(result.rows).toHaveLength(1);
      var row = result.rows[0];
      expect(row.rowNumber).toBe(2); // matches the sheet row (row 1 is headers)
      expect(row.values.str_col).toBe('hello');
      expect(row.values.num_col).toBe(42);
      expect(row.values.date_col).toBeInstanceOf(Date);
      expect(row.values.date_col.toISOString()).toBe('2026-09-02T14:03:00.000Z');
      expect(row.values.bool_col).toBe(true);
      expect(row.values.rich_col).toBe('foo bar');
      expect(row.values.formula_col).toBe(99);
      expect(row.values.hyperlink_col).toBe('Click me');
      expect(row.values.error_col).toEqual({ cellError: '#REF!' });

      expect(result.skippedEmpty).toBe(1);
    });
  });

  test('unknown sheet name rejects with a message listing the available sheet names', function () {
    var filePath = path.join(TMP_DIR, 'snapshot2.xlsx');
    var wb = new ExcelJS.Workbook();
    wb.addWorksheet('RealSheet');
    return wb.xlsx.writeFile(filePath).then(function () {
      return expect(readXlsx.readSheet(filePath, 'NoSuchSheet')).rejects.toThrow(/RealSheet/);
    });
  });

  test('missing file rejects with "snapshot not found"', function () {
    var filePath = path.join(TMP_DIR, 'does-not-exist.xlsx');
    return expect(readXlsx.readSheet(filePath, 'Sheet1')).rejects.toThrow(/snapshot not found/);
  });

  test('duplicate headers reject the whole read', function () {
    var filePath = path.join(TMP_DIR, 'dupes.xlsx');
    var wb = new ExcelJS.Workbook();
    var ws = wb.addWorksheet('Sheet1');
    ws.addRow(['a', 'a', 'b']);
    ws.addRow(['1', '2', '3']);
    return wb.xlsx.writeFile(filePath).then(function () {
      return expect(readXlsx.readSheet(filePath, 'Sheet1')).rejects.toThrow(/duplicate header/);
    });
  });

  test('blank header rejects the whole read', function () {
    var filePath = path.join(TMP_DIR, 'blank-header.xlsx');
    var wb = new ExcelJS.Workbook();
    var ws = wb.addWorksheet('Sheet1');
    var headerRow = ws.addRow(['a', 'b']);
    headerRow.getCell(3).value = '   '; // whitespace-only header
    ws.addRow(['1', '2', '3']);
    return wb.xlsx.writeFile(filePath).then(function () {
      return expect(readXlsx.readSheet(filePath, 'Sheet1')).rejects.toThrow(/blank header/);
    });
  });
});

describe('cellToPrimitive', function () {
  test('passes through string/number/boolean/null unchanged', function () {
    expect(readXlsx.cellToPrimitive('x')).toBe('x');
    expect(readXlsx.cellToPrimitive(5)).toBe(5);
    expect(readXlsx.cellToPrimitive(false)).toBe(false);
    expect(readXlsx.cellToPrimitive(null)).toBeNull();
  });
  test('passes through a Date unchanged', function () {
    var d = new Date();
    expect(readXlsx.cellToPrimitive(d)).toBe(d);
  });
  test('unwraps rich text', function () {
    expect(readXlsx.cellToPrimitive({ richText: [{ text: 'a' }, { text: 'b' }] })).toBe('ab');
  });
  test('unwraps a formula to its cached result', function () {
    expect(readXlsx.cellToPrimitive({ formula: '1+1', result: 2 })).toBe(2);
  });
  test('unwraps a hyperlink to its display text', function () {
    expect(readXlsx.cellToPrimitive({ text: 'label', hyperlink: 'http://x' })).toBe('label');
  });
  test('unwraps an error cell to { cellError }', function () {
    expect(readXlsx.cellToPrimitive({ error: '#DIV/0!' })).toEqual({ cellError: '#DIV/0!' });
  });
});
