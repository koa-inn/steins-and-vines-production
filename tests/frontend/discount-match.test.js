// Frontend mirror of the discount product-type classifier.
// Must stay behaviourally identical to zoho-middleware/lib/discount-match.js.
var dm = require('../../js/lib/discount-match.js');

describe('frontend classifyDiscountItem', function () {
  test('service line', function () {
    expect(dm.classifyDiscountItem({ product_type: 'service' })).toEqual(['service']);
  });
  test('wine kit', function () {
    expect(dm.classifyDiscountItem({ cf_type: 'Wine' })).toEqual(['kit', 'kit:wine']);
  });
  test('ingredient with subcategory', function () {
    expect(dm.classifyDiscountItem({ cf_type: 'ingredient', cf_subcategory: 'Hops' }))
      .toEqual(['ingredient', 'ingredient:hops']);
  });
  test('ingredient subcategory alias Grains->grain', function () {
    expect(dm.classifyDiscountItem({ cf_type: 'ingredient', cf_subcategory: 'Grains' }))
      .toEqual(['ingredient', 'ingredient:grain']);
  });
  test('ingredient without subcategory', function () {
    expect(dm.classifyDiscountItem({ cf_type: 'ingredient' })).toEqual(['ingredient']);
  });
  test('recipe / fee synthetic lines do not classify', function () {
    expect(dm.classifyDiscountItem({ product_type: 'recipe' })).toEqual([]);
    expect(dm.classifyDiscountItem({ product_type: 'fee' })).toEqual([]);
    expect(dm.classifyDiscountItem({ product_type: 'recipe_ingredient' })).toEqual([]);
  });
});

describe('frontend discountMatches', function () {
  test('group token match', function () {
    expect(dm.discountMatches(['ingredient', 'ingredient:hops'], ['ingredient'])).toBe(true);
  });
  test('leaf token match', function () {
    expect(dm.discountMatches(['kit', 'kit:beer'], ['kit:beer'])).toBe(true);
  });
  test('no match', function () {
    expect(dm.discountMatches(['kit', 'kit:wine'], ['ingredient', 'service'])).toBe(false);
  });
});
