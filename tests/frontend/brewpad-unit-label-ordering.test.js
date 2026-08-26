'use strict';

// WR-02 gap-closure regression: computeUnitLabel derives the "Unit X of N" ordinal
// by sorting the group on batch_id. The original sort used a plain lexicographic
// localeCompare, which only matches creation order for uniform fixed-width
// zero-padded IDs. This suite pins the numeric-aware ordering so non-padded and
// mixed/legacy IDs still map each physical unit to the right ordinal.

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

var _auth = require('../../js/lib/auth');
global.waitForGoogleIdentity = _auth.waitForGoogleIdentity;
global.gsiInitTokenClient = _auth.gsiInitTokenClient;
global.fetchGoogleUserInfo = _auth.fetchGoogleUserInfo;

var bp = require('../../js/brewpad');

describe('WR-02 computeUnitLabel numeric-aware ordinal ordering', function () {

  it('orders non-padded IDs so …-9 comes before …-10 (plain string sort would invert this)', function () {
    var u9  = { batch_id: 'SV-B-9',  zoho_so_number: 'INV-000400', product_sku: '80022222' };
    var u10 = { batch_id: 'SV-B-10', zoho_so_number: 'INV-000400', product_sku: '80022222' };
    var u11 = { batch_id: 'SV-B-11', zoho_so_number: 'INV-000400', product_sku: '80022222' };
    var all = [u11, u9, u10];

    expect(bp.computeUnitLabel(u9, all)).toBe('Unit 1 of 3');
    expect(bp.computeUnitLabel(u10, all)).toBe('Unit 2 of 3');
    expect(bp.computeUnitLabel(u11, all)).toBe('Unit 3 of 3');
  });

  it('orders a mixed legacy/new id group by unit sequence (SV-B-EXISTING-1 before SV-B-000002/3)', function () {
    // The backfill scenario from this phase: a pre-existing legacy-id batch plus two
    // newly created ones. Trailing ints are 1, 2, 3 → EXISTING-1 is Unit 1.
    var existing = { batch_id: 'SV-B-EXISTING-1', zoho_so_number: 'INV-000171', product_sku: '80087352' };
    var new2 = { batch_id: 'SV-B-000002', zoho_so_number: 'INV-000171', product_sku: '80087352' };
    var new3 = { batch_id: 'SV-B-000003', zoho_so_number: 'INV-000171', product_sku: '80087352' };
    var all = [new3, existing, new2];

    expect(bp.computeUnitLabel(existing, all)).toBe('Unit 1 of 3');
    expect(bp.computeUnitLabel(new2, all)).toBe('Unit 2 of 3');
    expect(bp.computeUnitLabel(new3, all)).toBe('Unit 3 of 3');
  });

  it('still orders uniform zero-padded IDs correctly (no regression to the fixed-width case)', function () {
    var a = { batch_id: 'SV-B-000183', zoho_so_number: 'INV-000171', product_sku: '80087352' };
    var b = { batch_id: 'SV-B-000184', zoho_so_number: 'INV-000171', product_sku: '80087352' };
    var c = { batch_id: 'SV-B-000185', zoho_so_number: 'INV-000171', product_sku: '80087352' };
    var all = [c, a, b];

    expect(bp.computeUnitLabel(a, all)).toBe('Unit 1 of 3');
    expect(bp.computeUnitLabel(b, all)).toBe('Unit 2 of 3');
    expect(bp.computeUnitLabel(c, all)).toBe('Unit 3 of 3');
  });
});
