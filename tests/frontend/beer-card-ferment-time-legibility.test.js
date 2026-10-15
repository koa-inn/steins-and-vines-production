'use strict';

// Owner note (2026-10-15): the "Ready in / about N weeks" column on tinted beer
// cards was faded and hard to read. The tinted rule meant to soften the divider
// between the two footer columns set `opacity: 0.3` on the whole second column,
// fading its text with it. Only the divider should be softened, and the small
// ferment-time line uses the readable --tint-text shade, like the subtitle.

var css = require('./_css-helpers');

describe('beer card ferment-time legibility', function () {
  test('the tinted second footer column is not faded with opacity', function () {
    var b = css.block('.label-beer[class*="tint-"] .price-col + .price-col', null);
    expect(css.decl(b, 'opacity')).toBeFalsy();
  });

  test('the tinted divider between footer columns is still softened', function () {
    var b = css.block('.label-beer[class*="tint-"] .price-col + .price-col', null);
    expect(css.decl(b, 'border-left-color')).toMatch(/color-mix\(in srgb, var\(--tint-border\) 30%, transparent\)/);
  });

  test('tinted ferment-time text uses the readable --tint-text shade', function () {
    var b = css.block('.label-beer[class*="tint-"] .price-value.ferment-time-value', null);
    expect(css.decl(b, 'color')).toContain('var(--tint-text');
  });
});
