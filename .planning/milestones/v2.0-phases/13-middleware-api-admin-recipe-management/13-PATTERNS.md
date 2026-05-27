# Phase 13: Middleware API + Admin Recipe Management - Pattern Map

**Mapped:** 2026-05-16
**Files analyzed:** 5 (new/modified files)
**Analogs found:** 5 / 5

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `zoho-middleware/routes/recipes.js` | route/controller | request-response (CRUD + proxy) | `zoho-middleware/routes/catalog.js` | role-match (Apps Script source vs Zoho) |
| `zoho-middleware/__tests__/recipes.test.js` | test | — | `zoho-middleware/__tests__/catalog.test.js` | exact |
| `admin.html` | config/template | — | `admin.html` (existing tab structure, lines 119-133, 354-439) | exact |
| `js/admin.js` | component | request-response (tab IIFE) | `js/admin.js` Batches IIFE (lines 5536-8003) + Purchase Orders pattern (lines 3213-3242) | exact |
| `apps-script/adminApi.gs` | service | CRUD | `apps-script/adminApi.gs` createRecipe / updateRecipe (lines 3021-3198) | exact (bug-fix edits) |

---

## Pattern Assignments

### `zoho-middleware/routes/recipes.js` (route/controller, request-response + CRUD proxy)

**Analog:** `zoho-middleware/routes/catalog.js`

**Imports pattern** (catalog.js lines 1-11):
```javascript
'use strict';

var express = require('express');
var cache = require('../lib/cache');
var log = require('../lib/logger');
var C = require('../lib/constants');
var axios = require('axios');  // for Apps Script calls (pattern from brewpad-integration.js line 2)

var router = express.Router();
```

**Cache constants pattern** (catalog.js lines 68-86):
```javascript
// Existing keys already defined in zoho-middleware/lib/constants.js lines 66-69:
// CACHE_KEYS.RECIPES    = 'sv:recipes'
// CACHE_KEYS.RECIPES_TS = 'sv:recipes:ts'

var RECIPES_CACHE_TTL = 600;  // 10 minutes (D-09)
```

**Apps Script call helper pattern** (brewpad-integration.js lines 69-112):
```javascript
// GET: URL params; POST: JSON body with action + server_token in payload
function callAppsScriptGet(action, params) {
  var url = process.env.APPS_SCRIPT_URL;
  var token = process.env.APPS_SCRIPT_SERVER_TOKEN;
  if (!url || !token) {
    log.warn('[recipes] APPS_SCRIPT_URL or APPS_SCRIPT_SERVER_TOKEN not configured');
    return Promise.reject(new Error('Apps Script not configured'));
  }
  var qs = Object.keys(params || {}).map(function (k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
  }).join('&');
  var fullUrl = url + '?action=' + encodeURIComponent(action) + '&server_token=' + encodeURIComponent(token);
  if (qs) fullUrl += '&' + qs;
  return axios.get(fullUrl, { timeout: 15000, maxRedirects: 5 }).then(function (resp) {
    return resp.data;
  });
}

function callAppsScriptPost(action, payload) {
  var url = process.env.APPS_SCRIPT_URL;
  var token = process.env.APPS_SCRIPT_SERVER_TOKEN;
  if (!url || !token) {
    return Promise.reject(new Error('Apps Script not configured'));
  }
  return axios.post(url, JSON.stringify(Object.assign({}, payload, {
    action: action,
    server_token: token
  })), {
    headers: { 'Content-Type': 'application/json' },
    timeout: 15000,
    maxRedirects: 5
  }).then(function (resp) {
    return resp.data;
  });
}
```

