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

describe('BrewPad computeUnitLabel (D-03 multi-unit ordinal label)', function () {

  it('returns contiguous "Unit X of 3" labels for the INV-000171-after-backfill group, regardless of input array order', function () {
    var unit1 = { batch_id: 'SV-B-000183', zoho_so_number: 'INV-000171', product_sku: '80087352' };
    var unit2 = { batch_id: 'SV-B-000184', zoho_so_number: 'INV-000171', product_sku: '80087352' };
    var unit3 = { batch_id: 'SV-B-000185', zoho_so_number: 'INV-000171', product_sku: '80087352' };

    // shuffled input order proves the ordinal is derived from sorted batch_id, not array position
    var shuffled = [unit3, unit1, unit2];

    expect(bp.computeUnitLabel(unit1, shuffled)).toBe('Unit 1 of 3');
    expect(bp.computeUnitLabel(unit2, shuffled)).toBe('Unit 2 of 3');
    expect(bp.computeUnitLabel(unit3, shuffled)).toBe('Unit 3 of 3');
  });

  it('returns empty string for a group of 1 (unique zoho_so_number/product_sku)', function () {
    var solo = { batch_id: 'SV-B-000200', zoho_so_number: 'INV-000200', product_sku: '80099999' };
    expect(bp.computeUnitLabel(solo, [solo])).toBe('');
  });

  it('does not group batches with an empty/missing zoho_so_number even if two share the empty value', function () {
    var noSoA = { batch_id: 'SV-B-000201', zoho_so_number: '', product_sku: '80099999' };
    var noSoB = { batch_id: 'SV-B-000202', zoho_so_number: '', product_sku: '80099999' };
    var all = [noSoA, noSoB];

    expect(bp.computeUnitLabel(noSoA, all)).toBe('');
    expect(bp.computeUnitLabel(noSoB, all)).toBe('');
  });

  it('treats different product_sku on the same invoice as independent groups', function () {
    var skuA1 = { batch_id: 'SV-B-000210', zoho_so_number: 'INV-000210', product_sku: 'SKU-A' };
    var skuA2 = { batch_id: 'SV-B-000211', zoho_so_number: 'INV-000210', product_sku: 'SKU-A' };
    var skuB1 = { batch_id: 'SV-B-000212', zoho_so_number: 'INV-000210', product_sku: 'SKU-B' };
    var all = [skuA1, skuA2, skuB1];

    expect(bp.computeUnitLabel(skuA1, all)).toBe('Unit 1 of 2');
    expect(bp.computeUnitLabel(skuA2, all)).toBe('Unit 2 of 2');
    expect(bp.computeUnitLabel(skuB1, all)).toBe('');
  });

  it('derives ordinal from ascending batch_id string order, not array position', function () {
    var lower = { batch_id: 'SV-B-000300', zoho_so_number: 'INV-000300', product_sku: '80011111' };
    var higher = { batch_id: 'SV-B-000301', zoho_so_number: 'INV-000300', product_sku: '80011111' };
    // higher batch_id placed FIRST in the array to prove position is irrelevant
    var all = [higher, lower];

    expect(bp.computeUnitLabel(lower, all)).toBe('Unit 1 of 2');
    expect(bp.computeUnitLabel(higher, all)).toBe('Unit 2 of 2');
  });

});
