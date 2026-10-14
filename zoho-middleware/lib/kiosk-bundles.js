'use strict';

/**
 * Server-owned canning bundles for the kiosk money path (Phase 90, D-11..D-16, D-22).
 *
 * A canning bundle is a flat-price line (beer 25 L = $40, cider / sparkling wine
 * 23 L = $35) paired with a $0 line carrying the actual can count, so stock is
 * decremented while the customer is charged the flat price. The server owns the
 * price, label and tax: any client rate / taxable / description on a bundle line
 * is ignored. Pure module, no I/O.
 *
 * Wire contract (what the kiosk client sends):
 *   bundle line: { custom: true, bundle_key, description, quantity: 1, rate, taxable: true }
 *   can line:    { item_id, bundle_can: true, quantity: N, rate: 0, name, sku }
 *
 * Both /api/kiosk/sale and /api/kiosk/sale/confirm call these helpers so the two
 * rebuild sites cannot drift.
 */

var STANDARD_RULE_DEFAULT = '109900000000033423';
var STANDARD_TAX_PCT = 12;

// Case-insensitive SKU -> can size (mL).
var CAN_SKUS = Object.freeze({ 'can-473': 473, 'can-355': 355 });

// nominal / cap are exported so the client copy can be pinned by a parity test.
// The server NEVER prices by can count (D-12): cap is a client-side warning only.
var BUNDLES = Object.freeze({
  'beer-25': Object.freeze({
    price: 40,
    label: 'Beer 25 L',
    nominal: Object.freeze({ 473: 52, 355: 70 }),
    cap: Object.freeze({ 473: 55, 355: 72 })
  }),
  'cider-23': Object.freeze({
    price: 35,
    label: 'Cider / sparkling wine 23 L',
    nominal: Object.freeze({ 473: 48, 355: 64 }),
    cap: Object.freeze({ 473: 50, 355: 68 })
  })
});

function isBundleLine(item) {
  return !!item && item.custom === true &&
    item.bundle_key !== undefined && item.bundle_key !== null;
}

function isBundleCanLine(item) {
  return !!item && item.bundle_can === true;
}

function hasBundleKey(key) {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(BUNDLES, key);
}

function canSizeOf(catalogItem) {
  var sku = catalogItem && typeof catalogItem.sku === 'string' ? catalogItem.sku.trim().toLowerCase() : '';
  return Object.prototype.hasOwnProperty.call(CAN_SKUS, sku) ? CAN_SKUS[sku] : null;
}

function fail(error) {
  return { status: 400, error: error };
}

/**
 * Validate the bundle-related shape of a cart. Returns null when valid (including
 * carts with no bundle at all), else { status: 400, error }.
 */
function validateBundleCart(items, catalogMap) {
  items = Array.isArray(items) ? items : [];
  catalogMap = catalogMap || {};
  var bundleLines = [];
  var canLines = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    if (!it) continue;
    if (isBundleCanLine(it)) {
      // A can line is an ordinary catalog line; it can never be a custom or gift line.
      if (it.custom || it.gift_cert) {
        return fail('Invalid canning bundle can line: it must be a catalog item.');
      }
      canLines.push(it);
    } else if (isBundleLine(it)) {
      bundleLines.push(it);
    }
  }

  if (bundleLines.length === 0 && canLines.length === 0) return null;

  if (bundleLines.length > 1) {
    return fail('Only one canning bundle is allowed per sale.');
  }
  if (bundleLines.length === 1 && !hasBundleKey(bundleLines[0].bundle_key)) {
    return fail('Unknown canning bundle.');
  }
  if (bundleLines.length === 0) {
    return fail('Cans at no charge require a canning bundle in the cart.');
  }
  if (canLines.length === 0) {
    return fail('A canning bundle needs its can count line (canning bundle can line missing).');
  }
  if (canLines.length > 1) {
    return fail('Only one canning bundle can line is allowed per sale.');
  }

  var can = canLines[0];
  var catalogItem = typeof can.item_id === 'string' ? catalogMap[can.item_id] : undefined;
  if (!catalogItem) {
    return fail('Canning bundle can item not found in catalog. Refresh and try again.');
  }
  if (canSizeOf(catalogItem) === null) {
    return fail('Canning bundle cans must be the 473 mL or 355 mL can item.');
  }
  var qty = Number(can.quantity);
  if (!isFinite(qty) || !Number.isInteger(qty) || qty < 1 || qty > 100) {
    return fail('Canning bundle can count must be a whole number from 1 to 100.');
  }
  return null;
}

/**
 * The server-priced bundle line. Ignores any client rate / taxable / description.
 * Always 12% with the standard tax_id; never the zero-rated or 5% GST tax.
 */
function buildBundleLine(item, canCatalogItem, standardTaxId) {
  var bundle = BUNDLES[item.bundle_key];
  var size = canSizeOf(canCatalogItem);
  return {
    custom: true,
    bundle_key: item.bundle_key,
    description: 'Canning Bundle — ' + bundle.label + ' (' + size + ' mL)',
    rate: bundle.price,
    quantity: 1,
    tax_percentage: STANDARD_TAX_PCT,
    tax_id: standardTaxId
  };
}

/** The $0 can line: real count (stock decrement), zero charge, catalog tax. */
function buildBundleCanLine(item, catalogItem) {
  var li = {
    item_id: item.item_id,
    name: item.name || '',
    sku: catalogItem.sku || '',
    quantity: Number(item.quantity),
    rate: 0,
    bundle_can: true
  };
  if (catalogItem.tax_id) li.tax_id = catalogItem.tax_id;
  if (catalogItem.tax_percentage !== undefined && catalogItem.tax_percentage !== null) {
    li.tax_percentage = catalogItem.tax_percentage;
  }
  return li;
}

/**
 * Standard (12%) tax_id: env ZOHO_TAX_STANDARD_ID, else the tax_id of a catalog item
 * on the standard rule (ZOHO_TAX_STANDARD_RULE, default 109900000000033423), else null
 * (caller fails closed). Never falls back to the zero-rated or services rule.
 */
function resolveStandardTaxId(catalogMap) {
  if (process.env.ZOHO_TAX_STANDARD_ID) return process.env.ZOHO_TAX_STANDARD_ID;
  var rule = process.env.ZOHO_TAX_STANDARD_RULE || STANDARD_RULE_DEFAULT;
  var ids = Object.keys(catalogMap || {});
  for (var i = 0; i < ids.length; i++) {
    var item = catalogMap[ids[i]];
    if (item && item.sales_tax_rule_id === rule && item.tax_id) return item.tax_id;
  }
  return null;
}

module.exports = {
  BUNDLES: BUNDLES,
  CAN_SKUS: CAN_SKUS,
  validateBundleCart: validateBundleCart,
  buildBundleLine: buildBundleLine,
  buildBundleCanLine: buildBundleCanLine,
  resolveStandardTaxId: resolveStandardTaxId,
  isBundleLine: isBundleLine,
  isBundleCanLine: isBundleCanLine
};
