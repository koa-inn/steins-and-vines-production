'use strict';

// ---------------------------------------------------------------------------
// Owner ticket #2: mark-bottled staleness regression tests (WR-04 rewrite)
// ---------------------------------------------------------------------------
// Completing the Bottling/Packaging task checkbox must remove the batch from
// the Ready-to-Bottle list immediately, with no full page reload — AND must NOT
// blank the dashboard stat cards / month chart (WR-01).
//
// The previous version of this file was four indexOf() substring pins over the
// raw source. They never executed anything, so they could not catch CR-01 (the
// readyToBottle filter emptying on a re-derive), WR-01 (stat cards vanishing),
// or a broken loadDashboard() promise — and they broke on unrelated edits that
// shifted the scan window. They are replaced here with behavioral tests that
// exercise the actual seams the handlers use (afterBatchWrite, applyBatchFilter,
// _dashSummary re-derivation), plus a single robust structural guard that the
// freshness refetch (loadDashboard()) is still wired into each handler.
// ---------------------------------------------------------------------------

global.document = global.document || {};
global.window = global.window || {};
global.navigator = global.navigator || {};
global.google = { accounts: { oauth2: { initTokenClient: jest.fn() } } };
global.fetch = jest.fn();

var _auth = require('../../js/lib/auth');
global.waitForGoogleIdentity = _auth.waitForGoogleIdentity;
global.gsiInitTokenClient = _auth.gsiInitTokenClient;
global.fetchGoogleUserInfo = _auth.fetchGoogleUserInfo;

var bp = require('../../js/brewpad');

var BATCHES = [
  { batch_id: 'A', status: 'secondary', start_date: '2026-01-05' },
  { batch_id: 'B', status: 'secondary', start_date: '2026-02-05' },
  { batch_id: 'C', status: 'primary', start_date: '2026-03-05' }
];

describe('mark-bottled freshness — behavioral (#2 / WR-01)', function () {
  beforeEach(function () {
    // Reset sessionStorage so afterBatchWrite's snapshot removal doesn't throw.
    global.sessionStorage = {
      _d: {},
      getItem: function (k) { return this._d[k] || null; },
      setItem: function (k, v) { this._d[k] = String(v); },
      removeItem: function (k) { delete this._d[k]; }
    };
  });

  test('a task write does NOT blank the batch cache the dashboard stat cards depend on (WR-01)', function () {
    // renderDashboard() gates the stat-card grid + month chart on _allBatchesData.length > 0.
    // The three task-checkbox handlers must therefore use listAffecting:false so the
    // dashboard does not go empty after completing a task (freshness comes from
    // loadDashboard() refetching _dashSummary, not from clearing _allBatchesData).
    bp._setStateForTest({ _allBatchesData: BATCHES });
    bp.afterBatchWrite('A', { listAffecting: false });
    expect(bp.getStateForTest()._allBatchesData.length).toBe(3);
  });

  test('listAffecting:true DOES clear _allBatchesData — documents why the handlers must NOT use it', function () {
    bp._setStateForTest({ _allBatchesData: BATCHES });
    bp.afterBatchWrite('A', { listAffecting: true });
    expect(bp.getStateForTest()._allBatchesData.length).toBe(0);
  });

  test('completing a bottling task drops the batch from the Ready-to-Bottle view without reload', function () {
    // Simulate: readyToBottle filter active, server had A + C ready to bottle.
    bp._setStateForTest({
      _allBatchesData: BATCHES,
      _batchStatusFilter: 'readyToBottle',
      _dashSummary: { readyToBottle: [{ batch_id: 'A' }, { batch_id: 'C' }] },
      _batchesData: []
    });
    bp.applyBatchFilter();
    expect(bp.getStateForTest()._batchesData.map(function (b) { return b.batch_id; })).toEqual(['A', 'C']);

    // The handler completes A's bottling task → loadDashboard() refetches _dashSummary
    // (A now gone) → re-derive. _allBatchesData is preserved (listAffecting:false).
    bp.afterBatchWrite('A', { listAffecting: false });
    bp._setStateForTest({ _dashSummary: { readyToBottle: [{ batch_id: 'C' }] } });
    bp.applyBatchFilter();
    expect(bp.getStateForTest()._batchesData.map(function (b) { return b.batch_id; })).toEqual(['C']);
    // And the batch cache is still intact so the dashboard stat cards render.
    expect(bp.getStateForTest()._allBatchesData.length).toBe(3);
  });
});

describe('mark-bottled freshness — structural freshness guard (#2)', function () {
  var fs = require('fs');
  var path = require('path');
  var src = fs.readFileSync(path.join(__dirname, '../../js/brewpad.js'), 'utf8');

  var ANCHOR = "adminApiPost('bulk_update_batch_tasks'";
  var WINDOW = 1500;

  var idx1 = src.indexOf(ANCHOR);
  var idx2 = src.indexOf(ANCHOR, idx1 + ANCHOR.length);
  var idx3 = src.indexOf(ANCHOR, idx2 + ANCHOR.length);

  var win1 = idx1 === -1 ? '' : src.slice(idx1, idx1 + WINDOW);
  var win2 = idx2 === -1 ? '' : src.slice(idx2, idx2 + WINDOW);
  var win3 = idx3 === -1 ? '' : src.slice(idx3, idx3 + WINDOW);

  // Freshness contract: each task-checkbox handler must refetch the dashboard after
  // the save. This is the one thing no behavioral test can cover (the delegated IIFE
  // handlers have no DOM-dispatch precedent), so it stays as a minimal structural pin.
  test('all three task handlers refetch via loadDashboard() after the save', function () {
    expect(idx1).not.toBe(-1);
    expect(idx2).not.toBe(-1);
    expect(idx3).not.toBe(-1);
    expect(win1.indexOf('loadDashboard()')).not.toBe(-1);
    expect(win2.indexOf('loadDashboard()')).not.toBe(-1);
    expect(win3.indexOf('loadDashboard()')).not.toBe(-1);
  });

  test('all three task handlers call afterBatchWrite( after the save', function () {
    expect(win1.indexOf('afterBatchWrite(')).not.toBe(-1);
    expect(win2.indexOf('afterBatchWrite(')).not.toBe(-1);
    expect(win3.indexOf('afterBatchWrite(')).not.toBe(-1);
  });
});
