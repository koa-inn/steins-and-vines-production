'use strict';

// Phase 96-03: shared dashboard helpers (pure data + markup) and chart() extensions.

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
    start_date: null, completed_day: null, vessel_id: null, source: 'kiosk',
    product_sku: '', schedule_category: '', target_volume_l: null, staff_batch: false
  };
  for (var k in o) { if (Object.prototype.hasOwnProperty.call(o, k)) base[k] = o[k]; }
  return base;
}

describe('dashDrillSubject', function () {
  test('plural, singular, raw subject', function () {
    expect(bp.dashDrillSubject('Beer at Secondary', 6)).toBe('From dashboard: Beer at Secondary · 6 batches');
    expect(bp.dashDrillSubject('Beer at Secondary', 1)).toBe('From dashboard: Beer at Secondary · 1 batch');
    expect(bp.dashDrillSubject('<b>x</b>', 2)).toBe('From dashboard: <b>x</b> · 2 batches');
  });
});

describe('dashClassifyRows', function () {
  var rows = [
    row({ batch_id: 'a', status: 'Primary', batch_type: 'beer', source: 'kiosk' }),
    row({ batch_id: 'b', status: 'secondary', batch_type: 'wine', source: 'kiosk_recipe' }),
    row({ batch_id: 'c', status: 'complete', batch_type: 'cider', source: 'online' }),
    row({ batch_id: 'W3', status: 'primary', batch_type: 'beer', source: 'manual' }),
    null
  ];
  test('keeps all non-null rows by default with lower-cased status', function () {
    var r = bp.dashClassifyRows(rows, { type: 'all', source: 'all' });
    expect(r.list.length).toBe(4);
    expect(r.byId.a.status).toBe('primary');
    expect(r.byId.a.type).toBe('beer');
    expect(r.byId.a.staff).toBe(false);
  });
  test('type and source filters', function () {
    expect(bp.dashClassifyRows(rows, { type: 'beer' }).list.length).toBe(2);
    var k = bp.dashClassifyRows(rows, { source: 'kiosk' }).list.map(function (i) { return i.row.batch_id; });
    expect(k.sort()).toEqual(['a', 'b']);
  });
  test('staff handling', function () {
    var drop = bp.dashClassifyRows(rows, { staff: false, staffIds: { W3: true } });
    expect(drop.byId.W3).toBeUndefined();
    var keep = bp.dashClassifyRows(rows, { staffIds: { W3: true } });
    expect(keep.byId.W3.staff).toBe(true);
  });
  test('active count agrees with getDashboardData activeNow', function () {
    var fx = [];
    var statuses = ['primary', 'secondary', 'complete', 'pending'];
    var sources = ['kiosk', 'kiosk_recipe', 'online', 'manual', null];
    for (var i = 0; i < 60; i++) {
      fx.push(row({ status: statuses[i % 4], batch_type: FIVE[i % 5], source: sources[i % 5], start_date: '2026-09-01' }));
    }
    ['all', 'beer', 'wine'].forEach(function (t) {
      ['all', 'kiosk', 'online'].forEach(function (s) {
        var d = bp.getDashboardData(fx, ASOF, { window: 'ytd', type: t, source: s });
        var n = bp.dashClassifyRows(fx, { type: t, source: s }).list.filter(function (it) {
          return it.status === 'primary' || it.status === 'secondary';
        }).length;
        expect(n).toBe(d.activeNow);
      });
    });
  });
});

describe('dashTaskKind', function () {
  test('classifies', function () {
    expect(bp.dashTaskKind({ is_packaging: true, title: 'Keg' })).toBe('packaging');
    expect(bp.dashTaskKind({ is_transfer: true })).toBe('transfer');
    expect(bp.dashTaskKind({ title: 'Racking and Stabilization' })).toBe('transfer');
    expect(bp.dashTaskKind({ title: 'Bottling/Packaging' })).toBe('packaging');
    expect(bp.dashTaskKind({ title: 'Filtering' })).toBe('filtering');
    expect(bp.dashTaskKind({ title: 'Lower to 10ºC' })).toBe('temp');
    expect(bp.dashTaskKind({ title: 'Crash to 0ºC' })).toBe('temp');
    expect(bp.dashTaskKind({ title: 'Raise to 20°C' })).toBe('temp');
    ['Batch Start', 'Plunge Skins', 'Keg', 'Carbonate', 'Dry hop', ''].forEach(function (t) {
      expect(bp.dashTaskKind({ title: t })).toBe('other');
    });
  });
  test('DASH_TASK_KINDS order and labels', function () {
    expect(bp.DASH_TASK_KINDS.map(function (k) { return k.key + ':' + k.label; })).toEqual([
      'transfer:Racking / transfer', 'filtering:Filtering', 'packaging:Packaging',
      'temp:Temperature step', 'other:Other'
    ]);
  });
});

