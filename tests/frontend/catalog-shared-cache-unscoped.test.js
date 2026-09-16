'use strict';

// Regression coverage for the shared middleware product cache being poisoned by a
// category-scoped page.
//
// The bug: loadProducts(categoryFilter) filters the /api/products response down to the page's
// own category INSIDE fetchFromMiddleware(), i.e. before setCachedMW() writes it to the shared
// localStorage key `sv-products-mw` (30-minute TTL). Loading beer.html therefore stored a
// beer-only list; any page reading that cache within 30 minutes (wine.html, the hub, the home
// page featured block) saw no wine kits and rendered "No products found." The reverse held too:
// wine.html left a wine-only cache and beer.html lost its kits. Found on staging during the
// pre-cutover walkthrough on 2026-09-16 — the wine page showed 77 kits, then "No products found."
// after the beer page had been opened.
//
// The post-load pipeline already re-applies matchesKitCategory(obj, _categoryFilter), so the
// cache must hold the UNSCOPED kit list: every kit category, minus ingredients and services.

global.KIT_CATEGORIES = ['wine', 'beer', 'cider', 'seltzer'];
global.SHEETS_CONFIG = { MIDDLEWARE_URL: 'http://mw.test' };
global.showCatalogSkeletons = function () {};
global.formatCurrency = function (val) { return '$' + Number(val).toFixed(2); };
// Globals owned by other concatenated modules that loadProducts' post-load render chain
// touches. Stubbed as inert values so the chain runs to completion; this suite only asserts
// what was written to the cache, not what was rendered.
global._activeCartTab = 'kits';
global.catalogViewMode = 'cards';
global.INGREDIENT_CART_KEY = 'sv-cart-ingredients';
global.SV_LOGO_SVG = '<svg></svg>';
['applyKitsFilters', 'equalizeCardHeights', 'ga4AddToCart', 'handleDeepLinkedItem',
  'injectKitListSchema', 'injectProductSchema', 'renderReserveControl', 'setReservationQty',
  'setResponsiveImg', 'trackEvent'].forEach(function (name) { global[name] = function () {}; });
// Card builders must hand back a real node — the card assembly appends their result.
['buildLabelNotesToggle', 'buildLabelPriceFooter', 'buildProductLinkBtn'].forEach(function (name) {
  global[name] = function () { return document.createElement('div'); };
});
global.escapeHTML = function (s) { return String(s); };
global.getProductKey = function (p) { return p && (p.sku || p.name); };
global.getReservedQty = function () { return 0; };
global.getTintClass = function () { return ''; };

// jsdom's window.localStorage is a live accessor that a plain global assignment cannot replace,
// so this suite reads the module's cache writes back from the real jsdom storage.

var PRODUCTS = [
  { name: 'Chile Chardonnay', sku: 'W1', type: 'Wine', stock: '3', rate: 220 },
  { name: 'Festa Brew West Coast IPA Kit', sku: 'B1', type: 'Beer', stock: '2', rate: 80 },
  { name: 'Lactic Acid', sku: 'I1', type: 'Ingredient', stock: '9', rate: 5 },
  { name: 'Bottling', sku: 'S1', type: 'Service', stock: '1', rate: 15 }
];

global.fetch = function (url) {
  if (/\/api\/products$/.test(url)) {
    return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ items: PRODUCTS }); } });
  }
  // recipes and anything else: empty but ok
  return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ recipes: [] }); } });
};

var mod = require('../../js/modules/07-catalog-kits.js');

function flush() { return new Promise(function (r) { setTimeout(r, 20); }); }

function cachedTypes() {
  var raw = window.localStorage.getItem('sv-products-mw');
  if (!raw) return null;
  return JSON.parse(raw).map(function (i) { return i.type; }).sort();
}

describe('shared middleware product cache is category-agnostic', function () {
  beforeEach(function () {
    window.localStorage.clear();
    document.body.innerHTML = '<div id="product-catalog"></div>';
    document.body.setAttribute('data-page', '');
  });

  test('loadProducts is exported for this harness', function () {
    expect(typeof mod.loadProducts).toBe('function');
  });

  test('a beer-scoped load caches wine kits too (and drops ingredients/services)', function () {
    document.body.setAttribute('data-page', 'beer');
    mod.loadProducts('beer');
    return flush().then(function () {
      expect(cachedTypes()).toEqual(['Beer', 'Wine']);
    });
  });

  test('a wine-scoped load caches beer kits too', function () {
    document.body.setAttribute('data-page', 'wine');
    mod.loadProducts('wine');
    return flush().then(function () {
      expect(cachedTypes()).toEqual(['Beer', 'Wine']);
    });
  });

  test('an unscoped load caches the same list as a scoped one', function () {
    mod.loadProducts('');
    return flush().then(function () {
      expect(cachedTypes()).toEqual(['Beer', 'Wine']);
    });
  });
});
