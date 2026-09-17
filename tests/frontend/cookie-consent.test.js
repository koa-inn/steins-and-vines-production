'use strict';

// =============================================================================
// Cookie consent (js/consent.js) — the notice and the Google Tag Manager gate.
//
// Owner decision 2026-09-16: an unobtrusive notice; analytics and advertising
// tags do not load until the visitor accepts; a footer "Cookie settings"
// control reopens it. Privacy Policy §4 promises exactly this, so these tests
// pin the promise.
// =============================================================================

var fs = require('fs');
var path = require('path');
var ROOT = path.join(__dirname, '..', '..');

var KEY = 'sv-cookie-consent';
var GTM_SRC = /googletagmanager\.com\/gtm\.js\?id=GTM-NHRCGLC5/;

function gtmScripts() {
  return Array.from(document.querySelectorAll('script[src]')).filter(function (s) { return GTM_SRC.test(s.src); });
}

function consentPushes(type) {
  return window.dataLayer.filter(function (p) {
    return p && p.length >= 3 && p[0] === 'consent' && p[1] === type;
  }).map(function (p) { return p[2]; });
}

function load(opts) {
  opts = opts || {};
  jest.resetModules();
  document.head.innerHTML = '';
  document.body.innerHTML = '<footer><nav class="footer-legal"><button type="button" data-cookie-settings>Cookie settings</button></nav></footer>';
  window.dataLayer = undefined;
  Object.defineProperty(window.navigator, 'webdriver', { value: !!opts.webdriver, configurable: true });
  window.history.replaceState({}, '', opts.search || '/');
  require('../../js/consent');
}

beforeEach(function () {
  localStorage.clear();
});

describe('first visit', function () {
  test('pushes Consent Mode defaults as denied before anything else', function () {
    load();
    var first = window.dataLayer[0];
    expect(first[0]).toBe('consent');
    expect(first[1]).toBe('default');
    expect(first[2].analytics_storage).toBe('denied');
    expect(first[2].ad_storage).toBe('denied');
    expect(first[2].ad_user_data).toBe('denied');
    expect(first[2].ad_personalization).toBe('denied');
  });

  test('does not load Google Tag Manager and shows the notice', function () {
    load();
    expect(gtmScripts()).toHaveLength(0);
    expect(window.svConsent.gtmLoaded()).toBe(false);
    var notice = document.getElementById('cookie-notice');
    expect(notice).not.toBeNull();
    expect(notice.textContent).toMatch(/cookies/i);
    expect(notice.querySelector('a[href="/privacy.html#cookies"]')).not.toBeNull();
    expect(document.getElementById('cookie-accept')).not.toBeNull();
    expect(document.getElementById('cookie-decline')).not.toBeNull();
  });

  test('Decline and Accept are both plain buttons of the same kind (no dark pattern)', function () {
    load();
    var a = document.getElementById('cookie-accept');
    var d = document.getElementById('cookie-decline');
    expect(a.tagName).toBe(d.tagName);
    expect(a.classList.contains('cookie-notice-btn')).toBe(true);
    expect(d.classList.contains('cookie-notice-btn')).toBe(true);
  });
});

describe('accepting', function () {
  test('stores the choice, updates consent to granted, loads GTM once, removes the notice', function () {
    load();
    document.getElementById('cookie-accept').click();
    var stored = JSON.parse(localStorage.getItem(KEY));
    expect(stored.choice).toBe('accepted');
    expect(typeof stored.at).toBe('number');
    expect(consentPushes('update')).toHaveLength(1);
    expect(consentPushes('update')[0].analytics_storage).toBe('granted');
    expect(gtmScripts()).toHaveLength(1);
    expect(window.dataLayer.some(function (p) { return p && p.event === 'gtm.js' && p['gtm.start']; })).toBe(true);
    expect(document.getElementById('cookie-notice')).toBeNull();
    window.svConsent.accept();
    expect(gtmScripts()).toHaveLength(1);
  });

  test('a stored acceptance loads GTM immediately on the next visit, with no notice', function () {
    localStorage.setItem(KEY, JSON.stringify({ choice: 'accepted', at: Date.now(), v: 1 }));
    load();
    expect(gtmScripts()).toHaveLength(1);
    expect(document.getElementById('cookie-notice')).toBeNull();
  });
});

