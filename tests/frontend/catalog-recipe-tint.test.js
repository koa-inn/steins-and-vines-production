'use strict';

// Phase 89 Plan 02 - recipe card tint from beer_category (D-08/D-09/D-10).

global.KIT_CATEGORIES = ['wine', 'beer', 'cider', 'seltzer'];
global.fetch = global.fetch || function () { return Promise.resolve({ ok: false, json: function () { return Promise.resolve({}); } }); };
global.localStorage = global.localStorage || {
  getItem: function () { return null; },
  setItem: function () {}
};
global.SHEETS_CONFIG = { MIDDLEWARE_URL: 'https://mw.example.test' };
global.showCatalogSkeletons = function () {};
global.formatCurrency = function (val) { return '$' + Number(val).toFixed(2); };
global.BEER_CATEGORIES = require('../../js/lib/constants.js').BEER_CATEGORIES;
global.getTintClass = require('../../js/modules/04-label-cards.js').getTintClass;

var constants = require('../../js/lib/constants.js');
var mod = require('../../js/modules/07-catalog-kits.js');

var KEYS = ['pilsner', 'lager', 'pale', 'ipa', 'amber', 'wheat', 'session', 'saison', 'stout', 'porter', 'redale', 'brown'];

function recipe(cat) {
  var r = { recipe_id: 'SV-R-000011', name: 'West Coast IPA', style: 'IPA', description: 'Hoppy', price: 45 };
  if (cat !== undefined) { r.beer_category = cat; }
  return r;
}

describe('BEER_CATEGORIES', function () {
  test('has the 12 beer tint keys with labels', function () {
    expect(constants.BEER_CATEGORIES.length).toBe(12);
    expect(constants.BEER_CATEGORIES.map(function (c) { return c.key; }).sort()).toEqual(KEYS.slice().sort());
    constants.BEER_CATEGORIES.forEach(function (c) {
      expect(typeof c.label).toBe('string');
      expect(c.label.length).toBeGreaterThan(0);
    });
  });
});

describe('recipeTintClass', function () {
  test('maps every valid key to tint-<key>', function () {
    KEYS.forEach(function (k) {
      expect(mod.recipeTintClass({ beer_category: k })).toBe('tint-' + k);
    });
  });

  test('returns empty string for blank, missing, off-list and non-string values', function () {
    [{ beer_category: '' }, {}, null, { beer_category: 'purple' }, { beer_category: 'red' },
      { beer_category: 'IPA' }, { beer_category: 5 }, { beer_category: 'ipa extra' }].forEach(function (r) {
      expect(mod.recipeTintClass(r)).toBe('');
    });
  });

  test('blank value works when globals are undefined', function () {
    var b = global.BEER_CATEGORIES;
    var g = global.getTintClass;
    delete global.BEER_CATEGORIES;
    delete global.getTintClass;
    try {
      expect(mod.recipeTintClass({ beer_category: '' })).toBe('');
      expect(mod.recipeTintClass({ beer_category: 'ipa' })).toBe('');
    } finally {
      global.BEER_CATEGORIES = b;
      global.getTintClass = g;
    }
  });
});

describe('buildRecipeCard tint', function () {
  test('ipa gives label-beer tint-ipa', function () {
    expect(mod.buildRecipeCard(recipe('ipa'), document).className).toBe('label-beer tint-ipa');
  });

  test('blank gives plain label-beer', function () {
    expect(mod.buildRecipeCard(recipe(''), document).className).toBe('label-beer');
  });

  test('wine tint key gives plain label-beer', function () {
    expect(mod.buildRecipeCard(recipe('red'), document).className).toBe('label-beer');
  });

  test('tint adds no text (colour only)', function () {
    var a = mod.buildRecipeCard(recipe('ipa'), document).textContent;
    var b = mod.buildRecipeCard(recipe(''), document).textContent;
    expect(a).toBe(b);
  });
});
