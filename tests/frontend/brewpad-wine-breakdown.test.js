'use strict';

// Wine Breakdown card helpers — Jest test suite
// Tests the pure helper functions added to js/brewpad.js for the wine dimension breakdown feature.

// brewpad.js runs its IIFE on load -- stub the globals it touches at the top level.
global.document = global.document || {};
global.window = global.window || {};
global.navigator = global.navigator || {};
global.google = { accounts: { oauth2: { initTokenClient: jest.fn() } } };
global.fetch = jest.fn();
global.localStorage = {
  _data: {},
  getItem: function (k) { return this._data[k] || null; },
  setItem: function (k, v) { this._data[k] = v; },
  removeItem: function (k) { delete this._data[k]; },
  clear: function () { this._data = {}; }
};
global.sessionStorage = {
  _data: {},
  getItem: function (k) { return this._data[k] || null; },
  setItem: function (k, v) { this._data[k] = v; },
  removeItem: function (k) { delete this._data[k]; },
  clear: function () { this._data = {}; }
};

// auth.js primitives are loaded via <script> in the browser; in tests wire them as globals.
var _auth = require('../../js/lib/auth');
global.waitForGoogleIdentity = _auth.waitForGoogleIdentity;
global.gsiInitTokenClient = _auth.gsiInitTokenClient;
global.fetchGoogleUserInfo = _auth.fetchGoogleUserInfo;

var bp = require('../../js/brewpad');

// ---------------------------------------------------------------------------
// buildSkuLookup
// ---------------------------------------------------------------------------
describe('buildSkuLookup', function () {
  it('returns an empty object for an empty array', function () {
    expect(bp.buildSkuLookup([])).toEqual({});
  });

  it('returns an empty object for null/undefined', function () {
    expect(bp.buildSkuLookup(null)).toEqual({});
    expect(bp.buildSkuLookup(undefined)).toEqual({});
  });

  it('maps sku to product object', function () {
    var products = [
      { sku: '27855', type: 'Wine', subcategory: 'Red' },
      { sku: '27856', type: 'Wine', subcategory: 'White' }
    ];
    var result = bp.buildSkuLookup(products);
    expect(result['27855']).toEqual({ sku: '27855', type: 'Wine', subcategory: 'Red' });
    expect(result['27856']).toEqual({ sku: '27856', type: 'Wine', subcategory: 'White' });
  });

  it('skips entries with falsy sku', function () {
    var products = [
      { sku: null, subcategory: 'Red' },
      { sku: '', subcategory: 'White' },
      { subcategory: 'Fruit' },
      { sku: '99999', subcategory: 'Rose' }
    ];
    var result = bp.buildSkuLookup(products);
    var keys = Object.keys(result);
    expect(keys.length).toBe(1);
    expect(result['99999'].subcategory).toBe('Rose');
  });

  it('later duplicate sku wins (last-write)', function () {
    var products = [
      { sku: '27855', subcategory: 'Red' },
      { sku: '27855', subcategory: 'White' }
    ];
    var result = bp.buildSkuLookup(products);
    expect(result['27855'].subcategory).toBe('White');
  });

  it('coerces sku to string', function () {
    var products = [{ sku: 12345, subcategory: 'Red' }];
    var result = bp.buildSkuLookup(products);
    expect(result['12345']).toBeDefined();
    expect(result['12345'].subcategory).toBe('Red');
  });
});

