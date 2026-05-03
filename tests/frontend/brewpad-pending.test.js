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

describe('BrewPad pending batch helpers', function () {

  describe('shouldShowKioskBadge', function () {

    it('returns true when source is kiosk and status is pending', function () {
      expect(bp.shouldShowKioskBadge('kiosk', 'pending')).toBe(true);
    });

    it('returns false when source is manual', function () {
      expect(bp.shouldShowKioskBadge('manual', 'pending')).toBe(false);
    });

    it('returns false when status is not pending (active kiosk batch)', function () {
      expect(bp.shouldShowKioskBadge('kiosk', 'primary')).toBe(false);
      expect(bp.shouldShowKioskBadge('kiosk', 'secondary')).toBe(false);
      expect(bp.shouldShowKioskBadge('kiosk', 'complete')).toBe(false);
    });

    it('returns false when source is empty or undefined', function () {
      expect(bp.shouldShowKioskBadge('', 'pending')).toBe(false);
      expect(bp.shouldShowKioskBadge(undefined, 'pending')).toBe(false);
      expect(bp.shouldShowKioskBadge(null, 'pending')).toBe(false);
    });

    it('handles case-insensitive status', function () {
      expect(bp.shouldShowKioskBadge('kiosk', 'Pending')).toBe(true);
      expect(bp.shouldShowKioskBadge('kiosk', 'PENDING')).toBe(true);
    });

    it('returns false when both source and status are empty', function () {
      expect(bp.shouldShowKioskBadge('', '')).toBe(false);
    });

  });

});
