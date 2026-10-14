'use strict';

var rules = require('../lib/recipe-rules');

describe('BEER_CATEGORY_KEYS', function () {
  it('lists exactly the 12 beer tint keys in D-02 order', function () {
    expect(rules.BEER_CATEGORY_KEYS).toEqual([
      'pilsner', 'lager', 'pale', 'ipa', 'amber', 'wheat',
      'session', 'saison', 'stout', 'porter', 'redale', 'brown'
    ]);
    expect(rules.BEER_CATEGORY_KEYS).toHaveLength(12);
  });
});

describe('normalizeBeerCategory', function () {
  it('returns each canonical key unchanged', function () {
    rules.BEER_CATEGORY_KEYS.forEach(function (k) {
      expect(rules.normalizeBeerCategory(k)).toBe(k);
    });
  });

  it('trims, lowercases and strips non-letters', function () {
    expect(rules.normalizeBeerCategory('IPA')).toBe('ipa');
    expect(rules.normalizeBeerCategory(' Red Ale ')).toBe('redale');
    expect(rules.normalizeBeerCategory('Red-Ale')).toBe('redale');
    expect(rules.normalizeBeerCategory('PILSNER')).toBe('pilsner');
  });

  it('treats null, undefined, empty and whitespace-only as valid blank', function () {
    expect(rules.normalizeBeerCategory(null)).toBe('');
    expect(rules.normalizeBeerCategory(undefined)).toBe('');
    expect(rules.normalizeBeerCategory('')).toBe('');
    expect(rules.normalizeBeerCategory('   ')).toBe('');
  });

  it('rejects off-list values with null', function () {
    expect(rules.normalizeBeerCategory('purple')).toBeNull();
    expect(rules.normalizeBeerCategory('Pale Ale')).toBeNull();
    expect(rules.normalizeBeerCategory('red')).toBeNull();
  });

  it('rejects non-blank input that strips to nothing', function () {
    expect(rules.normalizeBeerCategory('123')).toBeNull();
    expect(rules.normalizeBeerCategory('--')).toBeNull();
  });

  it('rejects non-string input', function () {
    expect(rules.normalizeBeerCategory(5)).toBeNull();
    expect(rules.normalizeBeerCategory(['ipa'])).toBeNull();
    expect(rules.normalizeBeerCategory({})).toBeNull();
    expect(rules.normalizeBeerCategory(true)).toBeNull();
  });
});
