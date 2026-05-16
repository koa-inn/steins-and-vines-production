# Phase 13: Middleware API + Admin Recipe Management - Research

**Researched:** 2026-05-16
**Domain:** Express.js middleware route authoring, Google Apps Script CRUD, Redis caching, vanilla JS admin IIFE pattern
**Confidence:** HIGH (entire analysis derived from direct codebase reads; no external documentation needed for stack questions since the project already uses all relevant patterns)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** List → detail view swap pattern. Recipe list as a table; clicking a recipe replaces the list with a full detail/editor view. Back button returns to list.
- **D-02:** Activation guardrails — staff cannot set a recipe to `active` unless `locked_price` is set and at least one ingredient exists.
- **D-03:** Pre-load the full ingredient catalog when the Recipes tab opens. Autocomplete searches client-side — no per-keystroke API calls.
- **D-04:** Ingredient autocomplete auto-populates: item_name, unit, and current stock level as a hint (e.g., "Pale Malt — 45 kg available").
- **D-05:** Store Zoho `item_id` (internal numeric ID) as the ingredient reference in RecipeIngredients, not the SKU string.
- **D-06:** Auto-check availability on recipe detail load via `GET /api/recipes/:id/availability`.
- **D-07:** Per-ingredient colored indicators (green/yellow/red) on each ingredient row, plus a recipe-level summary banner.
- **D-08:** Yellow "low stock" threshold is batch-count based — yellow when remaining stock covers fewer than 3 batches of this recipe.
- **D-09:** Long cache TTL (10-15 minutes) for recipe data with explicit invalidation on mutation.
- **D-10 (carry-forward CR-01):** `updateRecipe` and `deleteRecipe` in adminApi.gs need `acquireScriptLock` added.
- **D-11 (carry-forward WR-03):** `get_recipes` cache key must incorporate `status/limit/offset` before admin UI fetches filtered recipe lists.

### Claude's Discretion
- Tab placement: after Batches tab in admin panel
- Ingredient editor UX: inline autocomplete + editable rows with add/remove buttons, quantity/unit fields, stock-level hint
- Route file structure: new `routes/recipes.js`, clean separation from Zoho catalog routes
- API response reshaping: middleware normalizes Apps Script response to clean REST contract

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| API-01 | Middleware exposes GET/POST/PUT/DELETE endpoints for recipe CRUD with Redis caching | `routes/recipes.js` pattern mirrors `routes/catalog.js`; `CACHE_KEYS.RECIPES` and `CACHE_KEYS.RECIPES_TS` already defined in constants.js |
| API-02 | Recipe API resolves ingredient references to Zoho item IDs server-side (never trusts client) | Middleware fetches recipe detail from Apps Script (which stores item_id); availability check queries Zoho stock by item_id server-side |
| API-03 | Recipe availability endpoint checks all ingredient stock levels against recipe quantities | `GET /api/catalog/ingredients` returns stock_on_hand per item; availability route cross-references ingredient list from Apps Script |
| ADM-01 | Admin panel has a "Recipes" tab where staff can list, create, edit, and activate/deactivate recipes | 11-tab pattern exists in admin.html + admin.js; adding a 12th tab follows exact same `data-tab` / `tab-{name}` panel pattern |
| ADM-02 | Recipe editor allows adding/removing ingredient line items with Zoho SKU lookup and quantity input | Ingredient catalog pre-loaded from existing `/api/catalog/ingredients`; client-side autocomplete searches name/SKU fields |
| ADM-03 | Staff can set a locked price and brewing fee per recipe independently | Apps Script `createRecipe`/`updateRecipe` already accept `locked_price`, `service_fee`, `materials_fee` fields; admin form exposes all three |
</phase_requirements>

---

## Summary

Phase 13 adds two things: (1) a new Express route file `routes/recipes.js` that proxies recipe CRUD between the admin and Apps Script with Redis caching, plus a stock-availability endpoint that cross-references Zoho inventory; (2) a new "Recipes" tab in `admin.html` and `js/admin.js` where staff can list, create, edit, and activate/deactivate recipes with an inline ingredient editor.

The entire stack is already in production. Apps Script recipe CRUD functions (`createRecipe`, `getRecipes`, `getRecipeDetail`, `updateRecipe`, `deleteRecipe`) were implemented in Phase 12. Redis cache keys (`CACHE_KEYS.RECIPES`, `CACHE_KEYS.RECIPES_TS`) are already defined in `zoho-middleware/lib/constants.js`. The ingredient catalog endpoint (`GET /api/catalog/ingredients`) already returns item_id, SKU, name, unit, and stock. The admin IIFE tab pattern already exists for 11 other tabs. This phase is almost entirely wiring these pieces together with the carry-forward bug fixes from the Phase 12 code review.

The two carry-forward fixes (CR-01: missing lock in `updateRecipe`/`deleteRecipe`; WR-03: parameterized cache key for `get_recipes`) must land in the same phase since the admin UI will immediately exercise filtered recipe listing and concurrent write operations.