**Core GET pattern with cache** (catalog.js lines 327-345, adapted for Apps Script source):
```javascript
// GET /api/recipes — with Redis cache check → Apps Script fallback
router.get('/api/recipes', function (req, res) {
  var status = req.query.status || 'all';
  var limit  = parseInt(req.query.limit,  10) || 0;
  var offset = parseInt(req.query.offset, 10) || 0;
  var cacheKey = C.CACHE_KEYS.RECIPES + ':' + status + ':' + limit + ':' + offset;

  cache.get(cacheKey).then(function (cached) {
    if (cached) {
      log.info('[api/recipes] Cache hit status=' + status);
      return res.json({ source: 'cache', recipes: cached.recipes, total: cached.total });
    }
    return callAppsScriptGet('get_recipes', { status: status, limit: limit, offset: offset })
      .then(function (data) {
        var payload = data.data || {};
        cache.set(cacheKey, payload, RECIPES_CACHE_TTL);
        cache.set(C.CACHE_KEYS.RECIPES_TS, Date.now(), RECIPES_CACHE_TTL);
        res.json({ source: 'apps-script', recipes: payload.recipes || [], total: payload.total || 0 });
      });
  }).catch(function (err) {
    log.error('[api/recipes] ' + err.message);
    res.status(502).json({ error: 'Unable to fetch recipes' });
  });
});
```

**Cache bust on mutation pattern** (catalog.js lines 1005-1022, adapted):
```javascript
// Called after any POST/PUT/DELETE that modifies recipe data
function bustRecipeCache(recipeId) {
  var keys = [C.CACHE_KEYS.RECIPES_TS];
  // Bust all status-variant list keys (mirrors WR-03 fix pattern)
  ['all', 'draft', 'active', 'inactive'].forEach(function (s) {
    keys.push(C.CACHE_KEYS.RECIPES + ':' + s + ':0:0');
  });
  if (recipeId) {
    keys.push(C.CACHE_KEYS.RECIPES + ':' + recipeId);
  }
  return Promise.all(keys.map(function (k) { return cache.del(k); }));
}
```

**POST (mutation) pattern with API key guard** (server.js lines 231-251 — guard is applied globally; route handler pattern from catalog.js lines 969-998):
```javascript
// POST /api/recipes — create new recipe
// X-API-Key guard is applied globally by server.js for all non-GET /api/* routes.
// No additional auth needed in the route handler itself.
router.post('/api/recipes', function (req, res) {
  var payload = req.body || {};
  // Server-side creates use server_token path in Apps Script doPost
  callAppsScriptPost('create_recipe', payload).then(function (data) {
    if (!data.ok) {
      return res.status(422).json({ error: data.message || data.error || 'Create failed' });
    }
    return bustRecipeCache(null).then(function () {
      res.status(201).json({ ok: true, recipe_id: data.recipe_id });
    });
  }).catch(function (err) {
    log.error('[api/recipes] POST failed: ' + err.message);
    res.status(502).json({ error: 'Unable to create recipe' });
  });
});
```

**PUT (update) pattern — Option A: proxy staff token** (Pitfall 3 from RESEARCH.md; auth flow from adminApi.gs lines 229-232):
```javascript
// PUT /api/recipes/:id — update recipe; proxies staff Google accessToken to Apps Script
// Option A: forward token so Apps Script checkAuthorization handles auth
router.put('/api/recipes/:id', function (req, res) {
  var payload = req.body || {};
  payload.recipe_id = req.params.id;

  // D-02 activation guardrail — enforce server-side (Pitfall 7)
  if (payload.status === 'active') {
    var price = parseFloat(payload.locked_price);
    var ingCount = parseInt(payload.ingredient_count, 10) || 0;
    if (!(price > 0) || ingCount < 1) {
      return res.status(422).json({
        error: 'Cannot activate recipe: locked_price must be set and at least one ingredient must exist'
      });
    }
  }

  // Proxy the staff token (Option A) — token sent from admin frontend in req.body.token
  callAppsScriptPost('update_recipe', payload).then(function (data) {
    if (!data.ok) {
      return res.status(422).json({ error: data.message || data.error || 'Update failed' });
    }
    return bustRecipeCache(req.params.id).then(function () {
      res.json({ ok: true });
    });
  }).catch(function (err) {
    log.error('[api/recipes] PUT ' + req.params.id + ' failed: ' + err.message);
    res.status(502).json({ error: 'Unable to update recipe' });
  });
});
```

**Error handling pattern** (catalog.js lines 433-436, consistent throughout):
```javascript
.catch(function (err) {
  log.error('[api/recipes/<context>] ' + err.message);
  res.status(502).json({ error: 'Unable to <action> recipe' });
});
```

**Module export pattern** (catalog.js line 1049):
```javascript
module.exports = router;
```

---

### `zoho-middleware/__tests__/recipes.test.js` (test)

