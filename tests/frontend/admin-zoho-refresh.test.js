'use strict';

// Minimal global stubs for admin.js IIFE to load without errors.
// admin.js relies on DOM, SHEETS_CONFIG, google auth, etc.

var mockElements = {};
function createMockElement() {
  return {
    style: {},
    className: '',
    textContent: '',
    innerHTML: '',
    value: '',
    disabled: false,
    setAttribute: jest.fn(),
    getAttribute: jest.fn(function () { return null; }),
    addEventListener: jest.fn(),
    querySelector: jest.fn(function () { return null; }),
    querySelectorAll: jest.fn(function () { return []; }),
    appendChild: jest.fn(),
    closest: jest.fn(function () { return null; }),
    remove: jest.fn(),
    classList: { add: jest.fn(), remove: jest.fn(), contains: jest.fn() },
    parentNode: { querySelector: jest.fn(function () { return null; }), appendChild: jest.fn() },
    focus: jest.fn()
  };
}

global.document = {
  getElementById: jest.fn(function (id) {
    if (!mockElements[id]) mockElements[id] = createMockElement();
    return mockElements[id];
  }),
  querySelectorAll: jest.fn(function () { return []; }),
  querySelector: jest.fn(function () { return null; }),
  addEventListener: jest.fn(),
  createElement: jest.fn(function () { return createMockElement(); }),
  body: { appendChild: jest.fn() }
};

global.window = {
  confirm: jest.fn(function () { return true; }),
  location: { search: '', pathname: '/admin.html', href: '' },
  addEventListener: jest.fn(),
  matchMedia: jest.fn(function () { return { matches: false, addEventListener: jest.fn() }; })
};

global.navigator = { userAgent: 'test' };
global.localStorage = {
  getItem: jest.fn(function () { return null; }),
  setItem: jest.fn(),
  removeItem: jest.fn()
};
global.sessionStorage = {
  getItem: jest.fn(function () { return null; }),
  setItem: jest.fn(),
  removeItem: jest.fn()
};
global.console = {
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn()
};
global.fetch = jest.fn(function () {
  return Promise.resolve({ ok: true, json: function () { return Promise.resolve({}); } });
});
global.setTimeout = jest.fn(function (fn) { if (typeof fn === 'function') fn(); return 1; });
global.clearTimeout = jest.fn();
global.setInterval = jest.fn(function () { return 1; });
global.clearInterval = jest.fn();
global.alert = jest.fn();
global.Image = jest.fn(function () { return {}; });
global.URLSearchParams = function (s) {
  this.get = function () { return null; };
  this.has = function () { return false; };
};
global.MutationObserver = jest.fn(function () {
  return { observe: jest.fn(), disconnect: jest.fn() };
});
global.IntersectionObserver = jest.fn(function () {
  return { observe: jest.fn(), disconnect: jest.fn(), unobserve: jest.fn() };
});

// Google Identity stubs
global.google = { accounts: { oauth2: { initTokenClient: jest.fn(function () { return { requestAccessToken: jest.fn() }; }) } } };

// SHEETS_CONFIG stub (normally from js/sheets-config.js)
global.SHEETS_CONFIG = {
  MIDDLEWARE_URL: 'http://localhost:3001',
  MW_API_KEY: 'test-key',
  SPREADSHEET_ID: 'test-id',
  GOOGLE_CLIENT_ID: 'test-client-id',
  STAFF_EMAILS: 'test@example.com',
  API_BASE: 'https://script.google.com/test',
  SERVER_TOKEN: 'test-token'
};

// Load admin.js (the IIFE will run and export via module.exports)
var admin = require('../../js/admin.js');

