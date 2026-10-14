'use strict';

// Phase 89-06 (D-05, D-11): BrewPad recipe editor beer category select and carry-through.

var fs = require('fs');
var path = require('path');

global.document = global.document || {};
global.window = global.window || {};
global.navigator = global.navigator || {};
global.google = { accounts: { oauth2: { initTokenClient: jest.fn() } } };
global.fetch = jest.fn();

var _auth = require('../../js/lib/auth');
global.waitForGoogleIdentity = _auth.waitForGoogleIdentity;
global.gsiInitTokenClient = _auth.gsiInitTokenClient;
global.fetchGoogleUserInfo = _auth.fetchGoogleUserInfo;

var BEER_CATEGORIES = require('../../js/lib/constants').BEER_CATEGORIES;
var bp = require('../../js/brewpad');

var html = fs.readFileSync(path.join(__dirname, '../../brewpad.html'), 'utf8');

describe('brewpad.html beer category select (D-11)', function () {
  var select;
  var styleWrapper;

  beforeAll(function () {
    var host = document.createElement('div');
    host.innerHTML = html.slice(html.indexOf('<body'));
    select = host.querySelector('#bp-recipe-beer-category');
    var style = host.querySelector('#bp-recipe-style');
    styleWrapper = style ? style.parentNode : null;
  });

  test('select exists with class bp-select and a Beer category label', function () {
    expect(select).not.toBeNull();
    expect(select.tagName).toBe('SELECT');
    expect(select.className).toContain('bp-select');
    var label = select.parentNode.querySelector('label[for="bp-recipe-beer-category"]');
    expect(label).not.toBeNull();
    expect(label.textContent.trim()).toBe('Beer category');
  });

  test('is placed immediately after the Style field wrapper', function () {
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

describe('buildRecipePayload beer_category', function () {
  test('sends the chosen category', function () {
    expect(bp.buildRecipePayload({ style: 'x', beer_category: 'ipa' }, []).beer_category).toBe('ipa');
  });

  test('always sends a string; empty clears', function () {
    var p = bp.buildRecipePayload({}, []);
    expect(Object.prototype.hasOwnProperty.call(p, 'beer_category')).toBe(true);
    expect(p.beer_category).toBe('');
  });
});

describe('bpCloneRecipePayload beer_category', function () {
  test('copies the source category', function () {
    expect(bp.bpCloneRecipePayload({ name: 'A', beer_category: 'stout' }, []).recipe.beer_category).toBe('stout');
  });
  test('missing becomes empty string', function () {
    expect(bp.bpCloneRecipePayload({ name: 'A' }, []).recipe.beer_category).toBe('');
  });
});

describe('populateRecipeForm / readRecipeFormData beer_category', function () {
  var sel;
  beforeEach(function () {
    document.body.innerHTML = '<select id="bp-recipe-beer-category"><option value=""></option>' +
      '<option value="pale">Pale</option><option value="ipa">IPA</option></select>';
    sel = document.getElementById('bp-recipe-beer-category');
  });

  test('populate sets the select from recipe.beer_category', function () {
    bp._bpPopulateRecipeFormForTest({ beer_category: 'pale' });
    expect(sel.value).toBe('pale');
  });

  test('populate with no category sets empty', function () {
    sel.value = 'ipa';
    bp._bpPopulateRecipeFormForTest({});
    expect(sel.value).toBe('');
  });

  test('read returns the select value', function () {
    sel.value = 'ipa';
    expect(bp._bpReadRecipeFormDataForTest().beer_category).toBe('ipa');
    sel.value = '';
    expect(bp._bpReadRecipeFormDataForTest().beer_category).toBe('');
  });
});

describe('bpSaveAsNewRecipe beer_category (A4)', function () {
  function post(recipe) {
    bp._bpSetResolvedRecipe({ recipe: recipe, ingredients: [] });
    global.fetch.mockClear();
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: function () { return Promise.resolve({ ok: true, recipe_id: 'RCP-NEW' }); }
    });
    return bp.bpSaveAsNewRecipe('N', []).then(function () {
      return JSON.parse(global.fetch.mock.calls[0][1].body);
    });
  }

  test('copies the source category', function () {
    return post({ style: 's', beer_category: 'ipa' }).then(function (body) {
      expect(body.beer_category).toBe('ipa');
    });
  });

  test('absent becomes empty string', function () {
    return post({ style: 's' }).then(function (body) {
      expect(body.beer_category).toBe('');
    });
  });
});
