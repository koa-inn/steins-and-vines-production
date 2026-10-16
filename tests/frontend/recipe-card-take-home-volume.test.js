'use strict';

// Owner note (2026-10-15): show the take-home volume next to the recipe price.
// Every beer recipe brews 28 L and packages about 25 L (beer.html FAQ), so a
// priced card reads "$95.00 / 25 L". Harness copied from catalog-recipe-block.test.js.

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

describe('recipe card take-home volume', function () {
  test('a priced card shows " / 25 L" right after the price', function () {
    var card = mod.buildRecipeCard({ recipe_id: 'SV-R-000016', name: 'Bavarian Style Lager', style: 'Lager', description: '', price: 95 }, document);
    var unit = card.querySelector('.price-value .price-unit');
    expect(unit).not.toBeNull();
    expect(unit.textContent).toBe(' / 25 L');
    expect(card.querySelector('.price-value').textContent).toBe('$95.00 / 25 L');
  });

  test('a "From" price also carries the volume', function () {
    var card = mod.buildRecipeCard({ recipe_id: 'SV-R-000016', name: 'X', style: '', description: '', price: 30, price_from: true }, document);
    expect(card.querySelector('.price-value').textContent).toBe('From $30.00 / 25 L');
  });

  test('an unpriced card shows only the fallback, no volume', function () {
    var card = mod.buildRecipeCard({ recipe_id: 'SV-R-000002', name: 'Czech Lager', style: 'Lager', description: '', price: null }, document);
    expect(card.querySelector('.price-unit')).toBeNull();
  });
});
