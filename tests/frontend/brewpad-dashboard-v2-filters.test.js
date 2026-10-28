'use strict';

// Phase 95-04 Task 1: v2 dashboard filter state (pure helpers).

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
var TODAY = '2026-10-23';
var D = bp.DASH_FILTER_DEFAULTS;

function withDefaults(o) {
  var out = {};
  Object.keys(D).forEach(function (k) { out[k] = D[k]; });
  Object.keys(o).forEach(function (k) { out[k] = o[k]; });
  return out;
}

describe('defaults and precedence', function () {
  test('defaults per D-05', function () {
    expect(D).toEqual({ type: 'all', period: 'ytd', group: 'month', measure: 'batches', source: 'all', staff: '0', from: '', to: '' });
    expect(bp.resolveDashFilters('', null, TODAY)).toEqual(D);
  });

  test('hash is authoritative over stored state', function () {
    var s = bp.resolveDashFilters('#dash=v2&type=beer', '{"type":"wine","group":"week"}', TODAY);
    expect(s.type).toBe('beer');
    expect(s.group).toBe('month');
  });

  test('default-view URL reproduces defaults despite non-default storage', function () {
    var s = bp.resolveDashFilters('#dash=v2', '{"type":"wine","group":"week","period":"90d"}', TODAY);
    expect(s).toEqual(D);
  });

  test('no dash state in URL falls back to localStorage', function () {
    var stored = '{"type":"wine","group":"week","period":"90d"}';
    ['', '#something-else'].forEach(function (h) {
      var s = bp.resolveDashFilters(h, stored, TODAY);
      expect(s.type).toBe('wine');
      expect(s.group).toBe('week');
      expect(s.period).toBe('90d');
    });
  });

  test('corrupt stored JSON yields defaults', function () {
    expect(bp.resolveDashFilters('', 'not json', TODAY)).toEqual(D);
  });
});

describe('serialize and round trip', function () {
  test('defaults serialise to dash=v2 only', function () {
    expect(bp.serializeDashFilters(D)).toBe('dash=v2');
  });

  test('non-default keys only, in fixed order', function () {
    expect(bp.serializeDashFilters(withDefaults({ type: 'wine', source: 'kiosk' }))).toBe('dash=v2&type=wine&source=kiosk');
  });

  test('round trips ten varied states', function () {
    var states = [
      {}, { type: 'wine' }, { type: 'beer', period: '90d' }, { type: 'cider', group: 'week' },
      { measure: 'litres' }, { source: 'zoho_scan' }, { staff: '1' }, { period: 'all', source: 'unknown' },
      { period: 'custom', from: '2026-06-01', to: '2026-07-15' },
      { type: 'wine', period: '6mo', group: 'week', measure: 'litres', source: 'online', staff: '1' }
    ];
    states.forEach(function (o) {
      var s = withDefaults(o);
      var hash = '#' + bp.serializeDashFilters(s);
      expect(bp.resolveDashFilters(hash, null, TODAY)).toEqual(s);
    });
  });

  test('from/to not written unless custom', function () {
    expect(bp.serializeDashFilters(withDefaults({ from: '2026-06-01', to: '2026-07-15' }))).toBe('dash=v2');
  });
});

describe('whitelisting', function () {
  test('invalid values fall back to defaults', function () {
    var s = bp.resolveDashFilters('#dash=v2&type=rum&period=7d&group=day&measure=kg&source=%3Cscript%3E&staff=yes', null, TODAY);
    expect(s).toEqual(D);
  });

  test('malformed percent-encoding is skipped without throwing', function () {
    var parsed;
    expect(function () { parsed = bp.parseDashHash('#type=wine&bad=%E0%A4%A&group=week'); }).not.toThrow();
    expect(parsed).toEqual({ type: 'wine', group: 'week' });
  });

  test('custom range validation', function () {
    var ok = bp.resolveDashFilters('#period=custom&from=2026-06-01&to=2026-07-15', null, TODAY);
    expect(ok.period).toBe('custom');
    expect(ok.from).toBe('2026-06-01');
    expect(ok.to).toBe('2026-07-15');
    ['#period=custom&from=2026-07-15&to=2026-06-01',
      '#period=custom&from=2026-06-01&to=2026-12-31',
      '#period=custom&from=2026-6-1&to=2026-07-15',
      '#period=custom&from=2026-02-30&to=2026-07-15',
      '#period=custom'].forEach(function (h) {
      var s = bp.resolveDashFilters(h, null, TODAY);
      expect(s.period).toBe('ytd');
      expect(s.from).toBe('');
      expect(s.to).toBe('');
    });
  });
});

describe('v2 opt-in flag', function () {
  test('rules', function () {
    expect(bp.dashV2FlagFrom('?dash=v2', '', null)).toEqual({ on: true, persist: '1' });
    expect(bp.dashV2FlagFrom('', '#dash=v2&type=wine', null)).toEqual({ on: true, persist: '1' });
    expect(bp.dashV2FlagFrom('?dash=v1', '', '1')).toEqual({ on: false, persist: '0' });
    expect(bp.dashV2FlagFrom('', '', '1')).toEqual({ on: true, persist: null });
    expect(bp.dashV2FlagFrom('', '', null)).toEqual({ on: false, persist: null });
  });
});

describe('display strings', function () {
  test('dashPeriodLabel', function () {
    expect(bp.dashPeriodLabel(withDefaults({ period: '30d' }))).toBe('30d');
    expect(bp.dashPeriodLabel(withDefaults({ period: '90d' }))).toBe('90d');
    expect(bp.dashPeriodLabel(withDefaults({ period: '6mo' }))).toBe('6m');
    expect(bp.dashPeriodLabel(withDefaults({ period: '12mo' }))).toBe('12m');
    expect(bp.dashPeriodLabel(D)).toBe('YTD');
    expect(bp.dashPeriodLabel(withDefaults({ period: 'all' }))).toBe('All');
    expect(bp.dashPeriodLabel(withDefaults({ period: 'custom', from: '2026-06-01', to: '2026-07-15' }))).toBe('Jun 1 – Jul 15');
  });

  test('dashFilterSummary', function () {
    expect(bp.dashFilterSummary(D)).toBe('YTD · Month · Batches · All');
    expect(bp.dashFilterSummary(withDefaults({ type: 'wine', group: 'week', measure: 'litres' }))).toBe('YTD · Week · Litres · Wine');
    expect(bp.dashFilterSummary(withDefaults({ source: 'kiosk', staff: '1' }))).toBe('YTD · Month · Batches · All · Kiosk · Staff');
  });

  test('countNonDefaultFilters', function () {
    expect(bp.countNonDefaultFilters(D)).toBe(0);
    expect(bp.countNonDefaultFilters(withDefaults({ type: 'wine', period: 'custom', from: '2026-06-01', to: '2026-07-15' }))).toBe(2);
  });
});

describe('purity', function () {
  test('no storage or history access', function () {
    var getSpy = jest.spyOn(Storage.prototype, 'getItem');
    var histSpy = jest.spyOn(window.history, 'replaceState');
    bp.parseDashHash('#dash=v2&type=wine');
    bp.sanitizeDashFilters({ type: 'wine' }, TODAY);
    bp.resolveDashFilters('#dash=v2', '{}', TODAY);
    bp.serializeDashFilters(D);
    bp.dashV2FlagFrom('?dash=v2', '', '1');
    expect(getSpy).not.toHaveBeenCalled();
    expect(histSpy).not.toHaveBeenCalled();
    histSpy.mockRestore();
    getSpy.mockRestore();
  });
});
