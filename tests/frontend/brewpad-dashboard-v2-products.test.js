'use strict';

// Phase 96-06: G4 Products (+ Top 10) and G9 Source mix.

global.google = { accounts: { oauth2: { initTokenClient: jest.fn() } } };
global.fetch = jest.fn(function () {
  return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ ok: true, data: {} }); } });
});
var _ssData = {};
global.sessionStorage = {
  getItem: function (k) { return _ssData[k] !== undefined ? _ssData[k] : null; },
  setItem: function (k, v) { _ssData[k] = v; },
  removeItem: function (k) { delete _ssData[k]; },
  clear: function () { _ssData = {}; }
};

var _auth = require('../../js/lib/auth');
global.waitForGoogleIdentity = _auth.waitForGoogleIdentity;
global.gsiInitTokenClient = _auth.gsiInitTokenClient;
global.fetchGoogleUserInfo = _auth.fetchGoogleUserInfo;

var bp = require('../../js/brewpad');

var TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' });
var YEAR = +TODAY.slice(0, 4);
var ASOF = { today: TODAY, year: YEAR, tz: 'America/Vancouver' };

function flush() { return new Promise(function (r) { setTimeout(r, 0); }); }

function lean(id, type, start, extra) {
  return Object.assign({
    batch_id: id, status: 'primary', batch_type: type, batch_type_source: 'recipe',
    start_date: start, completed_day: null, completed_at: null, completed_at_source: null,
    vessel_id: null, source: 'kiosk', product_sku: '', product_name: id, product_subcategory: '',
    product_brand: '', product_manufacturer: '', recipe_id: '', schedule_id: '',
    schedule_category: '', target_volume_l: 20, tasks_total: 0, tasks_done: 0
  }, extra || {});
}

function fixture() {
  return [
    lean('W1', 'wine', YEAR + '-01-05', { product_sku: 'S1', product_subcategory: 'Red', product_brand: 'Vintner', recipe_id: 'R-W1', product_name: 'Merlot' }),
    lean('W2', 'wine', YEAR + '-01-20', { product_sku: 'S1', product_subcategory: 'Red', source: 'online', recipe_id: 'R-W1', product_name: 'Merlot' }),
    lean('W3', 'wine', YEAR + '-02-02', { product_sku: 'S2', product_subcategory: 'White', source: 'kiosk_recipe', recipe_id: 'R-W2', product_name: 'Pinot' }),
    lean('W4', 'wine', YEAR + '-02-09', { product_sku: 'S1', product_subcategory: 'Red', staff_batch: true, source: 'internal', recipe_id: 'R-W1', product_name: 'Merlot' }),
    lean('B1', 'beer', YEAR + '-01-10', { source: 'manual', recipe_id: 'R-B1', product_name: 'Pale' }),
    lean('B2', 'beer', YEAR + '-02-12', { source: '', recipe_id: 'R-B2', product_name: 'Stout' }),
    lean('C1', 'cider', YEAR + '-02-03', { source: 'zoho_scan', recipe_id: 'R-C1', product_name: 'Dry' }),
    lean('S1', 'seltzer', YEAR + '-02-04', { source: 'research' }),
    lean('P1', 'wine', (YEAR - 1) + '-01-10', { product_sku: 'S1', product_subcategory: 'Red' })
  ];
}

var META = {
  B1: { batch_id: 'B1', recipe_name: 'Pale Ale', recipe_style: 'IPA' },
  B2: { batch_id: 'B2', recipe_name: 'Stout Deluxe', recipe_style: '' },
  C1: { batch_id: 'C1', recipe_name: 'Dry Cider', recipe_style: '' },
  W1: { batch_id: 'W1', recipe_name: 'Merlot Recipe' }
};
var META_LIST = Object.keys(META).map(function (k) { return META[k]; });
var LOOKUP = { S1: { subcategory: 'Red', brand: 'Vintner', manufacturer: 'Acme' }, S2: { subcategory: 'White' } };

