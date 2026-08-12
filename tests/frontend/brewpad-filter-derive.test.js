'use strict';

// ---------------------------------------------------------------------------
// Phase 69 CR-01 regression: the Ready-to-Bottle filter must survive every
// re-derive path, not just the filter-button click handler.
//
// Before the fix, only the click handler special-cased _batchStatusFilter ===
// 'readyToBottle'; switchTab('batches'), loadBatches() (fresh cache) and
// loadBatches() (post-fetch) all re-derived via filterBatchesByStatus, which
// status-matches the literal 'readyToBottle' against batch.status and ALWAYS
// returns [] — so a tab switch or post-write reload silently emptied the list.
//
// These tests EXECUTE the shared derivation seam (applyBatchFilter) that all
// four sites now route through — a behavioral assertion, not a source-text pin.
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
  { batch_id: 'A', status: 'secondary' },
  { batch_id: 'B', status: 'secondary' },
  { batch_id: 'C', status: 'primary' },
  { batch_id: 'D', status: 'complete' }
];

function seed(filter, readyToBottle) {
  bp._setStateForTest({
    _allBatchesData: BATCHES,
    _batchStatusFilter: filter,
    _batchesData: [],
    _dashSummary: readyToBottle == null ? null : { readyToBottle: readyToBottle }
  });
}

describe('applyBatchFilter — shared re-derive seam (CR-01)', function () {
  test('readyToBottle filter derives the intersection, NOT []', function () {
    seed('readyToBottle', [{ batch_id: 'A' }, { batch_id: 'C' }]);
    bp.applyBatchFilter();
    var ids = bp.getStateForTest()._batchesData.map(function (b) { return b.batch_id; });
    expect(ids).toEqual(['A', 'C']);
  });

  test('readyToBottle filter drops a batch once it leaves _dashSummary.readyToBottle (mark-bottled)', function () {
    seed('readyToBottle', [{ batch_id: 'A' }, { batch_id: 'C' }]);
    bp.applyBatchFilter();
    expect(bp.getStateForTest()._batchesData).toHaveLength(2);

    // Simulate a task-write refetch removing 'A' from the server readyToBottle set.
    bp._setStateForTest({ _dashSummary: { readyToBottle: [{ batch_id: 'C' }] } });
    bp.applyBatchFilter();
    var ids = bp.getStateForTest()._batchesData.map(function (b) { return b.batch_id; });
    expect(ids).toEqual(['C']);
  });

  test('readyToBottle with missing _dashSummary yields [] (no throw), not all batches', function () {
    seed('readyToBottle', null);
    expect(function () { bp.applyBatchFilter(); }).not.toThrow();
    expect(bp.getStateForTest()._batchesData).toHaveLength(0);
  });

  test('a non-readyToBottle filter still delegates to status matching', function () {
    seed('secondary', [{ batch_id: 'A' }]);
    bp.applyBatchFilter();
    var ids = bp.getStateForTest()._batchesData.map(function (b) { return b.batch_id; });
    expect(ids).toEqual(['A', 'B']);
  });

  test('phantom readyToBottle ids absent from the batch list are not rendered', function () {
    seed('readyToBottle', [{ batch_id: 'A' }, { batch_id: 'ZZZ' }]);
    bp.applyBatchFilter();
    var ids = bp.getStateForTest()._batchesData.map(function (b) { return b.batch_id; });
    expect(ids).toEqual(['A']);
  });
});

describe('Ready-to-Bottle count chip matches the rendered rows (WR-03)', function () {
  test('chip count (readyToBottleRows) equals the rendered row count even with phantom ids', function () {
    // Before the fix the chip counted _dashSummary.readyToBottle.length (2) while the
    // rows were the intersection (1) — chip "2", list shows 1. Both now derive from the
    // same readyToBottleRows() intersection, so they cannot diverge.
    bp._setStateForTest({
      _allBatchesData: BATCHES,
      _batchStatusFilter: 'readyToBottle',
      _dashSummary: { readyToBottle: [{ batch_id: 'A' }, { batch_id: 'PHANTOM' }] },
      _batchesData: []
    });
    var chipCount = bp.readyToBottleRows().length;
    bp.applyBatchFilter();
    var rowCount = bp.getStateForTest()._batchesData.length;
    expect(chipCount).toBe(1);
    expect(chipCount).toBe(rowCount);
  });
});
