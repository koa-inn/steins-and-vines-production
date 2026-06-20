'use strict';

// brewpad.js runs its IIFE on load — stub the globals it touches at the top level.
global.document = global.document || {};
global.window = global.window || {};
global.navigator = global.navigator || {};
global.google = { accounts: { oauth2: { initTokenClient: jest.fn() } } };
global.fetch = jest.fn();

// auth.js primitives are loaded via <script> in the browser; in tests wire them as globals.
var _auth = require('../../js/lib/auth');
global.waitForGoogleIdentity = _auth.waitForGoogleIdentity;
global.gsiInitTokenClient = _auth.gsiInitTokenClient;
global.fetchGoogleUserInfo = _auth.fetchGoogleUserInfo;

var bp = require('../../js/brewpad');
var filterRecipesByName = bp.filterRecipesByName;
var recipeRowPrice      = bp.recipeRowPrice;

// ---------------------------------------------------------------------------
// filterRecipesByName
// ---------------------------------------------------------------------------
describe('filterRecipesByName', function () {
  var list = [
    { recipe_id: 'R1', name: 'West Coast IPA', status: 'active' },
    { recipe_id: 'R2', name: 'Amber Ale', status: 'active' },
    { recipe_id: 'R3', name: 'Blackberry Mead', status: 'draft' },
    { recipe_id: 'R4', name: null, status: 'draft' }
  ];

  test('empty query returns all rows', function () {
    var result = filterRecipesByName(list, '');
    expect(result.length).toBe(4);
  });

  test('whitespace-only query returns all rows', function () {
    var result = filterRecipesByName(list, '   ');
    expect(result.length).toBe(4);
  });

  test('null query returns all rows', function () {
    var result = filterRecipesByName(list, null);
    expect(result.length).toBe(4);
  });

  test('undefined query returns all rows', function () {
    var result = filterRecipesByName(list, undefined);
    expect(result.length).toBe(4);
  });

  test('case-insensitive substring match', function () {
    var result = filterRecipesByName(list, 'ipa');
    expect(result.length).toBe(1);
    expect(result[0].recipe_id).toBe('R1');
  });

  test('case-insensitive match returns multiple results', function () {
    var result = filterRecipesByName(list, 'a');
    // 'West Coast IPA', 'Amber Ale', 'Blackberry Mead' all contain 'a'
    expect(result.length).toBeGreaterThanOrEqual(3);
  });

  test('no match returns empty array', function () {
    var result = filterRecipesByName(list, 'stout');
    expect(result).toEqual([]);
  });

  test('never throws on null name in list', function () {
    expect(function () { filterRecipesByName(list, 'something'); }).not.toThrow();
  });

  test('null name item is excluded from matches', function () {
    var result = filterRecipesByName(list, 'something');
    // R4 has null name — should not match and should not throw
    var ids = result.map(function (r) { return r.recipe_id; });
    expect(ids).not.toContain('R4');
  });

  test('null list returns empty array', function () {
    var result = filterRecipesByName(null, 'ipa');
    expect(result).toEqual([]);
  });

  test('empty list with query returns empty array', function () {
    var result = filterRecipesByName([], 'ipa');
    expect(result).toEqual([]);
  });

  test('empty query on empty list returns empty array', function () {
    var result = filterRecipesByName([], '');
    expect(result).toEqual([]);
  });

  test('returns a new array (does not mutate input)', function () {
    var result = filterRecipesByName(list, '');
    expect(result).not.toBe(list);
  });
});

// ---------------------------------------------------------------------------
// recipeRowPrice
// ---------------------------------------------------------------------------
describe('recipeRowPrice', function () {
  test('dynamic pricing with computed_price > 0 returns ~$X.XX', function () {
    var r = { pricing_mode: 'dynamic', computed_price: 14.5 };
    expect(recipeRowPrice(r)).toBe('~$14.50');
  });

  test('dynamic pricing with computed_price = 0 returns em-dash', function () {
    var r = { pricing_mode: 'dynamic', computed_price: 0 };
    expect(recipeRowPrice(r)).toBe('—');
  });

  test('dynamic pricing with no computed_price returns em-dash', function () {
    var r = { pricing_mode: 'dynamic' };
    expect(recipeRowPrice(r)).toBe('—');
  });

  test('locked pricing with locked_price > 0 returns $X.XX', function () {
    var r = { pricing_mode: 'locked', locked_price: 29.99 };
    expect(recipeRowPrice(r)).toBe('$29.99');
  });

  test('locked pricing with locked_price = 0 returns em-dash', function () {
    var r = { pricing_mode: 'locked', locked_price: 0 };
    expect(recipeRowPrice(r)).toBe('—');
  });

  test('locked pricing with no locked_price returns em-dash', function () {
    var r = { pricing_mode: 'locked' };
    expect(recipeRowPrice(r)).toBe('—');
  });

  test('null recipe returns em-dash', function () {
    expect(recipeRowPrice(null)).toBe('—');
  });

  test('undefined recipe returns em-dash', function () {
    expect(recipeRowPrice(undefined)).toBe('—');
  });

  test('dynamic price formats to two decimal places', function () {
    var r = { pricing_mode: 'dynamic', computed_price: 10 };
    expect(recipeRowPrice(r)).toBe('~$10.00');
  });

  test('locked price formats to two decimal places', function () {
    var r = { pricing_mode: 'locked', locked_price: 25 };
    expect(recipeRowPrice(r)).toBe('$25.00');
  });

  test('dynamic pricing does not use locked_price', function () {
    var r = { pricing_mode: 'dynamic', computed_price: 0, locked_price: 50 };
    expect(recipeRowPrice(r)).toBe('—');
  });

  test('locked pricing does not use computed_price', function () {
    var r = { pricing_mode: 'locked', computed_price: 99, locked_price: 0 };
    expect(recipeRowPrice(r)).toBe('—');
  });
});