**Primary recommendation:** Implement in order — (1) Apps Script bug fixes (CR-01, WR-03), (2) `routes/recipes.js` with cache + availability, (3) admin Recipes tab HTML shell, (4) admin JS list view, (5) admin JS detail/editor view. This order ensures each piece is testable before the next depends on it.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Recipe CRUD persistence | Apps Script (Google Sheets) | — | Phase 12 established this; data lives in Recipes + RecipeIngredients tabs |
| Recipe CRUD API contract | Middleware (Express) | — | `routes/recipes.js` is the authoritative HTTP interface; reshapes Apps Script response |
| Redis recipe caching | Middleware | — | Cache keys already defined; mirrors catalog.js pattern exactly |
| Ingredient stock lookup for availability | Middleware | — | Server-side Zoho lookup; client never supplies raw SKUs (API-02) |
| Admin recipe list/editor UI | Frontend (admin.js IIFE) | — | Follows existing 11-tab admin IIFE pattern |
| Ingredient autocomplete catalog | Frontend (pre-loaded) | Middleware (supplier) | Catalog pre-loaded on tab open from `/api/catalog/ingredients`; search runs client-side |
| Activation guardrail (D-02) | Frontend | Middleware (validation) | Frontend blocks the UI; middleware can also reject `status=active` if missing price/ingredients |

---

## Standard Stack

### Core (all already in use — verified by codebase read)

| Library/Pattern | Version | Purpose | Status |
|-----------------|---------|---------|--------|
| Express.js router | existing | `routes/recipes.js` route module | [VERIFIED: zoho-middleware/package.json via ls] |
| axios | existing | Middleware → Apps Script HTTP calls (synchronous request-response) | [VERIFIED: brewpad-integration.js uses axios] |
| Redis cache (`lib/cache.js`) | existing | Recipe list + detail caching, cache-bust on mutation | [VERIFIED: constants.js CACHE_KEYS.RECIPES defined] |
| Google Apps Script | existing | Recipe CRUD data store via `adminApi.gs` | [VERIFIED: apps-script/adminApi.gs lines 2930-3266] |
| Vanilla JS IIFE | existing | Admin tab panel JS pattern | [VERIFIED: admin.js 8890 lines, initBatchSubTabs pattern] |
| `adminApiGet` / `adminApiPost` | existing | Admin JS → Apps Script HTTP wrappers | [VERIFIED: admin.js lines 630-674] |

### No New Dependencies Required
This phase introduces zero new npm packages. All required infrastructure is in place. [VERIFIED: by codebase analysis]

---

## Architecture Patterns

### System Architecture Diagram

```
Admin Browser (admin.js IIFE)
  |
  |-- Tab click "recipes" ──────────────────────────────────────────────────────────┐
  |                                                                                   |
  |-- Pre-load ingredient catalog ──── GET /api/catalog/ingredients ──► Redis cache  |
  |                                         (existing endpoint)            or Zoho   |
  |                                                                                   |
  |-- List view ─────────────────────► GET /api/recipes ──────────────► Apps Script  |
  |                                    (new middleware route)              get_recipes |
  |                                         |                                         |
  |                                         ▼                                         |
  |                                    Redis cache                                    |
  |                                    (sv:recipes)                                   |
  |                                                                                   |
  |-- Click recipe row ───────────────► GET /api/recipes/:id ──────────► Apps Script  |
  |                                    + GET /api/recipes/:id/availability   get_recipe|
  |                                         |                                         |
  |                                         ▼ (availability)                          |
  |                                    Zoho Inventory                                 |
  |                                    stock_on_hand per item_id                      |
  |                                                                                   |
  |-- Save changes ──────────────────► PUT /api/recipes/:id ──────────► Apps Script  |
  |                                    (with X-API-Key header)            update_recipe|
  |                                         |                                         |
  |                                         ▼                                         |
  |                                    cache.del(sv:recipes)                          |
  |                                    cache.del(sv:recipes:ts)                       |
  |                                                                                   |
  |-- Create recipe ─────────────────► POST /api/recipes ─────────────► Apps Script  |
  |                                    (with X-API-Key header)            create_recipe|
  |-- Delete/deactivate ─────────────► DELETE /api/recipes/:id ────────► Apps Script  |
  |                                                                        delete_recipe|
  └───────────────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

New files:
```
zoho-middleware/
  routes/
    recipes.js              # New: recipe CRUD + availability endpoints
  __tests__/
    recipes.test.js         # New: unit tests for routes/recipes.js

admin.html                  # Modified: add Recipes tab button + panel
js/
  admin.js                  # Modified: add recipe tab JS inside existing IIFE

apps-script/
  adminApi.gs               # Modified: fix CR-01 (locks), WR-03 (cache key), WR-01, WR-02
```

### Pattern 1: Middleware Route — Apps Script Proxy with Redis Cache

This is the dominant pattern in this project. `routes/recipes.js` follows it exactly.

```javascript
// Source: [VERIFIED: zoho-middleware/routes/catalog.js — cache.get/set/del pattern]
var router = express.Router();
var cache = require('../lib/cache');
var C = require('../lib/constants');
var axios = require('axios');
var log = require('../lib/logger');

var RECIPES_CACHE_KEY = C.CACHE_KEYS.RECIPES;        // 'sv:recipes'
var RECIPES_CACHE_TS_KEY = C.CACHE_KEYS.RECIPES_TS;  // 'sv:recipes:ts'
var RECIPES_CACHE_TTL = 600; // 10 minutes (D-09)

function callAppsScriptGet(action, params) {
  var url = process.env.APPS_SCRIPT_URL;
  var token = process.env.APPS_SCRIPT_SERVER_TOKEN;
  // ... build URL with params, return axios.get(url).then(r => r.data)
}

