'use strict';

var dm = require('../lib/discount-match');

describe('discount-match.classifyCatalogItem', function () {
  test('service item -> [service]', function () {
    expect(dm.classifyCatalogItem({ product_type: 'service' })).toEqual(['service']);
  });

  test('wine kit -> [kit, kit:wine]', function () {
    expect(dm.classifyCatalogItem({ cf_type: 'Wine' })).toEqual(['kit', 'kit:wine']);
  });

  test('beer kit (lowercase) -> [kit, kit:beer]', function () {
    expect(dm.classifyCatalogItem({ cf_type: 'beer' })).toEqual(['kit', 'kit:beer']);
  });

  test('ingredient with flattened cf_subcategory -> [ingredient, ingredient:hops]', function () {
    expect(dm.classifyCatalogItem({ cf_type: 'ingredient', cf_subcategory: 'Hops' }))
      .toEqual(['ingredient', 'ingredient:hops']);
  });

  test('ingredient subcategory alias (Grains -> grain)', function () {
    expect(dm.classifyCatalogItem({ cf_type: 'ingredient', cf_subcategory: 'Grains' }))
      .toEqual(['ingredient', 'ingredient:grain']);
  });

  test('ingredient subcategory from custom_fields array', function () {
    expect(dm.classifyCatalogItem({
      product_type: 'inventory',
      custom_fields: [{ label: 'Subcategory', value: 'Yeast' }]
    })).toEqual(['ingredient', 'ingredient:yeast']);
  });

  test('ingredient without subcategory -> [ingredient]', function () {
    expect(dm.classifyCatalogItem({ cf_type: 'ingredient' })).toEqual(['ingredient']);
  });

  test('inventory/goods product_type counts as ingredient', function () {
    expect(dm.classifyCatalogItem({ product_type: 'goods' })).toEqual(['ingredient']);
  });

  test('packaging aliases (bottle/bag -> packaging)', function () {
    expect(dm.classifyCatalogItem({ cf_type: 'ingredient', cf_subcategory: 'Bottle' }))
      .toEqual(['ingredient', 'ingredient:packaging']);
  });

  test('unknown / missing item -> []', function () {
    expect(dm.classifyCatalogItem(null)).toEqual([]);
    expect(dm.classifyCatalogItem({ cf_type: 'consignment' })).toEqual([]);
  });
});

describe('discount-match.matches', function () {
  test('matches on group token', function () {
    expect(dm.matches(['kit', 'kit:wine'], ['kit'])).toBe(true);
  });
  test('matches on leaf token', function () {
    expect(dm.matches(['kit', 'kit:wine'], ['kit:wine'])).toBe(true);
  });
  test('no match when neither token present', function () {
    expect(dm.matches(['kit', 'kit:wine'], ['kit:beer', 'ingredient'])).toBe(false);
  });
  test('empty inputs never match', function () {
    expect(dm.matches([], ['kit'])).toBe(false);
    expect(dm.matches(['kit'], [])).toBe(false);
  });
});

describe('discount-match.validateAppliesTo', function () {
  test('valid token list -> no errors', function () {
    expect(dm.validateAppliesTo(['kit', 'ingredient:hops', 'service', 'recipe'])).toEqual([]);
  });
  test('empty / non-array -> error', function () {
    expect(dm.validateAppliesTo([]).length).toBeGreaterThan(0);
    expect(dm.validateAppliesTo(undefined).length).toBeGreaterThan(0);
  });
  test('unknown token -> error', function () {
    var errs = dm.validateAppliesTo(['kit:merlot']);
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]).toContain('kit:merlot');
  });
});
