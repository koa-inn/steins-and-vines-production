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

// ---------------------------------------------------------------------------
// buildCustomerReassignUpdates
// ---------------------------------------------------------------------------
describe('buildCustomerReassignUpdates', function () {

  it('returns all six keys for a full contact object with contact_name', function () {
    var result = bp.buildCustomerReassignUpdates({
      contact_id: 'ZC-001',
      contact_name: 'Jane Smith',
      email: 'jane@example.com',
      phone: '604-555-1234'
    });
    expect(result).toEqual({
      customer_id: 'ZC-001',
      customer_name: 'Jane Smith',
      customer_firstname: 'Jane',
      customer_lastname: 'Smith',
      customer_email: 'jane@example.com',
      customer_phone: '604-555-1234'
    });
  });

  it('accepts name (add-new form) instead of contact_name', function () {
    var result = bp.buildCustomerReassignUpdates({
      contact_id: 'ZC-002',
      name: 'Bob Johnson',
      email: 'bob@example.com',
      phone: '604-555-5678'
    });
    expect(result.customer_name).toBe('Bob Johnson');
    expect(result.customer_firstname).toBe('Bob');
    expect(result.customer_lastname).toBe('Johnson');
  });

  it('splits single-token name: firstname set, lastname empty string', function () {
    var result = bp.buildCustomerReassignUpdates({
      contact_id: 'ZC-003',
      contact_name: 'Cher',
      email: '',
      phone: ''
    });
    expect(result.customer_firstname).toBe('Cher');
    expect(result.customer_lastname).toBe('');
  });

  it('missing email becomes empty string (not undefined)', function () {
    var result = bp.buildCustomerReassignUpdates({
      contact_id: 'ZC-004',
      contact_name: 'Alice',
      phone: '604-555-0001'
    });
    expect(result.customer_email).toBe('');
    expect(typeof result.customer_email).toBe('string');
  });

  it('missing phone becomes empty string (not undefined)', function () {
    var result = bp.buildCustomerReassignUpdates({
      contact_id: 'ZC-005',
      contact_name: 'Alice',
      email: 'alice@example.com'
    });
    expect(result.customer_phone).toBe('');
    expect(typeof result.customer_phone).toBe('string');
  });

  it('absent contact_id yields customer_id empty string, other fields still populated', function () {
    var result = bp.buildCustomerReassignUpdates({
      name: 'New Customer',
      email: 'new@example.com',
      phone: '778-555-9999'
    });
    expect(result.customer_id).toBe('');
    expect(result.customer_name).toBe('New Customer');
    expect(result.customer_email).toBe('new@example.com');
    expect(result.customer_phone).toBe('778-555-9999');
  });

  it('returned object always has all six keys with string values (no undefined)', function () {
    var result = bp.buildCustomerReassignUpdates({});
    var keys = ['customer_id', 'customer_name', 'customer_firstname', 'customer_lastname', 'customer_email', 'customer_phone'];
    for (var i = 0; i < keys.length; i++) {
      expect(result.hasOwnProperty(keys[i])).toBe(true);
      expect(typeof result[keys[i]]).toBe('string');
    }
  });

  it('handles three-part name: first token first, rest as lastname', function () {
    var result = bp.buildCustomerReassignUpdates({
      contact_id: 'ZC-006',
      contact_name: 'Mary Jane Watson',
      email: 'mj@example.com',
      phone: ''
    });
    expect(result.customer_firstname).toBe('Mary');
    expect(result.customer_lastname).toBe('Jane Watson');
    expect(result.customer_name).toBe('Mary Jane Watson');
  });

});
