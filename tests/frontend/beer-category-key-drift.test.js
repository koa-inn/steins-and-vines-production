'use strict';

// Phase 89 D-02: the 12 beer category keys live in four places (zoho-middleware/lib/recipe-rules.js,
// apps-script/adminApi.gs, js/lib/constants.js BEER_CATEGORIES) plus a .tint-<key> rule each in
// css/styles.css. This test fails on any divergence, or on a new key without a CSS tint.

var fs = require('fs');
var path = require('path');

var rules = require('../../zoho-middleware/lib/recipe-rules.js');
var constants = require('../../js/lib/constants.js');

var EXPECTED_SORTED = ['amber', 'brown', 'ipa', 'lager', 'pale', 'pilsner', 'porter', 'redale',
  'saison', 'session', 'stout', 'wheat'];

var gsSrc = fs.readFileSync(path.join(__dirname, '../../apps-script/adminApi.gs'), 'utf8');
var gsKeys = new Function('SpreadsheetApp', 'Logger', 'LockService',
  gsSrc + '\nreturn BEER_CATEGORY_KEYS;')({}, { log: function () {} }, {});

var cssSrc = fs.readFileSync(path.join(__dirname, '../../css/styles.css'), 'utf8');
var frontendKeys = constants.BEER_CATEGORIES.map(function (c) { return c.key; });

describe('beer category key drift (recipe-rules.js / adminApi.gs / constants.js / styles.css)', function () {
  test('recipe-rules.js keys match the D-02 list', function () {
    expect(rules.BEER_CATEGORY_KEYS.slice().sort()).toEqual(EXPECTED_SORTED);
  });

  test('adminApi.gs keys match the D-02 list', function () {
    expect(gsKeys.slice().sort()).toEqual(EXPECTED_SORTED);
  });

  test('constants.js BEER_CATEGORIES keys match the D-02 list', function () {
    expect(frontendKeys.slice().sort()).toEqual(EXPECTED_SORTED);
  });

  test('recipe-rules.js and adminApi.gs agree in order too', function () {
    expect(gsKeys).toEqual(rules.BEER_CATEGORY_KEYS);
  });

  EXPECTED_SORTED.forEach(function (k) {
    test('css/styles.css has a .tint-' + k + ' rule', function () {
      expect(new RegExp('\\.tint-' + k + '\\s*\\{').test(cssSrc)).toBe(true);
    });
  });

  test('BEER_CATEGORIES labels are non-empty and unique', function () {
    var labels = constants.BEER_CATEGORIES.map(function (c) { return c.label; });
    labels.forEach(function (l) { expect(typeof l === 'string' && l.trim().length > 0).toBe(true); });
    expect(new Set(labels).size).toBe(labels.length);
  });
});
