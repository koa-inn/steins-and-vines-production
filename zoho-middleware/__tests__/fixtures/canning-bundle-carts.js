'use strict';

// Shared canning-bundle cart fixtures (Phase 90, Plan 90-02).
//
// CATALOG is the kiosk catalog the server prices against; CARTS are wire-format
// carts (exactly what the kiosk client sends) with the SERVER-computed expected
// numbers as literals. Plan 90-07's client parity test requires this file and
// asserts the client reproduces the same numbers.
//
// expected.subtotal is the post-discount, pre-tax subtotal (what the server
// calls `subtotal` after resolveDiscount); expected.discount is the total cart
// discount in dollars. total = subtotal + tax.

var CAN_473_ID = '109900000001175056';
var CAN_355_ID = '109900000001175045';
var STANDARD_TAX_ID = '109900000000029101';
var STANDARD_RULE = '109900000000033423';
var ZERO_RULE = '109900000000033411';

var CATALOG = [
  // Zero-rated item FIRST so a naive "first item with a tax_id" lookup would pick the wrong tax.
  {
    item_id: 'kit-zero-ingredient',
    name: 'Ingredient Kit (zero-rated)',
    sku: 'kit-zero',
    rate: 80,
    stock_on_hand: 10,
    tax_id: 'tax-zero-0',
    sales_tax_rule_id: ZERO_RULE,
    tax_percentage: 0,
    custom_fields: []
  },
  {
    item_id: CAN_473_ID,
    name: 'Aluminium can 473 mL',
    sku: 'can-473',
    rate: 0.5,
    stock_on_hand: 5000,
    tax_id: STANDARD_TAX_ID,
    sales_tax_rule_id: STANDARD_RULE,
    tax_percentage: 12,
    custom_fields: []
  },
  {
    item_id: CAN_355_ID,
    name: 'Aluminium can 355 mL',
    sku: 'can-355',
    rate: 0.45,
    stock_on_hand: 5000,
    tax_id: STANDARD_TAX_ID,
    sales_tax_rule_id: STANDARD_RULE,
    tax_percentage: 12,
    custom_fields: []
  },
  {
    item_id: 'kit-fee-12',
    name: "Maker's Fee",
    sku: 'fee-12',
    rate: 50,
    stock_on_hand: 100,
    tax_id: STANDARD_TAX_ID,
    sales_tax_rule_id: STANDARD_RULE,
    tax_percentage: 12,
    custom_fields: []
  },
  {
    item_id: 'item-gst',
    name: 'Services item (5% GST)',
    sku: 'svc-5',
    rate: 20,
    stock_on_hand: 100,
    tax_id: 'tax-gst-5',
    sales_tax_rule_id: '109900000000033417',
    tax_percentage: 5,
    custom_fields: []
  }
];

// Wire-format lines. The bundle line deliberately carries a display price; the
// server ignores it (D-22).
function bundleLine(key, price, desc) {
  return { custom: true, bundle_key: key, description: desc, quantity: 1, rate: price, taxable: true };
}
function canLine(itemId, qty, sku) {
  return { item_id: itemId, bundle_can: true, quantity: qty, rate: 0, name: 'Can ' + sku, sku: sku };
}

var CARTS = [
  {
    name: 'beer-25 + 52 x can-473',
    items: [
      bundleLine('beer-25', 40, 'Canning Bundle — Beer 25 L (473 mL)'),
      canLine(CAN_473_ID, 52, 'can-473')
    ],
    expected: { subtotal: 40.00, tax: 4.80, total: 44.80, discount: 0 }
  },
  {
    name: 'cider-23 + 64 x can-355',
    items: [
      bundleLine('cider-23', 35, 'Canning Bundle — Cider / sparkling wine 23 L (355 mL)'),
      canLine(CAN_355_ID, 64, 'can-355')
    ],
    expected: { subtotal: 35.00, tax: 4.20, total: 39.20, discount: 0 }
  },
  {
    // Bundle keys FIRST (as the client inserts them), then the $0 can line, a 0% kit and a 12% fee.
    // Fixed cart discount $10.00 (scope cart): the bundle (custom) is excluded (D-14); discountable
    // base = can 0 + kit 80 + fee 50 = 130. Shares: can 0.00, kit 6.15, fee (remainder) 3.85.
    // Tax: 12% group = (40 + 46.15) * 0.12 = 10.338 -> 10.34; 0% group = 0.
    name: 'beer-25 + 52 x can-473 + 0% kit + 12% fee, fixed $10 cart discount',
    items: [
      bundleLine('beer-25', 40, 'Canning Bundle — Beer 25 L (473 mL)'),
      canLine(CAN_473_ID, 52, 'can-473'),
      { item_id: 'kit-zero-ingredient', quantity: 1, rate: 80, name: 'Ingredient Kit (zero-rated)', sku: 'kit-zero' },
      { item_id: 'kit-fee-12', quantity: 1, rate: 50, name: "Maker's Fee", sku: 'fee-12' }
    ],
    discount: { preset_id: 'preset-fixed-10' },
    expected: { subtotal: 160.00, tax: 10.34, total: 170.34, discount: 10.00 }
  }
];

var DISCOUNT_PRESETS = [
  { id: 'preset-fixed-10', name: 'Ten off', active: true, scope: 'cart', type: 'fixed', value: 10 }
];

module.exports = {
  CAN_473_ID: CAN_473_ID,
  CAN_355_ID: CAN_355_ID,
  STANDARD_TAX_ID: STANDARD_TAX_ID,
  CATALOG: CATALOG,
  CARTS: CARTS,
  DISCOUNT_PRESETS: DISCOUNT_PRESETS
};
