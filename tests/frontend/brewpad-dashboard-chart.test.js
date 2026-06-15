'use strict';

// Dashboard Batches-by-Month chart helpers — Jest test suite
// Tests the pure helper functions added to js/brewpad.js for the stacked bar chart feature.

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
// buildScheduleCategoryById
// ---------------------------------------------------------------------------
describe('buildScheduleCategoryById', function () {
  it('returns an empty object for an empty array', function () {
    expect(bp.buildScheduleCategoryById([])).toEqual({});
  });

  it('returns an empty object for null/undefined', function () {
    expect(bp.buildScheduleCategoryById(null)).toEqual({});
    expect(bp.buildScheduleCategoryById(undefined)).toEqual({});
  });

  it('maps schedule_id to lowercased category', function () {
    var schedules = [
      { schedule_id: 'FS-0001', category: 'Wine' },
      { schedule_id: 'FS-0002', category: 'beer' },
      { schedule_id: 'FS-0003', category: 'CIDER' }
    ];
    var map = bp.buildScheduleCategoryById(schedules);
    expect(map['FS-0001']).toBe('wine');
    expect(map['FS-0002']).toBe('beer');
    expect(map['FS-0003']).toBe('cider');
  });

  it('skips entries without schedule_id or category', function () {
    var schedules = [
      { schedule_id: 'FS-0001' },         // no category
      { category: 'wine' },               // no schedule_id
      { schedule_id: 'FS-0003', category: 'seltzer' }
    ];
    var map = bp.buildScheduleCategoryById(schedules);
    expect(Object.keys(map).length).toBe(1);
    expect(map['FS-0003']).toBe('seltzer');
  });
});

// ---------------------------------------------------------------------------
// resolveBatchType
// ---------------------------------------------------------------------------
describe('resolveBatchType', function () {
  var catMap = { 'FS-0001': 'wine', 'FS-0002': 'beer' };

  it('uses batch.category when it is a known type', function () {
    expect(bp.resolveBatchType({ category: 'wine' }, catMap)).toBe('wine');
    expect(bp.resolveBatchType({ category: 'BEER' }, catMap)).toBe('beer');
    expect(bp.resolveBatchType({ category: 'Cider' }, catMap)).toBe('cider');
    expect(bp.resolveBatchType({ category: 'seltzer' }, catMap)).toBe('seltzer');
  });

  it('falls back to scheduleCategoryById when batch.category is absent', function () {
    expect(bp.resolveBatchType({ schedule_id: 'FS-0001' }, catMap)).toBe('wine');
    expect(bp.resolveBatchType({ schedule_id: 'FS-0002' }, catMap)).toBe('beer');
  });

  it('falls back to scheduleCategoryById when batch.category is unknown type', function () {
    var batch = { category: 'kombucha', schedule_id: 'FS-0001' };
    expect(bp.resolveBatchType(batch, catMap)).toBe('wine');
  });

  it('falls back to schedule_snapshot.category when schedule lookup also misses', function () {
    var batch = {
      schedule_id: 'FS-UNKNOWN',
      schedule_snapshot: JSON.stringify({ category: 'cider' })
    };
    expect(bp.resolveBatchType(batch, catMap)).toBe('cider');
  });

  it('parses schedule_snapshot even when it is an object (not string)', function () {
    var batch = {
      schedule_snapshot: { category: 'seltzer' }
    };
    expect(bp.resolveBatchType(batch, catMap)).toBe('seltzer');
  });

  it('returns "other" when schedule_snapshot has unknown category', function () {
    var batch = {
      schedule_snapshot: JSON.stringify({ category: 'mead' })
    };
    expect(bp.resolveBatchType(batch, catMap)).toBe('other');
  });

  it('returns "other" when schedule_snapshot JSON is malformed', function () {
    var batch = {
      schedule_snapshot: 'not-valid-json{'
    };
    expect(bp.resolveBatchType(batch, catMap)).toBe('other');
  });

  it('returns "other" when no type information is available', function () {
    expect(bp.resolveBatchType({}, catMap)).toBe('other');
    expect(bp.resolveBatchType({}, {})).toBe('other');
    expect(bp.resolveBatchType({}, null)).toBe('other');
  });

  it('returns "other" when batch.category is empty string', function () {
    expect(bp.resolveBatchType({ category: '' }, catMap)).toBe('other');
  });
});

