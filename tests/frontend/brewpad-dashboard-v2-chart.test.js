'use strict';

// Phase 95-05 Task 2: lazy Chart.js loader, theme reader and chart() helper (fake Chart).

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

function makeFakeChart() {
  function FakeChart(canvas, config) {
    this.canvas = canvas;
    this.config = config;
    this.destroyed = false;
    this.resizes = 0;
    FakeChart.instances.push(this);
  }
  FakeChart.instances = [];
  FakeChart.hits = [];
  FakeChart.prototype.destroy = function () { this.destroyed = true; };
  FakeChart.prototype.resize = function () { this.resizes++; };
  FakeChart.prototype.getElementsAtEventForMode = function (evt, mode) {
    return FakeChart.hits[mode] || [];
  };
  FakeChart.getChart = function (canvas) {
    for (var i = FakeChart.instances.length - 1; i >= 0; i--) {
      if (FakeChart.instances[i].canvas === canvas && !FakeChart.instances[i].destroyed) return FakeChart.instances[i];
    }
    return undefined;
  };
  FakeChart.defaults = { font: {} };
  return FakeChart;
}

function scripts() {
  return Array.prototype.filter.call(document.head.querySelectorAll('script'), function (s) {
    return /chart\.umd\.min\.js/.test(s.getAttribute('src') || '');
  });
}

var SERIES = [
  { key: 'wine', label: 'Wine', data: [10, 20, 33], colour: '#6e1a2c' },
  { key: 'beer', label: 'Beer', data: [1, 2, 3], colour: '#9a4e0c' }
];

function cfg(over) {
  var c = {
    type: 'bar', labels: ['a', 'b', 'c'], series: SERIES, stacked: true, horizontal: false,
    measure: 'batches', ariaLabel: 'Batches by type', tooltipTotal: true, onClick: jest.fn()
  };
  for (var k in over) c[k] = over[k];
  return c;
}

beforeEach(function () {
  delete window.Chart;
  bp._resetChartJsForTest();
  document.head.innerHTML = '';
  window.matchMedia = function () { return { matches: false }; };
});

describe('loadChartJs', function () {
  test('resolves immediately when window.Chart exists, no script appended', function () {
    window.Chart = makeFakeChart();
    return bp._loadChartJsForTest().then(function (C) {
      expect(C).toBe(window.Chart);
      expect(scripts().length).toBe(0);
    });
  });

  test('injects one versioned script, caches the promise, resolves on load', function () {
    var p1 = bp._loadChartJsForTest();
    var p2 = bp._loadChartJsForTest();
    expect(p1).toBe(p2);
    var s = scripts();
    expect(s.length).toBe(1);
    expect(s[0].getAttribute('src')).toMatch(/js\/vendor\/chart\.umd\.min\.js\?v=4\.5\.1$/);
    window.Chart = makeFakeChart();
    s[0].onload();
    return p1.then(function (C) {
      expect(C).toBe(window.Chart);
      expect(C.defaults.font.family).toBeTruthy();
    });
  });

  test('after onerror the cache is cleared and a new script is appended', function () {
    var p1 = bp._loadChartJsForTest();
    scripts()[0].onerror();
    return p1.then(function () { throw new Error('should reject'); }, function () {
      var p2 = bp._loadChartJsForTest();
      expect(p2).not.toBe(p1);
      expect(scripts().length).toBe(1);
      window.Chart = makeFakeChart();
      scripts()[0].onload();
      return p2;
    });
  });
});

describe('readChartTheme', function () {
  test('falls back to brand hexes in jsdom', function () {
    var t = bp.readChartTheme();
    expect(t.wine).toBe('#6e1a2c');
    expect(t.cider).toBe('#a8841a');
    expect(t.beer).toBe('#9a4e0c');
    expect(t.other).toBe('#9a8672');
    expect(typeof t.separator).toBe('string');
    expect(typeof t.font).toBe('string');
  });
});

