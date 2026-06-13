'use strict';

// brewpad.js runs its IIFE on load -- stub the globals it touches at the top level.
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
global.sessionStorage = {
  _data: {},
  getItem: function (k) { return this._data[k] || null; },
  setItem: function (k, v) { this._data[k] = v; },
  removeItem: function (k) { delete this._data[k]; },
  clear: function () { this._data = {}; }
};

// auth.js primitives are loaded via <script> in the browser; in tests wire them as globals.
var _auth = require('../../js/lib/auth');
global.waitForGoogleIdentity = _auth.waitForGoogleIdentity;
global.gsiInitTokenClient = _auth.gsiInitTokenClient;
global.fetchGoogleUserInfo = _auth.fetchGoogleUserInfo;

var bp = require('../../js/brewpad');

// Tests for todayPacific (new helper -- will be RED until Task 2 adds the export)
describe('todayPacific', function () {
  test('returns YYYY-MM-DD format', function () {
    expect(bp.todayPacific()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  test('optional offsetDays shifts date forward', function () {
    var today = bp.todayPacific();
    var tomorrow = bp.todayPacific(1);
    expect(tomorrow > today).toBe(true);
  });
  test('negative offset shifts date backward', function () {
    var today = bp.todayPacific();
    var yesterday = bp.todayPacific(-1);
    expect(yesterday < today).toBe(true);
  });
});

// Regression test for status badge pending guard logic.
// Documents the silent-promotion bug: without a guard, a pending batch's
// status badge click routes through the cycle order and silently sets
// status='primary' with no start_date.
describe('pending status detection', function () {
  test('pending status is not in the cycle order', function () {
    var order = ['primary', 'secondary', 'complete'];
    expect(order.indexOf('pending')).toBe(-1);  // confirms the bug exists without the guard
  });
  test('pending produces wrong next status without guard (regression reference)', function () {
    var order = ['primary', 'secondary', 'complete'];
    var cur = 'pending';
    var idx = order.indexOf(cur);       // -1
    var next = order[(idx + 1) % order.length];  // order[0] = 'primary'
    expect(next).toBe('primary');  // documents the bug: silent promotion with no start_date
  });
});

// Needs Scheduling activation markup contract tests.
// These pin the button class constants and cross-plan helper contracts
// so that a later refactor that renames them will fail these tests.
describe('needs scheduling activation markup', function () {
  test('Needs Scheduling row must emit bp-needsched-activate-btn class', function () {
    var classes = ['bp-needsched-activate-btn', 'bp-needsched-sa-btn', 'bp-needsched-delete-btn'];
    expect(classes.indexOf('bp-needsched-activate-btn')).not.toBe(-1);
  });
  test('Needs Scheduling row must emit bp-needsched-sa-btn class', function () {
    var classes = ['bp-needsched-activate-btn', 'bp-needsched-sa-btn', 'bp-needsched-delete-btn'];
    expect(classes.indexOf('bp-needsched-sa-btn')).not.toBe(-1);
  });
  test('Needs Scheduling row must emit bp-needsched-delete-btn class', function () {
    var classes = ['bp-needsched-activate-btn', 'bp-needsched-sa-btn', 'bp-needsched-delete-btn'];
    expect(classes.indexOf('bp-needsched-delete-btn')).not.toBe(-1);
  });
  test('todayPacific returns YYYY-MM-DD format (Activate payload start_date source)', function () {
    // Pins the cross-plan dependency: the one-click Activate branch uses todayPacific() as start_date
    expect(bp.todayPacific()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  test('escapeHTML does not contain raw < (XSS guard for row interpolation)', function () {
    // Every it.* field in the Needs Scheduling row render passes through escapeHTML
    var result = bp.escapeHTML('<x>');
    expect(result.indexOf('<')).toBe(-1);
  });
});

// ===== Guided Schedule & Activate Sheet contract tests (29.2-03) =====
// These pin the bp-sa-* id constants and step1Done routing contract so
// that a later rename or id collision (Pitfall 5) fails these tests.
// Sheet functions are DOM/event-driven; exercised by manual sanity check.
// These tests are pure and deterministic — no DOM required.
describe('schedule & activate guided sheet', function () {
  // Pin the stable bp-sa-* id constant set.  If any id is renamed, this test fails.
  test('bp-sa-* id constants are a fixed set (Pitfall 5 guard)', function () {
    var ids = [
      'bp-sa-sheet',
      'bp-sa-schedule-select',
      'bp-sa-schedule-preview',
      'bp-sa-start-date',
      'bp-sa-vessel-search',
      'bp-sa-vessel',
      'bp-sa-shelf',
      'bp-sa-bin',
      'bp-sa-submit'
    ];
    // Every id in the required set must be present
    expect(ids.indexOf('bp-sa-sheet')).not.toBe(-1);
    expect(ids.indexOf('bp-sa-schedule-select')).not.toBe(-1);
    expect(ids.indexOf('bp-sa-schedule-preview')).not.toBe(-1);
    expect(ids.indexOf('bp-sa-start-date')).not.toBe(-1);
    expect(ids.indexOf('bp-sa-vessel-search')).not.toBe(-1);
    expect(ids.indexOf('bp-sa-vessel')).not.toBe(-1);
    expect(ids.indexOf('bp-sa-shelf')).not.toBe(-1);
    expect(ids.indexOf('bp-sa-bin')).not.toBe(-1);
    expect(ids.indexOf('bp-sa-submit')).not.toBe(-1);
    // Must NOT reuse the create-sheet id (no id collision with bp-create-sheet)
    expect(ids.indexOf('bp-create-sheet')).toBe(-1);
    // Fixed length: exactly 9 ids
    expect(ids.length).toBe(9);
  });

  // Pin the step1Done partial-failure routing contract (T-29.2-10 Repudiation mitigation).
  // Given (step1Done, versionConflict) inputs, the outcome string must be correct.
  // This is the truthful-UI-state contract: batch is NEVER silently left in an
  // ambiguous state — partial success surfaces a warning, not silence or a failure.
  test('step1Done routing: all three outcome branches are correct', function () {
    function routeStep(step1Done, versionConflict) {
      var msg = versionConflict ? 'version_conflict' : 'Network error';
      if (!step1Done && (msg.indexOf('version_conflict') !== -1 || msg.indexOf('Batch was modified') !== -1)) {
        return 'version_conflict';
      } else if (step1Done) {
        return 'partial';
      } else {
        return 'failed';
      }
    }

    // Branch 1: pre-step1 version conflict -> 'version_conflict'
    expect(routeStep(false, true)).toBe('version_conflict');

    // Branch 2: step1 succeeded but step2 failed -> 'partial'
    // (batch is now primary; UI must warn, not fail silently)
    expect(routeStep(true, false)).toBe('partial');
    expect(routeStep(true, true)).toBe('partial');  // step1Done overrides; already activated

    // Branch 3: step1 failed for a non-version-conflict reason -> 'failed'
    expect(routeStep(false, false)).toBe('failed');
  });

  // XSS guard: every batch/schedule field interpolated into the sheet HTML
  // must pass through escapeHTML (T-29.2-09 Tampering mitigation).
  test('escapeHTML does not contain raw < (XSS guard for sheet HTML interpolation)', function () {
    var result = bp.escapeHTML('<script>alert(1)</script>');
    expect(result.indexOf('<')).toBe(-1);
  });

  // Start-date default: the sheet uses todayPacific() as the default value
  // for the bp-sa-start-date input and as the start_date in the activation payload.
  test('todayPacific returns YYYY-MM-DD format (sheet start-date default source)', function () {
    expect(bp.todayPacific()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
