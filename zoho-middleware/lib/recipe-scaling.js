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
 *   ingredientLineCost(item, line)                               → unit-aware per-line cost (D-01/D-02)
 *   classifyUnit(raw)                                            → { family, norm }
 *   CONTINUOUS_UNITS                                             → string[]
 *   DISCRETE_UNITS                                               → string[]
 */

'use strict';

// ---------------------------------------------------------------------------
// Unit classification constants
// ---------------------------------------------------------------------------

// Continuous units — scale linearly (decimals preserved).
// Metric (kg/g/l/ml) + imperial weight/volume used by BeerSmith/BeerXML recipes
// (oz/lb for grains & hops; tsp/tbsp/cup/pt/qt/gal/fl oz for additives & volumes).
// NOTE: unrecognised units now ALSO scale linearly (see scaleIngredient) — this
// list is the explicit/documented set; the linear default is the safety net.
var CONTINUOUS_UNITS = [
  'kg', 'g', 'mg', 'l', 'ml',
  'oz', 'lb', 'lbs', 'tsp', 'tbsp', 'cup', 'pt', 'qt', 'gal', 'floz', 'fl oz'
];

// Discrete units — Math.max(1, Math.ceil(scaledQty)). ONLY these explicit tokens
// round up; anything not listed here is treated as continuous (linear).
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
 * Classification rules (D-01/D-02/D-03; unknown-unit default revised 2026-06-27):
 *   - Unit in DISCRETE_UNITS    → Math.max(1, Math.ceil(rawQty))
 *   - Everything else (CONTINUOUS_UNITS, blank, OR unknown) → linear (4dp round)
 *
 * Rationale: only explicitly discrete units round up. Unrecognised units (e.g.
 * imperial 'oz'/'lb' from BeerSmith, or any future unit) scale LINEARLY so they
 * never silently lose decimals and inflate the charged amount. Previously an
 * unknown unit defaulted to ceil, which rounded fractional imperial quantities.
 *
 * @param {Object} ing    - ingredient with { quantity, unit, item_id, ... }
 * @param {number} factor - scale factor (target_volume_l / batch_size_l)
 * @returns {Object}      - shallow clone with scaled quantity (never mutates input)
 */
