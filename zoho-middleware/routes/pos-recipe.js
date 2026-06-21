'use strict';

var express = require('express');
var axios = require('axios');
var helcimLib = require('../lib/helcim');
var zohoApi = require('../lib/zoho-api');
var cache = require('../lib/cache');
var log = require('../lib/logger');
var eventLog = require('../lib/eventLog');
var mailer = require('../lib/mailer');
var C = require('../lib/constants');
var brewpadIntegration = require('../lib/brewpad-integration');
var scaling = require('../lib/recipe-scaling');

var zohoPost = zohoApi.zohoPost;

var router = express.Router();

// ---------------------------------------------------------------------------
// Helpers — Apps Script communication (same pattern as routes/recipes.js)
// ---------------------------------------------------------------------------

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
  }).then(function (resp) { return resp.data; });
}

// ---------------------------------------------------------------------------
// computeRecipeQuote — shared helper (35-06, extended 36-03)
// Fetches recipe, validates target_volume_l, reads INGREDIENTS_ALL catalog,
// scales ingredients, checks stock, and computes the authoritative grand total.
// Returns a Promise that resolves to the computed quote object, or rejects with
// an object { status, body } that the caller can forward as an HTTP response.
//
// Params:
//   recipeId           {string}         — recipe ID to fetch from Apps Script
//   rawTarget          {*}              — target_volume_l from request (body or query); undefined/null/'' => default to base
//   saleType           {string}         — 'in-store' | 'take-out'
//   millGrain          {boolean}        — whether to add milling fee (take-out only)
//   modifiedIngredients {Array|undefined} — optional pre-scale modified base list (MOD-02, 36-03);
//                                         when present, prices via computeModifiedRecipeTotal
// ---------------------------------------------------------------------------

