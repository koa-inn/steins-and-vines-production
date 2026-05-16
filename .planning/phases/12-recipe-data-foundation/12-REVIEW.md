---
phase: 12-recipe-data-foundation
reviewed: 2026-05-16T00:00:00Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - apps-script/adminApi.gs
  - js/lib/constants.js
  - zoho-middleware/lib/constants.js
  - zoho-middleware/lib/validateEnv.js
findings:
  critical: 1
  warning: 5
  info: 3
  total: 9
status: issues_found
---

# Phase 12: Code Review Report

**Reviewed:** 2026-05-16
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found

## Summary

Phase 12 adds recipe CRUD to Apps Script (5 functions: createRecipe, getRecipes, getRecipeDetail, updateRecipe, deleteRecipe), registers BEER_SALES_ENABLED in validateEnv.js, adds CACHE_KEYS.RECIPES/RECIPES_TS to middleware constants, and ITEM_TYPES.RECIPE to frontend constants.

The overall structure is sound and consistent with existing patterns (sanitizeInput on string fields, header-based column lookup, sheetToObjects caching, _cachedGet wrapping). One critical issue: `updateRecipe` and `deleteRecipe` perform multi-step sheet mutations without holding the script lock, creating a race window for data corruption. Five warnings cover silent data loss, a stale cache key in the invalidator, broken pagination caching, unsanitized snapshot data, and missing numeric validation. Three info-level items cover unused constants, dead invalidation keys, and an error response being cached.

---

## Critical Issues

### CR-01: updateRecipe and deleteRecipe Are Not Lock-Protected — Race Condition on Concurrent Writes

**File:** `apps-script/adminApi.gs:3111-3198` (updateRecipe), `3207-3265` (deleteRecipe)

**Issue:** `createRecipe` correctly acquires `acquireScriptLock(15000)` before its multi-step write (ID generation + appendRow). `updateRecipe` and `deleteRecipe` perform equally multi-step mutations — read row with `findRowById`, then issue multiple `getRange().setValue()` calls or `deleteRow()` calls — without any lock. In Apps Script, `LockService.getScriptLock()` serializes concurrent executions globally. Without it, two simultaneous requests (e.g., an admin editing a recipe while a middleware batch-creation writes the same sheet) can interleave their reads and writes: request A reads row 5 as the target, request B deletes row 5, request A then writes to what is now row 6 (a different recipe). The same race applies to `deleteRecipe`'s check-then-delete sequence at lines 3217-3260: a batch referencing the recipe could be created between the `sheetToObjects(BATCHES_SHEET_NAME)` call (line 3218) and `result.sheet.deleteRow(result.row)` (line 3260), leaving a dangling `recipe_id` in Batches pointing to a deleted recipe.

**Fix:**

```javascript
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
    // ... rest of function unchanged ...
    invalidateSheetCache(RECIPES_SHEET_NAME);
    return { ok: true, message: 'Recipe updated' };
  } finally {
    lock.releaseLock();
  }
}

function deleteRecipe(payload, userEmail) {
  if (!payload.recipe_id) {
    return { ok: false, error: 'missing_id', message: 'recipe_id is required' };
  }

  var lock = acquireScriptLock(15000);
  try {
    var result = findRowById(RECIPES_SHEET_NAME, payload.recipe_id);
    if (result.row === -1) {
      return { ok: false, error: 'not_found', message: 'Recipe not found: ' + payload.recipe_id };
    }
    // ... rest of function unchanged ...
  } finally {
    lock.releaseLock();
  }
}
```

---

## Warnings

### WR-01: createRecipe Silently Drops All Ingredients When RecipeIngredients Sheet Is Missing

**File:** `apps-script/adminApi.gs:3071-3091`

**Issue:** When `ingredients` is provided, the code checks `if (ingSheet)` at line 3072 before iterating. If the `RecipeIngredients` sheet does not exist (e.g., `setupRecipeTabs()` was never run), the entire ingredient list is silently discarded. `ingredientsCreated` stays 0, no error is surfaced, and the response returns `ok: true` with `ingredients_created: 0`. The caller has no way to distinguish "no ingredients provided" from "sheet was missing and ingredients were lost."

**Fix:** Treat a missing `RecipeIngredients` sheet as a hard error when ingredients were provided:

