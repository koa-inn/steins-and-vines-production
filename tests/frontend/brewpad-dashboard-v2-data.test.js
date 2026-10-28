'use strict';

// Phase 95-03: v2 dashboard selection layer (filters, id sets, buckets, litres, mix).

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

var ASOF = { today: '2026-10-23', year: 2026, tz: 'America/Vancouver' };
var FIVE = ['wine', 'beer', 'cider', 'seltzer', 'other'];

var seq = 0;
function row(o) {
  seq++;
  var base = {
    batch_id: 'B' + seq, status: 'complete', batch_type: 'beer', batch_type_source: 'auto',
    start_date: null, completed_day: null, completed_at: null, completed_at_source: null,
    vessel_id: null, source: 'kiosk', product_sku: '', product_name: '', product_subcategory: '',
    product_brand: '', product_manufacturer: '', recipe_id: '', schedule_id: '',
    schedule_category: '', target_volume_l: null, tasks_total: 0, tasks_done: 0, staff_batch: false
  };
  var k;
  for (k in o) { if (Object.prototype.hasOwnProperty.call(o, k)) base[k] = o[k]; }
  return base;
}

function sorted(arr) { return arr.slice().sort(); }

describe('weekStartOf', function () {
  test('maps days to their Monday', function () {
    expect(bp.weekStartOf('2026-10-23')).toBe('2026-10-19');
    expect(bp.weekStartOf('2026-10-19')).toBe('2026-10-19');
    expect(bp.weekStartOf('2026-10-25')).toBe('2026-10-19');
    expect(bp.weekStartOf('2027-01-01')).toBe('2026-12-28');
    expect(bp.weekStartOf('2026-11-02')).toBe('2026-11-02');
    expect(bp.weekStartOf('2026-03-09')).toBe('2026-03-09');
  });
});

