'use strict';

/**
 * Phase 94 Plan 01: classifyBatchType (D-04, D-05, D-07, D-22). New logic, no Apps Script counterpart.
 */

var rules = require('../lib/batch-rules');

describe('normalizeBatchType', function () {
  it('lowercases and trims valid members', function () {
    expect(rules.normalizeBatchType('Seltzer ')).toBe('seltzer');
  });
  it('rejects unknown values', function () {
    expect(rules.normalizeBatchType('rose')).toBe('');
    expect(rules.normalizeBatchType(null)).toBe('');
  });
});

describe('recipeBatchType', function () {
  it('maps a valid beer_category to beer', function () {
    expect(rules.recipeBatchType('ipa', '')).toBe('beer');
  });
  it('maps an exact style word', function () {
    expect(rules.recipeBatchType('', ' Cider ')).toBe('cider');
  });
  it('does not guess from style keywords', function () {
    expect(rules.recipeBatchType('', 'West Coast IPA')).toBe('');
    expect(rules.recipeBatchType('', 'Merlot')).toBe('');
  });
  it('ignores an invalid category', function () {
    expect(rules.recipeBatchType('nonsense', '')).toBe('');
  });
});

describe('nameBatchType', function () {
  it('matches whole words conservatively', function () {
    expect(rules.nameBatchType('Orchard Apple Cider Kit')).toBe('cider');
    expect(rules.nameBatchType('Pilsner Kit')).toBe('beer');
    expect(rules.nameBatchType('Pinot Grigio')).toBe('');
    expect(rules.nameBatchType('Hard Cider Ale')).toBe('cider');
    expect(rules.nameBatchType('Hard Seltzer')).toBe('seltzer');
    expect(rules.nameBatchType('Red Wine')).toBe('wine');
  });
  it('does not match substrings', function () {
    expect(rules.nameBatchType('Chardonnay Sale')).toBe('');
  });
});

describe('classifyBatchType', function () {
  it('recipe category wins', function () {
    expect(rules.classifyBatchType({ product_name: 'X' }, { recipeBeerCategory: 'ipa' }))
      .toEqual({ type: 'beer', source: 'recipe' });
  });
  it('recipe exact style word', function () {
    expect(rules.classifyBatchType({}, { recipeStyle: 'Cider' })).toEqual({ type: 'cider', source: 'recipe' });
  });
  it('style keywords fall through', function () {
    expect(rules.classifyBatchType({ product_name: 'Pinot' }, { recipeStyle: 'West Coast IPA' }))
      .toEqual({ type: 'other', source: 'other' });
  });
  it('invalid category falls through to zoho', function () {
    expect(rules.classifyBatchType({}, { recipeBeerCategory: 'nonsense', zohoCfType: 'Wine' }))
      .toEqual({ type: 'wine', source: 'zoho' });
  });
  it('zoho consignment/other fall through', function () {
    expect(rules.classifyBatchType({}, { zohoCfType: 'consignment', scheduleCategory: 'beer' }))
      .toEqual({ type: 'beer', source: 'schedule' });
    expect(rules.classifyBatchType({}, { zohoCfType: 'other', scheduleCategory: 'cider' }))
      .toEqual({ type: 'cider', source: 'schedule' });
  });
  it('name rule', function () {
    expect(rules.classifyBatchType({ product_name: 'Orchard Apple Cider Kit' }, {}))
      .toEqual({ type: 'cider', source: 'name' });
    expect(rules.classifyBatchType({ product_name: 'Pinot Grigio' }, {}))
      .toEqual({ type: 'other', source: 'other' });
  });
  it('precedence recipe > zoho > schedule > name', function () {
    var b = { product_name: 'Seltzer' };
    var h = { recipeBeerCategory: 'lager', zohoCfType: 'wine', scheduleCategory: 'cider' };
    expect(rules.classifyBatchType(b, h).source).toBe('recipe');
    delete h.recipeBeerCategory;
    expect(rules.classifyBatchType(b, h).source).toBe('zoho');
    delete h.zohoCfType;
    expect(rules.classifyBatchType(b, h).source).toBe('schedule');
    delete h.scheduleCategory;
    expect(rules.classifyBatchType(b, h).source).toBe('name');
  });
  it('never throws on null input', function () {
    expect(rules.classifyBatchType(null, null)).toEqual({ type: 'other', source: 'other' });
    expect(rules.classifyBatchType(undefined, undefined)).toEqual({ type: 'other', source: 'other' });
  });
});

describe('shouldRederiveType', function () {
  it('only name and other re-derive', function () {
    expect(rules.shouldRederiveType('name')).toBe(true);
    expect(rules.shouldRederiveType('other')).toBe(true);
    ['manual', 'recipe', 'zoho', 'schedule', null, undefined].forEach(function (s) {
      expect(rules.shouldRederiveType(s)).toBe(false);
    });
  });
});
