'use strict';

var express = require('express');
var fs = require('fs');
var path = require('path');
var cache = require('../lib/cache');
var log = require('../lib/logger');
var C = require('../lib/constants');
var axios = require('axios');

var router = express.Router();

// Same file the catalog route writes on every ingredients refresh — used as a
// fallback so dynamic recipe pricing still computes when Redis is cold.
var INGREDIENTS_FILE_CACHE = path.join(__dirname, '..', 'ingredients-cache.json');

var RECIPES_CACHE_TTL = 600; // 10 minutes (D-09)

// ---------------------------------------------------------------------------
// Helpers — Apps Script communication
// ---------------------------------------------------------------------------

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
    log.warn('[recipes] APPS_SCRIPT_URL or APPS_SCRIPT_SERVER_TOKEN not configured');
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

// ---------------------------------------------------------------------------
// Helper — Cache invalidation
// ---------------------------------------------------------------------------

function bustRecipeCache(recipeId) {
  var keys = [C.CACHE_KEYS.RECIPES_TS];
  // Bust all status-variant list keys (default pagination)
  ['all', 'draft', 'active', 'inactive'].forEach(function (s) {
    keys.push(C.CACHE_KEYS.RECIPES + ':' + s + ':0:0');
  });
  if (recipeId) {
    keys.push(C.CACHE_KEYS.RECIPES + ':' + recipeId);
  }
  return Promise.all(keys.map(function (k) { return cache.del(k); }));
}

// ---------------------------------------------------------------------------
// Helper — Custom-field accessor (mirrors catalog.js L551-556 Millable idiom)
// ---------------------------------------------------------------------------

function readCF(entry, apiName) {
  var cfs = (entry && entry.custom_fields) || [];
  for (var i = 0; i < cfs.length; i++) {
    if (cfs[i] && cfs[i].api_name === apiName) return cfs[i].value_formatted || cfs[i].value || '';
  }
  return '';
}

// ---------------------------------------------------------------------------
// Helper — Always-run additive group enrichment (RDISP-02, D-07, D-08)
// Sets cf_type / cf_subcategory / display_group on each ingredient.
// NOT gated behind pricing_mode — runs for locked AND dynamic recipes.
// ---------------------------------------------------------------------------

function enrichIngredientGroups(ingredients) {
  return cache.get(C.CACHE_KEYS.INGREDIENTS).then(function (catalog) {
    if (!catalog || !Array.isArray(catalog)) {
      // Redis cold — mirror the enrichListPrices file-cache fallback (L122-131)
      try {
        catalog = JSON.parse(fs.readFileSync(INGREDIENTS_FILE_CACHE, 'utf8'));
      } catch (e) {
        catalog = null;
      }
      if (!catalog || !Array.isArray(catalog)) return; // D-07: degrade gracefully
    }
    var map = {};
    catalog.forEach(function (item) { if (item && item.item_id) map[item.item_id] = item; });

    (ingredients || []).forEach(function (ing) {
      var entry = map[ing.item_id];
      if (!entry) return; // no match — leave additive fields unset
      // cf_type is top-level on cache entries (catalog.js L851)
      ing.cf_type = entry.cf_type || readCF(entry, 'cf_type') || '';
      // cf_subcategory lives in custom_fields[] (PATTERNS critical finding)
      ing.cf_subcategory = readCF(entry, 'cf_subcategory') || '';
      // display_group — let the client (Plan 01) do label collapse;
      // set to the raw subcategory key or type key as a stable raw signal.
      ing.display_group = ing.cf_subcategory || ing.cf_type || '';
    });
  }).catch(function () {}); // D-07: never throw on enrichment failure
}

