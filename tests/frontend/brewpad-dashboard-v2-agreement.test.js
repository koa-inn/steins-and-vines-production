'use strict';

// Phase 96-09: cross-widget agreement (Phase 94 D-20) and whole-page copy guard.

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

function d(n) {
  var p = TODAY.split('-');
  var t = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]) + n * 86400000);
  return t.toISOString().slice(0, 10);
}

function lean(id, type, status, extra) {
  return Object.assign({
    batch_id: id, status: status, batch_type: type, batch_type_source: 'recipe',
    start_date: d(-5), completed_day: null, completed_at: null, completed_at_source: null,
    vessel_id: 'V-' + id, source: 'kiosk', product_sku: '', product_name: 'P-' + id, product_subcategory: '',
    product_brand: '', product_manufacturer: '', recipe_id: '', schedule_id: '',
    schedule_category: '', target_volume_l: 20, tasks_total: 0, tasks_done: 0
  }, extra || {});
}

// Deterministic pseudo-random fixture spanning two years, all types, sources and statuses.
function bigFixture() {
  var seed = 12345;
  function rnd(n) { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; }
  var types = ['wine', 'wine', 'wine', 'beer', 'beer', 'cider', 'cider', 'seltzer'];
  var sources = ['kiosk', 'online', 'manual', '', 'zoho_scan', 'kiosk_recipe', 'research'];
  var statuses = ['pending', 'primary', 'primary', 'secondary', 'complete', 'complete', 'complete', 'complete', 'disabled'];
  var out = [];
  for (var i = 0; i < 160; i++) {
    var start = -rnd(700) - 1;
    var status = statuses[rnd(statuses.length)];
    var span = 14 + rnd(60);
    var done = null;
    if (status === 'complete') done = Math.min(start + span, -1);
    var extra = {
      source: sources[rnd(sources.length)],
      start_date: d(start),
      vessel_id: rnd(5) === 0 ? '' : 'V' + rnd(30),
      product_sku: 'SKU' + rnd(6),
      product_name: 'Product ' + rnd(8),
      recipe_id: rnd(2) ? 'R' + rnd(5) : '',
      target_volume_l: rnd(3) === 0 ? 0 : 20 + rnd(30)
    };
    if (done !== null) { extra.completed_day = d(done); extra.completed_at = d(done) + 'T18:00:00Z'; }
    out.push(lean('B' + (1000 + i), types[rnd(types.length)], status, extra));
  }
  return out;
}

function staffMap(rowsIn) {
  var m = {};
  rowsIn.forEach(function (r, i) { if (i % 7 === 0) m[r.batch_id] = true; });
  return m;
}

function readySet(rowsIn) {
  var m = {};
  rowsIn.forEach(function (r, i) { if ((r.status === 'primary' || r.status === 'secondary') && i % 3 === 0) m[r.batch_id] = true; });
  return m;
}

function sum(a) { return a.reduce(function (x, y) { return x + y; }, 0); }

