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
var filterRecipesByName        = bp.filterRecipesByName;
var recipeRowPrice             = bp.recipeRowPrice;
var canActivateRecipe          = bp.canActivateRecipe;
var buildRecipePayload         = bp.buildRecipePayload;
var recipeDeleteConfirmMessage = bp.recipeDeleteConfirmMessage;

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

// ---------------------------------------------------------------------------
// canActivateRecipe (D-06 inline activation guardrail)
// ---------------------------------------------------------------------------
describe('canActivateRecipe', function () {
  var validIngredients = [{ item_id: 'I1', item_name: 'Hops', quantity: 1 }];

  test('returns ok:false when locked_price is missing', function () {
    var result = canActivateRecipe({}, validIngredients);
    expect(result.ok).toBe(false);
    expect(typeof result.reason).toBe('string');
    expect(result.reason.length).toBeGreaterThan(0);
  });

  test('returns ok:false when locked_price is zero', function () {
    var result = canActivateRecipe({ locked_price: 0 }, validIngredients);
    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  test('returns ok:false when locked_price is negative', function () {
    var result = canActivateRecipe({ locked_price: -5 }, validIngredients);
    expect(result.ok).toBe(false);
  });

  test('returns ok:false when locked_price is NaN string', function () {
    var result = canActivateRecipe({ locked_price: 'abc' }, validIngredients);
    expect(result.ok).toBe(false);
  });

  test('returns ok:false when ingredients array is empty', function () {
    var result = canActivateRecipe({ locked_price: 25 }, []);
    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  test('returns ok:false when ingredients is null', function () {
    var result = canActivateRecipe({ locked_price: 25 }, null);
    expect(result.ok).toBe(false);
  });

  test('returns ok:true when locked_price > 0 and ingredients not empty', function () {
    var result = canActivateRecipe({ locked_price: 29.99 }, validIngredients);
    expect(result.ok).toBe(true);
  });

  test('returns ok:true with multiple ingredients', function () {
    var ings = [
      { item_id: 'I1', quantity: 1 },
      { item_id: 'I2', quantity: 2 }
    ];
    var result = canActivateRecipe({ locked_price: 49 }, ings);
    expect(result.ok).toBe(true);
  });

  test('reason field absent (or falsy) when ok:true', function () {
    var result = canActivateRecipe({ locked_price: 10 }, validIngredients);
    expect(result.ok).toBe(true);
    // reason may be undefined or empty — must not block activation
    expect(result.reason).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// buildRecipePayload (ingredient filter + ingredient_count)
// ---------------------------------------------------------------------------
describe('buildRecipePayload', function () {
  var baseForm = {
    name: 'Pale Ale',
    style: 'APA',
    description: 'A refreshing ale',
    batch_size_l: 23,
    abv: 5.2,
    ibu: 35,
    colour_srm: 8,
    pricing_mode: 'locked',
    locked_price: 29.99,
    service_fee: 45,
    materials_fee: 5,
    status: 'draft'
  };

  test('includes all formData fields in payload', function () {
    var payload = buildRecipePayload(baseForm, []);
    expect(payload.name).toBe('Pale Ale');
    expect(payload.style).toBe('APA');
    expect(payload.batch_size_l).toBe(23);
    expect(payload.abv).toBe(5.2);
    expect(payload.ibu).toBe(35);
    expect(payload.locked_price).toBe(29.99);
    expect(payload.service_fee).toBe(45);
    expect(payload.materials_fee).toBe(5);
    expect(payload.status).toBe('draft');
    expect(payload.pricing_mode).toBe('locked');
  });

  test('filters out ingredients with no item_id', function () {
    var ings = [
      { item_id: '', item_name: 'Unknown', quantity: 1 },
      { item_id: 'I1', item_name: 'Malt', quantity: 2 }
    ];
    var payload = buildRecipePayload(baseForm, ings);
    expect(payload.ingredients.length).toBe(1);
    expect(payload.ingredients[0].item_id).toBe('I1');
  });

  test('filters out ingredients with quantity <= 0', function () {
    var ings = [
      { item_id: 'I1', item_name: 'Hops', quantity: 0 },
      { item_id: 'I2', item_name: 'Malt', quantity: 1 }
    ];
    var payload = buildRecipePayload(baseForm, ings);
    expect(payload.ingredients.length).toBe(1);
    expect(payload.ingredients[0].item_id).toBe('I2');
  });

  test('sets ingredient_count to the filtered count', function () {
    var ings = [
      { item_id: 'I1', quantity: 1 },
      { item_id: '', quantity: 1 },     // filtered out — no item_id
      { item_id: 'I3', quantity: 0 }    // filtered out — zero qty
    ];
    var payload = buildRecipePayload(baseForm, ings);
    expect(payload.ingredient_count).toBe(1);
  });

  test('ingredient_count matches ingredients array length in payload', function () {
    var ings = [
      { item_id: 'I1', quantity: 2 },
      { item_id: 'I2', quantity: 0.5 }
    ];
    var payload = buildRecipePayload(baseForm, ings);
    expect(payload.ingredient_count).toBe(payload.ingredients.length);
  });

  test('ingredient_count is 0 for empty ingredients', function () {
    var payload = buildRecipePayload(baseForm, []);
    expect(payload.ingredient_count).toBe(0);
    expect(payload.ingredients).toEqual([]);
  });

  test('ingredient_count is 0 when all ingredients are invalid', function () {
    var ings = [
      { item_id: '', quantity: 5 },
      { item_id: 'I1', quantity: 0 }
    ];
    var payload = buildRecipePayload(baseForm, ings);
    expect(payload.ingredient_count).toBe(0);
  });

  test('handles null ingredients gracefully', function () {
    var payload = buildRecipePayload(baseForm, null);
    expect(payload.ingredient_count).toBe(0);
    expect(payload.ingredients).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// recipeDeleteConfirmMessage (pure helper — confirm-sheet message for delete, D-04)
// ---------------------------------------------------------------------------
describe('recipeDeleteConfirmMessage', function () {
  test('includes the recipe name in the message', function () {
    var msg = recipeDeleteConfirmMessage('West Coast IPA');
    expect(msg).toContain('West Coast IPA');
  });

  test('includes irreversible-warning copy', function () {
    var msg = recipeDeleteConfirmMessage('Amber Ale');
    expect(msg.toLowerCase()).toContain('cannot be undone');
  });

  test('uses the danger class variant (bp-confirm-btn--danger triggers showConfirmSheet okCls)', function () {
    // This test asserts the helper returns non-empty string (danger class is wired in deleteRecipe, not the message).
    var msg = recipeDeleteConfirmMessage('Test Recipe');
    expect(typeof msg).toBe('string');
    expect(msg.length).toBeGreaterThan(0);
  });

  test('handles empty name gracefully', function () {
    var msg = recipeDeleteConfirmMessage('');
    expect(msg.toLowerCase()).toContain('cannot be undone');
  });

  test('handles null name gracefully', function () {
    expect(function () { recipeDeleteConfirmMessage(null); }).not.toThrow();
    var msg = recipeDeleteConfirmMessage(null);
    expect(msg.toLowerCase()).toContain('cannot be undone');
  });
});
