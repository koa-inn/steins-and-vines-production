/**
 * Reads an .xlsx snapshot (the owner's File -> Download, D-09) into row objects.
 * exceljs-only — never the abandoned `xlsx`/SheetJS npm package (Research Pitfall 5).
 */
'use strict';

var fs = require('fs');

function richTextToString(val) {
  return val.richText.map(function (part) { return part.text || ''; }).join('');
}

// Unwraps a raw exceljs cell.value into a plain primitive: string | number |
// boolean | Date | null | { cellError: '#REF!' }. Formulas contribute only
// their cached result — never re-evaluated.
function cellToPrimitive(cellValue) {
  if (cellValue === null || cellValue === undefined) return null;
  if (cellValue instanceof Date) return cellValue;
  var t = typeof cellValue;
  if (t === 'string' || t === 'number' || t === 'boolean') return cellValue;

  if (t === 'object') {
    if (cellValue.error !== undefined) {
      return { cellError: cellValue.error };
    }
    if (Array.isArray(cellValue.richText)) {
      return richTextToString(cellValue);
    }
    if (cellValue.formula !== undefined) {
      return cellValue.result !== undefined ? cellToPrimitive(cellValue.result) : null;
    }
    if (cellValue.hyperlink !== undefined) {
      return cellValue.text !== undefined ? cellValue.text : null;
    }
  }
  return null;
}

function isEmptyPrimitive(primitive) {
  return primitive === null || primitive === '';
}

function readSheet(filePath, sheetName) {
  if (!fs.existsSync(filePath)) {
    return Promise.reject(new Error('snapshot not found: ' + filePath));
  }

  // exceljs is resolved at call time, not module load: its bundled readable-stream@3
  // lazily require()s ./_stream_duplex on the first stream it builds. Binding exceljs at
  // load time and then calling readSheet() after a module-registry reset (jest.resetModules()
  // in the DB tests) splits Writable and Duplex across registries -> PassThrough gets no
  // _writableState -> "Cannot read properties of undefined (reading 'objectMode')".
  var ExcelJS = require('exceljs');
  var workbook = new ExcelJS.Workbook();
  return workbook.xlsx.readFile(filePath).then(function () {
    var worksheet = workbook.getWorksheet(sheetName);
    if (!worksheet) {
      var available = workbook.worksheets.map(function (ws) { return ws.name; });
      throw new Error(
        'sheet "' + sheetName + '" not found in ' + filePath +
        ' — available sheets: ' + available.join(', ')
      );
    }

    // Headers from row 1, trimmed strings, keyed by column number (1-based, sparse).
    var headerRow = worksheet.getRow(1);
    var headersByCol = {};
    var maxCol = 0;
    headerRow.eachCell({ includeEmpty: false }, function (cell, colNumber) {
      var raw = cellToPrimitive(cell.value);
      var text = raw === null || raw === undefined ? '' : String(raw).trim();
      headersByCol[colNumber] = text;
      if (colNumber > maxCol) maxCol = colNumber;
    });

    var seen = {};
    for (var c = 1; c <= maxCol; c++) {
      var name = headersByCol[c];
      if (name === undefined) continue;
      if (name === '') {
        throw new Error('blank header in column ' + c + ' of sheet "' + sheetName + '" — cannot map columns positionally');
      }
      if (seen[name]) {
        throw new Error('duplicate header "' + name + '" in sheet "' + sheetName + '" — cannot map columns unambiguously');
      }
      seen[name] = true;
    }

    var headers = [];
    for (var i = 1; i <= maxCol; i++) {
      if (headersByCol[i] !== undefined) headers.push(headersByCol[i]);
    }

    var rows = [];
    var skippedEmpty = 0;

    worksheet.eachRow({ includeEmpty: false }, function (row, rowNumber) {
      if (rowNumber === 1) return; // header row already consumed

      var values = {};
      var allEmpty = true;
      for (var col = 1; col <= maxCol; col++) {
        var header = headersByCol[col];
        if (header === undefined) continue;
        var primitive = cellToPrimitive(row.getCell(col).value);
        values[header] = primitive;
        if (!isEmptyPrimitive(primitive)) allEmpty = false;
      }

      if (allEmpty) {
        skippedEmpty++;
        return;
      }

      rows.push({ rowNumber: rowNumber, values: values });
    });

    return { headers: headers, rows: rows, skippedEmpty: skippedEmpty };
  });
}

module.exports = { readSheet: readSheet, cellToPrimitive: cellToPrimitive };
