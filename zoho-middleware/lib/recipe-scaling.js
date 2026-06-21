/**
 * Pure, surface-agnostic scaling helpers for recipe batch scaling.
 *
 * This module is intentionally pure: no I/O, no requires. It is independently
 * testable and importable by any route or service that needs scaling math
 * (pos-recipe.js in Phase 35; kiosk/BrewPad surfaces in Phase 36).
 *
 * Server is authoritative — callers must never accept a client-supplied
 * scale_factor directly. Callers compute:
 *   scaleFactor = target_volume_l / recipe.batch_size_l
 * and pass it here.
 *
 * Exports:
 *   scaleIngredient(ing, factor)                                 → shallow-cloned ingredient with scaled quantity
 *   scaleIngredients(ingredients, factor)                        → array of scaled ingredients
 *   computeScaledRecipeTotal(recipe, scaledIngredients,
 *                             catalogMap, saleType)              → grand total (2 dp)
 *   checkScaledStock(scaledIngredients, catalogMap)              → { ok, conflicts }
 *   CONTINUOUS_UNITS                                             → string[]
 *   DISCRETE_UNITS                                               → string[]
 */

'use strict';

// ---------------------------------------------------------------------------
// Unit classification constants
// ---------------------------------------------------------------------------

// Continuous units — scale linearly (l/ml are future-proof; not in live catalog today)
var CONTINUOUS_UNITS = ['kg', 'g', 'l', 'ml'];

// Discrete units — Math.max(1, Math.ceil(scaledQty))
// 'ft' [ASSUMED discrete]: 2 packaging items (tubing/hose lengths) in live catalog.
// Treating as discrete (integral feet) is the safe default.
// Confirm with owner before prod — if linear ft scaling is desired, remove 'ft' from this list.
var DISCRETE_UNITS = ['pcs', 'each', 'unit', 'pkg', 'ft'];

// ---------------------------------------------------------------------------
// scaleIngredient
// ---------------------------------------------------------------------------

/**
 * Scale a single ingredient's quantity by the given factor.
 *
 * Classification rules (D-01/D-02/D-03):
 *   - Unit in CONTINUOUS_UNITS  → linear (float-drift-safe 4dp round)
 *   - Unit in DISCRETE_UNITS    → Math.max(1, Math.ceil(rawQty))
 *   - Non-blank, unknown unit   → discrete (ceil) — conservative default
 *   - Blank / null / undefined  → linear (D-03: unknown/blank → continuous)
 *
 * @param {Object} ing    - ingredient with { quantity, unit, item_id, ... }
 * @param {number} factor - scale factor (target_volume_l / batch_size_l)
 * @returns {Object}      - shallow clone with scaled quantity (never mutates input)
 */
function scaleIngredient(ing, factor) {
  var rawQty    = (Number(ing.quantity) || 0) * factor;
  var unitLower = (ing.unit || '').toLowerCase().trim();

  var isContinuous = CONTINUOUS_UNITS.indexOf(unitLower) !== -1;
  var isDiscrete   = DISCRETE_UNITS.indexOf(unitLower)   !== -1;

  // D-03: blank unit → treat as continuous (linear)
  if (!unitLower) {
    isContinuous = true;
    isDiscrete   = false;
  } else if (!isContinuous && !isDiscrete) {
    // Non-blank token not in either set → discrete (conservative default)
    isDiscrete = true;
  }

  var scaledQty = isDiscrete
    ? Math.max(1, Math.ceil(rawQty))
    : Math.round(rawQty * 10000) / 10000; // 4dp prevents float drift

  return Object.assign({}, ing, { quantity: scaledQty });
}

// ---------------------------------------------------------------------------
// scaleIngredients
// ---------------------------------------------------------------------------

/**
 * Scale all ingredients in an array.
 *
 * @param {Array}  ingredients - array of ingredient objects
 * @param {number} factor      - scale factor
 * @returns {Array}            - new array of shallow-cloned scaled ingredients
 */
function scaleIngredients(ingredients, factor) {
  return (ingredients || []).map(function (ing) {
    return scaleIngredient(ing, factor);
  });
}