// ---------------------------------------------------------------------------
// normalizeWineTime
// ---------------------------------------------------------------------------
describe('normalizeWineTime', function () {
  it('normalizes singular "5 week" to label "5 weeks" with week 5', function () {
    var result = bp.normalizeWineTime('5 week');
    expect(result.label).toBe('5 weeks');
    expect(result.week).toBe(5);
  });

  it('passes through "4 weeks" unchanged with week 4', function () {
    var result = bp.normalizeWineTime('4 weeks');
    expect(result.label).toBe('4 weeks');
    expect(result.week).toBe(4);
  });

  it('singular and plural produce identical labels (merge behavior)', function () {
    var singular = bp.normalizeWineTime('5 week');
    var plural = bp.normalizeWineTime('5 weeks');
    expect(singular.label).toBe(plural.label);
    expect(singular.week).toBe(plural.week);
  });

  it('handles empty string with sentinel week 9999', function () {
    var result = bp.normalizeWineTime('');
    expect(result.label).toBe('');
    expect(result.week).toBe(9999);
  });

  it('handles non-week strings with sentinel week 9999', function () {
    var result = bp.normalizeWineTime('misc');
    expect(result.label).toBe('misc');
    expect(result.week).toBe(9999);
  });

  it('handles null/undefined with sentinel week 9999', function () {
    var resultNull = bp.normalizeWineTime(null);
    expect(resultNull.week).toBe(9999);
    var resultUndef = bp.normalizeWineTime(undefined);
    expect(resultUndef.week).toBe(9999);
  });

  it('handles "8 weeks" with week 8', function () {
    var result = bp.normalizeWineTime('8 weeks');
    expect(result.label).toBe('8 weeks');
    expect(result.week).toBe(8);
  });

  it('handles "6 weeks" with week 6', function () {
    var result = bp.normalizeWineTime('6 weeks');
    expect(result.label).toBe('6 weeks');
    expect(result.week).toBe(6);
  });

  it('non-numeric time strings use sentinel (sort last)', function () {
    var result1 = bp.normalizeWineTime('misc');
    var result2 = bp.normalizeWineTime('');
    expect(result1.week).toBe(9999);
    expect(result2.week).toBe(9999);
  });
});