function callAppsScriptPost(action, payload) {
  var url = process.env.APPS_SCRIPT_URL;
  var token = process.env.APPS_SCRIPT_SERVER_TOKEN;
  // POST with action + server_token in body
}

// GET /api/recipes — list all recipes
router.get('/api/recipes', function (req, res) {
  var status = req.query.status || 'all';
  var cacheKey = RECIPES_CACHE_KEY + ':' + status;
  cache.get(cacheKey).then(function (cached) {
    if (cached) return res.json({ source: 'cache', recipes: cached });
    return callAppsScriptGet('get_recipes', { status: status }).then(function (data) {
      cache.set(cacheKey, data.data.recipes, RECIPES_CACHE_TTL);
      res.json({ source: 'apps-script', recipes: data.data.recipes });
    });
  }).catch(function (err) {
    log.error('[api/recipes] ' + err.message);
    res.status(502).json({ error: 'Unable to fetch recipes' });
  });
});
```

**Key difference from catalog.js:** Apps Script is the data source (not Zoho), so the fetch is a single `axios.post` to `APPS_SCRIPT_URL` rather than a multi-step Zoho enrichment. Timeout should be 15 seconds (Apps Script cold starts can be slow).

### Pattern 2: Availability Endpoint — Server-Side Stock Cross-Reference

The availability endpoint must fetch the recipe's ingredient list (with Zoho item_ids) and then look up current Zoho stock. The client never supplies raw item IDs — this satisfies API-02.

```javascript
// Source: [VERIFIED: design derived from existing GET /api/catalog/ingredients pattern]
// GET /api/recipes/:id/availability
router.get('/api/recipes/:id/availability', function (req, res) {
  var recipeId = req.params.id;
  // Step 1: Fetch recipe detail from Apps Script (has item_ids)
  callAppsScriptGet('get_recipe', { recipe_id: recipeId }).then(function (data) {
    var ingredients = (data.data && data.data.ingredients) || [];
    if (!ingredients.length) {
      return res.json({ recipe_id: recipeId, available: true, ingredients: [] });
    }
    // Step 2: Fetch current ingredient stock from middleware cache (or Zoho)
    // Use /api/catalog/ingredients cache hit for speed — already has stock_on_hand
    return cache.get(C.CACHE_KEYS.INGREDIENTS).then(function (catalog) {
      var stockMap = {};
      (catalog || []).forEach(function (item) {
        stockMap[String(item.item_id)] = item.stock_on_hand || 0;
      });
      // Step 3: Compute status per ingredient (D-07, D-08)
      var result = ingredients.map(function (ing) {
        var stock = stockMap[String(ing.item_id)] || 0;
        var needed = ing.quantity || 0;
        var batches = needed > 0 ? Math.floor(stock / needed) : 999;
        var status = batches === 0 ? 'out' : batches < 3 ? 'low' : 'ok';
        return {
          item_id: ing.item_id,
          item_name: ing.item_name,
          unit: ing.unit,
          quantity_per_batch: needed,
          stock_on_hand: stock,
          batches_possible: batches,
          status: status
        };
      });
      var allOk = result.every(function (r) { return r.status === 'ok'; });
      var anyOut = result.some(function (r) { return r.status === 'out'; });
      var summary = anyOut ? 'cannot_brew' : allOk ? 'all_ok' : 'some_low';
      res.json({ recipe_id: recipeId, summary: summary, ingredients: result });
    });
  }).catch(function (err) {
    log.error('[api/recipes/availability] ' + err.message);
    res.status(502).json({ error: 'Unable to check availability' });
  });
});
```

**Fallback if ingredients cache is cold:** The endpoint can trigger `doRefreshIngredients()` or return a degraded response with `stock_on_hand: null` and `status: 'unknown'` — the admin UI should handle unknown status gracefully.

### Pattern 3: Admin IIFE Tab — Matching Existing Batches Pattern

The Recipes tab JS follows the same self-contained IIFE pattern established by the Batches tab (lines 5536-7285 in admin.js).

```javascript
// Source: [VERIFIED: admin.js lines 5536-5560 — initBatchSubTabs + loadBatchInit pattern]

// Tab switch registration (in initTabNavigation or via data-tab click handler)
// When btn.getAttribute('data-tab') === 'recipes': call initRecipesTab()

var _recipesState = {
  catalog: [],         // pre-loaded ingredient catalog
  catalogLoaded: false,
  currentRecipe: null, // recipe in detail view (null = list view)
  list: [],
  total: 0
};

function initRecipesTab() {
  if (!_recipesState.catalogLoaded) {
    loadIngredientCatalogForRecipes();
  }
  loadRecipeList();
}

function loadIngredientCatalogForRecipes() {
  // GET /api/catalog/ingredients with MW_API_KEY
  // Populates _recipesState.catalog
  // D-03: pre-loaded, client-side search from that point
}

function loadRecipeList(statusFilter) {
  // GET /api/recipes?status=all (or filtered)
  // Renders table into #recipes-list-view
}

function openRecipeDetail(recipeId) {
  // GET /api/recipes/:id + GET /api/recipes/:id/availability
  // Swaps #recipes-list-view for #recipes-detail-view
  // Renders ingredient rows with colored availability indicators
}
```

### Pattern 4: Middleware → Apps Script Call Pattern (Synchronous)

The recipe middleware routes need **synchronous request-response** to Apps Script (unlike `brewpad-integration.js` which is fire-and-forget). This is already how the admin frontend calls Apps Script via `adminApiGet`/`adminApiPost`.

```javascript
// Source: [VERIFIED: zoho-middleware/lib/brewpad-integration.js lines 68-110]
// Use axios.post with 15-second timeout and maxRedirects: 5
// Apps Script URL from process.env.APPS_SCRIPT_URL
// Token from process.env.APPS_SCRIPT_SERVER_TOKEN in payload.server_token

