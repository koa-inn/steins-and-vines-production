'use strict';

// =============================================================================
// Tests: Phase 73 Plan 05 — BrewPad recipe editor save resilience (D-05).
//
// The recipe editor was the ONLY major BrewPad form NOT protected by the
// existing _formSavers session-draft system, and saveRecipe() ignored HTTP
// status (parsed r.json() without checking r.ok) -- so a 422/502 could be
// misread as success and a session-expiry/reload silently lost the edits.
//
// This suite pins:
//   (a) draft round-trip: a save FAILURE snapshots the recipe form to
//       sessionStorage under 'sv-brewpad-recipe-draft'; restoreAllFormDrafts()
//       repopulates it (populateRecipeForm + renderIngredientRows).
//   (b) non-2xx-as-error: a 422/502 response is ALWAYS a failure, even when
//       the JSON body doesn't carry the old ad-hoc {ok:false, error} shape
//       (the exact way the bug let a real failure slip through as "success").
//   (c) code/cause consumption: a 422 unit_mismatch + cause names/highlights
//       the offending ingredient row; code/cause absent falls back to the
//       human `error` string without crashing.
//   (d) retry: a 502/network failure offers a retry affordance that
//       re-submits the SAME already-built payload, not a form re-read.
// =============================================================================

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
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(this._data, k) ? this._data[k] : null; },
  setItem: function (k, v) { this._data[k] = v; },
  removeItem: function (k) { delete this._data[k]; },
  clear: function () { this._data = {}; }
};

global.SHEETS_CONFIG = {
  MIDDLEWARE_URL: 'http://mw.test',
  MW_API_KEY: 'test-api-key',
  SPREADSHEET_ID: 'test-id',
  GOOGLE_CLIENT_ID: 'test-client-id',
  STAFF_EMAILS: 'test@example.com',
  API_BASE: 'https://script.google.com/test',
  SERVER_TOKEN: 'test-token',
  ADMIN_API_URL: 'https://script.google.com/test/admin'
};

// auth.js primitives are loaded via <script> in the browser; wire as globals for tests.
var _auth = require('../../js/lib/auth');
global.waitForGoogleIdentity = _auth.waitForGoogleIdentity;
global.gsiInitTokenClient = _auth.gsiInitTokenClient;
global.fetchGoogleUserInfo = _auth.fetchGoogleUserInfo;

var bp = require('../../js/brewpad');

// ---------------------------------------------------------------------------
// DOM fixture helpers
// ---------------------------------------------------------------------------

function injectEl(id, tag) {
  var existing = document.getElementById(id);
  if (existing) return existing;
  var el = document.createElement(tag || 'div');
  el.id = id;
  document.body.appendChild(el);
  return el;
}

// Builds the full recipe editor DOM the save/draft/restore path touches.
function buildRecipeEditorDom() {
  document.body.innerHTML = '';

  injectEl('bp-recipes-detail-view', 'div');
  injectEl('bp-recipes-list-view', 'div');
  injectEl('bp-recipe-detail-title', 'h2');
  injectEl('bp-recipes-save-btn', 'button');
  injectEl('bp-recipe-delete', 'button');
  injectEl('bp-recipe-clone', 'button');
  injectEl('bp-recipe-activate', 'button');

  injectEl('bp-recipe-name', 'input');
  injectEl('bp-recipe-style', 'input');
  injectEl('bp-recipe-description', 'textarea');
  injectEl('bp-recipe-batch-size', 'input');
  injectEl('bp-recipe-abv', 'input');
  injectEl('bp-recipe-ibu', 'input');
  injectEl('bp-recipe-colour-srm', 'input');
  injectEl('bp-recipe-pricing-mode', 'input');
  injectEl('bp-recipe-locked-price', 'input');
  injectEl('bp-recipe-service-fee', 'input');
  injectEl('bp-recipe-materials-fee', 'input');
  injectEl('bp-recipe-status', 'input');
  injectEl('bp-recipe-status-error', 'span');

  var table = document.createElement('table');
  var tbody = document.createElement('tbody');
  tbody.id = 'bp-recipe-ing-tbody';
  var tfoot = document.createElement('tfoot');
  tfoot.id = 'bp-recipe-ing-tfoot';
  table.appendChild(tbody);
  table.appendChild(tfoot);
  document.body.appendChild(table);
  injectEl('bp-recipe-ing-empty', 'div');
  injectEl('bp-recipes-availability-banner', 'div');

  injectEl('bp-toast-container', 'div');

  document.getElementById('bp-recipes-detail-view').style.display = 'none';
  document.getElementById('bp-recipes-list-view').style.display = '';
}

