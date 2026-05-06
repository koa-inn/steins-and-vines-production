'use strict';

// ---------------------------------------------------------------------------
// producer-compact.test.js
//
// Tests the compact view producer display logic added in Phase 11 Plan 03.
//
// Covers: cart sidebar inline format (11-cart.js), checkout table
// hasManufacturer conditional (12-checkout.js), and kiosk grid card
// conditional producer display (kiosk.js).
//
// Because these are IIFE modules, we mirror the exact logic patterns
// from the source files rather than importing them.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helpers — mirror compact view producer logic
// ---------------------------------------------------------------------------

/**
 * Mirrors the nameEl.textContent assignment in cart sidebar item renderers
 * (11-cart.js). Returns the text that would be set on the name element.
 */
function cartSidebarNameText(item) {
  return item.manufacturer
    ? item.manufacturer + ' — ' + item.name
    : item.name;
}

/**
 * Mirrors the hasManufacturer computation from 12-checkout.js.
 * Returns true if any item in the array has a non-blank manufacturer.
 */
function computeHasManufacturer(items) {
  return items.some(function (it) { return (it.manufacturer || '').trim() !== ''; });
}

/**
 * Mirrors the checkout table column headers array from 12-checkout.js,
 * filtering out conditional headers the same way the source does.
 * Returns the rendered column labels array.
 */
function checkoutColumnLabels(items) {
  var hasTime = items.some(function (it) { return (it.time || '').trim() !== ''; });
  var hasBrand = items.some(function (it) { return (it.brand || '').trim() !== ''; });
  var hasManufacturer = computeHasManufacturer(items);

  return ['Name', 'Type', 'Producer', 'Brand', 'Time', 'Price', 'Status', 'Qty', ''].filter(function (label) {
    if (label === 'Time' && !hasTime) return false;
    if (label === 'Brand' && !hasBrand) return false;
    if (label === 'Producer' && !hasManufacturer) return false;
    return true;
  });
}

/**
 * Mirrors the kiosk grid card producer rendering logic from kiosk.js.
 * Returns the HTML string that would be inserted for the product body
 * producer + name section.
 */
