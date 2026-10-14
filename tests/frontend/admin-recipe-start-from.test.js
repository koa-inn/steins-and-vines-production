'use strict';

// =============================================================================
// Tests: admin recipe editor, similar-name list + "Start from this recipe" (90-08, D-21)
// =============================================================================

global.window = global.window || {};
global.window.confirm = global.window.confirm || jest.fn(function () { return true; });
global.window.addEventListener = global.window.addEventListener || jest.fn();
global.navigator = global.navigator || { userAgent: 'test' };
global.localStorage = global.localStorage || {
  getItem: jest.fn(function () { return null; }),
  setItem: jest.fn(),
  removeItem: jest.fn()
};
global.sessionStorage = global.sessionStorage || {
  getItem: jest.fn(function () { return null; }),
  setItem: jest.fn(),
  removeItem: jest.fn()
};
global.console = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() };
global.setInterval = jest.fn(function () { return 1; });
global.clearInterval = jest.fn();
global.alert = jest.fn();
global.Image = global.Image || jest.fn(function () { return {}; });
global.MutationObserver = global.MutationObserver || jest.fn(function () {
  return { observe: jest.fn(), disconnect: jest.fn() };
});
global.IntersectionObserver = global.IntersectionObserver || jest.fn(function () {
  return { observe: jest.fn(), disconnect: jest.fn(), unobserve: jest.fn() };
});
global.google = { accounts: { oauth2: { initTokenClient: jest.fn(function () { return { requestAccessToken: jest.fn() }; }) } } };
global.SHEETS_CONFIG = {
  MIDDLEWARE_URL: 'http://mw.test',
  MW_API_KEY: 'k',
  SPREADSHEET_ID: 'id',
  GOOGLE_CLIENT_ID: 'cid',
  STAFF_EMAILS: 'test@example.com',
  API_BASE: 'https://script.google.com/test',
  SERVER_TOKEN: 't'
};

var admin = require('../../js/admin.js');

var RECIPES = [
  { recipe_id: 'SV-R-000001', name: 'Hazy Pale Ale', style: 'NEIPA', status: 'active' },
  { recipe_id: 'SV-R-000003', name: 'Pale Ale', style: 'American Pale Ale', status: 'active' },
  { recipe_id: 'SV-R-000004', name: 'Stout', style: 'Dry Stout', status: 'draft' },
  { recipe_id: 'SV-R-000005', name: '<b>x</b>', style: '<i>y</i>', status: 'draft' }
];

var DETAIL = {
  recipe: { recipe_id: 'SV-R-000003', name: 'Pale Ale', style: 'American Pale Ale', status: 'active', updated_at: 'U1' },
  ingredients: [{ item_id: 'I1', item_name: 'Malt', quantity: 5, unit: 'kg' }]
};

var IDS = [
  'recipes-list-view', 'recipes-detail-view', 'recipes-detail-title', 'recipes-delete-btn',
  'recipes-duplicate-btn', 'recipes-save-btn', 'recipes-availability-banner',
  'recipes-ingredients-body', 'recipes-ingredients-empty', 'recipe-status-error'
];
var INPUTS = [
  'recipe-name', 'recipe-style', 'recipe-description', 'recipe-batch-size', 'recipe-abv',
  'recipe-ibu', 'recipe-colour', 'recipe-locked-price', 'recipe-service-fee',
  'recipe-materials-fee'
];

function buildDom() {
  var html = '<div id="recipes-list-view"></div><div id="recipes-detail-view" style="display:none">';
  html += '<h2 id="recipes-detail-title"></h2><button id="recipes-delete-btn"></button>';
  html += '<button id="recipes-duplicate-btn"></button><button id="recipes-save-btn">Save Recipe</button>';
  html += '<div id="recipes-availability-banner"></div><div id="recipe-status-error"></div>';
  html += '<table><tbody id="recipes-ingredients-body"></tbody></table><div id="recipes-ingredients-empty"></div>';
  INPUTS.forEach(function (id) {
    html += (id === 'recipe-description' ? '<textarea id="' + id + '"></textarea>' : '<input type="text" id="' + id + '" />');
  });
  html += '<select id="recipe-status"><option value="draft">draft</option><option value="active">active</option></select>';
  html += '<select id="recipe-schedule-select"></select><select id="recipe-beer-category"><option value=""></option></select>';
  html += '<select id="recipe-pricing-mode"><option value="locked">locked</option></select>';
  html += '</div>';
  document.body.innerHTML = html;
  expect(IDS.length).toBeGreaterThan(0);
}

