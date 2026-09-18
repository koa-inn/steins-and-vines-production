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

// =============================================================================
// BrewPad schedule template editor: the admin editor warns "Used by N public
// recipes" (Phase 81 D-15) but BrewPad's did not, so a staff member editing
// day offsets on the iPad had no idea customers' timelines would change.
// Harness prelude copied from brewpad-activation.test.js.
// =============================================================================

describe('countRecipesUsingSchedule', function () {
  test('counts recipes whose schedule_id matches, as strings', function () {
    bp._setRecipesListForTest([{ schedule_id: 'S1' }, { schedule_id: 'S1' }, { schedule_id: 'S2' }, { schedule_id: 7 }]);
    expect(bp._countRecipesUsingScheduleForTest('S1')).toBe(2);
    expect(bp._countRecipesUsingScheduleForTest(7)).toBe(1);
    expect(bp._countRecipesUsingScheduleForTest('S9')).toBe(0);
    expect(bp._countRecipesUsingScheduleForTest('')).toBe(0);
  });
});

describe('buildSchedForm — blast-radius note', function () {
  function container() {
    document.body.innerHTML = '<div id="bp-sched-sheet"><div id="bp-sched-sheet-inner"></div></div>';
    return document.getElementById('bp-sched-sheet-inner');
  }

  test('editing a template that public recipes use shows the note', function () {
    bp._setRecipesListForTest([{ schedule_id: 'S1' }, { schedule_id: 'S1' }]);
    var c = container();
    bp._buildSchedFormForTest(c, { schedule_id: 'S1', name: 'Standard Wine', steps_parsed: [] });
    var note = c.querySelector('#bp-sched-blast-radius');
    expect(note).not.toBeNull();
    expect(note.textContent).toMatch(/Used by 2 public recipes/);
    expect(note.textContent).toMatch(/what customers are told/);
  });

  test('singular wording for one recipe', function () {
    bp._setRecipesListForTest([{ schedule_id: 'S1' }]);
    var c = container();
    bp._buildSchedFormForTest(c, { schedule_id: 'S1', name: 'X', steps_parsed: [] });
    expect(c.querySelector('#bp-sched-blast-radius').textContent).toMatch(/Used by 1 public recipe\./);
  });

  test('no note when nothing uses the template, and none on a new template', function () {
    bp._setRecipesListForTest([{ schedule_id: 'S2' }]);
    var c = container();
    bp._buildSchedFormForTest(c, { schedule_id: 'S1', name: 'X', steps_parsed: [] });
    expect(c.querySelector('#bp-sched-blast-radius')).toBeNull();
    c = container();
    bp._buildSchedFormForTest(c, null);
    expect(c.querySelector('#bp-sched-blast-radius')).toBeNull();
  });
});