**Analog:** `zoho-middleware/__tests__/catalog.test.js`

**Mock setup pattern** (catalog.test.js lines 1-61):
```javascript
'use strict';

var mockRouteHandlers = {};

jest.mock('express', function () {
  var router = {
    get:    jest.fn(function (path, handler) { mockRouteHandlers[path] = handler; }),
    post:   jest.fn(function (path, handler) { mockRouteHandlers[path] = handler; }),
    put:    jest.fn(function (path, handler) { mockRouteHandlers[path] = handler; }),
    delete: jest.fn(function (path, handler) { mockRouteHandlers[path] = handler; })
  };
  var express = function () {};
  express.Router = function () { return router; };
  return express;
});

jest.mock('axios', function () {
  return { get: jest.fn(), post: jest.fn() };
});

jest.mock('../lib/cache', function () {
  return { get: jest.fn(), set: jest.fn(), del: jest.fn() };
});

jest.mock('../lib/logger', function () {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
});

jest.mock('../lib/constants', function () {
  return {
    CACHE_KEYS: { RECIPES: 'sv:recipes', RECIPES_TS: 'sv:recipes:ts' }
  };
});
```

**Reset-and-load helper pattern** (catalog.test.js lines 66-92):
```javascript
function resetAndLoadRecipes() {
  mockRouteHandlers = {};
  jest.resetModules();
  require('../routes/recipes');
  return {
    axios: require('axios'),
    cache: require('../lib/cache')
  };
}

function callHandler(path, req) {
  return new Promise(function (resolve, reject) {
    var handler = mockRouteHandlers[path];
    if (!handler) return reject(new Error('No handler registered for ' + path));
    var res = {
      _status: 200,
      _body: null,
      status: jest.fn(function (s) { res._status = s; return res; }),
      json:   jest.fn(function (b) { res._body = b; resolve(res); return res; })
    };
    try { handler(req || {}, res); } catch (e) { reject(e); }
  });
}
```

**Test case pattern** (catalog.test.js lines 124-150):
```javascript
describe('GET /api/recipes', function () {
  var mocks;
  beforeEach(function () {
    mocks = resetAndLoadRecipes();
    mocks.cache.get.mockResolvedValue(null);
    mocks.cache.set.mockResolvedValue(true);
    process.env.APPS_SCRIPT_URL = 'https://script.google.com/test';
    process.env.APPS_SCRIPT_SERVER_TOKEN = 'test-token';
  });

  test('returns cached data on cache hit', function () {
    var cached = { recipes: [{ recipe_id: 'SV-R-000001' }], total: 1 };
    mocks.cache.get.mockResolvedValue(cached);
    return callHandler('/api/recipes', { query: { status: 'all' } }).then(function (res) {
      expect(res._body.source).toBe('cache');
      expect(mocks.axios.get).not.toHaveBeenCalled();
    });
  });
  // ... cache miss, 502 error, cache bust on POST/PUT/DELETE ...
});
```

---

### `admin.html` (config/template, tab addition)

**Analog:** `admin.html` existing tab button and panel structure (lines 119-133, 354-439)

**Tab button pattern** (admin.html lines 119-133):
```html
<!-- Insert after line 121 (after "batches" button, before "scheduling") -->
<button type="button" class="admin-tab-btn" data-tab="recipes">Recipes</button>
```

