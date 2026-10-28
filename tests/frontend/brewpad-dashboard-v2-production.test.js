'use strict';

// Phase 96-04: v2 production section, widget framework and G1 Production over time.

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
    _dashData: Object.assign({ asOf: ASOF, batches: list, staffBatchIds: o.staffIds || [] }, o.extra || {}),
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


describe('completedBuckets', function () {
  function data(group, win) {
    var list = rows();
    // reopened batch with a stale completed_day must never count
    list.push(lean('R1', 'wine', YEAR + '-01-02', { status: 'primary', completed_day: YEAR + '-02-11' }));
    return bp.getDashboardData(list, ASOF, { window: win, group: group, staffIds: {} });
  }
  ['ytd', '90d', 'all'].forEach(function (win) {
    ['month', 'week'].forEach(function (group) {
      test('sums agree with the Completed tile: ' + win + '/' + group, function () {
        var d = data(group, win);
        var cb = d.completedBuckets;
        expect(sum(cb.map(function (b) { return b.total; }))).toBe(d.completed);
        ['wine', 'cider', 'beer', 'seltzer', 'other'].forEach(function (t) {
          expect(sum(cb.map(function (b) { return b.counts[t]; }))).toBe(d.completedTotals.byType[t]);
        });
      });
    });
  });

  test('keys, litres and shape follow periodBuckets', function () {
    var d = data('month', 'ytd');
    var b = d.completedBuckets.filter(function (x) { return x.total > 0; })[0];
    expect(b.key).toBe(YEAR + '-02');
    expect(b.ids.wine).toEqual(['W2']);
    expect(b.all).toEqual(['W2']);
    expect(b.litres.wine).toBe(20);
    expect(b.totalLitres).toBe(20);
    expect(Object.keys(b).sort()).toEqual(Object.keys(d.periodBuckets[0]).sort());
  });

  test('week buckets are keyed on Monday', function () {
    var d = data('week', 'all');
    var b = d.completedBuckets.filter(function (x) { return x.total > 0; })[0];
    expect(new Date(b.key + 'T00:00:00Z').getUTCDay()).toBe(1);
  });

  test('no completed rows gives []; no group gives []', function () {
    var list = [lean('A', 'wine', YEAR + '-01-05')];
    expect(bp.getDashboardData(list, ASOF, { window: 'all', group: 'month' }).completedBuckets).toEqual([]);
    expect(bp.getDashboardData(rows(), ASOF, { window: 'ytd' }).completedBuckets).toEqual([]);
  });

  test('periodBuckets still sum to the Started tile', function () {
    var d = data('month', 'ytd');
    expect(sum(d.periodBuckets.map(function (b) { return b.total; }))).toBe(d.started);
  });
});
