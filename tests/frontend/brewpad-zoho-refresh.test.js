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
// isValidZohoNumber
// ---------------------------------------------------------------------------
describe('isValidZohoNumber', function () {

  it('returns true for INV-000123', function () {
    expect(bp.isValidZohoNumber('INV-000123')).toBe(true);
  });

  it('returns true for SO-42', function () {
    expect(bp.isValidZohoNumber('SO-42')).toBe(true);
  });

  it('returns true for inv-5 (case-insensitive)', function () {
    expect(bp.isValidZohoNumber('inv-5')).toBe(true);
  });

  it('returns true for so-999 (lowercase)', function () {
    expect(bp.isValidZohoNumber('so-999')).toBe(true);
  });

  it('returns false for empty string', function () {
    expect(bp.isValidZohoNumber('')).toBe(false);
  });

  it('returns false for "INV" (no digits)', function () {
    expect(bp.isValidZohoNumber('INV')).toBe(false);
  });

  it('returns false for "12345" (no prefix)', function () {
    expect(bp.isValidZohoNumber('12345')).toBe(false);
  });

  it('returns false for "WALK-IN"', function () {
    expect(bp.isValidZohoNumber('WALK-IN')).toBe(false);
  });

  it('returns false for null', function () {
    expect(bp.isValidZohoNumber(null)).toBe(false);
  });

  it('returns false for undefined', function () {
    expect(bp.isValidZohoNumber(undefined)).toBe(false);
  });

  it('returns false for INV- (no digits after dash)', function () {
    expect(bp.isValidZohoNumber('INV-')).toBe(false);
  });

  it('returns false for INV-123abc (non-digit after digits)', function () {
    expect(bp.isValidZohoNumber('INV-123abc')).toBe(false);
  });

  // CR-01 contract: middleware normalizes to uppercase (plan 29-04 Task 1),
  // so the case-insensitive frontend gate and middleware now accept the same refs.
  it('returns true for inv-000123 — matches normalized middleware contract (CR-01)', function () {
    expect(bp.isValidZohoNumber('inv-000123')).toBe(true);
  });

  it('returns true for so-42 — matches normalized middleware contract (CR-01)', function () {
    expect(bp.isValidZohoNumber('so-42')).toBe(true);
  });

});

// ---------------------------------------------------------------------------
// splitCustomerName
// ---------------------------------------------------------------------------
describe('splitCustomerName', function () {

  it('splits "Jane Smith" into first="Jane", last="Smith"', function () {
    var result = bp.splitCustomerName('Jane Smith');
    expect(result.customer_firstname).toBe('Jane');
    expect(result.customer_lastname).toBe('Smith');
  });

  it('splits single-token "Cher" into first="Cher", last=""', function () {
    var result = bp.splitCustomerName('Cher');
    expect(result.customer_firstname).toBe('Cher');
    expect(result.customer_lastname).toBe('');
  });

  it('handles extra whitespace: "  Mary  Jane  Watson " => first="Mary", last="Jane Watson"', function () {
    var result = bp.splitCustomerName('  Mary  Jane  Watson ');
    expect(result.customer_firstname).toBe('Mary');
    expect(result.customer_lastname).toBe('Jane Watson');
  });

  it('handles empty string => first="", last=""', function () {
    var result = bp.splitCustomerName('');
    expect(result.customer_firstname).toBe('');
    expect(result.customer_lastname).toBe('');
  });

});

