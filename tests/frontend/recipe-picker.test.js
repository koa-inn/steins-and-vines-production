/**
 * @jest-environment jsdom
 */
var fs = require('fs');
var path = require('path');
var RP = require('../../js/lib/recipe-picker.js');

function names(list) {
  return list.map(function (r) { return r.name; });
}

describe('recipe-picker', function () {
  test('sortRecipesByName is case-insensitive, non-mutating, ties by recipe_id', function () {
    var input = [{ name: 'b' }, { name: 'A' }, { name: 'c' }];
    expect(names(RP.sortRecipesByName(input))).toEqual(['A', 'b', 'c']);
    expect(names(input)).toEqual(['b', 'A', 'c']);
    var tie = RP.sortRecipesByName([{ name: 'x', recipe_id: 'R2' }, { name: 'X', recipe_id: 'R1' }]);
    expect(tie.map(function (r) { return r.recipe_id; })).toEqual(['R1', 'R2']);
  });

  test('filterRecipes with empty term returns everything (no cap, 40 recipes)', function () {
    var list = [];
    for (var i = 0; i < 40; i++) list.push({ name: 'Recipe ' + i, recipe_id: 'R' + i });
    expect(RP.filterRecipes(list, '')).toHaveLength(40);
    expect(RP.filterRecipes(list, undefined)).toHaveLength(40);
  });

  test('filterRecipes matches name or style case-insensitively', function () {
    var list = [
      { name: 'West Coast IPA', style: 'American' },
      { name: 'Hazy', style: 'NEIPA' },
      { name: 'Stout', style: 'Dry' }
    ];
    expect(names(RP.filterRecipes(list, 'ipa'))).toEqual(['Hazy', 'West Coast IPA']);
  });

  test('filterRecipes handles non-arrays', function () {
    expect(RP.filterRecipes(null, 'x')).toEqual([]);
  });

  test('findRecipeNameMatches splits exact and similar', function () {
    var list = [{ name: 'Hazy Pale Ale' }, { name: 'Pale Ale' }, { name: 'Stout' }];
    var res = RP.findRecipeNameMatches(list, ' pale ale ');
    expect(names(res.exact)).toEqual(['Pale Ale']);
    expect(names(res.similar)).toEqual(['Hazy Pale Ale']);
  });

  test('findRecipeNameMatches ignores names under 2 chars', function () {
    expect(RP.findRecipeNameMatches([{ name: 'Pale' }], ' p ')).toEqual({ exact: [], similar: [] });
  });

  test('exposes window.RecipePicker', function () {
    expect(window.RecipePicker.filterRecipes).toBe(RP.filterRecipes);
  });

  ['brewpad.html', 'kiosk.html', 'admin.html'].forEach(function (f) {
    test(f + ' loads recipe-picker.js exactly once', function () {
      var html = fs.readFileSync(path.join(__dirname, '../../', f), 'utf8');
      expect(html.split('js/lib/recipe-picker.js').length - 1).toBe(1);
    });
  });
});
