'use strict';

// Phase 96-07: G5 Workload and G7 Task health (Floor today). Plan 08 extends this file with G6/G8.

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
var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function flush() { return new Promise(function (r) { setTimeout(r, 0); }); }

// Vancouver-day offset from TODAY (UTC arithmetic, DST proof).
function d(n) {
  var p = TODAY.split('-');
  var t = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]) + n * 86400000);
  return t.toISOString().slice(0, 10);
}

function lean(id, type, status, extra) {
  return Object.assign({
    batch_id: id, status: status, batch_type: type, batch_type_source: 'recipe',
    start_date: YEAR + '-01-05', completed_day: null, completed_at: null, completed_at_source: null,
    vessel_id: null, source: 'kiosk', product_sku: '', product_name: id, product_subcategory: '',
    product_brand: '', product_manufacturer: '', recipe_id: '', schedule_id: '',
    schedule_category: '', target_volume_l: 20, tasks_total: 0, tasks_done: 0
  }, extra || {});
}

function fixture() {
  return [
    lean('A', 'wine', 'primary'),
    lean('B', 'beer', 'secondary', { source: 'online' }),
    lean('C', 'wine', 'complete', { completed_day: d(-1) }),
    lean('D', 'cider', 'pending')
  ];
}

var seq = 0;
function task(batch, title, due, extra) {
  seq++;
  return Object.assign({
    batch_id: batch, task_id: 't' + seq, title: title, due_date: due, completed: false, completed_day: null,
    is_packaging: false, is_transfer: false
  }, extra || {});
}

function tasks() {
  return [
    task('A', 'Racking and Stabilization', d(0)),
    task('A', 'Lower to 10ºC', d(0)),
    task('A', 'Keg', d(0)),
    task('B', 'Racking and Stabilization', d(0)),
    task('A', 'Filtering', d(1)),
    task('A', 'Bottling/Packaging', d(2)),
    task('B', 'Plunge Skins', d(-1)),
    task('A', 'Filtering', d(-3)),
    task('B', 'Batch Start', d(-4)),
    task('B', 'Crash to 0ºC', d(-7)),
    task('B', 'Carbonate', d(-8)),
    task('A', 'Batch Start', null),
    task('D', 'Batch Start', d(-10)),
    task('A', 'Racking and Stabilization', d(40)),
    task('C', 'Filtering', d(-30), { completed: true, completed_day: d(-1) }),
    task('A', 'Plunge Skins', d(-5), { completed: true, completed_day: d(-2) }),
    task('A', 'Filtering', d(-5), { completed: true, completed_day: d(-2) })
  ];
}

function mdl(over) {
  var st = Object.assign({}, bp.DASH_FILTER_DEFAULTS, over || {});
  return bp.buildDashV2Model(fixture(), ASOF, st, {}, {});
}
function g5(over, c, tr) {
  return bp.buildG5Model(fixture(), tr || tasks(), mdl(over), c || {});
}
function g7(over, c, tr) {
  return bp.buildG7Model(fixture(), tr || tasks(), mdl(over), c || {});
}
function sum(a) { return a.reduce(function (x, y) { return x + y; }, 0); }