```javascript
if (ingredients && ingredients.length > 0) {
  var ingSheet = ss.getSheetByName(RECIPE_INGREDIENTS_SHEET_NAME);
  if (!ingSheet) {
    return { ok: false, error: 'sheet_not_found', message: 'RecipeIngredients sheet not found — run setupRecipeTabs() first' };
  }
  for (var i = 0; i < ingredients.length; i++) {
    // ... existing loop ...
  }
}
```

---

### WR-02: `_invalidateRecipeCache` Invalidates a Key (`'grl'`) That Is Never Written

**File:** `apps-script/adminApi.gs:2938`

**Issue:** `_invalidateRecipeCache` invalidates three keys: `'gr'`, `'grl'`, and `'gr:' + recipeId`. The `get_recipes` endpoint caches under `'gr'` (line 170). The key `'grl'` is never written by any `_cachedGet` call in the file — searching the entire script finds `'grl'` only at this invalidation line. This means the `cache.removeAll` call is wasting a slot on a key that will never exist, and the comment or original intent (perhaps `'grl'` was for a "recipe list" variant) is now misleading dead code.

**Fix:** Remove `'grl'` from the keys array. If a paginated/filtered variant cache key is planned, document it now. Current correct keys are `['gr', 'gr:' + recipeId]`:

```javascript
function _invalidateRecipeCache(recipeId) {
  var cache = CacheService.getScriptCache();
  var keys = ['gr'];
  if (recipeId) {
    keys.push('gr:' + recipeId);
  }
  cache.removeAll(keys);
}
```

---

### WR-03: `get_recipes` Cache Key Does Not Incorporate `status`, `limit`, or `offset` — Pagination and Filtering Are Broken Under Cache

**File:** `apps-script/adminApi.gs:170-172`

**Issue:** The `get_recipes` endpoint caches under the static key `'gr'` regardless of the `status`, `limit`, and `offset` parameters:

```javascript
case 'get_recipes':
  return _jsonResponse({ ok: true, data: _cachedGet('gr', 300, function() {
    return getRecipes(limit, offset, e.parameter.status || 'all');
  })});
```

The first request with `status=active&limit=10&offset=0` caches that result under `'gr'`. A subsequent request with `status=all` or `offset=10` will receive the first caller's result. This is the same structural issue that exists for `get_batches` (`'gbl'`), but for batches the admin panel makes a single canonical query. For recipes, the `status` filter is meaningful during recipe management (active vs. draft vs. all) and will return wrong data silently.

Note: `get_batch` (line 133) correctly incorporates `batch_id` into its key (`'gb:' + batch_id`), showing the pattern is known.

**Fix:** Incorporate the query parameters into the cache key:

```javascript
case 'get_recipes':
  var recipesCacheKey = 'gr:list:' + (e.parameter.status || 'all') + ':' + limit + ':' + offset;
  return _jsonResponse({ ok: true, data: _cachedGet(recipesCacheKey, 300, function() {
    return getRecipes(limit, offset, e.parameter.status || 'all');
  })});
```

Update `_invalidateRecipeCache` to also clear the common patterns, or clear all keys with prefix `'gr:list:'` using `cache.removeAll` with the expected variants.

---

### WR-04: `recipe_snapshot` Written to Batches Sheet Without Sanitization

**File:** `apps-script/adminApi.gs:1783`

**Issue:** When a batch is created with `payload.recipe_snapshot`, the value is written directly to the sheet without `sanitizeInput`:

```javascript
if (snapshotCol !== -1 && payload.recipe_snapshot) {
  batchesSheet.getRange(recipeRow, snapshotCol + 1).setValue(payload.recipe_snapshot);
}
```

All other string fields in `createBatch` use `sanitizeInput`. The `recipe_snapshot` is expected to be a JSON blob, and `sanitizeInput` would not mangle valid JSON (it targets HTML/script injection patterns, not JSON structure). Omitting sanitization is inconsistent with the pattern and allows HTML-based XSS payloads to be stored in the sheet, which could surface in future admin UI renderings of snapshot data.

Note: The server-token path (line 220-224) can call `createBatch` → `createRecipe` with middleware-supplied data, not staff-controlled data, so the risk is lower but not zero.

**Fix:** Apply `sanitizeInput` to the snapshot value. Since it is expected to be a JSON string, sanitization will not corrupt it:

