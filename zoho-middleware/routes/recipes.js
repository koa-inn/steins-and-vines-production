'use strict';

var express = require('express');
var cache = require('../lib/cache');
var log = require('../lib/logger');
var C = require('../lib/constants');
var axios = require('axios');

var router = express.Router();

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
      return res.json({ source: 'cache', recipes: cached.recipes, total: cached.total });
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
        res.json({ source: 'apps-script', recipes: payload.recipes || [], total: payload.total || 0 });
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
      return res.json(cached);
    }
    return callAppsScriptPost('get_recipe', { recipe_id: recipeId })
      .then(function (data) {
        if (!data.ok) {
          return res.status(404).json({ error: data.message || 'Recipe not found' });
        }
        var detail = data.data || {};
        var result = { recipe: detail.recipe || detail, ingredients: detail.ingredients || [] };
        cache.set(cacheKey, result, RECIPES_CACHE_TTL);
        res.json(result);
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

    // Step 2: Get ingredient stock from the cached ingredients catalog
    return cache.get(C.CACHE_KEYS.INGREDIENTS).then(function (catalog) {
      // If ingredients cache is cold, return unknown status (Pitfall 5)
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
