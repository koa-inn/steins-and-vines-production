'use strict';

// Regression coverage for the 2026-09-16 mobile audit, items 1, 2, 3 and 11 — the fixed bottom
// catalogue bar (#mobile-catalog-bar) built by initMobileBottomControls() below 1024px:
//   1/2. It was present from the hero onward, covering ~14% of a phone viewport while reading
//        content two thousand pixels above the catalogue it controls, and permanently hiding the
//        end of the footer. It must only be visible while the catalogue is in the viewport.
//   3.   It stacked above the open mobile nav menu (CSS; asserted in the companion CSS test).
//   11.  It was created below 1024px and never removed when the viewport grew (tablet rotation),
//        leaving a fixed bar on a desktop layout. It must tear down and restore the controls.

global.SHEETS_CONFIG = { SPREADSHEET_ID: 'test', MIDDLEWARE_URL: '' };
global.navigator = global.navigator || {};
global.navigator.vibrate = jest.fn();
global.navigator.standalone = false;
var FERMENT_KEY = 'sv-cart-ferment', INGREDIENT_KEY = 'sv-cart-ingredients', LEGACY_KEY = 'sv-reservation';
global.RESERVATION_KEY = LEGACY_KEY;
global.FERMENT_CART_KEY = FERMENT_KEY;
global.INGREDIENT_CART_KEY = INGREDIENT_KEY;
global.CART_KEYS = { FERMENT: FERMENT_KEY, INGREDIENTS: INGREDIENT_KEY, LEGACY_RESERVATION: LEGACY_KEY };
global.getReservation = function () { return []; };
global.saveReservation = function () {};
global.refreshAllReserveControls = function () {};
global.updateReservationBar = function () {};
global.refreshReservationDependents = function () {};
global.renderCartSidebar = function () {};
global.trackEvent = jest.fn();
global.formatCurrency = function (n) { return '$' + parseFloat(n).toFixed(2); };
global.escapeHTML = function (s) { return String(s || ''); };
global.loadTimeslots = function () {};
global.updateCompletionEstimate = function () {};
global.PAYMENT_DISABLED = false;
global.loadProducts = jest.fn();
global.initReservationBar = jest.fn();
global.initCartDrawer = jest.fn();
global.initCatalogViewToggle = jest.fn();
global.initProductTabs = jest.fn();
global.setupBeerWaitlistForm = jest.fn();
global.loadIngredients = jest.fn();

window.requestAnimationFrame = function (fn) { fn(); return 1; };

// matchMedia stub that lets the test flip the (min-width: 1024px) query.
var mqlListeners = [];
var mqlState = { matches: false };
window.matchMedia = function () {
  return {
    get matches() { return mqlState.matches; },
    addEventListener: function (_, fn) { mqlListeners.push(fn); },
    removeEventListener: function (_, fn) { mqlListeners = mqlListeners.filter(function (f) { return f !== fn; }); }
  };
};
function flipToDesktop() { mqlState.matches = true; mqlListeners.slice().forEach(function (fn) { fn({ matches: true }); }); }

var init = require('../../js/modules/13-init');

var catalogueTop;
function mount() {
  document.body.innerHTML =
    '<main><section id="intro"><p>long intro</p></section>' +
    '<div class="catalog-layout"><div id="catalog-blocks"><div id="product-catalog">' +
    '<div class="catalog-controls" id="catalog-controls-kits"><input class="catalog-search"></div>' +
    '<div class="product-grid"></div></div></div></div>' +
    '<footer>footer</footer></main>';
  var target = document.getElementById('catalog-blocks');
  target.getBoundingClientRect = function () {
    return { top: catalogueTop, bottom: catalogueTop + 1200, left: 0, right: 390, width: 390, height: 1200 };
  };
}

beforeEach(function () {
  mqlListeners = [];
  mqlState.matches = false;
  window.innerWidth = 390;
  window.innerHeight = 740;
  catalogueTop = 2400; // well below the fold
  if (init.teardownMobileBottomControls) init.teardownMobileBottomControls();
  mount();
});

describe('mobile catalogue bar lifecycle', function () {
  test('init and teardown are exported for this harness', function () {
    expect(typeof init.initMobileBottomControls).toBe('function');
    expect(typeof init.teardownMobileBottomControls).toBe('function');
  });

  test('does nothing at desktop widths', function () {
    window.innerWidth = 1280;
    init.initMobileBottomControls();
    expect(document.getElementById('mobile-catalog-bar')).toBeNull();
    expect(document.querySelector('#product-catalog .catalog-controls')).not.toBeNull();
  });

  test('moves the controls into the bar but keeps it hidden until the catalogue scrolls into view', function () {
    init.initMobileBottomControls();
    var bar = document.getElementById('mobile-catalog-bar');
    expect(bar).not.toBeNull();
    expect(bar.querySelector('.catalog-controls')).not.toBeNull();
    expect(bar.classList.contains('is-visible')).toBe(false);

    catalogueTop = 500; // top edge inside the 740px viewport
    window.dispatchEvent(new Event('scroll'));
    expect(bar.classList.contains('is-visible')).toBe(true);

    catalogueTop = -1300; // bottom edge (top + 1200) has scrolled above the viewport
    window.dispatchEvent(new Event('scroll'));
    expect(bar.classList.contains('is-visible')).toBe(false);
  });

  test('is visible immediately when the catalogue starts inside the viewport', function () {
    catalogueTop = 120;
    init.initMobileBottomControls();
    expect(document.getElementById('mobile-catalog-bar').classList.contains('is-visible')).toBe(true);
  });

  test('tears down and restores the controls when the viewport grows to desktop', function () {
    init.initMobileBottomControls();
    expect(document.getElementById('mobile-catalog-bar')).not.toBeNull();
    flipToDesktop();
    expect(document.getElementById('mobile-catalog-bar')).toBeNull();
    var restored = document.querySelector('#product-catalog .catalog-controls');
    expect(restored).not.toBeNull();
    // back in its original slot: before the grid, not appended after it
    expect(restored.nextElementSibling.className).toBe('product-grid');
  });

  test('calling init twice does not build two bars or lose the controls', function () {
    init.initMobileBottomControls();
    init.initMobileBottomControls();
    expect(document.querySelectorAll('#mobile-catalog-bar').length).toBe(1);
    expect(document.querySelectorAll('.catalog-controls').length).toBe(1);
  });
});
