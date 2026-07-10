'use strict';

// Regression coverage for injectProductSchema — the dedupe lookup builds a CSS
// attribute selector from product data. When a SKU-less product's name contains
// characters that are special inside a selector (notably a double-quote, e.g.
// inch marks: Muslin Strainer Bags (5" x 15")), a naive string-concatenated
// selector is malformed and querySelector throws a SyntaxError. That throw
// bubbled out of renderIngredientSection -> renderIngredients and was swallowed
// by loadIngredients' .catch(), which painted the "Couldn't load products"
// error banner even though 200 items were already in memory. See PROD incident.

const { injectProductSchema } = require('../../js/modules/02-utils');

describe('injectProductSchema — selector safety', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
  });

  test('does NOT throw for a SKU-less product whose name contains double quotes', () => {
    const product = {
      name: 'Muslin Strainer Bags (5" x 15")',
      price_per_unit: '4.99',
      stock: '12'
    };
    expect(() => injectProductSchema(product, 'ingredient')).not.toThrow();
    const scripts = document.head.querySelectorAll('script[data-schema-sku]');
    expect(scripts.length).toBe(1);
  });

  test('dedupes a quote-containing name on repeat injection (no duplicate, no throw)', () => {
    const product = {
      name: 'Blow-off Tube 1" ID',
      price_per_unit: '2.50',
      stock: '5'
    };
    injectProductSchema(product, 'ingredient');
    injectProductSchema(product, 'ingredient');
    const scripts = document.head.querySelectorAll('script[data-schema-sku]');
    expect(scripts.length).toBe(1);
  });

  test('still injects and dedupes normal SKU-based products', () => {
    const product = { name: 'Cascade Hops', sku: 'HOP-CAS-001', price_per_unit: '3.25', stock: '20' };
    injectProductSchema(product, 'ingredient');
    injectProductSchema(product, 'ingredient');
    const scripts = document.head.querySelectorAll('script[data-schema-sku="HOP-CAS-001"]');
    expect(scripts.length).toBe(1);
  });

  test('handles backslashes and brackets in a SKU-less name without throwing', () => {
    const product = { name: 'Odd \\ Name [x] "q"', price_per_unit: '1.00', stock: '3' };
    expect(() => injectProductSchema(product, 'ingredient')).not.toThrow();
    expect(document.head.querySelectorAll('script[data-schema-sku]').length).toBe(1);
  });
});
