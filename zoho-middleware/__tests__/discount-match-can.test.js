'use strict';

// Regression: aluminium cans (cf_subcategory "Can", cf_type "Packaging",
// SKUs can-355 / can-473) classified as ['ingredient'] with no leaf, so a
// discount preset scoped 'ingredient:packaging' silently skipped them.

var dm = require('../lib/discount-match');

describe('discount-match: cans are packaging', function () {
  test('Can subcategory -> [ingredient, ingredient:packaging]', function () {
    expect(dm.classifyCatalogItem({ product_type: 'goods', cf_type: 'Packaging', cf_subcategory: 'Can' }))
      .toEqual(['ingredient', 'ingredient:packaging']);
  });

  test('Cans (plural) also maps to packaging', function () {
    expect(dm.classifyCatalogItem({ product_type: 'goods', cf_type: 'Packaging', cf_subcategory: 'Cans' }))
      .toEqual(['ingredient', 'ingredient:packaging']);
  });

  test('an ingredient:packaging preset matches a can line', function () {
    var tokens = dm.classifyCatalogItem({ product_type: 'goods', cf_type: 'Packaging', cf_subcategory: 'Can' });
    expect(dm.matches(tokens, ['ingredient:packaging'])).toBe(true);
  });
});
