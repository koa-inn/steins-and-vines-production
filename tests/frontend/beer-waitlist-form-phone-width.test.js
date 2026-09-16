'use strict';

// Regression coverage for the 2026-09-16 mobile audit, item 8: on a 390px viewport the waitlist
// email field spanned the column but the "Join the Waitlist" submit and the "or call" link were
// narrower than it and different widths from each other. Below 480px all three should fill the
// column, matching the stacked full-width hero CTAs.

var css = require('./_css-helpers');

describe('beer waitlist form at phone width', function () {
  test('submit button fills the column below 480px', function () {
    var b = css.block('.beer-waitlist-form .beer-waitlist-btn', 'max-width: 480px');
    expect(css.decl(b, 'width')).toBe('100%');
  });

  test('email field fills the column below 480px', function () {
    var b = css.block('.beer-waitlist-form input[type="email"]', 'max-width: 480px');
    expect(css.decl(b, 'width')).toBe('100%');
  });

  test('the "or call" secondary button fills the column below 480px', function () {
    var b = css.block('#waitlist .btn-secondary', 'max-width: 480px');
    expect(css.decl(b, 'width')).toBe('100%');
  });
});
