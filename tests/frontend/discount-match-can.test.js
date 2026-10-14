// Regression (frontend mirror): aluminium cans (cf_subcategory "Can") must
// classify as ingredient:packaging, identical to zoho-middleware/lib/discount-match.js.
var dm = require('../../js/lib/discount-match.js');

describe('frontend discount-match: cans are packaging', function () {
  test('Can subcategory -> [ingredient, ingredient:packaging]', function () {
    expect(dm.classifyDiscountItem({ product_type: 'goods', cf_type: 'Packaging', cf_subcategory: 'Can' }))
      .toEqual(['ingredient', 'ingredient:packaging']);
  });

  test('Cans (plural) also maps to packaging', function () {
    expect(dm.classifyDiscountItem({ product_type: 'goods', cf_type: 'Packaging', cf_subcategory: 'Cans' }))
      .toEqual(['ingredient', 'ingredient:packaging']);
  });

  test('an ingredient:packaging preset matches a can line', function () {
    var tokens = dm.classifyDiscountItem({ product_type: 'goods', cf_type: 'Packaging', cf_subcategory: 'Can' });
    expect(dm.discountMatches(tokens, ['ingredient:packaging'])).toBe(true);
  });
});
