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
// Admin alert strip: the batch chips ("1 batch task due today", "5 overdue
// batch tasks", "18 batches ready for packaging") rendered twice after a tab
// switch because the dashboard summary is re-fetched and the chips were
// appended each time. They are now replaced.
// =============================================================================

describe('addBatchAttentionItems — re-render replaces the batch chips', function () {
  beforeEach(function () {
    document.body.innerHTML = '<div id="attention-list"><div class="attention-item" data-tab="reservations">2 reservations to confirm</div></div>';
  });

  var summary = { tasksDueToday: 1, overdueTasks: 5, readyForPackaging: 18 };

  test('two calls leave one set of batch chips, and the non-batch chip untouched', function () {
    admin.addBatchAttentionItems(summary);
    admin.addBatchAttentionItems(summary);
    var list = document.getElementById('attention-list');
    expect(list.querySelectorAll('[data-source="batch"]').length).toBe(3);
    expect(list.querySelectorAll('.attention-item').length).toBe(4);
    expect(list.textContent).toContain('2 reservations to confirm');
  });

  test('a later summary with fewer items removes the stale chips', function () {
    admin.addBatchAttentionItems(summary);
    admin.addBatchAttentionItems({ tasksDueToday: 0, overdueTasks: 0, readyForPackaging: 2 });
    var list = document.getElementById('attention-list');
    expect(list.querySelectorAll('[data-source="batch"]').length).toBe(1);
    expect(list.textContent).toContain('2 batches ready for packaging');
    expect(list.textContent).not.toContain('overdue');
  });

  test('an all-zero summary clears the batch chips', function () {
    admin.addBatchAttentionItems(summary);
    admin.addBatchAttentionItems({ tasksDueToday: 0, overdueTasks: 0, readyForPackaging: 0 });
    expect(document.querySelectorAll('[data-source="batch"]').length).toBe(0);
  });
});