describe('bucket keys and labels', function () {
  test('bucketKeyOf', function () {
    expect(bp.bucketKeyOf('2026-10-23', 'week')).toBe('2026-10-19');
    expect(bp.bucketKeyOf('2026-10-23', 'month')).toBe('2026-10');
  });
  test('bucketLabelOf', function () {
    expect(bp.bucketLabelOf('2026-06', 'month')).toBe('Jun 2026');
    expect(bp.bucketLabelOf('2026-06-01', 'week')).toBe('Week of Jun 1');
  });
  test('periodSkeleton gap fills', function () {
    var m = bp.periodSkeleton('2026-01-01', '2026-10-23', 'month');
    expect(m.map(function (b) { return b.key; })).toEqual(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    var w = bp.periodSkeleton('2026-12-28', '2027-01-10', 'week');
    expect(w.map(function (b) { return b.key; })).toEqual(['2026-12-28', '2027-01-04']);
    expect(w[0].label).toBe('Week of Dec 28');
  });
});

describe('sourceMatches', function () {
  test('unknown / all / kiosk / case', function () {
    expect(bp.sourceMatches({ source: null }, 'unknown')).toBe(true);
    expect(bp.sourceMatches({ source: '  ' }, 'unknown')).toBe(true);
    expect(bp.sourceMatches({ source: '' }, 'kiosk')).toBe(false);
    expect(bp.sourceMatches({ source: null }, 'all')).toBe(true);
    expect(bp.sourceMatches({ source: 'x' }, undefined)).toBe(true);
    expect(bp.sourceMatches({ source: 'kiosk_recipe' }, 'kiosk')).toBe(true);
    expect(bp.sourceMatches({ source: 'kiosk' }, 'kiosk')).toBe(true);
    expect(bp.sourceMatches({ source: 'Online' }, 'online')).toBe(true);
    expect(bp.sourceMatches({ source: 'online' }, 'manual')).toBe(false);
  });
  test('per-option counts sum to all', function () {
    var srcs = ['kiosk', 'kiosk_recipe', 'online', 'manual', 'zoho_scan', 'research', 'internal', null, ''];
    var rows = srcs.map(function (s, i) { return row({ status: 'primary', source: s, start_date: '2026-09-0' + (i + 1) }); });
    var all = bp.getDashboardData(rows, ASOF, { window: 'ytd', source: 'all' }).started;
    var sum = 0;
    ['kiosk', 'online', 'manual', 'zoho_scan', 'research', 'internal', 'unknown'].forEach(function (s) {
      sum += bp.getDashboardData(rows, ASOF, { window: 'ytd', source: s }).started;
    });
    expect(all).toBe(9);
    expect(sum).toBe(all);
  });
});

describe('batchLitres', function () {
  test('defaults and overrides', function () {
    expect(bp.batchLitres({}, 'started', 'wine')).toEqual({ l: 23, est: true });
    expect(bp.batchLitres({}, 'started', 'beer')).toEqual({ l: 28, est: true });
    expect(bp.batchLitres({}, 'active', 'beer')).toEqual({ l: 28, est: true });
    expect(bp.batchLitres({}, 'completed', 'beer')).toEqual({ l: 25, est: true });
    expect(bp.batchLitres({}, 'started', 'seltzer')).toEqual({ l: 23, est: true });
    expect(bp.batchLitres({}, 'started', 'other')).toEqual({ l: 23, est: true });
    expect(bp.batchLitres({ target_volume_l: 19.5 }, 'started', 'beer')).toEqual({ l: 19.5, est: false });
    expect(bp.batchLitres({ target_volume_l: 0 }, 'started', 'wine')).toEqual({ l: 23, est: true });
    expect(bp.batchLitres({ target_volume_l: null }, 'started', 'wine')).toEqual({ l: 23, est: true });
  });
});

describe('isStaffRow', function () {
  test('flag or map', function () {
    expect(bp.isStaffRow({ batch_id: 'a', staff_batch: true }, null)).toBe(true);
    expect(bp.isStaffRow({ batch_id: 'a' }, { a: true })).toBe(true);
    expect(bp.isStaffRow({ batch_id: 'a' }, { b: true })).toBe(false);
    expect(bp.isStaffRow({ batch_id: 'a' }, null)).toBeFalsy();
  });
});

describe('previousWindow / windowFromFilters', function () {
  test('previous windows', function () {
    var t = '2026-10-23';
    var w30 = bp.dashboardWindow('30d', t);
    expect(w30.start).toBe('2026-09-24');
    var p = bp.previousWindow(w30, t);
    expect(p.start).toBe('2026-08-25');
    expect(p.end).toBe('2026-09-23');
    expect(p.days).toBe(30);
    var p6 = bp.previousWindow(bp.dashboardWindow('6mo', t), t);
    expect(p6.end).toBe('2026-04-26');
    expect(p6.days).toBe(180);
    var py = bp.previousWindow(bp.dashboardWindow('ytd', t), t);
    expect(py.start).toBe('2025-01-01');
    expect(py.end).toBe('2025-10-23');
    var pl = bp.previousWindow(bp.dashboardWindow('ytd', '2028-02-29'), '2028-02-29');
    expect(pl.start).toBe('2027-01-01');
    expect(pl.end).toBe('2027-02-28');
    var pc = bp.previousWindow({ key: 'custom', start: '2026-06-01', end: '2026-06-30' }, t);
    expect(pc.start).toBe('2026-05-02');
    expect(pc.end).toBe('2026-05-31');
    expect(bp.previousWindow(bp.dashboardWindow('all', t), t)).toBeNull();
  });
  test('windowFromFilters', function () {
    var t = '2026-10-23';
    expect(bp.windowFromFilters({ period: '90d' }, t)).toEqual(bp.dashboardWindow('90d', t));
    expect(bp.windowFromFilters({ period: 'all' }, t).key).toBe('all');
    expect(bp.windowFromFilters({ period: 'custom', from: '2026-06-01', to: '2026-06-30' }, t))
      .toEqual({ key: 'custom', start: '2026-06-01', end: '2026-06-30' });
    var ytd = bp.dashboardWindow('ytd', t);
    expect(bp.windowFromFilters({ period: 'custom', from: '2026-07-01', to: '2026-06-30' }, t)).toEqual(ytd);
    expect(bp.windowFromFilters({ period: 'custom', from: '2026-07-01', to: '2026-12-30' }, t)).toEqual(ytd);
    expect(bp.windowFromFilters({ period: 'custom', from: '2026-7-01', to: '2026-08-30' }, t)).toEqual(ytd);
    expect(bp.windowFromFilters({ period: 'custom', from: 'abc', to: null }, t)).toEqual(ytd);
  });
});

function bigFixture() {
  var out = [];
  var sources = ['kiosk', 'kiosk_recipe', 'online', 'manual', null, 'internal'];
  var statuses = ['primary', 'secondary', 'complete', 'complete', 'pending', 'disabled'];
  var i;
  for (i = 0; i < 90; i++) {
    var st = statuses[i % statuses.length];
    var start = bp.addDays('2025-06-01', i * 5);
    if (start > '2026-10-23') start = bp.addDays('2025-02-01', i * 3);
    out.push(row({
      batch_id: 'f' + i, status: st, batch_type: FIVE[i % 5], source: sources[i % sources.length],
      start_date: st === 'pending' ? null : start,
      completed_day: st === 'complete' ? bp.addDays(start, (i % 40)) : null,
      target_volume_l: i % 3 === 0 ? 20 : null,
      staff_batch: i % 7 === 0
    }));
  }
  return out;
}

describe('ids invariants', function () {
  var rows = bigFixture();
  var WINS = ['ytd', '30d', '90d', '6mo', '12mo', 'all'];
  var TY = ['all', 'wine', 'beer', 'cider', 'seltzer', 'other'];
  var SRC = ['all', 'kiosk', 'online', 'manual', 'internal', 'unknown'];
  test('count === ids.length everywhere', function () {
    WINS.forEach(function (w) { TY.forEach(function (t) { SRC.forEach(function (s) {
      var d = bp.getDashboardData(rows, ASOF, { window: w, type: t, source: s });
      expect(d.started).toBe(d.ids.started.length);
      expect(d.completed).toBe(d.ids.completed.length);
      expect(d.activeNow).toBe(d.ids.activeNow.length);
      expect(d.cycle.n).toBe(d.ids.cycle.length);
      FIVE.forEach(function (ty) {
        expect(d.totals.byType[ty]).toBe(d.ids.startedByType[ty].length);
        expect(d.completedTotals.byType[ty]).toBe(d.ids.completedByType[ty].length);
      });
    }); }); });
  });
  test('activeNow ignores window but honours type and source', function () {
    var a = bp.getDashboardData(rows, ASOF, { window: '30d', type: 'beer', source: 'kiosk' });
    var b = bp.getDashboardData(rows, ASOF, { window: 'all', type: 'beer', source: 'kiosk' });
    expect(a.activeNow).toBe(b.activeNow);
    var c = bp.getDashboardData(rows, ASOF, { window: 'all', type: 'all', source: 'all' });
    expect(c.activeNow).toBeGreaterThan(a.activeNow);
  });
});

describe('v1 keys unchanged', function () {
  test('additive filters do not change legacy output', function () {
    var rows = bigFixture();
    var base = bp.getDashboardData(rows, ASOF, { window: 'ytd', type: 'beer' });
    var ext = bp.getDashboardData(rows, ASOF, { window: 'ytd', type: 'beer', source: 'all', staff: false, staffIds: {}, group: 'month' });
    ['asOf', 'window', 'activeNow', 'pendingCount', 'started', 'totals', 'completed', 'completedTotals', 'monthBuckets', 'cycle', 'needsType'].forEach(function (k) {
      expect(ext[k]).toEqual(base[k]);
    });
    expect(base.periodBuckets).toEqual([]);
    expect(base.ids).toBeDefined();
    expect(base.litres).toBeDefined();
    expect(base.mix).toBeDefined();
  });
});

describe('periodBuckets', function () {
  var rows = bigFixture();
  ['month', 'week'].forEach(function (g) {
    ['ytd', '90d', 'all'].forEach(function (w) {
      test(g + ' buckets sum to started for ' + w, function () {
        var d = bp.getDashboardData(rows, ASOF, { window: w, group: g });
        var sum = 0;
        var all = [];
        d.periodBuckets.forEach(function (b) {
          sum += b.all.length;
          all = all.concat(b.all);
          var t = 0;
          FIVE.forEach(function (ty) {
            t += b.ids[ty].length;
            expect(b.counts[ty]).toBe(b.ids[ty].length);
          });
          expect(t).toBe(b.all.length);
          expect(b.total).toBe(b.all.length);
        });
        expect(sum).toBe(d.ids.started.length);
        expect(sorted(all)).toEqual(sorted(d.ids.started));
      });
    });
  });
  test('rows before the window never appear', function () {
    var rs = [row({ batch_id: 'old', status: 'primary', start_date: '2025-01-01' }), row({ batch_id: 'in', status: 'primary', start_date: '2026-06-10' })];
    var d = bp.getDashboardData(rs, ASOF, { window: 'ytd', group: 'month' });
    var all = [];
    d.periodBuckets.forEach(function (b) { all = all.concat(b.all); });
    expect(all).toEqual(['in']);
    expect(d.periodBuckets.length).toBe(10);
    expect(d.periodBuckets[0].key).toBe('2026-01');
  });
  test('litres per bucket', function () {
    var rs = [row({ batch_id: 'w', batch_type: 'wine', status: 'primary', start_date: '2026-06-10' })];
    var d = bp.getDashboardData(rs, ASOF, { window: 'ytd', group: 'month' });
    var b = d.periodBuckets[5];
    expect(b.litres.wine).toBe(23);
    expect(b.totalLitres).toBe(23);
  });
});

describe('range filter', function () {
  test('counts only June starts, key custom', function () {
    var rs = [
      row({ batch_id: 'jun', status: 'primary', start_date: '2026-06-15' }),
      row({ batch_id: 'may', status: 'primary', start_date: '2026-05-31' }),
      row({ batch_id: 'jul', status: 'primary', start_date: '2026-07-01' })
    ];
    var d = bp.getDashboardData(rs, ASOF, { range: { start: '2026-06-01', end: '2026-06-30' } });
    expect(d.ids.started).toEqual(['jun']);
    expect(d.window.key).toBe('custom');
  });
});

describe('staff and mix', function () {
  var rs = [
    row({ batch_id: 'w1', batch_type: 'wine', status: 'primary', start_date: '2026-06-01' }),
    row({ batch_id: 'w2', batch_type: 'wine', status: 'complete', start_date: '2026-06-02', completed_day: '2026-06-20' }),
    row({ batch_id: 'w3', batch_type: 'wine', status: 'primary', start_date: '2026-06-03', staff_batch: true }),
    row({ batch_id: 'b1', batch_type: 'beer', status: 'primary', start_date: '2026-06-04' })
  ];
  var sids = { w2: true };
  test('staff rows count everywhere but mix', function () {
    var off = bp.getDashboardData(rs, ASOF, { window: 'ytd', group: 'month', staffIds: sids, staff: false });
    var on = bp.getDashboardData(rs, ASOF, { window: 'ytd', group: 'month', staffIds: sids, staff: true });
    expect(off.started).toBe(4);
    expect(off.ids).toEqual(on.ids);
    expect(off.periodBuckets).toEqual(on.periodBuckets);
    expect(off.cycle).toEqual(on.cycle);
    expect(off.mix.wine.map(function (r) { return r.batch_id; })).toEqual(['w1']);
    expect(off.mix.staffHidden).toBe(2);
    expect(sorted(on.mix.wine.map(function (r) { return r.batch_id; }))).toEqual(['w1', 'w2', 'w3']);
    expect(on.mix.staffHidden).toBe(0);
  });
  test('mix honours type filter', function () {
    var d = bp.getDashboardData(rs, ASOF, { window: 'ytd', type: 'beer' });
    expect(d.mix.wine).toEqual([]);
  });
});

describe('litres', function () {
  test('totals and estimated flag', function () {
    var rs = [
      row({ batch_id: 'w', batch_type: 'wine', status: 'primary', start_date: '2026-06-01' }),
      row({ batch_id: 'b', batch_type: 'beer', status: 'primary', start_date: '2026-06-02' })
    ];
    var d = bp.getDashboardData(rs, ASOF, { window: 'ytd' });
    expect(d.litres.started).toBe(51);
    expect(d.litres.estimated).toBe(true);
    expect(d.litres.activeNow).toBe(51);
    var c = bp.getDashboardData([row({ batch_id: 'cb', batch_type: 'beer', status: 'complete', start_date: '2026-06-01', completed_day: '2026-06-20' })], ASOF, { window: 'ytd' });
    expect(c.litres.completed).toBe(25);
    var ex = bp.getDashboardData([row({ batch_id: 'x', batch_type: 'beer', status: 'primary', start_date: '2026-06-01', target_volume_l: 19 })], ASOF, { window: 'ytd' });
    expect(ex.litres.started).toBe(19);
    expect(ex.litres.estimated).toBe(false);
    expect(ex.litres.startedByType.beer).toBe(19);
  });
});

describe('earliestStart', function () {
  test('ignores filters, uses started statuses only', function () {
    var rs = [
      row({ batch_id: 'a', batch_type: 'wine', status: 'primary', source: 'online', start_date: '2025-03-04' }),
      row({ batch_id: 'b', batch_type: 'beer', status: 'complete', start_date: '2026-01-04', completed_day: '2026-02-01' }),
      row({ batch_id: 'c', status: 'disabled', start_date: '2024-01-01' })
    ];
    var d = bp.getDashboardData(rs, ASOF, { window: '30d', type: 'beer', source: 'kiosk' });
    expect(d.earliestStart).toBe('2025-03-04');
    expect(bp.getDashboardData([], ASOF, {}).earliestStart).toBeNull();
  });
});
