'use strict';

// Regression (2026-10-13 handoff §7): kiosk recipe sales create pending
// batches with source "kiosk_recipe" (lib/brewpad-integration.js
// detectRecipeSale, called only from routes/pos-recipe.js), but the Kiosk
// badge matched source === "kiosk" alone, so those batches showed no badge.
// Online ("online") and staff ("manual") batches stay unbadged.

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

describe('Kiosk badge for kiosk recipe sales', function () {
  test('shows for a pending kiosk_recipe batch', function () {
    expect(bp.shouldShowKioskBadge('kiosk_recipe', 'pending')).toBe(true);
  });

  test('hides for a kiosk_recipe batch once it leaves pending', function () {
    expect(bp.shouldShowKioskBadge('kiosk_recipe', 'primary')).toBe(false);
  });

  test('stays hidden for online and manual batches', function () {
    expect(bp.shouldShowKioskBadge('online', 'pending')).toBe(false);
    expect(bp.shouldShowKioskBadge('manual', 'pending')).toBe(false);
  });
});
