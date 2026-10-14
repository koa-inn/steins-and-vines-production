'use strict';

// Phase 90-09 Task 1: the four BrewPad recipe pickers share one uncapped,
// A-Z, name+style dropdown that opens on focus OR click (D-19/D-20/D-23).

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
global.sessionStorage = global.localStorage;
global.SHEETS_CONFIG = {
  MIDDLEWARE_URL: '', MW_API_KEY: 'k', SPREADSHEET_ID: 'id', GOOGLE_CLIENT_ID: 'c',
  STAFF_EMAILS: 'test@example.com', API_BASE: 'https://script.google.com/test',
  SERVER_TOKEN: 't', ADMIN_API_URL: 'https://script.google.com/test/admin'
};

var _auth = require('../../js/lib/auth');
global.waitForGoogleIdentity = _auth.waitForGoogleIdentity;
global.gsiInitTokenClient = _auth.gsiInitTokenClient;
global.fetchGoogleUserInfo = _auth.fetchGoogleUserInfo;

var bp = require('../../js/brewpad');

function makeCatalog(n) {
  var out = [];
  for (var i = 0; i < n; i++) {
    var num = ('0' + (n - i)).slice(-2); // reverse order so sorting is observable
    out.push({
      recipe_id: 'SV-R-0000' + num,
      name: 'Recipe ' + num,
      style: i % 5 === 0 ? 'IPA' : 'Lager'
    });
  }
  return out;
}

var state = { catalog: [], rejectFirst: false, calls: 0 };

function catalogCalls() {
  return global.fetch.mock.calls.filter(function (c) {
    return String(c[0]).indexOf('/api/recipes?status=active') !== -1;
  }).length;
}

function flush() { return new Promise(function (r) { setTimeout(r, 0); }); }

beforeEach(function () {
  global.fetch.mockReset();
  state.rejectFirst = false;
  state.calls = 0;
  bp._setWaitlistRecipeCatalogForTest(null);
  document.body.innerHTML = '';
  global.fetch.mockImplementation(function (url) {
    if (String(url).indexOf('/api/recipes?status=active') !== -1) {
      state.calls++;
      if (state.rejectFirst && state.calls === 1) return Promise.reject(new Error('down'));
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ recipes: state.catalog }); } });
    }
    return Promise.resolve({ ok: true, json: function () { return Promise.resolve({}); } });
  });
});

var ADAPTERS = {
  'attach-recipe (batch detail)': function () {
    document.body.innerHTML = '<div id="sec"><div class="bp-recipe-empty"></div></div>';
    bp._openRecipeAttachPanelForTest({ batch_id: 'B1' }, document.getElementById('sec'));
    return { input: document.getElementById('bp-recipe-attach-input'), dropdown: document.getElementById('bp-recipe-attach-dropdown') };
  },
  'new-batch Recipes tab': function () {
    document.body.innerHTML = '<input id="bp-new-product-text"><div id="bp-new-product-dropdown" style="display:none"></div>';
    bp._setProductPickerTabForTest('recipes');
    bp._bindRecipePickerSearchForTest();
    return { input: document.getElementById('bp-new-product-text'), dropdown: document.getElementById('bp-new-product-dropdown') };
  },
  'waitlist per-row attach': function () {
    document.body.innerHTML = '<div id="bp-panel-waitlist"></div><div id="bp-toast-container"></div>';
    bp._setWaitlistStateForTest({
      rows: [{ id: 'w1', email: 'a@b.ca', status: 'waiting', signed_up_at: '2026-08-15T08:00:00.000Z', recipe_ids: '', mailerlite_synced: true }],
      filter: 'all', search: ''
    });
    bp.renderWaitlist();
    var cell = document.querySelectorAll('#bp-panel-waitlist tbody tr td')[2];
    bp._openWaitlistRecipeAttachPanelForTest(cell, 'w1');
    return { input: document.getElementById('bp-waitlist-recipe-w1-input'), dropdown: document.getElementById('bp-waitlist-recipe-w1-dropdown') };
  },
  'waitlist manual-add': function () {
    document.body.innerHTML = '<div id="bp-app"><div id="bp-panel-waitlist"></div></div><div id="bp-toast-container"></div>';
    bp._setWaitlistStateForTest({ rows: [], filter: 'all', search: '' });
    bp._openWaitlistAddSheetForTest();
    return { input: document.getElementById('bp-waitlist-add-recipe-input'), dropdown: document.getElementById('bp-waitlist-add-recipe-dropdown') };
  }
};

function rows(dd) { return dd.querySelectorAll('.bp-vessel-option[data-rid]'); }
function fire(el, type, init) {
  var ev = type === 'keydown' ? new KeyboardEvent('keydown', Object.assign({ bubbles: true }, init || {})) : new Event(type, { bubbles: true });
  el.dispatchEvent(ev);
}
function reopen(h, how) {
  h.dropdown.style.display = 'none';
  fire(h.input, how);
}
async function typeTerm(h, term) {
  jest.useFakeTimers();
  h.input.value = term;
  fire(h.input, 'input');
  jest.advanceTimersByTime(300);
  jest.useRealTimers();
  await flush();
}

