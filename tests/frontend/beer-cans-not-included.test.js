'use strict';

// Regression: beer.html's "What's Included" promised "canning and lids" and
// "Nothing extra gets added on canning day". Cans and lids are a separate
// charge (owner, 2026-10-14): a flat $40 per beer batch (up to 55 x 473 mL or
// 72 x 355 mL), $35 for cider / sparkling wine (up to 50 x 473 mL or 68 x 355 mL).
// Still wine is not canned. Customers may bring their own (terms.html).

var fs = require('fs');
var path = require('path');

describe('beer.html cans and lids copy', function () {
  var html = fs.readFileSync(path.join(__dirname, '../../beer.html'), 'utf8');

  test('does not claim cans or lids are included', function () {
    expect(html).not.toMatch(/canning and lids/i);
    expect(html).not.toMatch(/nothing extra/i);
  });

  test('states the beer can bundle price and cap', function () {
    expect(html).toMatch(/\$40 per beer batch/);
    expect(html).toMatch(/55 tall cans \(473&nbsp;mL\) or 72 regular cans \(355&nbsp;mL\)/);
  });

  test('states the cider / sparkling wine bundle and that still wine is not canned', function () {
    expect(html).toMatch(/\$35 per 23&nbsp;L batch \(up to 50 tall or 68 regular cans\)/);
    expect(html).toMatch(/don&rsquo;t can still wine/);
  });

  test('says customers may bring their own cans or bottles', function () {
    expect(html).toMatch(/bring your own cans or bottles/);
  });
});