function scaleIngredient(ing, factor) {
  var rawQty    = (Number(ing.quantity) || 0) * factor;
  var unitLower = (ing.unit || '').toLowerCase().trim();

  var isDiscrete = DISCRETE_UNITS.indexOf(unitLower) !== -1;

  // Only explicitly discrete units round up. Blank/unknown/unlisted units →
  // linear (revised 2026-06-27): a non-blank token not in DISCRETE_UNITS now
  // scales linearly instead of ceil, so imperial/other unmapped units keep
  // their decimals.
  if (!unitLower || !isDiscrete) {
    isDiscrete = false;
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
 *   dynamic → total = Σ ingredientLineCost(entry, ing).cost  (unit-converted, D-01/D-02)
 *
 * Fixed add-ons (never scaled, added only for in-store sales):
 *   if saleType === 'in-store': total += service_fee + materials_fee
 *
 * The caller must set recipe._scale_factor before passing recipe in.
 * For base (1×) sales, _scale_factor should be 1.
 *
 * @param {Object} recipe            - recipe object with pricing fields + _scale_factor
 * @param {Array}  scaledIngredients - output of scaleIngredients()
 * @param {Object} catalogMap        - { [item_id]: { rate, unit, ... } }
 * @param {string} saleType          - 'in-store' | 'take-out'
 * @returns {number}                 - grand total rounded to 2 decimal places
 * @throws {Error} name === 'RecipeLineUnitError' — when a dynamic-mode line's
 *   unit cannot convert to its catalog item's unit (D-02 fail-closed). The
 *   error message names the offending item and both units.
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
    // Dynamic mode: sum unit-converted scaled ingredient costs (D-01/D-02)
    (scaledIngredients || []).forEach(function (ing) {
      var entry = catalogMap[ing.item_id];
      if (entry) {
        var lineCost = ingredientLineCost(entry, ing);
        if (!lineCost.ok) {
          var err = new Error(lineCost.error);
          err.name = 'RecipeLineUnitError';
          throw err;
        }
        total += lineCost.cost;
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
 * Unit conversion (D-01/D-02): both the LOCKED-mode added-ingredient sub-sum
 * and the DYNAMIC-mode total (via computeScaledRecipeTotal) price each line
 * through the shared ingredientLineCost helper and fail closed (throw
 * RecipeLineUnitError) on a non-convertible unit pair.
 *
 * Pure function: no I/O, no require(). Never mutates input arrays or objects.
 *
 * @param {Object} recipe                  - recipe with locked_price, service_fee, materials_fee, pricing_mode
 * @param {Array}  originalIngredients     - unmodified base ingredient list (from Apps Script)
 * @param {Array}  modifiedBaseIngredients - staff-edited ingredient list at base (pre-scale) quantities
 * @param {Object} catalogMap              - { [item_id]: { rate, unit, ... } } — server-authoritative rates
 * @param {number} scaleFactor             - target_volume_l / recipe.batch_size_l
 * @param {string} saleType                - 'in-store' | 'take-out'
 * @returns {number}                       - grand total rounded to 2 decimal places
 * @throws {Error} name === 'RecipeLineUnitError' — see computeScaledRecipeTotal
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
          // Unit-convert before pricing (D-01/D-02) — fail closed on mismatch
          var addedLineCost = ingredientLineCost(catalogEntry, scaled);
          if (!addedLineCost.ok) {
            var addedErr = new Error(addedLineCost.error);
            addedErr.name = 'RecipeLineUnitError';
            throw addedErr;
          }
          total += addedLineCost.cost;
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
// classifyUnit / ingredientLineCost (D-01/D-02)
// ---------------------------------------------------------------------------

// Cost-conversion families — SEPARATE from CONTINUOUS_UNITS/DISCRETE_UNITS
// above. Those constants govern scale-ROUNDING behavior (a different axis)
// and DISCRETE_UNITS includes 'ft' (a length unit), which is not a count
// unit for cost purposes. Do not reuse them here.
//
// Factors are expressed as "canonical units per raw unit": MASS canonical
// is kg, VOLUME canonical is L. D-06: imperial units (oz/lb/tsp/tbsp/cup/
// pt/qt/gal/floz) are intentionally NOT included — the 2026-08-25 live-
// recipe audit (73-01-SUMMARY.md Task 1: all 8 recipes / 91 ingredient
// lines) found zero imperial units on any recipe cost line. An imperial
// (or any other unrecognised) unit therefore classifies with family: null
// and ingredientLineCost fails closed, naming the line, rather than
// guessing a conversion factor.
var MASS_FACTORS = { kg: 1, g: 0.001 };
var VOLUME_FACTORS = { l: 1, ml: 0.001 };
var COUNT_UNITS = ['pcs', 'ea', 'each', 'unit', 'pkg', 'pack'];

/**
 * Classify a raw unit string into a cost-conversion family.
 *
 * @param {string} raw - unit token (e.g. 'kg', ' G ', 'pcs')
 * @returns {{ family: ('mass'|'volume'|'count'|null), norm: string }}
 */
function classifyUnit(raw) {
  var norm = (raw || '').toLowerCase().trim();
  var family = null;

  if (Object.prototype.hasOwnProperty.call(MASS_FACTORS, norm)) {
    family = 'mass';
  } else if (Object.prototype.hasOwnProperty.call(VOLUME_FACTORS, norm)) {
    family = 'volume';
  } else if (COUNT_UNITS.indexOf(norm) !== -1) {
    family = 'count';
  }

  return { family: family, norm: norm };
}

/**
 * Compute the unit-converted cost of a single recipe ingredient line against
 * its server catalog entry (D-01/D-02) — the ONE shared helper every
 * aggregate sum-site must call instead of hand-rolling `qty * rate`.
 *
 * Security (T-36-01): rate is ALWAYS read from item.rate (server catalog
 * entry) — any rate field on the client/recipe-supplied `line` is ignored.
 *
 * Fails closed (ok:false, named error) when line.unit cannot convert to
 * item.unit — cross-family (e.g. count vs volume) or unrecognised/imperial
 * family (D-06) on either side. Never silently substitutes/multiplies raw
 * mismatched units.
 *
 * Pure: no I/O, no requires — callers pass in the already-fetched item/line.
 *
 * @param {Object} item - catalog entry { unit, rate, item_name|item_id, ... }
 * @param {Object} line - recipe ingredient line { unit, quantity, ... }
 * @returns {{ ok: true, convertedQty: number, cost: number }
 *          | { ok: false, error: string }}
 */
function ingredientLineCost(item, line) {
  var itemUnit = classifyUnit(item && item.unit);
  var lineUnit = classifyUnit(line && line.unit);
  var rate = Number(item && item.rate) || 0;
  var qty  = Number(line && line.quantity) || 0;

  var convertible = itemUnit.family !== null && itemUnit.family === lineUnit.family;

  if (!convertible) {
    var label = (item && (item.item_name || item.item_id)) || 'item';
    return {
      ok: false,
      error: 'Cannot price "' + label + '": recipe unit "' + (line && line.unit) +
        '" is not convertible to item unit "' + (item && item.unit) + '"'
    };
  }

  var convertedQty;
  if (itemUnit.family === 'count') {
    // Count family: pass-through, no numeric conversion between tokens
    // (e.g. pcs vs pack — D-02 scope does not attempt pack-size math).
    convertedQty = qty;
  } else {
    var factors = itemUnit.family === 'mass' ? MASS_FACTORS : VOLUME_FACTORS;
    convertedQty = qty * (factors[lineUnit.norm] / factors[itemUnit.norm]);
    convertedQty = Math.round(convertedQty * 10000) / 10000; // 4dp, prevents float drift
  }

  // 4dp intermediate rounding avoids double-rounding before the final 2dp
  // aggregate sum at each call site (Math.round(total * 100) / 100).
  var cost = Math.round(convertedQty * rate * 10000) / 10000;

  return { ok: true, convertedQty: convertedQty, cost: cost };
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
  ingredientLineCost:           ingredientLineCost,
  classifyUnit:                 classifyUnit,
  CONTINUOUS_UNITS:             CONTINUOUS_UNITS,
  DISCRETE_UNITS:               DISCRETE_UNITS
};
