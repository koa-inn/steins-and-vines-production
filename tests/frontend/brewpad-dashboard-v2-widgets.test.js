'use strict';

// Phase 95-08: v2 widgets (KPI tiles + deltas, Batches per period, Wine breakdown) on the one data layer.

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

function rows() {
  return [
    lean('W1', 'wine', YEAR + '-01-05', { product_sku: 'S1', product_subcategory: 'Red' }),
    lean('W2', 'wine', YEAR + '-01-20', { product_sku: 'S2', product_subcategory: 'White', status: 'complete', completed_day: YEAR + '-02-10', completed_at: YEAR + '-02-10T10:00:00Z' }),
    lean('W3', 'wine', YEAR + '-01-25', { product_sku: 'S1', product_subcategory: 'Red', staff_batch: true }),
    lean('B1', 'beer', YEAR + '-01-10', { source: 'manual' }),
    lean('C1', 'cider', YEAR + '-02-03'),
    lean('S1', 'seltzer', YEAR + '-02-04'),
    lean('P1', 'wine', (YEAR - 1) + '-01-10', { product_sku: 'S1', product_subcategory: 'Red' })
  ];
}

function makeFakeChart() {
  function FakeChart(canvas, config) {
    this.canvas = canvas;
    this.config = config;
    this.destroyed = false;
    this.resizes = 0;
    FakeChart.instances.push(this);
  }
  FakeChart.instances = [];
  FakeChart.prototype.destroy = function () { this.destroyed = true; };
  FakeChart.prototype.resize = function () { this.resizes++; };
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

var Fake;

function live(canvasEl) {
  return Fake.instances.filter(function (i) { return !i.destroyed && (!canvasEl || i.canvas === canvasEl); });
}

function periodChart() {
  var c = document.querySelector('#bp-dash-v2-period canvas');
  return c ? Fake.getChart(c) : null;
}

function wineChart() {
  var c = document.querySelector('#bp-dash-v2-wine canvas');
  return c ? Fake.getChart(c) : null;
}

function sum(arr) { return arr.reduce(function (a, b) { return a + b; }, 0); }

function setUrl(hash) {
  window.history.replaceState(null, '', '/brewpad.html?dash=v2' + (hash || ''));
}

async function go(hash) {
  setUrl(hash ? '#' + hash : '');
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  await flush();
}

function mount(opts) {
  var o = opts || {};
  document.body.innerHTML =
    '<div><button type="button" id="bp-dash-switch" hidden></button></div>' +
    '<div id="bp-dashboard-inner"></div>' +
    '<div id="bp-panel-dashboard"></div>' +
    '<div id="bp-panel-batches"><div id="bp-batch-list-pane"></div></div>' +
    '<div id="bp-batch-detail-pane"></div><div id="bp-toast-container"></div>';
  var list = rows();
  bp._setStateForTest({
    _allBatchesData: list,
    _dashData: { asOf: ASOF, batches: list, staffBatchIds: o.staffIds || [] },
    _dashSummary: {},
    _dashWineSkuLookup: o.lookup === undefined ? {} : o.lookup
  });
}

async function renderV2(hash) {
  setUrl(hash ? '#' + hash : '');
  bp._initDashV2FlagForTest();
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  bp._renderDashboardForTest();
  await flush();
}

function model() { return bp.getStateForTest()._dashV2Model; }
function tile(which) { return document.querySelector('[data-dash-drill="' + which + '"]'); }
function drill() { return bp.getStateForTest()._dashDrill; }

beforeEach(function () {
  window.localStorage.clear();
  bp._resetChartJsForTest();
  Fake = makeFakeChart();
  window.Chart = Fake;
  Array.prototype.forEach.call(document.head.querySelectorAll('script'), function (s) { s.parentNode.removeChild(s); });
  mount();
});

afterEach(function () {
  bp._clearDashDrillForTest();
  delete window.Chart;
});

describe('tiles', function () {
  test('render as link buttons with the model values and period labels', async function () {
    await renderV2('');
    var m = model();
    var labels = Array.prototype.map.call(document.querySelectorAll('#bp-dash-v2-tiles .bp-stat-card'), function (c) { return c.tagName; });
    expect(labels).toEqual(['BUTTON', 'BUTTON', 'BUTTON', 'BUTTON']);
    expect(tile('activeNow').textContent).toContain('Fermenting now');
    expect(tile('activeNow').textContent).toContain('Right now');
    expect(tile('started').textContent).toContain('Started (YTD)');
    expect(tile('completed').textContent).toContain('Completed (YTD)');
    expect(tile('cycle').textContent).toContain('Days to complete (median)');
    expect(tile('cycle').className).toContain('bp-stat-card--wide');
    expect(tile('started').querySelector('.bp-stat-num').textContent).toBe(String(m.cur.started));
    expect(tile('completed').querySelector('.bp-stat-num').textContent).toBe(String(m.cur.completed));
    expect(tile('activeNow').querySelector('.bp-stat-num').textContent).toBe(String(m.cur.activeNow));
    expect(tile('cycle').querySelector('.bp-stat-num').textContent).toBe(String(m.cur.cycle.median));
    expect(m.cur.started).toBe(6);
  });

  test('period labels follow the Period filter (90d and custom)', async function () {
    await renderV2('period=90d');
    expect(tile('started').textContent).toContain('Started (90d)');
    await go('period=custom&from=' + YEAR + '-01-01&to=' + YEAR + '-01-31');
    expect(tile('started').textContent).toContain('Started (Jan 1 – Jan 31)');
  });

  test('litres measure formats litres, cycle stays in days', async function () {
    await renderV2('measure=litres');
    var m = model();
    var txt = tile('started').querySelector('.bp-stat-num').textContent;
    expect(txt).toBe(String(Math.round(m.cur.litres.started)).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' L');
    expect(tile('cycle').querySelector('.bp-stat-num').textContent).toBe(String(m.cur.cycle.median));
  });

  test('delta lines match formatDelta; fermenting has none', async function () {
    await renderV2('');
    var m = model();
    var want = bp.formatDelta(m.cur.started, m.prev.started, { kind: 'count', win: m.win, prevWin: m.prevWin, insufficient: m.insufficient });
    var d = tile('started').querySelector('.bp-delta');
    expect(d.textContent).toBe(want.text);
    expect(d.className).toContain('bp-delta--' + want.tone);
    expect(d.getAttribute('aria-label')).toBe(want.aria);
    expect(tile('activeNow').querySelector('.bp-delta')).toBeNull();
    expect(tile('cycle').querySelector('.bp-delta')).not.toBeNull();
  });

  test('period All shows no delta line on any tile', async function () {
    await renderV2('period=all');
    expect(document.querySelectorAll('#bp-dash-v2-tiles .bp-delta').length).toBe(0);
  });

  test('insufficient prior data says so', async function () {
    var list = rows().filter(function (r) { return r.batch_id !== 'P1'; });
    bp._setStateForTest({ _dashData: { asOf: ASOF, batches: list, staffBatchIds: [] }, _allBatchesData: list });
    await renderV2('');
    expect(tile('started').querySelector('.bp-delta').textContent).toBe('No earlier data to compare');
  });

  test('cycle-time delta colours are inverted', async function () {
    await renderV2('');
    var m = model();
    var want = bp.formatDelta(m.cur.cycle.median, m.prev.cycle.median, { kind: 'days', win: m.win, prevWin: m.prevWin, insufficient: m.insufficient });
    expect(tile('cycle').querySelector('.bp-delta').textContent).toBe(want.text);
  });

  test('clicking a tile drills with the exact ids and label', async function () {
    await renderV2('');
    var m = model();
    tile('started').click();
    expect(Object.keys(drill().ids).sort()).toEqual(m.cur.ids.started.slice().sort());
    expect(drill().label).toBe('From dashboard: Started YTD · ' + m.cur.started + ' batches');
    expect(drill().count).toBe(m.cur.started);
    var banner = document.querySelector('.bp-drill-banner');
    expect(banner.textContent).toContain(String(m.cur.started) + ' batches');

    tile('completed').click();
    expect(Object.keys(drill().ids)).toEqual(m.cur.ids.completed);
    tile('activeNow').click();
    expect(Object.keys(drill().ids).sort()).toEqual(m.cur.ids.activeNow.slice().sort());
    expect(drill().label).toBe('From dashboard: Fermenting now · ' + m.cur.activeNow + ' batches');
    tile('cycle').click();
    expect(Object.keys(drill().ids)).toEqual(m.cur.ids.cycle);
    expect(drill().label).toBe('From dashboard: Days to complete, YTD · ' + m.cur.ids.cycle.length + ' batch');
  });

  test('type filter prefixes the drill label', async function () {
    await renderV2('type=wine');
    tile('started').click();
    expect(drill().label).toMatch(/^From dashboard: Wine started YTD · \d+ batch/);
  });

  test('staff toggle leaves tile numbers and deltas unchanged; no customer text', async function () {
    await renderV2('');
    var before = document.getElementById('bp-dash-v2-tiles').innerHTML;
    await go('staff=1');
    expect(document.getElementById('bp-dash-v2-tiles').innerHTML).toBe(before);
    expect(before.toLowerCase()).not.toContain('customer');
  });
});

describe('Batches per period chart', function () {
  test('lazy states: loading then failure; tiles still render', async function () {
    delete window.Chart;
    await renderV2('');
    expect(document.querySelector('#bp-dash-v2-period .bp-empty').textContent).toBe('Loading charts…');
    expect(document.querySelector('#bp-dash-v2-wine .bp-empty').textContent).toBe('Loading charts…');
    expect(tile('started')).not.toBeNull();
    var script = document.head.querySelector('script');
    script.onerror();
    await flush();
    expect(document.querySelector('#bp-dash-v2-period .bp-empty').textContent).toBe('Charts could not load. Reload the page to try again.');
    expect(document.querySelector('#bp-dash-v2-wine .bp-empty').textContent).toBe('Charts could not load. Reload the page to try again.');
    expect(tile('started')).not.toBeNull();
  });

  test('stacked bar config: order, colours, data equals Started tile', async function () {
    await renderV2('');
    var c = periodChart();
    var cfg = c.config;
    expect(cfg.type).toBe('bar');
    expect(cfg.data.datasets.map(function (d) { return d.label; })).toEqual(['Wine', 'Cider', 'Beer', 'Other']);
    var theme = bp.readChartTheme();
    expect(cfg.data.datasets[0].backgroundColor).toBe(theme.wine);
    expect(cfg.options.scales.x.stacked).toBe(true);
    var total = sum(cfg.data.datasets.map(function (d) { return sum(d.data); }));
    expect(total).toBe(model().cur.started);
    expect(String(total)).toBe(tile('started').querySelector('.bp-stat-num').textContent);
    var other = cfg.data.datasets[3].data;
    expect(sum(other)).toBe(1);
    expect(document.querySelector('#bp-dash-v2-period .bp-widget-title').textContent).toBe('Production over time');
    expect(document.querySelector('#bp-dash-v2-period .bp-widget-sub').textContent).toBe('Started batches · YTD · by month');
    expect(document.querySelectorAll('#bp-dash-v2-period .bp-chart-legend-item').length).toBe(4);
    expect(document.querySelector('#bp-dash-v2-period canvas').getAttribute('aria-label')).toBe('Started batches by month, YTD. Wine 3, Cider 1, Beer 1, Other 1');
  });

  test('Type wine gives a single wine series', async function () {
    await renderV2('type=wine');
    expect(periodChart().config.data.datasets.length).toBe(1);
    expect(periodChart().config.data.datasets[0].label).toBe('Wine');
  });

  test('litres measure and the estimate note', async function () {
    var list = rows();
    list[0].target_volume_l = null;
    bp._setStateForTest({ _dashData: { asOf: ASOF, batches: list, staffBatchIds: [] }, _allBatchesData: list });
    await renderV2('measure=litres');
    expect(document.querySelector('#bp-dash-v2-period .bp-widget-sub').textContent).toBe(
      'Started litres · YTD · by month · litres estimated from standard batch sizes');
    expect(periodChart().config.options.scales.y.ticks.callback(1250)).toBe('1,250 L');
  });

  test('segment click drills to that type in that bucket; column click to the whole bucket; other = seltzer + other', async function () {
    await renderV2('');
    var m = model();
    var cfgClick = periodChart().config.options.onClick;
    var Fk = Fake;
    var idx = -1;
    m.cur.periodBuckets.forEach(function (b, i) { if (b.ids.beer.length) idx = i; });
    var bk = m.cur.periodBuckets[idx];
    Fk.prototype.getElementsAtEventForMode = function (e, mode) {
      if (mode === 'nearest') return [{ index: idx, datasetIndex: 2 }];
      return [];
    };
    cfgClick({}, [], periodChart());
    // 96-TEST-DECISION item 2a: a one-batch widget drill opens that batch's detail, no banner.
    expect(bk.ids.beer.length).toBe(1);
    expect(drill()).toBeNull();
    expect(bp.getStateForTest()._selectedBatchId).toBe(bk.ids.beer[0]);

    Fk.prototype.getElementsAtEventForMode = function (e, mode) {
      if (mode === 'nearest') return [{ index: idx, datasetIndex: 3 }];
      return [];
    };
    bp._clearDashDrillForTest();
    var oIdx = -1;
    m.cur.periodBuckets.forEach(function (b, i) { if (b.ids.seltzer.length) oIdx = i; });
    idx = oIdx;
    cfgClick({}, [], periodChart());
    var ob = m.cur.periodBuckets[oIdx];
    // 96-TEST-DECISION item 2b: seltzer + other is one batch here, so its detail opens, no banner.
    expect(ob.ids.seltzer.concat(ob.ids.other)).toEqual(['S1']);
    expect(drill()).toBeNull();
    expect(bp.getStateForTest()._selectedBatchId).toBe('S1');

    Fk.prototype.getElementsAtEventForMode = function (e, mode) {
      if (mode === 'index') return [{ index: oIdx }];
      return [];
    };
    bp._clearDashDrillForTest();
    cfgClick({}, [], periodChart());
    expect(Object.keys(drill().ids).sort()).toEqual(ob.all.slice().sort());
    expect(drill().label).toBe('From dashboard: Started in ' + ob.label + ' · ' + ob.all.length + ' batches');
  });

  test('zero results show the empty copy with a Reset filters link and no canvas; reset restores', async function () {
    await renderV2('type=beer&source=online');
    var slot = document.getElementById('bp-dash-v2-period');
    expect(slot.querySelector('.bp-empty').textContent).toContain('No batches match these filters.');
    expect(slot.querySelector('canvas')).toBeNull();
    var reset = slot.querySelector('[data-dash-reset]');
    expect(reset.textContent).toBe('Reset filters');
    reset.click();
    await flush();
    expect(document.querySelector('#bp-dash-v2-period canvas')).not.toBeNull();
  });

  test('refresh reuses the canvas and keeps one live instance per slot', async function () {
    await renderV2('');
    var canvas = document.querySelector('#bp-dash-v2-period canvas');
    await go('group=week');
    await go('group=month');
    expect(document.querySelector('#bp-dash-v2-period canvas')).toBe(canvas);
    expect(live(canvas).length).toBe(1);
    expect(live().length).toBe(2);
  });

  test('switching to the dashboard tab resizes live charts', async function () {
    await renderV2('');
    var a = periodChart();
    var b = wineChart();
    var before = a.resizes + b.resizes;
    bp._switchTabForTest('dashboard');
    expect(a.resizes + b.resizes).toBe(before + 2);
  });
});

describe('Wine breakdown', function () {
  test('horizontal bar over subcategory, staff hidden by default, segment click drills', async function () {
    await renderV2('');
    var c = wineChart();
    expect(c.config.options.indexAxis).toBe('y');
    expect(c.config.data.labels).toEqual(['Red', 'White']);
    expect(c.config.data.datasets[0].data).toEqual([1, 1]);
    expect(document.querySelector('#bp-dash-v2-wine .bp-widget-title').textContent).toBe('Wine breakdown');
    expect(document.querySelector('#bp-dash-v2-wine .bp-widget-sub').textContent).toContain('Staff batches hidden');
    var Fk = Fake;
    Fk.prototype.getElementsAtEventForMode = function (e, mode) {
      return mode === 'nearest' ? [{ index: 0, datasetIndex: 0 }] : [];
    };
    c.config.options.onClick({}, [], c);
    expect(Object.keys(drill().ids)).toEqual(['W1']);
    expect(drill().label).toBe('From dashboard: Wine Red started YTD · 1 batch');
  });

  test('Include staff batches adds the staff batch and says so; production views unchanged', async function () {
    await renderV2('');
    var periodBefore = JSON.stringify(periodChart().config.data);
    await go('staff=1');
    expect(wineChart().config.data.datasets[0].data).toEqual([2, 1]);
    expect(document.querySelector('#bp-dash-v2-wine .bp-widget-sub').textContent).toContain('Including staff batches');
    expect(JSON.stringify(periodChart().config.data)).toBe(periodBefore);
  });

  test('dimension chips are widget-local', async function () {
    await renderV2('');
    var chip = document.querySelector('[data-dash-wine-dim="brand"]');
    chip.click();
    expect(document.querySelector('[data-dash-wine-dim="brand"]').getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('#bp-dash-v2-wine .bp-widget-sub').textContent).toContain('by brand');
    expect(wineChart().config.data.labels).toEqual(['Unknown']);
    document.querySelector('[data-dash-wine-dim="subcategory"]').click();
    expect(wineChart().config.data.labels).toEqual(['Red', 'White']);
  });

  test('hidden for Beer and Cider, shown for All and Wine', async function () {
    await renderV2('type=beer');
    expect(document.getElementById('bp-dash-v2-wine').style.display).toBe('none');
    await go('type=cider');
    expect(document.getElementById('bp-dash-v2-wine').style.display).toBe('none');
    await go('type=wine');
    expect(document.getElementById('bp-dash-v2-wine').style.display).toBe('');
    await go('');
    expect(document.getElementById('bp-dash-v2-wine').style.display).toBe('');
  });

  test('ticking Staff batch in the detail pane re-renders the wine chart; tiles unchanged', async function () {
    await renderV2('');
    var tilesBefore = document.getElementById('bp-dash-v2-tiles').innerHTML;
    var total = function () { return sum(wineChart().config.data.datasets[0].data); };
    expect(total()).toBe(2);
    global.fetch.mockImplementation(function () {
      return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ ok: true }); } });
    });
    bp._renderBatchDetailForTest({
      batch: { batch_id: 'W1', product_name: 'Merlot', status: 'primary', source: 'manual', staff_batch: false },
      tasks: [], plato_readings: []
    });
    var box = document.getElementById('bp-detail-staff');
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    await flush();
    await flush();
    expect(total()).toBe(1);
    expect(document.getElementById('bp-dash-v2-tiles').innerHTML).toBe(tilesBefore);
  });

  test('catalog text is escaped in the legend, never executed', async function () {
    var list = rows();
    list[0].product_sku = 'SX';
    list[0].product_subcategory = '<img src=x onerror=alert(1)>';
    bp._setStateForTest({ _dashData: { asOf: ASOF, batches: list, staffBatchIds: [] }, _allBatchesData: list });
    await renderV2('');
    expect(document.querySelector('#bp-dash-v2 img')).toBeNull();
    expect(wineChart().config.data.labels).toContain('<img src=x onerror=alert(1)>');
  });
});