function computeRecipeQuote(recipeId, rawTarget, saleType, millGrain, modifiedIngredients) {
  return callAppsScriptPost('get_recipe', { recipe_id: recipeId })
    .then(function (data) {
      if (!data || !data.ok || !data.data || !data.data.recipe) {
        return Promise.reject({ status: 404, body: { error: 'Recipe not found' } });
      }
      var recipe = data.data.recipe;
      var ingredients = data.data.ingredients || [];

      if (recipe.status !== 'active') {
        return Promise.reject({ status: 400, body: { error: 'Recipe is not active' } });
      }

      // Validate batch_size_l and target_volume_l (D-11)
      var baseVol = Number(recipe.batch_size_l) || 0;
      if (baseVol <= 0) {
        return Promise.reject({ status: 400, body: { error: 'Recipe has no base batch size set. Cannot scale.' } });
      }

      // Default target_volume_l to batch_size_l if absent/blank (=> scale_factor 1.0, backward compat D-05)
      var targetVolumeL = (rawTarget === undefined || rawTarget === null || rawTarget === '')
        ? baseVol
        : Number(rawTarget);

      if (isNaN(targetVolumeL) || targetVolumeL <= 0) {
        return Promise.reject({ status: 400, body: { error: 'target_volume_l must be > 0' } });
      }
      if (targetVolumeL > baseVol * 10) {
        return Promise.reject({ status: 400, body: { error: 'target_volume_l exceeds maximum (10x base)' } });
      }

      var scaleFactor = targetVolumeL / baseVol;
      recipe._scale_factor = scaleFactor;

      // Determine pricing mode for logging/response
      var hasLockedPrice = Number(recipe.locked_price) > 0;
      var pricingMode = recipe.pricing_mode || (hasLockedPrice ? 'locked' : 'dynamic');

      // MOD-02 (36-03): determine which ingredient list to scale for stock check + response
      // When modifiedIngredients is provided, the response ingredient list reflects the modified list;
      // the server fetched originalIngredients (ingredients) are still used for locked-add detection.
      var isModified = Array.isArray(modifiedIngredients);
      var baseIngredients = isModified ? modifiedIngredients : ingredients;

      return cache.get(C.CACHE_KEYS.INGREDIENTS_ALL).then(function (ingredientCatalog) {
        if (!ingredientCatalog || !Array.isArray(ingredientCatalog)) {
          return Promise.reject({ status: 503, body: { error: 'Ingredient catalog not available — try again shortly' } });
        }

        // Build item_id -> catalog entry lookup
        var catalogMap = {};
        ingredientCatalog.forEach(function (item) {
          if (item && item.item_id) catalogMap[item.item_id] = item;
        });

        // Scale the base ingredient list (modified or original) for stock check + response
        var scaledIngredients = scaling.scaleIngredients(baseIngredients, scaleFactor);

        // Stock check (D-08) — always run on the scaled (potentially modified) list
        var stockCheck = scaling.checkScaledStock(scaledIngredients, catalogMap);

        // Re-price via tested helper (SCALE-03, D-04/D-05/D-07)
        // MOD-02 (36-03): when modified list present, use computeModifiedRecipeTotal (server-authoritative)
        var grandTotal;
        if (isModified) {
          grandTotal = scaling.computeModifiedRecipeTotal(recipe, ingredients, modifiedIngredients, catalogMap, scaleFactor, saleType);
        } else {
          grandTotal = scaling.computeScaledRecipeTotal(recipe, scaledIngredients, catalogMap, saleType);
        }

        // Take-out milling fee — added on top of helper result (helper does not know about milling)
        var millingFeeAdded = 0;
        if (saleType === 'take-out' && millGrain) {
          if (!process.env.MILLING_FEE_ITEM_ID) {
            return Promise.reject({ status: 400, body: { error: 'Milling fee not configured. Contact admin.' } });
          }
          var millingEntry = catalogMap[process.env.MILLING_FEE_ITEM_ID];
          if (millingEntry) {
            millingFeeAdded = Number(millingEntry.rate) || 0;
            grandTotal += millingFeeAdded;
            grandTotal = Math.round(grandTotal * 100) / 100;
          }
        }

        return {
          recipe: recipe,
          ingredients: ingredients,
          baseVol: baseVol,
          targetVolumeL: targetVolumeL,
          scaleFactor: scaleFactor,
          pricingMode: pricingMode,
          catalogMap: catalogMap,
          scaledIngredients: scaledIngredients,
          stockCheck: stockCheck,
          grandTotal: grandTotal,
          isModified: isModified
        };
      });
    });
}

// ---------------------------------------------------------------------------
// POST /api/kiosk/recipe-sale
// Initiate a recipe sale: validate, compute total, acquire mutex, push to terminal.
// ---------------------------------------------------------------------------