function enrichWithComputedPrice(recipe, ingredients) {
  if (!recipe || recipe.pricing_mode !== 'dynamic') return Promise.resolve();
  return cache.get(C.CACHE_KEYS.INGREDIENTS).then(function (catalog) {
    if (!catalog || !Array.isArray(catalog)) return;
    var map = {};
    catalog.forEach(function (item) { if (item && item.item_id) map[item.item_id] = item; });
    var total = 0;
    (ingredients || []).forEach(function (ing) {
      var entry = map[ing.item_id];
      if (entry) {
        ing.rate = Number(entry.rate) || 0;
        ing.tax_percentage = Number(entry.tax_percentage) || 0;
        ing.tax_id = entry.sales_tax_rule_id || entry.tax_id || '';
        total += (Number(ing.quantity) || 0) * ing.rate;
      }
    });
    total += Number(recipe.service_fee) || 0;
    total += Number(recipe.materials_fee) || 0;
    recipe.computed_price = Math.round(total * 100) / 100;
    return cache.get(C.CACHE_KEYS.KIOSK_PRODUCTS).then(function (kioskItems) {
      if (!kioskItems || !Array.isArray(kioskItems)) return;
      var feeSkus = { 'BREW-FEE': 'brewing_fee_tax', 'MAT-FEE': 'materials_fee_tax', 'MILLED': 'milling_fee_tax' };
      var millingId = process.env.MILLING_FEE_ITEM_ID;
      for (var i = 0; i < kioskItems.length; i++) {
        var sku = (kioskItems[i].sku || '').toUpperCase();
        if (feeSkus[sku]) {
          recipe[feeSkus[sku]] = Number(kioskItems[i].tax_percentage) || 0;
        }
        if (sku === 'MILLED' || (millingId && (kioskItems[i].item_id === millingId || sku === millingId.toUpperCase()))) {
          recipe.milling_fee_rate = Number(kioskItems[i].rate) || 0;
          recipe.milling_fee_tax = Number(kioskItems[i].tax_percentage) || 0;
        }
      }
    }).catch(function () {});
  }).catch(function () {});
}

function enrichListPrices(recipes) {
  var dynamicRecipes = recipes.filter(function (r) { return r.pricing_mode === 'dynamic'; });
  if (dynamicRecipes.length === 0) return Promise.resolve();

  return Promise.all([
    cache.get(C.CACHE_KEYS.INGREDIENTS),
    cache.get(C.CACHE_KEYS.KIOSK_PRODUCTS)
  ]).then(function (caches) {
    var catalog = caches[0];
    var kioskItems = caches[1];
    if (!catalog || !Array.isArray(catalog)) {
      // Redis cold — fall back to the ingredients file cache so dynamic prices
      // still compute (mirrors GET /api/ingredients' resilience). Without this,
      // computed_price stays unset and the list shows no price for dynamic recipes.
      try {
        catalog = JSON.parse(fs.readFileSync(INGREDIENTS_FILE_CACHE, 'utf8'));
      } catch (e) {
        catalog = null;
      }
      if (!catalog || !Array.isArray(catalog)) return;
    }
    var map = {};
    catalog.forEach(function (item) { if (item && item.item_id) map[item.item_id] = item; });

    var millingId = process.env.MILLING_FEE_ITEM_ID;
    var millingRate = 0;
    if (millingId) {
      if (map[millingId]) {
        millingRate = Number(map[millingId].rate) || 0;
      } else if (kioskItems && Array.isArray(kioskItems)) {
        for (var k = 0; k < kioskItems.length; k++) {
          if (kioskItems[k].item_id === millingId || (kioskItems[k].sku || '').toUpperCase() === millingId.toUpperCase()) { millingRate = Number(kioskItems[k].rate) || 0; break; }
        }
      }
    }

    return Promise.all(dynamicRecipes.map(function (recipe) {
      var detailKey = C.CACHE_KEYS.RECIPES + ':' + recipe.recipe_id;
      return cache.get(detailKey).then(function (detail) {
        if (!detail || !detail.ingredients) {
          return callAppsScriptPost('get_recipe', { recipe_id: recipe.recipe_id }).then(function (data) {
            if (!data || !data.ok || !data.data) return null;
            var result = { recipe: data.data.recipe || data.data, ingredients: data.data.ingredients || [] };
            cache.set(detailKey, result, RECIPES_CACHE_TTL);
            return result;
          }).catch(function () { return null; });
        }
        return detail;
      }).then(function (detail) {
        if (!detail || !detail.ingredients) return;
        var total = 0;
        detail.ingredients.forEach(function (ing) {
          var entry = map[ing.item_id];
          if (entry) total += (Number(ing.quantity) || 0) * (Number(entry.rate) || 0);
        });
        total += Number(recipe.service_fee) || 0;
        total += Number(recipe.materials_fee) || 0;
        recipe.computed_price = Math.round(total * 100) / 100;
        if (millingRate > 0) recipe.milling_fee_rate = millingRate;
      }).catch(function () {});
    }));
  }).catch(function () {});
}

