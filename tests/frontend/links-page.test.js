'use strict';

// links.html (Instagram link-in-bio page), 2026-10-22.
// Pins: the cookie-consent gate every other public page has (docs/TRACKING.md),
// the click-tracking hooks, and the opening hours matching the rest of the site.

var fs = require('fs');
var path = require('path');

var html = fs.readFileSync(path.join(__dirname, '..', '..', 'links.html'), 'utf8');

describe('links.html', function () {
  test('loads GTM only through consent.js (no inline snippet or noscript iframe)', function () {
    expect(html).not.toMatch(/gtm\.js\?id=/);
    expect(html).not.toMatch(/googletagmanager\.com\/ns\.html/);
    expect(html).toContain('<script src="js/consent.js"></script>');
    expect(html.indexOf('js/consent.js')).toBeLessThan(html.indexOf('</head>'));
  });

  test('has a Cookie settings control', function () {
    expect(html).toMatch(/<button[^>]*data-cookie-settings[^>]*>Cookie settings<\/button>/);
  });

  test('every outbound link carries a unique data-track id', function () {
    var ids = (html.match(/data-track="([^"]+)"/g) || []).map(function (m) { return m.slice(12, -1); });
    expect(ids.sort()).toEqual([
      'book_ferment', 'contact', 'facebook_icon', 'google_review', 'instagram_button',
      'instagram_icon', 'map_directions', 'squamish_chief', 'website'
    ]);
  });

  test('click tracking pushes linkinbio_click to the dataLayer', function () {
    document.documentElement.innerHTML = html.replace(/<script src="js\/consent\.js"><\/script>/, '');
    // jsdom does not run scripts set via innerHTML; run the inline tracker directly.
    var scripts = Array.prototype.slice.call(document.querySelectorAll('script:not([src])'));
    var tracker = scripts.filter(function (s) { return s.textContent.indexOf('linkinbio_click') !== -1; })[0];
    window.dataLayer = [];
    new Function(tracker.textContent)(); // eslint-disable-line no-new-func -- runs the page's own inline script

    var icon = document.querySelector('a[data-track="instagram_icon"] svg');
    icon.addEventListener('click', function (e) { e.preventDefault(); });
    icon.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    var ev = window.dataLayer.filter(function (d) { return d.event === 'linkinbio_click'; });
    expect(ev).toHaveLength(1);
    expect(ev[0].link_id).toBe('instagram_icon');
    expect(ev[0].link_url).toContain('instagram.com/steinsandvinessq');
  });

  test('shows Thursday as 12PM-7PM, matching the site footer', function () {
    expect(html).toMatch(/Thu 12PM&ndash;7PM/);
    expect(html).not.toMatch(/Tue&ndash;Sat 10AM/);
  });
});