describe('buildG5Model', function () {
  test('14 days from today with Today and weekday labels', function () {
    var g = g5({});
    expect(g.labels.length).toBe(14);
    expect(g.labels[0]).toBe('Today');
    var p = d(1).split('-');
    var wd = DAY_NAMES[new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay()];
    expect(g.labels[1]).toBe(wd + ' ' + (+p[2]));
    expect(g.subtitle).toBe('Open tasks due · next 14 days');
    expect(g.series.map(function (s) { return s.label; })).toEqual(['Racking / transfer', 'Filtering', 'Packaging', 'Temperature step', 'Other']);
  });

  test('counts per day and kind; days without tasks are real zeros', function () {
    var g = g5({});
    // today: racking on A and B, one temp, one other
    expect(g.series[0].data[0]).toBe(2);
    expect(g.series[3].data[0]).toBe(1);
    expect(g.series[4].data[0]).toBe(1);
    expect(g.dayTotals[0]).toBe(4);
    expect(g.series[1].data[1]).toBe(1);
    expect(g.series[2].data[2]).toBe(1);
    expect(g.dayTotals[3]).toBe(0);
    expect(g.series[0].data[3]).toBe(0);
    expect(g.empty).toBe(false);
  });

  test('horizon 30 widens the window; tasks past it are ignored', function () {
    var g = g5({}, { horizon: 30 });
    expect(g.labels.length).toBe(30);
    expect(sum(g.dayTotals)).toBe(6);
    expect(g.subtitle).toBe('Open tasks due · next 30 days');
    expect(g5({}, { horizon: 99 }).labels.length).toBe(14);
  });

  test('drill sets are distinct batch ids with the kind subject', function () {
    var g = g5({});
    expect(g.ids[0][0].slice().sort()).toEqual(['A', 'B']);
    expect(g.dayIds[0].slice().sort()).toEqual(['A', 'B']);
    expect(g.subjectFor('transfer', d(0))).toMatch(/^Racking due [A-Z][a-z]{2} \d{1,2}$/);
    expect(g.subjectFor('', d(0))).toMatch(/^Tasks due [A-Z][a-z]{2} \d{1,2}$/);
    expect(g.subjectFor('temp', d(0))).toContain('Temperature steps due');
    expect(g.subjectFor('other', d(0))).toContain('Other tasks due');
    expect(g.footer(0)).toBe('4 tasks · 2 batches');
    expect(g.footer(1)).toBe('1 task · 1 batch');
  });

  test('a batch with two tasks of one kind counts the tasks but drills the batch once', function () {
    var tr = [task('A', 'Filtering', d(1)), task('A', 'Filtering', d(1))];
    var g = g5({}, {}, tr);
    expect(g.series[1].data[1]).toBe(2);
    expect(g.ids[1][1]).toEqual(['A']);
    expect(g.footer(1)).toBe('2 tasks · 1 batch');
  });

  test('overdue note counts open tasks before today; due today is not overdue', function () {
    var g = g5({});
    expect(g.overdue).toBe(5);
    expect(g.note).toBe('5 open tasks are overdue. See Task health.');
    var one = g5({}, {}, [task('A', 'Keg', d(-1)), task('A', 'Keg', d(0))]);
    expect(one.note).toBe('1 open task is overdue. See Task health.');
    expect(g5({}, {}, [task('A', 'Keg', d(0))]).note).toBe('');
  });

  test('global Type and Source filter tasks by their batch; pending batches are not open work', function () {
    var wine = g5({ type: 'wine' });
    expect(wine.overdue).toBe(1);
    expect(g5({ source: 'online' }).overdue).toBe(4);
    expect(g5({}, {}, [task('D', 'Keg', d(1))]).empty).toBe(true);
  });

  test('empty copy and ignoring Period', function () {
    var g = g5({}, {}, []);
    expect(g.empty).toBe(true);
    expect(g.emptyText).toBe('No open tasks due in the next 14 days.');
    expect(g5({}, { horizon: 30 }, []).emptyText).toBe('No open tasks due in the next 30 days.');
    expect(g5({ period: '30d' }).dayTotals).toEqual(g5({ period: 'all' }).dayTotals);
  });

  test('table: Date | five kinds | Total, one row per day, equal to the chart', function () {
    var g = g5({});
    expect(g.table.columns.map(function (c) { return c.label; })).toEqual(['Date', 'Racking / transfer', 'Filtering', 'Packaging', 'Temperature step', 'Other', 'Total']);
    expect(g.table.rows.length).toBe(14);
    g.table.rows.forEach(function (row, i) {
      for (var k = 0; k < 5; k++) expect(+row.cells[k + 1].text).toBe(g.series[k].data[i]);
      expect(+row.cells[6].text).toBe(g.dayTotals[i]);
    });
    expect(g.table.rows[0].cells[0].text).toBe('Today');
  });
});

