'use strict';

// Phase 94-02: pure dashboard data layer (getDashboardData, dashboardWindow, cycle math).

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
var WINDOWS = ['ytd', '30d', '90d', '6mo', '12mo', 'all'];
var TYPES = ['all', 'wine', 'beer', 'cider', 'seltzer', 'other'];
var FIVE = ['wine', 'beer', 'cider', 'seltzer', 'other'];

var seq = 0;
function row(o) {
  seq++;
  var base = {
    batch_id: 'B' + seq, status: 'complete', batch_type: 'beer', batch_type_source: 'auto',
    start_date: null, completed_day: null, completed_at: null, completed_at_source: null,
    vessel_id: null, source: 'kiosk', product_sku: '', product_name: '', product_subcategory: '',
    product_brand: '', product_manufacturer: '', recipe_id: '', schedule_id: '',
    schedule_category: '', target_volume_l: null, tasks_total: 0, tasks_done: 0
  };
  var k;
  for (k in o) { if (Object.prototype.hasOwnProperty.call(o, k)) base[k] = o[k]; }
  return base;
}

function fixture() {
  return [
    row({ batch_id: 'w1', batch_type: 'wine', start_date: '2026-02-01', completed_day: '2026-04-05' }),   // 63
    row({ batch_id: 'b1', batch_type: 'beer', start_date: '2026-03-01', completed_day: '2026-03-31' }),   // 30
    row({ batch_id: 'b2', batch_type: 'beer', start_date: '2026-03-10', completed_day: '2026-04-20' }),   // 41
    row({ batch_id: 'c1', batch_type: 'cider', start_date: '2026-06-01', completed_day: '2026-06-15' }),  // 14
    row({ batch_id: 's1', batch_type: 'seltzer', start_date: '2026-07-01', completed_day: '2026-07-08' }), // 7
    row({ batch_id: 'staff', batch_type: 'wine', source: 'internal', start_date: '2026-08-01', completed_day: '2026-08-11' }), // 10
    row({ batch_id: 'res', batch_type: 'beer', source: 'research', start_date: '2026-05-01', completed_day: '2026-05-31' }),   // 30
    row({ batch_id: 'nocomp', batch_type: 'wine', start_date: '2026-05-05' }),                              // excluded
    row({ batch_id: 'neg', batch_type: 'beer', start_date: '2026-09-10', completed_day: '2026-09-01' }),   // excluded
    row({ batch_id: 'pend', status: 'pending', batch_type: 'beer' }),
    row({ batch_id: 'dis', status: 'disabled', batch_type: 'wine', start_date: '2026-09-01' }),
    row({ batch_id: 'fut', status: 'primary', batch_type: 'beer', start_date: '2026-10-24' }),
    row({ batch_id: 'dec31', status: 'primary', batch_type: 'wine', start_date: '2025-12-31' }),
    row({ batch_id: 'jan1', status: 'secondary', batch_type: 'wine', start_date: '2026-01-01' }),
    row({ batch_id: 'nul', status: 'primary', batch_type: null, batch_type_source: null, schedule_category: 'cider', start_date: '2026-10-01' }),
    row({ batch_id: 'oth', status: 'primary', batch_type: 'other', start_date: '2026-10-05' }),
    row({ batch_id: 'othm', status: 'secondary', batch_type: 'other', batch_type_source: 'manual', start_date: '2026-10-06' })
  ];
}