// attach and waitlist per-row open on creation; the other two wait for focus.
var AUTO_OPEN = { 'attach-recipe (batch detail)': true, 'waitlist per-row attach': true };
function mount(name) {
  var h = ADAPTERS[name]();
  if (!AUTO_OPEN[name]) fire(h.input, 'focus');
  return h;
}

Object.keys(ADAPTERS).forEach(function (name) {
  describe(name, function () {
    test('focus opens ALL 20 active recipes A-Z with name and style', async function () {
      state.catalog = makeCatalog(20);
      var h = mount(name);
      await flush();
      reopen(h, 'focus');
      await flush();
      var r = rows(h.dropdown);
      expect(r.length).toBe(20);
      var names = Array.prototype.map.call(r, function (x) { return x.getAttribute('data-rname'); });
      expect(names).toEqual(names.slice().sort());
      expect(r[0].querySelector('.bp-recipe-opt-name').textContent).toBe('Recipe 01');
      expect(r[0].querySelector('.bp-recipe-opt-style').textContent).toBeTruthy();
      expect(h.dropdown.style.display).not.toBe('none');
    });

    test('click on an already-focused input also opens the full list', async function () {
      state.catalog = makeCatalog(20);
      var h = mount(name);
      await flush();
      reopen(h, 'click');
      await flush();
      expect(rows(h.dropdown).length).toBe(20);
    });

    test('typing narrows by name or style', async function () {
      state.catalog = makeCatalog(20);
      var h = mount(name);
      await flush();
      await typeTerm(h, 'ipa');
      expect(rows(h.dropdown).length).toBe(4);
      expect(h.dropdown.innerHTML).not.toContain('Lager');
    });

    test('empty catalog -> No recipes found; filtered-empty -> clear-search copy', async function () {
      state.catalog = [];
      var h = mount(name);
      await flush();
      expect(h.dropdown.textContent).toContain('No recipes found');
      expect(h.dropdown.textContent).not.toContain('Clear the search');

      state.catalog = makeCatalog(3);
      bp._setWaitlistRecipeCatalogForTest(null);
      h = mount(name);
      await flush();
      await typeTerm(h, 'zzzz-nothing');
      expect(h.dropdown.textContent).toContain('No recipes found. Clear the search to see all.');
    });

    test('shows Loading recipes… first', async function () {
      state.catalog = makeCatalog(2);
      var h = mount(name);
      expect(h.dropdown.textContent).toContain('Loading recipes…');
      await flush();
    });

    test('fetch failure shows retry copy and the next open re-fetches', async function () {
      state.catalog = makeCatalog(5);
      state.rejectFirst = true;
      var h = mount(name);
      await flush();
      expect(h.dropdown.textContent).toContain('Could not load recipes. Tap to retry.');
      expect(catalogCalls()).toBe(1);
      fire(h.input, 'focus');
      await flush();
      expect(catalogCalls()).toBe(2);
      expect(rows(h.dropdown).length).toBe(5);
    });

    test('ARIA wiring and Escape closes', async function () {
      state.catalog = makeCatalog(3);
      var h = mount(name);
      await flush();
      reopen(h, 'focus');
      await flush();
      expect(h.input.getAttribute('role')).toBe('combobox');
      expect(h.input.getAttribute('aria-expanded')).toBe('true');
      expect(h.input.getAttribute('aria-controls')).toBe(h.dropdown.id);
      expect(h.dropdown.getAttribute('role')).toBe('listbox');
      expect(rows(h.dropdown)[0].getAttribute('role')).toBe('option');
      fire(h.input, 'keydown', { key: 'Escape' });
      expect(h.dropdown.style.display).toBe('none');
      expect(h.input.getAttribute('aria-expanded')).toBe('false');
    });

    test('recipe text is escaped', async function () {
      state.catalog = [{ recipe_id: 'SV-R-000001', name: '<img src=x onerror=alert(1)>', style: '<b>S</b>' }];
      var h = mount(name);
      await flush();
      expect(h.dropdown.querySelector('img')).toBeNull();
      expect(h.dropdown.querySelector('b')).toBeNull();
    });
  });
});

describe('new-batch picker tab guard', function () {
  test('kits tab: focusing the shared input does not open the recipe list', async function () {
    state.catalog = makeCatalog(4);
    document.body.innerHTML = '<input id="bp-new-product-text"><div id="bp-new-product-dropdown" style="display:none"></div>';
    bp._setProductPickerTabForTest('kits');
    bp._bindRecipePickerSearchForTest();
    var input = document.getElementById('bp-new-product-text');
    fire(input, 'focus');
    fire(input, 'click');
    await flush();
    expect(catalogCalls()).toBe(0);
    expect(document.getElementById('bp-new-product-dropdown').style.display).toBe('none');
  });
});
