'use strict';

// =============================================================================
// Regression tests: promo discount must flow to dual-cart combined totals
//
// Bug (UAT Test 4): After applying FIRSTBATCH promo code in dual-cart mode,
// the "Combined Total (both orders)" in the ingredient section does NOT update.
// Root cause: applyPromoCode() calls renderReservationItems() but NOT
// renderCheckoutIngredientSection(), so the combined total stays stale.
//
// Fix: add `if (_isDualCart) renderCheckoutIngredientSection();` in:
//   1. applyPromoCode() success handler (after renderReservationItems())
//   2. Remove Code click handler (after renderReservationItems())
// =============================================================================

// ---------------------------------------------------------------------------
// Global stubs (must be set before requiring 12-checkout.js)
// ---------------------------------------------------------------------------
global.SHEETS_CONFIG = { SPREADSHEET_ID: 'test', MIDDLEWARE_URL: '' };
global.navigator = global.navigator || {};
global.navigator.vibrate = jest.fn();

// Cart key constants (normally declared as var at top of 11-cart.js = browser globals)
var FERMENT_CART_KEY    = 'sv-cart-ferment';
var INGREDIENT_CART_KEY = 'sv-cart-ingredients';
global.FERMENT_CART_KEY    = FERMENT_CART_KEY;
global.INGREDIENT_CART_KEY = INGREDIENT_CART_KEY;

// Cart functions (normally global from 11-cart.js)
function getReservationLocal(cartKey) {
  try { var r = localStorage.getItem(cartKey); return r ? JSON.parse(r) : []; } catch (e) { return []; }
}
function saveReservationLocal(items, cartKey) {
  try { localStorage.setItem(cartKey, JSON.stringify(items)); } catch (e) {}
}
global.getReservation   = getReservationLocal;
global.saveReservation  = saveReservationLocal;
global.getAllCartItems   = function () {
  return getReservationLocal(FERMENT_CART_KEY).concat(getReservationLocal(INGREDIENT_CART_KEY));
};
global.isWeightUnit     = function (unit) {
  var u = (unit || '').toLowerCase();
  return u === 'kg' || u === 'g' || u === 'lbs' || u === 'oz';
};
global.getEffectiveMax  = function (item) {
  return parseFloat(item.max_order_qty) || parseFloat(item.stock) || 999;
};
global.getCartKey               = function (item) {
  if ((item._item_type || item.item_type || 'kit') === 'ingredient') return INGREDIENT_CART_KEY;
  return FERMENT_CART_KEY;
};
global.getCartKeyForTab         = function () { return FERMENT_CART_KEY; };
global.setReservationQty        = function () {};
global.refreshAllReserveControls = function () {};
global.updateReservationBar     = function () {};
global.refreshReservationDependents = function () {};
global.renderCartSidebar        = function () {};
global.showToast                = function () {};
global.trackEvent               = jest.fn();

// formatCurrency (normally global from 02-utils.js)
global.formatCurrency = function (n) {
  return '$' + (Math.round(n * 100) / 100).toFixed(2);
};

// escapeHTML (normally global from 02-utils.js)
global.escapeHTML = function (s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
};

// Stubs for functions declared in sub-modules (12a, 12c) or 13-init
global.applyKitSpecificVisibility = function () {};
global.initCheckoutStepper        = function () {};
global.setupContactValidation     = function () {};
global.loadTimeslots              = function () {};
global.updateCompletionEstimate   = function () {};

// ---------------------------------------------------------------------------
// Test item fixtures
// ---------------------------------------------------------------------------

// Wine kit: $280, zero-rated, kit type — one unit in ferment cart
var KIT_ITEM = {
  name: 'Nebbiolo 16L',
  brand: 'RJS',
  price: '280.00',
  qty: 1,
  _item_type: 'kit',
  item_type: 'kit',
  tax_percentage: 0,
  discount: 0,
  zoho_item_id: 'KIT001'
};

// Ingredient: $15, 5% GST — one unit in ingredient cart
var INGREDIENT_ITEM = {
  name: 'Pale Malt 1kg',
  brand: '',
  price: '15.00',
  qty: 1,
  _item_type: 'ingredient',
  item_type: 'ingredient',
  unit: 'each',
  tax_percentage: 5,
  discount: 0,
  zoho_item_id: 'ING001'
};

// Expected combined totals (no _makersFeeItem — it stays null in test)
// Without promo: ferment=$280.00 + ingredient=$15.00 + 5%GST=$0.75 → combined=$295.75
// With 20% promo: ferment=$224.00 + ingredient=$15.00 + 5%GST=$0.75 → combined=$239.75
var COMBINED_NO_PROMO   = '$295.75';
var COMBINED_WITH_PROMO = '$239.75';

// ---------------------------------------------------------------------------
// DOM setup
// ---------------------------------------------------------------------------
function setupDom() {
  document.body.innerHTML =
    // Ingredient section (renderCheckoutIngredientSection target)
    '<div id="ingredient-order-section" class="hidden">' +
    '  <div id="ingredient-order-items"></div>' +
    '</div>' +
    // Ferment section (renderReservationItems target)
    '<div id="reservation-items"></div>' +
    '<div id="reservation-empty" class="hidden">' +
    '  <span data-content="reserved-empty-text"></span>' +
    '  <a data-content="reserved-empty-link" href="#"></a>' +
    '</div>' +
    // Promo widget fields (normally created by renderPromoWidget)
    '<div id="promo-code-row">' +
    '  <input type="email" id="promo-email-input" value="test@example.com" />' +
    '  <input type="text"  id="promo-code-input"  value="FIRSTBATCH" />' +
    '  <span id="promo-code-msg"></span>' +
    '  <button id="promo-code-apply">Apply</button>' +
    '</div>' +
    // Main checkout email (referenced by applyPromoCode)
    '<input type="email" id="res-email" value="test@example.com" />' +
    // Reservation form (referenced by updateDualCartTotalSummary)
    '<form id="reservation-form"><button type="submit">Submit</button></form>';
}

