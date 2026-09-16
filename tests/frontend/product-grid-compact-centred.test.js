'use strict';

// Regression coverage for the 2026-09-16 mobile audit, item 9: between 481px and about 640px the
// compact product grid resolves to a single 320px column that `justify-content: start` pinned to
// the left, leaving the card off-centre on large phones in landscape and small tablets.

var css = require('./_css-helpers');

describe('compact product grid single column', function () {
  test('is centred by the base compact-grid rule', function () {
    // The compact rule is unconditional (not inside a media query); the 480px rule stretches it.
    var b = css.block('.product-grid--compact', null);
    expect(b).not.toBeNull();
    expect(css.decl(b, 'justify-content')).toBe('center');
  });
});
