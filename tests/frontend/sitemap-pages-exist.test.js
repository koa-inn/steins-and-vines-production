'use strict';

// Regression: cider.html was deliberately deleted in b529d430 (2026-08-27) but
// its sitemap entry stayed, so search engines were pointed at a 404. Every
// sitemap <loc> must resolve to a page that ships in the repo (clean URLs:
// /x -> x.html, / -> index.html).

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..', '..');
var SITE = 'https://steinsandvines.ca/';

describe('sitemap.xml', function () {
  var xml = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  var locs = (xml.match(/<loc>[^<]+<\/loc>/g) || []).map(function (l) {
    return l.replace(/<\/?loc>/g, '');
  });

  test('has entries', function () {
    expect(locs.length).toBeGreaterThan(0);
  });

  test('every <loc> maps to an existing page', function () {
    var missing = locs.filter(function (url) {
      var rel = url.indexOf(SITE) === 0 ? url.slice(SITE.length) : url;
      var file = rel === '' ? 'index.html' : rel.replace(/\/$/, '') + '.html';
      return !fs.existsSync(path.join(ROOT, file));
    });
    expect(missing).toEqual([]);
  });
});
