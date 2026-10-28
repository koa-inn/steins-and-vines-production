'use strict';

// Regression: js/brewpad.js declared DASH_TYPE_LABELS twice; the later copy had no
// seltzer/other entries, so seltzer and other batches showed a blank type label.

global.google = { accounts: { oauth2: { initTokenClient: jest.fn() } } };
global.fetch = jest.fn(function () {
  return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ ok: true, data: {} }); } });
});
var _ssData = {};
global.sessionStorage = {
  getItem: function (k) { return _ssData[k] !== undefined ? _ssData[k] : null; },
  setItem: function (k, v) { _ssData[k] = v; },
  removeItem: function (k) { delete _ssData[k]; },
  clear: function () { _ssData = {}; }
};

var _auth = require('../../js/lib/auth');
global.waitForGoogleIdentity = _auth.waitForGoogleIdentity;
global.gsiInitTokenClient = _auth.gsiInitTokenClient;
global.fetchGoogleUserInfo = _auth.fetchGoogleUserInfo;

var bp = require('../../js/brewpad');

var TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' });
var YEAR = +TODAY.slice(0, 4);
var ASOF = { today: TODAY, year: YEAR, tz: 'America/Vancouver' };

function flush() { return new Promise(function (r) { setTimeout(r, 0); }); }

function d(n) {
  var p = TODAY.split('-');
  var t = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]) + n * 86400000);
  return t.toISOString().slice(0, 10);
}

function lean(id, type, status, extra) {
  return Object.assign({
    batch_id: id, status: status, batch_type: type, batch_type_source: 'recipe',
    start_date: d(-5), completed_day: null, completed_at: null, completed_at_source: null,
    vessel_id: 'V-' + id, source: 'kiosk', product_sku: '', product_name: 'P-' + id, product_subcategory: '',
    product_brand: '', product_manufacturer: '', recipe_id: '', schedule_id: '',
    schedule_category: '', target_volume_l: 20, tasks_total: 0, tasks_done: 0
  }, extra || {});
}

describe('type labels in dashboard rows', function () {
  test('seltzer and other batches keep their type label in G10 rows', function () {
    var list = [
      lean('SZ1', 'seltzer', 'primary', { vessel_id: '' }),
      lean('OT1', 'other', 'primary', { vessel_id: '' })
    ];
    var g = bp.buildG10Model(list, {}, { today: TODAY });
    var items = g.cats.filter(function (c) { return c.key === 'novessel'; })[0].items;
    expect(items.map(function (i) { return i.secondary; }).sort()).toEqual(['P-OT1 · Other', 'P-SZ1 · Seltzer']);
  });

});