// ---------------------------------------------------------------------------
// GET /api/recipes — List recipes with optional status filter
// ---------------------------------------------------------------------------

router.get('/api/recipes', function (req, res) {
  var status = req.query.status || 'all';
  var limit  = parseInt(req.query.limit, 10) || 0;
  var offset = parseInt(req.query.offset, 10) || 0;
  var cacheKey = C.CACHE_KEYS.RECIPES + ':' + status + ':' + limit + ':' + offset;

  cache.get(cacheKey).then(function (cached) {
    if (cached && cached.recipes) {
      log.info('[api/recipes] Cache hit status=' + status);
      return enrichListPrices(cached.recipes).then(function () {
        res.json({ source: 'cache', recipes: cached.recipes, total: cached.total });
      });
    }
    return callAppsScriptPost('get_recipes', { status: status, limit: limit, offset: offset })
      .then(function (data) {
        if (data && data.ok === false) {
          log.warn('[api/recipes] Apps Script rejected: ' + (data.error || '') + ' ' + (data.message || ''));
          return res.status(502).json({ error: 'Apps Script error: ' + (data.error || 'unknown'), detail: data.message || '' });
        }
        var payload = data.data || {};
        if (payload.recipes && payload.recipes.length > 0) {
          cache.set(cacheKey, payload, RECIPES_CACHE_TTL);
          cache.set(C.CACHE_KEYS.RECIPES_TS, Date.now(), RECIPES_CACHE_TTL);
        }
        var recipeList = payload.recipes || [];
        return enrichListPrices(recipeList).then(function () {
          res.json({ source: 'apps-script', recipes: recipeList, total: payload.total || 0 });
        });
      });
  }).catch(function (err) {
    log.error('[api/recipes] ' + err.message);
    res.status(502).json({ error: 'Unable to fetch recipes' });
  });
});

// ---------------------------------------------------------------------------
// GET /api/recipes/:id — Single recipe detail with ingredients
// ---------------------------------------------------------------------------

router.get('/api/recipes/:id', function (req, res) {
  var recipeId = req.params.id;
  var cacheKey = C.CACHE_KEYS.RECIPES + ':' + recipeId;

  cache.get(cacheKey).then(function (cached) {
    if (cached) {
      log.info('[api/recipes/' + recipeId + '] Cache hit');
      return enrichWithComputedPrice(cached.recipe, cached.ingredients).then(function () {
        return enrichIngredientGroups(cached.ingredients);
      }).then(function () {
        cache.set(cacheKey, cached, RECIPES_CACHE_TTL);
        res.json(cached);
      });
    }
    return callAppsScriptPost('get_recipe', { recipe_id: recipeId })
      .then(function (data) {
        if (!data.ok) {
          return res.status(404).json({ error: data.message || 'Recipe not found' });
        }
        var detail = data.data || {};
        var result = { recipe: detail.recipe || detail, ingredients: detail.ingredients || [] };
        return enrichWithComputedPrice(result.recipe, result.ingredients).then(function () {
          return enrichIngredientGroups(result.ingredients);
        }).then(function () {
          cache.set(cacheKey, result, RECIPES_CACHE_TTL);
          res.json(result);
        });
      });
  }).catch(function (err) {
    log.error('[api/recipes/' + recipeId + '] ' + err.message);
    res.status(502).json({ error: 'Unable to fetch recipe' });
  });
});

// ---------------------------------------------------------------------------
// GET /api/recipes/:id/availability — Per-ingredient stock status
// ---------------------------------------------------------------------------