function populateCarts() {
  localStorage.setItem(FERMENT_CART_KEY,    JSON.stringify([KIT_ITEM]));
  localStorage.setItem(INGREDIENT_CART_KEY, JSON.stringify([INGREDIENT_ITEM]));
}

// ---------------------------------------------------------------------------
// beforeEach / afterEach
// ---------------------------------------------------------------------------
beforeEach(function () {
  localStorage.clear();
  jest.clearAllMocks();
  if (global.fetch) { global.fetch = undefined; }
});

// ---------------------------------------------------------------------------
// Suite 1: renderCheckoutIngredientSection — direct DOM output check
// ---------------------------------------------------------------------------
describe('renderCheckoutIngredientSection — combined total calculation', function () {
  var mod;

  beforeEach(function () {
    jest.resetModules();
    mod = require('../../js/modules/12-checkout');
  });

  test('without promo: combined total = ferment + ingredient + tax', function () {
    populateCarts();
    setupDom();
    mod.renderCheckoutIngredientSection();

    var grandEl = document.querySelector('.dual-cart-grand-total');
    expect(grandEl).not.toBeNull();
    expect(grandEl.textContent).toContain(COMBINED_NO_PROMO);
  });

  test('with promo set: combined total reflects 20% discount on kit items', function () {
    populateCarts();
    setupDom();

    // Set promo state directly via the test helper
    mod._setPromoAppliedForTest({ code: 'FIRSTBATCH', discountPct: 20 });
    mod.renderCheckoutIngredientSection();

    var grandEl = document.querySelector('.dual-cart-grand-total');
    expect(grandEl).not.toBeNull();
    expect(grandEl.textContent).toContain(COMBINED_WITH_PROMO);
  });

  test('after promo removed: combined total reverts to full price', function () {
    populateCarts();
    setupDom();

    // First render with promo
    mod._setPromoAppliedForTest({ code: 'FIRSTBATCH', discountPct: 20 });
    mod.renderCheckoutIngredientSection();

    // Remove promo and re-render
    mod._setPromoAppliedForTest(null);
    mod.renderCheckoutIngredientSection();

    var grandEl = document.querySelector('.dual-cart-grand-total');
    expect(grandEl).not.toBeNull();
    expect(grandEl.textContent).toContain(COMBINED_NO_PROMO);
  });
});

// ---------------------------------------------------------------------------
// Suite 2: applyPromoCode + _isDualCart — the regression test
//
// This test reproduces the exact UAT failure:
//   - After applyPromoCode() succeeds, renderCheckoutIngredientSection() must
//     be called when _isDualCart is true.
//   - Without the fix: combined total stays at $295.75 (stale).
//   - With the fix: combined total updates to $239.75 (discounted).
// ---------------------------------------------------------------------------
describe('applyPromoCode — must trigger ingredient section re-render in dual-cart mode', function () {
  var mod;

  beforeEach(function () {
    jest.resetModules();
    mod = require('../../js/modules/12-checkout');
  });

  test('combined total in ingredient section reflects promo after applyPromoCode (dual-cart)', function () {
    populateCarts();
    setupDom();

    // Activate dual-cart mode
    mod._setDualCartForTest(true);

    // Initial render — combined total shows full price
    mod.renderCheckoutIngredientSection();
    var grandEl = document.querySelector('.dual-cart-grand-total');
    expect(grandEl).not.toBeNull();
    expect(grandEl.textContent).toContain(COMBINED_NO_PROMO);

    // Mock fetch to return a valid promo response
    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: function () {
        return Promise.resolve({ ok: true, code: 'FIRSTBATCH', discountPct: 20 });
      }
    });

    // Trigger promo apply
    mod.applyPromoCode();

    // Flush the Promise chain (fetch → .then → .then)
    return Promise.resolve()
      .then(function () { return Promise.resolve(); })
      .then(function () { return Promise.resolve(); })
      .then(function () {
        // After fix: renderCheckoutIngredientSection was re-called with _promoApplied set
        // Combined total must now show the 20%-discounted value
        var updated = document.querySelector('.dual-cart-grand-total');
        expect(updated).not.toBeNull();
        expect(updated.textContent).toContain(COMBINED_WITH_PROMO);
      });
  });

  test('combined total reverts when promo is removed via Remove Code handler (dual-cart)', function () {
    populateCarts();
    setupDom();

    // Start in dual-cart mode with promo already applied
    mod._setDualCartForTest(true);
    mod._setPromoAppliedForTest({ code: 'FIRSTBATCH', discountPct: 20 });

    // Render ingredient section with promo — combined total shows discounted value
    mod.renderCheckoutIngredientSection();
    var grandEl = document.querySelector('.dual-cart-grand-total');
    expect(grandEl).not.toBeNull();
    expect(grandEl.textContent).toContain(COMBINED_WITH_PROMO);

    // Simulate the Remove Code handler: set promo to null and re-render
    // (The actual handler calls renderReservationItems() + renderCheckoutIngredientSection())
    mod._setPromoAppliedForTest(null);
    mod.renderCheckoutIngredientSection();

    var reverted = document.querySelector('.dual-cart-grand-total');
    expect(reverted).not.toBeNull();
    expect(reverted.textContent).toContain(COMBINED_NO_PROMO);
  });
});
