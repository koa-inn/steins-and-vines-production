'use strict';

/**
 * Phase 89 D-03 parity: lib/recipe-rules.js normalizeBeerCategory / BEER_CATEGORY_KEYS vs the
 * REAL apps-script/adminApi.gs copy, loaded from disk and evaluated via `new Function`
 * (same idiom as recipe-rules-parity.test.js).
 */

var fs = require('fs');
var path = require('path');
var rules = require('../lib/recipe-rules');

var src = fs.readFileSync(path.join(__dirname, '../../apps-script/adminApi.gs'), 'utf8'); // adminApi.gs
var gs = new Function(
  src + '\nreturn {' +
    'normalizeBeerCategory: normalizeBeerCategory,' +
    'BEER_CATEGORY_KEYS: BEER_CATEGORY_KEYS' +
  '};'
)();

describe('beer category parity with adminApi.gs', function () {
  it('BEER_CATEGORY_KEYS are identical and in the same order', function () {
    expect(gs.BEER_CATEGORY_KEYS).toEqual(rules.BEER_CATEGORY_KEYS);
    expect(gs.BEER_CATEGORY_KEYS.length).toBe(12);
  });

  var vectors = [
    'IPA', ' Red Ale ', 'Red-Ale', '', '   ', null, undefined, 'purple', 'Pale Ale', 'red', '123', '--',
    5, true, ['ipa'], {}
  ].concat(rules.BEER_CATEGORY_KEYS);

  vectors.forEach(function (v, i) {
    it('vector ' + i + ' matches', function () {
      expect(gs.normalizeBeerCategory(v)).toEqual(rules.normalizeBeerCategory(v));
    });
  });

  it('non-string and strips-to-nothing inputs are null on both sides', function () {
    [['ipa'], '123', '--', 5, true, {}].forEach(function (v) {
      expect(rules.normalizeBeerCategory(v)).toBeNull();
      expect(gs.normalizeBeerCategory(v)).toBeNull();
    });
  });
});
