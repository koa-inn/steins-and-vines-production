var hops = require('../../js/modules/15-hops.js');

describe('groupHopsByVariant', function () {
  test('groups two size variants by name stem', function () {
    var items = [
      { name: 'Amarillo - 1 oz', price_per_unit: '5.00' },
      { name: 'Amarillo - 4 oz', price_per_unit: '15.00' },
      { name: 'Cascade - 1 oz', price_per_unit: '4.00' }
    ];
    var groups = hops.groupHopsByVariant(items);
    expect(groups).toHaveLength(2);
    expect(groups[0].name).toBe('Amarillo');
    expect(groups[0].variants).toHaveLength(2);
    expect(groups[0].variants[0].price_per_unit).toBe('5.00');
    expect(groups[1].name).toBe('Cascade');
    expect(groups[1].variants).toHaveLength(1);
  });

  test('handles items without size suffix', function () {
    var items = [{ name: 'Amarillo Hop Pellets', price_per_unit: '70.00' }];
    var groups = hops.groupHopsByVariant(items);
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('Amarillo Hop Pellets');
    expect(groups[0].variants).toHaveLength(1);
  });

  test('sorts variants by price ascending', function () {
    var items = [
      { name: 'Cascade - 4 oz', price_per_unit: '12.00' },
      { name: 'Cascade - 1 oz', price_per_unit: '4.00' }
    ];
    var groups = hops.groupHopsByVariant(items);
    expect(groups[0].variants[0].price_per_unit).toBe('4.00');
    expect(groups[0].variants[1].price_per_unit).toBe('12.00');
  });

  test('returns empty array for empty input', function () {
    expect(hops.groupHopsByVariant([])).toEqual([]);
  });
});

describe('getTopFlavorTags', function () {
  test('returns top 3 flavors sorted by score descending', function () {
    var item = { citrus: '4', tropical: '2', floral: '5', spicy: '0', pine: '1', herbal: '3' };
    var tags = hops.getTopFlavorTags(item, 3);
    expect(tags).toHaveLength(3);
    expect(tags[0]).toEqual({ label: 'Floral', value: 5 });
    expect(tags[1]).toEqual({ label: 'Citrus', value: 4 });
    expect(tags[2]).toEqual({ label: 'Herbal', value: 3 });
  });

  test('excludes zero-scored axes', function () {
    var item = { citrus: '2', tropical: '0', floral: '0', spicy: '0', pine: '0', herbal: '0' };
    var tags = hops.getTopFlavorTags(item, 3);
    expect(tags).toHaveLength(1);
    expect(tags[0].label).toBe('Citrus');
  });

  test('returns empty array when all scores are zero', function () {
    var item = { citrus: '0', tropical: '0', floral: '0', spicy: '0', pine: '0', herbal: '0' };
    expect(hops.getTopFlavorTags(item, 3)).toEqual([]);
  });

  test('handles missing fields gracefully', function () {
    var item = {};
    expect(hops.getTopFlavorTags(item, 3)).toEqual([]);
  });
});

describe('getDominantFlavor', function () {
  test('returns label of highest-scoring axis', function () {
    var item = { citrus: '1', tropical: '5', floral: '0', spicy: '0', pine: '0', herbal: '0' };
    expect(hops.getDominantFlavor(item)).toBe('Tropical');
  });

  test('returns null when all scores are zero', function () {
    var item = { citrus: '0', tropical: '0', floral: '0', spicy: '0', pine: '0', herbal: '0' };
    expect(hops.getDominantFlavor(item)).toBeNull();
  });

  test('returns null for empty item', function () {
    expect(hops.getDominantFlavor({})).toBeNull();
  });

  test('breaks ties by returning first axis alphabetically in HOP_AXES order', function () {
    var item = { citrus: '3', tropical: '3', floral: '0', spicy: '0', pine: '0', herbal: '0' };
    // citrus comes before tropical in HOP_AXES order
    expect(hops.getDominantFlavor(item)).toBe('Citrus');
  });
});

describe('buildHopRadarChart', function () {
  test('returns an SVG element with hop-radar class', function () {
    var item = { name: 'Amarillo', citrus: '4', tropical: '2', floral: '1', spicy: '0', pine: '3', herbal: '2' };
    var svg = hops.buildHopRadarChart(item);
    expect(svg.tagName.toLowerCase()).toBe('svg');
    expect(svg.getAttribute('class')).toBe('hop-radar');
  });

  test('sets role=img and aria-label with scores', function () {
    var item = { name: 'Cascade', citrus: '3', tropical: '0', floral: '4', spicy: '1', pine: '2', herbal: '0' };
    var svg = hops.buildHopRadarChart(item);
    expect(svg.getAttribute('role')).toBe('img');
    var label = svg.getAttribute('aria-label');
    expect(label).toContain('Citrus 3/5');
    expect(label).toContain('Floral 4/5');
  });

  test('includes radar-fill polygon when scores are non-zero', function () {
    var item = { citrus: '3', tropical: '2', floral: '1', spicy: '1', pine: '2', herbal: '1' };
    var svg = hops.buildHopRadarChart(item);
    var fills = svg.querySelectorAll('.radar-fill');
    expect(fills).toHaveLength(1);
  });

  test('omits radar-fill polygon when all scores are zero', function () {
    var item = { citrus: '0', tropical: '0', floral: '0', spicy: '0', pine: '0', herbal: '0' };
    var svg = hops.buildHopRadarChart(item);
    var fills = svg.querySelectorAll('.radar-fill');
    expect(fills).toHaveLength(0);
  });

  test('draws 5 concentric web rings', function () {
    var item = { citrus: '3', tropical: '2', floral: '1', spicy: '1', pine: '2', herbal: '1' };
    var svg = hops.buildHopRadarChart(item);
    var webs = svg.querySelectorAll('.radar-web');
    expect(webs).toHaveLength(5);
  });

  test('draws 6 axis lines', function () {
    var item = { citrus: '3', tropical: '2', floral: '1', spicy: '1', pine: '2', herbal: '1' };
    var svg = hops.buildHopRadarChart(item);
    var axes = svg.querySelectorAll('.radar-axis');
    expect(axes).toHaveLength(6);
  });

  test('draws 6 axis labels', function () {
    var item = { citrus: '3', tropical: '2', floral: '1', spicy: '1', pine: '2', herbal: '1' };
    var svg = hops.buildHopRadarChart(item);
    var labels = svg.querySelectorAll('.radar-label');
    expect(labels).toHaveLength(6);
    var labelTexts = Array.from(labels).map(function (l) { return l.textContent; });
    expect(labelTexts).toContain('Citrus');
    expect(labelTexts).toContain('Herbal');
  });
});