return axios.post(url, JSON.stringify({
  action: 'create_recipe',
  server_token: token,
  name: payload.name,
  // ...
}), {
  headers: { 'Content-Type': 'application/json' },
  timeout: 15000,  // Apps Script cold start can be 10-12s
  maxRedirects: 5
}).then(function (resp) {
  return resp.data;
});
```

**Important:** Apps Script GET requests use URL params. Apps Script POST requests use a JSON body. The server-token path in `doPost()` already accepts `create_recipe`. For `update_recipe` and `delete_recipe` (staff-authenticated only), the middleware must call with `server_token` (adding these to the server-token path in Phase 13) OR the middleware simply proxies admin staff calls that already carry their Google auth token. See "Pitfall 3" below for the correct approach.

### Pattern 5: Cache Invalidation on Mutation

After any write (POST/PUT/DELETE), bust the Redis cache:

```javascript
// Source: [VERIFIED: catalog.js pattern — cache.del(key) on mutation]
function bustRecipeCache() {
  return Promise.all([
    cache.del(C.CACHE_KEYS.RECIPES),
    cache.del(C.CACHE_KEYS.RECIPES_TS)
  ]);
}
// Also bust individual recipe key if caching per-recipe:
// cache.del(C.CACHE_KEYS.RECIPES + ':' + recipeId)
```

### Pattern 6: Admin Tab HTML Structure

```html
<!-- Source: [VERIFIED: admin.html lines 121-132 — existing tab button pattern] -->
<!-- Add after "batches" button (D-Tab placement: Claude's discretion, recommended after Batches) -->
<button type="button" class="admin-tab-btn" data-tab="recipes">Recipes</button>

<!-- Tab panel (add alongside existing #tab-batches panel) -->
<div id="tab-recipes" class="admin-tab-panel">
  <!-- List view -->
  <div id="recipes-list-view">
    <div class="recipes-toolbar">
      <button id="recipes-new-btn" class="btn-primary">+ New Recipe</button>
      <select id="recipes-status-filter">
        <option value="all">All</option>
        <option value="draft">Draft</option>
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
      </select>
    </div>
    <table id="recipes-table">
      <thead>...</thead>
      <tbody id="recipes-tbody"></tbody>
    </table>
  </div>
  <!-- Detail view (hidden by default) -->
  <div id="recipes-detail-view" style="display:none">
    <button id="recipes-back-btn">← Back to list</button>
    <div id="recipes-availability-banner"></div>
    <!-- recipe form fields -->
    <!-- ingredient editor rows -->
  </div>
</div>
```

### Anti-Patterns to Avoid

- **Per-keystroke API calls for ingredient autocomplete:** D-03 explicitly rules this out. Pre-load once on tab open; filter in memory.
- **Client supplies item_id list to availability endpoint:** Violates API-02. The middleware must fetch item_ids from Apps Script — the client sends only `recipe_id`.
- **Caching availability results:** Stock changes frequently; availability is always computed live. Cache only recipe metadata and ingredient lists.
- **Using `adminApiGet`/`adminApiPost` for the middleware→Apps Script calls:** Those are admin frontend patterns. The middleware uses axios directly with `server_token` authentication, matching `brewpad-integration.js`.
- **Mixing the fire-and-forget retry queue from brewpad-integration.js into recipe writes:** Recipe writes are synchronous admin operations. Failure should return HTTP 502 to the admin UI so staff knows immediately. No retry queue needed.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Redis caching | Custom TTL/invalidation logic | `lib/cache.js` `.get/.set/.del` | Already handles Redis unavailability gracefully |
| Apps Script auth | Custom token scheme | `APPS_SCRIPT_SERVER_TOKEN` in payload (existing pattern) | Already implemented in doPost server-token branch |
| Ingredient catalog fetch | Second Zoho fetch | `GET /api/catalog/ingredients` (existing endpoint, cached) | Already returns item_id, SKU, name, unit, stock_on_hand |
| Numeric validation in Apps Script | Custom isNumber check | `_toNumber(val, fallback)` helper from WR-05 fix | WR-05 identified the NaN-storage bug; the fix pattern is in the review |
| Script lock acquisition | Raw LockService calls | `acquireScriptLock(15000)` (existing helper) | Used identically in createRecipe; CR-01 fix wraps update/delete |

**Key insight:** Every pattern needed exists in the codebase. This phase is wiring, not invention.

---

## Common Pitfalls

### Pitfall 1: Apps Script Cold Start Timeout
**What goes wrong:** Middleware sends request to Apps Script, waits more than the default axios timeout (10s), gets ECONNABORTED. Admin UI shows "502 Unable to fetch recipes" on the first load after Apps Script goes cold.
**Why it happens:** Google Apps Script web apps have a cold start penalty of 8-14 seconds if they haven't been called recently.
**How to avoid:** Set `timeout: 15000` on axios calls to Apps Script. Consider a 30-second timeout for write operations (update/delete trigger expensive sheet operations). Log timeout separately so it's distinguishable from other 502s.
**Warning signs:** 502 errors that resolve on retry, appearing on first-of-day admin access.

### Pitfall 2: WR-03 Cache Key Bug Breaks Admin Filtering
**What goes wrong:** Staff selects "Active" filter in the Recipes tab list view. The endpoint returns draft recipes instead. Staff activates a recipe that was already active (double-activation). Data integrity confusion.
**Why it happens:** `get_recipes` in Apps Script currently caches all results under the static key `'gr'` regardless of the `status` parameter. The fix (D-11/WR-03) must be deployed to Apps Script before the admin UI ships.
**How to avoid:** Fix `_cachedGet` key to `'gr:list:' + status + ':' + limit + ':' + offset` in adminApi.gs. This is a mandatory pre-requisite, not optional.
**Warning signs:** Filtering dropdown has no visible effect on the recipe list.

### Pitfall 3: Middleware Recipe Writes — Auth Path Selection
**What goes wrong:** Middleware tries to call `update_recipe` or `delete_recipe` via the `server_token` path but Apps Script's `doPost` server-token branch only handles `create_batch`, `add_reservation`, and `create_recipe`. Update and delete fall through to "Unknown server action" and return `ok: false`.
**Why it happens:** The server-token path in Phase 12's `doPost()` was intentionally minimal (only `create_recipe` was needed for the batch-creation use case). Update and delete are admin-staff operations authenticated via Google OAuth.
**How to avoid:** Two valid approaches:
  - Option A (recommended): Middleware recipe write endpoints (`PUT /api/recipes/:id`, `DELETE /api/recipes/:id`) receive the staff's Google `accessToken` in the request body and forward it to Apps Script in `payload.token`, letting Apps Script's normal `checkAuthorization` flow handle auth. The middleware acts as a pure proxy.
  - Option B: Extend the server-token branch in Apps Script to also accept `update_recipe` and `delete_recipe`. Simpler for the middleware but requires an Apps Script deploy.
  The CONTEXT.md does not prescribe either — **Option A is recommended** because it keeps Apps Script auth logic centralized in Apps Script, and the admin already has a valid token in scope.
**Warning signs:** Update/delete calls return `{ ok: false, error: 'invalid_action' }`.

### Pitfall 4: Race Condition on CR-01 (Missing Locks)
**What goes wrong:** Two admin sessions (unlikely but possible) or a batch creation from kiosk and an admin recipe edit hit `updateRecipe` simultaneously. Row indices shift mid-operation. Wrong recipe fields are updated.
**Why it happens:** `updateRecipe` and `deleteRecipe` perform multi-step sheet mutations without holding the script lock (CR-01 from Phase 12 code review).
**How to avoid:** Apply the exact fix pattern from the CR-01 code review: wrap the body of both functions in `acquireScriptLock(15000)` / `try...finally lock.releaseLock()`. This is a mandatory carry-forward fix.
**Warning signs:** Intermittent data corruption in recipe fields after concurrent admin access.

### Pitfall 5: Availability Check Hits Cold Ingredients Cache
**What goes wrong:** `GET /api/recipes/:id/availability` tries to read `CACHE_KEYS.INGREDIENTS` from Redis but the cache is cold (just restarted). Returns `stock_on_hand: 0` for everything — all ingredients appear "out of stock". Staff panics and thinks all inventory is gone.
**Why it happens:** The ingredients cache is populated by `GET /api/catalog/ingredients` requests. It can be cold immediately after a Railway restart or cache-clear.
**How to avoid:** In the availability handler, if the ingredients cache is cold, trigger `doRefreshIngredients()` and wait for it (it already has promise coalescing). Alternatively, return `status: 'unknown'` and surface a "stock data loading" indicator in the UI rather than showing red for everything. The frontend should handle `status: 'unknown'` without alarming the user.
**Warning signs:** All ingredients showing red immediately after Railway restart.

### Pitfall 6: `innerHTML` Without Escaping in Recipe/Ingredient Rendering
**What goes wrong:** A recipe name containing `<script>alert(1)</script>` is saved to Sheets. Admin renders it via `el.innerHTML = recipe.name`. XSS executes in admin context.
**Why it happens:** The vanilla JS IIFE admin pattern uses innerHTML extensively. Existing code uses `escapeHTML` from `js/lib/utils.js` but it must be applied consistently.
**How to avoid:** Use `escapeHTML(value)` from `js/lib/utils.js` for all recipe name, style, description, and ingredient name fields rendered into innerHTML. Never use `el.innerHTML = rawApiValue` directly.
**Warning signs:** Recipe names with angle brackets appear broken in the UI.

### Pitfall 7: Activation Guardrail Only in Frontend (D-02)
**What goes wrong:** Staff bypasses the frontend guardrail by calling the API directly (e.g., via curl), setting `status: 'active'` on a recipe with no `locked_price`. Incomplete recipes go live.
**Why it happens:** D-02 specifies the guardrail but doesn't specify enforcement tier.
**How to avoid:** Enforce in the middleware `PUT /api/recipes/:id` handler: if `status === 'active'`, require `locked_price > 0` and `ingredient_count > 0` in the payload. Fetch current recipe detail to check if not provided. Return HTTP 422 with a descriptive error if the guardrail fails. The frontend guardrail is then UX sugar, not the only gate.
**Warning signs:** Active recipes with `locked_price: ''` or `ingredient_count: 0`.

---

## Code Examples

### Apps Script Fix: CR-01 — Lock-Protected updateRecipe

```javascript
// Source: [VERIFIED: apps-script/adminApi.gs lines 3111-3198 + CR-01 fix from 12-REVIEW.md]
function updateRecipe(payload, userEmail) {
  if (!payload.recipe_id) {
    return { ok: false, error: 'missing_id', message: 'recipe_id is required' };
  }
  var lock = acquireScriptLock(15000);
  try {
    var result = findRowById(RECIPES_SHEET_NAME, payload.recipe_id);
    if (result.row === -1) {
      return { ok: false, error: 'not_found', message: 'Recipe not found: ' + payload.recipe_id };
    }
    // ... existing field update logic unchanged ...
    invalidateSheetCache(RECIPES_SHEET_NAME);
    return { ok: true, message: 'Recipe updated' };
  } finally {
    lock.releaseLock();
  }
}
```

### Apps Script Fix: WR-03 — Parameterized Cache Key

```javascript
// Source: [VERIFIED: apps-script/adminApi.gs line 170 + WR-03 fix from 12-REVIEW.md]
case 'get_recipes':
  var recipesCacheKey = 'gr:list:' + (e.parameter.status || 'all') + ':' + limit + ':' + offset;
  return _jsonResponse({ ok: true, data: _cachedGet(recipesCacheKey, 300, function() {
    return getRecipes(limit, offset, e.parameter.status || 'all');
  })});
```

### Apps Script Fix: WR-01 — Hard Error When RecipeIngredients Sheet Missing

```javascript
// Source: [VERIFIED: apps-script/adminApi.gs lines 3070-3091 + WR-01 fix from 12-REVIEW.md]
if (ingredients && ingredients.length > 0) {
  var ingSheet = ss.getSheetByName(RECIPE_INGREDIENTS_SHEET_NAME);
  if (!ingSheet) {
    return { ok: false, error: 'sheet_not_found', message: 'RecipeIngredients sheet not found — run setupRecipeTabs() first' };
  }
  // ... existing loop ...
}
```

### Apps Script Fix: WR-02 — Remove Dead Cache Key

```javascript
// Source: [VERIFIED: apps-script/adminApi.gs line 2938 + WR-02 fix from 12-REVIEW.md]
function _invalidateRecipeCache(recipeId) {
  var cache = CacheService.getScriptCache();
  var keys = ['gr:list:all:0:0']; // bust the canonical list key; pattern keys expire naturally
  if (recipeId) {
    keys.push('gr:' + recipeId);
  }
  // Note: after WR-03 fix, the invalidator should clear all status variants.
  // Simplest: clear 'all', 'draft', 'active', 'inactive' variants.
  ['all', 'draft', 'active', 'inactive'].forEach(function(s) {
    keys.push('gr:list:' + s + ':0:0');  // covers default pagination
  });
  cache.removeAll(keys);
}
```

### Middleware: Admin Route Proxy Pattern (GET)

```javascript
// Source: [VERIFIED: design based on brewpad-integration.js axios pattern + catalog.js cache pattern]
router.get('/api/recipes', function (req, res) {
  var status = req.query.status || 'all';
  var limit  = parseInt(req.query.limit, 10) || 0;
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

### Admin JS: Tab Initialization Hook

```javascript
// Source: [VERIFIED: admin.js lines 1240-1255 — initTabNavigation pattern]
// Add inside initTabNavigation() alongside the existing 'orders' check:
if (btn.getAttribute('data-tab') === 'recipes') {
  initRecipesTab();
}
```

### Admin JS: Ingredient Autocomplete Row (D-03, D-04)

```javascript
// Source: [ASSUMED — pattern consistent with existing admin.js inline editing]
// Each ingredient row in the editor:
// <input type="text" class="ing-search" placeholder="Search ingredient...">
// <input type="number" class="ing-qty" min="0" step="0.01">
// <span class="ing-unit"></span>
// <span class="ing-stock-hint"></span>  <!-- "45 kg available" -->
// <span class="ing-status"></span>      <!-- colored dot: green/yellow/red -->
// <button class="ing-remove">✕</button>

function filterIngredientCatalog(query) {
  var q = query.toLowerCase();
  return _recipesState.catalog.filter(function (item) {
    return item.name.toLowerCase().indexOf(q) !== -1 ||
           (item.sku || '').toLowerCase().indexOf(q) !== -1;
  });
}
```

### Admin JS: Activation Guardrail (D-02)

```javascript
// Source: [ASSUMED — pattern consistent with existing admin.js validation patterns]
function canActivateRecipe(recipe, ingredients) {
  if (!recipe.locked_price || parseFloat(recipe.locked_price) <= 0) {
    return { ok: false, reason: 'locked_price must be set before activating' };
  }
  if (!ingredients || ingredients.length === 0) {
    return { ok: false, reason: 'At least one ingredient must be added before activating' };
  }
  return { ok: true };
}
```

---

## Apps Script Code Review Fixes (Mandatory Pre-Requisites)

All four fixes from the Phase 12 code review must be applied to `adminApi.gs` in this phase:

| Finding | File Location | Fix Summary | Severity |
|---------|---------------|-------------|----------|
| CR-01 | adminApi.gs:3111-3198 (updateRecipe), 3207-3265 (deleteRecipe) | Wrap both functions in `acquireScriptLock(15000)` / try-finally | Critical |
| WR-01 | adminApi.gs:3070-3091 (createRecipe, ingredient loop) | Return hard error when RecipeIngredients sheet is missing | Warning |
| WR-02 | adminApi.gs:2938 (_invalidateRecipeCache) | Remove dead `'grl'` key from cache.removeAll() | Warning |
| WR-03 | adminApi.gs:170 (get_recipes case) | Parameterize cache key with status+limit+offset | Warning (blocks filtering) |

Info-level fixes (IN-01, IN-02, IN-03) are low-risk; include them if convenient, but they are not blockers.

---

## Middleware API Contract (Normalized REST Shape)

The middleware reshapes Apps Script responses to a clean REST contract. Downstream consumers (admin UI, future kiosk Phase 14) depend on this shape, not Apps Script internals.

### `GET /api/recipes` Response
```json
{
  "source": "cache|apps-script",
  "recipes": [
    {
      "recipe_id": "SV-R-000001",
      "name": "Pale Ale",
      "style": "American Pale Ale",
      "status": "active",
      "locked_price": 175.00,
      "service_fee": 45.00,
      "materials_fee": 5.00,
      "batch_size_l": 48,
      "abv": 5.2,
      "ibu": 35,
      "colour_srm": 8,
      "ingredient_count": 6,
      "created_at": "2026-05-16T00:00:00Z",
      "updated_at": "2026-05-16T00:00:00Z"
    }
  ],
  "total": 1
}
```

### `GET /api/recipes/:id` Response
```json
{
  "recipe": { /* all fields above */ },
  "ingredients": [
    {
      "ingredient_id": "RI-000001",
      "recipe_id": "SV-R-000001",
      "item_id": "109900000000123456",
      "item_name": "Pale Malt (2-Row)",
      "sku": "MALT-PALE-2ROW",
      "quantity": 4.5,
      "unit": "kg"
    }
  ]
}
```

### `GET /api/recipes/:id/availability` Response
```json
{
  "recipe_id": "SV-R-000001",
  "summary": "all_ok|some_low|cannot_brew",
  "ingredients": [
    {
      "item_id": "109900000000123456",
      "item_name": "Pale Malt (2-Row)",
      "unit": "kg",
      "quantity_per_batch": 4.5,
      "stock_on_hand": 45.0,
      "batches_possible": 10,
      "status": "ok|low|out"
    }
  ]
}
```

---

## Environment Availability

Step 2.6: No new external dependencies. All environment variables required for this phase are already in use by the middleware.

| Dependency | Required By | Available | Notes |
|------------|------------|-----------|-------|
| `APPS_SCRIPT_URL` | routes/recipes.js → Apps Script calls | Already in Railway | Used by brewpad-integration.js |
| `APPS_SCRIPT_SERVER_TOKEN` | routes/recipes.js server-token auth | Already in Railway | Used by brewpad-integration.js |
| `API_SECRET_KEY` | middleware write endpoint guard | Already in Railway | Used by all existing POST/PUT/DELETE routes |
| Redis | cache.get/set/del for recipe caching | Already running | Cache keys already defined |

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Fire-and-forget Apps Script calls (brewpad) | Synchronous request-response for recipe writes | Phase 13 | Recipe mutations must return success/failure to admin UI immediately |
| Static cache key `'gr'` (Phase 12 bug) | Parameterized key `'gr:list:status:limit:offset'` | Phase 13 (WR-03 fix) | Filtering works correctly |
| Unlocked multi-step mutations (Phase 12 bug) | `acquireScriptLock` on update/delete | Phase 13 (CR-01 fix) | Race condition eliminated |

---

## Open Questions

1. **Auth path for middleware recipe writes (Pitfall 3)**
   - What we know: The server-token branch in Apps Script only handles `create_recipe`. `update_recipe` and `delete_recipe` require staff auth (`authResult.email`).
   - What's unclear: Should the middleware proxy the staff's Google access token to Apps Script (Option A), or extend the server-token branch to also accept update/delete (Option B)?
   - Recommendation: Option A (proxy the staff token) — the planner should pick one and codify it. Option A is more architecturally clean. Option B is simpler to implement.

2. **Per-recipe detail caching TTL**
   - What we know: D-09 specifies 10-15 minutes for recipe data.
   - What's unclear: Should individual recipe detail pages (`GET /api/recipes/:id`) be cached separately from the list?
   - Recommendation: Yes, cache detail separately with key `CACHE_KEYS.RECIPES + ':' + recipeId` at 10 minutes. Bust it on update/delete of that recipe_id. This avoids re-fetching all recipes when only one was loaded.

3. **Availability endpoint: live Zoho fetch vs. ingredients cache**
   - What we know: The ingredients cache (`CACHE_KEYS.INGREDIENTS`) may be cold at times.
   - What's unclear: Is it acceptable to show `status: 'unknown'` when cache is cold, or should the availability endpoint always have live data?
   - Recommendation: Use the cache if warm (fast). If cold, trigger a background `doRefreshIngredients()` call and return `status: 'unknown'` for affected ingredients. Document this in the UI as "Stock data loading — try again shortly."

---

## Security Domain

Security enforcement is enabled (`security_enforcement: true` in config). ASVS Level 1.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | Yes — admin tab requires Google OAuth | Existing `checkAuthorization` in Apps Script + `accessToken` in admin.js |
| V3 Session Management | Indirect — Google token expiry handled by existing auth flow | Existing token refresh logic |
| V4 Access Control | Yes — recipe writes must be staff-only | `X-API-Key` header guard on all POST/PUT/DELETE at middleware; `checkAuthorization` at Apps Script |
| V5 Input Validation | Yes — recipe fields must be validated before Sheet write | `sanitizeInput()` on all string fields (already in createRecipe/updateRecipe); `_toNumber()` guard on numeric fields (WR-05 fix) |
| V6 Cryptography | No — no crypto operations in this phase | — |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| XSS via recipe name/description in innerHTML | Spoofing | `escapeHTML()` from `js/lib/utils.js` on all rendered recipe fields |
| Unauthorized recipe activation via direct API call | Elevation of privilege | Middleware enforces locked_price + ingredient_count check before proxying `status=active` |
| Race condition on concurrent recipe edits | Tampering | CR-01 fix: `acquireScriptLock` in updateRecipe/deleteRecipe |
| Client supplies raw item_id list to availability endpoint | Tampering | API-02: client sends only recipe_id; middleware fetches item_ids from Apps Script |
| XSS via ingredient name stored in RecipeIngredients sheet | Spoofing | `sanitizeInput()` on `ing.item_name` in createRecipe/updateRecipe (already applied) |

---

## Project Constraints (from CLAUDE.md)

The following CLAUDE.md directives are binding for this phase:

| Directive | Impact on Phase 13 |
|-----------|-------------------|
| Never edit `js/main.js` or `js/main.min.js` directly | Recipes tab JS goes in `js/admin.js` (not a module file), so this constraint does not apply. Admin.js is edited directly. |
| `npm test` AND `cd zoho-middleware && npm test` must pass before any commit | `routes/recipes.js` needs a `__tests__/recipes.test.js` file |
| Write regression test FIRST before fixing a bug | CR-01 and WR-03 fixes in adminApi.gs are server-side Apps Script — not testable via Jest. Frontend tests for the activation guardrail should be added. |
| After changing any shared utility, run FULL test suite | No shared utilities are changed in this phase; only admin.js, routes/recipes.js, and adminApi.gs |
| Lint all JS before committing | `npm run lint` must pass on admin.js edits |
| All changes go to staging first | No production push without staging approval |
| After any JS module change, run `npm run build` | admin.js is not a build-module-concatenated file (it's standalone), but run `npm run build` anyway as habit |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Option A (proxy staff Google token) is preferred for middleware recipe write auth | Open Questions #1 | If Apps Script rejects the forwarded token (CORS or format issue), Option B must be used instead — requires an Apps Script deploy |
| A2 | The ingredients cache (`CACHE_KEYS.INGREDIENTS`) is sufficiently warm in normal admin operation to serve availability checks without a fresh Zoho fetch | Availability endpoint pattern | If cache is often cold, the availability endpoint will be slow or return 'unknown' status more than expected |
| A3 | The admin Recipes tab JS is self-contained within the existing `js/admin.js` IIFE (not extracted to a separate module file) | Architecture patterns | Admin.js is already 8890 lines; adding recipe tab JS will make it ~9200+ lines. If line count becomes a maintainability concern, the planner may want to note Phase 4 modularization (mentioned in MEMORY.md) |

---

## Sources

### Primary (HIGH confidence — verified by direct codebase read)
- `apps-script/adminApi.gs` — Recipe CRUD functions (createRecipe, getRecipes, getRecipeDetail, updateRecipe, deleteRecipe), doPost routing, server-token branch, `_invalidateRecipeCache`
- `zoho-middleware/routes/catalog.js` — Redis cache pattern, Apps Script proxy pattern, route structure
- `zoho-middleware/lib/constants.js` — `CACHE_KEYS.RECIPES` and `CACHE_KEYS.RECIPES_TS` definitions
- `zoho-middleware/lib/brewpad-integration.js` — Synchronous axios→Apps Script call pattern
- `zoho-middleware/server.js` — Route mounting, API key guard, auth guard
- `js/admin.js` — Tab navigation pattern, `adminApiGet`/`adminApiPost` implementation, IIFE structure
- `admin.html` — Existing 11-tab structure, `data-tab` attribute pattern
- `.planning/phases/12-recipe-data-foundation/12-REVIEW.md` — CR-01, WR-01, WR-02, WR-03, WR-04, WR-05, IN-01, IN-02, IN-03 findings and fix patterns
- `.planning/phases/12-recipe-data-foundation/12-CONTEXT.md` — Phase 12 decisions D-01 through D-08
- `.planning/phases/13-middleware-api-admin-recipe-management/13-CONTEXT.md` — Phase 13 decisions D-01 through D-11

### Secondary (MEDIUM confidence)
- `CLAUDE.md` — Project constraints and build/test commands
- `js/sheets-config.js` — MW_API_KEY location, MIDDLEWARE_URL value

---

## Metadata

**Confidence breakdown:**
- Standard Stack: HIGH — all libraries already in production use; zero new dependencies
- Architecture Patterns: HIGH — directly derived from existing catalog.js and admin.js patterns in the codebase
- Apps Script Bug Fixes: HIGH — derived directly from 12-REVIEW.md with exact code locations
- Pitfalls: HIGH — derived from code review findings and existing production patterns
- Auth path for middleware writes (Open Question #1): MEDIUM — two valid options; needs planner decision

**Research date:** 2026-05-16
**Valid until:** 60 days (stack is stable; no fast-moving dependencies)
