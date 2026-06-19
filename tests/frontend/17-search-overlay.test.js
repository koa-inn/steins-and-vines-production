var constants = require('../../js/lib/constants.js');
global.CATEGORY_DISPLAY_NAMES = constants.CATEGORY_DISPLAY_NAMES;
var mod = require('../../js/modules/17-search-overlay.js');

// ---------------------------------------------------------------------------
// groupResultsByCategory
// ---------------------------------------------------------------------------

describe('groupResultsByCategory', function () {
  test('returns empty array for empty input', function () {
    var result = mod.groupResultsByCategory([]);
    expect(result).toEqual([]);
  });

  test('groups items by display category name', function () {
    var fuseResults = [
      { item: { name: 'Pale Malt', cf_subcategory: 'Grain' } },
      { item: { name: 'Crystal 60', cf_subcategory: 'Grain' } },
      { item: { name: 'Cascade', cf_subcategory: 'Hops' } }
    ];
    var result = mod.groupResultsByCategory(fuseResults);
    expect(result).toHaveLength(2);
    var grainGroup = result.find(function (g) { return g.category === 'Grains'; });
    expect(grainGroup).toBeDefined();
    expect(grainGroup.items).toHaveLength(2);
    var hopGroup = result.find(function (g) { return g.category === 'Hops'; });
    expect(hopGroup).toBeDefined();
    expect(hopGroup.items).toHaveLength(1);
  });

  test('sorts groups by match count descending', function () {
    var fuseResults = [
      { item: { name: 'Cascade', cf_subcategory: 'Hops' } },
      { item: { name: 'Centennial', cf_subcategory: 'Hops' } },
      { item: { name: 'Citra', cf_subcategory: 'Hops' } },
      { item: { name: 'Pale Malt', cf_subcategory: 'Grain' } }
    ];
    var result = mod.groupResultsByCategory(fuseResults);
    expect(result[0].category).toBe('Hops');
    expect(result[0].items).toHaveLength(3);
    expect(result[1].category).toBe('Grains');
    expect(result[1].items).toHaveLength(1);
  });

  test('collapses subcategories into display names (Bottle+Bag -> Packaging)', function () {
    var fuseResults = [
      { item: { name: 'Beer Bottle', cf_subcategory: 'Bottle' } },
      { item: { name: 'Wine Bag', cf_subcategory: 'Bag' } }
    ];
    var result = mod.groupResultsByCategory(fuseResults);
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe('Packaging');
    expect(result[0].items).toHaveLength(2);
  });

  test('collapses Equipment subcategories (Fermenter -> Equipment)', function () {
    var fuseResults = [
      { item: { name: 'Plastic Fermenter', cf_subcategory: 'Fermenter' } },
      { item: { name: 'Vinyl Tubing', cf_subcategory: 'Tubing' } }
    ];
    var result = mod.groupResultsByCategory(fuseResults);
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe('Equipment');
    expect(result[0].items).toHaveLength(2);
  });

  test('handles items with no cf_subcategory (falls back to Other)', function () {
    var fuseResults = [
      { item: { name: 'Mystery Item' } }
    ];
    var result = mod.groupResultsByCategory(fuseResults);
    expect(result).toHaveLength(1);
    expect(result[0].items).toHaveLength(1);
    // Should fall through to 'Other' display name or raw category
    expect(result[0].category).toBeTruthy();
  });

  test('handles items with empty string cf_subcategory', function () {
    var fuseResults = [
      { item: { name: 'Mystery Item', cf_subcategory: '' } }
    ];
    var result = mod.groupResultsByCategory(fuseResults);
    expect(result).toHaveLength(1);
    expect(result[0].items).toHaveLength(1);
  });

  test('assigns correct page slug via category map', function () {
    var fuseResults = [
      { item: { name: 'Cascade', cf_subcategory: 'Hops' } }
    ];
    var result = mod.groupResultsByCategory(fuseResults);
    expect(result[0].slug).toBe('hops.html');
  });

  test('assigns ingredients-supplies.html slug for unmapped subcategory', function () {
    var fuseResults = [
      { item: { name: 'Widget', cf_subcategory: 'UnknownCategory' } }
    ];
    var result = mod.groupResultsByCategory(fuseResults);
    expect(result[0].slug).toBe('ingredients-supplies.html');
  });
});

// ---------------------------------------------------------------------------
// computeResultCap
// ---------------------------------------------------------------------------

describe('computeResultCap', function () {
  test('returns 10 for 1 category', function () {
    expect(mod.computeResultCap(1)).toBe(10);
  });

  test('returns 10 for 2 categories', function () {
    expect(mod.computeResultCap(2)).toBe(10);
  });

  test('returns 7 for 3 categories', function () {
    expect(mod.computeResultCap(3)).toBe(7);
  });

  test('returns 7 for 4 categories', function () {
    expect(mod.computeResultCap(4)).toBe(7);
  });

  test('returns 5 for 5 categories', function () {
    expect(mod.computeResultCap(5)).toBe(5);
  });

  test('returns 5 for 7 categories', function () {
    expect(mod.computeResultCap(7)).toBe(5);
  });
});
