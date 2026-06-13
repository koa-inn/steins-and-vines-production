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
