'use strict';

// Phase 89 review MD-02 (2026-10-16): the Recipes self-migrating column helpers
// (ensureRecipesPricingModeColumn / ScheduleIdColumn / BeerCategoryColumn) read the header row with
// sheet.getRange(1, 1, 1, sheet.getLastColumn()). On a Recipes tab that exists but is completely
// empty, getLastColumn() is 0 and Apps Script throws "The number of columns in the range must be
// at least 1." Every recipe write (create, update, mirror) calls all three, so an empty tab broke
// them all. setupRecipeBeerCategoryColumn also passed a missing tab straight in (opaque TypeError).
// Same crash class as Phase 78's Waitlist tab (memory: appsscript-sheet-bootstrap-empty-tab).
// Harness modelled on adminapi-waitlist-ensure-sheet.test.js: a fake SpreadsheetApp injected as a
// `new Function` parameter. It models the Sheets API shape; it does not prove Google's runtime.

var fs = require('fs');
var path = require('path');

var ADMIN_API_PATH = path.join(__dirname, '../../apps-script/adminApi.gs');

function makeFakeSheet(rows) {
  var grid = rows ? rows.map(function (r) { return r.slice(); }) : [];
  return {
    _grid: grid,
    getLastColumn: function () {
      return grid.reduce(function (max, row) { return Math.max(max, row.length); }, 0);
    },
    getRange: function (row, col, numRows, numCols) {
      if (numCols !== undefined && numCols < 1) {
        throw new Error('The number of columns in the range must be at least 1.');
      }
      var range = {
        getValues: function () {
          var out = [];
          for (var r = 0; r < numRows; r++) {
            var src = grid[row - 1 + r] || [];
            var line = [];
            for (var c = 0; c < numCols; c++) line.push(src[col - 1 + c] === undefined ? '' : src[col - 1 + c]);
            out.push(line);
          }
          return out;
        },
        setValue: function (v) {
          while (grid.length < row) grid.push([]);
          var line = grid[row - 1];
          while (line.length < col) line.push('');
          line[col - 1] = v;
          return range;
        },
        setFontWeight: function () { return range; }
      };
      return range;
    }
  };
}

function load(sheetsByName) {
  var src = fs.readFileSync(ADMIN_API_PATH, 'utf8');
  var logged = [];
  var spreadsheetApp = {
    getActiveSpreadsheet: function () {
      return { getSheetByName: function (n) { return Object.prototype.hasOwnProperty.call(sheetsByName, n) ? sheetsByName[n] : null; } };
    }
  };
  var factory = new Function('SpreadsheetApp', 'Logger', src + '\nreturn {' +
    'pm: ensureRecipesPricingModeColumn, sched: ensureRecipesScheduleIdColumn, bc: ensureRecipesBeerCategoryColumn,' +
    'setup: setupRecipeBeerCategoryColumn };');
  var api = factory(spreadsheetApp, { log: function (m) { logged.push(String(m)); } });
  api._logged = logged;
  return api;
}

describe('Recipes ensure-column helpers on an empty tab (MD-02)', function () {
  ['pm', 'sched', 'bc'].forEach(function (name) {
    test(name + ' does not throw on an empty tab and writes its header into column A', function () {
      var sheet = makeFakeSheet([]);
      var api = load({ Recipes: sheet });
      expect(function () { api[name](sheet); }).not.toThrow();
      expect(api[name](sheet)).toBe(0);
      expect(sheet._grid[0].length).toBe(1);
    });
  });

  test('all three in sequence on an empty tab give one column each, no duplicates', function () {
    var sheet = makeFakeSheet([]);
    var api = load({ Recipes: sheet });
    expect([api.pm(sheet), api.sched(sheet), api.bc(sheet)]).toEqual([0, 1, 2]);
    expect(sheet._grid[0]).toEqual(['pricing_mode', 'schedule_id', 'beer_category']);
  });

  test('a populated header row still appends at the end and finds existing columns', function () {
    var sheet = makeFakeSheet([['recipe_id', 'name', 'pricing_mode']]);
    var api = load({ Recipes: sheet });
    expect(api.pm(sheet)).toBe(2);
    expect(api.bc(sheet)).toBe(3);
    expect(sheet._grid[0]).toEqual(['recipe_id', 'name', 'pricing_mode', 'beer_category']);
  });

  test('setupRecipeBeerCategoryColumn logs and returns when the Recipes tab is missing', function () {
    var api = load({});
    expect(function () { api.setup(); }).not.toThrow();
    expect(api._logged.join('\n')).toMatch(/Recipes sheet missing/);
  });
});