describe('cross-widget agreement over the filter matrix', function () {
  var rows = bigFixture();
  var staff = staffMap(rows);
  var ready = readySet(rows);
  var types = ['all', 'wine', 'beer', 'cider'];
  var periods = ['ytd', '90d', 'all'];
  var sources = ['all', 'kiosk', 'unknown'];
  var measures = ['batches', 'litres'];
  var groups = ['month', 'week'];

  function combos(staffFlag) {
    var out = [];
    types.forEach(function (ty) { periods.forEach(function (pe) { sources.forEach(function (so) { measures.forEach(function (me) { groups.forEach(function (gr) {
      out.push({ type: ty, period: pe, source: so, measure: me, group: gr, staff: staffFlag, from: '', to: '' });
    }); }); }); }); });
    return out;
  }

  function label(st) { return JSON.stringify(st); }

  test('fixture is non-trivial', function () {
    var m = bp.buildDashV2Model(rows, ASOF, Object.assign({}, bp.DASH_FILTER_DEFAULTS, { period: 'all' }), staff, {});
    expect(m.cur.started).toBeGreaterThan(50);
    expect(m.cur.completed).toBeGreaterThan(10);
    expect(m.cur.activeNow).toBeGreaterThan(5);
    expect(m.cur.cycle.n).toBeGreaterThan(5);
  });

  ['0', '1'].forEach(function (staffFlag) {
    test('G1, G2 and G3 agree with the tiles (staff=' + staffFlag + ')', function () {
      combos(staffFlag).forEach(function (st) {
        var model = bp.buildDashV2Model(rows, ASOF, st, staff, {});
        var cur = model.cur;
        var lit = st.measure === 'litres';
        var g1s = bp.buildG1Model(model, 'started');
        var g1c = bp.buildG1Model(model, 'completed');
        var tol = 0.1 * Math.max(1, g1s.totals.length) + 0.01;
        if (lit) {
          expect(Math.abs(sum(g1s.totals) - cur.litres.started)).toBeLessThan(tol);
          expect(Math.abs(sum(g1c.totals) - cur.litres.completed)).toBeLessThan(0.1 * Math.max(1, g1c.totals.length) + 0.01);
        } else {
          expect([label(st), sum(g1s.totals)]).toEqual([label(st), cur.started]);
          expect([label(st), sum(g1c.totals)]).toEqual([label(st), cur.completed]);
        }
        var g2 = bp.buildG2Model(rows, model, { staffIds: staff, catMap: {}, readyIds: ready });
        function stageTotal(k) {
          for (var i = 0; i < g2.stages.length; i++) { if (g2.stages[i].key === k) return g2.stages[i].ids.length; }
          return 0;
        }
        expect([label(st), stageTotal('primary') + stageTotal('secondary') + stageTotal('ready')]).toEqual([label(st), cur.activeNow]);
        expect([label(st), stageTotal('complete')]).toEqual([label(st), cur.completed]);
        var g3 = bp.buildG3Model(rows, model, { staffIds: staff, catMap: {}, batchMeta: {} });
        expect([label(st), g3.n]).toEqual([label(st), cur.cycle.n]);
      });
    });
  });

  test('G4, Top 10 and G9 (staff included) equal Started; G9 buckets equal G1 buckets', function () {
    combos('1').forEach(function (st) {
      var model = bp.buildDashV2Model(rows, ASOF, st, staff, {});
      var cur = model.cur;
      ['wine', 'beer', 'cider'].forEach(function (t) {
        if (st.type !== 'all' && st.type !== t) return;
        var g4 = bp.buildG4Model(rows, model, { staffIds: staff, catMap: {}, type: t });
        if (st.measure === 'batches') {
          expect([label(st), t, g4.total]).toEqual([label(st), t, cur.ids.startedByType[t].length]);
        }
      });
      var g9 = bp.buildG9Model(rows, model, { mode: 'count', staffIds: staff, catMap: {} });
      var g1 = bp.buildG1Model(model, 'started');
      expect(g9.totals.length).toBe(g1.totals.length);
      for (var i = 0; i < g9.totals.length; i++) {
        expect([label(st), i, Math.round(g9.totals[i] * 10) / 10]).toEqual([label(st), i, g1.totals[i]]);
      }
    });
  });

  test('Beer and cider appear as their own series wherever wine does', function () {
    var st = Object.assign({}, bp.DASH_FILTER_DEFAULTS, { period: 'all', type: 'all' });
    var model = bp.buildDashV2Model(rows, ASOF, st, staff, {});
    function labels(g) { return g.series.map(function (s) { return s.label; }); }
    ['Wine', 'Cider', 'Beer'].forEach(function (name) {
      expect(labels(bp.buildG1Model(model, 'started'))).toContain(name);
      expect(labels(bp.buildG2Model(rows, model, { staffIds: staff, catMap: {}, readyIds: ready }))).toContain(name);
      expect(labels(bp.buildG3Model(rows, model, { staffIds: staff, catMap: {}, batchMeta: {} }))).toContain(name);
      var hdr = bp.buildG2Model(rows, model, { staffIds: staff, catMap: {}, readyIds: ready }).table.columns.map(function (c) { return c.label; });
      expect(hdr).toContain(name);
    });
    var small = [
      lean('T1', 'wine', 'primary', { recipe_id: 'RW' }),
      lean('T2', 'beer', 'primary', { recipe_id: 'RB' }),
      lean('T3', 'cider', 'primary', { recipe_id: 'RC' })
    ];
    var smallModel = bp.buildDashV2Model(small, ASOF, st, {}, {});
    var top = bp.buildTop10Model(small, smallModel, { metaById: {}, staffIds: {}, catMap: {} });
    var types = top.table.rows.map(function (r) { return r.cells[2].text; });
    expect(types.indexOf('Beer')).toBeGreaterThan(-1);
    expect(types.indexOf('Cider')).toBeGreaterThan(-1);
    var g4 = bp.buildG4Model(rows, model, { staffIds: staff, catMap: {} });
    expect(g4.typeChoices.map(function (c) { return c[1]; })).toEqual(['Wine', 'Cider', 'Beer']);
    var gm = bp.buildDashV2Model(small, ASOF, st, {}, {});
    var g8 = bp.buildG8Model(small, [
      { batch_id: 'T2', reading_day: d(-3), degrees_plato: 12 },
      { batch_id: 'T3', reading_day: d(-3), degrees_plato: 11 }
    ], {}, gm, {});
    var legend = JSON.stringify(g8.legend);
    expect(legend).toContain('Beer');
    expect(legend).toContain('Cider');
  });
});