**Tab panel shell pattern** (admin.html lines 354-439, Batches panel as model):
```html
<!-- Insert after #tab-batches closes (after line 439) -->
<div class="admin-tab-panel" id="tab-recipes">
  <!-- List view (shown by default) -->
  <div id="recipes-list-view">
    <div class="admin-panel-header">
      <h2>Recipes</h2>
      <div class="admin-panel-actions">
        <div class="admin-filter-row">
          <label for="recipes-status-filter">Status</label>
          <select id="recipes-status-filter" class="admin-select">
            <option value="all">All</option>
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <button type="button" class="btn" id="recipes-new-btn">+ New Recipe</button>
      </div>
    </div>
    <div class="admin-table-wrap">
      <table class="admin-table" id="recipes-table">
        <thead>
          <tr>
            <th>Recipe ID</th>
            <th>Name</th>
            <th>Style</th>
            <th>Status</th>
            <th>Locked Price</th>
            <th>Ingredients</th>
            <th>Updated</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="recipes-tbody"></tbody>
      </table>
    </div>
    <p class="admin-empty" id="recipes-empty" style="display:none;">No recipes found.</p>
  </div>

  <!-- Detail/editor view (hidden by default; swapped in by JS on row click) -->
  <div id="recipes-detail-view" style="display:none;">
    <div class="admin-panel-header">
      <button type="button" class="btn-secondary" id="recipes-back-btn">&larr; Back to list</button>
      <h2 id="recipes-detail-title">Recipe</h2>
    </div>
    <div id="recipes-availability-banner" class="recipes-availability-banner"></div>
    <div id="recipes-editor-form">
      <!-- Form fields rendered by JS -->
    </div>
    <div class="admin-panel-header">
      <h3>Ingredients</h3>
      <button type="button" class="btn" id="recipes-add-ingredient-btn">+ Add Ingredient</button>
    </div>
    <div id="recipes-ingredients-editor">
      <!-- Ingredient rows rendered by JS -->
    </div>
    <div class="admin-panel-actions" id="recipes-detail-actions">
      <button type="button" class="btn-primary" id="recipes-save-btn">Save</button>
      <button type="button" class="btn-danger" id="recipes-delete-btn">Delete</button>
    </div>
  </div>
</div>
```

---

### `js/admin.js` (component, admin IIFE tab + middleware fetch)

**Analog (tab hook pattern):** `js/admin.js` Batches tab hook (lines 7986-7998)

**Tab hook into initTabNavigation pattern** (admin.js lines 7986-7998):
```javascript
// Append after the batches tab hook block (around line 7998).
// Wraps the existing initTabNavigation with a recipes-tab listener — same pattern
// used by the Batches tab block.
var _origInitTabNavRecipes = initTabNavigation;
initTabNavigation = function () {
  _origInitTabNavRecipes();
  var tabBtns = document.querySelectorAll('.admin-tab-btn');
  tabBtns.forEach(function (btn) {
    if (btn.getAttribute('data-tab') === 'recipes') {
      btn.addEventListener('click', function () { triggerRecipesLoad(); });
      btn.addEventListener('mouseenter', function () { triggerRecipesLoad(); });
    }
  });
};
```

**State object pattern** (modelled on Batches/Kiosk state vars scattered above line 5536):
```javascript
var _recipesState = {
  catalog: [],           // ingredient catalog pre-loaded from /api/catalog/ingredients
  catalogLoaded: false,
  list: [],
  total: 0,
  currentRecipeId: null, // null = list view; string = detail view
  currentRecipe: null,
  currentIngredients: [],
  availability: null
};
var _recipesDataLoaded  = false;
var _recipesDataLoading = false;
```

**Lazy-load guard pattern** (admin.js lines 7979-7984, Batches model):
```javascript
function triggerRecipesLoad() {
  if (_recipesDataLoaded || _recipesDataLoading) return;
  _recipesDataLoading = true;
  _recipesDataLoaded = true;
  initRecipesTab();
}
```

**Middleware fetch helper pattern** (admin.js lines 3213-3242, Purchase Orders model):
```javascript
// Recipes tab uses MIDDLEWARE_URL + MW_API_KEY for all /api/recipes/* calls.
// adminApiGet/adminApiPost are for Apps Script only — do NOT use them here.

function getRecipesMwUrl() {
  return (typeof SHEETS_CONFIG !== 'undefined' && SHEETS_CONFIG.MIDDLEWARE_URL)
    ? SHEETS_CONFIG.MIDDLEWARE_URL : '';
}

function getRecipesMwHeaders(mutating) {
  var h = { 'Content-Type': 'application/json' };
  if (mutating && typeof SHEETS_CONFIG !== 'undefined' && SHEETS_CONFIG.MW_API_KEY) {
    h['X-API-Key'] = SHEETS_CONFIG.MW_API_KEY;
  }
  return h;
}
```