function jsonRes(body) {
  return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(body); } });
}

function flush() {
  return Promise.resolve().then(function () {}).then(function () {}).then(function () {}).then(function () {});
}

function typeName(value) {
  var el = document.getElementById('recipe-name');
  el.value = value;
  el.dispatchEvent(new window.Event('input', { bubbles: true }));
  jest.advanceTimersByTime(250);
}

var fetchLog;
var detailBehaviour;

function installFetch() {
  fetchLog = [];
  detailBehaviour = function () { return jsonRes(DETAIL); };
  global.fetch = jest.fn(function (url, opts) {
    fetchLog.push({ url: url, opts: opts });
    if (url.indexOf('/api/recipes?status=all') !== -1) return jsonRes({ recipes: RECIPES, total: RECIPES.length });
    if (/\/api\/recipes\/SV-R-\d+$/.test(url) && (!opts || !opts.method || opts.method === 'GET')) return detailBehaviour();
    if (url.indexOf('/api/recipes') !== -1 && opts && opts.method === 'POST') return jsonRes({ ok: true, recipe_id: 'SV-R-000099' });
    return jsonRes({});
  });
}

beforeEach(function () {
  jest.useFakeTimers();
  window.RecipePicker = require('../../js/lib/recipe-picker.js');
  buildDom();
  installFetch();
  admin._recipesState.allForDupCheck = null;
  admin._recipesState.currentRecipe = null;
  admin._recipesState.currentIngredients = [];
});

afterEach(function () {
  jest.useRealTimers();
});

function rows() {
  var c = document.getElementById('recipe-name-similar');
  return c ? c.querySelectorAll('.recipe-similar-row') : [];
}

describe('admin recipe editor similar-name list (D-21)', function () {
  test('new-recipe mode fetches status=all once and mounts the container after #recipe-name', async function () {
    admin._openRecipeDetailForTest(null);
    await flush();
    admin._openRecipeDetailForTest(null);
    await flush();
    var allCalls = fetchLog.filter(function (c) { return c.url.indexOf('status=all') !== -1; });
    expect(allCalls.length).toBe(1);
    var nameEl = document.getElementById('recipe-name');
    expect(nameEl.nextElementSibling.id).toBe('recipe-name-similar');
  });

  test('typing "pale" lists matching rows with style and a Start from button', async function () {
    admin._openRecipeDetailForTest(null);
    await flush();
    typeName('pale');
    var r = rows();
    expect(r.length).toBe(2);
    expect(r[0].textContent).toContain('Hazy Pale Ale');
    expect(r[0].textContent).toContain('NEIPA');
    expect(r[1].textContent).toContain('Pale Ale');
    expect(r[0].querySelector('button').textContent).toBe('Start from this recipe');
  });

  test('caps the list at 5 rows', async function () {
    var many = [];
    for (var i = 0; i < 9; i++) many.push({ recipe_id: 'SV-R-0001' + i, name: 'Amber ' + i, style: 'Amber' });
    global.fetch = jest.fn(function () { return jsonRes({ recipes: many, total: 9 }); });
    admin._openRecipeDetailForTest(null);
    await flush();
    typeName('amber');
    expect(rows().length).toBe(5);
  });

  test('exact trimmed case-insensitive match shows the warning, save stays enabled', async function () {
    admin._openRecipeDetailForTest(null);
    await flush();
    typeName('pale ale ');
    var warn = document.querySelector('#recipe-name-similar .recipe-dup-warn');
    expect(warn).not.toBeNull();
    expect(warn.getAttribute('role')).toBe('alert');
    expect(warn.textContent).toBe("A recipe named 'pale ale' already exists.");
    expect(document.getElementById('recipes-save-btn').disabled).toBe(false);
  });

  test('one character shows nothing', async function () {
    admin._openRecipeDetailForTest(null);
    await flush();
    typeName('p');
    expect(rows().length).toBe(0);
    expect(document.querySelector('#recipe-name-similar .recipe-dup-warn')).toBeNull();
  });

  test('edit mode mounts no list and typing shows nothing', async function () {
    admin._openRecipeDetailForTest('SV-R-000003');
    await flush();
    typeName('pale');
    expect(rows().length).toBe(0);
    expect(document.getElementById('recipe-name-similar')).toBeNull();
  });

  test('switching from new to edit clears the list', async function () {
    admin._openRecipeDetailForTest(null);
    await flush();
    typeName('pale');
    expect(rows().length).toBe(2);
    admin._openRecipeDetailForTest('SV-R-000003');
    await flush();
    expect(rows().length).toBe(0);
    typeName('pale');
    expect(rows().length).toBe(0);
  });

  test('escapes names and styles', async function () {
    admin._openRecipeDetailForTest(null);
    await flush();
    typeName('<b>x</b>');
    var c = document.getElementById('recipe-name-similar');
    expect(c.querySelector('b')).toBeNull();
    expect(c.querySelector('i')).toBeNull();
    expect(c.textContent).toContain('<b>x</b>');
    expect(c.textContent).toContain('<i>y</i>');
  });
});

