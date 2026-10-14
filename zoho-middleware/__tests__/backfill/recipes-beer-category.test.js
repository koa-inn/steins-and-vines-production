'use strict';

/**
 * Phase 89 Plan 07 - beer_category through the offline backfill planner and recipes-verify.
 * Synthetic data only.
 */

var recipesBackfill = require('../../scripts/backfill/recipes-backfill');
var buildPlan = recipesBackfill.buildRecipesBackfillPlan;
var compareRecipes = require('../../scripts/backfill/recipes-verify').compareRecipes;
var recipeSpecs = require('../../scripts/backfill/specs/recipes');

var RECIPE_HEADERS = recipeSpecs.recipes.columns.map(function (c) { return c.header; });
var INGREDIENT_HEADERS = recipeSpecs.ingredients.columns.map(function (c) { return c.header; });

function recipeRow(rowNumber, overrides) {
  var base = {
    recipe_id: 'SV-R-000001', name: 'Test Pale', style: 'Pale Ale', description: '', status: 'active',
    locked_price: 100, service_fee: '', materials_fee: '', batch_size_l: 23, abv: 5.2, ibu: 30,
    colour_srm: 8, notes: '', created_at: '2026-01-15T08:00:00Z', created_by: 'staff-one@example.test',
    updated_at: '2026-01-16T08:00:00Z', pricing_mode: 'locked', schedule_id: '', beer_category: ''
  };
  Object.assign(base, overrides || {});
  return { rowNumber: rowNumber, values: base };
}

function ingRow(rowNumber) {
  return {
    rowNumber: rowNumber,
    values: {
      ingredient_id: 'RI-000001', recipe_id: 'SV-R-000001', item_id: 'ITEM-A', item_name: 'Pale Malt',
      quantity: 5, unit: 'kg'
    }
  };
}

function plan(recipeRows, headers) {
  return buildPlan({
    recipeRows: recipeRows,
    ingredientRows: [ingRow(2)],
    recipeHeaders: headers || RECIPE_HEADERS,
    ingredientHeaders: INGREDIENT_HEADERS,
    timezone: 'America/Vancouver'
  });
}

describe('backfill beer_category', function () {
  it('accepts blank and canonical keys without a reject', function () {
    var result = plan([
      recipeRow(2, { beer_category: '' }),
      recipeRow(3, { recipe_id: 'SV-R-000002', beer_category: 'ipa' }),
      recipeRow(4, { recipe_id: 'SV-R-000003', beer_category: 'redale' })
    ]);
    expect(result.rejects).toEqual([]);
    expect(result.recipes.length).toBe(3);
    expect(result.recipes[0].beer_category || '').toBe('');
    expect(result.recipes[1].beer_category).toBe('ipa');
    expect(result.recipes[2].beer_category).toBe('redale');
  });

  it('rejects an unknown value with a reason code and no cell echo', function () {
    var result = plan([recipeRow(2, { beer_category: 'purple' })]);
    expect(result.recipes.length).toBe(0);
    // the dependent ingredient row is also rejected as an orphan; only the recipe reject matters here
    var recipeRejects = result.rejects.filter(function (r) { return r.field === 'beer_category'; });
    expect(recipeRejects.length).toBe(1);
    expect(recipeRejects[0].reason).toBe('invalid_beer_category');
    expect(JSON.stringify(result.rejects)).not.toContain('purple');
  });

  it('rejects a non-canonical value (no coercion)', function () {
    var result = plan([recipeRow(2, { beer_category: 'IPA' })]);
    expect(result.recipes.length).toBe(0);
    var r = result.rejects.filter(function (x) { return x.field === 'beer_category'; });
    expect(r.length).toBe(1);
    expect(r[0].reason).toBe('invalid_beer_category');
    expect(JSON.stringify(result.rejects)).not.toContain('IPA');
  });

  it('reports missing_header when the sheet lacks beer_category', function () {
    var headers = RECIPE_HEADERS.filter(function (h) { return h !== 'beer_category'; });
    var result = plan([recipeRow(2)], headers);
    var missing = result.rejects.filter(function (r) { return r.field === 'beer_category'; });
    expect(missing.length).toBe(1);
    expect(missing[0].reason).toBe('missing_header');
  });
});

describe('recipes-verify beer_category', function () {
  function pg(cat) {
    return {
      recipe: {
        recipe_id: 'SV-R-000001', name: 'T', style: '', description: '', status: 'active', locked_price: 1,
        service_fee: '', materials_fee: '', batch_size_l: '', abv: '', ibu: '', colour_srm: '', notes: '',
        created_at: '2026-01-15T08:00:00Z', created_by: '', updated_at: '2026-01-16T08:00:00Z',
        pricing_mode: 'locked', schedule_id: '', beer_category: cat
      },
      ingredients: []
    };
  }
  function sheet(cat) {
    return {
      recipes: [{
        recipe_id: 'SV-R-000001', name: 'T', style: null, description: null, status: 'active', locked_price: '1',
        service_fee: null, materials_fee: null, batch_size_l: null, abv: null, ibu: null, colour_srm: null,
        notes: null, created_at: '2026-01-15T08:00:00Z', created_by: null, updated_at: '2026-01-16T08:00:00Z',
        pricing_mode: 'locked', schedule_id: null, beer_category: cat
      }],
      ingredients: [],
      rejects: []
    };
  }

  it('flags PG ipa vs sheet blank', function () {
    var out = compareRecipes({ pgRecipes: [pg('ipa')], sheetPlan: sheet(null) });
    expect(out).toEqual([{ id: 'SV-R-000001', field: 'beer_category' }]);
  });

  it('treats blank and NULL as equal', function () {
    expect(compareRecipes({ pgRecipes: [pg('')], sheetPlan: sheet(null) })).toEqual([]);
    expect(compareRecipes({ pgRecipes: [pg(null)], sheetPlan: sheet(null) })).toEqual([]);
  });
});
