'use strict';

// BrewPad status chips after a save (2026-10-22, owner report).
//
// Bug 1 — "all the batch data disappears midway through a session": a save that
// touches the batch list (status, location, invoice link, ...) calls
// afterBatchWrite, which empties _allBatchesData so the next load refetches.
// Phase 90 taught the Unlinked and Ready-to-Bottle chips to reload an emptied list
// first, but Pending/Active/Primary/Secondary/Complete still filtered the empty
// array and rendered no batches at all until the tab was left and re-entered.

global.google = { accounts: { oauth2: { initTokenClient: jest.fn() } } };
global.fetch = jest.fn();
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

function batches() {
  return [
    { batch_id: 'SV-B-000215', product_name: 'Italy Nebbiolo Style', status: 'secondary', tasks_total: 4, tasks_done: 2 },
    { batch_id: 'SV-B-000216', product_name: 'Italy Nebbiolo Style', status: 'secondary', tasks_total: 4, tasks_done: 2 },
    { batch_id: 'SV-B-000300', product_name: 'Pale Ale', status: 'primary', tasks_total: 3, tasks_done: 0 }
  ];
}

function respondWithBatches(list) {
  global.fetch.mockImplementation(function () {
    return Promise.resolve({
      ok: true,
      status: 200,
      json: function () { return Promise.resolve({ ok: true, data: { batches: list } }); }
    });
  });
}

function chip(status) {
  var b = document.createElement('button');
  b.className = 'bp-filter-btn';
  b.setAttribute('data-status', status);
  return b;
}

function flush() { return new Promise(function (r) { setTimeout(r, 0); }); }

function cardIds() {
  return Array.prototype.map.call(document.querySelectorAll('.bp-batch-card'), function (c) {
    return c.getAttribute('data-batch-id');
  });
}

beforeEach(function () {
  global.fetch.mockReset();
  document.body.innerHTML = '<div id="bp-batch-list-pane"></div>';
});

describe('status chip after a list-affecting save', function () {
  ['secondary', 'primary', 'active', 'pending', 'complete'].forEach(function (status) {
    test(status + ' chip reloads the emptied list instead of showing no batches', async function () {
      bp._setStateForTest({ _allBatchesData: batches(), _batchStatusFilter: 'secondary', _batchesData: [] });
      bp.applyBatchFilter();
      bp._renderBatchListForTest();

      bp.afterBatchWrite('SV-B-000216', { listAffecting: true }); // empties the list (pinned elsewhere)
      expect(bp.getStateForTest()._allBatchesData).toEqual([]);

      respondWithBatches(batches());
      await bp.selectBatchStatusFilter(chip(status));
      await flush();

      var expected = batches().filter(function (b) {
        return status === 'active'
          ? ['primary', 'secondary', 'pending'].indexOf(b.status) !== -1
          : b.status === status;
      }).map(function (b) { return b.batch_id; });
      expect(global.fetch).toHaveBeenCalled();
      expect(bp.getStateForTest()._allBatchesData).toHaveLength(3);
      expect(cardIds().sort()).toEqual(expected.sort());
    });
  });

  test('with the list still loaded, a chip filters without refetching', async function () {
    bp._setStateForTest({ _allBatchesData: batches(), _batchStatusFilter: 'active', _batchesData: [] });
    bp.applyBatchFilter();
    bp._renderBatchListForTest();

    await bp.selectBatchStatusFilter(chip('primary'));

    expect(global.fetch).not.toHaveBeenCalled();
    expect(cardIds()).toEqual(['SV-B-000300']);
  });
});
