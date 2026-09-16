'use strict';

// Regression coverage for the 2026-09-16 pre-cutover mobile audit, items 5 and 7:
//   - the card copy-link button measured 19x19px, the catalogue refresh button 32x32px and the
//     Filters & Sort toggle 35px tall on a 390px viewport. WCAG 2.5.8 requires 24px; 44px is
//     the conventional phone target.
//   - the "Ferment in store" / "Kit only" price labels rendered at 9px and the beer card brand
//     and time lines at 11px, under the usual 12px legibility floor.
// Declared-value assertions only; layout is verified in a browser on staging.

var css = require('./_css-helpers');

function px(v) {
  if (v == null) return NaN;
  if (/rem$/.test(v)) return parseFloat(v) * 16;
  return parseFloat(v);
}

describe('touch targets on phones', function () {
  test('.product-link-btn has a 44px minimum hit area', function () {
    var b = css.block('.product-link-btn', null);
    expect(px(css.decl(b, 'min-width'))).toBeGreaterThanOrEqual(44);
    expect(px(css.decl(b, 'min-height'))).toBeGreaterThanOrEqual(44);
  });

  test('.catalog-refresh-btn is at least 44px square below 1024px', function () {
    var b = css.block('.catalog-refresh-btn', 'max-width: 1023px');
    expect(b).not.toBeNull();
    expect(px(css.decl(b, 'width'))).toBeGreaterThanOrEqual(44);
    expect(px(css.decl(b, 'height'))).toBeGreaterThanOrEqual(44);
  });

  test('.catalog-toggle is at least 44px tall below 1024px', function () {
    var b = css.block('.catalog-toggle', 'max-width: 1023px');
    expect(b).not.toBeNull();
    expect(px(css.decl(b, 'min-height'))).toBeGreaterThanOrEqual(44);
  });
});

describe('card label legibility', function () {
  test('price column labels are at least 11px on both card styles', function () {
    ['.label-wine .price-label', '.label-beer .price-label'].forEach(function (sel) {
      expect(px(css.decl(css.block(sel), 'font-size'))).toBeGreaterThanOrEqual(11);
    });
  });

  test('beer card brand and time lines are at least 12px', function () {
    ['.label-beer .brand', '.label-beer .time'].forEach(function (sel) {
      expect(px(css.decl(css.block(sel), 'font-size'))).toBeGreaterThanOrEqual(12);
    });
  });
});
