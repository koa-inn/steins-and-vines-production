'use strict';

// Phase 89-06 (D-05, D-11): admin recipe editor beer category select and carry-through.

var fs = require('fs');
var path = require('path');

global.window = global.window || {};
global.window.confirm = jest.fn(function () { return true; });
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
global.fetch = jest.fn();
global.alert = jest.fn();
global.Image = global.Image || jest.fn(function () { return {}; });
global.MutationObserver = global.MutationObserver || jest.fn(function () {
  return { observe: jest.fn(), disconnect: jest.fn() };
});
global.IntersectionObserver = global.IntersectionObserver || jest.fn(function () {
  return { observe: jest.fn(), disconnect: jest.fn(), unobserve: jest.fn() };
});
global.google = {
  accounts: { oauth2: { initTokenClient: jest.fn(function () { return { requestAccessToken: jest.fn() }; }) } }
};
global.SHEETS_CONFIG = {
  MIDDLEWARE_URL: 'http://mw.test',
  MW_API_KEY: 'test-api-key',
  SPREADSHEET_ID: 'test-id',
  GOOGLE_CLIENT_ID: 'test-client-id',
  STAFF_EMAILS: 'test@example.com',
  API_BASE: 'https://script.google.com/test',
  SERVER_TOKEN: 'test-token'
};

var BEER_CATEGORIES = require('../../js/lib/constants').BEER_CATEGORIES;
var admin = require('../../js/admin.js');

function tick(ms) { return new Promise(function (r) { setTimeout(r, ms || 20); }); }

function el(id, tag) {
  var e = document.createElement(tag || 'div');
  e.id = id;
  document.body.appendChild(e);
  return e;
}

function buildDom() {
  document.body.innerHTML = '';
  el('admin-toast-container');
  ['recipe-name', 'recipe-style', 'recipe-description', 'recipe-batch-size', 'recipe-abv', 'recipe-ibu',
    'recipe-colour', 'recipe-locked-price', 'recipe-service-fee', 'recipe-materials-fee'].forEach(function (id) {
    el(id, 'input');
  });
  el('recipe-schedule-select', 'select');
  el('recipe-pricing-mode', 'input').value = 'locked';
  el('recipe-status', 'input').value = 'draft';
  el('recipe-status-error', 'span');
  el('recipes-save-btn', 'button');
  var sel = el('recipe-beer-category', 'select');
  ['', 'lager', 'brown', 'pilsner'].forEach(function (v) {
    var o = document.createElement('option');
    o.value = v;
    o.textContent = v;
    sel.appendChild(o);
  });
  document.getElementById('recipe-name').value = 'Test IPA';
}

function okReply(body) {
  return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(body); } });
}

describe('admin.html beer category select (D-11)', function () {
  var html = fs.readFileSync(path.join(__dirname, '../../admin.html'), 'utf8');
  var host = document.createElement('div');
  host.innerHTML = html.slice(html.indexOf('<body'));
  var select = host.querySelector('#recipe-beer-category');

  test('select exists with class admin-select and a Beer category label', function () {
    expect(select).not.toBeNull();
    expect(select.tagName).toBe('SELECT');
    expect(select.className).toContain('admin-select');
    var label = select.parentNode.querySelector('label[for="recipe-beer-category"]');
    expect(label).not.toBeNull();
    expect(label.textContent.trim()).toBe('Beer category');
  });

  test('is placed immediately after the Style field wrapper', function () {
    var styleWrapper = host.querySelector('#recipe-style').parentNode;
    expect(select.parentNode.previousElementSibling).toBe(styleWrapper);
  });

  test('options are a blank None (gold) option then BEER_CATEGORIES in order', function () {
    var opts = select.options;
    expect(opts.length).toBe(BEER_CATEGORIES.length + 1);
    expect(opts[0].value).toBe('');
    expect(opts[0].textContent).toBe('— None (gold) —');
    BEER_CATEGORIES.forEach(function (c, i) {
      expect(opts[i + 1].value).toBe(c.key);
      expect(opts[i + 1].textContent).toBe(c.label);
    });
  });
});

describe('admin populateRecipeForm / saveRecipe beer_category', function () {
  beforeEach(function () {
    global.fetch.mockReset();
    buildDom();
    admin._recipesState.currentRecipeId = null;
    admin._recipesState.currentRecipe = null;
    admin._recipesState.currentIngredients = [];
  });

  test('populate sets the select from recipe.beer_category', function () {
    admin._populateRecipeFormForTest({ beer_category: 'brown' });
    expect(document.getElementById('recipe-beer-category').value).toBe('brown');
  });

  test('populate with no category sets empty', function () {
    document.getElementById('recipe-beer-category').value = 'lager';
    admin._populateRecipeFormForTest({});
    expect(document.getElementById('recipe-beer-category').value).toBe('');
  });

  function saveBody(value) {
    document.getElementById('recipe-beer-category').value = value;
    global.fetch.mockImplementation(function () { return okReply({ ok: true, recipe_id: 'RCP-9' }); });
    admin._recipesSaveForTest();
    return tick().then(function () {
      var posts = global.fetch.mock.calls.filter(function (c) { return c[1] && c[1].method === 'POST'; });
      expect(posts.length).toBe(1);
      return JSON.parse(posts[0][1].body);
    });
  }

  test('save sends the chosen category', function () {
    return saveBody('lager').then(function (body) { expect(body.beer_category).toBe('lager'); });
  });

  test('save with None sends empty string and succeeds (D-05)', function () {
    return saveBody('').then(function (body) { expect(body.beer_category).toBe(''); });
  });
});

describe('kioskSaveAsNewRecipe beer_category (A4)', function () {
  function post(recipe) {
    admin._kioskSetSelectedRecipe(recipe);
    global.fetch.mockReset();
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: function () { return Promise.resolve({ ok: true, recipe_id: 'RCP-NEW' }); }
    });
    return admin.kioskSaveAsNewRecipe('N', []).then(function () {
      return JSON.parse(global.fetch.mock.calls[0][1].body);
    });
  }

  test('copies the source category', function () {
    return post({ style: 's', beer_category: 'pilsner' }).then(function (body) {
      expect(body.beer_category).toBe('pilsner');
    });
  });

  test('absent becomes empty string', function () {
    return post({ style: 's' }).then(function (body) {
      expect(body.beer_category).toBe('');
    });
  });
});
