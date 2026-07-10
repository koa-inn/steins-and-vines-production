'use strict';

// GA4 ecommerce dataLayer helpers live in 03-events.js. They mirror cart and
// checkout actions into the GTM dataLayer so GA4 can report revenue and funnel.
const events = require('../../js/modules/03-events');
const {
  pushEcommerce,
  toGa4Items,
  ga4AddToCart,
  ga4BeginCheckout,
  ga4Purchase,
} = events;

beforeEach(() => {
  window.dataLayer = [];
});

describe('pushEcommerce', () => {
  test('clears the previous ecommerce object then pushes the event', () => {
    pushEcommerce('add_to_cart', { currency: 'CAD', value: 5, items: [] });
    expect(window.dataLayer.length).toBe(2);
    expect(window.dataLayer[0]).toEqual({ ecommerce: null });
    expect(window.dataLayer[1].event).toBe('add_to_cart');
    expect(window.dataLayer[1].ecommerce.currency).toBe('CAD');
  });
});

describe('toGa4Items', () => {
  test('maps cart items to GA4 item objects and strips currency symbols from price', () => {
    const items = toGa4Items([
      { sku: 'MERLOT', name: 'Merlot Kit', price: '$49.00', qty: 2, item_type: 'kit' },
    ]);
    expect(items).toEqual([
      { item_id: 'MERLOT', item_name: 'Merlot Kit', item_category: 'kit', price: 49, quantity: 2 },
    ]);
  });

  test('applies category override and falls back for id and quantity', () => {
    const items = toGa4Items([{ name: 'Cascade Hops', price: 3.5 }], 'Ingredients & Supplies');
    expect(items[0].item_category).toBe('Ingredients & Supplies');
    expect(items[0].item_id).toBe('Cascade Hops');
    expect(items[0].quantity).toBe(1);
  });

  test('preserves fractional (weight) quantities', () => {
    const items = toGa4Items([{ sku: 'GRAIN', name: 'Pale Malt', price: 4, qty: 0.5 }]);
    expect(items[0].quantity).toBe(0.5);
  });

  test('returns an empty array for empty or undefined input', () => {
    expect(toGa4Items()).toEqual([]);
    expect(toGa4Items([])).toEqual([]);
  });
});

describe('ga4AddToCart', () => {
  test('pushes add_to_cart with CAD value equal to price times quantity', () => {
    ga4AddToCart({ sku: 'GRAIN', name: 'Pale Malt', price: '10.00', _item_type: 'ingredient' }, 3);
    const ev = window.dataLayer[1];
    expect(ev.event).toBe('add_to_cart');
    expect(ev.ecommerce.currency).toBe('CAD');
    expect(ev.ecommerce.value).toBe(30);
    expect(ev.ecommerce.items[0]).toEqual({
      item_id: 'GRAIN', item_name: 'Pale Malt', item_category: 'ingredient', price: 10, quantity: 3,
    });
  });

  test('is a no-op when product is missing', () => {
    ga4AddToCart(null, 1);
    expect(window.dataLayer.length).toBe(0);
  });
});

describe('ga4BeginCheckout', () => {
  test('pushes begin_checkout with items and rounded value', () => {
    ga4BeginCheckout([{ sku: 'A', name: 'A', price: 5, qty: 2 }], 10);
    const ev = window.dataLayer[1];
    expect(ev.event).toBe('begin_checkout');
    expect(ev.ecommerce.value).toBe(10);
    expect(ev.ecommerce.items.length).toBe(1);
  });
});

describe('ga4Purchase', () => {
  test('pushes purchase with transaction_id, value, tax and CAD currency', () => {
    ga4Purchase('SO-1001', 55.25, 5.25, [{ item_id: 'A', item_name: 'A', price: 50, quantity: 1 }]);
    const ev = window.dataLayer[1];
    expect(ev.event).toBe('purchase');
    expect(ev.ecommerce.transaction_id).toBe('SO-1001');
    expect(ev.ecommerce.value).toBe(55.25);
    expect(ev.ecommerce.tax).toBe(5.25);
    expect(ev.ecommerce.currency).toBe('CAD');
  });

  test('never double-fires for the same transaction id', () => {
    ga4Purchase('SO-2002', 20, null, []);
    ga4Purchase('SO-2002', 20, null, []);
    const purchases = window.dataLayer.filter(
      (d) => d.event === 'purchase' && d.ecommerce && d.ecommerce.transaction_id === 'SO-2002',
    );
    expect(purchases.length).toBe(1);
  });

  test('ignores an empty transaction id', () => {
    ga4Purchase('', 20, null, []);
    expect(window.dataLayer.length).toBe(0);
  });

  test('omits tax when null', () => {
    ga4Purchase('SO-3003', 20, null, []);
    expect(window.dataLayer[1].ecommerce.tax).toBeUndefined();
  });
});