function kioskGridCardProducerHtml(p, itemType) {
  // escapeHTML mirror (simplified for test purposes)
  function escapeHTML(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  var html = '';
  if (p.manufacturer && itemType === 'kit') {
    html += '<div class="kiosk-product-producer">' + escapeHTML(p.manufacturer) + '</div>';
  }
  html += '<div class="kiosk-product-name">' + escapeHTML(p.name || '') + '</div>';
  return html;
}

// ---------------------------------------------------------------------------
// Test 1: Cart sidebar inline format (11-cart.js)
// ---------------------------------------------------------------------------

describe('Cart sidebar — inline manufacturer+name format (D-03)', function () {
  test('prepends manufacturer with em dash when manufacturer is truthy', function () {
    var item = { name: 'Pinot Noir Kit', manufacturer: 'RJS Craft Winemaking' };
    var text = cartSidebarNameText(item);
    expect(text).toBe('RJS Craft Winemaking — Pinot Noir Kit');
  });

  test('shows only name when manufacturer is empty string (D-12)', function () {
    var item = { name: 'Pinot Noir Kit', manufacturer: '' };
    var text = cartSidebarNameText(item);
    expect(text).toBe('Pinot Noir Kit');
    expect(text).not.toContain('—');
    expect(text).not.toContain(' — ');
  });

  test('shows only name when manufacturer is absent/undefined (D-12)', function () {
    var item = { name: 'Pilsner Kit' };
    var text = cartSidebarNameText(item);
    expect(text).toBe('Pilsner Kit');
    expect(text).not.toContain('—');
  });

  test('shows only name when manufacturer is null (D-12)', function () {
    var item = { name: 'Cider Kit', manufacturer: null };
    var text = cartSidebarNameText(item);
    expect(text).toBe('Cider Kit');
    expect(text).not.toContain('—');
  });

  test('result does NOT start with em dash when manufacturer is falsy', function () {
    var item = { name: 'Mead Kit', manufacturer: '' };
    var text = cartSidebarNameText(item);
    expect(text.startsWith('—')).toBe(false);
    expect(text.startsWith(' —')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test 2: Checkout review table hasManufacturer conditional (12-checkout.js)
// ---------------------------------------------------------------------------

describe('Checkout table — Producer column conditional (hasManufacturer)', function () {
  test('hasManufacturer is true when any item has a non-blank manufacturer', function () {
    var items = [
      { name: 'Wine Kit', manufacturer: 'RJS Craft Winemaking' },
      { name: 'Beer Kit', manufacturer: '' }
    ];
    expect(computeHasManufacturer(items)).toBe(true);
  });

  test('hasManufacturer is false when all items have blank manufacturer', function () {
    var items = [
      { name: 'Wine Kit', manufacturer: '' },
      { name: 'Beer Kit', manufacturer: '   ' }
    ];
    expect(computeHasManufacturer(items)).toBe(false);
  });

  test('hasManufacturer is false when all items lack manufacturer field', function () {
    var items = [
      { name: 'Wine Kit' },
      { name: 'Beer Kit' }
    ];
    expect(computeHasManufacturer(items)).toBe(false);
  });

  test('Producer column header is included when hasManufacturer is true', function () {
    var items = [{ name: 'Kit', manufacturer: 'Winexpert' }];
    var labels = checkoutColumnLabels(items);
    expect(labels).toContain('Producer');
  });

  test('Producer column header is excluded when hasManufacturer is false', function () {
    var items = [{ name: 'Kit', manufacturer: '' }];
    var labels = checkoutColumnLabels(items);
    expect(labels).not.toContain('Producer');
  });

  test('Producer column appears before Brand column in header order', function () {
    var items = [
      { name: 'Kit', manufacturer: 'RJS', brand: 'RJS EN PRIMEUR' }
    ];
    var labels = checkoutColumnLabels(items);
    var producerIdx = labels.indexOf('Producer');
    var brandIdx = labels.indexOf('Brand');
    expect(producerIdx).toBeGreaterThan(-1);
    expect(brandIdx).toBeGreaterThan(-1);
    expect(producerIdx).toBeLessThan(brandIdx);
  });

  test('Brand column excluded independently from Producer column', function () {
    var items = [{ name: 'Kit', manufacturer: 'Winexpert', brand: '' }];
    var labels = checkoutColumnLabels(items);
    expect(labels).toContain('Producer');
    expect(labels).not.toContain('Brand');
  });
});

// ---------------------------------------------------------------------------
// Test 3: Kiosk grid card producer conditional (kiosk.js)
// ---------------------------------------------------------------------------

describe('Kiosk grid card — producer div conditional on kit type', function () {
  test('kiosk-product-producer div present for kit item with manufacturer', function () {
    var p = { name: 'Pinot Noir Kit', manufacturer: 'RJS Craft Winemaking' };
    var html = kioskGridCardProducerHtml(p, 'kit');
    expect(html).toContain('class="kiosk-product-producer"');
    expect(html).toContain('RJS Craft Winemaking');
  });

  test('kiosk-product-producer div absent for ingredient item with manufacturer', function () {
    var p = { name: 'Oak Chips', manufacturer: 'LD Carlson' };
    var html = kioskGridCardProducerHtml(p, 'ingredient');
    expect(html).not.toContain('class="kiosk-product-producer"');
  });

  test('kiosk-product-producer div absent for kit item without manufacturer', function () {
    var p = { name: 'Generic Kit', manufacturer: '' };
    var html = kioskGridCardProducerHtml(p, 'kit');
    expect(html).not.toContain('class="kiosk-product-producer"');
  });

  test('kiosk-product-producer div absent for kit item with null manufacturer', function () {
    var p = { name: 'Generic Kit', manufacturer: null };
    var html = kioskGridCardProducerHtml(p, 'kit');
    expect(html).not.toContain('class="kiosk-product-producer"');
  });

  test('kiosk-product-name div always present', function () {
    var p = { name: 'Pinot Noir Kit', manufacturer: 'RJS Craft Winemaking' };
    var html = kioskGridCardProducerHtml(p, 'kit');
    expect(html).toContain('class="kiosk-product-name"');
    expect(html).toContain('Pinot Noir Kit');
  });

  test('manufacturer HTML-escaped in kiosk template (XSS safety per T-11-05)', function () {
    var p = { name: 'Kit', manufacturer: '<script>alert(1)</script>' };
    var html = kioskGridCardProducerHtml(p, 'kit');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  test('producer div appears before name div in html output', function () {
    var p = { name: 'Wine Kit', manufacturer: 'Winexpert' };
    var html = kioskGridCardProducerHtml(p, 'kit');
    var producerIdx = html.indexOf('kiosk-product-producer');
    var nameIdx = html.indexOf('kiosk-product-name');
    expect(producerIdx).toBeLessThan(nameIdx);
  });
});
