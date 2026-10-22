'use strict';

// BrewPad list card task counts (2026-10-22, owner report).
//
// A task ticked in the detail pane left the list card's "N/M tasks"
// count stale (the detail said 3/4, the card said 2/4): task writes deliberately
// keep the cached list (listAffecting:false, WR-01), so nothing updated the count.

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

describe('list card task count after a task tick', function () {
  function mount() {
    bp._setStateForTest({ _allBatchesData: batches(), _batchStatusFilter: 'secondary', _batchesData: [] });
    bp.applyBatchFilter();
    bp._renderBatchListForTest();
  }

  function cardText(id) {
    return document.querySelector('.bp-batch-card[data-batch-id="' + id + '"]').textContent;
  }

  test('ticking a task updates that card from 2/4 to 3/4', function () {
    mount();
    expect(cardText('SV-B-000216')).toContain('2/4 tasks');

    bp.applyTaskToggleToList('SV-B-000216', true);

    expect(cardText('SV-B-000216')).toContain('3/4 tasks');
    expect(cardText('SV-B-000215')).toContain('2/4 tasks'); // other batches untouched
  });

  test('unticking lowers the count, and it never leaves 0..total', function () {
    mount();
    bp.applyTaskToggleToList('SV-B-000216', false);
    expect(cardText('SV-B-000216')).toContain('1/4 tasks');

    bp.applyTaskToggleToList('SV-B-000300', false); // already 0
    var row = bp.getStateForTest()._allBatchesData.filter(function (b) { return b.batch_id === 'SV-B-000300'; })[0];
    expect(row.tasks_done).toBe(0);

    bp.applyTaskToggleToList('SV-B-000215', true);
    bp.applyTaskToggleToList('SV-B-000215', true);
    bp.applyTaskToggleToList('SV-B-000215', true); // would be 5/4
    expect(cardText('SV-B-000215')).toContain('4/4 tasks');
  });

  test('a batch that is not in the cached list is ignored', function () {
    mount();
    expect(function () { bp.applyTaskToggleToList('SV-B-999999', true); }).not.toThrow();
  });
});

describe('exact task count from a refreshed batch detail', function () {
  test('sets the card count from the fresh task list (corrects a quick tick-untick)', function () {
    bp._setStateForTest({ _allBatchesData: batches(), _batchStatusFilter: 'secondary', _batchesData: [] });
    bp.applyBatchFilter();
    bp._renderBatchListForTest();
    bp.applyTaskToggleToList('SV-B-000216', true); // optimistic 3/4

    bp.syncListTaskCounts('SV-B-000216', [
      { task_id: 'a', completed: 'TRUE' }, { task_id: 'b', completed: true },
      { task_id: 'c', completed: 'FALSE' }, { task_id: 'd', completed: '' }
    ]);

    var text = document.querySelector('.bp-batch-card[data-batch-id="SV-B-000216"]').textContent;
    expect(text).toContain('2/4 tasks');
  });

  test('ignores a missing task list', function () {
    bp._setStateForTest({ _allBatchesData: batches(), _batchStatusFilter: 'secondary', _batchesData: [] });
    expect(function () { bp.syncListTaskCounts('SV-B-000216', undefined); }).not.toThrow();
    var row = bp.getStateForTest()._allBatchesData.filter(function (b) { return b.batch_id === 'SV-B-000216'; })[0];
    expect(row.tasks_done).toBe(2);
  });
});