// ---------------------------------------------------------------------------
// computeScaledRecipeTotal
// ---------------------------------------------------------------------------

/**
 * Compute the grand total for a scaled recipe sale.
 *
 * Pricing modes (D-04/D-05/D-07):
 *   locked  → total = locked_price × _scale_factor   (ingredient/recipe portion)
 *   dynamic → total = Σ(scaled_qty × catalog_rate)
 *
 * Fixed add-ons (never scaled, added only for in-store sales):
 *   if saleType === 'in-store': total += service_fee + materials_fee
 *
 * The caller must set recipe._scale_factor before passing recipe in.
 * For base (1×) sales, _scale_factor should be 1.
 *
 * @param {Object} recipe            - recipe object with pricing fields + _scale_factor
 * @param {Array}  scaledIngredients - output of scaleIngredients()
 * @param {Object} catalogMap        - { [item_id]: { rate, ... } }
 * @param {string} saleType          - 'in-store' | 'take-out'
 * @returns {number}                 - grand total rounded to 2 decimal places
 */
function computeScaledRecipeTotal(recipe, scaledIngredients, catalogMap, saleType) {
  var hasLockedPrice = Number(recipe.locked_price) > 0;
  var pricingMode    = recipe.pricing_mode || (hasLockedPrice ? 'locked' : 'dynamic');
  var factor         = (typeof recipe._scale_factor === 'number') ? recipe._scale_factor : 1;
  var total          = 0;

  if (pricingMode === 'locked' && hasLockedPrice) {
    // Locked mode: scale the ingredient/recipe cost portion
    total = Number(recipe.locked_price) * factor;
  } else {
    // Dynamic mode: sum scaled ingredient costs
    (scaledIngredients || []).forEach(function (ing) {
      var entry = catalogMap[ing.item_id];
      if (entry) {
        total += (Number(ing.quantity) || 0) * (Number(entry.rate) || 0);
      }
    });
  }

  // Fixed fees: service + materials — added only for in-store sales
  if (saleType === 'in-store') {
    total += Number(recipe.service_fee)   || 0;
    total += Number(recipe.materials_fee) || 0;
  }

  return Math.round(total * 100) / 100;
}

// ---------------------------------------------------------------------------
// checkScaledStock
// ---------------------------------------------------------------------------

/**
 * Check scaled ingredient quantities against available stock.
 *
 * Items absent from catalogMap are skipped (unknown item — not a conflict).
 * A conflict occurs when scaled needed quantity exceeds stock_on_hand (D-08).
 *
 * @param {Array}  scaledIngredients - output of scaleIngredients()
 * @param {Object} catalogMap        - { [item_id]: { stock_on_hand, ... } }
 * @returns {{ ok: boolean, conflicts: Array }}
 *   conflicts: [{ item_id, item_name, needed, stock, unit }]
 */
function checkScaledStock(scaledIngredients, catalogMap) {
  var conflicts = [];

  (scaledIngredients || []).forEach(function (ing) {
    var entry = catalogMap[ing.item_id];
    if (!entry) return; // unknown item — skip (not a conflict)

    var stock  = Number(entry.stock_on_hand) || 0;
    var needed = Number(ing.quantity)         || 0;

    if (needed > stock) {
      conflicts.push({
        item_id:   ing.item_id,
        item_name: ing.item_name,
        needed:    needed,
        stock:     stock,
        unit:      ing.unit
      });
    }
  });

  return {
    ok:        conflicts.length === 0,
    conflicts: conflicts
  };
}

// ---------------------------------------------------------------------------
// computeModifiedRecipeTotal
// ---------------------------------------------------------------------------