function setField(id, value) {
  var el = document.getElementById(id);
  if (el) el.value = value;
}

function showRecipeDetail() {
  document.getElementById('bp-recipes-detail-view').style.display = '';
  document.getElementById('bp-recipes-list-view').style.display = 'none';
}

function fillValidRecipeForm() {
  showRecipeDetail();
  setField('bp-recipe-name', 'Test Recipe');
  setField('bp-recipe-style', 'IPA');
  setField('bp-recipe-description', 'A test recipe');
  setField('bp-recipe-batch-size', '23');
  setField('bp-recipe-abv', '5.5');
  setField('bp-recipe-ibu', '40');
  setField('bp-recipe-colour-srm', '8');
  setField('bp-recipe-pricing-mode', 'locked');
  setField('bp-recipe-locked-price', '29.99');
  setField('bp-recipe-service-fee', '45');
  setField('bp-recipe-materials-fee', '5');
  setField('bp-recipe-status', 'draft');
}

var TEST_INGREDIENTS = [
  { item_id: 'I1', item_name: 'Cascade Hops', quantity: 5, unit: 'kg', purchase_rate: 2, rate: 3 }
];

function wait(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

// ---------------------------------------------------------------------------
// Toast inspection helpers
// ---------------------------------------------------------------------------

function toastEls() {
  var container = document.getElementById('bp-toast-container');
  return container ? Array.prototype.slice.call(container.querySelectorAll('.bp-toast')) : [];
}

function lastToast() {
  var els = toastEls();
  return els.length ? els[els.length - 1] : null;
}

function lastToastText() {
  var t = lastToast();
  if (!t) return '';
  var msg = t.querySelector('.bp-toast-msg');
  return msg ? msg.textContent : '';
}

function lastToastIsError() {
  var t = lastToast();
  return !!t && t.className.indexOf('bp-toast--error') !== -1;
}

function lastToastIsSuccess() {
  var t = lastToast();
  return !!t && t.className.indexOf('bp-toast--success') !== -1;
}

// ---------------------------------------------------------------------------
// Fetch mock — routes recipe save (POST/PUT /api/recipes[...]) vs anything
// else (e.g. switchTab('recipes') -> initRecipesTab's list/catalog GETs
// triggered by restoreAllFormDrafts) to a harmless default response.
// ---------------------------------------------------------------------------

function queueSaveResponses(responses) {
  var queue = responses.slice();
  global.fetch.mockImplementation(function (url, opts) {
    var method = (opts && opts.method) || 'GET';
    var isSaveCall = String(url).indexOf('/api/recipes') !== -1 &&
      (method === 'POST' || method === 'PUT') &&
      String(url).indexOf('?') === -1;

    if (isSaveCall) {
      var next = queue.shift();
      if (!next) return Promise.reject(new Error('no more mock save responses queued'));
      if (next.networkError) return Promise.reject(new Error(next.networkError));
      return Promise.resolve({
        ok: next.ok,
        status: next.status,
        json: function () { return Promise.resolve(next.body || {}); }
      });
    }

    // Non-save calls (list/catalog reloads triggered by switchTab during restore).
    return Promise.resolve({
      ok: true,
      status: 200,
      json: function () { return Promise.resolve({ recipes: [], items: [], ingredients: [] }); }
    });
  });
}

function saveCalls() {
  return global.fetch.mock.calls.filter(function (c) {
    var method = (c[1] && c[1].method) || 'GET';
    return String(c[0]).indexOf('/api/recipes') !== -1 &&
      (method === 'POST' || method === 'PUT') &&
      String(c[0]).indexOf('?') === -1;
  });
}

// ---------------------------------------------------------------------------

beforeEach(function () {
  global.fetch.mockReset();
  global.sessionStorage.clear();
  buildRecipeEditorDom();
  bp._setRecipesStateForTest({
    currentRecipeId: null,
    currentRecipe: null,
    currentIngredients: [],
    availability: null,
    previousStatus: 'draft'
  });
});

// ---------------------------------------------------------------------------
// (a) Draft round-trip on save failure
// ---------------------------------------------------------------------------

describe('recipe draft round-trip on save failure', function () {
  test('a failed save snapshots the recipe form to sessionStorage under sv-brewpad-recipe-draft', function () {
    fillValidRecipeForm();
    bp._setRecipesStateForTest({
      currentRecipeId: 'RCP-1',
      currentIngredients: TEST_INGREDIENTS.slice()
    });

    queueSaveResponses([{
      ok: false,
      status: 422,
      body: { error: 'Cannot save recipe: unit mismatch', code: 'unit_mismatch', cause: 'Cascade Hops' }
    }]);

    return bp.saveRecipe().then(function () {
      var raw = global.sessionStorage.getItem('sv-brewpad-recipe-draft');
      expect(raw).not.toBeNull();
      var draft = JSON.parse(raw);
      expect(draft.formData.name).toBe('Test Recipe');
      expect(draft.ingredients.length).toBe(1);
      expect(draft.ingredients[0].item_name).toBe('Cascade Hops');
    });
  });

  test('restoreAllFormDrafts repopulates the form (populateRecipeForm) and ingredient rows (renderIngredientRows)', function () {
    fillValidRecipeForm();
    bp._setRecipesStateForTest({
      currentRecipeId: 'RCP-1',
      currentIngredients: TEST_INGREDIENTS.slice()
    });

    queueSaveResponses([{
      ok: false,
      status: 422,
      body: { error: 'Cannot save recipe: unit mismatch', code: 'unit_mismatch', cause: 'Cascade Hops' }
    }]);

    return bp.saveRecipe().then(function () {
      expect(global.sessionStorage.getItem('sv-brewpad-recipe-draft')).not.toBeNull();

      // Simulate session-expiry / reload: wipe the form and in-memory state.
      setField('bp-recipe-name', '');
      document.getElementById('bp-recipe-ing-tbody').innerHTML = '';
      document.getElementById('bp-recipes-detail-view').style.display = 'none';
      bp._setRecipesStateForTest({ currentRecipeId: null, currentIngredients: [] });

      var restored = bp.restoreAllFormDrafts();
      expect(restored).toBe(true);

      return wait(250).then(function () {
        expect(document.getElementById('bp-recipe-name').value).toBe('Test Recipe');
        expect(document.getElementById('bp-recipe-ing-tbody').innerHTML.indexOf('Cascade Hops')).not.toBe(-1);
        // Draft is consumed on restore (matches the existing _formSavers contract).
        expect(global.sessionStorage.getItem('sv-brewpad-recipe-draft')).toBeNull();
      });
    });
  });

  test('a successful save does NOT leave a stale draft behind', function () {
    fillValidRecipeForm();
    bp._setRecipesStateForTest({
      currentRecipeId: 'RCP-1',
      currentIngredients: TEST_INGREDIENTS.slice()
    });

    queueSaveResponses([{ ok: true, status: 200, body: { ok: true } }]);

    return bp.saveRecipe().then(function () {
      expect(global.sessionStorage.getItem('sv-brewpad-recipe-draft')).toBeNull();
    });
  });

  test('the recipe form is registered in the _formSavers draft system (source pin)', function () {
    var src = require('fs').readFileSync(require('path').join(__dirname, '../../js/brewpad.js'), 'utf8');
    expect(src.indexOf('sv-brewpad-recipe-draft')).not.toBe(-1);
    expect(/_formSavers\.push\(\{\s*key:\s*RECIPE_DRAFT_KEY/.test(src) || src.indexOf("_formSavers.push({\n    key: 'sv-brewpad-recipe-draft'") !== -1 ||
      (src.indexOf('_formSavers.push(') !== -1 && src.indexOf('sv-brewpad-recipe-draft') !== -1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (b) Non-2xx is ALWAYS treated as a failure
// ---------------------------------------------------------------------------

describe('non-2xx responses are never misread as success', function () {
  test('a 422 with an empty body (no ok/error fields) is still a failure', function () {
    fillValidRecipeForm();
    bp._setRecipesStateForTest({ currentRecipeId: 'RCP-1', currentIngredients: TEST_INGREDIENTS.slice() });

    // This is the exact shape that slipped through the old `!data.ok && data.error`
    // check: no `.ok` and no `.error` on the body means the old code fell through
    // to the success branch on a 422.
    queueSaveResponses([{ ok: false, status: 422, body: {} }]);

    return bp.saveRecipe().then(function () {
      expect(lastToastIsSuccess()).toBe(false);
      expect(lastToastIsError()).toBe(true);
    });
  });

  test('a 502 with an empty body is still a failure', function () {
    fillValidRecipeForm();
    bp._setRecipesStateForTest({ currentRecipeId: 'RCP-1', currentIngredients: TEST_INGREDIENTS.slice() });

    queueSaveResponses([{ ok: false, status: 502, body: {} }]);

    return bp.saveRecipe().then(function () {
      expect(lastToastIsSuccess()).toBe(false);
      expect(lastToastIsError()).toBe(true);
    });
  });

  test('a 2xx response still takes the success path', function () {
    fillValidRecipeForm();
    bp._setRecipesStateForTest({ currentRecipeId: 'RCP-1', currentIngredients: TEST_INGREDIENTS.slice() });

    queueSaveResponses([{ ok: true, status: 200, body: { ok: true } }]);

    return bp.saveRecipe().then(function () {
      expect(lastToastIsSuccess()).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// (c) code/cause consumption with graceful fallback
// ---------------------------------------------------------------------------

describe('D-03 code/cause consumption', function () {
  test('a 422 unit_mismatch with cause surfaces the named cause and highlights the ingredient row', function () {
    fillValidRecipeForm();
    bp._setRecipesStateForTest({ currentRecipeId: 'RCP-1', currentIngredients: TEST_INGREDIENTS.slice() });
    bp.renderIngredientRows(TEST_INGREDIENTS.slice(), null);

    queueSaveResponses([{
      ok: false,
      status: 422,
      body: { error: 'Cannot save recipe: unit mismatch', code: 'unit_mismatch', cause: 'Cascade Hops' }
    }]);

    return bp.saveRecipe().then(function () {
      expect(lastToastText().indexOf('Cascade Hops')).not.toBe(-1);
      var row = document.querySelector('.bp-recipes-ing-row[data-item-id="I1"]');
      expect(row).not.toBeNull();
      expect(row.className.indexOf('bp-ing-row--error')).not.toBe(-1);
    });
  });

  test('a 422 without code/cause falls back to the human error string without crashing', function () {
    fillValidRecipeForm();
    bp._setRecipesStateForTest({ currentRecipeId: 'RCP-1', currentIngredients: TEST_INGREDIENTS.slice() });
    bp.renderIngredientRows(TEST_INGREDIENTS.slice(), null);

    queueSaveResponses([{
      ok: false,
      status: 422,
      body: { error: 'Something else went wrong entirely.' }
    }]);

    return bp.saveRecipe().then(function () {
      expect(lastToastText().indexOf('Something else went wrong entirely.')).not.toBe(-1);
      var row = document.querySelector('.bp-recipes-ing-row[data-item-id="I1"]');
      // No cause -> no row should be flagged.
      expect(row && row.className.indexOf('bp-ing-row--error') !== -1).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// (d) Retry on transient failure, re-submitting the SAME payload
// ---------------------------------------------------------------------------

describe('retry on transient (network/502) failure', function () {
  test('a 502 offers a retry that re-submits the original payload, not a form re-read', function () {
    fillValidRecipeForm();
    bp._setRecipesStateForTest({ currentRecipeId: 'RCP-1', currentIngredients: TEST_INGREDIENTS.slice() });

    queueSaveResponses([
      { ok: false, status: 502, body: {} },
      { ok: true, status: 200, body: { ok: true } }
    ]);

    return bp.saveRecipe().then(function () {
      expect(saveCalls().length).toBe(1);

      var retryBtn = document.querySelector('#bp-toast-container .bp-toast-action');
      expect(retryBtn).not.toBeNull();

      // Mutate the form AFTER the failure -- the retry must NOT re-read this.
      setField('bp-recipe-name', 'Changed After Failure');

      retryBtn.dispatchEvent(new window.Event('click', { bubbles: true }));

      return wait(50).then(function () {
        expect(saveCalls().length).toBe(2);
        var firstBody = JSON.parse(saveCalls()[0][1].body);
        var secondBody = JSON.parse(saveCalls()[1][1].body);
        expect(secondBody.name).toBe(firstBody.name);
        expect(secondBody.name).toBe('Test Recipe');
        expect(secondBody.name).not.toBe('Changed After Failure');
      });
    });
  });

  test('a network-level failure (fetch rejects) also offers a retry', function () {
    fillValidRecipeForm();
    bp._setRecipesStateForTest({ currentRecipeId: 'RCP-1', currentIngredients: TEST_INGREDIENTS.slice() });

    queueSaveResponses([
      { networkError: 'Failed to fetch' },
      { ok: true, status: 200, body: { ok: true } }
    ]);

    return bp.saveRecipe().then(function () {
      var retryBtn = document.querySelector('#bp-toast-container .bp-toast-action');
      expect(retryBtn).not.toBeNull();
    });
  });

  test('a 422 (non-transient) does NOT offer a retry affordance', function () {
    fillValidRecipeForm();
    bp._setRecipesStateForTest({ currentRecipeId: 'RCP-1', currentIngredients: TEST_INGREDIENTS.slice() });

    queueSaveResponses([{
      ok: false,
      status: 422,
      body: { error: 'Cannot save recipe: unit mismatch', code: 'unit_mismatch', cause: 'Cascade Hops' }
    }]);

    return bp.saveRecipe().then(function () {
      var retryBtn = document.querySelector('#bp-toast-container .bp-toast-action');
      expect(retryBtn).toBeNull();
    });
  });
});
