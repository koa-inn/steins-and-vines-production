'use strict';

// Phase 89 Plan 03 (D-03/D-04/D-05): Apps Script carries beer_category.
// Part 1: ensureRecipesBeerCategoryColumn self-migration (fake Sheets, modelled on
// adminapi-recipe-schedule-column.test.js).
// Part 2: the REAL createRecipe / updateRecipe / mirrorRecipeState run under a fake platform
// runtime (modelled on zoho-middleware/__tests__/recipe-d09-runtime-parity.test.js). Only
// SpreadsheetApp / LockService / Logger are faked; every helper is the real code.

var fs = require('fs');
var path = require('path');

var GS_SRC = fs.readFileSync(path.join(__dirname, '../../apps-script/adminApi.gs'), 'utf8');

var LEGACY16 = ['recipe_id', 'name', 'style', 'description', 'status', 'locked_price', 'service_fee',
  'materials_fee', 'batch_size_l', 'abv', 'ibu', 'colour_srm', 'notes', 'created_at', 'created_by',
  'updated_at'];
var WITH_PM_SCHED = LEGACY16.concat(['pricing_mode', 'schedule_id']);
var ING_HEADERS = ['ingredient_id', 'recipe_id', 'item_id', 'item_name', 'quantity', 'unit'];

function makeFakeSheet(headers, rows) {
  var data = [headers.slice()].concat((rows || []).map(function (r) { return r.slice(); }));
  var log = { writes: [], bold: [] };

  function pad(r) {
    while (data[r - 1] === undefined) data.push([]);
    return data[r - 1];
  }

  function range(r, c, nr, nc) {
    nr = nr || 1;
    nc = nc || 1;
    var rng = {
      getValues: function () {
        var out = [];
        for (var i = 0; i < nr; i++) {
          var row = [];
          for (var j = 0; j < nc; j++) {
            var v = (data[r - 1 + i] || [])[c - 1 + j];
            row.push(v === undefined ? '' : v);
          }
          out.push(row);
        }
        return out;
      },
      getFormulas: function () {
        var out = [];
        for (var i = 0; i < nr; i++) {
          var row = [];
          for (var j = 0; j < nc; j++) row.push('');
          out.push(row);
        }
        return out;
      },
      setValues: function (vals) {
        log.writes.push({ op: 'setValues', row: r, col: c });
        for (var i = 0; i < vals.length; i++) {
          var row = pad(r + i);
          for (var j = 0; j < vals[i].length; j++) row[c - 1 + j] = vals[i][j];
        }
        return rng;
      },
      setValue: function (v) {
        log.writes.push({ op: 'setValue', row: r, col: c, value: v });
        pad(r)[c - 1] = v;
        return rng;
      },
      setFontWeight: function (w) { log.bold.push({ row: r, col: c, weight: w }); return rng; }
    };
    return rng;
  }

  return {
    data: data,
    log: log,
    getLastRow: function () { return data.length; },
    getLastColumn: function () {
      return data.reduce(function (m, row) { return Math.max(m, row.length); }, 0);
    },
    getMaxRows: function () { return data.length + 1000; },
    getRange: range,
    getDataRange: function () {
      var w = data.reduce(function (m, row) { return Math.max(m, row.length); }, 0);
      return {
        getValues: function () {
          return data.map(function (r) {
            var copy = r.slice();
            while (copy.length < w) copy.push('');
            return copy;
          });
        }
      };
    },
    appendRow: function (row) { log.writes.push({ op: 'appendRow' }); data.push(row.slice()); },
    deleteRows: function (start, count) { log.writes.push({ op: 'deleteRows' }); data.splice(start - 1, count); }
  };
}