function mdl(rowsIn, over) {
  var st = Object.assign({}, bp.DASH_FILTER_DEFAULTS, over || {});
  return bp.buildDashV2Model(rowsIn, ASOF, st, {}, {});
}
function g4(over, c, rowsIn) {
  var list = rowsIn || fixture();
  var m = mdl(list, over);
  return { m: m, g: bp.buildG4Model(list, m, Object.assign({ lookup: LOOKUP, metaById: META }, c || {})) };
}
function sum(a) { return a.reduce(function (x, y) { return x + y; }, 0); }

describe('dashSourceCat', function () {
  test('maps sources to the six categories', function () {
    expect(bp.dashSourceCat('kiosk')).toBe('kiosk');
    expect(bp.dashSourceCat('kiosk_recipe')).toBe('kiosk');
    expect(bp.dashSourceCat('online')).toBe('online');
    expect(bp.dashSourceCat('manual')).toBe('manual');
    expect(bp.dashSourceCat('zoho_scan')).toBe('zoho_scan');
    expect(bp.dashSourceCat('')).toBe('unknown');
    expect(bp.dashSourceCat(null)).toBe('unknown');
    expect(bp.dashSourceCat('research')).toBe('other');
    expect(bp.dashSourceCat('internal')).toBe('other');
    expect(bp.DASH_SOURCE_CATS.map(function (c) { return c[1]; })).toEqual(['Kiosk', 'Online', 'Manual', 'Zoho scan', 'Other', 'Unknown']);
  });
});

describe('buildG4Model', function () {
  test('wine by subcategory, staff hidden by default, drill subject and note', function () {
    var r = g4({});
    expect(r.g.type).toBe('wine');
    expect(r.g.showTypeSeg).toBe(true);
    expect(r.g.labels).toEqual(['Red', 'White']);
    expect(r.g.series[0].data).toEqual([2, 1]);
    expect(r.g.staffHidden).toBe(1);
    expect(r.g.subtitle).toBe('Wine by subcategory · started YTD · Staff batches hidden');
    expect(r.g.subjectFor('Red')).toBe('Wine, Subcategory Red');
    expect(r.g.dims.map(function (d) { return d[1]; })).toEqual(['Subcategory', 'Brand', 'Manufacturer']);
  });

  test('staff included equals the Started tile for that type, and the note says so', function () {
    var r = g4({ staff: '1' });
    expect(r.g.total).toBe(r.m.cur.ids.startedByType.wine.length);
    expect(r.g.subtitle).toContain('Including staff batches');
    ['beer', 'cider'].forEach(function (t) {
      var x = g4({ staff: '1', type: t });
      expect(x.g.total).toBe(x.m.cur.ids.startedByType[t].length);
      expect(x.g.showTypeSeg).toBe(false);
    });
  });

  test('wine brand / manufacturer come from the merged lookup; blank is Unspecified last', function () {
    var b = g4({}, { dim: 'brand' });
    expect(b.g.labels).toEqual(['Vintner', 'Unspecified']);
    var mf = g4({}, { dim: 'manufacturer' });
    expect(mf.g.labels).toEqual(['Acme', 'Unspecified']);
    expect(mf.g.buckets[1].ids).toEqual(['W3']);
  });

  test('beer style and recipe, cider recipe, via batch meta', function () {
    var style = g4({ type: 'beer', staff: '1' });
    expect(style.g.dim).toBe('style');
    expect(style.g.labels).toEqual(['IPA', 'Unspecified']);
    var rec = g4({ type: 'beer' }, { dim: 'recipe' });
    expect(rec.g.labels).toEqual(['Pale Ale', 'Stout Deluxe']);
    var cid = g4({ type: 'cider' });
    expect(cid.g.labels).toEqual(['Dry Cider']);
    expect(cid.g.dims.length).toBe(1);
  });

  test('Type segment picks the type under global All; invalid choices fall back', function () {
    expect(g4({}, { type: 'beer', dim: 'style' }).g.type).toBe('beer');
    expect(g4({}, { type: 'beer', dim: 'brand' }).g.dim).toBe('style');
    expect(g4({}, { type: 'bogus' }).g.type).toBe('wine');
  });

  test('seltzer / other global types are empty', function () {
    var r = g4({ type: 'seltzer' });
    expect(r.g.type).toBeNull();
    expect(r.g.empty).toBe(true);
  });

  test('litres measure ranks by litres; more than 12 buckets roll up', function () {
    var list = fixture();
    for (var i = 0; i < 14; i++) {
      list.push(lean('X' + i, 'wine', YEAR + '-01-15', { product_sku: 'K' + i }));
    }
    var lk = {};
    for (var j = 0; j < 14; j++) lk['K' + j] = { subcategory: 'Sub' + (j < 10 ? '0' + j : j) };
    var r = g4({}, { lookup: Object.assign({}, LOOKUP, lk) }, list);
    expect(r.g.labels.length).toBe(13);
    expect(r.g.labels[12]).toMatch(/^Other \(\d+ more\)$/);
    expect(r.g.total).toBe(r.m.cur.ids.startedByType.wine.length - 1);
    var l = g4({ measure: 'litres' });
    expect(l.g.measure).toBe('litres');
    expect(l.g.subtitle).toContain(' · litres');
    expect(l.g.series[0].data).toEqual([40, 20]);
  });

  test('table numbers equal the chart dataset; share sums to about 100', function () {
    var r = g4({});
    var rows = r.g.table.rows;
    rows.forEach(function (row, i) { expect(+row.cells[1].text).toBe(r.g.series[0].data[i]); });
    expect(rows[0].cells[3].text).toBe('66.7%');
    expect(r.g.table.columns.map(function (c) { return c.label; })).toEqual(['Name', 'Batches', 'Litres', 'Share']);
  });
});