**Middleware GET call pattern** (admin.js lines 3225-3242):
```javascript
function loadRecipeList(statusFilter) {
  var mwUrl = getRecipesMwUrl();
  if (!mwUrl) { showToast('Middleware not configured', 'error'); return; }
  var status = statusFilter || document.getElementById('recipes-status-filter').value || 'all';
  fetch(mwUrl + '/api/recipes?status=' + encodeURIComponent(status), {
    headers: getRecipesMwHeaders(false)
  })
    .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
    .then(function (data) {
      _recipesState.list  = data.recipes || [];
      _recipesState.total = data.total  || 0;
      renderRecipeList();
    })
    .catch(function (err) {
      showToast('Failed to load recipes: ' + err.message, 'error');
    });
}
```

**Middleware PUT/POST call pattern** (admin.js lines 3332-3345, Purchase Orders add-item model):
```javascript
function saveRecipe(recipeId, payload) {
  var mwUrl = getRecipesMwUrl();
  if (!mwUrl) { showToast('Middleware not configured', 'error'); return; }
  var method = recipeId ? 'PUT' : 'POST';
  var url    = recipeId ? mwUrl + '/api/recipes/' + encodeURIComponent(recipeId) : mwUrl + '/api/recipes';
  return fetch(url, {
    method: method,
    headers: getRecipesMwHeaders(true),
    body: JSON.stringify(payload)
  })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (!data.ok) throw new Error(data.error || 'Save failed');
      showToast('Recipe saved', 'success');
      loadRecipeList();
    })
    .catch(function (err) {
      showToast('Failed to save recipe: ' + err.message, 'error');
    });
}
```

**Toast notification pattern** (admin.js lines 88-124):
```javascript
// Use showToast(message, type) throughout. type is 'info' | 'success' | 'error' | 'warning'.
showToast('Recipe saved', 'success');
showToast('Failed to load recipes: ' + err.message, 'error');
```

**escapeHTML for innerHTML pattern** (admin.js line 2399):
```javascript
// Always use escapeHTML() when rendering recipe fields into innerHTML.
// escapeHTML is available at top-level scope (defined in js/lib/utils.js, included in admin IIFE scope).
html += '<td>' + escapeHTML(recipe.name || '') + '</td>';
html += '<td>' + escapeHTML(recipe.style || '') + '</td>';
```

**List/detail swap pattern** (modelled on Batches sub-view swap, admin.js lines 5536-5554):
```javascript
function showRecipesListView() {
  document.getElementById('recipes-list-view').style.display   = '';
  document.getElementById('recipes-detail-view').style.display = 'none';
  _recipesState.currentRecipeId = null;
}

function showRecipesDetailView() {
  document.getElementById('recipes-list-view').style.display   = 'none';
  document.getElementById('recipes-detail-view').style.display = '';
}
```

**Activation guardrail pattern** (D-02; consistent with existing validation approach in admin.js):
```javascript
function canActivateRecipe(formData, ingredients) {
  var price = parseFloat(formData.locked_price);
  if (!(price > 0)) {
    return { ok: false, reason: 'Set a locked price before activating this recipe.' };
  }
  if (!ingredients || ingredients.length === 0) {
    return { ok: false, reason: 'Add at least one ingredient before activating this recipe.' };
  }
  return { ok: true };
}
// Usage before calling saveRecipe():
if (formData.status === 'active') {
  var guard = canActivateRecipe(formData, _recipesState.currentIngredients);
  if (!guard.ok) {
    showToast(guard.reason, 'warning');
    return;
  }
}
```

**Client-side autocomplete pattern** (D-03/D-04; filter in memory, never per-keystroke):
```javascript
// _recipesState.catalog is populated once on tab open from /api/catalog/ingredients.
// filterIngredientCatalog is called from the input's 'input' event listener.
function filterIngredientCatalog(query) {
  var q = (query || '').toLowerCase().trim();
  if (!q) return _recipesState.catalog.slice(0, 20); // top 20 when empty
  return _recipesState.catalog.filter(function (item) {
    return (item.name  || '').toLowerCase().indexOf(q) !== -1 ||
           (item.sku   || '').toLowerCase().indexOf(q) !== -1;
  }).slice(0, 20);
}

// Stock hint text on autocomplete suggestion (D-04):
function ingredientHintText(item) {
  var stock = item.stock_on_hand != null ? item.stock_on_hand : '?';
  var unit  = item.unit || '';
  return escapeHTML(item.name) + ' — ' + stock + (unit ? ' ' + unit : '') + ' available';
}
```

