'use strict';

// Regression coverage for the 2026-09-16 mobile audit, item 4: the beer waitlist email field and
// the catalogue search boxes on beer.html and wine.html carried only a placeholder. Placeholders
// are not accessible names, so screen readers announced them as unlabelled edit fields.

var fs = require('fs');
var path = require('path');

function inputs(file, re) {
  var html = fs.readFileSync(path.join(__dirname, '../../', file), 'utf8');
  var out = [];
  html.replace(/<input\b[^>]*>/g, function (tag) { if (re.test(tag)) out.push(tag); });
  return out;
}

function hasAccessibleName(tag) {
  return /\baria-label="[^"]+"/.test(tag) || /\baria-labelledby="[^"]+"/.test(tag);
}

describe('inputs on the category pages have accessible names', function () {
  test('beer.html waitlist email field', function () {
    var tags = inputs('beer.html', /id="beer-waitlist-email"/);
    expect(tags.length).toBe(1);
    expect(hasAccessibleName(tags[0])).toBe(true);
  });

  test('beer.html catalogue search box', function () {
    var tags = inputs('beer.html', /class="catalog-search"/);
    expect(tags.length).toBe(1);
    expect(hasAccessibleName(tags[0])).toBe(true);
  });

  test('wine.html catalogue search box', function () {
    var tags = inputs('wine.html', /class="catalog-search"/);
    expect(tags.length).toBe(1);
    expect(hasAccessibleName(tags[0])).toBe(true);
  });
});
