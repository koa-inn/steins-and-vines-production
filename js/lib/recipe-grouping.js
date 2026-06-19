// ===== Steins & Vines — Recipe Ingredient Grouping =====
// Shared helper consumed by admin, kiosk, and BrewPad recipe views (D-09).
// Load AFTER js/lib/constants.js (needs CATEGORY_DISPLAY_NAMES) and js/lib/utils.js.
//
// In-browser: CATEGORY_DISPLAY_NAMES is a global from js/lib/constants.js.
// In Jest: populated via global.CATEGORY_DISPLAY_NAMES = require('./constants.js').CATEGORY_DISPLAY_NAMES.

// ---------------------------------------------------------------------------
// Section ordering authority (D-03)
// Defines brewing-process order for sections; 'Other' always last (D-06).
// ---------------------------------------------------------------------------
var SECTION_ORDER = ['Grain', 'Hops', 'Yeast', 'Additive', 'Packaging', 'Equipment', 'Cleaning/Sanitization'];

// ---------------------------------------------------------------------------
// Label map resolution
// ---------------------------------------------------------------------------

// Resolve CATEGORY_DISPLAY_NAMES for both browser (global) and Jest (require).
// In-browser: loaded as global var by js/lib/constants.js before this module.
// In Jest: caller sets global.CATEGORY_DISPLAY_NAMES = require('./constants.js').CATEGORY_DISPLAY_NAMES.
var _labelMap = (function () {
  if (typeof module !== 'undefined' && module.exports) {
    // Node / Jest context — require constants to get the map
    try { return require('./constants.js').CATEGORY_DISPLAY_NAMES; } catch (e) {}
  }
  // Browser context — global set by constants.js script tag
  if (typeof CATEGORY_DISPLAY_NAMES !== 'undefined') return CATEGORY_DISPLAY_NAMES;
  return {};
}());

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns a non-empty string or null (treats '' as absent).
 * @param {*} val
 * @returns {string|null}
 */
function nonEmpty(val) {
  return (val && typeof val === 'string' && val.trim() !== '') ? val : null;
}

/**
 * Returns the friendly display label for a raw key, falling back to the raw key.
 * @param {string} raw
 * @returns {string}
 */
function resolveLabel(raw) {
  var map = (typeof CATEGORY_DISPLAY_NAMES !== 'undefined') ? CATEGORY_DISPLAY_NAMES : _labelMap;
  return (map && map[raw]) || raw || 'Other';
}

/**
 * Returns the SECTION_ORDER index of a raw key; returns Infinity for unknown keys.
 * @param {string} raw
 * @returns {number}
 */
function sectionIndex(raw) {
  var idx = SECTION_ORDER.indexOf(raw);
  return idx === -1 ? Infinity : idx;
}

// ---------------------------------------------------------------------------
// groupRecipeIngredients
// ---------------------------------------------------------------------------

/**
 * Groups an array of recipe ingredient objects by type for display (D-01..D-07, D-11).
 *
 * Return shape:
 *   Array of { label: string, count: number, items: [ingredient] }
 *
 * Rules:
 *   D-07: Cold-cache — if NO ingredient has cf_type or cf_subcategory, return one
 *         flat group with label '' containing all ingredients in original order.
 *   D-01: Group top-level by cf_type.
 *   D-02: Nest by cf_subcategory ONLY when a cf_type has 2+ distinct subcategories.
 *   D-03: Emit sections in SECTION_ORDER (Grain→Hops→Yeast→Additive→Packaging→Equipment→…).
 *   D-05: Within each section, preserve recipe-entry (input array) order.
 *   D-06: Ingredients with no resolvable cf_type/cf_subcategory → 'Other' section, last.
 *   D-11: Each emitted group carries count = items.length.
 *   D-04: Section labels run through CATEGORY_DISPLAY_NAMES.
 *
 * @param {Array} ingredients - flat array of recipe ingredient objects
 * @returns {Array} array of group objects { label, count, items }
 */
