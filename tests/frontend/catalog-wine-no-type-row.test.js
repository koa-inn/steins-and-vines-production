'use strict';

// Regression coverage for the 2026-09-16 mobile audit, item 10: wine.html is already scoped to
// wine, so its "Type:" filter row only ever offered "All" and "Wine <n>" — a redundant chip pair
// taking a row of the phone filter panel. The wine page must hide that row; unscoped pages
// (products.html and friends) still build it because they mix categories.

global.KIT_CATEGORIES = ['wine', 'beer', 'cider', 'seltzer'];
global.SHEETS_CONFIG = { MIDDLEWARE_URL: 'http://mw.test' };
global.showCatalogSkeletons = function () {};
global.formatCurrency = function (val) { return '$' + Number(val).toFixed(2); };
global._activeCartTab = 'kits';
global.catalogViewMode = 'cards';
global.INGREDIENT_CART_KEY = 'sv-cart-ingredients';
global.SV_LOGO_SVG = '<svg></svg>';
['applyKitsFilters', 'equalizeCardHeights', 'ga4AddToCart', 'handleDeepLinkedItem',
  'injectKitListSchema', 'injectProductSchema', 'renderReserveControl', 'setReservationQty',
  'setResponsiveImg', 'trackEvent'].forEach(function (name) { global[name] = function () {}; });
['buildLabelNotesToggle', 'buildLabelPriceFooter', 'buildProductLinkBtn'].forEach(function (name) {
  global[name] = function () { return document.createElement('div'); };
});
global.escapeHTML = function (s) { return String(s); };
global.getProductKey = function (p) { return p && (p.sku || p.name); };
global.getReservedQty = function () { return 0; };
global.getTintClass = function () { return ''; };

var PRODUCTS = [
  { name: 'Chile Chardonnay', sku: 'W1', type: 'Wine', stock: '3', rate: 220, brand: 'Cru' },
  { name: 'Festa Brew IPA Kit', sku: 'B1', type: 'Beer', stock: '2', rate: 80, brand: 'Festa' }
];
global.fetch = function (url) {
  if (/\/api\/products$/.test(url)) {
    return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ items: PRODUCTS }); } });
  }
  return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ recipes: [] }); } });
};

var mod = require('../../js/modules/07-catalog-kits.js');

function flush() { return new Promise(function (r) { setTimeout(r, 30); }); }

function mount(page) {
  window.localStorage.clear();
  document.body.setAttribute('data-page', page);
  document.body.innerHTML =
    '<div id="product-catalog"></div>' +
    '<div class="catalog-filter-row" id="filter-type"></div>' +
    '<div class="catalog-filter-row" id="filter-brand"></div>';
}

describe('Type filter row', function () {
  test('is hidden and empty on the wine page', function () {
    mount('wine');
    mod.loadProducts('wine');
    return flush().then(function () {
      var row = document.getElementById('filter-type');
      expect(row.classList.contains('hidden')).toBe(true);
      expect(row.querySelectorAll('button').length).toBe(0);
      // sanity: the page still builds its other rows
      expect(document.getElementById('filter-brand').querySelectorAll('button').length).toBeGreaterThan(0);
    });
  });

  test('is still built on an unscoped catalogue page', function () {
    mount('products');
    mod.loadProducts('');
    return flush().then(function () {
      var row = document.getElementById('filter-type');
      expect(row.classList.contains('hidden')).toBe(false);
      expect(row.querySelectorAll('button').length).toBeGreaterThan(1);
    });
  });
});