// ---------------------------------------------------------------------------
// isValidZohoNumber
// ---------------------------------------------------------------------------
describe('isValidZohoNumber', function () {
  test('returns true for INV-000123', function () {
    expect(admin.isValidZohoNumber('INV-000123')).toBe(true);
  });

  test('returns true for SO-42', function () {
    expect(admin.isValidZohoNumber('SO-42')).toBe(true);
  });

  test('returns true for inv-5 (case-insensitive)', function () {
    expect(admin.isValidZohoNumber('inv-5')).toBe(true);
  });

  test('returns true for so-123 (case-insensitive)', function () {
    expect(admin.isValidZohoNumber('so-123')).toBe(true);
  });

  test('returns false for empty string', function () {
    expect(admin.isValidZohoNumber('')).toBe(false);
  });

  test('returns false for "Not linked"', function () {
    expect(admin.isValidZohoNumber('Not linked')).toBe(false);
  });

  test('returns false for bare number "12345"', function () {
    expect(admin.isValidZohoNumber('12345')).toBe(false);
  });

  test('returns false for null', function () {
    expect(admin.isValidZohoNumber(null)).toBe(false);
  });

  test('returns false for undefined', function () {
    expect(admin.isValidZohoNumber(undefined)).toBe(false);
  });

  test('returns false for "INV-" (no digits)', function () {
    expect(admin.isValidZohoNumber('INV-')).toBe(false);
  });

  test('returns false for "INV-abc" (non-digits)', function () {
    expect(admin.isValidZohoNumber('INV-abc')).toBe(false);
  });

  // CR-01 contract: middleware normalizes to uppercase (plan 29-04 Task 1),
  // so the case-insensitive frontend gate and middleware now accept the same refs.
  test('returns true for inv-000123 — matches normalized middleware contract (CR-01)', function () {
    expect(admin.isValidZohoNumber('inv-000123')).toBe(true);
  });

  test('returns true for so-42 — matches normalized middleware contract (CR-01)', function () {
    expect(admin.isValidZohoNumber('so-42')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// splitCustomerName
// ---------------------------------------------------------------------------
describe('splitCustomerName', function () {

  test('splits "Jane Smith" into first="Jane", last="Smith"', function () {
    var result = admin.splitCustomerName('Jane Smith');
    expect(result.customer_firstname).toBe('Jane');
    expect(result.customer_lastname).toBe('Smith');
  });

  test('splits single-token "Cher" into first="Cher", last=""', function () {
    var result = admin.splitCustomerName('Cher');
    expect(result.customer_firstname).toBe('Cher');
    expect(result.customer_lastname).toBe('');
  });

  test('handles extra whitespace: "  Mary  Jane  Watson " => first="Mary", last="Jane Watson"', function () {
    var result = admin.splitCustomerName('  Mary  Jane  Watson ');
    expect(result.customer_firstname).toBe('Mary');
    expect(result.customer_lastname).toBe('Jane Watson');
  });

  test('handles empty string => first="", last=""', function () {
    var result = admin.splitCustomerName('');
    expect(result.customer_firstname).toBe('');
    expect(result.customer_lastname).toBe('');
  });

});

// ---------------------------------------------------------------------------
// buildRefreshUpdates
// ---------------------------------------------------------------------------
describe('buildRefreshUpdates', function () {
  test('returns object with non-empty customer_name and customer_email when phone is blank', function () {
    var result = admin.buildRefreshUpdates({
      customer_name: 'A',
      customer_email: 'a@b.co',
      customer_phone: ''
    });
    expect(result).toEqual({ customer_name: 'A', customer_email: 'a@b.co' });
  });

  test('omits blank phone', function () {
    var result = admin.buildRefreshUpdates({
      customer_name: 'Alice',
      customer_email: 'alice@example.com',
      customer_phone: ''
    });
    expect(result).not.toHaveProperty('customer_phone');
  });

  test('returns empty object when all fields are blank', function () {
    var result = admin.buildRefreshUpdates({
      customer_name: '',
      customer_email: '',
      customer_phone: ''
    });
    expect(result).toEqual({});
  });

  test('returns empty object when all fields are null', function () {
    var result = admin.buildRefreshUpdates({
      customer_name: null,
      customer_email: null,
      customer_phone: null
    });
    expect(result).toEqual({});
  });

  test('omits undefined fields', function () {
    var result = admin.buildRefreshUpdates({
      customer_name: 'Bob',
      customer_email: undefined,
      customer_phone: undefined
    });
    expect(result).toEqual({ customer_name: 'Bob' });
  });

  test('never emits a key with value empty string', function () {
    var result = admin.buildRefreshUpdates({
      customer_name: 'Test',
      customer_email: '',
      customer_phone: ''
    });
    var values = Object.values(result);
    values.forEach(function (v) {
      expect(v).not.toBe('');
      expect(v).not.toBeNull();
      expect(v).not.toBeUndefined();
    });
  });

  test('includes all three fields when all are non-empty', function () {
    var result = admin.buildRefreshUpdates({
      customer_name: 'Alice',
      customer_email: 'alice@example.com',
      customer_phone: '604-555-1234'
    });
    expect(result).toEqual({
      customer_name: 'Alice',
      customer_email: 'alice@example.com',
      customer_phone: '604-555-1234'
    });
  });

  test('trims whitespace before checking emptiness', function () {
    var result = admin.buildRefreshUpdates({
      customer_name: '   ',
      customer_email: 'a@b.co',
      customer_phone: '  '
    });
    expect(result).not.toHaveProperty('customer_name');
    expect(result).not.toHaveProperty('customer_phone');
    expect(result).toEqual({ customer_email: 'a@b.co' });
  });
});

// ---------------------------------------------------------------------------
// compareRefreshFields
// ---------------------------------------------------------------------------
describe('compareRefreshFields', function () {
  test('returns true (no change) when all non-empty fetched fields match batch values', function () {
    var fetched = { customer_name: 'Alice', customer_email: 'alice@example.com', customer_phone: '' };
    var batch = { customer_name: 'Alice', customer_email: 'alice@example.com', customer_phone: '604-555-1234' };
    expect(admin.compareRefreshFields(fetched, batch)).toBe(true);
  });

  test('returns false when a fetched field differs from batch', function () {
    var fetched = { customer_name: 'Alice Updated', customer_email: 'alice@example.com', customer_phone: '' };
    var batch = { customer_name: 'Alice', customer_email: 'alice@example.com', customer_phone: '' };
    expect(admin.compareRefreshFields(fetched, batch)).toBe(false);
  });

  test('returns true when buildRefreshUpdates(fetched) is empty', function () {
    var fetched = { customer_name: '', customer_email: null, customer_phone: null };
    var batch = { customer_name: 'Alice', customer_email: 'alice@example.com', customer_phone: '' };
    expect(admin.compareRefreshFields(fetched, batch)).toBe(true);
  });

  test('comparison is case-insensitive', function () {
    var fetched = { customer_name: 'ALICE', customer_email: 'ALICE@EXAMPLE.COM', customer_phone: '' };
    var batch = { customer_name: 'alice', customer_email: 'alice@example.com', customer_phone: '' };
    expect(admin.compareRefreshFields(fetched, batch)).toBe(true);
  });

  test('comparison trims whitespace', function () {
    var fetched = { customer_name: '  Alice  ', customer_email: 'alice@example.com', customer_phone: '' };
    var batch = { customer_name: 'Alice', customer_email: 'alice@example.com', customer_phone: '' };
    expect(admin.compareRefreshFields(fetched, batch)).toBe(true);
  });

  test('returns false when email differs', function () {
    var fetched = { customer_name: 'Alice', customer_email: 'newemail@example.com', customer_phone: '' };
    var batch = { customer_name: 'Alice', customer_email: 'old@example.com', customer_phone: '' };
    expect(admin.compareRefreshFields(fetched, batch)).toBe(false);
  });

  test('returns false when phone differs', function () {
    var fetched = { customer_name: 'Alice', customer_email: '', customer_phone: '604-555-9999' };
    var batch = { customer_name: 'Alice', customer_email: '', customer_phone: '604-555-1234' };
    expect(admin.compareRefreshFields(fetched, batch)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildRefreshUpdates — trim parity (WR-04)
// ---------------------------------------------------------------------------
describe('buildRefreshUpdates — trim parity', function () {
  test('trims padded customer_name before writing', function () {
    var result = admin.buildRefreshUpdates({ customer_name: '  Alice  ', customer_email: '', customer_phone: '' });
    expect(result.customer_name).toBe('Alice');
  });
});

// ---------------------------------------------------------------------------
// isVersionConflict
// ---------------------------------------------------------------------------
describe('isVersionConflict', function () {

  test('returns true for the Apps Script "modified" conflict message', function () {
    expect(admin.isVersionConflict('Batch was modified by another user. Refresh and try again.')).toBe(true);
  });

  test('returns true for a "version" mismatch message', function () {
    expect(admin.isVersionConflict('version mismatch')).toBe(true);
  });

  test('returns false for a generic failure message', function () {
    expect(admin.isVersionConflict('Refresh failed — try again')).toBe(false);
  });

  test('returns false for null', function () {
    expect(admin.isVersionConflict(null)).toBe(false);
  });

  test('returns false for empty string', function () {
    expect(admin.isVersionConflict('')).toBe(false);
  });

});