/**
 * Compute the grand total for a recipe sale where staff have added, removed,
 * or substituted ingredients (MOD-02).
 *
 * Pricing branches (D-07/D-08/D-09):
 *
 *   LOCKED (recipe.locked_price > 0):
 *     Base cost = locked_price × scaleFactor + fees  (identical to unmodified locked total).
 *     ADDED ingredients (item_id not in originalIngredients) are each priced at
 *       scaleIngredient(item, scaleFactor).quantity × catalogMap[item_id].rate
 *     and added transparently on top (D-07).
 *     REMOVED ingredients give NO credit — the locked base is not reduced (D-08).
 *
 *   DYNAMIC (recipe.locked_price === 0 or absent):
 *     Total = computeScaledRecipeTotal(recipe, scaleIngredients(modifiedBaseIngredients, scaleFactor),
 *                                      catalogMap, saleType).
 *     Adds and removals both fall out naturally from the summed list (D-09).
 *
 * Security (T-36-01): rate is always read from catalogMap[item_id].rate.
 * Any rate/price field on the client-supplied ingredient object is ignored.
 *
 * Pure function: no I/O, no require(). Never mutates input arrays or objects.
 *
 * @param {Object} recipe                  - recipe with locked_price, service_fee, materials_fee, pricing_mode
 * @param {Array}  originalIngredients     - unmodified base ingredient list (from Apps Script)
 * @param {Array}  modifiedBaseIngredients - staff-edited ingredient list at base (pre-scale) quantities
 * @param {Object} catalogMap              - { [item_id]: { rate, ... } } — server-authoritative rates
 * @param {number} scaleFactor             - target_volume_l / recipe.batch_size_l
 * @param {string} saleType                - 'in-store' | 'take-out'
 * @returns {number}                       - grand total rounded to 2 decimal places
 */
function computeModifiedRecipeTotal(recipe, originalIngredients, modifiedBaseIngredients, catalogMap, scaleFactor, saleType) {
  var hasLockedPrice = Number(recipe.locked_price) > 0;
  var factor = (typeof scaleFactor === 'number') ? scaleFactor : 1;

  if (hasLockedPrice) {
    // --- LOCKED mode (D-07/D-08) ---
    // Base total: locked_price × factor + fees (computeScaledRecipeTotal handles this;
    // pass an empty scaledIngredients so it won't sum any ingredient costs)
    var lockedRecipe = Object.assign({}, recipe, { _scale_factor: factor, pricing_mode: 'locked' });
    var total = computeScaledRecipeTotal(lockedRecipe, [], catalogMap, saleType);

    // Build a lookup of original item_ids to detect ADDED items
    var originalIds = {};
    (originalIngredients || []).forEach(function (ing) {
      originalIds[ing.item_id] = true;
    });

    // D-07: charge each ADDED ingredient at its scaled quantity × catalog rate
    // D-08: REMOVED items are not in modifiedBaseIngredients, so they simply
    //       don't appear here — the locked base total is unchanged (no credit)
    (modifiedBaseIngredients || []).forEach(function (ing) {
      if (!originalIds[ing.item_id]) {
        // This item was ADDED by staff
        var catalogEntry = catalogMap[ing.item_id];
        if (catalogEntry) {
          // Scale the added ingredient the same way as base ingredients (D-04)
          var scaled = scaleIngredient(ing, factor);
          // Use ONLY the server catalog rate — never the client-supplied rate (T-36-01)
          total += (Number(scaled.quantity) || 0) * (Number(catalogEntry.rate) || 0);
        }
      }
    });

    return Math.round(total * 100) / 100;
  }

  // --- DYNAMIC mode (D-09) ---
  // Scale the full modified list; adds/removals both fall out naturally
  var scaledModified = scaleIngredients(modifiedBaseIngredients, factor);
  // computeScaledRecipeTotal needs _scale_factor on the recipe object (but for
  // dynamic mode it does not actually use it — the scaled quantities are already
  // in scaledModified). Set it for consistency with the function contract.
  var dynamicRecipe = Object.assign({}, recipe, { _scale_factor: factor });
  return computeScaledRecipeTotal(dynamicRecipe, scaledModified, catalogMap, saleType);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  scaleIngredient:              scaleIngredient,
  scaleIngredients:             scaleIngredients,
  computeScaledRecipeTotal:     computeScaledRecipeTotal,
  computeModifiedRecipeTotal:   computeModifiedRecipeTotal,
  checkScaledStock:             checkScaledStock,
  CONTINUOUS_UNITS:             CONTINUOUS_UNITS,
  DISCRETE_UNITS:               DISCRETE_UNITS
};