```javascript
if (snapshotCol !== -1 && payload.recipe_snapshot) {
  batchesSheet.getRange(recipeRow, snapshotCol + 1).setValue(sanitizeInput(String(payload.recipe_snapshot)));
}
```

---

### WR-05: Numeric Fields Not Validated Before `Number()` Conversion — `NaN` Stored in Sheet

**File:** `apps-script/adminApi.gs:3044-3045, 3057-3061, 3136-3142, 3186`

**Issue:** Numeric fields (`service_fee`, `materials_fee`, `locked_price`, `batch_size_l`, `abv`, `ibu`, `colour_srm`, ingredient `quantity`) are converted with `Number(payload.field)` without validating the result. If a caller passes a non-numeric string (e.g., `"abc"`), `Number("abc")` is `NaN`, and `NaN` is stored in the spreadsheet cell. Apps Script will persist `NaN` as a string value `"NaN"`, which breaks any downstream numeric operations or display logic.

Representative locations:
- Line 3044: `Number(payload.service_fee)`
- Line 3082 (ingredient loop): `Number(ing.quantity)`
- Line 3140 (updateRecipe numeric field loop): `Number(payload[field])`

**Fix:** Add a `isValidNumber` guard, or use `parseFloat` with an `isNaN` check:

```javascript
function _toNumber(val, fallback) {
  var n = Number(val);
  return isNaN(n) ? fallback : n;
}

// In createRecipe:
var serviceFee = payload.service_fee !== undefined ? _toNumber(payload.service_fee, 45) : 45;
var materialsFee = payload.materials_fee !== undefined ? _toNumber(payload.materials_fee, 5) : 5;
```

Or return an error response when a non-numeric value is received for a required numeric field.

---

## Info

### IN-01: `CACHE_KEYS.RECIPES` and `CACHE_KEYS.RECIPES_TS` Are Defined But Never Consumed

**File:** `zoho-middleware/lib/constants.js:67-68`

**Issue:** Both `RECIPES: 'sv:recipes'` and `RECIPES_TS: 'sv:recipes:ts'` are added to `CACHE_KEYS` but no middleware route or library file reads or writes these keys. They are forward-declared for Phase 13+ middleware caching of recipe data from Apps Script, but currently dead code. This is expected for a foundation phase but worth tracking — if the middleware route is delayed, these constants could become stale.

**Fix:** No immediate action needed. Add a comment referencing the planned consumer (e.g., `// consumed by routes/recipes.js — Phase 13`).

---

### IN-02: `ITEM_TYPES.RECIPE` Is Defined But Not Consumed in Any Frontend Module

**File:** `js/lib/constants.js:25`

**Issue:** `RECIPE: 'recipe'` is added to `ITEM_TYPES` but no frontend module references `ITEM_TYPES.RECIPE`. Like IN-01, this is a foundation constant for future phases. No behavioral risk now, but it adds noise to the constants file that may mislead developers scanning for usages.

**Fix:** No immediate action needed. Same recommendation: add a comment indicating the expected consumer module.

---

### IN-03: `get_recipe` With Missing `recipe_id` Caches an Error Response Under `'gr:'`

**File:** `apps-script/adminApi.gs:175`

**Issue:** If a GET request arrives with `action=get_recipe` and no `recipe_id` parameter, the cache key becomes `'gr:'` (the literal string `'gr:'`) and `getRecipeDetail(undefined)` is called, which returns `{ ok: false, error: 'missing_id', ... }`. This error response is stored in the cache for 300 seconds (line 2865). Any subsequent valid request that somehow generates the key `'gr:'` (which won't happen naturally, but is still wasteful) would receive the cached error.

More practically: the `'gr:'` key is never cleared by `_invalidateRecipeCache` (which only clears `'gr:' + recipeId` for non-empty IDs). The error response will sit in cache for 5 minutes before expiring on its own. This is not data-corrupting but is an inconsistency worth addressing.

**Fix:** Add a guard before the `_cachedGet` call:

```javascript
case 'get_recipe':
  if (!e.parameter.recipe_id) {
    return _jsonResponse({ ok: false, error: 'missing_id', message: 'recipe_id is required' });
  }
  return _jsonResponse({ ok: true, data: _cachedGet('gr:' + e.parameter.recipe_id, 300, function() {
    return getRecipeDetail(e.parameter.recipe_id);
  })});
```

---

_Reviewed: 2026-05-16_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
