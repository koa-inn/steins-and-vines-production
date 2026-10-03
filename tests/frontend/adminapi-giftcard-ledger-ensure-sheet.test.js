'use strict';

// Behavioural regression coverage for ensureGiftCardLedgerSheet's bootstrap paths.
//
// The sibling suite (adminapi-giftcard-ledger.test.js) deliberately asserts on
// ensureGiftCardLedgerSheet by SOURCE SHAPE only, because apps-script/adminApi.gs has no local
// Sheets runtime. This suite closes that specific gap by injecting a fake SpreadsheetApp/Logger
// as `new Function` parameters (they shadow the Apps Script globals of the same name), exactly
// as adminapi-waitlist-ensure-sheet.test.js does for ensureWaitlistSheet.
//
// Regression under test: a `GiftCardTransactions` tab that already EXISTS but is completely
// EMPTY — created by hand, or left behind by a partial earlier setup run. The original
// implementation only wrote headers inside the `if (!sheet)` branch, then unconditionally called
// `sheet.getRange(1, 1, 1, sheet.getLastColumn())` with getLastColumn() === 0, which Apps Script
// rejects with "The number of columns in the range must be at least 1." That threw out of every
// live gift-card write path, since they all call this function (D-01's dual-window sheet leg
// re-runs these ops on every redeem/reload/issue, so this crash is hit continuously during dual).
//
// WHAT THIS SUITE STILL CANNOT PROVE: the fake is a model of the Sheets API, not the real thing.
// It fixes the shape of getLastColumn/getRange/appendRow that this bug turned on; it does not
// prove Google's runtime agrees. A live probe against a real Google Sheet remains the real gate.

var fs = require('fs');
var path = require('path');

var ADMIN_API_PATH = path.join(__dirname, '../../apps-script/adminApi.gs');

// --- Fake Sheets runtime (copied from adminapi-waitlist-ensure-sheet.test.js) --------------

function makeFakeSheet(rows) {
  var grid = rows ? rows.map(function (r) { return r.slice(); }) : [];
  var calls = { setFontWeight: [], setFrozenRows: [], appendRow: [] };

  return {
    _grid: grid,
    _calls: calls,

    // Last column containing content anywhere in the sheet. 0 for a wholly empty sheet — the
    // exact value that made the original getRange call throw.
    getLastColumn: function () {
      return grid.reduce(function (max, row) {
        return Math.max(max, row.length);
      }, 0);
    },

    appendRow: function (values) {
      calls.appendRow.push(values.slice());
      grid.push(values.slice());
    },

    getRange: function (row, col, numRows, numCols) {
      if (numCols < 1) {
        // Mirror the real Apps Script error this regression is about.
        throw new Error('The number of columns in the range must be at least 1.');
      }
      return {
        getValues: function () {
          var out = [];
          for (var r = 0; r < numRows; r++) {
            var src = grid[row - 1 + r] || [];
            var line = [];
            for (var c = 0; c < numCols; c++) {
              line.push(src[col - 1 + c] === undefined ? '' : src[col - 1 + c]);
            }
            out.push(line);
          }
          return out;
        },
        setFontWeight: function (weight) {
          calls.setFontWeight.push({ row: row, col: col, numRows: numRows, numCols: numCols, weight: weight });
          return this;
        }
      };
    },

    setFrozenRows: function (n) {
      calls.setFrozenRows.push(n);
    }
  };
}

function makeFakeSpreadsheetApp(sheetsByName) {
  var sheets = sheetsByName || {};
  var inserted = [];

  return {
    _inserted: inserted,
    _sheets: sheets,
    getActiveSpreadsheet: function () {
      return {
        getSheetByName: function (name) {
          return Object.prototype.hasOwnProperty.call(sheets, name) ? sheets[name] : null;
        },
        insertSheet: function (name) {
          inserted.push(name);
          var s = makeFakeSheet([]);
          sheets[name] = s;
          return s;
        }
      };
    }
  };
}

function loadEnsureGiftCardLedgerSheet(spreadsheetApp) {
  var src = fs.readFileSync(ADMIN_API_PATH, 'utf8');
  var logged = [];
  var logger = {
    log: function (msg) { logged.push(String(msg)); }
  };
  // SpreadsheetApp and Logger are declared as parameters here, so they shadow the Apps Script
  // globals that adminApi.gs references as free variables.
  var factory = new Function(
    'SpreadsheetApp',
    'Logger',
    src + '\nreturn {' +
      'ensureGiftCardLedgerSheet: (typeof ensureGiftCardLedgerSheet !== "undefined" ? ensureGiftCardLedgerSheet : undefined),' +
      'GIFT_CARD_TRANSACTIONS_SHEET_NAME: (typeof GIFT_CARD_TRANSACTIONS_SHEET_NAME !== "undefined" ? GIFT_CARD_TRANSACTIONS_SHEET_NAME : undefined)' +
      '};'
  );
  var api = factory(spreadsheetApp, logger);
  api._logged = logged;
  return api;
}

