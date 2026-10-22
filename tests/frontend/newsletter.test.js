'use strict';

// Main mailing list signup (js/newsletter.js + the form on links, home and
// contact pages), 2026-10-22.

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..', '..');
var PAGES = { 'links.html': 'links', 'index.html': 'home', 'contact.html': 'contact' };

function mount() {
  document.body.innerHTML =
    '<section class="newsletter-signup"><div class="container">' +
    '<form class="newsletter-form" data-newsletter="links" novalidate>' +
    '<input type="email" name="email" required>' +
    '<input type="text" name="company" class="newsletter-hp">' +
    '<button type="submit" class="btn newsletter-btn">Sign up</button></form>' +
    '<p class="newsletter-status" role="status"></p>' +
    '<p class="newsletter-consent">By signing up,   you agree to receive emails.</p>' +
    '</div></section>';
  jest.isolateModules(function () { require('../../js/newsletter.js'); });
  return {
    form: document.querySelector('form'),
    email: document.querySelector('input[name="email"]'),
    hp: document.querySelector('input[name="company"]'),
    btn: document.querySelector('button'),
    status: document.querySelector('.newsletter-status')
  };
}

function respond(status, body) {
  global.fetch = jest.fn(function () {
    return Promise.resolve({ ok: status >= 200 && status < 300, status: status, json: function () { return Promise.resolve(body); } });
  });
}

function submit(form) {
  form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  return new Promise(function (r) { setTimeout(r, 0); });
}

beforeEach(function () {
  window.SHEETS_CONFIG = { MIDDLEWARE_URL: 'https://mw.test' };
  window.dataLayer = [];
});

describe('newsletter form behaviour', function () {
  test('posts email, source, honeypot and the consent text to /api/newsletter', async function () {
    var el = mount();
    respond(200, { success: true });
    el.email.value = ' pat@example.com ';
    await submit(el.form);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    var call = global.fetch.mock.calls[0];
    expect(call[0]).toBe('https://mw.test/api/newsletter');
    expect(JSON.parse(call[1].body)).toEqual({
      email: 'pat@example.com', source: 'links', company: '', consent: true,
      consent_text: 'By signing up, you agree to receive emails.'
    });
  });

  test('success hides the form, thanks the visitor and pushes newsletter_signup', async function () {
    var el = mount();
    respond(200, { success: true });
    el.email.value = 'pat@example.com';
    await submit(el.form);

    expect(el.form.hidden).toBe(true);
    expect(el.status.textContent).toContain('on the list');
    expect(window.dataLayer).toEqual([{ event: 'newsletter_signup', newsletter_source: 'links' }]);
  });

  test('a server error keeps the form, re-enables the button and says so', async function () {
    var el = mount();
    respond(503, { error: 'Sign-up is temporarily unavailable' });
    el.email.value = 'pat@example.com';
    await submit(el.form);

    expect(el.form.hidden).toBe(false);
    expect(el.btn.disabled).toBe(false);
    expect(el.btn.textContent).toBe('Sign up');
    expect(el.status.classList.contains('newsletter-status--error')).toBe(true);
    expect(window.dataLayer).toEqual([]);
  });

  test('an invalid email is caught before any request', async function () {
    var el = mount();
    respond(200, { success: true });
    el.email.value = 'not-an-email';
    await submit(el.form);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(el.status.textContent).toContain('valid email');
  });
});

describe('newsletter markup on each page', function () {
  Object.keys(PAGES).forEach(function (page) {
    test(page + ' has the form, consent statement, honeypot and script', function () {
      var html = fs.readFileSync(path.join(ROOT, page), 'utf8');
      expect(html).toContain('data-newsletter="' + PAGES[page] + '"');
      expect(html).toMatch(/class="newsletter-consent">By signing up, you agree to receive emails from Steins &amp; Vines/);
      expect(html).toContain('href="privacy.html">Privacy Policy</a>');
      expect(html).toMatch(/name="company" class="newsletter-hp" tabindex="-1"/);
      expect(html).toMatch(/<script src="js\/newsletter\.js"( defer)?><\/script>/);
      expect(html).toMatch(/<script src="js\/sheets-config\.js[^"]*"( defer)?><\/script>/);
      // The form posts to the middleware, which the page's CSP must allow.
      expect(html).toMatch(/connect-src[^"]*https:\/\/svmiddleware-production\.up\.railway\.app/);
    });
  });
});
