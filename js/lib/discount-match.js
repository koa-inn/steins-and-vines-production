// ===== Steins & Vines — Discount product-type classifier (frontend mirror) =====
// Mirror of zoho-middleware/lib/discount-match.js. The server is authoritative
// for the charged amount; this copy only powers the kiosk cart PREVIEW and the
// discount setup UI. Keep the two files in sync.
//
// Load order: AFTER js/lib/constants.js (depends on the global KIT_CATEGORIES).

// Canonical ingredient leaf suffixes
var DISCOUNT_INGREDIENT_SUBCATS = ['hops', 'grain', 'yeast', 'additive', 'packaging', 'equipment', 'cleaning'];

// Raw cf_subcategory (lowercased) -> canonical ingredient leaf suffix
var DISCOUNT_SUBCAT_ALIASES = {
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

// Full allowlist of valid applies_to tokens
var DISCOUNT_ALL_TOKENS = (function () {
  var kitCats = (typeof KIT_CATEGORIES !== 'undefined') ? KIT_CATEGORIES : ['wine', 'beer', 'cider', 'seltzer'];
  var t = ['kit', 'ingredient', 'service', 'recipe'];
  kitCats.forEach(function (k) { t.push('kit:' + k); });
  DISCOUNT_INGREDIENT_SUBCATS.forEach(function (s) { t.push('ingredient:' + s); });
  return t;
})();

function discountReadSubcategory(item) {
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

function discountNormalizeSubcat(raw) {
  var key = (raw || '').toLowerCase().trim();
  if (!key) return '';
  return DISCOUNT_SUBCAT_ALIASES[key] || '';
}

// Classify a cart line item (entry.item) into group + leaf tokens.
function classifyDiscountItem(item) {
  if (!item) return [];
  var ptype = (item.product_type || '').toLowerCase();
  if (ptype === 'service') return ['service'];

  var kitCats = (typeof KIT_CATEGORIES !== 'undefined') ? KIT_CATEGORIES : ['wine', 'beer', 'cider', 'seltzer'];
  var cfType = (item.cf_type || '').toLowerCase();
  if (kitCats.indexOf(cfType) !== -1) return ['kit', 'kit:' + cfType];

  if (cfType === 'ingredient' || ptype === 'inventory' || ptype === 'goods') {
    var leaf = discountNormalizeSubcat(discountReadSubcategory(item));
    return leaf ? ['ingredient', 'ingredient:' + leaf] : ['ingredient'];
  }

  return [];
}

function discountMatches(tokens, appliesTo) {
  if (!tokens || !tokens.length || !appliesTo || !appliesTo.length) return false;
  for (var i = 0; i < tokens.length; i++) {
    if (appliesTo.indexOf(tokens[i]) !== -1) return true;
  }
  return false;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DISCOUNT_ALL_TOKENS: DISCOUNT_ALL_TOKENS,
    DISCOUNT_INGREDIENT_SUBCATS: DISCOUNT_INGREDIENT_SUBCATS,
    discountReadSubcategory: discountReadSubcategory,
    discountNormalizeSubcat: discountNormalizeSubcat,
    classifyDiscountItem: classifyDiscountItem,
    discountMatches: discountMatches
  };
}
