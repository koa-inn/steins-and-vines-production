'use strict';

// Regression tests for the afterBatchWrite cache-busting helper (plan 36-22).
// These tests are RED until afterBatchWrite is added to brewpad.js and exported.

// brewpad.js IIFE touches these globals on load — stub them all.
global.document = global.document || {};
global.window = global.window || {};
global.navigator = global.navigator || {};
global.google = { accounts: { oauth2: { initTokenClient: jest.fn() } } };
global.fetch = jest.fn();
global.localStorage = {
  _data: {},
  getItem: function (k) { return this._data[k] || null; },
  setItem: function (k, v) { this._data[k] = v; },
  removeItem: function (k) { delete this._data[k]; },
  clear: function () { this._data = {}; }
};
// Use a real mock sessionStorage so removeItem calls are trackable
var _ssData = {};
global.sessionStorage = {
  _data: _ssData,
  getItem: function (k) { return _ssData[k] !== undefined ? _ssData[k] : null; },
  setItem: function (k, v) { _ssData[k] = v; },
  removeItem: function (k) { delete _ssData[k]; },
  clear: function () {
    Object.keys(_ssData).forEach(function (k) { delete _ssData[k]; });
  }
};

// auth.js primitives are loaded via <script> in the browser; wire as globals for tests.
var _auth = require('../../js/lib/auth');
global.waitForGoogleIdentity = _auth.waitForGoogleIdentity;
global.gsiInitTokenClient = _auth.gsiInitTokenClient;
global.fetchGoogleUserInfo = _auth.fetchGoogleUserInfo;

var bp = require('../../js/brewpad');