router.post('/api/kiosk/recipe-sale', function (req, res) {
  // Feature gate (D-13, KSK-04): BEER_SALES_ENABLED must be 'true'
  if ((process.env.BEER_SALES_ENABLED || 'false').toLowerCase() !== 'true') {
    return res.status(403).json({ error: 'Recipe sales are not enabled' });
  }

  // Terminal must be configured
  if (!helcimLib.isTerminalEnabled()) {
    return res.status(503).json({ error: 'POS terminal not configured' });
  }

  var body = req.body || {};

  // Input validation
  if (!body.recipe_id || typeof body.recipe_id !== 'string' || !body.recipe_id.trim()) {
    return res.status(400).json({ error: 'Missing recipe_id' });
  }
  if (body.sale_type !== 'in-store' && body.sale_type !== 'take-out') {
    return res.status(400).json({ error: 'sale_type must be in-store or take-out' });
  }
  var millGrain = body.mill_grain === true;
  // MOD-02 (36-03): pass modified_ingredients to pricing helper if provided (array from JSON body)
  var modifiedIngredients = Array.isArray(body.modified_ingredients) ? body.modified_ingredients : undefined;

  computeRecipeQuote(body.recipe_id, body.target_volume_l, body.sale_type, millGrain, modifiedIngredients)
    .then(function (quote) {
      var grandTotal = quote.grandTotal;
      var scaleFactor = quote.scaleFactor;
      var targetVolumeL = quote.targetVolumeL;
      var pricingMode = quote.pricingMode;

      // Stock gate: scaled quantities vs stock_on_hand (D-08)
      if (!quote.stockCheck.ok && !body.override) {
        return res.status(409).json({
          error: 'Insufficient stock for scaled batch',
          conflicts: quote.stockCheck.conflicts
        });
      }

      log.info('[recipe-sale] target_volume_l=' + targetVolumeL + ' base_vol=' + quote.baseVol + ' scale_factor=' + scaleFactor);
      log.info('[recipe-sale] pricing_mode=' + pricingMode + ' (raw=' + quote.recipe.pricing_mode + ') locked_price=' + quote.recipe.locked_price);
      log.info('[recipe-sale] grandTotal=' + grandTotal + ' pricingMode=' + pricingMode);

      // Acquire Redis mutex before terminal push (D-04, INV-02)
      cache.acquireLock(C.LOCK_KEYS.RECIPE_SALE, 30).then(function (acquired) {
        if (!acquired) {
          return res.status(503).json({ error: 'Another recipe sale in progress — try again in a moment.' });
        }

        var refNumber = 'RECIPE-' + Date.now();

        // Push to terminal
        helcimLib.terminalPurchase(grandTotal, refNumber)
          .then(function () {
            res.status(202).json({
              pending: true,
              reference: refNumber,
              recipe_id: body.recipe_id,
              sale_type: body.sale_type,
              mill_grain: millGrain,
              total: grandTotal,
              scale_factor: scaleFactor,
              target_volume_l: targetVolumeL
            });
          })
          .catch(function (termErr) {
            log.error('[pos-recipe/recipe-sale] Terminal push failed: ' + termErr.message);
            // Release lock on terminal failure (Pitfall 1)
            cache.releaseLock(C.LOCK_KEYS.RECIPE_SALE).catch(function () {});
            res.status(502).json({ error: 'Terminal error — please try again' });
          });
      }).catch(function (lockErr) {
        log.error('[pos-recipe/recipe-sale] Lock acquisition error: ' + lockErr.message);
        res.status(503).json({ error: 'Service temporarily unavailable — try again in a moment.' });
      });
    })
    .catch(function (err) {
      if (err && err.status) {
        return res.status(err.status).json(err.body);
      }
      log.error('[pos-recipe/recipe-sale] Error: ' + (err && err.message));
      res.status(502).json({ error: 'Failed to fetch recipe. Please try again.' });
    });
});

// ---------------------------------------------------------------------------
// GET /api/kiosk/recipe-quote
// Dry-run quote: compute scale+price+stock with NO terminal charge, lock, or invoice.
// Query params: recipe_id, target_volume_l (optional, defaults to base), sale_type
// ---------------------------------------------------------------------------

