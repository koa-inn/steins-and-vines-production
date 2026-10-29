'use strict';

// Phase 96-09: G10 Data health.

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

function rows() {
  return [
    lean('A1', 'wine', 'primary', { vessel_id: '' }),
    lean('A2', 'beer', 'secondary', { vessel_id: null, start_date: d(-120) }),
    lean('C1', 'wine', 'complete', { completed_at: null }),
    lean('C2', 'cider', 'complete', { completed_at: d(-1) + 'T10:00:00Z' }),
    lean('S1', 'wine', 'primary', { source: '' }),
    lean('I1', 'wine', 'primary', { source: 'internal' }),
    lean('X1', 'wine', 'disabled', { vessel_id: '', source: '' }),
    lean('SH1', 'wine', 'primary', { vessel_id: 'SHARED' }),
    lean('SH2', 'wine', 'primary', { vessel_id: 'SHARED' })
  ];
}

function meta() {
  return [
    { batch_id: 'A1', has_invoice_link: false },
    { batch_id: 'A2', has_invoice_link: false },
    { batch_id: 'C1', has_invoice_link: true },
    { batch_id: 'S1', has_invoice_link: false },
    { batch_id: 'I1', has_invoice_link: false },
    { batch_id: 'X1', has_invoice_link: false }
  ];
}

function metaMap(list) {
  var m = {};
  list.forEach(function (x) { m[x.batch_id] = x; });
  return m;
}

function ids(cat) { return cat.items.map(function (i) { return i.primary; }); }
function cat(g, key) { return g.cats.filter(function (c) { return c.key === key; })[0]; }

describe('buildG10Model', function () {
  var g = bp.buildG10Model(rows(), metaMap(meta()), { today: TODAY });

  test('categories in the specified order', function () {
    expect(bp.DASH_HEALTH_CATS.map(function (c) { return c.label; })).toEqual(
      ['No vessel', 'Missing completion date', 'No invoice link', 'Blank source', 'Stale active batches']);
    expect(g.cats.map(function (c) { return c.label; })).toEqual(
      ['No vessel', 'Missing completion date', 'No invoice link', 'Blank source', 'Stale active batches']);
  });

  test('each category predicate; disabled batches are excluded', function () {
    expect(ids(cat(g, 'novessel'))).toEqual(['A1', 'A2']);
    expect(ids(cat(g, 'nocompletedat'))).toEqual(['C1']);
    expect(ids(cat(g, 'noinvoice'))).toEqual(['A1', 'A2', 'S1']);
    expect(ids(cat(g, 'blanksource'))).toEqual(['S1']);
    expect(ids(cat(g, 'stale'))).toEqual(['A2']);
    expect(cat(g, 'stale').items[0].secondary).toContain('Active 120 days');
  });

  test('internal source never counts as no invoice link', function () {
    expect(ids(cat(g, 'noinvoice'))).not.toContain('I1');
  });

  test('a shared vessel never produces a row', function () {
    var all = [];
    g.cats.forEach(function (c) { all = all.concat(ids(c)); });
    expect(all).not.toContain('SH1');
    expect(all).not.toContain('SH2');
  });

  test('no vessel ids equal the G6 No vessel list', function () {
    var g6 = bp.buildG6Model(rows(), [], {});
    expect(ids(cat(g, 'novessel'))).toEqual(g6.noVessel.map(function (i) { return i.primary; }));
  });

  test('staff batches stay in and are tagged', function () {
    var gs = bp.buildG10Model(rows(), metaMap(meta()), { today: TODAY, staffIds: { A1: true } });
    expect(cat(gs, 'novessel').items[0].secondary).toContain('Staff batch');
  });

  test('all zero', function () {
    var gz = bp.buildG10Model([lean('Z', 'wine', 'primary')], metaMap([{ batch_id: 'Z', has_invoice_link: true }]), { today: TODAY });
    expect(gz.allZero).toBe(true);
  });
});