describe('dashBreakdownBuckets', function () {
  function items(vals) {
    return vals.map(function (v, i) { return { row: { batch_id: 'i' + i }, v: v }; });
  }
  var val = function (it) { return it.v; };
  test('sorts, puts Unspecified last, preserves total', function () {
    var b = bp.dashBreakdownBuckets(items(['B', 'A', 'A', '', null, ' B ', 'C']), val, 10);
    expect(b.map(function (x) { return x.label + ':' + x.count; })).toEqual(['A:2', 'B:2', 'C:1', 'Unspecified:2']);
    var total = b.reduce(function (s, x) { return s + x.count; }, 0);
    expect(total).toBe(7);
  });
  test('rolls the tail into Other (n more) before Unspecified', function () {
    var b = bp.dashBreakdownBuckets(items(['a', 'a', 'a', 'b', 'b', 'c', 'd', '']), val, 2);
    expect(b.map(function (x) { return x.label + ':' + x.count; })).toEqual(['a:3', 'b:2', 'Other (2 more):2', 'Unspecified:1']);
    expect(b[2].ids.length).toBe(2);
  });
  test('litres summed', function () {
    var b = bp.dashBreakdownBuckets(items(['a', 'a']), val, 5, function () { return 10; });
    expect(b[0].litres).toBe(20);
  });
});

describe('markup helpers', function () {
  test('dashSegHtml', function () {
    var h = bp.dashSegHtml('g1', 'mode', [['started', 'Started'], ['completed', 'Completed']], 'started', 'Production measure');
    expect(h).toContain('role="radiogroup" aria-label="Production measure"');
    expect(h).toContain('data-dash-w="g1:mode:started"');
    expect(h).toContain('aria-checked="true"');
    expect(h).toContain('aria-checked="false"');
    expect(h.match(/tabindex="0"/g).length).toBe(1);
    expect(h).not.toContain('data-dash-ctl');
  });
  test('dashSelectHtml escapes and selects', function () {
    var h = bp.dashSelectHtml('g3', 'product', [['a', 'A <b>'], ['b', 'B']], 'b', 'Product');
    expect(h).toContain('data-dash-wsel="g3:product"');
    expect(h).toContain('aria-label="Product"');
    expect(h).toContain('A &lt;b&gt;');
    expect(h).toContain('<option value="b" selected>');
  });
  test('dashViewToggleHtml', function () {
    var h = bp.dashViewToggleHtml('g1', 'table');
    expect(h).toContain('aria-label="View as"');
    expect(h).toContain('data-dash-w="g1:view:chart"');
    expect(h).toContain('data-dash-w="g1:view:table"');
  });
  test('dashTableHtml renders, drills and escapes', function () {
    var h = bp.dashTableHtml('g1', {
      caption: 'Cap',
      columns: [{ label: 'Name' }, { label: 'N', numeric: true }],
      rows: [
        { cells: [{ text: '<img src=x onerror=alert(1)>', drill: 2 }, { text: '3' }] },
        { total: true, cells: [{ text: 'Total' }, { text: '3' }] }
      ]
    });
    expect(h).toContain('<th scope="col">Name</th>');
    expect(h).toContain('<td class="bp-num">3</td>');
    expect(h).toContain('<button type="button" class="bp-table-link" data-dash-row="g1:2">');
    expect(h).toContain('class="bp-table-total"');
    expect(h).not.toContain('<img');
    expect(h).toContain('&lt;img');
  });
  test('dashListHtml', function () {
    expect(bp.dashListHtml('g6', 'shared', [], { emptyText: 'Nothing' })).toContain('<p class="bp-empty">Nothing</p>');
    var items = [];
    for (var i = 0; i < 7; i++) items.push({ primary: 'P' + i, secondary: i === 0 ? 'sub' : '', right: 'R', drill: i === 6 ? null : i });
    var h = bp.dashListHtml('g6', 'shared', items, { limit: 5, expanded: false });
    expect((h.match(/class="bp-list-row"/g) || []).length).toBe(5);
    expect(h).toContain('data-dash-row="g6:0"');
    expect(h).toContain('data-dash-showall="g6:shared" aria-expanded="false">Show all 7');
    var ex = bp.dashListHtml('g6', 'shared', items, { limit: 5, expanded: true });
    expect((ex.match(/bp-list-row"/g) || []).length).toBe(7);
    expect(ex).toContain('aria-expanded="true"');
    expect(ex).toContain('<div class="bp-list-row">');
    var few = bp.dashListHtml('g6', 'shared', items.slice(0, 3), { limit: 5 });
    expect(few).not.toContain('data-dash-showall');
    var xss = bp.dashListHtml('g6', 'x', [{ primary: '<script>x</script>', right: '&' , drill: 1}], {});
    expect(xss).not.toContain('<script>');
  });
});