router.get('/api/kiosk/recipe-quote', function (req, res) {
  // Feature gate (D-13, KSK-04): mirrors recipe-sale gate
  if ((process.env.BEER_SALES_ENABLED || 'false').toLowerCase() !== 'true') {
    return res.status(403).json({ error: 'Recipe sales are not enabled' });
  }

  var query = req.query || {};
  var recipeId = query.recipe_id;
  var saleType = query.sale_type || 'in-store';

  if (!recipeId || typeof recipeId !== 'string' || !recipeId.trim()) {
    return res.status(400).json({ error: 'Missing recipe_id' });
  }

  // MOD-02 (36-03): parse optional modified_ingredients JSON-encoded array from query string
  // Malformed JSON is silently treated as null (unmodified quote) — no 500 (T-36-09 safe)
  var modifiedIngredients = null;
  if (query.modified_ingredients) {
    try {
      modifiedIngredients = JSON.parse(query.modified_ingredients);
      if (!Array.isArray(modifiedIngredients)) modifiedIngredients = null;
    } catch (e) {
      modifiedIngredients = null;
    }
  }

  computeRecipeQuote(recipeId, query.target_volume_l, saleType, false, modifiedIngredients)
    .then(function (quote) {
      var catalogMap = quote.catalogMap;

      // Build enriched ingredient list for the response.
      // MOD-02 (36-03): when modified, scaledIngredients reflects the SCALED MODIFIED list.
      // base_quantity is looked up from the modified list (pre-scale), not the original recipe.
      var baseList = modifiedIngredients || quote.ingredients;
      var ingredientList = quote.scaledIngredients.map(function (scaled) {
        // Find the pre-scale quantity from the base list (modified or original)
        var baseEntry = null;
        for (var i = 0; i < baseList.length; i++) {
          if (baseList[i].item_id === scaled.item_id) {
            baseEntry = baseList[i];
            break;
          }
        }
        var baseQty = baseEntry ? (Number(baseEntry.quantity) || 0) : 0;
        var catalogEntry = catalogMap[scaled.item_id];
        var rate = catalogEntry ? (Number(catalogEntry.rate) || 0) : 0;
        var scaledQty = Number(scaled.quantity) || 0;
        return {
          item_id: scaled.item_id,
          item_name: scaled.item_name,
          unit: scaled.unit,
          base_quantity: baseQty,
          quantity: scaledQty,
          rate: rate,
          line_total: Math.round(scaledQty * rate * 100) / 100
        };
      });

      log.info('[recipe-quote] recipe_id=' + recipeId + ' target_volume_l=' + quote.targetVolumeL + ' scale_factor=' + quote.scaleFactor + ' total=' + quote.grandTotal + ' is_modified=' + quote.isModified);

      res.status(200).json({
        ok: true,
        recipe_id: recipeId,
        base_volume_l: quote.baseVol,
        target_volume_l: quote.targetVolumeL,
        scale_factor: quote.scaleFactor,
        pricing_mode: quote.pricingMode,
        total: quote.grandTotal,
        is_modified: quote.isModified,
        ingredients: ingredientList,
        stock: {
          ok: quote.stockCheck.ok,
          conflicts: quote.stockCheck.conflicts
        }
      });
    })
    .catch(function (err) {
      if (err && err.status) {
        return res.status(err.status).json(err.body);
      }
      log.error('[pos-recipe/recipe-quote] Error: ' + (err && err.message));
      res.status(502).json({ error: 'Failed to fetch recipe. Please try again.' });
    });
});

// ---------------------------------------------------------------------------
// POST /api/kiosk/recipe-sale/confirm
// After terminal payment confirmed: re-validate, create invoice, bust caches,
// fire-and-forget batch creation.
// ---------------------------------------------------------------------------

