'use strict';

// Phase 95-04 Task 2: trend deltas, drill labels, id-carrying wine buckets.

global.google = { accounts: { oauth2: { initTokenClient: jest.fn() } } };
global.fetch = jest.fn(function () {
  return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ ok: true, data: {} }); } });
});
global.localStorage = {
  _data: {},
  getItem: function (k) { return this._data[k] || null; },
  setItem: function (k, v) { this._data[k] = v; },
  removeItem: function (k) { delete this._data[k]; },
  clear: function () { this._data = {}; }
};
var _ssData = {};
global.sessionStorage = {
  getItem: function (k) { return _ssData[k] !== undefined ? _ssData[k] : null; },
  setItem: function (k, v) { _ssData[k] = v; },
  removeItem: function (k) { delete _ssData[k]; },
  clear: function () { Object.keys(_ssData).forEach(function (k) { delete _ssData[k]; }); }
};

var _auth = require('../../js/lib/auth');
global.waitForGoogleIdentity = _auth.waitForGoogleIdentity;
global.gsiInitTokenClient = _auth.gsiInitTokenClient;
global.fetchGoogleUserInfo = _auth.fetchGoogleUserInfo;

var bp = require('../../js/brewpad');

var W90 = { key: '90d' };
function cnt(cur, prev, win, prevWin) {
  return bp.formatDelta(cur, prev, { kind: 'count', win: win || W90, prevWin: prevWin });
}

describe('formatDelta counts', function () {
  test('increase with percentage', function () {
    var d = cnt(45, 33);
    expect(d.text).toBe('▲ 12 (+36%) vs prev 90d');
    expect(d.dir).toBe('up');
    expect(d.tone).toBe('good');
    expect(d.aria).toBe('Up 12 compared with previous 90 days');
  });

  test('no percentage under 10% or when prev < 5', function () {
    expect(cnt(36, 33).text).toBe('▲ 3 vs prev 90d');
    expect(cnt(8, 4).text).toBe('▲ 4 vs prev 90d');
    expect(cnt(12, 0).text).toBe('▲ 12 vs prev 90d');
  });

  test('decrease is bad; flat is neutral', function () {
    var d = cnt(30, 33);
    expect(d.text).toBe('▼ 3 vs prev 90d');
    expect(d.tone).toBe('bad');
    expect(d.dir).toBe('down');
    var f = cnt(33, 33);
    expect(f.text).toBe('– no change vs prev 90d');
    expect(f.tone).toBe('neutral');
    expect(f.dir).toBe('flat');
    expect(cnt(0, 0).text).toBe('– no change vs prev 90d');
  });
});

describe('formatDelta days and litres', function () {
  test('days are inverted', function () {
    var better = bp.formatDelta(54, 57, { kind: 'days', win: W90 });
    expect(better.text).toBe('▼ 3d vs prev 90d');
    expect(better.tone).toBe('good');
    var worse = bp.formatDelta(60, 57, { kind: 'days', win: W90 });
    expect(worse.text).toBe('▲ 3d vs prev 90d');
    expect(worse.tone).toBe('bad');
  });

  test('null cycle values mean no earlier data', function () {
    expect(bp.formatDelta(null, 57, { kind: 'days', win: W90 }).text).toBe('No earlier data to compare');
    expect(bp.formatDelta(54, null, { kind: 'days', win: W90 }).text).toBe('No earlier data to compare');
  });

  test('litres with separator', function () {
    expect(bp.formatDelta(759, 640, { kind: 'litres', win: W90 }).text).toBe('▲ 119 L (+19%) vs prev 90d');
    expect(bp.formatDelta(1250, 0, { kind: 'litres', win: W90 }).text).toBe('▲ 1,250 L vs prev 90d');
  });
});

describe('formatDelta suffixes', function () {
  test('window suffixes', function () {
    expect(cnt(45, 33, { key: 'ytd' }).text).toBe('▲ 12 (+36%) vs same period last year');
    expect(cnt(45, 33, { key: '6mo' }).text).toBe('▲ 12 (+36%) vs prev 6m');
    expect(cnt(45, 33, { key: '12mo' }).text).toBe('▲ 12 (+36%) vs prev 12m');
    expect(cnt(45, 33, { key: '30d' }).text).toBe('▲ 12 (+36%) vs prev 30d');
    expect(cnt(45, 33, { key: 'custom' }, { days: 45 }).text).toBe('▲ 12 (+36%) vs prior 45 days');
  });

  test('all returns null', function () {
    expect(cnt(45, 33, { key: 'all' })).toBeNull();
  });

  test('insufficient', function () {
    var d = bp.formatDelta(5, 0, { kind: 'count', win: W90, insufficient: true });
    expect(d.text).toBe('No earlier data to compare');
    expect(d.dir).toBe('none');
    expect(d.tone).toBe('neutral');
  });
});

