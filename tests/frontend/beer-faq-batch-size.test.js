'use strict';

// Regression: beer.html's FAQ quoted a 30 L batch, but every active beer
// recipe is batch_size_l: 28 (verified 2026-10-13). Customer-facing number.

var fs = require('fs');
var path = require('path');

describe('beer.html FAQ batch size', function () {
  var html = fs.readFileSync(path.join(__dirname, '../../beer.html'), 'utf8');

  test('quotes the 28 L batch size', function () {
    expect(html).toMatch(/standard 28&nbsp;L batch/);
  });

  test('does not quote a 30 L batch anywhere', function () {
    expect(html).not.toMatch(/30(&nbsp;|\s)L\b/);
  });
});
