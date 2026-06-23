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
var renderRecipeListHtml = bp.renderRecipeListHtml;
var bpCloneRecipePayload  = bp.bpCloneRecipePayload;

// ---------------------------------------------------------------------------
// Feature 1: renderRecipeListHtml — style shown on list rows
// ---------------------------------------------------------------------------
describe('renderRecipeListHtml — style column', function () {
  var recipes = [
    {
      recipe_id: 'R1',
      name: 'West Coast IPA',
      style: 'American IPA',
      status: 'active',
      pricing_mode: 'locked',
      locked_price: 29.99
    },
    {
      recipe_id: 'R2',
      name: 'Amber Ale',
      style: '',
      status: 'draft',
      pricing_mode: 'locked',
      locked_price: 0
    },
    {
      recipe_id: 'R3',
      name: 'Blackberry Mead',
      // no style property
      status: 'active',
      pricing_mode: 'dynamic',
      computed_price: 45
    }
  ];

  test('renders a .bp-recipes-style element when recipe has a non-empty style', function () {
    var html = renderRecipeListHtml(recipes);
    expect(html).toContain('bp-recipes-style');
    expect(html).toContain('American IPA');
  });

  test('omits .bp-recipes-style element entirely when style is empty string', function () {
    var html = renderRecipeListHtml(recipes);
    // Only one style element should appear (for R1); R2 has empty style
    var matches = html.match(/class="bp-recipes-style"/g) || [];
    expect(matches.length).toBe(1);
  });

  test('omits .bp-recipes-style element when style property is absent', function () {
    var singleRecipe = [{ recipe_id: 'R3', name: 'Mead', status: 'draft' }];
    var html = renderRecipeListHtml(singleRecipe);
    expect(html).not.toContain('bp-recipes-style');
  });

  test('escapes HTML in style field', function () {
    var evil = [{ recipe_id: 'X', name: 'Evil', style: '<script>alert(1)</script>', status: 'draft' }];
    var html = renderRecipeListHtml(evil);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('style text appears inside the name cell (same td as recipe name)', function () {
    var html = renderRecipeListHtml(recipes);
    // The style div should come after the name text in the same td
    var nameCellMatch = html.match(/<td class="bp-recipes-name">[\s\S]*?<\/td>/);
    expect(nameCellMatch).not.toBeNull();
    var nameCell = nameCellMatch[0];
    expect(nameCell).toContain('West Coast IPA');
    expect(nameCell).toContain('American IPA');
    expect(nameCell).toContain('bp-recipes-style');
  });

  test('returns empty string for empty recipe list', function () {
    var html = renderRecipeListHtml([]);
    // Should not contain a table row with recipe data
    expect(html).not.toContain('bp-recipes-row');
  });

  test('returns empty string for null input', function () {
    var html = renderRecipeListHtml(null);
    expect(typeof html).toBe('string');
    expect(html).not.toContain('bp-recipes-row');
  });
});

// ---------------------------------------------------------------------------
// Feature 2: bpCloneRecipePayload — clone produces a new-recipe draft
// ---------------------------------------------------------------------------
describe('bpCloneRecipePayload', function () {
  var sourceRecipe = {
    recipe_id: 'R10',
    name: 'West Coast IPA',
    style: 'American IPA',
    batch_size_l: 23,
    abv: 6.2,
    ibu: 55,
    colour_srm: 7,
    description: 'Hoppy and crisp.',
    pricing_mode: 'locked',
    locked_price: 35,
    service_fee: 45,
    materials_fee: 5,
    status: 'active'
  };
  var sourceIngredients = [
    { item_id: 'I1', item_name: 'Pale Malt', quantity: 9, unit: 'kg', purchase_rate: 2.5, rate: 3.2 },
    { item_id: 'I2', item_name: 'Cascade Hops', quantity: 50, unit: 'g', purchase_rate: 0.08, rate: 0.12 }
  ];

  test('returns an object with recipe and ingredients properties', function () {
    var result = bpCloneRecipePayload(sourceRecipe, sourceIngredients);
    expect(result).not.toBeNull();
    expect(typeof result.recipe).toBe('object');
    expect(Array.isArray(result.ingredients)).toBe(true);
  });

  test('clone name is "Copy of {original name}"', function () {
    var result = bpCloneRecipePayload(sourceRecipe, sourceIngredients);
    expect(result.recipe.name).toBe('Copy of West Coast IPA');
  });

  test('clone status is forced to "draft"', function () {
    var result = bpCloneRecipePayload(sourceRecipe, sourceIngredients);
    expect(result.recipe.status).toBe('draft');
  });

  test('clone recipe_id is cleared (null or undefined or empty)', function () {
    var result = bpCloneRecipePayload(sourceRecipe, sourceIngredients);
    expect(result.recipe.recipe_id).toBeFalsy();
  });

  test('copies all other recipe fields (style, batch_size_l, abv, ibu, colour_srm, description, pricing)', function () {
    var result = bpCloneRecipePayload(sourceRecipe, sourceIngredients);
    expect(result.recipe.style).toBe('American IPA');
    expect(result.recipe.batch_size_l).toBe(23);
    expect(result.recipe.abv).toBe(6.2);
    expect(result.recipe.ibu).toBe(55);
    expect(result.recipe.colour_srm).toBe(7);
    expect(result.recipe.description).toBe('Hoppy and crisp.');
    expect(result.recipe.pricing_mode).toBe('locked');
    expect(result.recipe.locked_price).toBe(35);
    expect(result.recipe.service_fee).toBe(45);
    expect(result.recipe.materials_fee).toBe(5);
  });

  test('copies ingredients array (all rows)', function () {
    var result = bpCloneRecipePayload(sourceRecipe, sourceIngredients);
    expect(result.ingredients.length).toBe(2);
    expect(result.ingredients[0].item_id).toBe('I1');
    expect(result.ingredients[1].item_id).toBe('I2');
  });

  test('does NOT mutate the source recipe object', function () {
    bpCloneRecipePayload(sourceRecipe, sourceIngredients);
    expect(sourceRecipe.recipe_id).toBe('R10');
    expect(sourceRecipe.name).toBe('West Coast IPA');
    expect(sourceRecipe.status).toBe('active');
  });

  test('does NOT mutate the source ingredients array', function () {
    bpCloneRecipePayload(sourceRecipe, sourceIngredients);
    expect(sourceIngredients.length).toBe(2);
    expect(sourceIngredients[0].item_id).toBe('I1');
  });

  test('mutating the clone recipe does not affect the source', function () {
    var result = bpCloneRecipePayload(sourceRecipe, sourceIngredients);
    result.recipe.name = 'Changed';
    result.recipe.style = 'Changed';
    expect(sourceRecipe.name).toBe('West Coast IPA');
    expect(sourceRecipe.style).toBe('American IPA');
  });

  test('mutating a cloned ingredient does not affect the source ingredients', function () {
    var result = bpCloneRecipePayload(sourceRecipe, sourceIngredients);
    result.ingredients[0].quantity = 999;
    expect(sourceIngredients[0].quantity).toBe(9);
  });

  test('handles empty ingredients array', function () {
    var result = bpCloneRecipePayload(sourceRecipe, []);
    expect(result.ingredients).toEqual([]);
  });

  test('handles null ingredients gracefully', function () {
    var result = bpCloneRecipePayload(sourceRecipe, null);
    expect(Array.isArray(result.ingredients)).toBe(true);
    expect(result.ingredients.length).toBe(0);
  });

  test('does NOT call fetch (nothing persisted until Save)', function () {
    global.fetch.mockClear();
    bpCloneRecipePayload(sourceRecipe, sourceIngredients);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