**Availability indicator pattern** (D-07/D-08):
```javascript
// Status-to-CSS-class mapping for colored indicators
var AVAIL_STATUS_CLASS = { ok: 'avail-ok', low: 'avail-low', out: 'avail-out', unknown: 'avail-unknown' };

function renderAvailabilityBanner(availability) {
  var banner = document.getElementById('recipes-availability-banner');
  if (!banner) return;
  if (!availability) { banner.innerHTML = ''; return; }
  var cls = { all_ok: 'banner-ok', some_low: 'banner-low', cannot_brew: 'banner-out' }[availability.summary] || '';
  var msg = { all_ok: 'All ingredients in stock', some_low: 'Some ingredients low', cannot_brew: 'Cannot brew — ingredient(s) out of stock' }[availability.summary] || 'Availability unknown';
  banner.innerHTML = '<div class="availability-banner ' + cls + '">' + escapeHTML(msg) + '</div>';
}
```

**DOMContentLoaded init pattern** (admin.js lines 8000-8002, Batches model):
```javascript
document.addEventListener('DOMContentLoaded', function () {
  initRecipesControls();
});
```

---

### `apps-script/adminApi.gs` (service, CRUD — bug-fix edits only)

**Analog:** Same file — existing `createRecipe` (lines 3021-3104) as the lock pattern to copy.

**CR-01 fix — acquireScriptLock on updateRecipe** (createRecipe pattern at lines 3035, 3101-3103):
```javascript
// updateRecipe currently has NO lock. Wrap its body exactly as createRecipe does:
function updateRecipe(payload, userEmail) {
  if (!payload.recipe_id) {
    return { ok: false, error: 'missing_id', message: 'recipe_id is required' };
  }
  var lock = acquireScriptLock(15000);  // ADD THIS — mirrors createRecipe line 3035
  try {
    // ... existing updateRecipe body (lines 3116-3197) unchanged ...
    return { ok: true, message: 'Recipe updated' };
  } finally {
    lock.releaseLock();  // ADD THIS — mirrors createRecipe lines 3101-3103
  }
}
```

**CR-01 fix — acquireScriptLock on deleteRecipe** (same pattern, lines 3207+):
```javascript
function deleteRecipe(payload, userEmail) {
  if (!payload.recipe_id) {
    return { ok: false, error: 'missing_id', message: 'recipe_id is required' };
  }
  var lock = acquireScriptLock(15000);  // ADD THIS
  try {
    // ... existing deleteRecipe body unchanged ...
  } finally {
    lock.releaseLock();  // ADD THIS
  }
}
```

**WR-03 fix — parameterized cache key for get_recipes** (doGet switch at line 170):
```javascript
// BEFORE (broken):
// case 'get_recipes':
//   return _jsonResponse({ ok: true, data: _cachedGet('gr', 300, function() { ... }) });

// AFTER (fixed):
case 'get_recipes':
  var limit  = parseInt(e.parameter.limit  || '0', 10);
  var offset = parseInt(e.parameter.offset || '0', 10);
  var recipesCacheKey = 'gr:list:' + (e.parameter.status || 'all') + ':' + limit + ':' + offset;
  return _jsonResponse({ ok: true, data: _cachedGet(recipesCacheKey, 300, function() {
    return getRecipes(limit, offset, e.parameter.status || 'all');
  })});
```

**WR-01 fix — hard error when RecipeIngredients sheet missing** (createRecipe lines 3070-3091):
```javascript
// BEFORE: silently skips ingredient creation when ingSheet is null
// AFTER: return error immediately
if (ingredients && ingredients.length > 0) {
  var ingSheet = ss.getSheetByName(RECIPE_INGREDIENTS_SHEET_NAME);
  if (!ingSheet) {
    return { ok: false, error: 'sheet_not_found', message: 'RecipeIngredients sheet not found — run setupRecipeTabs() first' };
  }
  // ... existing loop ...
}
```

