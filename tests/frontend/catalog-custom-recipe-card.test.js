'use strict';

// Custom-recipe card (owner request 2026-10-14): the beer recipe grid ends with
// a card in the same bottle-label style inviting a custom recipe, with the same
// waitlist CTA as the recipe cards. Harness copied from catalog-recipe-block.test.js.

// Stub KIT_CATEGORIES so 07-catalog-kits.js loads in Node without error.
global.KIT_CATEGORIES = ['wine', 'beer', 'cider', 'seltzer'];

// Stub non-DOM browser globals that 07-catalog-kits.js references at module scope.
// jest's testEnvironment is jsdom (jest.config.js), so `document`/`window` are
// already real — we deliberately do NOT overwrite `document` here (unlike
// catalog-category-scope.test.js's bare stub) because this file's assertions
// need real textContent aggregation, querySelectorAll and classList behaviour
// for the recipe card and block-renderer DOM shapes.
global.fetch = global.fetch || function () { return Promise.resolve({ ok: false, json: function () { return Promise.resolve({}); } }); };
global.localStorage = global.localStorage || {
  getItem: function () { return null; },
  setItem: function () {}
};
global.SHEETS_CONFIG = { MIDDLEWARE_URL: 'https://mw.example.test' };
global.showCatalogSkeletons = function () {};
global.formatCurrency = function (val) { return '$' + Number(val).toFixed(2); };

var mod = require('../../js/modules/07-catalog-kits.js');

function recipes(n) {
  return Array.apply(null, Array(n)).map(function (_, i) {
    return { recipe_id: 'SV-R-' + (i + 1), name: 'Recipe ' + (i + 1), style: 'Ale', description: 'x', price: 10 };
  });
}

function grid() {
  return document.getElementById('recipe-catalog').querySelector('.product-grid');
}

beforeEach(function () {
  document.body.innerHTML = '<div id="recipe-catalog"></div>';
  document.body.setAttribute('data-page', 'beer');
});

describe('custom recipe card', function () {
  test('is the last card in the beer recipe grid, after every recipe', function () {
    mod.renderRecipeBlock({ ok: true, recipes: recipes(2) }, false, 'beer', '', document);
    var cards = grid().querySelectorAll('.label-beer');
    expect(cards.length).toBe(3);
    expect(cards[2].getAttribute('data-custom-recipe')).toBe('true');
    expect(cards[0].getAttribute('data-recipe-id')).toBe('SV-R-1');
  });

  test('uses the bottle-label style and invites a custom recipe', function () {
    var card = mod.buildCustomRecipeCard(document);
    expect(card.className).toContain('label-beer');
    expect(card.querySelector('.beer-name').textContent).toMatch(/custom/i);
    expect(card.querySelector('.service-description').textContent).toMatch(/don.t see/i);
  });

  test('carries the same waitlist CTA as the recipe cards', function () {
    var card = mod.buildCustomRecipeCard(document);
    var link = card.querySelector('.reserve-link a');
    expect(link.getAttribute('href')).toBe('#waitlist');
    expect(link.textContent).toBe('Join the Waitlist');
  });

  test('counts toward the compact layout (3 recipes + custom = 4 cards, not compact)', function () {
    mod.renderRecipeBlock({ ok: true, recipes: recipes(3) }, false, 'beer', '', document);
    expect(grid().className.indexOf('product-grid--compact')).toBe(-1);
    mod.renderRecipeBlock({ ok: true, recipes: recipes(2) }, false, 'beer', '', document);
    expect(grid().className.indexOf('product-grid--compact')).not.toBe(-1);
  });

  test('is not shown when there are no recipes or the fetch failed', function () {
    mod.renderRecipeBlock({ ok: true, recipes: [] }, false, 'beer', '', document);
    expect(document.querySelectorAll('[data-custom-recipe]').length).toBe(0);
    mod.renderRecipeBlock({ ok: false }, false, 'beer', '', document);
    expect(document.querySelectorAll('[data-custom-recipe]').length).toBe(0);
  });
});
