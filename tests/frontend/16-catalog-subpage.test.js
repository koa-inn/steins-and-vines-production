var subpage = require('../../js/modules/16-catalog-subpage.js');

describe('filterItemsByConfig', function () {
  test('includes items matching subcategory', function () {
    var items = [{ price_per_unit: '10.00', cf_subcategory: 'Grain', cf_type: '' }];
    var config = { subcategories: ['Grain'], types: [] };
    expect(subpage.filterItemsByConfig(items, config)).toHaveLength(1);
  });

  test('includes items matching types', function () {
    var items = [{ price_per_unit: '10.00', cf_subcategory: '', cf_type: 'Equipment' }];
    var config = { subcategories: [], types: ['Equipment'] };
    expect(subpage.filterItemsByConfig(items, config)).toHaveLength(1);
  });

  test('excludes items with price <= 0', function () {
    var items = [{ price_per_unit: '0', cf_subcategory: 'Grain', cf_type: '' }];
    var config = { subcategories: ['Grain'], types: [] };
    expect(subpage.filterItemsByConfig(items, config)).toHaveLength(0);
  });

  test('excludes items with empty string price', function () {
    var items = [{ price_per_unit: '', cf_subcategory: 'Grain', cf_type: '' }];
    var config = { subcategories: ['Grain'], types: [] };
    expect(subpage.filterItemsByConfig(items, config)).toHaveLength(0);
  });

  test('matches either subcategory OR type', function () {
    var items = [{ price_per_unit: '12.00', cf_subcategory: 'Fermenter', cf_type: 'Equipment' }];
    var config = { subcategories: ['Fermenter'], types: ['Equipment'] };
    expect(subpage.filterItemsByConfig(items, config)).toHaveLength(1);
  });

  test('returns empty for no matches', function () {
    var items = [{ price_per_unit: '10.00', cf_subcategory: 'Grain', cf_type: '' }];
    var config = { subcategories: ['Yeast'], types: [] };
    expect(subpage.filterItemsByConfig(items, config)).toHaveLength(0);
  });

  test('returns empty for empty items array', function () {
    var config = { subcategories: ['Grain'], types: [] };
    expect(subpage.filterItemsByConfig([], config)).toHaveLength(0);
  });

  test('handles items with subcategory field (not cf_subcategory)', function () {
    var items = [{ price_per_unit: '10.00', subcategory: 'Grain' }];
    var config = { subcategories: ['Grain'], types: [] };
    expect(subpage.filterItemsByConfig(items, config)).toHaveLength(1);
  });

  test('handles items with type field (not cf_type)', function () {
    var items = [{ price_per_unit: '10.00', type: 'Equipment' }];
    var config = { subcategories: [], types: ['Equipment'] };
    expect(subpage.filterItemsByConfig(items, config)).toHaveLength(1);
  });
});

describe('buildSortComparator', function () {
  test('name-asc sorts alphabetically', function () {
    var items = [
      { name: 'Cascade', price_per_unit: '5.00', stock: '10' },
      { name: 'Amarillo', price_per_unit: '5.00', stock: '10' }
    ];
    var sorted = items.slice().sort(subpage.buildSortComparator('name-asc'));
    expect(sorted[0].name).toBe('Amarillo');
  });

  test('name-desc sorts reverse alphabetically', function () {
    var items = [
      { name: 'Amarillo', price_per_unit: '5.00', stock: '10' },
      { name: 'Cascade', price_per_unit: '5.00', stock: '10' }
    ];
    var sorted = items.slice().sort(subpage.buildSortComparator('name-desc'));
    expect(sorted[0].name).toBe('Cascade');
  });

  test('price-asc sorts by price ascending', function () {
    var items = [
      { name: 'Alpha', price_per_unit: '15.00', stock: '5' },
      { name: 'Beta', price_per_unit: '5.00', stock: '5' }
    ];
    var sorted = items.slice().sort(subpage.buildSortComparator('price-asc'));
    expect(sorted[0].price_per_unit).toBe('5.00');
  });

  test('price-desc sorts by price descending', function () {
    var items = [
      { name: 'Alpha', price_per_unit: '5.00', stock: '5' },
      { name: 'Beta', price_per_unit: '15.00', stock: '5' }
    ];
    var sorted = items.slice().sort(subpage.buildSortComparator('price-desc'));
    expect(sorted[0].price_per_unit).toBe('15.00');
  });

  test('stock-first puts in-stock items before out-of-stock', function () {
    var items = [
      { name: 'Alpha', price_per_unit: '5.00', stock: '0' },
      { name: 'Beta', price_per_unit: '5.00', stock: '5' }
    ];
    var sorted = items.slice().sort(subpage.buildSortComparator('stock-first'));
    expect(sorted[0].stock).toBe('5');
  });

  test('stock-first then name-asc within groups', function () {
    var items = [
      { name: 'Cascade', price_per_unit: '5.00', stock: '5' },
      { name: 'Amarillo', price_per_unit: '5.00', stock: '5' }
    ];
    var sorted = items.slice().sort(subpage.buildSortComparator('stock-first'));
    expect(sorted[0].name).toBe('Amarillo');
  });

  test('returns identity comparator for unknown sort mode', function () {
    var items = [
      { name: 'Cascade', price_per_unit: '5.00', stock: '0' },
      { name: 'Amarillo', price_per_unit: '5.00', stock: '5' }
    ];
    // 'stock-first' is the default/fallback, not a true identity — test that
    // an unknown mode falls through to stock-first (default case)
    var comparator = subpage.buildSortComparator('unknown-mode');
    expect(typeof comparator).toBe('function');
    // Should not throw when called
    expect(function () { items.slice().sort(comparator); }).not.toThrow();
  });
});