describe('G10 renderer', function () {
  function makeFakeChart() {
    function FakeChart(canvas, config) { this.canvas = canvas; this.config = config; }
    FakeChart.prototype.destroy = function () {};
    FakeChart.prototype.resize = function () {};
    FakeChart.prototype.getElementsAtEventForMode = function () { return []; };
    FakeChart.getChart = function () { return null; };
    FakeChart.defaults = { font: {} };
    return FakeChart;
  }

  async function renderV2(dash, batchRows) {
    var r = batchRows || rows();
    document.body.innerHTML =
      '<div><button type="button" id="bp-dash-switch" hidden></button></div>' +
      '<div id="bp-dashboard-inner"></div><div id="bp-panel-dashboard"></div>' +
      '<div id="bp-panel-batches"><div id="bp-batch-list-pane"></div></div>' +
      '<div id="bp-batch-detail-pane"></div><div id="bp-toast-container"></div>';
    bp._setStateForTest({
      _allBatchesData: r,
      _dashData: Object.assign({ asOf: ASOF, batches: r, staffBatchIds: [], batchMeta: meta(), vessels: [], readings: [] }, dash),
      _dashSummary: {}
    });
    window.history.replaceState(null, '', '/brewpad.html?dash=v2');
    bp._initDashV2FlagForTest();
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    bp._renderDashboardForTest();
    await flush();
  }

  function drill() { return bp.getStateForTest()._dashDrill; }
  function slotText() { return document.getElementById('bp-dash-v2-health').textContent; }

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

  test('title, subtitle, note; never says unbilled', async function () {
    await renderV2({});
    expect(document.querySelector('#bp-dash-v2-health .bp-widget-title').textContent).toBe('Data health');
    expect(document.querySelector('#bp-dash-v2-health .bp-widget-sub').textContent).toBe('All batches · ignores the filters above');
    expect(slotText()).toContain('no Zoho sales order');
    expect(slotText().toLowerCase()).not.toContain('unbilled');
    expect(slotText().toLowerCase()).not.toContain('error');
  });

  test('categories render as collapsed accordions with counts; zero rows are not expandable', async function () {
    await renderV2({});
    var heads = document.querySelectorAll('#bp-dash-v2-health .bp-accordion-head');
    expect(heads.length).toBe(5);
    expect(heads[0].getAttribute('aria-expanded')).toBe('false');
    expect(heads[0].textContent).toContain('No vessel');
    expect(heads[0].textContent).toContain('2');
    var rowsOnly = bp.buildG10Model(rows().slice(0, 1), metaMap([{ batch_id: 'A1', has_invoice_link: true }]), { today: TODAY });
    expect(rowsOnly.cats.length).toBe(5);
    expect(document.querySelectorAll('#bp-dash-v2-health .bp-list-row').length).toBe(0);
  });

  test('zero categories show 0 check and are not buttons; all zero shows the clean message', async function () {
    var clean = [lean('Z', 'wine', 'primary')];
    await renderV2({ batchMeta: [{ batch_id: 'Z', has_invoice_link: true }] }, clean);
    expect(document.querySelectorAll('#bp-dash-v2-health .bp-accordion-head').length).toBe(0);
    expect(document.querySelectorAll('#bp-dash-v2-health .bp-health-zero').length).toBe(5);
    expect(document.querySelector('.bp-health-zero').textContent).toBe('0 ✓');
    expect(slotText()).toContain('No data issues found.');
  });

  test('expanding shows rows, Open these batches drills with the exact banner', async function () {
    await renderV2({});
    document.querySelector('[data-dash-acc="g10:noinvoice"]').click();
    var head = document.querySelector('[data-dash-acc="g10:noinvoice"]');
    expect(head.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(head);
    var btn = Array.prototype.filter.call(document.querySelectorAll('#bp-dash-v2-health button'), function (b) { return b.textContent === 'Open these batches'; })[0];
    btn.click();
    expect(drill().label).toBe('From dashboard: No invoice link · 3 batches');
  });

  test('a single row opens the batch detail without a banner', async function () {
    await renderV2({});
    document.querySelector('[data-dash-acc="g10:nocompletedat"]').click();
    var row = document.querySelector('#bp-dash-v2-health .bp-list [data-dash-row]');
    row.click();
    expect(drill()).toBeNull();
    expect(bp.getStateForTest()._selectedBatchId).toBe('C1');
  });

  test('Show all after 5 rows', async function () {
    var many = [];
    for (var i = 0; i < 7; i++) many.push(lean('M' + i, 'wine', 'primary', { vessel_id: '' }));
    await renderV2({ batchMeta: [] }, many);
    document.querySelector('[data-dash-acc="g10:novessel"]').click();
    expect(document.querySelectorAll('#bp-dash-v2-health .bp-list-row').length).toBe(5);
    var all = document.querySelector('[data-dash-showall="g10:allnovessel"]');
    expect(all.textContent).toBe('Show all 7');
  });

  test('missing batchMeta shows the not-available message', async function () {
    await renderV2({ batchMeta: undefined });
    expect(slotText()).toContain('Not available yet. Reopen the Dashboard tab to refresh.');
  });

  test('an unknown accordion key is ignored', async function () {
    await renderV2({});
    var head = document.querySelector('[data-dash-acc="g10:stale"]');
    head.setAttribute('data-dash-acc', 'g10:bogus');
    head.click();
    expect(document.querySelectorAll('#bp-dash-v2-health [aria-expanded="true"]').length).toBe(0);
  });

  test('renders without Chart.js and injected names are escaped', async function () {
    delete window.Chart;
    var evil = [lean('E1', 'wine', 'primary', { vessel_id: '', product_name: '<img src=x onerror=alert(1)>' })];
    await renderV2({ batchMeta: [] }, evil);
    document.querySelector('[data-dash-acc="g10:novessel"]').click();
    expect(document.querySelector('#bp-dash-v2-health img')).toBeNull();
    expect(slotText()).toContain('<img');
  });

  // Staging UAT 2026-10-29: the button rendered as a bare browser button.
  test('Open these batches is a styled text button', async function () {
    await renderV2({});
    document.querySelector('[data-dash-acc="g10:noinvoice"]').click();
    var btn = Array.prototype.filter.call(document.querySelectorAll('#bp-dash-v2-health button'), function (b) { return b.textContent === 'Open these batches'; })[0];
    expect(btn.classList.contains('bp-text-btn')).toBe(true);
  });
});
