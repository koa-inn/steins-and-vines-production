'use strict';

// Owner note (2026-10-14): the beer card subtitle (style line) was hard to read —
// 11px condensed caps with 0.25em tracking in gold or the tint colour, most of
// which sit at 2.1-3.8:1 on the label background. The subtitle (and brand line)
// now use a darker per-tint --tint-text shade and a larger size; borders, rules
// and the body wash keep the original --tint.

var css = require('./_css-helpers');

var LABEL_BG = '#faf8f2';
var BEER_TINTS = ['pilsner', 'amber', 'wheat', 'ipa', 'pale', 'session', 'saison',
  'lager', 'stout', 'porter', 'redale', 'brown'];

function lum(hex) {
  var h = hex.replace('#', '');
  return [0, 2, 4].map(function (i) { return parseInt(h.substr(i, 2), 16) / 255; })
    .map(function (c) { return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); })
    .reduce(function (s, c, i) { return s + c * [0.2126, 0.7152, 0.0722][i]; }, 0);
}

function contrast(a, b) {
  var la = lum(a), lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function hexOf(value) {
  var m = /#[0-9a-fA-F]{6}/.exec(value || '');
  return m ? m[0] : null;
}

describe('beer card subtitle legibility', function () {
  test('default subtitle colour is a literal hex with at least 4.5:1 contrast', function () {
    var b = css.block('.label-beer .subcategory', null);
    var colour = hexOf(css.decl(b, 'color'));
    expect(colour).not.toBeNull();
    expect(contrast(colour, LABEL_BG)).toBeGreaterThanOrEqual(4.5);
  });

  test('subtitle is at least 0.75rem with tracking no wider than 0.15em', function () {
    var b = css.block('.label-beer .subcategory', null);
    expect(parseFloat(css.decl(b, 'font-size'))).toBeGreaterThanOrEqual(0.75);
    expect(parseFloat(css.decl(b, 'letter-spacing'))).toBeLessThanOrEqual(0.15);
  });

  test('tinted subtitle and brand use the readable --tint-text shade', function () {
    expect(css.decl(css.block('.label-beer[class*="tint-"] .subcategory', null), 'color')).toContain('var(--tint-text');
    expect(css.decl(css.block('.label-beer[class*="tint-"] .brand', null), 'color')).toContain('var(--tint-text');
  });

  BEER_TINTS.forEach(function (t) {
    test('tint-' + t + ' text shade reaches 4.5:1', function () {
      var b = css.block('.tint-' + t, null);
      var colour = hexOf(css.decl(b, '--tint-text'));
      expect(colour).not.toBeNull();
      expect(contrast(colour, LABEL_BG)).toBeGreaterThanOrEqual(4.5);
    });
  });
});