describe('dayNumber / addDays', function () {
  test('consecutive days differ by 1', function () {
    expect(bp.dayNumber('2026-01-01') - bp.dayNumber('2025-12-31')).toBe(1);
  });
  test('addDays crosses month boundary', function () {
    expect(bp.addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  test('addDays is calendar exact across 2026-11-01', function () {
    expect(bp.addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(bp.addDays('2026-11-01', 1)).toBe('2026-11-02');
    expect(bp.addDays('2026-11-02', -2)).toBe('2026-10-31');
  });
});

describe('cycleDays / medianOf / meanOf', function () {
  test('whole days between start and completion', function () {
    expect(bp.cycleDays('2026-02-01', '2026-04-05')).toBe(63);
  });
  test('missing start or completion is null', function () {
    expect(bp.cycleDays(null, '2026-04-05')).toBeNull();
    expect(bp.cycleDays('2026-02-01', null)).toBeNull();
  });
  test('negative span is null', function () {
    expect(bp.cycleDays('2026-04-05', '2026-02-01')).toBeNull();
  });
  test('same day is 0', function () {
    expect(bp.cycleDays('2026-04-05', '2026-04-05')).toBe(0);
  });
  test('median odd/even/empty', function () {
    expect(bp.medianOf([1, 2, 3])).toBe(2);
    expect(bp.medianOf([1, 2, 3, 4])).toBe(2.5);
    expect(bp.medianOf([])).toBeNull();
  });
  test('median does not mutate input and sorts', function () {
    var a = [3, 1, 2];
    expect(bp.medianOf(a)).toBe(2);
    expect(a).toEqual([3, 1, 2]);
  });
  test('mean', function () {
    expect(bp.meanOf([1, 2, 3, 4])).toBe(2.5);
    expect(bp.meanOf([])).toBeNull();
  });
});

describe('dashboardWindow / inWindow', function () {
  test('ytd', function () {
    expect(bp.dashboardWindow('ytd', '2026-10-23')).toEqual({ key: 'ytd', start: '2026-01-01', end: '2026-10-23' });
  });
  test('30d is 30 days inclusive', function () {
    expect(bp.dashboardWindow('30d', '2026-10-23').start).toBe('2026-09-24');
  });
  test('90d, 6mo, 12mo', function () {
    expect(bp.dashboardWindow('90d', '2026-10-23').start).toBe(bp.addDays('2026-10-23', -89));
    expect(bp.dashboardWindow('6mo', '2026-10-23').start).toBe(bp.addDays('2026-10-23', -179));
    expect(bp.dashboardWindow('12mo', '2026-10-23').start).toBe(bp.addDays('2026-10-23', -364));
  });
  test('all', function () {
    expect(bp.dashboardWindow('all', '2026-10-23').start).toBe('0000-01-01');
  });
  test('unknown key falls back to ytd', function () {
    expect(bp.dashboardWindow('zzz', '2026-10-23').key).toBe('ytd');
    expect(bp.dashboardWindow(undefined, '2026-10-23').start).toBe('2026-01-01');
  });
  test('inWindow is inclusive and excludes future', function () {
    var w = bp.dashboardWindow('ytd', '2026-10-23');
    expect(bp.inWindow('2026-01-01', w)).toBe(true);
    expect(bp.inWindow('2026-10-23', w)).toBe(true);
    expect(bp.inWindow('2025-12-31', w)).toBe(false);
    expect(bp.inWindow('2026-10-24', w)).toBe(false);
    expect(bp.inWindow(null, w)).toBe(false);
  });
});

describe('effectiveBatchType', function () {
  test('stored batch_type wins', function () {
    expect(bp.effectiveBatchType({ batch_type: 'beer' })).toBe('beer');
  });
  test('schedule_category fallback for NULL type', function () {
    expect(bp.effectiveBatchType({ batch_type: null, schedule_category: 'cider' })).toBe('cider');
  });
  test('schedule map fallback', function () {
    expect(bp.effectiveBatchType({ batch_type: null, schedule_id: 'FS-1' }, { 'FS-1': 'wine' })).toBe('wine');
  });
  test('nothing resolves to other', function () {
    expect(bp.effectiveBatchType({})).toBe('other');
  });
});

describe('toDashRows', function () {
  test('maps get_batches rows to the lean contract', function () {
    var out = bp.toDashRows([{ batch_id: 'x', start_date: '2026-02-01T08:00:00.000Z', completed_at: '2026-04-06T05:30:00.000Z', status: 'Complete' }]);
    expect(out[0].start_date).toBe('2026-02-01');
    expect(out[0].completed_day).toBe('2026-04-05');
    expect(out[0].status).toBe('complete');
    expect(out[0].batch_type).toBeNull();
    expect(out[0].schedule_category).toBe('');
  });
  test('missing dates give null and null input gives []', function () {
    var out = bp.toDashRows([{ batch_id: 'y', status: 'Pending' }]);
    expect(out[0].start_date).toBeNull();
    expect(out[0].completed_day).toBeNull();
    expect(bp.toDashRows(null)).toEqual([]);
  });
});

describe('getDashboardData', function () {
  var d = bp.getDashboardData(fixture(), ASOF, {});

  test('totals count started rows with start_date in ytd only', function () {
    // started in ytd: w1,b1,b2,c1,s1,staff,res,nocomp,neg,jan1,nul,oth,othm = 13
    expect(d.totals.all).toBe(13);
    expect(d.started).toBe(13);
  });
  test('pending and disabled excluded; pending counted separately', function () {
    expect(d.pendingCount).toBe(1);
  });
  test('activeNow is unwindowed primary+secondary', function () {
    // fut, dec31, jan1, nul, oth, othm
    expect(d.activeNow).toBe(6);
  });
  test('byType has all five keys', function () {
    expect(Object.keys(d.totals.byType).sort()).toEqual(FIVE.slice().sort());
    expect(d.totals.byType.wine).toBe(4); // w1, staff, nocomp, jan1 (dec31 is outside ytd)
    expect(d.totals.byType.cider).toBe(2); // c1 + NULL-typed with schedule_category
  });
  test('completedTotals by completion day in window', function () {
    expect(d.completedTotals.all).toBe(8); // 7 valid + neg
    expect(d.completed).toBe(8);
  });
  test('cycle median, mean, n, excluded (staff and research counted)', function () {
    expect(d.cycle.n).toBe(7);
    expect(d.cycle.excluded).toBe(2);
    expect(d.cycle.median).toBe(30);
    expect(d.cycle.mean).toBe(28);
  });
  test('cycle.byType lists only types with n > 0', function () {
    expect(Object.keys(d.cycle.byType).sort()).toEqual(['beer', 'cider', 'seltzer', 'wine']);
    expect(d.cycle.byType.other).toBeUndefined();
    expect(d.cycle.byType.beer.n).toBe(3);
  });
  test('monthBuckets: six months ending at asOf month, keyed and labelled', function () {
    expect(d.monthBuckets.map(function (m) { return m.key; })).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    expect(d.monthBuckets[0].label).toBe('May');
    expect(d.monthBuckets[5].label).toBe('Oct');
  });
  test('monthBuckets exclude future start dates and pending/disabled', function () {
    var oct = d.monthBuckets[5];
    expect(oct.total).toBe(3); // nul, oth, othm (fut is after today)
    expect(oct.counts.cider).toBe(1);
  });
  test('monthBuckets are independent of the window filter', function () {
    var a = bp.getDashboardData(fixture(), ASOF, { window: '30d' });
    var b = bp.getDashboardData(fixture(), ASOF, { window: 'all' });
    expect(a.monthBuckets).toEqual(b.monthBuckets);
    expect(a.monthBuckets).toEqual(d.monthBuckets);
  });
  test('needsType: effective other, not manual, not disabled', function () {
    var ids = d.needsType.map(function (r) { return r.batch_id; });
    expect(ids).toEqual(['oth']);
  });
  test('type filter wine restricts all figures', function () {
    var w = bp.getDashboardData(fixture(), ASOF, { type: 'wine' });
    expect(w.totals.all).toBe(w.totals.byType.wine);
    expect(w.totals.byType.beer).toBe(0);
    expect(w.cycle.n).toBe(2); // w1 + staff
    expect(w.cycle.byType.beer).toBeUndefined();
    w.monthBuckets.forEach(function (m) { expect(m.counts.beer).toBe(0); });
  });
  test('cycle window defaults to ytd and filters on completion day', function () {
    var rows = [row({ batch_type: 'beer', start_date: '2025-11-01', completed_day: '2026-01-10' }),
      row({ batch_type: 'beer', start_date: '2025-10-01', completed_day: '2025-12-20' })];
    var r = bp.getDashboardData(rows, ASOF, {});
    expect(r.cycle.n).toBe(1);
    expect(r.cycle.median).toBe(70);
  });
  test('empty input yields zeros and null cycle stats', function () {
    var e = bp.getDashboardData([], ASOF, {});
    expect(e.totals.all).toBe(0);
    expect(e.cycle.median).toBeNull();
    expect(e.cycle.mean).toBeNull();
    expect(e.monthBuckets.length).toBe(6);
  });
  test('Dec 31 / Jan 1 pair splits across the ytd boundary', function () {
    var ytd = bp.getDashboardData(fixture(), ASOF, { window: 'ytd' });
    var all = bp.getDashboardData(fixture(), ASOF, { window: 'all' });
    expect(all.totals.all - ytd.totals.all).toBe(1);
  });

  describe('invariants', function () {
    WINDOWS.forEach(function (win) {
      TYPES.forEach(function (typ) {
        test('sum(byType) === all for ' + win + '/' + typ, function () {
          var r = bp.getDashboardData(fixture(), ASOF, { window: win, type: typ });
          var s = 0, c = 0;
          FIVE.forEach(function (t) { s += r.totals.byType[t]; c += r.completedTotals.byType[t]; });
          expect(s).toBe(r.totals.all);
          expect(c).toBe(r.completedTotals.all);
        });
        test('month buckets equal started set for ' + win + '/' + typ, function () {
          var rows = fixture();
          var r = bp.getDashboardData(rows, ASOF, { window: win, type: typ });
          var keys = r.monthBuckets.map(function (m) { return m.key; });
          var expected = rows.filter(function (x) {
            if (x.status !== 'primary' && x.status !== 'secondary' && x.status !== 'complete') return false;
            if (!x.start_date || x.start_date > ASOF.today) return false;
            if (typ !== 'all' && bp.effectiveBatchType(x) !== typ) return false;
            return keys.indexOf(x.start_date.slice(0, 7)) !== -1;
          }).length;
          var got = 0;
          r.monthBuckets.forEach(function (m) { got += m.total; });
          expect(got).toBe(expected);
        });
      });
    });
  });

  describe('clock independence (B1)', function () {
    afterEach(function () { jest.useRealTimers(); });
    test('same rows and asOf give identical results at different wall-clock instants', function () {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-10-23T12:00:00Z'));
      var a = bp.getDashboardData(fixture(), ASOF, {});
      jest.setSystemTime(new Date('2027-03-01T12:00:00Z'));
      var b = bp.getDashboardData(fixture(), ASOF, {});
      expect(b).toEqual(a);
    });
    test('Date.now spy at two instants gives the same result', function () {
      var spy = jest.spyOn(Date, 'now');
      spy.mockReturnValue(Date.parse('2026-10-23T12:00:00Z'));
      var a = bp.getDashboardData(fixture(), ASOF, {});
      spy.mockReturnValue(Date.parse('2027-03-01T12:00:00Z'));
      var b = bp.getDashboardData(fixture(), ASOF, {});
      spy.mockRestore();
      expect(b).toEqual(a);
    });
  });

  test('independent naive recompute matches median and mean within 1 day (D-13)', function () {
    var spans = [];
    fixture().forEach(function (x) {
      if (x.status === 'complete' && x.start_date && x.completed_day && x.completed_day >= '2026-01-01' && x.completed_day <= ASOF.today) {
        var ms = Date.parse(x.completed_day + 'T00:00:00Z') - Date.parse(x.start_date + 'T00:00:00Z');
        var days = Math.round(ms / 86400000);
        if (days >= 0) spans.push(days);
      }
    });
    spans.sort(function (p, q) { return p - q; });
    var mid = Math.floor(spans.length / 2);
    var med = spans.length % 2 ? spans[mid] : (spans[mid - 1] + spans[mid]) / 2;
    var mean = spans.reduce(function (p, q) { return p + q; }, 0) / spans.length;
    expect(Math.abs(d.cycle.median - med)).toBeLessThanOrEqual(1);
    expect(Math.abs(d.cycle.mean - mean)).toBeLessThanOrEqual(1);
  });
});

describe('filterBatchesByNeedsType', function () {
  test('returns effective-other, non-manual batches using overlay', function () {
    var batches = [
      { batch_id: 'a', status: 'primary' },
      { batch_id: 'b', status: 'primary' },
      { batch_id: 'c', status: 'primary' },
      { batch_id: 'd', status: 'disabled' }
    ];
    var typeById = {
      b: { batch_type: 'wine', batch_type_source: 'auto' },
      c: { batch_type: 'other', batch_type_source: 'manual' }
    };
    var out = bp.filterBatchesByNeedsType(batches, typeById, {});
    expect(out.map(function (x) { return x.batch_id; })).toEqual(['a']);
  });
  test('null input gives []', function () {
    expect(bp.filterBatchesByNeedsType(null, {}, {})).toEqual([]);
  });
});
