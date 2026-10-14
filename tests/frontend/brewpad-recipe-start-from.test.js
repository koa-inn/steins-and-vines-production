'use strict';

// Phase 90-09 Task 2: BrewPad recipe editor duplicate check + "Start from this recipe" (D-21).

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
  MIDDLEWARE_URL: 'http://mw.test', MW_API_KEY: 'k', SPREADSHEET_ID: 'id', GOOGLE_CLIENT_ID: 'c',
  STAFF_EMAILS: 'test@example.com', API_BASE: 'https://script.google.com/test',
  SERVER_TOKEN: 't', ADMIN_API_URL: 'https://script.google.com/test/admin'
};

var _auth = require('../../js/lib/auth');
global.waitForGoogleIdentity = _auth.waitForGoogleIdentity;
global.gsiInitTokenClient = _auth.gsiInitTokenClient;
global.fetchGoogleUserInfo = _auth.fetchGoogleUserInfo;

var bp = require('../../js/brewpad');

var ALL = [
  { recipe_id: 'SV-R-000003', name: 'Pale Ale', style: 'American Pale', status: 'active' },
  { recipe_id: 'SV-R-000004', name: 'Pale Lager', style: 'Lager', status: 'draft' },
  { recipe_id: 'SV-R-000005', name: 'Stout', style: 'Stout', status: 'archived' }
];
var DETAIL = {
  recipe: { recipe_id: 'SV-R-000003', name: 'Pale Ale', style: 'American Pale', beer_category: 'pale', status: 'active', batch_size_l: 20 },
  ingredients: [{ item_id: 'I1', item_name: 'Malt', quantity: 5, unit: 'kg' }]
};

var detailMode = 'ok';

function allCalls() {
  return global.fetch.mock.calls.filter(function (c) { return String(c[0]).indexOf('/api/recipes?status=all') !== -1; });
}
function detailCalls() {
  return global.fetch.mock.calls.filter(function (c) { return String(c[0]).indexOf('/api/recipes/SV-R-000003') !== -1 && String(c[0]).indexOf('availability') === -1; });
}
function flush() { return new Promise(function (r) { setTimeout(r, 0); }); }

function mountEditor() {
  document.body.innerHTML =
    '<div id="bp-recipes-list-view"></div><div id="bp-recipes-detail-view" style="display:none">' +
    '<h2 id="bp-recipe-detail-title"></h2><div id="bp-recipes-availability-banner"></div>' +
    '<div><input id="bp-recipe-name"></div>' +
    '<input id="bp-recipe-style"><select id="bp-recipe-beer-category"><option value=""></option><option value="pale">Pale</option></select>' +
    '<textarea id="bp-recipe-description"></textarea><input id="bp-recipe-status">' +
    '<table><tbody id="bp-recipe-ing-tbody"></tbody></table><p id="bp-recipe-ing-empty"></p>' +
    '<button id="bp-recipes-save-btn"></button><button id="bp-recipe-delete"></button><button id="bp-recipe-clone"></button>' +
    '</div><div id="bp-toast-container"></div>';
}

function typeName(v) {
  var el = document.getElementById('bp-recipe-name');
  el.value = v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  jest.advanceTimersByTime(250);
}

beforeEach(function () {
  global.fetch.mockReset();
  detailMode = 'ok';
  mountEditor();
  bp._setRecipesStateForTest({ allForDupCheck: null, currentRecipeId: null, currentRecipe: null, currentIngredients: [] });
  global.fetch.mockImplementation(function (url) {
    var u = String(url);
    if (u.indexOf('/api/recipes?status=all') !== -1) {
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ recipes: ALL }); } });
    }
    if (u.indexOf('/api/recipes/SV-R-000003') !== -1 && u.indexOf('availability') === -1) {
      if (detailMode === 'fail') return Promise.resolve({ ok: false, status: 500, json: function () { return Promise.resolve({}); } });
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve(DETAIL); } });
    }
    return Promise.resolve({ ok: true, json: function () { return Promise.resolve({}); } });
  });
  jest.useFakeTimers();
});

afterEach(function () { jest.useRealTimers(); });

async function openNew() {
  bp._openRecipeDetailForTest(null);
  jest.useRealTimers();
  await flush();
  jest.useFakeTimers();
}