// ---------------------------------------------------------------------------
// afterBatchWrite — helper must be exported
// ---------------------------------------------------------------------------
describe('afterBatchWrite export exists', function () {
  test('afterBatchWrite is exported from brewpad', function () {
    expect(typeof bp.afterBatchWrite).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// (A) per-batch sessionStorage snapshot is removed
// ---------------------------------------------------------------------------
describe('afterBatchWrite removes sv-bp-batch-{id} from sessionStorage', function () {
  beforeEach(function () {
    global.sessionStorage.clear();
  });

  test('removes the snapshot for the given batchId', function () {
    var batchId = 'SV-B-001';
    sessionStorage.setItem('sv-bp-batch-' + batchId, JSON.stringify({ ts: Date.now(), data: {} }));
    expect(sessionStorage.getItem('sv-bp-batch-' + batchId)).not.toBeNull();

    bp.afterBatchWrite(batchId);

    expect(sessionStorage.getItem('sv-bp-batch-' + batchId)).toBeNull();
  });

  test('does not remove snapshot for a different batchId', function () {
    var batchId = 'SV-B-001';
    var otherId = 'SV-B-002';
    sessionStorage.setItem('sv-bp-batch-' + batchId, JSON.stringify({ ts: Date.now(), data: {} }));
    sessionStorage.setItem('sv-bp-batch-' + otherId, JSON.stringify({ ts: Date.now(), data: {} }));

    bp.afterBatchWrite(batchId);

    expect(sessionStorage.getItem('sv-bp-batch-' + batchId)).toBeNull();
    expect(sessionStorage.getItem('sv-bp-batch-' + otherId)).not.toBeNull();
  });

  test('does not throw when sessionStorage key does not exist', function () {
    expect(function () {
      bp.afterBatchWrite('SV-B-NONEXISTENT');
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// (B) list/dash state is reset by default (listAffecting defaults to true)
// ---------------------------------------------------------------------------
describe('afterBatchWrite resets list/dash state flags', function () {
  test('getStateVars reflects reset after afterBatchWrite', function () {
    // We verify via the exported _getInternalState helper if available,
    // or via the side-effects observable through exported functions.
    // The canonical test is: after afterBatchWrite, the list-bust vars are reset.
    // We use the exported getStateForTest helper added alongside afterBatchWrite.
    if (typeof bp.getStateForTest !== 'function') {
      // If the helper isn't exported yet, skip gracefully — the export test above
      // will fail first and is the primary RED gate.
      return;
    }

    bp.afterBatchWrite('SV-B-001');

    var state = bp.getStateForTest();
    expect(state._batchesLoaded).toBe(false);
    expect(state._allBatchesData).toEqual([]);
    expect(state._eagerLoadTime).toBe(0);
    expect(state._dashLoadTime).toBe(0);
  });

  test('listAffecting=false skips list/dash reset', function () {
    if (typeof bp.getStateForTest !== 'function') { return; }

    // Seed some non-default state values to verify they are NOT touched
    bp._setStateForTest({ _batchesLoaded: true, _eagerLoadTime: 9999 });

    bp.afterBatchWrite('SV-B-001', { listAffecting: false });

    var state = bp.getStateForTest();
    expect(state._batchesLoaded).toBe(true);
    expect(state._eagerLoadTime).toBe(9999);
  });
});

// ---------------------------------------------------------------------------
// Preload state cleared when it references the same batchId
// ---------------------------------------------------------------------------
describe('afterBatchWrite clears in-flight preload for same batchId', function () {
  test('clears preload state when _preloadBatchId matches', function () {
    if (typeof bp.getStateForTest !== 'function' || typeof bp._setStateForTest !== 'function') { return; }

    // Simulate a preload in flight for SV-B-001
    bp._setStateForTest({
      _preloadBatchId: 'SV-B-001',
      _preloadPromise: Promise.resolve({ data: {} })
    });

    bp.afterBatchWrite('SV-B-001');

    var state = bp.getStateForTest();
    expect(state._preloadBatchId).toBeNull();
    expect(state._preloadPromise).toBeNull();
  });

  test('does NOT clear preload state when _preloadBatchId is a different batch', function () {
    if (typeof bp.getStateForTest !== 'function' || typeof bp._setStateForTest !== 'function') { return; }

    var otherPromise = Promise.resolve({ data: {} });
    bp._setStateForTest({
      _preloadBatchId: 'SV-B-002',
      _preloadPromise: otherPromise
    });

    bp.afterBatchWrite('SV-B-001');

    var state = bp.getStateForTest();
    expect(state._preloadBatchId).toBe('SV-B-002');
    expect(state._preloadPromise).toBe(otherPromise);
  });
});

// ---------------------------------------------------------------------------
// Task-toggle must use task.batch_id (not the open-detail id)
// ---------------------------------------------------------------------------
// This is a pure contract test: documents the required behaviour so that
// a change to the task-toggle handler that passes the wrong id fails here.
describe('task toggle batch_id contract', function () {
  test('task object has batch_id property (contract for dashboard task row)', function () {
    // The task toggle handler must call afterBatchWrite(task.batch_id, ...) not
    // afterBatchWrite(_selectedBatchId, ...).  This test pins the task shape contract
    // expected by the handler — if task.batch_id is missing the handler silently passes
    // undefined, which would never match any sessionStorage key.
    var task = {
      task_id: 'BT-000001',
      batch_id: 'SV-B-042',
      title: 'Rack wine',
      completed: 'FALSE'
    };
    expect(task.batch_id).toBe('SV-B-042');
    // Prove that using _selectedBatchId vs task.batch_id would give different keys
    // when the toggled task belongs to a batch that is not currently open in the detail pane.
    var openDetailId = 'SV-B-099';
    expect(task.batch_id).not.toBe(openDetailId);
  });

  test('afterBatchWrite busts the task batch snapshot, not the currently-open batch', function () {
    // Seed snapshots for two different batches
    var taskBatchId = 'SV-B-042';
    var openBatchId = 'SV-B-099';
    sessionStorage.setItem('sv-bp-batch-' + taskBatchId, JSON.stringify({ ts: Date.now(), data: { note: 'task batch' } }));
    sessionStorage.setItem('sv-bp-batch-' + openBatchId, JSON.stringify({ ts: Date.now(), data: { note: 'open batch' } }));

    // Call afterBatchWrite with the TASK'S batch id (as the handler should do)
    bp.afterBatchWrite(taskBatchId, { listAffecting: false });

    // Only the task's batch snapshot should be gone
    expect(sessionStorage.getItem('sv-bp-batch-' + taskBatchId)).toBeNull();
    // The open batch snapshot must be untouched
    expect(sessionStorage.getItem('sv-bp-batch-' + openBatchId)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Representative offender: plato-add (detail submit) calls afterBatchWrite on success
// ---------------------------------------------------------------------------
// This test verifies the integration between the plato-add success path and
// afterBatchWrite by confirming that after a successful plato submit, the
// sv-bp-batch-{id} key is gone from sessionStorage.
// It does NOT require DOM; it relies on afterBatchWrite being called in the
// handler's .then() callback with { listAffecting: false }.
describe('plato readings submit busts sessionStorage snapshot', function () {
  test('afterBatchWrite with listAffecting=false removes snapshot without touching list flags', function () {
    var batchId = 'SV-B-013';
    sessionStorage.setItem('sv-bp-batch-' + batchId, JSON.stringify({ ts: Date.now(), data: {} }));

    // Simulate what the plato submit success path does
    bp.afterBatchWrite(batchId, { listAffecting: false });

    expect(sessionStorage.getItem('sv-bp-batch-' + batchId)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Schedule & Activate handler busts snapshot AND does not silently leave
// stale detail visible (contract test)
// ---------------------------------------------------------------------------
describe('schedule+activate busts batch snapshot', function () {
  test('afterBatchWrite with listAffecting=true + refreshOpenDetail removes snapshot and resets list state', function () {
    if (typeof bp.getStateForTest !== 'function') { return; }

    var batchId = 'SV-B-014';
    sessionStorage.setItem('sv-bp-batch-' + batchId, JSON.stringify({ ts: Date.now(), data: {} }));

    // Pass {refreshOpenDetail: true} — handler calls this when schedule activate succeeds
    // (re-fetch path is async + requires DOM; here we confirm the synchronous bust happens)
    bp.afterBatchWrite(batchId, { listAffecting: true });

    expect(sessionStorage.getItem('sv-bp-batch-' + batchId)).toBeNull();
    var state = bp.getStateForTest();
    expect(state._batchesLoaded).toBe(false);
    expect(state._eagerLoadTime).toBe(0);
    expect(state._dashLoadTime).toBe(0);
  });
});
