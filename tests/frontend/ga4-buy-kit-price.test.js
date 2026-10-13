'use strict';

// Regression: a Buy Kit click passes a 'kit-purchase' clone to ga4AddToCart
// (07-catalog-kits.js renderKitBuyControl). The clone keeps retail_instore, and
// ga4AddToCart read retail_instore first, so GA4 add_to_cart reported the
// ferment-in-store price (rate + fees) instead of the kit-only price the cart
// line and the server actually use. Same class of bug as 7eb2b0f8.
const { ga4AddToCart } = require('../../js/modules/03-events');

beforeEach(() => {
  window.dataLayer = [];
});

describe('ga4AddToCart for a Buy Kit (kit-purchase) line', () => {
  test('reports the kit-only price, not the in-store price', () => {
    ga4AddToCart({
      sku: 'KIT-1', name: 'Merlot Kit', _item_type: 'kit-purchase',
      retail_instore: '$240.00', retail_kit: '$190.00', price: '$190.00'
    }, 1);
    const ev = window.dataLayer[1];
    expect(ev.ecommerce.value).toBe(190);
    expect(ev.ecommerce.items[0].price).toBe(190);
  });

  test('an ordinary ferment-in-store kit still reports the in-store price', () => {
    ga4AddToCart({
      sku: 'KIT-1', name: 'Merlot Kit',
      retail_instore: '$240.00', retail_kit: '$190.00'
    }, 1);
    expect(window.dataLayer[1].ecommerce.value).toBe(240);
  });
});
