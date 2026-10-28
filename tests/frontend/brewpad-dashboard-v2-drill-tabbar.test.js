'use strict';

// Phase 95-10 UAT fix: a dashboard drill must not survive the owner tapping the bottom Batches tab.
// Only a dashboard click opens a filtered list; the tab bar always shows the normal list.

global.google = { accounts: { oauth2: { initTokenClient: jest.fn() } } };
global.fetch = jest.fn();
global.sessionStorage = {
  _d: {},
  getItem: function (k) { return this._d[k] !== undefined ? this._d[k] : null; },
  setItem: function (k, v) { this._d[k] = v; },
  removeItem: function (k) { delete this._d[k]; },
  clear: function () { this._d = {}; }
};

var _auth = require('../../js/lib/auth');
global.waitForGoogleIdentity = _auth.waitForGoogleIdentity;
global.gsiInitTokenClient = _auth.gsiInitTokenClient;
global.fetchGoogleUserInfo = _auth.fetchGoogleUserInfo;

var bp = require('../../js/brewpad');

function rows() {
  return [
    { batch_id: 'A', product_name: 'PA', status: 'primary', zoho_so_number: '' },
    { batch_id: 'B', product_name: 'PB', status: 'primary', zoho_so_number: 'INV-1' },
    { batch_id: 'C', product_name: 'PC', status: 'complete', zoho_so_number: 'INV-2' }
  ];
}

function cardIds() {
  return Array.prototype.map.call(document.querySelectorAll('.bp-batch-card'), function (c) {
    return c.getAttribute('data-batch-id');
  }).sort();
}

beforeEach(function () {
  global.fetch.mockReset();
  // Switching to the dashboard tab starts a data fetch; keep it pending so the test stays offline.
  global.fetch.mockReturnValue(new Promise(function () {}));
  document.body.innerHTML = '<div id="bp-panel-dashboard"></div>' +
    '<div id="bp-panel-batches"><div id="bp-batch-list-pane"></div></div>';
  bp._setStateForTest({ _allBatchesData: rows(), _batchStatusFilter: 'active', _batchesData: [] });
  bp._clearDashDrillForTest();
});

afterEach(function () {
  bp._clearDashDrillForTest();
});

describe('bottom tab bar clears a dashboard drill', function () {
  test('tapping the Batches tab after a drill shows the normal active list with no banner', function () {
    bp._openDashDrillForTest({ ids: ['C'], label: 'From dashboard: Completed YTD · 1 batch' });
    expect(cardIds()).toEqual(['C']);

    bp._handleTabBarClickForTest('dashboard');
    bp._handleTabBarClickForTest('batches');

    var st = bp.getStateForTest();
    expect(st._dashDrill).toBeNull();
    expect(st._batchStatusFilter).toBe('active');
    expect(document.querySelector('.bp-drill-banner')).toBeNull();
    expect(cardIds()).toEqual(['A', 'B']);
  });

  test('tapping a non-Batches tab leaves the drill alone', function () {
    bp._openDashDrillForTest({ ids: ['C'], label: 'From dashboard: Completed YTD · 1 batch' });
    bp._handleTabBarClickForTest('dashboard');
    expect(bp.getStateForTest()._dashDrill).not.toBeNull();
  });

  test('tapping the Batches tab with no drill keeps the chosen status chip', function () {
    bp._setStateForTest({ _batchStatusFilter: 'complete' });
    bp._handleTabBarClickForTest('batches');
    expect(bp.getStateForTest()._batchStatusFilter).toBe('complete');
  });
});
