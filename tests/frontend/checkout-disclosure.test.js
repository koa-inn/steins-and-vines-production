'use strict';

// =============================================================================
// Regression tests: pre-purchase disclosure at checkout (BPCPA s.18.2/18.3)
//
// Gaps found in the 2026-09-16 policy review:
//   (j) currency  — the total was a bare "$"; the Act wants the currency named.
//   (o) promo     — the FIRSTBATCH code's conditions were not shown where it
//                   is entered.
//   (f) estimate  — the ready estimate shown before payment was not sent with
//                   the order, so the confirmation email could not carry it.
// =============================================================================

global.SHEETS_CONFIG = { SPREADSHEET_ID: 'test', MIDDLEWARE_URL: '' };
global.navigator = global.navigator || {};
global.navigator.vibrate = jest.fn();

var FERMENT_CART_KEY    = 'sv-cart-ferment';
var INGREDIENT_CART_KEY = 'sv-cart-ingredients';
global.FERMENT_CART_KEY    = FERMENT_CART_KEY;
global.INGREDIENT_CART_KEY = INGREDIENT_CART_KEY;

function getReservationLocal(cartKey) {
  try { var r = localStorage.getItem(cartKey); return r ? JSON.parse(r) : []; } catch (e) { return []; }
}
function saveReservationLocal(items, cartKey) {
  try { localStorage.setItem(cartKey, JSON.stringify(items)); } catch (e) {}
}
global.getReservation   = getReservationLocal;
global.saveReservation  = saveReservationLocal;
global.getAllCartItems  = function () {
  return getReservationLocal(FERMENT_CART_KEY).concat(getReservationLocal(INGREDIENT_CART_KEY));
};
global.isWeightUnit = function (unit) {
  var u = (unit || '').toLowerCase();
  return u === 'kg' || u === 'g' || u === 'lbs' || u === 'oz';
};
global.getEffectiveMax = function (item) {
  return parseFloat(item.max_order_qty) || parseFloat(item.stock) || 999;
};
global.getCartKey = function (item) {
  if ((item._item_type || item.item_type || 'kit') === 'ingredient') return INGREDIENT_CART_KEY;
  return FERMENT_CART_KEY;
};
global.getCartKeyForTab          = function () { return FERMENT_CART_KEY; };
global.setReservationQty         = function () {};
global.refreshAllReserveControls = function () {};
global.updateReservationBar      = function () {};
global.refreshReservationDependents = function () {};
global.renderCartSidebar         = function () {};
global.showToast                 = function () {};
global.trackEvent                = jest.fn();
global.formatCurrency = function (n) { return '$' + (Math.round(n * 100) / 100).toFixed(2); };
global.escapeHTML = function (s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
};
global.applyKitSpecificVisibility = function () {};
global.initCheckoutStepper        = function () {};
global.setupContactValidation     = function () {};
global.loadTimeslots              = function () {};
global.updateCompletionEstimate   = function () {};

var KIT_ITEM = {
  name: 'Nebbiolo 16L', brand: 'RJS', price: '280.00', qty: 1,
  _item_type: 'kit', item_type: 'kit', tax_percentage: 0, discount: 0, zoho_item_id: 'KIT001'
};
var INGREDIENT_ITEM = {
  name: 'Pale Malt 1kg', brand: '', price: '15.00', qty: 1,
  _item_type: 'ingredient', item_type: 'ingredient', unit: 'each', tax_percentage: 5, discount: 0, zoho_item_id: 'ING001'
};

function setupDom() {
  document.body.innerHTML =
    '<div id="ingredient-order-section" class="hidden"><div id="ingredient-order-items"></div></div>' +
    '<div id="reservation-items"></div>' +
    '<div id="reservation-empty" class="hidden">' +
    '  <span data-content="reserved-empty-text"></span><a data-content="reserved-empty-link" href="#"></a>' +
    '</div>' +
    '<input type="email" id="res-email" value="test@example.com" />' +
    '<div id="completion-estimate" class="completion-estimate hidden"><p id="completion-estimate-text"></p></div>' +
    '<form id="reservation-form"><button type="submit">Submit</button></form>';
}

beforeEach(function () {
  localStorage.clear();
  jest.clearAllMocks();
});

describe('currency is named on every total row (s.18.2 (j))', function () {
  var mod;
  beforeEach(function () { jest.resetModules(); mod = require('../../js/modules/12-checkout'); });

  test('ferment order total row reads "Total (CAD)"', function () {
    localStorage.setItem(FERMENT_CART_KEY, JSON.stringify([KIT_ITEM]));
    setupDom();
    mod.renderReservationItems();
    var totalRow = document.querySelector('#reservation-items .reservation-subtotal--total');
    expect(totalRow).not.toBeNull();
    expect(totalRow.textContent).toContain('Total (CAD)');
  });

  test('ingredient order total row reads "Total (CAD)"', function () {
    localStorage.setItem(FERMENT_CART_KEY, JSON.stringify([KIT_ITEM]));
    localStorage.setItem(INGREDIENT_CART_KEY, JSON.stringify([INGREDIENT_ITEM]));
    setupDom();
    mod.renderCheckoutIngredientSection();
    var totalRow = document.querySelector('#ingredient-order-items .reservation-subtotal--total');
    expect(totalRow).not.toBeNull();
    expect(totalRow.textContent).toContain('Total (CAD)');
  });
});

describe('promo code conditions are shown where the code is entered (s.18.2 (o))', function () {
  var mod;
  beforeEach(function () { jest.resetModules(); mod = require('../../js/modules/12-checkout'); });

  test('the unapplied promo widget states the discount, the one-use rule and no stacking', function () {
    localStorage.setItem(FERMENT_CART_KEY, JSON.stringify([KIT_ITEM]));
    setupDom();
    mod.renderReservationItems();
    var hint = document.getElementById('promo-code-hint');
    expect(hint).not.toBeNull();
    expect(hint.textContent).toContain('20%');
    expect(hint.textContent).toMatch(/one use per email/i);
    expect(hint.textContent).toMatch(/combined/i);
  });
});

describe('the ready estimate shown before payment travels with the order (s.18.2 (f))', function () {
  var mod;
  beforeEach(function () { jest.resetModules(); mod = require('../../js/modules/12-checkout'); });

  test('returns the visible estimate text', function () {
    setupDom();
    var el = document.getElementById('completion-estimate');
    el.classList.remove('hidden');
    document.getElementById('completion-estimate-text').textContent =
      'Estimated ready the week of October 31–November 6, 2026 (approximately 4 weeks from your appointment).';
    expect(mod.getReadyEstimateForCheckout()).toContain('Estimated ready the week of October 31');
  });

  test('returns an empty string when the estimate is hidden', function () {
    setupDom();
    document.getElementById('completion-estimate-text').textContent = 'Estimated ready the week of ...';
    expect(mod.getReadyEstimateForCheckout()).toBe('');
  });

  test('returns an empty string when the element is absent', function () {
    document.body.innerHTML = '';
    expect(mod.getReadyEstimateForCheckout()).toBe('');
  });
});
