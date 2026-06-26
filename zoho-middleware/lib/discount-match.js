'use strict';

/**
 * Shared discount product-type classifier (server-authoritative).
 *
 * Kiosk discount presets with scope 'type' carry an `applies_to` array of
 * normalized tokens describing which product types the discount targets.
 * This module turns a catalog line item into the tokens that describe it and
 * decides whether a preset's `applies_to` matches.
 *
 * Token vocabulary (two-tier):
 *   Group tokens : 'kit', 'ingredient', 'service', 'recipe'
 *   Leaf tokens  : 'kit:wine' | 'kit:beer' | 'kit:cider' | 'kit:seltzer'
 *                  'ingredient:hops' | 'ingredient:grain' | 'ingredient:yeast'
 *                  'ingredient:additive' | 'ingredient:packaging'
 *                  'ingredient:equipment' | 'ingredient:cleaning'
 *
 * A line matches when `applies_to` contains its GROUP token OR one of its LEAF
 * tokens. "All Kits" is stored as the group token 'kit' (so it also catches
 * kits with an unexpected cf_type); specific picks store leaf tokens.
 *
 * Mirrored on the frontend in js/lib/discount-match.js — keep the two in sync.
 *
 * Pure module: no I/O, no requires beyond constants.
 */

// ['wine','beer','cider','seltzer'] — fall back to a literal if constants is
// partially mocked (some test suites stub ./constants without KIT_CATEGORIES).
var KIT_CATEGORIES = require('./constants').KIT_CATEGORIES || ['wine', 'beer', 'cider', 'seltzer'];

// Canonical ingredient leaf suffixes
var INGREDIENT_SUBCATS = ['hops', 'grain', 'yeast', 'additive', 'packaging', 'equipment', 'cleaning'];

// Raw cf_subcategory (lowercased) -> canonical ingredient leaf suffix.
// Mirrors the spirit of CATEGORY_DISPLAY_NAMES grouping on the frontend.
var SUBCAT_ALIASES = {
  'hops': 'hops',
  'grain': 'grain',
  'grains': 'grain',
  'yeast': 'yeast',
  'additive': 'additive',
  'additives': 'additive',
  'bottle': 'packaging',
  'bag': 'packaging',
  'packaging': 'packaging',
  'fermenter': 'equipment',
  'equipment': 'equipment',
  'hose': 'equipment',
  'tubing': 'equipment',
  'hose/tubing': 'equipment',
  'cleaning/sanitization': 'cleaning',
  'cleaning': 'cleaning',
  'sanitization': 'cleaning'
};

// Full allowlist of valid applies_to tokens (used by preset validation)
var ALL_TOKENS = (function () {
  var t = ['kit', 'ingredient', 'service', 'recipe'];
  KIT_CATEGORIES.forEach(function (k) { t.push('kit:' + k); });
  INGREDIENT_SUBCATS.forEach(function (s) { t.push('ingredient:' + s); });
  return t;
})();

/**
 * Read a catalog item's ingredient subcategory, tolerating both the flattened
 * `cf_subcategory` field and the raw Zoho custom_fields array.
 */
function readSubcategory(item) {
  if (!item) return '';
  if (item.cf_subcategory) return String(item.cf_subcategory);
  if (item.subcategory) return String(item.subcategory);
  var cfs = item.custom_fields || [];
  for (var i = 0; i < cfs.length; i++) {
    var label = (cfs[i].label || '').toLowerCase();
    if (label === 'subcategory') return String(cfs[i].value || '');
  }
  return '';
}

/**
 * Normalize a raw subcategory string to a canonical ingredient leaf suffix,
 * or '' when it cannot be resolved.
 */
function normalizeIngredientSubcat(raw) {
  var key = (raw || '').toLowerCase().trim();
  if (!key) return '';
  return SUBCAT_ALIASES[key] || '';
}

/**
 * Classify a catalog line item into the tokens that describe it.
 * Returns [] for things that no discount-type token should match
 * (e.g. consignment, synthetic recipe/fee lines that never reach this path).
 *
 * @param {Object} item - catalog entry (kiosk-products or ingredients catalog)
 * @returns {string[]}  - group + leaf tokens, e.g. ['kit','kit:wine']
 */
function classifyCatalogItem(item) {
  if (!item) return [];
  var ptype = (item.product_type || '').toLowerCase();
  if (ptype === 'service') return ['service'];

  var cfType = (item.cf_type || '').toLowerCase();
  if (KIT_CATEGORIES.indexOf(cfType) !== -1) return ['kit', 'kit:' + cfType];

  if (cfType === 'ingredient' || ptype === 'inventory' || ptype === 'goods') {
    var leaf = normalizeIngredientSubcat(readSubcategory(item));
    return leaf ? ['ingredient', 'ingredient:' + leaf] : ['ingredient'];
  }

  return [];
}

/**
 * Does a preset's applies_to target this line's tokens?
 * @param {string[]} tokens    - output of classifyCatalogItem
 * @param {string[]} appliesTo - preset.applies_to
 */
function matches(tokens, appliesTo) {
  if (!tokens || !tokens.length || !appliesTo || !appliesTo.length) return false;
  for (var i = 0; i < tokens.length; i++) {
    if (appliesTo.indexOf(tokens[i]) !== -1) return true;
  }
  return false;
}

/**
 * Validate an applies_to array: must be a non-empty array of known tokens.
 * @returns {string[]} list of error strings (empty when valid)
 */
function validateAppliesTo(appliesTo) {
  var errors = [];
  if (!Array.isArray(appliesTo) || appliesTo.length === 0) {
    errors.push('applies_to must be a non-empty array when scope is "type"');
    return errors;
  }
  for (var i = 0; i < appliesTo.length; i++) {
    if (ALL_TOKENS.indexOf(appliesTo[i]) === -1) {
      errors.push('applies_to contains unknown token: ' + appliesTo[i]);
    }
  }
  return errors;
}

module.exports = {
  ALL_TOKENS: ALL_TOKENS,
  INGREDIENT_SUBCATS: INGREDIENT_SUBCATS,
  readSubcategory: readSubcategory,
  normalizeIngredientSubcat: normalizeIngredientSubcat,
  classifyCatalogItem: classifyCatalogItem,
  matches: matches,
  validateAppliesTo: validateAppliesTo
};
