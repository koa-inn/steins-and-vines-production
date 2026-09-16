'use strict';

// CSS side of the 2026-09-16 mobile audit bar fixes: the bar is off-screen until JS marks it
// .is-visible, and it never paints over the open mobile nav menu (body.nav-open).

var css = require('./_css-helpers');

describe('#mobile-catalog-bar CSS', function () {
  test('is translated off-screen by default and back on when .is-visible', function () {
    var base = css.block('#mobile-catalog-bar', null);
    expect(css.decl(base, 'transform')).toMatch(/translateY\(1\d\d%\)/);
    var vis = css.block('#mobile-catalog-bar.is-visible', null);
    expect(css.decl(vis, 'transform')).toBe('none');
  });

  test('is hidden while the mobile nav is open', function () {
    var b = css.block('body.nav-open #mobile-catalog-bar', null);
    expect(b).not.toBeNull();
    expect(css.decl(b, 'visibility')).toBe('hidden');
  });
});