describe('buildTop10Model', function () {
  function t10(over, rowsIn) {
    var list = rowsIn || fixture();
    var m = mdl(list, over);
    return bp.buildTop10Model(list, m, { metaById: META });
  }

  test('ranks products across types by recipe or SKU, prefixed, staff hidden', function () {
    var t = t10({});
    expect(t.entries[0].label).toBe('Merlot Recipe');
    expect(t.entries[0].count).toBe(2);
    expect(t.labels[0]).toBe('1. Merlot Recipe');
    expect(t.labels.length).toBeLessThanOrEqual(10);
    // ties alphabetical after the leader
    var rest = t.entries.slice(1).map(function (e) { return e.label; });
    expect(rest).toEqual(rest.slice().sort());
    expect(t10({ staff: '1' }).entries[0].count).toBe(3);
  });

  test('rows with neither recipe nor SKU are skipped; single type narrows', function () {
    var t = t10({ type: 'cider' });
    expect(t.entries.map(function (e) { return e.label; })).toEqual(['Dry Cider']);
    expect(t.series[0].key).toBe('cider');
    var all = t10({});
    expect(all.entries.some(function (e) { return e.ids.indexOf('S1') !== -1; })).toBe(false);
  });

  test('capped at 10 and table rows carry drill subjects', function () {
    var list = fixture();
    for (var i = 0; i < 15; i++) list.push(lean('Y' + i, 'beer', YEAR + '-01-15', { recipe_id: 'RY' + i, product_name: 'Prod ' + i }));
    var t = t10({}, list);
    expect(t.entries.length).toBe(10);
    expect(t.labels[9].indexOf('10. ')).toBe(0);
    expect(t.table.rows[0].cells[1].subject).toBe('Top product ' + t.entries[0].label);
    expect(t.table.columns.map(function (c) { return c.label; })).toEqual(['Rank', 'Product', 'Type', 'Batches', 'Litres']);
  });
});

