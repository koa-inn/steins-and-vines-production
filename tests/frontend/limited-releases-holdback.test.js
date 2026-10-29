'use strict';

// =============================================================================
// Phase 100 hold-back. DELETE this file in the launch commit (Plan 14), which
// adds the nav link on every page and the sitemap entry and removes noindex.
// =============================================================================

var fs = require('fs');
var path = require('path');
var glob = function (dir) { return fs.readdirSync(dir).filter(function (f) { return /\.html$/.test(f); }); };
var ROOT = path.join(__dirname, '..', '..');
var read = function (p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); };

var PAGES = glob(ROOT).filter(function (f) { return f !== 'links.html'; })
  .concat(glob(path.join(ROOT, 'products')).map(function (f) { return 'products/' + f; }));

describe('limited releases page hold-back', function () {
  test('no public page links to limited-releases (not even the page itself)', function () {
    PAGES.forEach(function (p) {
      var html = read(p);
      var links = (html.match(/href="(\.\.\/)?(\/limited-releases|limited-releases\.html)/g) || []).length;
      expect({ page: p, links: links }).toEqual({ page: p, links: 0 });
    });
  });

  test('limited-releases.html is deployed and noindex', function () {
    expect(read('limited-releases.html')).toMatch(/<meta name="robots" content="noindex, nofollow">/);
  });

  test('the sitemap does not list the page', function () {
    expect(read('sitemap.xml')).not.toContain('limited-releases');
  });
});