describe('buildG7Model', function () {
  test('ageing bands with day-boundary edges (due today is not overdue)', function () {
    var g = g7({});
    expect(g.ageing.labels).toEqual(['1–3 days', '4–7 days', '8+ days']);
    // 1 and 3 days late | 4 and 7 days late | 8 days late
    expect(g.ageing.counts).toEqual([2, 2, 1]);
    expect(g.ageing.total).toBe(5);
    var edges = g7({}, {}, [
      task('A', 'Keg', d(0)), task('A', 'Keg', d(-3)), task('A', 'Keg', d(-4)),
      task('A', 'Keg', d(-7)), task('A', 'Keg', d(-8)), task('A', 'Keg', null)
    ]);
    expect(edges.ageing.counts).toEqual([1, 2, 1]);
  });

  test('ageing total equals the G5 overdue count for the same filters', function () {
    [{}, { type: 'wine' }, { source: 'online' }, { type: 'beer', source: 'online' }].forEach(function (over) {
      expect(g7(over).ageing.total).toBe(g5(over).overdue);
    });
  });

  test('ageing drill ids are distinct batches and labels are task counts', function () {
    var g = g7({}, {}, [task('A', 'Keg', d(-1)), task('A', 'Keg', d(-2)), task('B', 'Keg', d(-2))]);
    expect(g.ageing.counts[0]).toBe(3);
    expect(g.ageing.ids[0].slice().sort()).toEqual(['A', 'B']);
    expect(g.ageing.subjectFor(0)).toBe('Open tasks overdue 1–3 days');
    expect(g.ageing.table.rows[0].cells[2].text).toBe('2');
  });

  test('completions bucketed by period, window respected, single series data', function () {
    var g = g7({ period: 'ytd', group: 'month' });
    expect(sum(g.completions.data)).toBe(3);
    expect(g.completions.labels.length).toBeGreaterThan(0);
    expect(g.subtitle).toBe('Tasks · YTD · by month'.replace('YTD', g.subtitle.split(' · ')[1]));
    expect(g.completions.subjectFor('Jun 2026')).toBe('Tasks completed in Jun 2026');
    var weekly = g7({ period: 'ytd', group: 'week' });
    expect(sum(weekly.completions.data)).toBe(3);
    expect(weekly.subtitle.slice(-7)).toBe('by week');
    // outside the window: nothing
    var none = g7({ period: '30d' }, {}, [task('A', 'Keg', d(-100), { completed: true, completed_day: d(-90) })]);
    expect(none.completions.empty).toBe(true);
    expect(none.completions.emptyText).toBe('No tasks were ticked off in this period.');
  });

  test('period "all" starts at the earliest completed day', function () {
    var tr = [task('A', 'Keg', d(-500), { completed: true, completed_day: d(-400) }), task('A', 'Keg', d(-1), { completed: true, completed_day: d(-1) })];
    var g = g7({ period: 'all' }, {}, tr);
    expect(sum(g.completions.data)).toBe(2);
    expect(g.completions.labels.length).toBeGreaterThan(10);
  });

  test('kind select filters both charts', function () {
    var f = g7({}, { kind: 'filtering' });
    expect(f.ageing.counts).toEqual([1, 0, 0]);
    expect(sum(f.completions.data)).toBe(2);
    expect(f.choices.map(function (c) { return c[1]; })).toEqual(['All tasks', 'Racking / transfer', 'Filtering', 'Packaging', 'Temperature step', 'Other']);
  });

  test('tables and empty copy', function () {
    var g = g7({});
    expect(g.ageing.table.columns.map(function (c) { return c.label; })).toEqual(['Overdue by', 'Open tasks', 'Batches']);
    expect(g.completions.table.columns.map(function (c) { return c.label; })).toEqual(['Period', 'Tasks completed']);
    var e = g7({}, {}, []);
    expect(e.ageing.empty).toBe(true);
    expect(e.ageing.emptyText).toBe('No open tasks are overdue.');
    expect(e.note).toBe('Tick times can lag the work, so lateness here is only an estimate.');
  });

  test('banned text never appears in either model (D-02, D-03)', function () {
    var txt = JSON.stringify([g5({}), g7({}), g7({}, { kind: 'filtering' })]);
    ['on-time', 'on time', 'by staff', 'completed_by', '@'].forEach(function (s) {
      expect(txt.toLowerCase()).not.toContain(s);
    });
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

  function mount(dash) {
    document.body.innerHTML =
      '<div><button type="button" id="bp-dash-switch" hidden></button></div>' +
      '<div id="bp-dashboard-inner"></div><div id="bp-panel-dashboard"></div>' +
      '<div id="bp-panel-batches"><div id="bp-batch-list-pane"></div></div>' +
      '<div id="bp-batch-detail-pane"></div><div id="bp-toast-container"></div>';
    bp._setStateForTest({
      _allBatchesData: fixture(),
      _dashData: Object.assign({ asOf: ASOF, batches: fixture(), staffBatchIds: [], batchMeta: [] }, dash),
      _dashSummary: {}
    });
  }

  async function renderV2(dash) {
    mount(dash);
    setUrl('');
    bp._initDashV2FlagForTest();
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    bp._renderDashboardForTest();
    await flush();
  }

  function canvases(slot) { return document.querySelectorAll('#' + slot + ' canvas'); }
  function chartOf(slot, n) { return Fake.getChart(canvases(slot)[n || 0]); }
  function drill() { return bp.getStateForTest()._dashDrill; }
  function hit(c, index, datasetIndex) {
    Fake.prototype.getElementsAtEventForMode = function (e, mode) { return mode === 'nearest' ? [{ index: index, datasetIndex: datasetIndex || 0 }] : []; };
    c.config.options.onClick({}, [], c);
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

  test('Workload chart: 14 bars, Today bold, tooltip footer, overdue note, horizon segment', async function () {
    await renderV2({ taskRows: tasks() });
    expect(document.querySelector('#bp-dash-v2-workload .bp-widget-title').textContent).toBe('Workload');
    expect(document.querySelector('#bp-dash-v2-workload .bp-widget-sub').textContent).toBe('Open tasks due · next 14 days');
    var c = chartOf('bp-dash-v2-workload');
    expect(c.config.data.labels.length).toBe(14);
    expect(c.config.data.labels[0]).toBe('Today');
    var tickFont = c.config.options.scales.x.ticks.font;
    expect(tickFont({ index: 0 }).weight).toBe('700');
    expect(tickFont({ index: 1 }).weight).toBe('400');
    expect(document.querySelector('#bp-dash-v2-workload .bp-dash-foot-note').textContent).toBe('5 open tasks are overdue. See Task health.');
    expect(c.config.options.plugins.tooltip.callbacks.footer([{ dataIndex: 0 }])).toBe('4 tasks · 2 batches');
    document.querySelector('[data-dash-w="g5:horizon:30"]').click();
    expect(chartOf('bp-dash-v2-workload').config.data.labels.length).toBe(30);
  });

  test('Workload drills: a stack opens the exact batch set, a single batch opens its detail', async function () {
    await renderV2({ taskRows: tasks() });
    var c = chartOf('bp-dash-v2-workload');
    hit(c, 0, 0);
    expect(drill().label).toMatch(/^From dashboard: Racking due [A-Z][a-z]{2} \d{1,2} · 2 batches$/);
    hit(chartOf('bp-dash-v2-workload'), 1, 1);
    expect(drill()).toBeNull();
  });

  test('Workload table numbers equal the chart dataset', async function () {
    await renderV2({ taskRows: tasks() });
    var data = chartOf('bp-dash-v2-workload').config.data.datasets.map(function (ds) { return ds.data.slice(); });
    document.querySelector('[data-dash-w="g5:view:table"]').click();
    var rows = document.querySelectorAll('#bp-dash-v2-workload tbody tr');
    expect(rows.length).toBe(14);
    Array.prototype.forEach.call(rows, function (tr, i) {
      for (var k = 0; k < 5; k++) expect(+tr.children[k + 1].textContent).toBe(data[k][i]);
    });
  });

  test('Task health: ageing ink ramp, completions chart, drills, kind select', async function () {
    await renderV2({ taskRows: tasks() });
    expect(document.querySelector('#bp-dash-v2-tasks .bp-widget-title').textContent).toBe('Task health');
    expect(canvases('bp-dash-v2-tasks').length).toBe(2);
    var age = chartOf('bp-dash-v2-tasks', 0);
    expect(age.config.data.labels).toEqual(['1–3 days', '4–7 days', '8+ days']);
    expect(age.config.data.datasets[0].data).toEqual([2, 2, 1]);
    expect(age.canvas.parentNode.style.height).toBe('120px');
    expect(Array.isArray(age.config.data.datasets[0].backgroundColor)).toBe(true);
    var subs = Array.prototype.map.call(document.querySelectorAll('#bp-dash-v2-tasks h4'), function (h) { return h.textContent; });
    expect(subs).toEqual(['Open tasks past due date', 'Tasks ticked off']);
    hit(age, 0, 0);
    expect(drill().label).toBe('From dashboard: Open tasks overdue 1–3 days · 2 batches');
  });

  test('Task health kind select and table equal the chart', async function () {
    await renderV2({ taskRows: tasks() });
    var sel = document.querySelector('[data-dash-wsel="g7:kind"]');
    sel.value = 'filtering';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    expect(chartOf('bp-dash-v2-tasks', 0).config.data.datasets[0].data).toEqual([1, 0, 0]);
    var comp = chartOf('bp-dash-v2-tasks', 1).config.data.datasets[0].data.slice();
    document.querySelector('[data-dash-w="g7:view:table"]').click();
    var tables = document.querySelectorAll('#bp-dash-v2-tasks table');
    expect(tables.length).toBe(2);
    var nums = Array.prototype.map.call(tables[1].querySelectorAll('tbody tr'), function (tr) { return +tr.children[1].textContent; });
    expect(nums.slice().reverse()).toEqual(comp);
    expect(+tables[0].querySelector('tbody tr').children[1].textContent).toBe(1);
  });

  test('without taskRows both widgets say so while G1 still renders', async function () {
    await renderV2({});
    ['bp-dash-v2-workload', 'bp-dash-v2-tasks'].forEach(function (id) {
      expect(document.querySelector('#' + id + ' .bp-empty').textContent).toBe('Not available yet. Reopen the Dashboard tab to refresh.');
    });
    expect(canvases('bp-dash-v2-period').length).toBe(1);
  });

  test('rendered text has no on-time, by-staff, email, or danger styling', async function () {
    await renderV2({ taskRows: tasks() });
    document.querySelector('[data-dash-w="g5:view:table"]').click();
    document.querySelector('[data-dash-w="g7:view:table"]').click();
    ['bp-dash-v2-workload', 'bp-dash-v2-tasks'].forEach(function (id) {
      var slot = document.getElementById(id);
      var txt = slot.textContent.toLowerCase();
      ['on-time', 'on time', 'by staff', '@'].forEach(function (s) { expect(txt).not.toContain(s); });
      expect(slot.innerHTML).not.toContain('bp-delta--bad');
      expect(slot.innerHTML).not.toContain('--batch-danger');
    });
  });

  test('task titles are never rendered', async function () {
    var tr = tasks();
    tr.push(task('A', '<img src=x onerror=alert(1)>', d(1)));
    await renderV2({ taskRows: tr });
    document.querySelector('[data-dash-w="g5:view:table"]').click();
    expect(document.querySelector('#bp-dash-v2 img')).toBeNull();
    expect(document.getElementById('bp-dash-v2-workload').innerHTML).not.toContain('onerror');
  });

  test('empty states: no open tasks due, none overdue, none ticked off', async function () {
    await renderV2({ taskRows: [] });
    expect(document.querySelector('#bp-dash-v2-workload .bp-empty').textContent).toBe('No open tasks due in the next 14 days.');
    var empties = Array.prototype.map.call(document.querySelectorAll('#bp-dash-v2-tasks .bp-empty'), function (p) { return p.textContent; });
    expect(empties).toEqual(['No open tasks are overdue.', 'No tasks were ticked off in this period.']);
  });
});

// ===== Phase 96-08: G6 Vessels and G8 Fermentation =====
function ves(id, type, cap, archived) {
  return { vessel_id: id, type: type, capacity_liters: cap, archived: !!archived };
}

function vesselFixture() {
  return [
    ves('CB-1', 'Carboy', 23), ves('CB-2', 'Carboy', 23), ves('CB-3', 'Carboy', null),
    ves('CB-OLD', 'Carboy', 23, true),
    ves('BK-1', 'Bucket', 30),
    ves('KG-1', 'Keg', 19),
    ves('CF-1', 'Conical Fermenter', 100), ves('CF-2', 'Conical Fermenter', 100)
  ];
}

function vesselBatches() {
  return [
    lean('W1', 'wine', 'primary', { vessel_id: 'CB-1', product_name: 'Merlot' }),
    lean('W2', 'wine', 'secondary', { vessel_id: 'CB-1', product_name: 'Shiraz' }),
    lean('B1', 'beer', 'primary', { vessel_id: 'CF-1', product_name: 'Pale Ale' }),
    lean('B2', 'beer', 'primary', { vessel_id: 'CF-1', product_name: 'IPA' }),
    lean('C1', 'cider', 'primary', { vessel_id: 'CB-OLD', product_name: 'Apple' }),
    lean('W3', 'wine', 'primary', { vessel_id: 'ZZ-9', product_name: 'Rose' }),
    lean('W4', 'wine', 'primary', { vessel_id: '', product_name: 'Pinot' }),
    lean('W5', 'wine', 'complete', { vessel_id: 'CB-2', completed_day: d(-1) }),
    lean('W6', 'wine', 'pending', { vessel_id: 'BK-1' })
  ];
}

function g6(c, rows, ves2) {
  return bp.buildG6Model(rows || vesselBatches(), ves2 || vesselFixture(), c || {});
}

describe('buildG6Model', function () {
  test('capacity grouped by stored type in fixed order; shared vessel and archived handled', function () {
    var g = g6();
    expect(g.labels).toEqual(['Carboy', 'Bucket', 'Keg', 'Conical Fermenter']);
    // Carboy: CB-1 in use (shared by two batches, counted once); CB-2, CB-3 free; CB-OLD archived excluded
    expect(g.types[0].total).toBe(3);
    expect(g.types[0].inUse).toBe(1);
    expect(g.series[0].data).toEqual([1, 0, 0, 1]);
    expect(g.series[1].data).toEqual([2, 1, 1, 1]);
    expect(g.label(0)).toBe('1 of 3');
    expect(bp.DASH_VESSEL_TYPE_ORDER[0]).toBe('Carboy');
  });

  test('in use drill is the active batches on that type', function () {
    var g = g6();
    expect(g.types[0].ids.slice().sort()).toEqual(['W1', 'W2']);
    expect(g.types[0].subject).toBe('Carboys in use');
    expect(g.table.rows[0].cells[1].subject).toBe('Carboys in use');
  });

  test('litres mode sums known capacities and notes vessels with none', function () {
    var g = g6({ mode: 'litres' });
    expect(g.series[0].data).toEqual([23, 0, 0, 100]);
    expect(g.series[1].data).toEqual([23, 30, 19, 100]);
    expect(g.label(3)).toBe('100 of 200 L');
    expect(g.subtitle).toBe('Right now · all batch types and sources · vessels with no capacity recorded are left out');
    expect(g6().subtitle).toBe('Right now · all batch types and sources');
  });

  test('shared and no-vessel lists', function () {
    var g = g6();
    expect(g.shared.map(function (s) { return s.primary; })).toEqual(['CB-1 · Carboy', 'CF-1 · Conical Fermenter']);
    expect(g.shared[0].right).toBe('2 batches');
    expect(g.shared[0].secondary).toBe('W1, W2');
    expect(g.shared[0].subject).toBe('Shared vessel CB-1');
    expect(g.noVessel.map(function (s) { return s.primary; })).toEqual(['W4']);
    expect(g.noVessel[0].secondary).toBe('Pinot · Wine');
    expect(g.noVessel[0].ids).toEqual(['W4']);
  });

  test('a vessel id missing from the vessel list is labelled Unknown type', function () {
    var g = g6({}, vesselBatches().concat([lean('X1', 'wine', 'primary', { vessel_id: 'QQ-1' }), lean('X2', 'wine', 'primary', { vessel_id: 'QQ-1' })]));
    expect(g.shared.map(function (s) { return s.primary; })).toContain('QQ-1 · Unknown type');
  });

  test('empty and banned words', function () {
    expect(g6({}, [], []).empty).toBe(true);
    var g = g6();
    var txt = JSON.stringify([g.shared, g.noVessel, g.subtitle, g.note, g.sharedNote, g.table]).toLowerCase();
    ['conflict', 'double-booked', 'error'].forEach(function (s) { expect(txt).not.toContain(s); });
  });
});

function fBatches() {
  return [
    lean('E1', 'beer', 'primary', { start_date: d(-10), product_name: 'Pale Ale' }),
    lean('E2', 'cider', 'secondary', { start_date: d(-6), product_name: 'Dry Cider' }),
    lean('E3', 'beer', 'primary', { start_date: d(-3), product_name: 'Stout' }),
    lean('E4', 'cider', 'primary', { start_date: d(-8), product_name: 'Perry', source: 'online' }),
    lean('E5', 'wine', 'primary', { start_date: d(-9), product_name: 'Merlot' }),
    lean('E6', 'beer', 'complete', { start_date: d(-30), completed_day: d(-1) }),
    lean('E7', 'beer', 'pending', { start_date: d(-2) })
  ];
}

function rd(batch, day, plato, extra) {
  return Object.assign({ batch_id: batch, reading_at: day + 'T10:00:00Z', reading_day: day, degrees_plato: plato, temperature: 18.5, ph: null }, extra || {});
}

function fReadings() {
  return [
    rd('E1', d(-9), 12.5), rd('E1', d(-5), 8.1), rd('E1', d(-1), 4.2),
    rd('E2', d(-4), 11),
    rd('E5', d(-8), 20),
    rd('E6', d(-20), 10),
    rd('E4', d(-7), null)
  ];
}

function g8(over, c, meta, readings, rows) {
  var r = rows || fBatches();
  var st = Object.assign({}, bp.DASH_FILTER_DEFAULTS, over || {});
  var m = bp.buildDashV2Model(r, ASOF, st, {}, {});
  return bp.buildG8Model(r, readings || fReadings(), meta || {}, m, c || {});
}

describe('buildG8Model', function () {
  test('all mode: one series per batch with readings, wine and complete never plotted', function () {
    var g = g8();
    expect(g.series.map(function (s) { return s.key; })).toEqual(['E1', 'E2']);
    expect(g.series[0].data).toEqual([{ x: 1, y: 12.5 }, { x: 5, y: 8.1 }, { x: 9, y: 4.2 }]);
    expect(g.legend.map(function (l) { return l.label; })).toEqual(['Beer', 'Cider']);
    expect(g.choices.map(function (c2) { return c2[0]; })).toEqual(['all', 'E1', 'E2']);
    expect(g.stats).toBeNull();
  });

  test('x is clamped at zero when a reading predates the start', function () {
    var g = g8({}, {}, {}, [rd('E3', d(-5), 9)]);
    expect(g.series[0].data[0].x).toBe(0);
  });

  test('single batch: expected series absent when og/target_fg null', function () {
    var g = g8({}, { batch: 'E1' }, { E1: { og: null, target_fg: null, planned_days: 14 } });
    expect(g.series.map(function (s) { return s.key; })).toEqual(['E1']);
    expect(g.note).toBe('No expected curve: this recipe has no OG or target FG.');
    expect(g.stats.map(function (s) { return s[1]; })).toEqual(['–', '4.2 °P', '–', '–', '–']);
  });

  test('single batch: dashed expected series and stats when all known', function () {
    var g = g8({}, { batch: 'E1' }, { E1: { og: 12.5, target_fg: 3, planned_days: 14, recipe_name: 'Pale' } });
    var ex = g.series[1];
    expect(ex.key).toBe('expected');
    expect(ex.borderDash).toEqual([6, 4]);
    expect(ex.data).toEqual([{ x: 0, y: 12.5 }, { x: 14, y: 3 }]);
    expect(g.stats[3][1]).toBe('76%');
    expect(g.stats[4][1]).toBe((Math.round(bp.calcAbv(12.5, 3) * 10) / 10).toFixed(1) + '%');
    expect(g.note).toBe('');
    expect(g.choices[1][1]).toBe('E1 · Pale');
  });

  test('known og and fg but no schedule length', function () {
    var g = g8({}, { batch: 'E1' }, { E1: { og: 12.5, target_fg: 3, planned_days: null } });
    expect(g.series.length).toBe(1);
    expect(g.note).toBe('No expected curve: this batch has no fermentation schedule.');
    expect(g.stats[3][1]).toBe('76%');
  });

  test('stale selected batch falls back to all', function () {
    expect(g8({}, { batch: 'NOPE' }).batch).toBe('all');
    expect(g8({}, { batch: 'E5' }).batch).toBe('all');
  });

  test('caps at 20 most recent with a note', function () {
    var rows = [];
    var rds = [];
    for (var i = 0; i < 22; i++) {
      var id = 'M' + (i < 10 ? '0' : '') + i;
      rows.push(lean(id, 'beer', 'primary', { start_date: d(-30) }));
      rds.push(rd(id, d(-25 + i), 10));
    }
    var g = g8({}, {}, {}, rds, rows);
    expect(g.series.length).toBe(20);
    expect(g.series[0].key).toBe('M21');
    expect(g.note).toBe('Showing the 20 most recent. Pick a batch to see others.');
  });

  test('No readings yet: active beer/cider only, day desc', function () {
    var g = g8();
    expect(g.noReadings.map(function (n) { return n.primary; })).toEqual(['E4', 'E3']);
    expect(g.noReadings[0].right).toBe('Day 8');
    expect(g.noReadings[0].secondary).toBe('Perry · Cider');
  });

  test('global Source narrows; Type wine says so; no readings state', function () {
    expect(g8({ source: 'online' }).noReadings.map(function (n) { return n.primary; })).toEqual(['E4']);
    var w = g8({ type: 'wine' });
    expect(w.state).toBe('wrongType');
    expect(w.stateText).toBe('Fermentation curves cover beer and cider.');
    var none = g8({}, {}, {}, [rd('E5', d(-1), 5)]);
    expect(none.state).toBe('noReadings');
    expect(none.stateText).toBe('No Plato readings have been recorded yet.');
  });

  test('table: newest first, dashes for blanks; banned words absent', function () {
    var g = g8();
    expect(g.table.columns.map(function (c2) { return c2.label; })).toEqual(['Batch', 'Type', 'Day', '°P', 'Temp', 'pH']);
    expect(g.table.rows[0].cells[0].text).toBe('E1');
    expect(g.table.rows[0].cells[5].text).toBe('–');
    expect(g.table.rows.length).toBe(4);
    var txt = JSON.stringify([g.note, g.noReadings, g.noReadingsEmpty, g.subtitle, g.table.columns]).toLowerCase();
    ['due', 'overdue', 'missing'].forEach(function (s) { expect(txt).not.toContain(s); });
  });
});