// ---------------------------------------------------------------------------
// buildRefreshUpdates
// ---------------------------------------------------------------------------
describe('buildRefreshUpdates', function () {

  it('returns non-empty name and email, omits blank phone', function () {
    var result = bp.buildRefreshUpdates({
      customer_name: 'A',
      customer_email: 'a@b.co',
      customer_phone: ''
    });
    expect(result).toEqual({ customer_name: 'A', customer_email: 'a@b.co' });
    expect(result.hasOwnProperty('customer_phone')).toBe(false);
  });

  it('returns only non-empty phone when name and email are blank/null', function () {
    var result = bp.buildRefreshUpdates({
      customer_name: '',
      customer_email: null,
      customer_phone: '604-1'
    });
    expect(result).toEqual({ customer_phone: '604-1' });
    expect(result.hasOwnProperty('customer_name')).toBe(false);
    expect(result.hasOwnProperty('customer_email')).toBe(false);
  });

  it('returns empty object when all fields are blank/null', function () {
    var result = bp.buildRefreshUpdates({
      customer_name: '',
      customer_email: null,
      customer_phone: undefined
    });
    expect(result).toEqual({});
  });

  it('does not include key with value null', function () {
    var result = bp.buildRefreshUpdates({ customer_name: null, customer_email: 'x@y.com', customer_phone: null });
    expect(result.hasOwnProperty('customer_name')).toBe(false);
    expect(result.hasOwnProperty('customer_phone')).toBe(false);
    expect(result.customer_email).toBe('x@y.com');
  });

  it('does not include key with value undefined', function () {
    var result = bp.buildRefreshUpdates({ customer_name: undefined, customer_email: 'z@w.com', customer_phone: undefined });
    expect(result.hasOwnProperty('customer_name')).toBe(false);
    expect(result.hasOwnProperty('customer_phone')).toBe(false);
  });

  it('does not include key with whitespace-only value', function () {
    var result = bp.buildRefreshUpdates({ customer_name: '   ', customer_email: 'a@b.co', customer_phone: '' });
    expect(result.hasOwnProperty('customer_name')).toBe(false);
    expect(result.customer_email).toBe('a@b.co');
  });

  it('trims whitespace from values before including them', function () {
    var result = bp.buildRefreshUpdates({ customer_name: '  Alice  ', customer_email: ' a@b.co ', customer_phone: '' });
    expect(result.customer_name).toBe('Alice');
    expect(result.customer_email).toBe('a@b.co');
  });

  it('returns all three fields when all are non-empty', function () {
    var result = bp.buildRefreshUpdates({
      customer_name: 'Bob',
      customer_email: 'bob@example.com',
      customer_phone: '604-555-0100'
    });
    expect(result).toEqual({
      customer_name: 'Bob',
      customer_email: 'bob@example.com',
      customer_phone: '604-555-0100'
    });
  });

});

// ---------------------------------------------------------------------------
// compareRefreshFields
// ---------------------------------------------------------------------------
describe('compareRefreshFields', function () {

  it('returns true (no change) when every non-empty fetched field matches batch', function () {
    var fetched = { customer_name: 'Alice', customer_email: 'alice@example.com', customer_phone: '' };
    var batch = { customer_name: 'Alice', customer_email: 'alice@example.com', customer_phone: '' };
    expect(bp.compareRefreshFields(fetched, batch)).toBe(true);
  });

  it('returns false when customer_name differs', function () {
    var fetched = { customer_name: 'Alice B', customer_email: 'alice@example.com', customer_phone: '' };
    var batch = { customer_name: 'Alice', customer_email: 'alice@example.com', customer_phone: '' };
    expect(bp.compareRefreshFields(fetched, batch)).toBe(false);
  });

  it('returns false when customer_email differs', function () {
    var fetched = { customer_name: 'Alice', customer_email: 'new@example.com', customer_phone: '' };
    var batch = { customer_name: 'Alice', customer_email: 'old@example.com', customer_phone: '' };
    expect(bp.compareRefreshFields(fetched, batch)).toBe(false);
  });

  it('returns true (no change) when comparison is case-insensitive', function () {
    var fetched = { customer_name: 'ALICE', customer_email: 'Alice@Example.COM', customer_phone: '' };
    var batch = { customer_name: 'alice', customer_email: 'alice@example.com', customer_phone: '' };
    expect(bp.compareRefreshFields(fetched, batch)).toBe(true);
  });

  it('returns true (no change) when comparison trims whitespace', function () {
    var fetched = { customer_name: '  Alice  ', customer_email: 'alice@example.com', customer_phone: '' };
    var batch = { customer_name: 'Alice', customer_email: 'alice@example.com', customer_phone: '' };
    expect(bp.compareRefreshFields(fetched, batch)).toBe(true);
  });

  it('returns true when buildRefreshUpdates(fetched) is empty (all blank = no change)', function () {
    var fetched = { customer_name: '', customer_email: null, customer_phone: undefined };
    var batch = { customer_name: 'Alice', customer_email: 'alice@example.com', customer_phone: '' };
    expect(bp.compareRefreshFields(fetched, batch)).toBe(true);
  });

  it('returns false when new phone is present in fetched but batch has no phone', function () {
    var fetched = { customer_name: 'Alice', customer_email: 'alice@example.com', customer_phone: '604-555-1234' };
    var batch = { customer_name: 'Alice', customer_email: 'alice@example.com', customer_phone: '' };
    expect(bp.compareRefreshFields(fetched, batch)).toBe(false);
  });

});
