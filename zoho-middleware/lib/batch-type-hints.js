'use strict';

/**
 * Phase 94 batch-type hint helpers. They resolve the I/O-backed inputs that the pure
 * batch-rules.classifyBatchType consumes (D-05): the Zoho cf_type from the Redis kiosk-products
 * cache (keyed by SKU / item_id only, never by name), and the recipe / schedule rows by id.
 *
 * Failure model (D-07): a cold or absent cache is "no hint" and never throws, so batch create
 * is never blocked on type. DB helpers take the caller's client and let infrastructure errors
 * propagate so the caller's transaction rolls back (pg-layer convention).
 *
 * Deliberately does NOT require ./cache or ./constants at top level (route tests partially mock
 * constants); they are required lazily.
 */

var log = require('./logger');

var RECIPE_TYPE_SQL = 'select beer_category, style from recipes where recipe_id = $1';
var SCHEDULE_CATEGORY_SQL = 'select category from ferm_schedules where schedule_id = $1';

function cache() { return require('./cache'); }
function constants() { return require('./constants'); }

function str(v) { return v === null || v === undefined ? '' : String(v); }

async function readKioskProducts() {
  try {
    var list = await cache().get(constants().CACHE_KEYS.KIOSK_PRODUCTS);
    return Array.isArray(list) ? list : null;
  } catch (e) {
    log.warn('[batch-type-hints] kiosk cache read failed');
    return null;
  }
}

async function zohoTypeHint(sku) {
  var key = str(sku).trim();
  if (!key) return null;
  var list = await readKioskProducts();
  if (!list) return null;
  for (var i = 0; i < list.length; i++) {
    var p = list[i];
    if (!p) continue;
    if (str(p.sku).trim() === key || str(p.item_id).trim() === key) {
      var cf = str(p.cf_type).trim().toLowerCase();
      return cf ? { cfType: cf } : null;
    }
  }
  return null;
}

async function kioskProductIndex() {
  var index = {};
  var list = await readKioskProducts();
  if (!list) return index;
  list.forEach(function (p) {
    if (!p) return;
    var entry = {
      cf_type: str(p.cf_type),
      cf_subcategory: str(p.cf_subcategory),
      brand: str(p.brand),
      manufacturer: str(p.manufacturer)
    };
    var sku = str(p.sku).trim();
    var itemId = str(p.item_id).trim();
    if (sku) index[sku] = entry;
    if (itemId) index[itemId] = entry;
  });
  return index;
}

async function recipeTypeHint(client, recipeId) {
  var id = str(recipeId).trim();
  if (!id) return null;
  var res = await client.query(RECIPE_TYPE_SQL, [id]);
  if (!res.rows || !res.rows.length) return null;
  var row = res.rows[0];
  return { beerCategory: row.beer_category || '', style: row.style || '' };
}

async function scheduleCategoryHint(client, scheduleId) {
  var id = str(scheduleId).trim();
  if (!id) return '';
  var res = await client.query(SCHEDULE_CATEGORY_SQL, [id]);
  if (!res.rows || !res.rows.length) return '';
  return str(res.rows[0].category).trim().toLowerCase();
}

module.exports = {
  zohoTypeHint: zohoTypeHint,
  kioskProductIndex: kioskProductIndex,
  recipeTypeHint: recipeTypeHint,
  scheduleCategoryHint: scheduleCategoryHint
};
