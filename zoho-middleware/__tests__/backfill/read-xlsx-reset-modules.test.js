'use strict';

/**
 * Regression: readSheet() must still work when jest.resetModules() runs between loading
 * read-xlsx.js and calling readSheet() (exactly what __tests__/db/backfill.test.js's
 * beforeAll does before runBackfill). exceljs's bundled readable-stream@3 resolves
 * `./_stream_duplex` lazily on the first stream construction; if exceljs was bound at
 * read-xlsx.js load time, that lazy require lands in the fresh registry, the PassThrough
 * fails its `instanceof Duplex` check, gets no _writableState, and readFile() rejects with
 * "Cannot read properties of undefined (reading 'objectMode')".
 */

var fs = require('fs');
var os = require('os');
var path = require('path');

var TMP_DIR;

beforeEach(function () {
  TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-backfill-reset-'));
});

afterEach(function () {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

test('readSheet survives jest.resetModules() between module load and the read', function () {
  var readXlsx = require('../../scripts/backfill/read-xlsx');
  jest.resetModules();

  var ExcelJS = require('exceljs');
  var wb = new ExcelJS.Workbook();
  var ws = wb.addWorksheet('Sheet1');
  ws.addRow(['id', 'value']);
  ws.addRow(['A-1', 7]);

  var filePath = path.join(TMP_DIR, 'snapshot.xlsx');
  return wb.xlsx
    .writeFile(filePath)
    .then(function () {
      return readXlsx.readSheet(filePath, 'Sheet1');
    })
    .then(function (result) {
      expect(result.headers).toEqual(['id', 'value']);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].values).toEqual({ id: 'A-1', value: 7 });
    });
});
