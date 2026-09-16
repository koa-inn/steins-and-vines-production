'use strict';

// Regression coverage for the 2026-09-16 mobile audit, item 6: beer.html's FAQ was six hardcoded
// <h3>/<p> pairs of centred prose (300-500 characters each), making the phone page ~9200px tall
// and hard to read, while the site already has an accordion pattern (.faq-item / .faq-question /
// .faq-answer, rendered by loadFAQ() on about.html). The beer FAQ now uses that pattern as static
// markup — same copy, headings kept, each question a real <button> with aria-expanded — and
// 13-init.js binds the static items the same way loadFAQ() binds its dynamic ones.

var fs = require('fs');
var path = require('path');

describe('beer.html FAQ markup', function () {
  var html = fs.readFileSync(path.join(__dirname, '../../beer.html'), 'utf8');
  var section = html.match(/<h2>Frequently Asked Questions<\/h2>([\s\S]*?)<\/section>/);

  test('the FAQ section exists', function () {
    expect(section).not.toBeNull();
  });

  test('uses the .faq-list accordion with six items', function () {
    expect(section[1]).toMatch(/<div class="faq-list">/);
    expect((section[1].match(/class="faq-item"/g) || []).length).toBe(6);
  });

  test('every question is a button inside an h3 with aria-expanded and aria-controls', function () {
    var buttons = section[1].match(/<button[^>]*class="faq-question"[^>]*>/g) || [];
    expect(buttons.length).toBe(6);
    buttons.forEach(function (b) {
      expect(b).toMatch(/type="button"/);
      expect(b).toMatch(/aria-expanded="false"/);
      expect(b).toMatch(/aria-controls="beer-faq-\d"/);
    });
    expect((section[1].match(/<h3[^>]*>\s*<button/g) || []).length).toBe(6);
  });

  test('every answer keeps its copy inside .faq-answer with a matching id', function () {
    for (var i = 1; i <= 6; i++) {
      expect(section[1]).toMatch(new RegExp('<div class="faq-answer" id="beer-faq-' + i + '">'));
    }
    expect(section[1]).toMatch(/pitching the yeast, which takes under ten minutes/);
    expect(section[1]).toMatch(/<strong>3 weeks<\/strong> for ales/);
    expect(section[1]).not.toMatch(/<h3>[^<]+<\/h3>\s*<p>/); // no bare heading/paragraph pairs left
  });
});

describe('static FAQ toggles', function () {
  global.SHEETS_CONFIG = { SPREADSHEET_ID: 'test', MIDDLEWARE_URL: '' };
  global.navigator = global.navigator || {};
  global.navigator.vibrate = jest.fn();
  global.navigator.standalone = false;
  global.RESERVATION_KEY = 'sv-reservation';
  global.FERMENT_CART_KEY = 'sv-cart-ferment';
  global.INGREDIENT_CART_KEY = 'sv-cart-ingredients';
  global.CART_KEYS = { FERMENT: 'sv-cart-ferment', INGREDIENTS: 'sv-cart-ingredients', LEGACY_RESERVATION: 'sv-reservation' };
  ['getReservation', 'saveReservation', 'refreshAllReserveControls', 'updateReservationBar',
    'refreshReservationDependents', 'renderCartSidebar', 'loadTimeslots', 'updateCompletionEstimate',
    'loadProducts', 'initReservationBar', 'initCartDrawer', 'initCatalogViewToggle', 'initProductTabs',
    'setupBeerWaitlistForm', 'loadIngredients'].forEach(function (n) { global[n] = function () { return []; }; });
  global.trackEvent = jest.fn();
  global.formatCurrency = function (n) { return '$' + parseFloat(n).toFixed(2); };
  global.escapeHTML = function (s) { return String(s || ''); };
  global.PAYMENT_DISABLED = false;

  var init = require('../../js/modules/13-init');

  function mount() {
    document.body.innerHTML =
      '<div class="faq-list">' +
      '<div class="faq-item"><h3><button type="button" class="faq-question" aria-expanded="false" aria-controls="q1">Q1</button></h3><div class="faq-answer" id="q1"><p>A1</p></div></div>' +
      '<div class="faq-item"><h3><button type="button" class="faq-question" aria-expanded="false" aria-controls="q2">Q2</button></h3><div class="faq-answer" id="q2"><p>A2</p></div></div>' +
      '</div>';
  }

  test('initFaqToggles is exported', function () {
    expect(typeof init.initFaqToggles).toBe('function');
  });

  test('clicking a question opens its item and flips aria-expanded; clicking again closes it', function () {
    mount();
    init.initFaqToggles();
    var btn = document.querySelectorAll('.faq-question')[1];
    btn.click();
    expect(btn.parentElement.parentElement.classList.contains('open')).toBe(true);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelectorAll('.faq-item.open').length).toBe(1);
    btn.click();
    expect(btn.parentElement.parentElement.classList.contains('open')).toBe(false);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  test('binding twice does not double-toggle', function () {
    mount();
    init.initFaqToggles();
    init.initFaqToggles();
    var btn = document.querySelector('.faq-question');
    btn.click();
    expect(btn.getAttribute('aria-expanded')).toBe('true');
  });
});