describe('buildG9Model', function () {
  function g9(over, mode, rowsIn) {
    var list = rowsIn || fixture();
    var m = mdl(list, over);
    return { m: m, g: bp.buildG9Model(list, m, { mode: mode || 'count', staffIds: {}, catMap: {} }) };
  }
  function seriesOf(g, key) { return g.series.filter(function (s) { return s.key === key; })[0]; }

  test('splits started batches by source category; zero series omitted', function () {
    var r = g9({ staff: '1' });
    var keys = r.g.series.map(function (s) { return s.key; });
    expect(keys).toEqual(['kiosk', 'online', 'manual', 'zoho_scan', 'other', 'unknown']);
    var hidden = g9({});
    expect(hidden.g.series.map(function (s) { return s.key; })).toEqual(['kiosk', 'online', 'manual', 'zoho_scan', 'other', 'unknown']);
    // seltzer S1 (research) lands in Other even without staff; remove it to drop the series
    var noRes = fixture().filter(function (x) { return x.batch_id !== 'S1'; });
    expect(g9({}, 'count', noRes).g.series.map(function (s) { return s.key; })).not.toContain('other');
  });

  test('with staff on, bucket totals equal G1 Started bucket totals', function () {
    var r = g9({ staff: '1' });
    var g1 = bp.buildG1Model(r.m, 'started');
    var totals = r.g.labels.map(function (l, i) { return sum(r.g.series.map(function (s) { return s.data[i]; })); });
    expect(totals).toEqual(g1.totals);
    expect(sum(totals)).toBe(r.m.cur.started);
  });

  test('staff batches hidden by default reduces the totals', function () {
    var on = g9({ staff: '1' });
    var off = g9({});
    expect(sum(off.g.totals)).toBe(sum(on.g.totals) - 1);
    expect(off.g.note).toBe('Staff batches hidden');
    expect(on.g.note).toBe('Including staff batches');
  });

  test('kiosk includes kiosk_recipe; drill subjects and ids', function () {
    var r = g9({ staff: '1' });
    var kiosk = seriesOf(r.g, 'kiosk');
    expect(sum(kiosk.data)).toBe(2);
    var feb = r.m.cur.periodBuckets.map(function (b) { return b.key; }).indexOf(YEAR + '-02');
    expect(r.g.cells[feb][0]).toContain('W3');
    expect(r.g.subjectFor('Kiosk', 'Jun 2026')).toBe('Kiosk batches started in Jun 2026');
  });

  test('share mode: each bucket sums to 100.0 and counts are kept for tooltips', function () {
    var r = g9({ staff: '1' }, 'share');
    expect(r.g.percent).toBe(true);
    r.g.labels.forEach(function (l, i) {
      var s = sum(r.g.series.map(function (x) { return x.data[i]; }));
      if (r.g.totals[i] > 0) expect(Math.abs(s - 100)).toBeLessThan(0.1 + 1e-9);
    });
    expect(r.g.counts.length).toBe(r.g.series.length);
    var cell = r.g.table.rows[0].cells[1].text;
    expect(cell).toMatch(/%$/);
  });

  test('global Source filter leaves one category and says so', function () {
    var r = g9({ source: 'kiosk', staff: '1' });
    expect(r.g.series.map(function (s) { return s.key; })).toEqual(['kiosk']);
    expect(r.g.subtitle).toMatch(/ · Source: Kiosk$/);
  });

  test('table: Period then six sources then Total, numbers equal chart', function () {
    var r = g9({ staff: '1' });
    expect(r.g.table.columns.map(function (c) { return c.label; })).toEqual(['Period', 'Kiosk', 'Online', 'Manual', 'Zoho scan', 'Other', 'Unknown', 'Total']);
    var first = r.g.table.rows[r.g.table.rows.length - 1];
    var i0 = 0;
    r.g.series.forEach(function (s) {
      var col = r.g.table.columns.map(function (c) { return c.label; }).indexOf(s.label);
      expect(+first.cells[col].text).toBe(s.data[i0]);
    });
  });

  test('empty when nothing started', function () {
    expect(g9({ type: 'beer', source: 'online' }).g.empty).toBe(true);
  });
});

