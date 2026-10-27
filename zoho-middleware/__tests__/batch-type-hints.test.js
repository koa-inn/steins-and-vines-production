'use strict';

/**
 * Phase 94 Plan 01: batch-type-hints helpers. Cache and DB are mocked; nothing here may throw
 * for a cold cache (D-07).
 */

jest.mock('../lib/cache', function () { return { get: jest.fn() }; });
jest.mock('../lib/constants', function () {
  return { CACHE_KEYS: { KIOSK_PRODUCTS: 'zoho:kiosk-products' } };
});
jest.mock('../lib/logger', function () {
  return { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() };
});

var cache = require('../lib/cache');
var hints = require('../lib/batch-type-hints');

var PRODUCTS = [{ sku: 'SKU-1', item_id: '99', cf_type: 'Wine', cf_subcategory: 'Red', brand: 'B', manufacturer: 'M' }];

beforeEach(function () { cache.get.mockReset(); });

describe('zohoTypeHint', function () {
  it('matches by sku', async function () {
    cache.get.mockResolvedValue(PRODUCTS);
    expect(await hints.zohoTypeHint('SKU-1')).toEqual({ cfType: 'wine' });
    expect(cache.get).toHaveBeenCalledWith('zoho:kiosk-products');
  });
  it('matches by item_id', async function () {
    cache.get.mockResolvedValue(PRODUCTS);
    expect(await hints.zohoTypeHint('99')).toEqual({ cfType: 'wine' });
  });
  it('returns null for blank sku without touching cache', async function () {
    expect(await hints.zohoTypeHint('')).toBeNull();
    expect(cache.get).not.toHaveBeenCalled();
  });
  it('returns null on miss, reject, or non-array', async function () {
    cache.get.mockResolvedValue(null);
    expect(await hints.zohoTypeHint('SKU-1')).toBeNull();
    cache.get.mockRejectedValue(new Error('redis down'));
    expect(await hints.zohoTypeHint('SKU-1')).toBeNull();
    cache.get.mockResolvedValue({ not: 'array' });
    expect(await hints.zohoTypeHint('SKU-1')).toBeNull();
  });
  it('returns null when no entry matches', async function () {
    cache.get.mockResolvedValue(PRODUCTS);
    expect(await hints.zohoTypeHint('NOPE')).toBeNull();
  });
});

describe('kioskProductIndex', function () {
  it('keys by sku and item_id', async function () {
    cache.get.mockResolvedValue([{ sku: 'S', item_id: '5', cf_type: 'Beer' }]);
    var idx = await hints.kioskProductIndex();
    expect(idx.S).toEqual({ cf_type: 'Beer', cf_subcategory: '', brand: '', manufacturer: '' });
    expect(idx['5']).toEqual(idx.S);
  });
  it('returns {} on miss or error', async function () {
    cache.get.mockResolvedValue(null);
    expect(await hints.kioskProductIndex()).toEqual({});
    cache.get.mockRejectedValue(new Error('x'));
    expect(await hints.kioskProductIndex()).toEqual({});
  });
});

describe('recipeTypeHint', function () {
  it('issues one parameterised query', async function () {
    var client = { query: jest.fn().mockResolvedValue({ rows: [{ beer_category: 'ipa', style: null }] }) };
    expect(await hints.recipeTypeHint(client, 'SV-R-000001')).toEqual({ beerCategory: 'ipa', style: '' });
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.query.mock.calls[0][1]).toEqual(['SV-R-000001']);
  });
  it('returns null for no row or empty id', async function () {
    var client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    expect(await hints.recipeTypeHint(client, 'SV-R-000002')).toBeNull();
    client.query.mockClear();
    expect(await hints.recipeTypeHint(client, '')).toBeNull();
    expect(client.query).not.toHaveBeenCalled();
  });
});

describe('scheduleCategoryHint', function () {
  it('returns lowercase category', async function () {
    var client = { query: jest.fn().mockResolvedValue({ rows: [{ category: 'Beer' }] }) };
    expect(await hints.scheduleCategoryHint(client, 'FS-0001')).toBe('beer');
    expect(client.query.mock.calls[0][1]).toEqual(['FS-0001']);
  });
  it('returns empty string for no row or empty id', async function () {
    var client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    expect(await hints.scheduleCategoryHint(client, 'FS-9')).toBe('');
    expect(await hints.scheduleCategoryHint(client, '')).toBe('');
  });
});
