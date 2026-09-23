'use strict';

// =============================================================================
// HOLD-BACK (2026-09-23): the beer programme is not launched. beer.html ships
// to production but is unlinked from every page, absent from the sitemap and
// marked noindex, so it is reachable only by URL. Delete this file with the
// launch commit that restores the nav item, the hub tile, the sitemap entry
// and flips BEER_PAGE_LIVE.
// =============================================================================

var fs = require('fs');
var path = require('path');
var glob = function (dir) { return fs.readdirSync(dir).filter(function (f) { return /\.html$/.test(f); }); };
var ROOT = path.join(__dirname, '..', '..');
var read = function (p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); };

var PAGES = glob(ROOT).filter(function (f) { return f !== 'links.html'; })
  .concat(glob(path.join(ROOT, 'products')).map(function (f) { return 'products/' + f; }));

describe('beer page hold-back', function () {
  test('no public page links to beer.html (not even beer.html itself)', function () {
    PAGES.forEach(function (p) {
      var html = read(p);
      expect({ page: p, links: (html.match(/href="(\.\.\/)?beer\.html/g) || []).length }).toEqual({ page: p, links: 0 });
    });
  });

  test('beer.html is deployed, noindex, and still carries its waitlist form', function () {
    var html = read('beer.html');
    expect(html).toMatch(/<meta name="robots" content="noindex, nofollow">/);
    expect(html).toContain('id="beer-waitlist-form"');
  });

  test('the sitemap does not list the beer page', function () {
    expect(read('sitemap.xml')).not.toMatch(/steinsandvines\.ca\/beer</);
  });

  test('the hub has no Explore Beer tile', function () {
    expect(read('products/ferment-in-store.html')).not.toMatch(/Explore Beer/);
  });

  test('the config flag is off', function () {
    expect(read('js/modules/01-config.js')).toMatch(/var BEER_PAGE_LIVE = false;/);
  });
});

describe('beer kit card CTA while held back', function () {
  test('links to contact.html off the beer page, and to #waitlist on it', function () {
    global.KIT_CATEGORIES = ['wine', 'beer'];
    global.fetch = function () { return Promise.resolve({ ok: false, json: function () { return Promise.resolve({}); } }); };
    global.SHEETS_CONFIG = { MIDDLEWARE_URL: '' };
    global.showCatalogSkeletons = function () {};
    global.formatCurrency = function (v) { return '$' + Number(v).toFixed(2); };
    global.BEER_PAGE_LIVE = false;
    var mod = require('../../js/modules/07-catalog-kits.js');
    document.body.setAttribute('data-page', 'home');
    expect(mod.buildWaitlistCtaLink(document).querySelector('a').getAttribute('href')).toBe('contact.html');
    document.body.setAttribute('data-page', 'beer');
    expect(mod.buildWaitlistCtaLink(document).querySelector('a').getAttribute('href')).toBe('#waitlist');
    global.BEER_PAGE_LIVE = true;
    document.body.setAttribute('data-page', 'home');
    expect(mod.buildWaitlistCtaLink(document).querySelector('a').getAttribute('href')).toBe('beer.html#waitlist');
  });
});