describe('chart()', function () {
  var Fake;
  var canvas;
  beforeEach(function () {
    Fake = makeFakeChart();
    window.Chart = Fake;
    canvas = document.createElement('canvas');
  });

  test('destroys the previous chart on the same canvas', function () {
    var a = bp._chartForTest(canvas, cfg());
    var b = bp._chartForTest(canvas, cfg());
    expect(a.destroyed).toBe(true);
    expect(b.destroyed).toBe(false);
  });

  test('builds the Chart.js config', function () {
    var c = bp._chartForTest(canvas, cfg());
    var conf = c.config;
    expect(conf.type).toBe('bar');
    expect(conf.data.labels).toEqual(['a', 'b', 'c']);
    expect(conf.data.datasets.length).toBe(2);
    expect(conf.data.datasets[0].backgroundColor).toBe('#6e1a2c');
    expect(conf.data.datasets[1].backgroundColor).toBe('#9a4e0c');
    expect(conf.data.datasets[0].borderWidth).toBe(2);
    expect(conf.data.datasets[0].borderColor).toBe(bp.readChartTheme().separator);
    expect(conf.options.responsive).toBe(true);
    expect(conf.options.maintainAspectRatio).toBe(false);
    expect(conf.options.plugins.legend.display).toBe(false);
    expect(conf.options.interaction).toEqual({ mode: 'index', intersect: false });
    expect(conf.options.scales.y.beginAtZero).toBe(true);
    expect(conf.options.scales.y.ticks.precision).toBe(0);
    expect(conf.options.indexAxis).toBeUndefined();
    expect(conf.options.animation === false || conf.options.animation.duration <= 200).toBe(true);
  });

  test('litres ticks format with thousands separator and L', function () {
    var c = bp._chartForTest(canvas, cfg({ measure: 'litres' }));
    expect(c.config.options.scales.y.ticks.callback(1250)).toBe('1,250 L');
  });

  test('horizontal uses indexAxis y', function () {
    var c = bp._chartForTest(canvas, cfg({ horizontal: true }));
    expect(c.config.options.indexAxis).toBe('y');
  });

  test('reduced motion disables animation', function () {
    window.matchMedia = function () { return { matches: true }; };
    var c = bp._chartForTest(canvas, cfg());
    expect(c.config.options.animation).toBe(false);
  });

  test('canvas gets role and aria-label', function () {
    bp._chartForTest(canvas, cfg({ ariaLabel: 'Hello chart' }));
    expect(canvas.getAttribute('role')).toBe('img');
    expect(canvas.getAttribute('aria-label')).toBe('Hello chart');
  });

  test('click routing: nearest hit gives index and series key', function () {
    var conf = cfg();
    var c = bp._chartForTest(canvas, conf);
    Fake.hits.nearest = [{ index: 2, datasetIndex: 1 }];
    c.config.options.onClick({}, []);
    expect(conf.onClick).toHaveBeenCalledWith({ index: 2, key: 'beer' });
    expect(canvas.style.cursor).toBe('pointer');
  });

  test('click routing: index hit only gives whole column', function () {
    var conf = cfg();
    var c = bp._chartForTest(canvas, conf);
    Fake.hits.nearest = [];
    Fake.hits.index = [{ index: 2, datasetIndex: 0 }];
    c.config.options.onClick({}, []);
    expect(conf.onClick).toHaveBeenCalledWith({ index: 2, key: null });
  });

  test('click routing: no hit does nothing', function () {
    var conf = cfg();
    var c = bp._chartForTest(canvas, conf);
    c.config.options.onClick({}, []);
    expect(conf.onClick).not.toHaveBeenCalled();
  });

  test('tooltip label and footer', function () {
    var c = bp._chartForTest(canvas, cfg());
    var cb = c.config.options.plugins.tooltip.callbacks;
    expect(cb.label({ dataset: { label: 'Wine' }, parsed: { y: 33 } })).toBe('Wine: 33 batches');
    var total = cb.footer([{ parsed: { y: 33 } }, { parsed: { y: 12 } }]);
    expect(total).toBe('Total: 45');
    var cl = bp._chartForTest(document.createElement('canvas'), cfg({ measure: 'litres' }));
    expect(cl.config.options.plugins.tooltip.callbacks.label({ dataset: { label: 'Wine' }, parsed: { y: 759 } })).toBe('Wine: 759 L');
  });
});
