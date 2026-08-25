// Regression guard for phase-72 CR-01: a public page that renders the header
// search button (`.header-search-btn` / `.nav-search-item`) MUST also load the
// search-overlay script, otherwise the button is visually present but inert.
//
// beer.html / cider.html were cloned from the about.html shell (which keeps the
// search button) but deliberately dropped the search-overlay assets — leaving a
// dead button. This test asserts the button <-> script invariant across every
// public HTML page, and is drift-tolerant: pages that carry the older nav
// variant WITHOUT the search button (hops/ingredients/products) are simply
// exempt, because the invariant is conditional on the button being present.

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..', '..');

// Public, nav-bearing HTML pages (root + products/). Staff surfaces
// (admin/kiosk/brewpad/batch) are intentionally excluded — they are not part
// of the public nav and have their own shells.
var PUBLIC_PAGES = [
  'index.html', 'about.html', 'contact.html', 'custom-labels.html',
  'hops.html', 'ingredients.html', 'products.html', 'reservation.html',
  '404.html', 'beer.html', 'cider.html',
  'products/ferment-in-store.html', 'products/ingredients-supplies.html',
  'products/hops.html', 'products/grains.html', 'products/yeast.html',
  'products/additives.html', 'products/packaging.html', 'products/equipment.html'
];

// Matches the search-overlay module script whether minified or not, with or
// without a cache-bust ?v= token: js/modules/17-search-overlay(.min).js
var SEARCH_SCRIPT_RE = /17-search-overlay(\.min)?\.js/;
var SEARCH_BUTTON_RE = /header-search-btn|nav-search-item/;

describe('public page search button <-> search-overlay script consistency', function () {
  PUBLIC_PAGES.forEach(function (page) {
    test(page + ': if it shows the search button it must load the search script', function () {
      var abs = path.join(ROOT, page);
      var html = fs.readFileSync(abs, 'utf8');
      var hasButton = SEARCH_BUTTON_RE.test(html);
      if (!hasButton) {
        // Exempt: page has no search button (drifted nav variant) — nothing to enforce.
        return;
      }
      expect(html).toMatch(SEARCH_SCRIPT_RE);
    });
  });
});