function load(sheets) {
  var locks = { acquired: 0, released: 0 };
  var SpreadsheetApp = {
    getActiveSpreadsheet: function () {
      return { getSheetByName: function (n) { return sheets[n] || null; } };
    }
  };
  var LockService = {
    getScriptLock: function () {
      return {
        waitLock: function () { locks.acquired++; },
        releaseLock: function () { locks.released++; }
      };
    }
  };
  var Logger = { log: function () {} };
  var api = new Function(
    'SpreadsheetApp', 'LockService', 'Logger',
    GS_SRC + '\nreturn {' +
      'createRecipe: createRecipe, updateRecipe: updateRecipe, mirrorRecipeState: mirrorRecipeState,' +
      'ensureRecipesBeerCategoryColumn: (typeof ensureRecipesBeerCategoryColumn !== "undefined" ? ensureRecipesBeerCategoryColumn : undefined),' +
      'ensureRecipesPricingModeColumn: ensureRecipesPricingModeColumn,' +
      'ensureRecipesScheduleIdColumn: ensureRecipesScheduleIdColumn' +
    '};'
  )(SpreadsheetApp, LockService, Logger);
  api.locks = locks;
  return api;
}

function setup(headers, recipeRows) {
  var recipes = makeFakeSheet(headers, recipeRows);
  var ings = makeFakeSheet(ING_HEADERS);
  var api = load({ Recipes: recipes, RecipeIngredients: ings });
  return { api: api, recipes: recipes, ings: ings };
}

function seedRow(headers, id, extra) {
  var row = headers.map(function () { return ''; });
  row[0] = id;
  row[1] = 'Seed';
  row[4] = 'active';
  Object.keys(extra || {}).forEach(function (k) { row[headers.indexOf(k)] = extra[k]; });
  return row;
}

function cell(sheet, rowIdx, header) {
  return sheet.data[rowIdx][sheet.data[0].indexOf(header)];
}

describe('ensureRecipesBeerCategoryColumn', function () {
  test('appends beer_category at lastCol+1, bold, returns zero-based index', function () {
    var t = setup(LEGACY16);
    var idx = t.api.ensureRecipesBeerCategoryColumn(t.recipes);
    expect(idx).toBe(16);
    expect(t.recipes.data[0].length).toBe(17);
    expect(t.recipes.data[0][16]).toBe('beer_category');
    expect(t.recipes.log.bold).toEqual([{ row: 1, col: 17, weight: 'bold' }]);
  });

  test('returns existing index and writes nothing when present', function () {
    var t = setup(['recipe_id', 'beer_category', 'name']);
    expect(t.api.ensureRecipesBeerCategoryColumn(t.recipes)).toBe(1);
    expect(t.recipes.log.writes).toEqual([]);
    expect(t.recipes.log.bold).toEqual([]);
  });

  test('idempotent: twice appends once', function () {
    var t = setup(['recipe_id', 'name']);
    var a = t.api.ensureRecipesBeerCategoryColumn(t.recipes);
    var b = t.api.ensureRecipesBeerCategoryColumn(t.recipes);
    expect(a).toBe(b);
    expect(t.recipes.data[0].filter(function (h) { return h === 'beer_category'; }).length).toBe(1);
  });

  test('all three ensures in sequence on legacy 16-col give pricing_mode, schedule_id, beer_category', function () {
    var t = setup(LEGACY16);
    t.api.ensureRecipesPricingModeColumn(t.recipes);
    t.api.ensureRecipesScheduleIdColumn(t.recipes);
    t.api.ensureRecipesBeerCategoryColumn(t.recipes);
    expect(t.recipes.data[0].slice(-3)).toEqual(['pricing_mode', 'schedule_id', 'beer_category']);
  });
});

describe('createRecipe - beer_category', function () {
  var ingredients = [{ item_id: 'I1', item_name: 'Malt', quantity: 1, unit: 'kg' }];

  test('valid value normalised and written by header lookup', function () {
    var t = setup(WITH_PM_SCHED);
    var res = t.api.createRecipe({ name: 'X', beer_category: 'IPA', ingredients: ingredients }, 'u@x');
    expect(res.ok).toBe(true);
    expect(cell(t.recipes, 1, 'beer_category')).toBe('ipa');
    expect(t.recipes.data[0][WITH_PM_SCHED.length]).toBe('beer_category');
  });

  test('no beer_category writes empty string', function () {
    var t = setup(WITH_PM_SCHED);
    expect(t.api.createRecipe({ name: 'X', ingredients: ingredients }, 'u@x').ok).toBe(true);
    expect(cell(t.recipes, 1, 'beer_category')).toBe('');
  });

  test('off-list value rejected with no writes and no lock', function () {
    var t = setup(WITH_PM_SCHED);
    var res = t.api.createRecipe({ name: 'X', beer_category: 'purple', ingredients: ingredients }, 'u@x');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('invalid_data');
    expect(t.recipes.data.length).toBe(1);
    expect(t.ings.data.length).toBe(1);
    expect(t.recipes.log.writes).toEqual([]);
    expect(t.ings.log.writes).toEqual([]);
    expect(t.api.locks.acquired).toBe(0);
  });
});

