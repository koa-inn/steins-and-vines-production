'use strict';

// Owner note (2026-10-15): on beer.html the kit search / view toggle / Filters & Sort bar
// sat between the recipe grid and the "Beer Kits" heading, only filtered the kit list
// (one kit), stuck over the headings while scrolling, and became a fixed bottom bar on
// phones. The beer page drops it; pages with real kit catalogues keep theirs.

var fs = require('fs');
var path = require('path');

function page(name) {
  var doc = new DOMParser().parseFromString(fs.readFileSync(path.join(__dirname, '..', '..', name), 'utf8'), 'text/html');
  return doc;
}

describe('beer page kit controls', function () {
  test('beer.html has no kit catalogue control bar or search box', function () {
    var doc = page('beer.html');
    expect(doc.getElementById('catalog-controls-kits')).toBeNull();
    expect(doc.getElementById('catalog-search')).toBeNull();
    expect(doc.querySelectorAll('.catalog-controls').length).toBe(0);
  });

  test('beer.html still has the catalogue container the kit and recipe blocks render into', function () {
    var doc = page('beer.html');
    expect(doc.getElementById('product-catalog')).not.toBeNull();
    expect(doc.getElementById('catalog-blocks')).not.toBeNull();
  });

  test('wine.html keeps its kit search bar', function () {
    var doc = page('wine.html');
    expect(doc.getElementById('catalog-search')).not.toBeNull();
  });
});
