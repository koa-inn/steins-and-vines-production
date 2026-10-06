'use strict';

// "Buy Kit" must put the KIT-ONLY price in the cart (reported 2026-10-03,
// reproduced on wine.html: New Zealand Style Sauvignon Blanc showed
// "Kit only $190.00" but Buy Kit added it at $240.00).
//
// renderKitBuyControl (07-catalog-kits.js) builds a 'kit-purchase' clone with
// price = retail_kit, but setReservationQty read retail_instore FIRST, so the
// ferment-in-store price won. The browser charges the cart total via
// /api/payment/initialize while /api/checkout books the Zoho catalog rate
// (= the kit-only price, routes/catalog.js retail_kit = rate,
// retail_instore = rate + 50) and lets the overpayment through — a $50
// overcharge per kit that never reaches the books.

global.SHEETS_CONFIG = { SPREADSHEET_ID: 'test', MIDDLEWARE_URL: '' };
global.navigator = global.navigator || {};
global.navigator.vibrate = jest.fn();

var cart = require('../../js/modules/11-cart');

var FERMENT_KEY = 'sv-cart-ferment';
var INGREDIENT_KEY = 'sv-cart-ingredients';

// The product record as the catalogue holds it (live data, 2026-10-03).
function nzSauvBlanc() {
  return {
    name: 'New Zealand Style Sauvignon Blanc',
    brand: 'RJS',
    sku: '80087761',
    retail_kit: '$190.00',
    retail_instore: '$240.00',
    item_id: 'zoho-80087761'
  };
}

// Exactly what renderKitBuyControl hands to setReservationQty.
function buyKitClone(product) {
  var kitProduct = {};
  for (var k in product) {
    if (Object.prototype.hasOwnProperty.call(product, k)) kitProduct[k] = product[k];
  }
  kitProduct._item_type = 'kit-purchase';
  kitProduct.price = product.retail_kit || product.retail_instore || product.price || '';
  return kitProduct;
}

beforeEach(function () {
  localStorage.clear();
  jest.clearAllMocks();
});

describe('Buy Kit (kit-purchase) cart price', function () {
  test('Buy Kit lands the kit-only price ($190), not the ferment-in-store price ($240)', function () {
    cart.setReservationQty(buyKitClone(nzSauvBlanc()), 1);
    var line = cart.getReservation(INGREDIENT_KEY)[0];
    expect(line.item_type).toBe('kit-purchase');
    expect(line.price).toBe('$190.00');
  });

  test('ferment-in-store reservation of the same kit still uses $240', function () {
    cart.setReservationQty(nzSauvBlanc(), 1);
    var line = cart.getReservation(FERMENT_KEY)[0];
    expect(line.item_type).toBe('kit');
    expect(line.price).toBe('$240.00');
  });

  test('a stale $240 kit-purchase line is repriced when its quantity changes', function () {
    cart.saveReservation([{
      name: 'New Zealand Style Sauvignon Blanc', brand: 'RJS', sku: '80087761',
      price: '$240.00', qty: 1, item_type: 'kit-purchase'
    }], INGREDIENT_KEY);
    cart.setReservationQty(buyKitClone(nzSauvBlanc()), 2);
    var line = cart.getReservation(INGREDIENT_KEY)[0];
    expect(line.qty).toBe(2);
    expect(line.price).toBe('$190.00');
  });

  test('kit-purchase without retail_kit falls back to its own price', function () {
    var p = nzSauvBlanc();
    delete p.retail_kit;
    var clone = buyKitClone(p);
    clone.price = '$199.00';
    cart.setReservationQty(clone, 1);
    expect(cart.getReservation(INGREDIENT_KEY)[0].price).toBe('$199.00');
  });
});