describe('updateRecipe - beer_category', function () {
  var HDR = WITH_PM_SCHED.concat(['beer_category']);

  function withRecipe(headers, extra) {
    return setup(headers, [seedRow(headers, 'SV-R-000001', extra)]);
  }

  test('sets normalised value', function () {
    var t = withRecipe(HDR);
    var res = t.api.updateRecipe({ recipe_id: 'SV-R-000001', beer_category: 'Red Ale' }, 'u');
    expect(res.ok).toBe(true);
    expect(cell(t.recipes, 1, 'beer_category')).toBe('redale');
  });

  test('undefined leaves the cell untouched', function () {
    var t = withRecipe(HDR, { beer_category: 'ipa' });
    expect(t.api.updateRecipe({ recipe_id: 'SV-R-000001', name: 'New' }, 'u').ok).toBe(true);
    expect(cell(t.recipes, 1, 'beer_category')).toBe('ipa');
  });

  test("'' clears the cell", function () {
    var t = withRecipe(HDR, { beer_category: 'ipa' });
    expect(t.api.updateRecipe({ recipe_id: 'SV-R-000001', beer_category: '' }, 'u').ok).toBe(true);
    expect(cell(t.recipes, 1, 'beer_category')).toBe('');
  });

  test('array value rejected before any write', function () {
    var t = withRecipe(HDR, { beer_category: 'ipa' });
    var res = t.api.updateRecipe({ recipe_id: 'SV-R-000001', beer_category: ['ipa'], name: 'Z' }, 'u');
    expect(res).toMatchObject({ ok: false, error: 'invalid_data' });
    expect(t.recipes.log.writes).toEqual([]);
    expect(cell(t.recipes, 1, 'beer_category')).toBe('ipa');
    expect(t.api.locks.acquired).toBe(t.api.locks.released);
  });

  test('off-list value rejected before any write (no header migration either)', function () {
    var t = withRecipe(LEGACY16);
    var res = t.api.updateRecipe({ recipe_id: 'SV-R-000001', beer_category: 'purple' }, 'u');
    expect(res).toMatchObject({ ok: false, error: 'invalid_data' });
    expect(t.recipes.log.writes).toEqual([]);
    expect(t.recipes.data[0].length).toBe(16);
  });

  test('legacy 16-col sheet gains header and value in the right column', function () {
    var t = withRecipe(LEGACY16);
    var res = t.api.updateRecipe({ recipe_id: 'SV-R-000001', beer_category: 'stout' }, 'u');
    expect(res.ok).toBe(true);
    expect(t.recipes.data[0].slice(-3)).toEqual(['pricing_mode', 'schedule_id', 'beer_category']);
    expect(cell(t.recipes, 1, 'beer_category')).toBe('stout');
    expect(cell(t.recipes, 1, 'name')).toBe('Seed');
  });
});

describe('mirrorRecipeState - beer_category', function () {
  function recipe(extra) {
    var r = { recipe_id: 'SV-R-000010', name: 'N', status: 'active' };
    Object.keys(extra || {}).forEach(function (k) { r[k] = extra[k]; });
    return r;
  }

  test('legacy header gains beer_category and the value is written', function () {
    var t = setup(LEGACY16);
    var res = t.api.mirrorRecipeState({ recipe: recipe({ beer_category: 'pale' }), ingredients: [] });
    expect(res.ok).toBe(true);
    expect(t.recipes.data[0].slice(-3)).toEqual(['pricing_mode', 'schedule_id', 'beer_category']);
    expect(cell(t.recipes, 1, 'beer_category')).toBe('pale');
  });

  test('recipe lacking the key mirrors an empty cell', function () {
    var t = setup(LEGACY16);
    t.api.mirrorRecipeState({ recipe: recipe(), ingredients: [] });
    expect(cell(t.recipes, 1, 'beer_category')).toBe('');
  });
});