describe('declining', function () {
  test('stores the choice, loads nothing, removes the notice', function () {
    load();
    document.getElementById('cookie-decline').click();
    expect(JSON.parse(localStorage.getItem(KEY)).choice).toBe('declined');
    expect(gtmScripts()).toHaveLength(0);
    expect(consentPushes('update')).toHaveLength(0);
    expect(document.getElementById('cookie-notice')).toBeNull();
  });

  test('a stored decline is respected on the next visit: no GTM, no notice', function () {
    localStorage.setItem(KEY, JSON.stringify({ choice: 'declined', at: Date.now(), v: 1 }));
    load();
    expect(gtmScripts()).toHaveLength(0);
    expect(document.getElementById('cookie-notice')).toBeNull();
  });
});

describe('expiry and bad storage', function () {
  test('a choice older than a year is asked again', function () {
    localStorage.setItem(KEY, JSON.stringify({ choice: 'accepted', at: Date.now() - 400 * 24 * 3600 * 1000, v: 1 }));
    load();
    expect(gtmScripts()).toHaveLength(0);
    expect(document.getElementById('cookie-notice')).not.toBeNull();
  });

  test('garbage in storage is treated as no choice', function () {
    localStorage.setItem(KEY, '{not json');
    load();
    expect(gtmScripts()).toHaveLength(0);
    expect(document.getElementById('cookie-notice')).not.toBeNull();
  });

  test('a storage that throws still shows the notice and never loads GTM', function () {
    var orig = Storage.prototype.getItem;
    Storage.prototype.getItem = function () { throw new Error('blocked'); };
    try {
      load();
      expect(gtmScripts()).toHaveLength(0);
      expect(document.getElementById('cookie-notice')).not.toBeNull();
    } finally {
      Storage.prototype.getItem = orig;
    }
  });
});

describe('where the notice is suppressed', function () {
  test('kiosk mode (?kiosk=1)', function () {
    load({ search: '/?kiosk=1' });
    expect(document.getElementById('cookie-notice')).toBeNull();
    expect(gtmScripts()).toHaveLength(0);
  });

  test('automation (navigator.webdriver)', function () {
    load({ webdriver: true });
    expect(document.getElementById('cookie-notice')).toBeNull();
    expect(gtmScripts()).toHaveLength(0);
  });
});

describe('Cookie settings control', function () {
  test('reopens the notice after a choice and shows the current choice', function () {
    load();
    document.getElementById('cookie-decline').click();
    expect(document.getElementById('cookie-notice')).toBeNull();
    document.querySelector('[data-cookie-settings]').click();
    var notice = document.getElementById('cookie-notice');
    expect(notice).not.toBeNull();
    expect(notice.textContent).toMatch(/Current choice: declined/);
    document.getElementById('cookie-accept').click();
    expect(JSON.parse(localStorage.getItem(KEY)).choice).toBe('accepted');
    expect(gtmScripts()).toHaveLength(1);
  });
});

describe('public page markup', function () {
  // Every public page that used to carry the inline GTM snippet. links.html
  // (link-in-bio) is out of scope: it is the owner's uncommitted edit.
  var PAGES = ['index.html', 'about.html', 'contact.html', 'custom-labels.html', 'hops.html', 'ingredients.html',
    'products.html', 'reservation.html', 'wine.html', 'beer.html',
    'terms.html', 'refunds.html', 'warranty.html', 'privacy.html',
    'products/ferment-in-store.html', 'products/ingredients-supplies.html', 'products/hops.html',
    'products/grains.html', 'products/yeast.html', 'products/additives.html', 'products/packaging.html',
    'products/equipment.html'];

  PAGES.forEach(function (page) {
    test(page + ' loads consent.js instead of the inline GTM snippet, and has a Cookie settings control', function () {
      var html = fs.readFileSync(path.join(ROOT, page), 'utf8');
      var prefix = page.indexOf('products/') === 0 ? '../' : '';
      expect(html).not.toMatch(/gtm\.js\?id=/);
      expect(html).not.toMatch(/googletagmanager\.com\/ns\.html/);
      expect(html).toContain('<script src="' + prefix + 'js/consent.js"></script>');
      expect(html.indexOf('js/consent.js')).toBeLessThan(html.indexOf('</head>'));
      expect(html).toMatch(/<button[^>]*data-cookie-settings[^>]*>Cookie settings<\/button>/);
    });
  });

  test('the privacy policy describes the gate it now has', function () {
    var html = fs.readFileSync(path.join(ROOT, 'privacy.html'), 'utf8');
    expect(html).toMatch(/only after you accept/i);
    expect(html).toMatch(/Cookie settings/);
  });

  test('staff and error pages carry neither the snippet nor the gate', function () {
    ['404.html', 'kiosk.html', 'admin.html', 'brewpad.html'].forEach(function (page) {
      var html = fs.readFileSync(path.join(ROOT, page), 'utf8');
      expect(html).not.toMatch(/gtm\.js\?id=/);
      expect(html).not.toContain('js/consent.js');
    });
  });
});
