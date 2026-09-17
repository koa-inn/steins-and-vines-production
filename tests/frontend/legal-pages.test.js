'use strict';

// =============================================================================
// Policy pages (terms / refunds / warranty / privacy) and the site-wide
// footer links to them.
//
// Guards:
//   - each page exists, carries the SAME CSP meta as a sibling public page
//     (CLAUDE.md rule 12), names the legal entity, and has no draft markers
//   - every public page's footer links to all four pages, with the correct
//     relative prefix from products/
//   - the build's stamp list and the sitemap know about the pages
// =============================================================================

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..', '..');
var read = function (p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); };

var LEGAL_PAGES = ['terms.html', 'refunds.html', 'warranty.html', 'privacy.html'];

// Public pages that carry the shared footer. links.html is a link-in-bio page
// with its own footer and is out of scope; staff surfaces are excluded.
var ROOT_PAGES = ['index.html', 'about.html', 'contact.html', 'custom-labels.html', 'hops.html',
  'ingredients.html', 'products.html', 'reservation.html', 'wine.html', 'beer.html', '404.html'];
var SUB_PAGES = ['products/ferment-in-store.html', 'products/ingredients-supplies.html',
  'products/hops.html', 'products/grains.html', 'products/yeast.html', 'products/additives.html',
  'products/packaging.html', 'products/equipment.html'];

var CSP_RE = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/;

describe('policy pages', function () {
  var siblingCsp = read('about.html').match(CSP_RE)[1];

  LEGAL_PAGES.forEach(function (page) {
    describe(page, function () {
      var html = read(page);

      test('carries the same CSP as about.html', function () {
        var m = html.match(CSP_RE);
        expect(m).not.toBeNull();
        expect(m[1]).toBe(siblingCsp);
      });

      test('names the legal entity and the store address', function () {
        expect(html).toContain('1571221 B.C. Ltd.');
        expect(html).toContain('11-38918 Progress Way');
      });

      test('has no draft markers left in it', function () {
        expect(html).not.toContain('[CONFIRM');
        expect(html).not.toMatch(/DRAFT/);
      });

      test('has a canonical URL, a title and the legal page nav', function () {
        expect(html).toContain('<link rel="canonical" href="https://steinsandvines.ca/' + page.replace('.html', '') + '">');
        expect(html).toMatch(/<title>[^<]+\| Steins &amp; Vines<\/title>/);
        expect(html).toContain('class="legal-nav"');
        expect(html).toContain('data-page="legal"');
      });

      test('links to the other three policies', function () {
        LEGAL_PAGES.filter(function (p) { return p !== page; }).forEach(function (other) {
          expect(html).toContain('href="' + other + '"');
        });
      });
    });
  });

  test('the privacy page describes the cookie-consent gate that js/consent.js provides', function () {
    var html = read('privacy.html');
    expect(html).toMatch(/only after you accept/i);
    expect(html).toMatch(/Cookie settings/);
  });

  test('the terms page reflects the checkout acknowledgement rather than describing it as a build item', function () {
    expect(read('terms.html')).not.toMatch(/build phase/i);
  });
});

describe('footer policy links on every public page', function () {
  ROOT_PAGES.forEach(function (page) {
    test(page + ' links to all four policies', function () {
      var html = read(page);
      expect(html).toContain('<nav class="footer-legal"');
      LEGAL_PAGES.forEach(function (p) {
        expect(html).toContain('href="' + p + '"');
      });
    });
  });

  SUB_PAGES.forEach(function (page) {
    test(page + ' links to all four policies via ../', function () {
      var html = read(page);
      expect(html).toContain('<nav class="footer-legal"');
      LEGAL_PAGES.forEach(function (p) {
        expect(html).toContain('href="../' + p + '"');
      });
    });
  });

  test('the footer nav appears exactly once per page', function () {
    ROOT_PAGES.concat(SUB_PAGES).concat(LEGAL_PAGES).forEach(function (page) {
      var count = (read(page).match(/<nav class="footer-legal"/g) || []).length;
      expect({ page: page, count: count }).toEqual({ page: page, count: 1 });
    });
  });
});

describe('build and discovery', function () {
  test('the stamp:pages build step covers the policy pages', function () {
    var pkg = JSON.parse(read('package.json'));
    LEGAL_PAGES.forEach(function (p) {
      expect(pkg.scripts['stamp:pages']).toContain("'" + p + "'");
    });
  });

  test('the sitemap lists the policy pages', function () {
    var sitemap = read('sitemap.xml');
    LEGAL_PAGES.forEach(function (p) {
      expect(sitemap).toContain('<loc>https://steinsandvines.ca/' + p.replace('.html', '') + '</loc>');
    });
  });
});