describe('similar-name assist (new-recipe mode)', function () {
  test('openRecipeDetail(null) fetches status=all once and mounts the container after the name input', async function () {
    await openNew();
    expect(allCalls().length).toBe(1);
    expect(bp._getRecipesStateForTest().allForDupCheck.length).toBe(3);
    var box = document.getElementById('bp-recipe-name-similar');
    expect(box).not.toBeNull();
    expect(box.previousElementSibling.id).toBe('bp-recipe-name');
    await openNew();
    expect(allCalls().length).toBe(1);
  });

  test('typing pale lists similar rows with a Start from button; 1 char shows nothing; Save stays enabled', async function () {
    await openNew();
    typeName('pale');
    var rows = document.querySelectorAll('#bp-recipe-name-similar .bp-recipe-similar-row');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('Pale Ale');
    expect(rows[0].textContent).toContain('American Pale');
    var btn = rows[0].querySelector('button');
    expect(btn.textContent).toBe('Start from this recipe');
    expect(document.querySelector('.bp-recipe-dup')).toBeNull();
    expect(document.getElementById('bp-recipes-save-btn').disabled).toBe(false);
    typeName('p');
    expect(document.querySelectorAll('.bp-recipe-similar-row').length).toBe(0);
  });

  test('exact match (case/space-insensitive) shows the dup warning and still lists rows', async function () {
    await openNew();
    typeName('  pale ale ');
    var warn = document.querySelector('.bp-recipe-dup');
    expect(warn).not.toBeNull();
    expect(warn.getAttribute('role')).toBe('alert');
    expect(warn.textContent).toBe("A recipe named 'Pale Ale' already exists.");
    expect(document.getElementById('bp-recipes-save-btn').disabled).toBe(false);
  });

  test('edit mode shows no similar list', async function () {
    bp._openRecipeDetailForTest('SV-R-000003');
    jest.useRealTimers();
    await flush();
    jest.useFakeTimers();
    typeName('pale');
    expect(document.querySelectorAll('.bp-recipe-similar-row').length).toBe(0);
  });

  test('recipe text is escaped', async function () {
    bp._setRecipesStateForTest({ allForDupCheck: [{ recipe_id: 'X', name: '<img src=x onerror=1> Pale', style: '<b>s</b>' }] });
    bp._initBpRecipeNameAssistForTest();
    typeName('pale');
    expect(document.querySelector('#bp-recipe-name-similar img')).toBeNull();
    expect(document.querySelector('#bp-recipe-name-similar b')).toBeNull();
  });
});

describe('Start from this recipe', function () {
  test('clean form: fetches detail, fills a Copy of ... draft, clears the list, no confirm', async function () {
    await openNew();
    typeName('pale');
    var btn = document.querySelector('.bp-recipe-similar-row button');
    btn.click();
    expect(btn.textContent).toBe('Loading...');
    expect(btn.disabled).toBe(true);
    jest.useRealTimers();
    await flush(); await flush();
    expect(detailCalls().length).toBe(1);
    expect(document.getElementById('bp-recipe-name').value).toBe('Copy of Pale Ale');
    expect(document.getElementById('bp-recipe-status').value).toBe('draft');
    expect(document.getElementById('bp-recipe-beer-category').value).toBe('pale');
    expect(document.querySelectorAll('#bp-recipe-ing-tbody tr').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('.bp-recipe-similar-row').length).toBe(0);
    expect(document.activeElement.id).toBe('bp-recipe-name');
    expect(document.querySelector('.bp-confirm-sheet--visible')).toBeNull();
    expect(bp._getRecipesStateForTest().currentRecipeId).toBeNull();
  });

  test('dirty form: asks first and fetches nothing until OK', async function () {
    await openNew();
    document.getElementById('bp-recipe-style').value = 'My style';
    typeName('pale');
    document.querySelector('.bp-recipe-similar-row button').click();
    expect(document.getElementById('bp-confirm-sheet-msg').textContent)
      .toBe("Replace what you have entered with a copy of 'Pale Ale'?");
    expect(document.getElementById('bp-confirm-sheet-ok').textContent).toBe('Start from copy');
    expect(detailCalls().length).toBe(0);
    document.getElementById('bp-confirm-sheet-ok').click();
    jest.useRealTimers();
    await flush(); await flush();
    expect(detailCalls().length).toBe(1);
    expect(document.getElementById('bp-recipe-name').value).toBe('Copy of Pale Ale');
  });

  test('fetch failure shows an alert and leaves the form unchanged', async function () {
    await openNew();
    typeName('pale');
    detailMode = 'fail';
    document.querySelector('.bp-recipe-similar-row button').click();
    jest.useRealTimers();
    await flush(); await flush();
    var err = document.querySelector('#bp-recipe-name-similar [role="alert"]');
    expect(err.textContent).toBe('Could not load that recipe. Try again.');
    expect(document.getElementById('bp-recipe-name').value).toBe('pale');
    expect(document.querySelector('.bp-recipe-similar-row button').disabled).toBe(false);
  });
});
