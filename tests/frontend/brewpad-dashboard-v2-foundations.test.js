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

describe('chart() Phase 96 extensions', function () {
  function makeFake() {
    function F(canvas, config) { this.canvas = canvas; this.config = config; this.destroyed = false; F.instances.push(this); }
    F.instances = [];
    F.hits = {};
    F.prototype.destroy = function () { this.destroyed = true; };
    F.prototype.getElementsAtEventForMode = function (evt, mode) { return F.hits[mode] || []; };
    F.getChart = function (c) {
      for (var i = F.instances.length - 1; i >= 0; i--) { if (F.instances[i].canvas === c && !F.instances[i].destroyed) return F.instances[i]; }
      return undefined;
    };
    F.defaults = { font: {} };
    return F;
  }
  var Fake;
  beforeEach(function () {
    Fake = makeFake();
    window.Chart = Fake;
    bp._resetChartJsForTest();
    window.matchMedia = function () { return { matches: false }; };
  });
  function make(over) {
    var c = { type: 'bar', labels: ['a', 'b'], series: [{ key: 'x', label: 'X', data: [1, 2], colour: '#000' }, { key: 'available', label: 'Av', data: [3, 4], colour: '#111' }], measure: 'batches', ariaLabel: 'A' };
    for (var k in over) c[k] = over[k];
    bp.chart(document.createElement('canvas'), c);
    return Fake.instances[Fake.instances.length - 1].config;
  }
  function label(conf, val) {
    return conf.options.plugins.tooltip.callbacks.label({ dataset: { label: 'S' }, parsed: { y: val }, label: 'a' });
  }

  test('units in tooltips', function () {
    expect(label(make({ unit: 'tasks' }), 7)).toBe('S: 7 tasks');
    expect(label(make({ unit: 'tasks' }), 1)).toBe('S: 1 task');
    expect(label(make({ unit: 'vessels' }), 1)).toBe('S: 1 vessel');
    expect(label(make({ unit: 'vessels' }), 3)).toBe('S: 3 vessels');
    expect(label(make({ unit: 'days' }), 12)).toBe('S: 12 d');
    expect(label(make({ unit: 'plato' }), 12.5)).toBe('S: 12.5 °P');
    expect(label(make({ unit: 'percent' }), 42.5)).toBe('S: 42.5%');
  });
  test('default tooltip unchanged and overrides honoured', function () {
    expect(label(make({}), 2)).toBe('S: 2 batches');
    var conf = make({ tooltipLabel: function () { return 'custom'; }, tooltipFooter: function () { return 'foot'; } });
    expect(label(conf, 2)).toBe('custom');
    expect(conf.options.plugins.tooltip.callbacks.footer([])).toBe('foot');
  });
  test('percent axis and titles', function () {
    var conf = make({ percent: true, xTitle: 'Week', yTitle: 'Share' });
    expect(conf.options.scales.y.max).toBe(100);
    expect(conf.options.scales.y.ticks.callback(50)).toBe('50%');
    expect(conf.options.scales.x.title.text).toBe('Week');
    expect(conf.options.scales.y.title.font.size).toBe(12);
    var h = make({ percent: true, horizontal: true });
    expect(h.options.scales.x.max).toBe(100);
  });
  test('no plugins by default', function () {
    expect(make({}).plugins).toEqual([]);
  });
  test('dashDataLabels plugin draws at bar ends', function () {
    var conf = make({ dataLabels: function (i) { return 'L' + i; } });
    var p = conf.plugins.filter(function (x) { return x.id === 'dashDataLabels'; })[0];
    expect(p).toBeDefined();
    var calls = [];
    var ctx = { save: function () {}, restore: function () {}, fillText: function (t, x, y) { calls.push([t, x, y]); } };
    p.afterDatasetsDraw({
      ctx: ctx,
      data: { datasets: [{}] },
      getDatasetMeta: function () { return { data: [{ x: 10, y: 20 }, { x: 30, y: 40 }] }; }
    });
    expect(calls.length).toBe(2);
    expect(calls[0][0]).toBe('L0');
  });
  test('dashVLines plugin draws dashed lines with stacked labels', function () {
    var conf = make({ vLines: [{ value: 3, colour: '#f00', label: 'one' }, { value: 5, label: 'two' }] });
    var p = conf.plugins.filter(function (x) { return x.id === 'dashVLines'; })[0];
    expect(p).toBeDefined();
    var dashes = [];
    var texts = [];
    var ctx = {
      save: function () {}, restore: function () {}, beginPath: function () {}, moveTo: function () {}, lineTo: function () {}, stroke: function () {},
      setLineDash: function (d) { dashes.push(d); },
      fillText: function (t, x, y) { texts.push([t, x, y]); }
    };
    p.afterDatasetsDraw({ ctx: ctx, chartArea: { top: 10, bottom: 100 }, scales: { x: { getPixelForValue: function (v) { return v * 10; } } } });
    expect(dashes[0]).toEqual([6, 4]);
    expect(texts[0][2]).toBe(10);
    expect(texts[1][2]).toBe(22);
  });
  test('linear x and per-series line props', function () {
    var conf = make({
      type: 'line', xType: 'linear',
      series: [{ key: 's', label: 'S', data: [{ x: 1, y: 2 }], colour: '#000', borderDash: [4, 4], pointRadius: 0, borderWidth: 1, fill: false, showLine: true }]
    });
    expect(conf.options.scales.x.type).toBe('linear');
    var ds = conf.data.datasets[0];
    expect(ds.borderDash).toEqual([4, 4]);
    expect(ds.pointRadius).toBe(0);
    expect(ds.borderWidth).toBe(1);
    expect(ds.fill).toBe(false);
    expect(ds.showLine).toBe(true);
    expect(ds.data[0]).toEqual({ x: 1, y: 2 });
  });
  test('inert series and datasetIndex on click', function () {
    var onClick = jest.fn();
    var conf = make({ onClick: onClick, inertKeys: ['available'], hitDatasetIndex: true });
    var inst = Fake.instances[Fake.instances.length - 1];
    Fake.hits.nearest = [{ index: 1, datasetIndex: 1 }];
    conf.options.onClick({}, [], inst);
    expect(onClick).not.toHaveBeenCalled();
    Fake.hits.nearest = [{ index: 1, datasetIndex: 0 }];
    conf.options.onClick({}, [], inst);
    expect(onClick).toHaveBeenCalledWith({ index: 1, key: 'x', datasetIndex: 0 });
    Fake.hits.nearest = [];
    Fake.hits.index = [{ index: 0 }];
    conf.options.onClick({}, [], inst);
    expect(onClick).toHaveBeenLastCalledWith({ index: 0, key: null, datasetIndex: null });
  });
  test('theme exposes category tokens with fallbacks', function () {
    var t = bp.readChartTheme();
    expect(t.cat1).toBe('#3f6670');
    expect(t.cat6).toBe(t.other);
    expect(t.inkPrimary).toBeTruthy();
    expect(t.ledgerLine).toBeTruthy();
  });

  // Staging UAT 2026-10-29 (Chrome pass): fixes found on staging.
  test('horizontal bar-end labels get right padding so they are not clipped', function () {
    var texts = ['18 of 140', '13 of 59'];
    var conf = make({ horizontal: true, dataLabels: function (i) { return texts[i]; } });
    expect(conf.options.layout.padding.right).toBeGreaterThanOrEqual(9 * 6);
    var v = make({ dataLabels: function () { return '5'; } });
    expect(v.options.layout.padding.top).toBeGreaterThanOrEqual(12);
    expect(make({}).options.layout).toBeUndefined();
  });
  test('labelMaxChars truncates long category ticks with an ellipsis', function () {
    var cb = make({ horizontal: true, labelMaxChars: 10 }).options.scales.y.ticks.callback;
    expect(cb.call({ getLabelForValue: function () { return 'Short'; } }, 0)).toBe('Short');
    expect(cb.call({ getLabelForValue: function () { return 'A very long product name'; } }, 0)).toBe('A very lo…');
  });
  test('vertical-line labels sit on a background so the dashed lines never cross the text', function () {
    var conf = make({ vLines: [{ value: 3, label: 'Planned 35 d' }] });
    var p = conf.plugins.filter(function (x) { return x.id === 'dashVLines'; })[0];
    var rects = [];
    var ctx = {
      save: function () {}, restore: function () {}, beginPath: function () {}, moveTo: function () {}, lineTo: function () {}, stroke: function () {},
      setLineDash: function () {}, fillText: function () {},
      measureText: function () { return { width: 60 }; },
      fillRect: function (x, y, w, h) { rects.push([x, y, w, h]); }
    };
    p.afterDatasetsDraw({ ctx: ctx, chartArea: { top: 10, bottom: 100, right: 400 }, scales: { x: { getPixelForValue: function (v) { return v * 10; } } } });
    expect(rects.length).toBe(1);
    expect(rects[0][2]).toBeGreaterThanOrEqual(60);
  });
  test('Show all is a styled text button', function () {
    var items = [1, 2, 3, 4, 5, 6].map(function (n) { return { primary: 'B' + n, right: '', drill: n }; });
    expect(bp.dashListHtml('g6', 'x', items, { limit: 5 })).toContain('bp-text-btn');
  });
});