function groupRecipeIngredients(ingredients) {
  if (!ingredients || !ingredients.length) return [];

  // D-07: Cold-cache check — if no ingredient has any cf_type or cf_subcategory,
  // return a single flat group so surfaces render their existing flat list.
  var anyEnriched = false;
  for (var ci = 0; ci < ingredients.length; ci++) {
    if (nonEmpty(ingredients[ci].cf_type) || nonEmpty(ingredients[ci].cf_subcategory)) {
      anyEnriched = true;
      break;
    }
  }
  if (!anyEnriched) {
    return [{ label: '', count: ingredients.length, items: ingredients.slice() }];
  }

  // --- Bucket by cf_type, then by cf_subcategory within each type ---

  // typeMap: { cf_type|'Other' => { subcatMap: { cf_subcategory|'Other' => [ingredients] } } }
  var typeOrder = []; // preserves insertion order for 'Other' at type level
  var typeMap = {};

  for (var i = 0; i < ingredients.length; i++) {
    var ing = ingredients[i];
    var rawType = nonEmpty(ing.cf_type) || 'Other';
    var rawSubcat = nonEmpty(ing.cf_subcategory) || 'Other';

    if (!typeMap[rawType]) {
      typeMap[rawType] = { subcatMap: {}, subcatOrder: [] };
      typeOrder.push(rawType);
    }
    var bucket = typeMap[rawType];

    if (!bucket.subcatMap[rawSubcat]) {
      bucket.subcatMap[rawSubcat] = [];
      bucket.subcatOrder.push(rawSubcat);
    }
    bucket.subcatMap[rawSubcat].push(ing);
  }

  // --- Build sections ---
  // Each section has a rawKey used for SECTION_ORDER lookup and a label.

  var namedSections = []; // { rawKey, label, items }
  var otherItems = [];    // D-06: ingredients going into 'Other' last

  for (var ti = 0; ti < typeOrder.length; ti++) {
    var rawType2 = typeOrder[ti];
    var bucket2 = typeMap[rawType2];
    var distinctSubcats = bucket2.subcatOrder; // subcategories seen for this type

    // Decide if we need to nest (D-02): nest only when 2+ distinct subcats
    // BUT 'Other' subcat (from missing cf_subcategory) is still a distinct bucket —
    // only count non-'Other' subcats for the "2+ distinct" check, per intent.
    // However to keep it simple: if ALL items have subcat 'Other', that means
    // cf_subcategory was missing for this cf_type → emit flat under cf_type.
    var realSubcats = distinctSubcats.filter(function (s) { return s !== 'Other'; });
    var shouldNest = realSubcats.length >= 2;

    if (!shouldNest) {
      // Flat emission: all items under rawType, except for rawType 'Other' — those go to otherItems
      var allItems = [];
      for (var si2 = 0; si2 < distinctSubcats.length; si2++) {
        var sc2 = distinctSubcats[si2];
        allItems = allItems.concat(bucket2.subcatMap[sc2]);
      }

      if (rawType2 === 'Other') {
        otherItems = otherItems.concat(allItems);
      } else {
        namedSections.push({ rawKey: rawType2, label: resolveLabel(rawType2), items: allItems });
      }
    } else {
      // Nested emission: one section per subcategory in SECTION_ORDER order (D-03)
      // Real subcats (non-Other) sorted by SECTION_ORDER
      var sortedRealSubcats = realSubcats.slice().sort(function (a, b) {
        return sectionIndex(a) - sectionIndex(b);
      });
      for (var ri = 0; ri < sortedRealSubcats.length; ri++) {
        var sc3 = sortedRealSubcats[ri];
        namedSections.push({ rawKey: sc3, label: resolveLabel(sc3), items: bucket2.subcatMap[sc3] });
      }
      // Any 'Other' subcat items within this nested type go to otherItems (D-06)
      if (bucket2.subcatMap['Other']) {
        otherItems = otherItems.concat(bucket2.subcatMap['Other']);
      }
    }
  }

  // --- Sort namedSections by SECTION_ORDER (D-03) ---
  namedSections.sort(function (a, b) {
    return sectionIndex(a.rawKey) - sectionIndex(b.rawKey);
  });

  // --- Build final output (D-11: count per group) ---
  var result = namedSections.map(function (sec) {
    return { label: sec.label, count: sec.items.length, items: sec.items };
  });

  // D-06: 'Other' always last
  if (otherItems.length > 0) {
    result.push({ label: 'Other', count: otherItems.length, items: otherItems });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Module export (Jest-compatible; browser uses global function)
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    groupRecipeIngredients: groupRecipeIngredients,
    SECTION_ORDER: SECTION_ORDER
  };
}
