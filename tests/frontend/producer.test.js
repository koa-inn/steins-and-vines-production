'use strict';

// ---------------------------------------------------------------------------
// producer.test.js
//
// Tests the producer display logic and filter system added in Phase 11 Plan 02.
//
// Because 06-featured.js and 07-catalog-kits.js are IIFE modules without
// module.exports, we test the producer logic directly by mirroring the exact
// patterns from the card builders and filter system. This is the same approach
// used by catalog-search.test.js for 07-catalog-kits.js filter logic.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helpers — mirror the producer display logic from card builders
// ---------------------------------------------------------------------------

/**
 * Mirrors the producer element creation pattern from buildFeaturedWineCard,
 * buildFeaturedBeerCard, buildWineCard, and buildBeerCard.
 * Returns a div.producer element if manufacturer is truthy, null otherwise.
 */
function createProducerElement(product) {
  if (product.manufacturer) {
    var producer = document.createElement('div');
    producer.className = 'producer';
    producer.textContent = product.manufacturer;
    return producer;
  }
  return null;
}

/**
 * Mirrors the producer element creation pattern from buildFeaturedDefaultCard
 * and buildDefaultCard. Returns a p.product-producer element if manufacturer
 * is truthy, null otherwise.
 */
function createDefaultCardProducerElement(product) {
  if (product.manufacturer) {
    var cardProducer = document.createElement('p');
    cardProducer.className = 'product-producer';
    cardProducer.textContent = product.manufacturer;
    return cardProducer;
  }
  return null;
}

/**
 * Mirrors the matchesFilters logic from 07-catalog-kits.js.
 * Returns true if the product matches all active filters (for given fields).
 */