describe('admin Start from this recipe (D-21)', function () {
  async function openAndSearch() {
    admin._openRecipeDetailForTest(null);
    await flush();
    typeName('pale ale');
  }

  function startBtnFor(id) {
    var found = null;
    Array.prototype.forEach.call(rows(), function (r) {
      if (r.getAttribute('data-recipe-id') === id) found = r.querySelector('button');
    });
    return found;
  }

  test('clean form: loads detail, shows the copy, no confirm', async function () {
    await openAndSearch();
    var btn = startBtnFor('SV-R-000003');
    btn.click();
    expect(btn.textContent).toBe('Loading...');
    expect(btn.disabled).toBe(true);
    expect(document.querySelector('.admin-confirm-overlay')).toBeNull();
    await flush();
    expect(fetchLog.some(function (c) { return c.url === 'http://mw.test/api/recipes/SV-R-000003'; })).toBe(true);
    expect(document.getElementById('recipe-name').value).toBe('Copy of Pale Ale');
    expect(document.getElementById('recipe-status').value).toBe('draft');
    expect(admin._recipesState.currentIngredients.length).toBe(1);
    expect(rows().length).toBe(0);
    expect(document.activeElement).toBe(document.getElementById('recipe-name'));
  });

  test('dirty form asks first; cancel leaves form unchanged with no fetch', async function () {
    await openAndSearch();
    document.getElementById('recipe-style').value = 'Mine';
    var before = fetchLog.length;
    startBtnFor('SV-R-000003').click();
    var msg = document.querySelector('.admin-confirm-msg');
    expect(msg.textContent).toBe("Replace what you have entered with a copy of 'Pale Ale'?");
    document.querySelector('.admin-confirm-actions .btn-secondary').click();
    await flush();
    expect(fetchLog.length).toBe(before);
    expect(document.getElementById('recipe-name').value).toBe('pale ale');
    expect(document.getElementById('recipe-style').value).toBe('Mine');
  });

  test('dirty form confirm proceeds', async function () {
    await openAndSearch();
    admin._recipesState.currentIngredients = [{ item_id: 'Z', quantity: 1 }];
    startBtnFor('SV-R-000003').click();
    expect(document.querySelector('.admin-confirm-msg')).not.toBeNull();
    document.querySelector('.admin-confirm-actions .btn').click();
    await flush();
    expect(document.getElementById('recipe-name').value).toBe('Copy of Pale Ale');
  });

  test('fetch failure shows inline alert and re-enables the button', async function () {
    await openAndSearch();
    detailBehaviour = function () { return Promise.resolve({ ok: false, status: 500, json: function () { return Promise.resolve({}); } }); };
    var btn = startBtnFor('SV-R-000003');
    btn.click();
    await flush();
    var alertEl = document.querySelector('#recipe-name-similar [role="alert"].recipe-start-error');
    expect(alertEl).not.toBeNull();
    expect(alertEl.textContent).toBe('Could not load that recipe. Try again.');
    expect(btn.disabled).toBe(false);
    expect(document.getElementById('recipe-name').value).toBe('pale ale');
  });

  test('saving after Start from creates a NEW recipe (no recipe_id, POST)', async function () {
    await openAndSearch();
    startBtnFor('SV-R-000003').click();
    await flush();
    admin._saveRecipeForTest();
    var post = fetchLog.filter(function (c) { return c.opts && c.opts.method === 'POST'; })[0];
    expect(post).toBeDefined();
    expect(post.url).toBe('http://mw.test/api/recipes');
    var body = JSON.parse(post.opts.body);
    expect(body.recipe_id).toBeUndefined();
    expect(body.name).toBe('Copy of Pale Ale');
    expect(admin._recipesState.currentRecipeId).toBeNull();
  });
});