describe('dashDrillLabel', function () {
  test('bucket form', function () {
    expect(bp.dashDrillLabel({ typeLabel: 'Wine', verb: 'started', bucketLabel: 'Jun 2026', count: 33 }))
      .toBe('From dashboard: Wine started in Jun 2026 · 33 batches');
  });

  test('tile forms', function () {
    expect(bp.dashDrillLabel({ typeLabel: '', verb: 'completed', periodLabel: 'YTD', count: 71 }))
      .toBe('From dashboard: Completed YTD · 71 batches');
    expect(bp.dashDrillLabel({ typeLabel: '', verb: 'completed', periodLabel: 'YTD', count: 1 }))
      .toBe('From dashboard: Completed YTD · 1 batch');
    expect(bp.dashDrillLabel({ typeLabel: '', verb: 'fermenting', count: 12 }))
      .toBe('From dashboard: Fermenting now · 12 batches');
    expect(bp.dashDrillLabel({ typeLabel: '', verb: 'cycle', periodLabel: 'YTD', count: 40 }))
      .toBe('From dashboard: Days to complete, YTD · 40 batches');
  });

  test('litres appended', function () {
    expect(bp.dashDrillLabel({ typeLabel: 'Wine', verb: 'started', bucketLabel: 'Jun 2026', count: 33, litres: 759 }))
      .toBe('From dashboard: Wine started in Jun 2026 · 33 batches (759 L)');
  });
});

describe('wine buckets', function () {
  var lookup = {};
  var rows = [];
  var seq = 0;
  function addWine(brand, n) {
    for (var i = 0; i < n; i++) {
      seq++;
      var sku = 'S' + seq;
      lookup[sku] = { brand: brand };
      rows.push({ batch_id: 'W' + seq, category: 'wine', start_date: '2026-10-01', product_sku: sku });
    }
  }
  addWine('A', 9); addWine('B', 8); addWine('C', 7); addWine('D', 6); addWine('E', 5);
  addWine('F', 4); addWine('G', 4); addWine('H', 3); addWine('I', 2); addWine('J', 1);
  rows.push({ batch_id: 'WX1', category: 'wine', start_date: '2026-10-01', product_sku: 'NOPE' });
  rows.push({ batch_id: 'WX2', category: 'wine', start_date: '2026-10-01', product_sku: '' });

  test('matches v1 labels and counts; ids match counts', function () {
    var v1 = bp.applyTopN(bp.bucketWineDimension(rows, null, lookup, 'brand', null), 8);
    var v2 = bp.wineBreakdownBuckets(rows, lookup, 'brand', 8);
    expect(v2.map(function (b) { return [b.label, b.count]; })).toEqual(v1.map(function (b) { return [b.label, b.count]; }));
    v2.forEach(function (b) { expect(b.ids.length).toBe(b.count); });
    expect(v2[v2.length - 1].label).toBe('Unknown');
    expect(v2[v2.length - 2].label).toBe('Other');
    var all = [];
    v2.forEach(function (b) { all = all.concat(b.ids); });
    expect(all.length).toBe(rows.length);
  });

  test('time dimension sorts by week ascending', function () {
    var l = { a: { time: '10 weeks' }, b: { time: '4 week' }, c: { time: '4 weeks' } };
    var r = [
      { batch_id: '1', product_sku: 'a' }, { batch_id: '2', product_sku: 'b' }, { batch_id: '3', product_sku: 'c' }
    ];
    var out = bp.wineBreakdownBuckets(r, l, 'time', 8);
    expect(out.map(function (b) { return b.label; })).toEqual(['4 weeks', '10 weeks']);
    expect(out[0].ids).toEqual(['2', '3']);
  });

  test('mergeWineSkuLookup applies row overrides without mutating input', function () {
    var base = { S1: { brand: 'Old', subcategory: 'Red' } };
    var merged = bp.mergeWineSkuLookup(base, [
      { product_sku: 'S1', product_brand: 'New' },
      { product_sku: 'S2', product_subcategory: 'White' },
      { product_sku: 'S3' }
    ]);
    expect(merged.S1).toEqual({ brand: 'New', subcategory: 'Red' });
    expect(merged.S2).toEqual({ subcategory: 'White' });
    expect(merged.S3).toBeUndefined();
    expect(base.S1.brand).toBe('Old');
  });
});
