'use strict';

// =============================================================================
// Phase 58 (REVIEW-02): admin Kit Inventory must never render a malformed,
// negative, or unrounded price.
//
// The external review found a cell showing "$-68.949…" — a raw, unrounded,
// NEGATIVE value taken straight from the Kits sheet's retail_instore column and
// printed with no validation (js/admin.js renderKitsTab, the fallback price path).
// A negative retail price is nonsensical and a garbage source value must not read
// as a real price.
//
// Owner decision (2026-07-15): a genuinely-MISSING price stays blank (not an
// error — the kit simply has no price entered), but a PRESENT-but-invalid value
// (negative / non-numeric) renders as an em dash so it's visibly not a price.
//
// formatKitPrice() centralizes this so both render paths (Zoho-sourced and
// sheet-fallback) share one rule.
// =============================================================================

global.window = global.window || {};
global.window.confirm = global.window.confirm || jest.fn(function () { return true; });
global.window.addEventListener = global.window.addEventListener || jest.fn();
global.navigator = global.navigator || { userAgent: 'test' };
global.localStorage = global.localStorage || {
  getItem: jest.fn(function () { return null; }), setItem: jest.fn(), removeItem: jest.fn()
};
global.sessionStorage = global.sessionStorage || {
  getItem: jest.fn(function () { return null; }), setItem: jest.fn(), removeItem: jest.fn()
};
global.console = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() };
global.fetch = jest.fn(function () {
  return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({}); } });
});
global.setTimeout = global.setTimeout || function (fn) { if (typeof fn === 'function') fn(); return 1; };
global.SHEETS_CONFIG = {
  MIDDLEWARE_URL: 'http://localhost:3001', MW_API_KEY: 'k', SPREADSHEET_ID: 'id',
  GOOGLE_CLIENT_ID: 'gid', STAFF_EMAILS: 't@e.com', API_BASE: 'https://s/x', SERVER_TOKEN: 'tok'
};

var admin = require('../../js/admin.js');

var DASH = '—';

describe('formatKitPrice — no malformed/negative/unrounded kit price ever renders (REVIEW-02)', function () {

  test('is exported', function () {
    expect(typeof admin.formatKitPrice).toBe('function');
  });

  test('the review value: an unrounded negative renders as a dash, never "$-68.949"', function () {
    var out = admin.formatKitPrice('-68.949999999999');
    expect(out).toBe(DASH);
    expect(out).not.toContain('-68.9');
    expect(out).not.toContain('$');
  });

  test('a numeric negative renders as a dash', function () {
    expect(admin.formatKitPrice(-68.95)).toBe(DASH);
    expect(admin.formatKitPrice('-5')).toBe(DASH);
  });

  test('a valid price is rounded to 2 decimals with a $', function () {
    expect(admin.formatKitPrice(12)).toBe('$12.00');
    expect(admin.formatKitPrice(12.5)).toBe('$12.50');
    expect(admin.formatKitPrice('40.949')).toBe('$40.95');
    expect(admin.formatKitPrice('$40.00')).toBe('$40.00'); // tolerates a leading $
  });

  test('zero is a valid price (not an error)', function () {
    expect(admin.formatKitPrice(0)).toBe('$0.00');
    expect(admin.formatKitPrice('0')).toBe('$0.00');
  });

  test('a non-numeric value renders as a dash', function () {
    expect(admin.formatKitPrice('abc')).toBe(DASH);
    expect(admin.formatKitPrice('N/A')).toBe(DASH);
  });

  test('a genuinely-missing value stays blank (not an error — no price entered)', function () {
    expect(admin.formatKitPrice('')).toBe('');
    expect(admin.formatKitPrice(null)).toBe('');
    expect(admin.formatKitPrice(undefined)).toBe('');
  });
});
