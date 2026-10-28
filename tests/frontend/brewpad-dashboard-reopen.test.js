'use strict';

// Phase 94 review CR-01: a reopened (primary/secondary) batch that still carries a completion
// day must not be counted as completed.

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

function row(id, status, completedDay) {
  return {
    batch_id: id, status: status, batch_type: 'beer', batch_type_source: 'recipe',
    start_date: '2026-03-01', completed_day: completedDay, completed_at: null, completed_at_source: null,
    vessel_id: null, source: 'kiosk', product_sku: '', product_name: '', product_subcategory: '',
    product_brand: '', product_manufacturer: '', recipe_id: '', schedule_id: '',
    schedule_category: '', target_volume_l: null, tasks_total: 0, tasks_done: 0
  };
}

describe('getDashboardData: completions count only complete batches', function () {
  test('a reopened batch with a stale completion day is fermenting, not completed', function () {
    var d = bp.getDashboardData([
      row('done', 'complete', '2026-04-01'),
      row('reopened', 'primary', '2026-04-01'),
      row('reopened2', 'secondary', '2026-04-02')
    ], ASOF, {});
    expect(d.activeNow).toBe(2);
    expect(d.completed).toBe(1);
    expect(d.completedTotals.byType.beer).toBe(1);
  });
});