describe('renderers', function () {
  var Fake;

  function makeFakeChart() {
    function FakeChart(canvas, config) {
      this.canvas = canvas;
      this.config = config;
      this.destroyed = false;
      FakeChart.instances.push(this);
    }
    FakeChart.instances = [];
    FakeChart.prototype.destroy = function () { this.destroyed = true; };
    FakeChart.prototype.resize = function () {};
    FakeChart.prototype.getElementsAtEventForMode = function () { return []; };
    FakeChart.getChart = function (canvas) {
      for (var i = FakeChart.instances.length - 1; i >= 0; i--) {
        if (FakeChart.instances[i].canvas === canvas && !FakeChart.instances[i].destroyed) return FakeChart.instances[i];
      }
      return null;
    };
    FakeChart.defaults = { font: {} };
    return FakeChart;
  }

  function setUrl(hash) { window.history.replaceState(null, '', '/brewpad.html?dash=v2' + (hash || '')); }

  function mount(list) {
    document.body.innerHTML =
      '<div><button type="button" id="bp-dash-switch" hidden></button></div>' +
      '<div id="bp-dashboard-inner"></div><div id="bp-panel-dashboard"></div>' +
      '<div id="bp-panel-batches"><div id="bp-batch-list-pane"></div></div>' +
      '<div id="bp-batch-detail-pane"></div><div id="bp-toast-container"></div>';
    bp._setStateForTest({
      _allBatchesData: list,
      _dashData: { asOf: ASOF, batches: list, staffBatchIds: [], batchMeta: META_LIST },
      _dashSummary: {},
      _dashWineSkuLookup: LOOKUP
    });
  }

  async function renderV2(hash, list) {
    mount(list || fixture());
    setUrl(hash ? '#' + hash : '');
    bp._initDashV2FlagForTest();
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    bp._renderDashboardForTest();
    await flush();
  }

  async function go(hash) {
    setUrl(hash ? '#' + hash : '');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await flush();
  }

  function canvases(slot) { return document.querySelectorAll('#' + slot + ' canvas'); }
  function chartOf(slot, n) { return Fake.getChart(canvases(slot)[n || 0]); }
  function drill() { return bp.getStateForTest()._dashDrill; }
  function change(sel, val) {
    var el = document.querySelector(sel);
    el.value = val;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  beforeEach(function () {
    window.localStorage.clear();
    Object.keys(bp._dashV2FrameForTest.opts).forEach(function (k) { delete bp._dashV2FrameForTest.opts[k]; });
    bp._resetChartJsForTest();
    Fake = makeFakeChart();
    window.Chart = Fake;
    Array.prototype.forEach.call(document.head.querySelectorAll('script'), function (s) { s.parentNode.removeChild(s); });
  });

  afterEach(function () {
    delete window.Chart;
    window.localStorage.clear();
  });

  test('Products slot: breakdown first canvas, Top 10 second, same widget', async function () {
    await renderV2('');
    expect(document.querySelector('#bp-dash-v2-wine .bp-widget-title').textContent).toBe('Products');
    expect(canvases('bp-dash-v2-wine').length).toBe(2);
    expect(document.querySelector('#bp-dash-v2-wine .bp-g4-subtitle').textContent).toBe('Top 10 products');
    expect(chartOf('bp-dash-v2-wine', 0).config.data.labels).toEqual(['Red', 'White']);
    var top = chartOf('bp-dash-v2-wine', 1);
    expect(top.config.data.labels[0]).toBe('1. Merlot Recipe');
    expect(top.config.data.datasets[0].data[0]).toBe(2);
  });

  test('Type segment and Group by select switch the breakdown without touching global state', async function () {
    await renderV2('');
    document.querySelector('[data-dash-w="g4:type:beer"]').click();
    expect(chartOf('bp-dash-v2-wine', 0).config.data.labels).toEqual(['IPA', 'Unspecified']);
    expect(window.location.hash).not.toContain('type=');
    change('[data-dash-wsel="g4:dim"]', 'recipe');
    expect(chartOf('bp-dash-v2-wine', 0).config.data.labels).toEqual(['Pale Ale', 'Stout Deluxe']);
    expect(drill()).toBeNull();
  });

  test('table view numbers equal the chart dataset (breakdown and Top 10)', async function () {
    await renderV2('');
    var chartData = chartOf('bp-dash-v2-wine', 0).config.data.datasets[0].data.slice();
    var topLabels = chartOf('bp-dash-v2-wine', 1).config.data.labels.slice();
    document.querySelector('[data-dash-w="g4:view:table"]').click();
    document.querySelector('[data-dash-w="g4:tview:table"]').click();
    var tables = document.querySelectorAll('#bp-dash-v2-wine table');
    expect(tables.length).toBe(2);
    var nums = Array.prototype.map.call(tables[0].querySelectorAll('tbody tr'), function (tr) { return +tr.children[1].textContent; });
    expect(nums).toEqual(chartData);
    expect(tables[1].querySelectorAll('tbody tr').length).toBe(topLabels.length);
    expect(tables[1].querySelector('tbody tr td').textContent).toBe('1');
  });

  test('breakdown bar with 2 batches drills with the banner', async function () {
    await renderV2('');
    var c = chartOf('bp-dash-v2-wine', 0);
    Fake.prototype.getElementsAtEventForMode = function (e, mode) { return mode === 'nearest' ? [{ index: 0, datasetIndex: 0 }] : []; };
    c.config.options.onClick({}, [], c);
    expect(drill().label).toBe('From dashboard: Wine, Subcategory Red · 2 batches');
  });

  test('staff toggle switches the note and G4 / G9 totals but not G1', async function () {
    await renderV2('');
    var sub = function () { return document.querySelector('#bp-dash-v2-wine .bp-widget-sub').textContent; };
    var note = function () { return document.querySelector('#bp-dash-v2-source .bp-widget-note').textContent; };
    var g1Before = JSON.stringify(Fake.getChart(document.querySelector('#bp-dash-v2-period canvas')).config.data);
    expect(sub()).toContain('Staff batches hidden');
    expect(note()).toBe('Staff batches hidden');
    await go('staff=1');
    expect(sub()).toContain('Including staff batches');
    expect(note()).toBe('Including staff batches');
    expect(chartOf('bp-dash-v2-wine', 0).config.data.datasets[0].data).toEqual([3, 1]);
    expect(JSON.stringify(Fake.getChart(document.querySelector('#bp-dash-v2-period canvas')).config.data)).toBe(g1Before);
  });

  test('catalog text is escaped in table view and the select', async function () {
    var list = fixture();
    list[0].product_subcategory = '<img src=x onerror=alert(1)>';
    list[0].product_sku = 'SX';
    mount(list);
    await renderV2('', list);
    document.querySelector('[data-dash-w="g4:view:table"]').click();
    expect(document.querySelector('#bp-dash-v2 img')).toBeNull();
    expect(document.querySelector('#bp-dash-v2-wine table').textContent).toContain('<img src=x onerror=alert(1)>');
  });

  test('no matching batches show the empty copy with Reset filters', async function () {
    await renderV2('type=beer&source=online');
    var slot = document.getElementById('bp-dash-v2-wine');
    expect(slot.querySelector('.bp-empty').textContent).toContain('No batches match these filters.');
    expect(slot.querySelector('[data-dash-reset]').textContent).toBe('Reset filters');
    var src = document.getElementById('bp-dash-v2-source');
    expect(src.querySelector('[data-dash-reset]')).not.toBeNull();
  });

  test('Source mix: stacked columns, Count | Share, share percent sums to 100', async function () {
    await renderV2('staff=1');
    expect(document.querySelector('#bp-dash-v2-source .bp-widget-title').textContent).toBe('Source mix');
    var c = chartOf('bp-dash-v2-source');
    expect(c.config.options.scales.x.stacked).toBe(true);
    document.querySelector('[data-dash-w="g9:mode:share"]').click();
    var c2 = chartOf('bp-dash-v2-source');
    c2.config.data.labels.forEach(function (l, i) {
      var s = c2.config.data.datasets.reduce(function (a, d) { return a + d.data[i]; }, 0);
      if (s > 0) expect(Math.abs(s - 100)).toBeLessThan(0.1 + 1e-9);
    });
    expect(c2.config.options.scales.y.max).toBe(100);
    document.querySelector('[data-dash-w="g9:view:table"]').click();
    expect(document.querySelector('#bp-dash-v2-source table').textContent).toContain('%');
  });

  test('Source mix column click drills the whole bucket with the bucket label', async function () {
    await renderV2('staff=1');
    var c = chartOf('bp-dash-v2-source');
    var feb = bp.getStateForTest()._dashV2Model.cur.periodBuckets.map(function (b) { return b.key; }).indexOf(YEAR + '-02');
    Fake.prototype.getElementsAtEventForMode = function (e, mode) { return mode === 'index' ? [{ index: feb }] : []; };
    c.config.options.onClick({}, [], c);
    var label = bp.getStateForTest()._dashV2Model.cur.periodBuckets[feb].label;
    expect(drill().label).toBe('From dashboard: Batches started in ' + label + ' \u00b7 5 batches');
  });

  test('Source mix single-batch segment opens the batch detail with no banner', async function () {
    await renderV2('staff=1');
    var c = chartOf('bp-dash-v2-source');
    var feb = bp.getStateForTest()._dashV2Model.cur.periodBuckets.map(function (b) { return b.key; }).indexOf(YEAR + '-02');
    var kioskIdx = c.config.data.datasets.map(function (d) { return d.label; }).indexOf('Kiosk');
    Fake.prototype.getElementsAtEventForMode = function (e, mode) { return mode === 'nearest' ? [{ index: feb, datasetIndex: kioskIdx }] : []; };
    c.config.options.onClick({}, [], c);
    expect(drill()).toBeNull();
  });

  test('v1 wine state is never written by v2', async function () {
    var before = JSON.stringify(Object.keys(bp.getStateForTest()).filter(function (k) { return /^_dashWine/.test(k); }).map(function (k) { return bp.getStateForTest()[k]; }));
    await renderV2('');
    document.querySelector('[data-dash-w="g4:type:cider"]').click();
    var after = JSON.stringify(Object.keys(bp.getStateForTest()).filter(function (k) { return /^_dashWine/.test(k); }).map(function (k) { return bp.getStateForTest()[k]; }));
    expect(after).toBe(before);
  });

  // Staging UAT 2026-10-29: Group by sat apart from its select, two view toggles stacked, Top 10 names were clipped.
  test('Group by sits with its select, the breakdown has its own view head, long labels are truncated', async function () {
    await renderV2('');
    var grp = document.querySelector('#bp-dash-v2-wine .bp-widget-controls .bp-ctl-group');
    expect(grp).not.toBeNull();
    expect(grp.textContent).toContain('Group by');
    expect(grp.querySelector('[data-dash-wsel="g4:dim"]')).not.toBeNull();
    expect(document.querySelector('#bp-dash-v2-wine .bp-widget-controls [data-dash-w^="g4:view"]')).toBeNull();
    expect(document.querySelector('#bp-dash-v2-wine .bp-g4-main [data-dash-w="g4:view:table"]')).not.toBeNull();
    var long = { getLabelForValue: function () { return '1. New Zealand Style Sauvignon Blanc'; } };
    expect(chartOf('bp-dash-v2-wine', 0).config.options.scales.y.ticks.callback.call(long, 0)).toMatch(/…$/);
    expect(chartOf('bp-dash-v2-wine', 1).config.options.scales.y.ticks.callback.call(long, 0)).toMatch(/…$/);
  });
});