function matchesFilters(product, activeFilters, excludeField) {
  var fields = ['type', 'brand', 'manufacturer', 'subcategory', 'time', 'body', 'oak', 'sweetness'];
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    if (f === excludeField) continue;
    if (activeFilters[f] && activeFilters[f].length > 0 && activeFilters[f].indexOf(product[f]) === -1) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Test 1: Conditional producer display — label card builders (wine/beer)
// ---------------------------------------------------------------------------

describe('Producer display — label cards (.producer class)', function () {
  test('creates a .producer element when manufacturer is truthy', function () {
    var product = { name: 'Pinot Noir', brand: 'RJS', manufacturer: 'RJS Craft Winemaking' };
    var el = createProducerElement(product);
    expect(el).not.toBeNull();
    expect(el.className).toBe('producer');
    expect(el.textContent).toBe('RJS Craft Winemaking');
  });

  test('does NOT create a .producer element when manufacturer is empty string', function () {
    var product = { name: 'Pinot Noir', brand: 'RJS', manufacturer: '' };
    var el = createProducerElement(product);
    expect(el).toBeNull();
  });

  test('does NOT create a .producer element when manufacturer is absent (undefined)', function () {
    var product = { name: 'Pinot Noir', brand: 'RJS' };
    var el = createProducerElement(product);
    expect(el).toBeNull();
  });

  test('does NOT create a .producer element when manufacturer is null', function () {
    var product = { name: 'Pinot Noir', brand: 'RJS', manufacturer: null };
    var el = createProducerElement(product);
    expect(el).toBeNull();
  });

  test('uses textContent (not innerHTML) — no XSS injection', function () {
    var product = { name: 'Kit', brand: 'RJS', manufacturer: '<script>alert(1)</script>' };
    var el = createProducerElement(product);
    expect(el).not.toBeNull();
    // textContent stores literal string, innerHTML escapes it
    expect(el.textContent).toBe('<script>alert(1)</script>');
    expect(el.innerHTML).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});

// ---------------------------------------------------------------------------
// Test 2: Conditional producer display — default card builders (.product-producer)
// ---------------------------------------------------------------------------

describe('Producer display — default product cards (.product-producer class)', function () {
  test('creates a .product-producer element when manufacturer is truthy', function () {
    var product = { name: 'Cider Kit', brand: 'Mangrove Jack', manufacturer: 'Mangrove Jack Crafted Series' };
    var el = createDefaultCardProducerElement(product);
    expect(el).not.toBeNull();
    expect(el.className).toBe('product-producer');
    expect(el.tagName).toBe('P');
    expect(el.textContent).toBe('Mangrove Jack Crafted Series');
  });

  test('does NOT create a .product-producer element when manufacturer is falsy', function () {
    var product = { name: 'Generic Kit', brand: '', manufacturer: '' };
    var el = createDefaultCardProducerElement(product);
    expect(el).toBeNull();
  });

  test('uses distinct class from label card producer (.product-producer vs .producer)', function () {
    var labelProduct = { manufacturer: 'Winexpert' };
    var defaultProduct = { manufacturer: 'Winexpert' };
    var labelEl = createProducerElement(labelProduct);
    var defaultEl = createDefaultCardProducerElement(defaultProduct);
    expect(labelEl.className).toBe('producer');
    expect(defaultEl.className).toBe('product-producer');
  });
});

// ---------------------------------------------------------------------------
// Test 3: Producer filter system — activeFilters and matchesFilters
// ---------------------------------------------------------------------------

describe('Producer filter system — manufacturer in filter fields', function () {
  test('activeFilters shape includes manufacturer key', function () {
    // Mirror the activeFilters initialization from 07-catalog-kits.js line 11
    var activeFilters = { type: [], brand: [], manufacturer: [], subcategory: [], time: [], body: [], oak: [], sweetness: [] };
    expect(activeFilters).toHaveProperty('manufacturer');
    expect(Array.isArray(activeFilters.manufacturer)).toBe(true);
    expect(activeFilters.manufacturer).toHaveLength(0);
  });

  test('matchesFilters returns true when manufacturer filter is empty (no filter active)', function () {
    var product = { name: 'Wine Kit', brand: 'RJS', manufacturer: 'RJS Craft Winemaking', type: 'wine' };
    var activeFilters = { type: [], brand: [], manufacturer: [], subcategory: [], time: [], body: [], oak: [], sweetness: [] };
    expect(matchesFilters(product, activeFilters)).toBe(true);
  });

  test('matchesFilters returns true when product manufacturer matches active manufacturer filter', function () {
    var product = { name: 'Wine Kit', brand: 'RJS', manufacturer: 'RJS Craft Winemaking', type: 'wine' };
    var activeFilters = { type: [], brand: [], manufacturer: ['RJS Craft Winemaking'], subcategory: [], time: [], body: [], oak: [], sweetness: [] };
    expect(matchesFilters(product, activeFilters)).toBe(true);
  });

  test('matchesFilters returns false when product manufacturer does not match active manufacturer filter', function () {
    var product = { name: 'Wine Kit', brand: 'RJS', manufacturer: 'RJS Craft Winemaking', type: 'wine' };
    var activeFilters = { type: [], brand: [], manufacturer: ['Winexpert'], subcategory: [], time: [], body: [], oak: [], sweetness: [] };
    expect(matchesFilters(product, activeFilters)).toBe(false);
  });

  test('matchesFilters skips manufacturer check when it is the excludeField', function () {
    // Used by updateFilterAvailability to check availability ignoring current field
    var product = { name: 'Wine Kit', brand: 'RJS', manufacturer: 'RJS Craft Winemaking', type: 'wine' };
    var activeFilters = { type: [], brand: [], manufacturer: ['Winexpert'], subcategory: [], time: [], body: [], oak: [], sweetness: [] };
    // Normally this would return false (manufacturer mismatch), but with excludeField='manufacturer' it should pass
    expect(matchesFilters(product, activeFilters, 'manufacturer')).toBe(true);
  });

  test('manufacturer filter works alongside brand filter (AND logic)', function () {
    var product = { name: 'Wine Kit', brand: 'EN PRIMEUR', manufacturer: 'Winexpert', type: 'wine' };
    var activeFilters = { type: [], brand: ['EN PRIMEUR'], manufacturer: ['Winexpert'], subcategory: [], time: [], body: [], oak: [], sweetness: [] };
    expect(matchesFilters(product, activeFilters)).toBe(true);
  });

  test('filter fails when brand matches but manufacturer does not', function () {
    var product = { name: 'Wine Kit', brand: 'EN PRIMEUR', manufacturer: 'Winexpert', type: 'wine' };
    var activeFilters = { type: [], brand: ['EN PRIMEUR'], manufacturer: ['RJS Craft Winemaking'], subcategory: [], time: [], body: [], oak: [], sweetness: [] };
    expect(matchesFilters(product, activeFilters)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test 4: DOM order — producer appears before brand in label body
// ---------------------------------------------------------------------------

describe('Producer DOM order — producer before brand in label body', function () {
  test('when manufacturer present, producer element is inserted before brand in the parent', function () {
    var body = document.createElement('div');
    body.className = 'label-body';

    var product = { brand: 'RJS', manufacturer: 'RJS Craft Winemaking' };

    // Mirror the exact DOM construction pattern from buildFeaturedWineCard / buildWineCard
    var brand = document.createElement('div');
    brand.className = 'brand';
    brand.textContent = product.brand || '';

    if (product.manufacturer) {
      var producer = document.createElement('div');
      producer.className = 'producer';
      producer.textContent = product.manufacturer;
      body.appendChild(producer);
    }
    body.appendChild(brand);

    var children = body.children;
    expect(children.length).toBe(2);
    expect(children[0].className).toBe('producer');
    expect(children[1].className).toBe('brand');
  });

  test('when manufacturer absent, only brand element in label body (no producer)', function () {
    var body = document.createElement('div');
    body.className = 'label-body';

    var product = { brand: 'RJS', manufacturer: '' };

    var brand = document.createElement('div');
    brand.className = 'brand';
    brand.textContent = product.brand || '';

    if (product.manufacturer) {
      var producer = document.createElement('div');
      producer.className = 'producer';
      producer.textContent = product.manufacturer;
      body.appendChild(producer);
    }
    body.appendChild(brand);

    var children = body.children;
    expect(children.length).toBe(1);
    expect(children[0].className).toBe('brand');
  });
});