describe('whole-page render', function () {
  function makeFakeChart() {
    function FakeChart(canvas, config) { this.canvas = canvas; this.config = config; }
    FakeChart.prototype.destroy = function () {};
    FakeChart.prototype.resize = function () {};
    FakeChart.prototype.getElementsAtEventForMode = function () { return []; };
    FakeChart.getChart = function () { return null; };
    FakeChart.defaults = { font: {} };
    return FakeChart;
  }

  var BANNED = ['double-booked', 'conflict', 'unbilled', 'on-time rate', 'completions by staff'];
  var SLOTS = ['period', 'pipeline', 'cycle', 'wine', 'source', 'workload', 'tasks', 'vessels', 'ferment', 'health'];

  function fullDash(rowsIn) {
    var staffIds = Object.keys(staffMap(rowsIn));
    var active = rowsIn.filter(function (r) { return r.status === 'primary' || r.status === 'secondary'; });
    var readyList = active.filter(function (r, i) { return i % 3 === 0; }).map(function (r) { return { batch_id: r.batch_id }; });
    var beerCider = active.filter(function (r) { return r.batch_type === 'beer' || r.batch_type === 'cider'; });
    var taskRows = [];
    active.forEach(function (r, i) {
      taskRows.push({ batch_id: r.batch_id, task_id: 't' + i, title: i % 2 ? 'Filtering' : 'Racking', due_date: d(i % 20 - 5), completed: false, completed_day: null, is_packaging: false, is_transfer: false });
    });
    var readings = [];
    beerCider.slice(0, 4).forEach(function (r) {
      readings.push({ batch_id: r.batch_id, reading_day: d(-6), degrees_plato: 12 });
      readings.push({ batch_id: r.batch_id, reading_day: d(-2), degrees_plato: 7 });
    });
    return {
      asOf: ASOF,
      batches: rowsIn,
      staffBatchIds: staffIds,
      taskRows: taskRows,
      readings: readings,
      vessels: [{ vessel_id: 'V1', type: 'Carboy', capacity_liters: 23, archived: false }, { vessel_id: 'V2', type: 'Keg', capacity_liters: 50, archived: false }],
      batchMeta: rowsIn.map(function (r, i) { return { batch_id: r.batch_id, has_invoice_link: i % 2 === 0, og: null, target_fg: null, recipe_name: 'Rec', recipe_style: 'Style' }; }),
      summary: { readyToBottle: readyList }
    };
  }

  async function mount(dash, batchRows) {
    document.body.innerHTML =
      '<div><button type="button" id="bp-dash-switch" hidden></button></div>' +
      '<div id="bp-dashboard-inner"></div><div id="bp-panel-dashboard"></div>' +
      '<div id="bp-panel-batches"><div id="bp-batch-list-pane"></div></div>' +
      '<div id="bp-batch-detail-pane"></div><div id="bp-toast-container"></div>';
    bp._setStateForTest({ _allBatchesData: batchRows, _dashData: dash, _dashSummary: {} });
    window.history.replaceState(null, '', '/brewpad.html?dash=v2');
    bp._initDashV2FlagForTest();
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    bp._renderDashboardForTest();
    await flush();
  }

  function slotText(name) {
    var el = document.getElementById('bp-dash-v2-' + name);
    return el ? el.textContent : '';
  }

  beforeEach(function () {
    window.localStorage.clear();
    Object.keys(bp._dashV2FrameForTest.opts).forEach(function (k) { delete bp._dashV2FrameForTest.opts[k]; });
    Object.keys(bp._dashV2FrameForTest.expanded).forEach(function (k) { delete bp._dashV2FrameForTest.expanded[k]; });
    bp._resetChartJsForTest();
    window.Chart = makeFakeChart();
    Array.prototype.forEach.call(document.head.querySelectorAll('script'), function (s) { s.parentNode.removeChild(s); });
  });

  afterEach(function () {
    delete window.Chart;
    window.localStorage.clear();
  });

  test('no banned words in either view; Fermentation and the two health-style widgets stay neutral', async function () {
    var data = bigFixture();
    await mount(fullDash(data), data);
    var shell = document.getElementById('bp-dash-v2');
    expect(shell).not.toBeNull();
    var chartText = shell.textContent.toLowerCase();
    // Open every accordion so the rows are covered too.
    Array.prototype.forEach.call(document.querySelectorAll('[data-dash-acc]'), function (b) { b.click(); });
    var toggles = document.querySelectorAll('[data-dash-w$=":view:table"]');
    expect(toggles.length).toBeGreaterThan(3);
    Array.prototype.forEach.call(toggles, function (b) {
      var again = document.querySelector('[data-dash-w="' + b.getAttribute('data-dash-w') + '"]');
      if (again) again.click();
    });
    var tableText = document.getElementById('bp-dash-v2').textContent.toLowerCase();
    BANNED.forEach(function (w) {
      expect(chartText).not.toContain(w);
      expect(tableText).not.toContain(w);
    });
    ['overdue', 'missing'].forEach(function (w) { expect(slotText('ferment').toLowerCase()).not.toContain(w); });
    expect(/\bdue\b/i.test(slotText('ferment'))).toBe(false);
    ['vessels', 'health'].forEach(function (n) { expect(slotText(n).toLowerCase()).not.toContain('error'); });
  });

  test('before data exists no widget shows a zero', async function () {
    await mount(null, []);
    expect(slotText('period').length).toBeGreaterThan(0);
    SLOTS.forEach(function (n) {
      var t = slotText(n);
      expect([n, /(^|\s)0(\s|$)/.test(t)]).toEqual([n, false]);
      expect(t).not.toContain('0 batches');
    });
  });

  test('sheets mode: batch-only widgets render from the list, server-array widgets say not available', async function () {
    var data = bigFixture();
    await mount(null, data);
    ['workload', 'tasks', 'vessels', 'ferment', 'health'].forEach(function (n) {
      expect([n, slotText(n)]).toEqual([n, expect.stringContaining('Not available yet')]);
    });
    ['period', 'pipeline', 'cycle', 'wine', 'source'].forEach(function (n) {
      var t = slotText(n);
      expect(t.length).toBeGreaterThan(0);
      expect(t).not.toContain('Not available yet');
    });
  });
});