**WR-02 fix — remove dead cache key from _invalidateRecipeCache** (line ~2938):
```javascript
// Replace the static key 'grl' (dead) with all active status-variant keys
function _invalidateRecipeCache(recipeId) {
  var cache = CacheService.getScriptCache();
  var keys = [];
  ['all', 'draft', 'active', 'inactive'].forEach(function (s) {
    keys.push('gr:list:' + s + ':0:0');  // covers default pagination
  });
  if (recipeId) {
    keys.push('gr:' + recipeId);
  }
  cache.removeAll(keys);
}
```

**update_recipe / delete_recipe doPost routing** (doPost switch at line 234, staff-auth path):
```javascript
// Add to the staff-auth switch block (alongside existing update_reservation, update_batch, etc.)
case 'update_recipe':
  return _jsonResponse(updateRecipe(payload, authResult.email));

case 'delete_recipe':
  return _jsonResponse(deleteRecipe(payload, authResult.email));
```

---

## Shared Patterns

### API Key Guard (mutating endpoints)
**Source:** `zoho-middleware/server.js` lines 231-251
**Apply to:** All POST/PUT/DELETE handlers in `routes/recipes.js` (guard applied globally — no per-route code needed)
```javascript
// Server.js applies this to ALL /api/* non-GET requests automatically:
app.use('/api', function (req, res, next) {
  if (req.method === 'GET') return next();
  if (req.headers['x-api-key'] === API_SECRET_KEY) return next();
  res.status(403).json({ error: 'Forbidden' });
});
// Admin.js passes MW_API_KEY via getMwHeaders(true) → 'X-API-Key' header.
```

### Error Logging Pattern
**Source:** `zoho-middleware/routes/catalog.js` (consistent throughout)
**Apply to:** All route handlers in `routes/recipes.js`
```javascript
log.error('[api/recipes/<route-context>] ' + err.message);
res.status(502).json({ error: 'Unable to <action> recipe' });
```

### escapeHTML for XSS Prevention
**Source:** `js/admin.js` line 2399 (uses `js/lib/utils.js`)
**Apply to:** All recipe/ingredient field rendering via innerHTML in `js/admin.js`
```javascript
// escapeHTML is at top-level scope in admin.js IIFE. Call it on every field
// rendered into innerHTML: recipe.name, recipe.style, recipe.description,
// ingredient.item_name, ingredient.unit — never use el.innerHTML = rawValue.
html += '<td>' + escapeHTML(recipe.name || '') + '</td>';
```

### showToast for User Feedback
**Source:** `js/admin.js` lines 88-124
**Apply to:** All async operations in the Recipes tab JS
```javascript
showToast('Recipe saved', 'success');
showToast('Failed to load recipes: ' + err.message, 'error');
showToast('Cannot activate: set locked price first', 'warning');
```

### acquireScriptLock for Apps Script Mutations
**Source:** `apps-script/adminApi.gs` lines 3035, 3101-3103 (createRecipe as model)
**Apply to:** `updateRecipe` and `deleteRecipe` in `adminApi.gs` (CR-01 fix)
```javascript
var lock = acquireScriptLock(15000);
try {
  // ... mutation logic ...
} finally {
  lock.releaseLock();
}
```

### Zoho Auth Guard (Apps Script doPost)
**Source:** `apps-script/adminApi.gs` lines 229-232
**Apply to:** `update_recipe` and `delete_recipe` cases in `doPost()` switch — these use the staff-auth path, NOT the server_token path. The middleware proxies the staff's token in `payload.token` (Option A from RESEARCH.md Pitfall 3).
```javascript
// Staff-auth path in doPost (already exists for update_reservation, update_batch, etc.):
var authResult = checkAuthorization(e);
if (!authResult.authorized) {
  return _jsonResponse({ ok: false, error: 'unauthorized', message: authResult.message });
}
// update_recipe and delete_recipe cases go here, alongside existing staff-auth cases.
```

---

## No Analog Found

None — all five files have direct analogs in the codebase. This phase is wiring, not invention (per RESEARCH.md Summary).

---

## Metadata

**Analog search scope:** `zoho-middleware/routes/`, `zoho-middleware/__tests__/`, `zoho-middleware/lib/`, `js/admin.js`, `admin.html`, `apps-script/adminApi.gs`
**Files scanned:** 8 (catalog.js, brewpad-integration.js, server.js, constants.js, admin.js, admin.html, adminApi.gs, catalog.test.js)
**Pattern extraction date:** 2026-05-16
