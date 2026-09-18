'use strict';

// Minimal global stubs for admin.js IIFE to load without errors.
// admin.js relies on DOM, SHEETS_CONFIG, google auth, etc.
// Copied verbatim from tests/frontend/admin-beerxml.test.js:1-99 (see that file's
// own comment: jest-environment-jsdom ignores the global.document/global.window
// reassignments below -- the real jsdom document/window win. Kept for parity
// with the established fixture pattern; harmless dead assignments here.)

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

// =============================================================================
// ADMIN-COST-1000X regression: the admin recipe editor multiplied quantity by
// the catalog rate with no unit conversion. Gypsum 10 g at $2.26/kg rendered
// as $22.60; West Coast IPA showed Totals $6,059.66 / $13,809.97. Middleware
// pricing (lib/recipe-scaling.js ingredientLineCost) was always right; the
// client now mirrors it. Harness prelude copied from
// admin-schedule-blast-radius.test.js (see that file's note).
// =============================================================================

describe('recipeLineCost — unit-converted line cost', function () {
  test('grams against a per-kilogram catalog rate (the 1000x bug)', function () {
    var r = admin.recipeLineCost({ quantity: 10, unit: 'g', item_unit: 'kg', purchase_rate: 2.26 }, 'purchase_rate');
    expect(r.ok).toBe(true);
    expect(r.cost).toBeCloseTo(0.0226, 4);
  });

  test('millilitres against a per-litre rate', function () {
    var r = admin.recipeLineCost({ quantity: 250, unit: 'ml', item_unit: 'L', rate: 8 }, 'rate');
    expect(r.ok).toBe(true);
    expect(r.cost).toBeCloseTo(2, 4);
  });

  test('same unit on both sides is a plain multiply', function () {
    expect(admin.recipeLineCost({ quantity: 5, unit: 'kg', item_unit: 'kg', rate: 3.5 }, 'rate').cost).toBeCloseTo(17.5, 4);
  });

  test('count units pass through without numeric conversion', function () {
    expect(admin.recipeLineCost({ quantity: 3, unit: 'pcs', item_unit: 'pack', rate: 4 }, 'rate').cost).toBeCloseTo(12, 4);
  });

  test('a line with no recorded catalog unit is priced as-is (legacy rows)', function () {
    expect(admin.recipeLineCost({ quantity: 2, unit: 'kg', rate: 3 }, 'rate').cost).toBeCloseTo(6, 4);
  });

  test('a cross-family pair fails closed instead of guessing', function () {
    var r = admin.recipeLineCost({ quantity: 2, unit: 'ml', item_unit: 'kg', rate: 3 }, 'rate');
    expect(r.ok).toBe(false);
    expect(r.cost).toBe(0);
    expect(r.error).toMatch(/not convertible/);
  });

  test('an unrecognised (imperial) unit fails closed', function () {
    expect(admin.recipeLineCost({ quantity: 2, unit: 'oz', item_unit: 'kg', rate: 3 }, 'rate').ok).toBe(false);
  });
});

describe('formatLineCost — what the cell shows', function () {
  test('formats the converted cost', function () {
    expect(admin.formatLineCost({ quantity: 10, unit: 'g', item_unit: 'kg', purchase_rate: 2.26 }, 'purchase_rate').text).toBe('$0.02');
  });
  test('shows a dash when the catalog has no rate', function () {
    expect(admin.formatLineCost({ quantity: 10, unit: 'g', item_unit: 'kg', purchase_rate: 0 }, 'purchase_rate').text).toBe('\u2014');
  });
  test('shows ? with the reason when the units cannot convert', function () {
    var c = admin.formatLineCost({ quantity: 10, unit: 'oz', item_unit: 'kg', purchase_rate: 2 }, 'purchase_rate');
    expect(c.text).toBe('?');
    expect(c.title).toMatch(/not convertible/);
  });
});