// ---------------------------------------------------------------------------
// bucketBatchesByMonthType
// ---------------------------------------------------------------------------
describe('bucketBatchesByMonthType', function () {
  // Fixed reference date: 2026-03-15 (March 2026)
  // Last 6 months (default): Oct 2025, Nov 2025, Dec 2025, Jan 2026, Feb 2026, Mar 2026
  var REF_DATE = '2026-03-15';

  it('returns 6 buckets in chronological order with correct labels', function () {
    var result = bp.bucketBatchesByMonthType([], {}, 6, REF_DATE);
    expect(result.length).toBe(6);
    expect(result[0].label).toBe('Oct');
    expect(result[1].label).toBe('Nov');
    expect(result[2].label).toBe('Dec');
    expect(result[3].label).toBe('Jan');
    expect(result[4].label).toBe('Feb');
    expect(result[5].label).toBe('Mar');
  });

  it('defaults to 6 months when monthsBack is omitted', function () {
    var result = bp.bucketBatchesByMonthType([], {}, undefined, REF_DATE);
    expect(result.length).toBe(6);
  });

  it('returns zero counts for all types when batches array is empty', function () {
    var result = bp.bucketBatchesByMonthType([], {}, 6, REF_DATE);
    result.forEach(function (bucket) {
      expect(bucket.total).toBe(0);
      expect(bucket.counts.wine).toBe(0);
      expect(bucket.counts.beer).toBe(0);
      expect(bucket.counts.cider).toBe(0);
      expect(bucket.counts.seltzer).toBe(0);
      expect(bucket.counts.other).toBe(0);
    });
  });

  it('buckets batches by start_date into correct months', function () {
    var batches = [
      { start_date: '2026-03-01', category: 'wine' },
      { start_date: '2026-03-20', category: 'beer' },
      { start_date: '2026-02-10', category: 'cider' },
      { start_date: '2025-10-05', category: 'seltzer' }
    ];
    var result = bp.bucketBatchesByMonthType(batches, {}, 6, REF_DATE);
    // Oct 2025
    expect(result[0].counts.seltzer).toBe(1);
    expect(result[0].total).toBe(1);
    // Feb 2026
    expect(result[4].counts.cider).toBe(1);
    // Mar 2026
    expect(result[5].counts.wine).toBe(1);
    expect(result[5].counts.beer).toBe(1);
    expect(result[5].total).toBe(2);
  });

  it('falls back to created_at when start_date is absent', function () {
    var batches = [
      { created_at: '2026-01-14', category: 'beer' }
    ];
    var result = bp.bucketBatchesByMonthType(batches, {}, 6, REF_DATE);
    // Jan 2026 is result[3]
    expect(result[3].counts.beer).toBe(1);
    expect(result[3].total).toBe(1);
  });

  it('prefers start_date over created_at when both are present', function () {
    var batches = [
      { start_date: '2026-02-10', created_at: '2026-03-01', category: 'wine' }
    ];
    var result = bp.bucketBatchesByMonthType(batches, {}, 6, REF_DATE);
    // Should land in Feb (result[4]), NOT Mar
    expect(result[4].counts.wine).toBe(1);
    expect(result[5].counts.wine).toBe(0);
  });

  it('ignores batches with no usable date', function () {
    var batches = [
      { category: 'wine' },             // no start_date, no created_at
      { start_date: '', category: 'beer' },
      { start_date: null, created_at: null, category: 'cider' }
    ];
    var result = bp.bucketBatchesByMonthType(batches, {}, 6, REF_DATE);
    var total = result.reduce(function (acc, b) { return acc + b.total; }, 0);
    expect(total).toBe(0);
  });

  it('ignores batches whose date falls outside the window', function () {
    var batches = [
      { start_date: '2024-01-01', category: 'wine' },    // too old
      { start_date: '2030-06-01', category: 'beer' }     // too future
    ];
    var result = bp.bucketBatchesByMonthType(batches, {}, 6, REF_DATE);
    var total = result.reduce(function (acc, b) { return acc + b.total; }, 0);
    expect(total).toBe(0);
  });

  it('uses scheduleCategoryById to resolve type when batch.category is absent', function () {
    var schedMap = { 'FS-0001': 'wine' };
    var batches = [
      { start_date: '2026-03-01', schedule_id: 'FS-0001' }
    ];
    var result = bp.bucketBatchesByMonthType(batches, schedMap, 6, REF_DATE);
    expect(result[5].counts.wine).toBe(1);
  });

  it('resolves type via schedule_snapshot when other lookups fail', function () {
    var batches = [
      { start_date: '2026-03-01', schedule_snapshot: JSON.stringify({ category: 'cider' }) }
    ];
    var result = bp.bucketBatchesByMonthType(batches, {}, 6, REF_DATE);
    expect(result[5].counts.cider).toBe(1);
  });

  it('resolves unknown types to "other"', function () {
    var batches = [
      { start_date: '2026-03-01', category: 'mead' }
    ];
    var result = bp.bucketBatchesByMonthType(batches, {}, 6, REF_DATE);
    expect(result[5].counts.other).toBe(1);
  });

  it('handles window spanning a year boundary correctly', function () {
    // Reference: Jan 2026 — last 3 months: Nov 2025, Dec 2025, Jan 2026
    var result = bp.bucketBatchesByMonthType([], {}, 3, '2026-01-15');
    expect(result[0].label).toBe('Nov');
    expect(result[1].label).toBe('Dec');
    expect(result[2].label).toBe('Jan');
  });

  it('accumulates multiple batches in the same month-type slot', function () {
    var batches = [
      { start_date: '2026-03-01', category: 'wine' },
      { start_date: '2026-03-05', category: 'wine' },
      { start_date: '2026-03-10', category: 'wine' }
    ];
    var result = bp.bucketBatchesByMonthType(batches, {}, 6, REF_DATE);
    expect(result[5].counts.wine).toBe(3);
    expect(result[5].total).toBe(3);
  });
});