// ---------------------------------------------------------------------------
// bucketWineDimension
// ---------------------------------------------------------------------------
describe('bucketWineDimension', function () {
  // Fixed reference date: 2026-03-15 (March 2026)
  // Last 6 months: Oct 2025, Nov 2025, Dec 2025, Jan 2026, Feb 2026, Mar 2026
  var REF_DATE = '2026-03-15';

  // Helper: build a wine batch with the given sku and date
  function wineBatch(sku, startDate) {
    return { category: 'wine', product_sku: sku, start_date: startDate };
  }

  // Helper: build a non-wine batch
  function beerBatch(sku, startDate) {
    return { category: 'beer', product_sku: sku, start_date: startDate };
  }

  var skuLookup = {
    'SKU-RED':    { sku: 'SKU-RED',    subcategory: 'Red',   brand: 'Classic',        manufacturer: 'RJS', time: '4 weeks' },
    'SKU-WHITE':  { sku: 'SKU-WHITE',  subcategory: 'White', brand: 'Cru International', manufacturer: 'Winexpert', time: '6 weeks' },
    'SKU-FRUIT':  { sku: 'SKU-FRUIT',  subcategory: 'Fruit', brand: 'Classic',        manufacturer: 'RJS', time: '5 weeks' },
    'SKU-RED2':   { sku: 'SKU-RED2',   subcategory: 'Red',   brand: 'Reserve',        manufacturer: 'RJS', time: '8 weeks' },
    'SKU-SING':   { sku: 'SKU-SING',   subcategory: 'Red',   brand: 'Classic',        manufacturer: 'RJS', time: '5 week'  }
  };

  it('only counts wine batches (D-11) — non-wine batches excluded', function () {
    var batches = [
      wineBatch('SKU-RED', '2026-02-01'),
      beerBatch('SKU-WHITE', '2026-02-01')   // should be excluded
    ];
    var result = bp.bucketWineDimension(batches, {}, skuLookup, 'subcategory', 6, REF_DATE);
    var labels = result.map(function (b) { return b.label; });
    expect(labels).not.toContain('White');
    expect(result.find(function (b) { return b.label === 'Red'; }).count).toBe(1);
  });

  it('excludes out-of-window batches (D-03)', function () {
    var batches = [
      wineBatch('SKU-RED', '2025-04-01'),    // outside 6-month window ending 2026-03
      wineBatch('SKU-WHITE', '2026-01-15')   // inside window
    ];
    var result = bp.bucketWineDimension(batches, {}, skuLookup, 'subcategory', 6, REF_DATE);
    var labels = result.map(function (b) { return b.label; });
    expect(labels).not.toContain('Red');
    expect(labels).toContain('White');
  });

  it('sorts by count descending for non-time dimensions (D-02)', function () {
    var batches = [
      wineBatch('SKU-WHITE', '2026-01-01'),
      wineBatch('SKU-RED',   '2026-01-02'),
      wineBatch('SKU-RED',   '2026-01-03'),
      wineBatch('SKU-FRUIT', '2026-01-04')
    ];
    var result = bp.bucketWineDimension(batches, {}, skuLookup, 'subcategory', 6, REF_DATE);
    // Red (2) should come before White (1) and Fruit (1)
    expect(result[0].label).toBe('Red');
    expect(result[0].count).toBe(2);
  });

  it('places Unknown bucket last when sku is missing (D-10)', function () {
    var batches = [
      wineBatch('SKU-RED',   '2026-02-01'),
      wineBatch('SKU-MISS',  '2026-02-01'),  // not in skuLookup
      wineBatch('SKU-WHITE', '2026-02-01')
    ];
    var result = bp.bucketWineDimension(batches, {}, skuLookup, 'subcategory', 6, REF_DATE);
    var lastBucket = result[result.length - 1];
    expect(lastBucket.label).toBe('Unknown');
    expect(lastBucket.count).toBe(1);
  });

  it('places Unknown bucket last when dimension value is empty (D-10)', function () {
    var customLookup = {
      'SKU-EMPTY': { sku: 'SKU-EMPTY', subcategory: '', brand: 'Classic', manufacturer: 'RJS', time: '4 weeks' }
    };
    var batches = [
      wineBatch('SKU-RED',   '2026-02-01'),
      wineBatch('SKU-EMPTY', '2026-02-01')   // empty subcategory -> Unknown
    ];
    var combinedLookup = Object.assign({}, skuLookup, customLookup);
    var result = bp.bucketWineDimension(batches, {}, combinedLookup, 'subcategory', 6, REF_DATE);
    var lastBucket = result[result.length - 1];
    expect(lastBucket.label).toBe('Unknown');
  });

  it('sorts time dimension by week ascending (D-12)', function () {
    var batches = [
      wineBatch('SKU-RED2',  '2026-01-01'),  // 8 weeks
      wineBatch('SKU-RED',   '2026-01-02'),  // 4 weeks
      wineBatch('SKU-WHITE', '2026-01-03'),  // 6 weeks
      wineBatch('SKU-FRUIT', '2026-01-04')   // 5 weeks
    ];
    var result = bp.bucketWineDimension(batches, {}, skuLookup, 'time', 6, REF_DATE);
    var weeks = result.map(function (b) { return b.label; });
    expect(weeks[0]).toBe('4 weeks');
    expect(weeks[1]).toBe('5 weeks');
    expect(weeks[2]).toBe('6 weeks');
    expect(weeks[3]).toBe('8 weeks');
  });

  it('merges singular/plural time variants (D-12): "5 week" and "5 weeks" -> one bucket', function () {
    var batches = [
      wineBatch('SKU-FRUIT', '2026-01-01'),  // time: '5 weeks'
      wineBatch('SKU-SING',  '2026-01-02')   // time: '5 week' (singular)
    ];
    var result = bp.bucketWineDimension(batches, {}, skuLookup, 'time', 6, REF_DATE);
    // Both should merge into a single '5 weeks' bucket with count 2
    var fiveWeeks = result.filter(function (b) { return b.label === '5 weeks'; });
    expect(fiveWeeks.length).toBe(1);
    expect(fiveWeeks[0].count).toBe(2);
  });

  it('resolves wine membership via resolveBatchType (schedule_id path)', function () {
    var schedCat = { 'FS-0001': 'wine' };
    var batches = [
      { schedule_id: 'FS-0001', product_sku: 'SKU-RED', start_date: '2026-02-01' }
    ];
    var result = bp.bucketWineDimension(batches, schedCat, skuLookup, 'subcategory', 6, REF_DATE);
    var red = result.find(function (b) { return b.label === 'Red'; });
    expect(red).toBeDefined();
    expect(red.count).toBe(1);
  });

  it('uses created_at when start_date is absent', function () {
    var batches = [
      { category: 'wine', product_sku: 'SKU-RED', created_at: '2026-01-10' }
    ];
    var result = bp.bucketWineDimension(batches, {}, skuLookup, 'subcategory', 6, REF_DATE);
    var red = result.find(function (b) { return b.label === 'Red'; });
    expect(red).toBeDefined();
    expect(red.count).toBe(1);
  });

  it('returns empty array for empty batches', function () {
    var result = bp.bucketWineDimension([], {}, skuLookup, 'subcategory', 6, REF_DATE);
    expect(result).toEqual([]);
  });

  it('does NOT call applyTopN internally — returns full sorted list', function () {
    // Build 10 distinct subcategory values; function should return all 10
    var manyLookup = {};
    var batches = [];
    for (var i = 1; i <= 10; i++) {
      var sku = 'SKU-' + i;
      manyLookup[sku] = { sku: sku, subcategory: 'Cat' + i };
      batches.push({ category: 'wine', product_sku: sku, start_date: '2026-01-01' });
    }
    var result = bp.bucketWineDimension(batches, {}, manyLookup, 'subcategory', 6, REF_DATE);
    expect(result.length).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// applyTopN
// ---------------------------------------------------------------------------
describe('applyTopN', function () {
  it('returns empty array for empty input', function () {
    expect(bp.applyTopN([], 8)).toEqual([]);
  });

  it('returns unchanged when distinct non-Unknown count <= n', function () {
    var buckets = [
      { label: 'Red', count: 5 },
      { label: 'White', count: 3 },
      { label: 'Fruit', count: 2 }
    ];
    var result = bp.applyTopN(buckets, 8);
    expect(result.length).toBe(3);
    expect(result[0].label).toBe('Red');
    expect(result[1].label).toBe('White');
  });

  it('when > n distinct values: keeps top n and folds rest into Other (D-07, D-08)', function () {
    var buckets = [];
    for (var i = 1; i <= 10; i++) {
      buckets.push({ label: 'Brand' + i, count: 11 - i }); // counts: 10,9,8,...,1
    }
    var result = bp.applyTopN(buckets, 8);
    // Should have 8 top + 1 Other = 9 total (no Unknown)
    expect(result.length).toBe(9);
    var otherBucket = result.find(function (b) { return b.label === 'Other'; });
    expect(otherBucket).toBeDefined();
    // Other is sum of Brand9 (count=2) + Brand10 (count=1) = 3
    expect(otherBucket.count).toBe(3);
  });

  it('"Other" sorts last among non-Unknown buckets (D-09)', function () {
    var buckets = [];
    for (var i = 1; i <= 10; i++) {
      buckets.push({ label: 'Brand' + i, count: 11 - i });
    }
    var result = bp.applyTopN(buckets, 8);
    var otherIndex = result.findIndex(function (b) { return b.label === 'Other'; });
    // Other should be second-to-last (Unknown not present in this case, so last)
    expect(otherIndex).toBe(result.length - 1);
  });

  it('"Unknown" is always appended after "Other" (D-10)', function () {
    var buckets = [];
    for (var i = 1; i <= 10; i++) {
      buckets.push({ label: 'Brand' + i, count: 11 - i });
    }
    buckets.push({ label: 'Unknown', count: 4 });
    var result = bp.applyTopN(buckets, 8);
    // Should have 8 top + Other + Unknown = 10 total
    expect(result.length).toBe(10);
    var otherIndex = result.findIndex(function (b) { return b.label === 'Other'; });
    var unknownIndex = result.findIndex(function (b) { return b.label === 'Unknown'; });
    expect(unknownIndex).toBe(result.length - 1);
    expect(otherIndex).toBe(result.length - 2);
    expect(unknownIndex).toBeGreaterThan(otherIndex); // Unknown after Other (D-10)
  });

  it('"Unknown" appended last even when <= n distinct values', function () {
    var buckets = [
      { label: 'Red', count: 5 },
      { label: 'White', count: 3 },
      { label: 'Unknown', count: 2 }
    ];
    var result = bp.applyTopN(buckets, 8);
    expect(result[result.length - 1].label).toBe('Unknown');
    expect(result.length).toBe(3);
  });

  it('does not mutate the input array', function () {
    var buckets = [
      { label: 'Brand1', count: 10 },
      { label: 'Brand2', count: 9 },
      { label: 'Unknown', count: 1 }
    ];
    var original = JSON.stringify(buckets);
    bp.applyTopN(buckets, 8);
    expect(JSON.stringify(buckets)).toBe(original);
  });

  it('top-n selection uses count descending when > n', function () {
    var buckets = [
      { label: 'A', count: 1 },
      { label: 'B', count: 9 },
      { label: 'C', count: 5 },
      { label: 'D', count: 7 },
      { label: 'E', count: 3 }
    ];
    var result = bp.applyTopN(buckets, 3);
    // Top 3 by count: B(9), D(7), C(5); Other = A(1)+E(3) = 4
    var topLabels = result.slice(0, 3).map(function (b) { return b.label; });
    expect(topLabels).toContain('B');
    expect(topLabels).toContain('D');
    expect(topLabels).toContain('C');
    var other = result.find(function (b) { return b.label === 'Other'; });
    expect(other.count).toBe(4);
  });
});