router.post('/api/kiosk/recipe-sale/confirm', function (req, res) {
  // Feature gate (D-13, KSK-04)
  if ((process.env.BEER_SALES_ENABLED || 'false').toLowerCase() !== 'true') {
    return res.status(403).json({ error: 'Recipe sales are not enabled' });
  }

  var body = req.body || {};

  // Input validation
  if (!body.recipe_id || typeof body.recipe_id !== 'string' || !body.recipe_id.trim()) {
    return res.status(400).json({ error: 'Missing recipe_id' });
  }
  if (!body.transaction_id || typeof body.transaction_id !== 'string' || !body.transaction_id.trim()) {
    return res.status(400).json({ error: 'Missing transaction_id' });
  }
  if (!body.reference || typeof body.reference !== 'string' || !body.reference.trim()) {
    return res.status(400).json({ error: 'Missing reference' });
  }

  var txnId = body.transaction_id;
  var millGrain = body.mill_grain === true;
  // MOD-02 (36-03): parse modified_ingredients from request body (array or null)
  var modifiedConfirm = Array.isArray(body.modified_ingredients) ? body.modified_ingredients : null;

  // Re-fetch recipe server-side (never trust client data)
  callAppsScriptPost('get_recipe', { recipe_id: body.recipe_id })
    .then(function (data) {
      if (!data || !data.ok || !data.data || !data.data.recipe) {
        return res.status(404).json({ error: 'Recipe not found' });
      }
      var recipe = data.data.recipe;
      var ingredients = data.data.ingredients || [];

      if (recipe.status !== 'active') {
        return res.status(400).json({ error: 'Recipe is not active' });
      }

      // Validate batch_size_l and target_volume_l (D-11) — same contract as quote handler
      var baseVolC = Number(recipe.batch_size_l) || 0;
      if (baseVolC <= 0) {
        return res.status(400).json({ error: 'Recipe has no base batch size set. Cannot scale.' });
      }

      // Default target_volume_l to batch_size_l if absent/blank (=> scale_factor 1.0, D-05 backward compat)
      var rawTargetVolC = body.target_volume_l;
      var targetVolumeLConfirm = (rawTargetVolC === undefined || rawTargetVolC === null || rawTargetVolC === '')
        ? baseVolC
        : Number(rawTargetVolC);

      if (isNaN(targetVolumeLConfirm) || targetVolumeLConfirm <= 0) {
        return res.status(400).json({ error: 'target_volume_l must be > 0' });
      }
      if (targetVolumeLConfirm > baseVolC * 10) {
        return res.status(400).json({ error: 'target_volume_l exceeds maximum (10x base)' });
      }

      var scaleFactorConfirm = targetVolumeLConfirm / baseVolC;
      recipe._scale_factor = scaleFactorConfirm;
      log.info('[pos-recipe/confirm] target_volume_l=' + targetVolumeLConfirm + ' base_vol=' + baseVolC + ' scale_factor=' + scaleFactorConfirm);

      // Re-compute total server-side from full ingredient catalog (includes internal-only items)
      cache.get(C.CACHE_KEYS.INGREDIENTS_ALL).then(function (ingredientCatalog) {
        if (!ingredientCatalog || !Array.isArray(ingredientCatalog)) {
          return res.status(503).json({ error: 'Ingredient catalog not available — try again shortly' });
        }

        // Build item_id -> catalog entry lookup
        var catalogMap = {};
        ingredientCatalog.forEach(function (item) {
          if (item && item.item_id) catalogMap[item.item_id] = item;
        });

        // MOD-02 (36-03): determine which ingredient list to scale for invoice + stock check
        // When modifiedConfirm is present, scale from the modified base list (same as quote path)
        var baseIngredientsConfirm = modifiedConfirm || ingredients;

        // Re-scale server-side (never trust client quantities — Pitfall 1/D-09)
        var scaledIngredients = scaling.scaleIngredients(baseIngredientsConfirm, scaleFactorConfirm);

        // Belt-and-suspenders stock re-check at confirm time (D-09)
        // Uses scaled MODIFIED quantities (T-36-08 mitigated)
        var stockCheckConfirm = scaling.checkScaledStock(scaledIngredients, catalogMap);
        if (!stockCheckConfirm.ok && !body.override) {
          return res.status(409).json({
            error: 'Insufficient stock for scaled batch',
            conflicts: stockCheckConfirm.conflicts
          });
        }

        // Build invoice line items — use SCALED quantities for Zoho inventory deduction (SCALE-04, INV-01)
        var lineItems = [];
        for (var i = 0; i < scaledIngredients.length; i++) {
          var ing = scaledIngredients[i];
          var catalogEntry = catalogMap[ing.item_id];
          var ingredientRate = catalogEntry ? (Number(catalogEntry.rate) || 0) : 0;
          var ingredientQty = Number(ing.quantity) || 0;
          var li = {
            item_id: ing.item_id,
            name: ing.item_name,
            quantity: ingredientQty,
            rate: ingredientRate
          };
          if (catalogEntry && catalogEntry.tax_id) {
            li.tax_id = catalogEntry.tax_id;
          }
          lineItems.push(li);
        }

        // Add applicable fee line items (always added to invoice for record-keeping)
        if (body.sale_type === 'in-store') {
          var serviceFee = Number(recipe.service_fee) || 0;
          var materialsFee = Number(recipe.materials_fee) || 0;
          if (process.env.MAKERS_FEE_ITEM_ID) {
            lineItems.push({
              item_id: process.env.MAKERS_FEE_ITEM_ID,
              name: 'Brewing Fee',
              quantity: 1,
              rate: serviceFee
            });
          }
          if (process.env.MATERIALS_FEE_ITEM_ID) {
            lineItems.push({
              item_id: process.env.MATERIALS_FEE_ITEM_ID,
              name: 'Materials Fee',
              quantity: 1,
              rate: materialsFee
            });
          }
        } else if (body.sale_type === 'take-out' && millGrain) {
          if (!process.env.MILLING_FEE_ITEM_ID) {
            return res.status(400).json({ error: 'Milling fee not configured. Contact admin.' });
          }
          var millingEntry = catalogMap[process.env.MILLING_FEE_ITEM_ID];
          var millingRate = millingEntry ? (Number(millingEntry.rate) || 0) : 0;
          lineItems.push({
            item_id: process.env.MILLING_FEE_ITEM_ID,
            name: 'Milling Fee',
            quantity: 1,
            rate: millingRate
          });
        }

        // Determine authoritative grand total via helper (same formula as quote, SCALE-03)
        // MOD-02 (36-03): when modified list present, use computeModifiedRecipeTotal (server-authoritative)
        // This ensures displayed price (from quote) == charged price (from confirm) for identical inputs
        var grandTotal;
        if (modifiedConfirm) {
          grandTotal = scaling.computeModifiedRecipeTotal(recipe, ingredients, modifiedConfirm, catalogMap, scaleFactorConfirm, body.sale_type);
        } else {
          grandTotal = scaling.computeScaledRecipeTotal(recipe, scaledIngredients, catalogMap, body.sale_type);
        }

        // Take-out milling fee — added on top (helper does not know about milling)
        if (body.sale_type === 'take-out' && millGrain) {
          var millingLineItem = lineItems.find(function (li) { return li.item_id === process.env.MILLING_FEE_ITEM_ID; });
          if (millingLineItem) {
            grandTotal += millingLineItem.rate || 0;
            grandTotal = Math.round(grandTotal * 100) / 100;
          }
        }

        var today = new Date().toISOString().slice(0, 10);

        var invoicePayload = {
          date: today,
          reference_number: body.reference,
          payment_terms: 0,
          payment_terms_label: 'Due on Receipt',
          line_items: lineItems,
          notes: 'Kiosk recipe sale (' + body.sale_type + '). Recipe: ' + body.recipe_id + '. Ref: ' + body.reference,
          custom_fields: [],
          customer_id: body.contact_id || process.env.KIOSK_CONTACT_ID || ''
        };

        // Create Zoho invoice
        zohoPost('/invoices', invoicePayload)
          .then(function (invoiceData) {
            var invoice = invoiceData.invoice || {};
            var invoiceId = invoice.invoice_id || '';
            var invoiceNumber = invoice.invoice_number || '';
            log.info('[pos-recipe/confirm] Invoice created: ' + invoiceNumber);

            // Submit invoice (triggers inventory deduction per INV-01) — fire-and-forget
            zohoPost('/invoices/' + invoiceId + '/submit', {}).catch(function () {});

            // Record customer payment
            zohoPost('/customerpayments', {
              payment_mode: 'creditcard',
              amount: grandTotal,
              date: today,
              reference_number: txnId,
              invoices: [{ invoice_id: invoiceId, amount_applied: grandTotal }],
              notes: 'Kiosk recipe sale. Ref: ' + body.reference
            }).catch(function (payErr) {
              log.error('[pos-recipe/confirm] Payment recording failed: ' + payErr.message);
            });

            // Bust caches (Pitfall 4 — must bust BOTH product and ingredient caches).
            // INGREDIENTS_ALL is busted too because the stock/availability checks
            // read the full catalog (35-05); otherwise post-sale stock goes stale.
            cache.del(C.CACHE_KEYS.KIOSK_PRODUCTS);
            cache.del(C.CACHE_KEYS.INGREDIENTS);
            cache.del(C.CACHE_KEYS.INGREDIENTS_ALL);
            cache.del(C.CACHE_KEYS.RECIPES_TS);

            // Release mutex
            cache.releaseLock(C.LOCK_KEYS.RECIPE_SALE).catch(function () {});

            // Fire-and-forget batch creation — only for in-store sales (D-09, D-10)
            if (body.sale_type === 'in-store') {
              var snapshot = {
                name: recipe.name,
                style: recipe.style,
                abv: recipe.abv,
                locked_price: recipe.locked_price,
                service_fee: recipe.service_fee,
                materials_fee: recipe.materials_fee,
                target_volume_l: targetVolumeLConfirm,
                scale_factor: scaleFactorConfirm,
                ingredients: scaledIngredients,
                // MOD-02 (36-03): freeze modified list + flag into snapshot
                modified_base_ingredients: modifiedConfirm,
                is_modified: !!(modifiedConfirm && modifiedConfirm.length)
              };
              brewpadIntegration.detectRecipeSale(
                body.recipe_id,
                snapshot,
                invoiceNumber,
                body.customer_name,
                body.contact_id
              );
            }

            // Log event
            eventLog.logEvent('kiosk.recipe_sale_completed', {
              txnId: txnId,
              recipeId: body.recipe_id,
              saleType: body.sale_type,
              total: grandTotal,
              invoiceNumber: invoiceNumber
            });

            // Return receipt
            res.status(201).json({
              ok: true,
              transaction_id: txnId,
              invoice_number: invoiceNumber,
              recipe_id: body.recipe_id,
              sale_type: body.sale_type,
              total: grandTotal
            });
          })
          .catch(function (invoiceErr) {
            // Zoho invoice failed after payment — void the transaction (Pitfall 1, T-14-09)
            var invoiceMsg = invoiceErr.message;
            if (invoiceErr.response && invoiceErr.response.data) {
              invoiceMsg = invoiceErr.response.data.message || invoiceErr.response.data.error || invoiceMsg;
            }
            log.error('[pos-recipe/confirm] Invoice creation failed — voiding txn=' + txnId + ': ' + invoiceMsg);

            eventLog.logEvent('kiosk.recipe_sale_failed_after_charge', {
              txnId: txnId,
              recipeId: body.recipe_id,
              amount: grandTotal
            });

            helcimLib.voidTransaction(txnId)
              .then(function () {
                log.info('[pos-recipe/confirm] Voided txn=' + txnId + ' after invoice failure');
              })
              .catch(function (voidErr) {
                log.error('[pos-recipe/confirm] CRITICAL: Void failed for txn=' + txnId + ': ' + voidErr.message);
                var failRecord = {
                  txnId: txnId,
                  amount: grandTotal,
                  timestamp: new Date().toISOString(),
                  error: voidErr.message,
                  needs_manual_review: true
                };
                cache.set('sv:void-failure:' + Date.now(), failRecord, 60 * 60 * 24 * 30).catch(function () {});
                mailer.sendVoidFailureAlert({
                  txnId: txnId,
                  amount: grandTotal,
                  error: voidErr.message,
                  timestamp: failRecord.timestamp
                }).catch(function (mailErr) {
                  log.error('[pos-recipe/confirm] Void failure alert email failed: ' + mailErr.message);
                });
              })
              .then(function () {
                // Release lock after void attempt (success or failure)
                cache.releaseLock(C.LOCK_KEYS.RECIPE_SALE).catch(function () {});
                if (res.headersSent) return;
                res.status(502).json({
                  error: 'Payment was taken but invoice failed. Payment voided.',
                  payment_voided: true
                });
              });
          });
      }).catch(function (cacheErr) {
        log.error('[pos-recipe/confirm] Cache error: ' + cacheErr.message);
        cache.releaseLock(C.LOCK_KEYS.RECIPE_SALE).catch(function () {});
        res.status(503).json({ error: 'Ingredient catalog not available — try again shortly' });
      });
    })
    .catch(function (appsErr) {
      log.error('[pos-recipe/confirm] Apps Script error: ' + appsErr.message);
      cache.releaseLock(C.LOCK_KEYS.RECIPE_SALE).catch(function () {});
      res.status(502).json({ error: 'Failed to fetch recipe. Please try again.' });
    });
});

module.exports = router;