var HEADERS = [
  'tx_id', 'cert_number', 'tx_ref', 'kind', 'amount', 'balance_before',
  'balance_after', 'status', 'needs_manual_review', 'created_at', 'settled_at', 'notes'
];

// --- Tests ---------------------------------------------------------------------------------

describe('ensureGiftCardLedgerSheet — bootstrap branches (behavioural, fake Sheets runtime)', function () {
  test('creates the tab with the 12 bold, frozen headers when it is absent (headers written exactly once)', function () {
    var app = makeFakeSpreadsheetApp({});
    var api = loadEnsureGiftCardLedgerSheet(app);

    var result = api.ensureGiftCardLedgerSheet();

    expect(result.ok).toBe(true);
    expect(app._inserted).toEqual([api.GIFT_CARD_TRANSACTIONS_SHEET_NAME]);

    var sheet = app._sheets[api.GIFT_CARD_TRANSACTIONS_SHEET_NAME];
    expect(sheet._grid[0]).toEqual(HEADERS);
    // Headers written exactly once (not twice) — one appendRow call total.
    expect(sheet._calls.appendRow.length).toBe(1);
    expect(sheet._calls.setFrozenRows).toEqual([1]);
    expect(sheet._calls.setFontWeight.length).toBe(1);
    expect(sheet._calls.setFontWeight[0].weight).toBe('bold');
    expect(sheet._calls.setFontWeight[0].numCols).toBe(HEADERS.length);
  });

  // THE REGRESSION. Before the fix this threw
  // "The number of columns in the range must be at least 1."
  test('initialises an existing but completely EMPTY tab instead of throwing on getLastColumn() === 0', function () {
    var empty = makeFakeSheet([]);
    var app = makeFakeSpreadsheetApp({ GiftCardTransactions: empty });
    var api = loadEnsureGiftCardLedgerSheet(app);

    expect(empty.getLastColumn()).toBe(0);

    var result = api.ensureGiftCardLedgerSheet();

    expect(result.ok).toBe(true);
    expect(empty._grid[0]).toEqual(HEADERS);
    expect(empty._calls.appendRow.length).toBe(1);
    expect(empty._calls.setFrozenRows).toEqual([1]);
    expect(empty._calls.setFontWeight[0].weight).toBe('bold');
    // It must NOT have created a second tab to work around the empty one.
    expect(app._inserted).toEqual([]);
  });

  test('leaves a correctly-headered existing tab untouched and reports its column map', function () {
    var existing = makeFakeSheet([
      HEADERS.slice(),
      ['TX-0000001', 'GC-000001', 'KIOSK-1000', 'redeem', 10, 50, 40, 'settled', false, '2026-09-02T00:00:00.000Z', '2026-09-02T00:00:01.000Z', '']
    ]);
    var app = makeFakeSpreadsheetApp({ GiftCardTransactions: existing });
    var api = loadEnsureGiftCardLedgerSheet(app);

    var result = api.ensureGiftCardLedgerSheet();

    expect(result.ok).toBe(true);
    expect(existing._calls.appendRow).toEqual([]);
    expect(existing._calls.setFrozenRows).toEqual([]);
    expect(existing._grid.length).toBe(2);
    expect(result.col.tx_id).toBe(1);
    expect(result.col.notes).toBe(HEADERS.length);
  });

  test('existing tab missing a header -> fails closed with ledger_unavailable and the missing list', function () {
    var drifted = makeFakeSheet([[
      'tx_id', 'cert_number', 'tx_ref', 'kind', 'amount', 'balance_before',
      'status', 'needs_manual_review', 'created_at', 'notes'
    ]]);
    var app = makeFakeSpreadsheetApp({ GiftCardTransactions: drifted });
    var api = loadEnsureGiftCardLedgerSheet(app);

    var result = api.ensureGiftCardLedgerSheet();

    expect(result.ok).toBe(false);
    expect(result.error).toBe('ledger_unavailable');
    expect(result.missing).toEqual(['balance_after', 'settled_at']);
    // Fail-closed means it did not rewrite the header row.
    expect(drifted._calls.appendRow).toEqual([]);
  });
});