router.get('/api/recipes/:id/availability', function (req, res) {
  var recipeId = req.params.id;

  // Step 1: Fetch recipe ingredients from Apps Script (server fetches item_ids, never client — API-02)
  callAppsScriptPost('get_recipe', { recipe_id: recipeId }).then(function (data) {
    if (!data.ok) {
      return res.status(404).json({ error: data.message || 'Recipe not found' });
    }
    var detail = data.data || {};
    var ingredients = detail.ingredients || [];
    if (!ingredients.length) {
      return res.json({ recipe_id: recipeId, summary: 'all_ok', ingredients: [] });
    }

    // Step 2: Get ingredient stock from the full cached ingredients catalog (includes internal-only items)
    return cache.get(C.CACHE_KEYS.INGREDIENTS_ALL).then(function (catalog) {
      // If full ingredients cache is cold, return unknown status (Pitfall 5)
      if (!catalog) {
        var unknownResult = ingredients.map(function (ing) {
          return {
            item_id: ing.item_id,
            item_name: ing.item_name,
            unit: ing.unit,
            quantity_per_batch: ing.quantity || 0,
            stock_on_hand: null,
            batches_possible: null,
            status: 'unknown'
          };
        });
        return res.json({ recipe_id: recipeId, summary: 'unknown', ingredients: unknownResult });
      }

      // Build stock map from cached ingredients
      var stockMap = {};
      (Array.isArray(catalog) ? catalog : []).forEach(function (item) {
        stockMap[String(item.item_id)] = item.stock_on_hand || 0;
      });

      // Step 3: Compute per-ingredient availability (D-07, D-08)
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

      var anyOut = result.some(function (r) { return r.status === 'out'; });
      var allOk = result.every(function (r) { return r.status === 'ok'; });
      var summary = anyOut ? 'cannot_brew' : allOk ? 'all_ok' : 'some_low';

      res.json({ recipe_id: recipeId, summary: summary, ingredients: result });
    });
  }).catch(function (err) {
    log.error('[api/recipes/' + recipeId + '/availability] ' + err.message);
    res.status(502).json({ error: 'Unable to check availability' });
  });
});

// ---------------------------------------------------------------------------
// POST /api/recipes — Create new recipe
// ---------------------------------------------------------------------------

router.post('/api/recipes', function (req, res) {
  var payload = req.body || {};

  callAppsScriptPost('create_recipe', payload).then(function (data) {
    if (!data.ok) {
      return res.status(422).json({ error: data.message || data.error || 'Create failed' });
    }
    return bustRecipeCache(null).then(function () {
      res.status(201).json({ ok: true, recipe_id: data.recipe_id || (data.data && data.data.recipe_id) });
    });
  }).catch(function (err) {
    log.error('[api/recipes] POST failed: ' + err.message);
    res.status(502).json({ error: 'Unable to create recipe' });
  });
});

// ---------------------------------------------------------------------------
// PUT /api/recipes/:id — Update recipe (with activation guardrail D-02)
// ---------------------------------------------------------------------------

router.put('/api/recipes/:id', function (req, res) {
  var payload = req.body || {};
  payload.recipe_id = req.params.id;

  // D-02 activation guardrail — enforce server-side (Pitfall 7, T-13-04)
  if (payload.status === 'active') {
    var ingCount = parseInt(payload.ingredient_count, 10) || 0;
    var lockedPrice = parseFloat(payload.locked_price) || 0;
    if (lockedPrice <= 0) {
      return res.status(422).json({
        error: 'Cannot activate recipe: a valid locked price must be set'
      });
    }
    if (ingCount < 1) {
      return res.status(422).json({
        error: 'Cannot activate recipe: at least one ingredient must exist'
      });
    }
  }

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

// ---------------------------------------------------------------------------
// DELETE /api/recipes/:id — Delete recipe
// ---------------------------------------------------------------------------

router.delete('/api/recipes/:id', function (req, res) {
  var payload = { recipe_id: req.params.id };

  callAppsScriptPost('delete_recipe', payload).then(function (data) {
    if (!data.ok) {
      return res.status(422).json({ error: data.message || data.error || 'Delete failed' });
    }
    return bustRecipeCache(req.params.id).then(function () {
      res.json({ ok: true });
    });
  }).catch(function (err) {
    log.error('[api/recipes] DELETE ' + req.params.id + ' failed: ' + err.message);
    res.status(502).json({ error: 'Unable to delete recipe' });
  });
});

// ---------------------------------------------------------------------------
// POST /api/recipes/bust-cache — Manual cache invalidation for admin use
// ---------------------------------------------------------------------------

router.post('/api/recipes/bust-cache', function (req, res) {
  bustRecipeCache(null).then(function () {
    log.info('[api/recipes] Manual cache bust');
    res.json({ ok: true, message: 'Recipe cache cleared' });
  }).catch(function (err) {
    log.error('[api/recipes] Cache bust failed: ' + err.message);
    res.status(500).json({ error: 'Cache bust failed' });
  });
});

module.exports = router;
