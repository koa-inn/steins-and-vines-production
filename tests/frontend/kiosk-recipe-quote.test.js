'use strict';

// =============================================================================
// Tests: kiosk recipe-quote integration (35-06)
//
// The admin Kiosk Sale recipe prompt must:
//   1. Fetch /api/kiosk/recipe-quote when kioskFetchRecipeQuote is called.
//   2. Store the result in _kioskQuote.
//   3. Update the Add-to-Cart button label to show the scaled total.
//   4. Fall back to base price when no quote is available.
//   5. Clear _kioskQuote on cart clear / Back button.
//   6. Build cart line items using SCALED quantities from the quote.
//
// Note: admin.js runs in jsdom but `document` inside admin.js refers to the
// jsdom document (not a jest.fn mock). DOM-interaction tests inject real
// elements into document.body before calling admin functions so the admin code
// can find them via the real document.getElementById.
// =============================================================================

// ---------------------------------------------------------------------------
// DOM stub shim — used only for the non-DOM (pure-function) tests.
// For DOM-interaction tests we inject real jsdom elements instead.
// ---------------------------------------------------------------------------
// jsdom is already the environment. We override just the parts admin.js needs
// that jsdom doesn't provide in test mode.
// ---------------------------------------------------------------------------

global.window = global.window || {};
global.window.confirm = global.window.confirm || jest.fn(function () { return true; });
global.window.addEventListener = global.window.addEventListener || jest.fn();

global.navigator = global.navigator || { userAgent: 'test' };
global.localStorage = global.localStorage || { getItem: jest.fn(function () { return null; }), setItem: jest.fn(), removeItem: jest.fn() };
global.sessionStorage = global.sessionStorage || { getItem: jest.fn(function () { return null; }), setItem: jest.fn(), removeItem: jest.fn() };

global.console = {
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn()
};

global.fetch = jest.fn(function () {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: function () { return Promise.resolve({}); }
  });
});

// setTimeout fires immediately so debounce collapses in tests
global.setTimeout = jest.fn(function (fn) {
  if (typeof fn === 'function') fn();
  return 1;
});
global.clearTimeout = jest.fn();
global.setInterval = jest.fn(function () { return 1; });
global.clearInterval = jest.fn();
global.alert = jest.fn();
global.Image = global.Image || jest.fn(function () { return {}; });
global.MutationObserver = global.MutationObserver || jest.fn(function () {
  return { observe: jest.fn(), disconnect: jest.fn() };
});
global.IntersectionObserver = global.IntersectionObserver || jest.fn(function () {
  return { observe: jest.fn(), disconnect: jest.fn(), unobserve: jest.fn() };
});
global.google = {
  accounts: {
    oauth2: {
      initTokenClient: jest.fn(function () { return { requestAccessToken: jest.fn() }; })
    }
  }
};

global.SHEETS_CONFIG = {
  MIDDLEWARE_URL: 'http://mw.test',
  MW_API_KEY: 'test-api-key',
  SPREADSHEET_ID: 'test-id',
  GOOGLE_CLIENT_ID: 'test-client-id',
  STAFF_EMAILS: 'test@example.com',
  API_BASE: 'https://script.google.com/test',
  SERVER_TOKEN: 'test-token'
};

var admin = require('../../js/admin.js');

// ---------------------------------------------------------------------------
// Helper: inject a real jsdom element with given id into document.body
// so that admin.js can find it via document.getElementById.
// ---------------------------------------------------------------------------
function injectEl(id, tag) {
  var existing = document.getElementById(id);
  if (existing) {
    existing.textContent = '';
    existing.style.display = '';
    return existing;
  }
  var el = document.createElement(tag || 'div');
  el.id = id;
  document.body.appendChild(el);
  return el;
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------
var BASE_RECIPE = {
  recipe_id: 'RCP-001',
  name: 'Test IPA',
  style: 'IPA',
  batch_size_l: 23,
  pricing_mode: 'dynamic',
  computed_price: 109.20,
  locked_price: 0,
  service_fee: 45,
  materials_fee: 5,
  abv: 6.5
};

var MOCK_QUOTE_6X = {
  ok: true,
  recipe_id: 'RCP-001',
  base_volume_l: 23,
  target_volume_l: 138,
  scale_factor: 6,
  pricing_mode: 'dynamic',
  total: 655.20,
  ingredients: [
    { item_id: 'ING-001', item_name: 'Pale Malt', unit: 'kg', base_quantity: 5, quantity: 30, rate: 3.00, line_total: 90.00 },
    { item_id: 'ING-002', item_name: 'Cascade Hops', unit: 'g', base_quantity: 50, quantity: 300, rate: 0.04, line_total: 12.00 }
  ],
  stock: { ok: true, conflicts: [] }
};

var BASE_RECIPE_LOCKED = {
  recipe_id: 'RCP-002',
  name: 'House Lager',
  style: 'Lager',
  batch_size_l: 23,
  pricing_mode: 'locked',
  computed_price: 0,
  locked_price: 150,
  service_fee: 45,
  materials_fee: 5,
  abv: 4.5
};

var MOCK_QUOTE_LOCKED_2X = {
  ok: true,
  recipe_id: 'RCP-002',
  base_volume_l: 23,
  target_volume_l: 46,
  scale_factor: 2,
  pricing_mode: 'locked',
  total: 300.00,
  ingredients: [
    { item_id: 'ING-003', item_name: 'Pilsner Malt', unit: 'kg', base_quantity: 4, quantity: 8, rate: 2.50, line_total: 0 },
    { item_id: 'ING-004', item_name: 'Saaz Hops', unit: 'g', base_quantity: 30, quantity: 60, rate: 0.05, line_total: 0 }
  ],
  stock: { ok: true, conflicts: [] }
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
beforeEach(function () {
  global.fetch.mockClear();
  global.fetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: function () { return Promise.resolve({}); }
  });

  // Reset kiosk state via exported setters
  admin._kioskSetQuote(null);
  admin._kioskSetSelectedRecipe(null);
  admin._kioskSetSaleType(null);
  admin._kioskSetTargetVolumeL(null);
  admin._kioskClearCart();
  admin._kioskSetRecipeAvailability(null);
});

afterEach(function () {
  document.body.innerHTML = '';
});

// ---------------------------------------------------------------------------
// T1: kioskFetchRecipeQuote calls the correct endpoint
// ---------------------------------------------------------------------------
describe('kioskFetchRecipeQuote — HTTP request', function () {
  test('T1a: hits /api/kiosk/recipe-quote with recipe_id, sale_type, and target_volume_l', function () {
    admin._kioskSetSelectedRecipe(BASE_RECIPE);
    admin._kioskSetSaleType('in-store');
    admin._kioskSetTargetVolumeL(138);

    global.fetch.mockResolvedValueOnce({
      status: 200,
      json: function () { return Promise.resolve(MOCK_QUOTE_6X); }
    });

    admin.kioskFetchRecipeQuote();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    var url = global.fetch.mock.calls[0][0];
    expect(url).toContain('/api/kiosk/recipe-quote');
    expect(url).toContain('recipe_id=RCP-001');
    expect(url).toContain('sale_type=in-store');
    expect(url).toContain('target_volume_l=138');
  });

  test('T1b: includes x-api-key header from SHEETS_CONFIG.MW_API_KEY', function () {
    admin._kioskSetSelectedRecipe(BASE_RECIPE);
    admin._kioskSetSaleType('in-store');
    admin._kioskSetTargetVolumeL(23);

    global.fetch.mockResolvedValueOnce({
      status: 200,
      json: function () { return Promise.resolve(MOCK_QUOTE_6X); }
    });

    admin.kioskFetchRecipeQuote();

    var opts = global.fetch.mock.calls[0][1];
    expect(opts).toBeDefined();
    expect(opts.headers).toBeDefined();
    expect(opts.headers['x-api-key']).toBe('test-api-key');
  });

  test('T1c: does not call fetch when no recipe is selected', function () {
    admin._kioskSetSelectedRecipe(null);
    admin._kioskSetSaleType('in-store');
    admin.kioskFetchRecipeQuote();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('T1d: does not call fetch when no sale type is set', function () {
    admin._kioskSetSelectedRecipe(BASE_RECIPE);
    admin._kioskSetSaleType(null);
    admin.kioskFetchRecipeQuote();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('T1e: sends sale_type=take-out when take-out is selected', function () {
    admin._kioskSetSelectedRecipe(BASE_RECIPE);
    admin._kioskSetSaleType('take-out');
    admin._kioskSetTargetVolumeL(46);

    global.fetch.mockResolvedValueOnce({
      status: 200,
      json: function () { return Promise.resolve({ ok: true, recipe_id: 'RCP-001', total: 200, ingredients: [] }); }
    });

    admin.kioskFetchRecipeQuote();

    var url = global.fetch.mock.calls[0][0];
    expect(url).toContain('sale_type=take-out');
  });
});

// ---------------------------------------------------------------------------
// T2: Add-to-Cart button label uses the quote total when available
// Uses real jsdom DOM elements so admin.js can find them.
// ---------------------------------------------------------------------------
describe('kioskUpdateAddToCartButton — label', function () {
  test('T2a: shows scaled total from quote on button when quote matches recipe', function () {
    // Inject the real button element that admin.js looks up
    var addBtn = injectEl('kiosk-add-recipe-to-cart', 'button');

    admin._kioskSetSelectedRecipe(BASE_RECIPE);
    admin._kioskSetSaleType('in-store');
    admin._kioskSetQuote(MOCK_QUOTE_6X);
    admin.kioskUpdateAddToCartButton();

    // Button label should contain the quote total ($655.20)
    expect(addBtn.textContent).toContain('655.20');
    expect(addBtn.style.display).toBe('');
  });

  test('T2b: falls back to base recipe price when no quote is available', function () {
    var addBtn = injectEl('kiosk-add-recipe-to-cart', 'button');

    admin._kioskSetSelectedRecipe(BASE_RECIPE);
    admin._kioskSetSaleType('in-store');
    admin._kioskSetQuote(null);
    admin.kioskUpdateAddToCartButton();

    // Should fall back to computed_price ($109.20), not $655.20
    expect(addBtn.textContent).toContain('109.20');
    expect(addBtn.textContent).not.toContain('655.20');
  });

  test('T2c: falls back to base price when quote recipe_id does not match selected recipe', function () {
    var addBtn = injectEl('kiosk-add-recipe-to-cart', 'button');

    admin._kioskSetSelectedRecipe(BASE_RECIPE);
    admin._kioskSetSaleType('in-store');
    // Quote for a DIFFERENT recipe — should not be used
    var staleQuote = Object.assign({}, MOCK_QUOTE_6X, { recipe_id: 'RCP-OTHER' });
    admin._kioskSetQuote(staleQuote);
    admin.kioskUpdateAddToCartButton();

    expect(addBtn.textContent).toContain('109.20');
    expect(addBtn.textContent).not.toContain('655.20');
  });

  test('T2d: hides button when no recipe or sale type selected', function () {
    var addBtn = injectEl('kiosk-add-recipe-to-cart', 'button');

    admin._kioskSetSelectedRecipe(null);
    admin._kioskSetSaleType(null);
    admin.kioskUpdateAddToCartButton();

    expect(addBtn.style.display).toBe('none');
  });
});

// ---------------------------------------------------------------------------
// T3: Quote state management (pure state, no DOM)
// ---------------------------------------------------------------------------
describe('quote state management', function () {
  test('T3a: _kioskQuote starts null after reset', function () {
    admin._kioskSetQuote(null);
    expect(admin._kioskGetQuote()).toBeNull();
  });

  test('T3b: _kioskSetQuote stores and _kioskGetQuote retrieves the quote', function () {
    admin._kioskSetQuote(MOCK_QUOTE_6X);
    var q = admin._kioskGetQuote();
    expect(q).not.toBeNull();
    expect(q.recipe_id).toBe('RCP-001');
    expect(q.total).toBe(655.20);
    expect(q.scale_factor).toBe(6);
  });

  test('T3c: setting quote to null clears it (simulates back-button / cart-clear reset)', function () {
    admin._kioskSetQuote(MOCK_QUOTE_6X);
    expect(admin._kioskGetQuote()).not.toBeNull();
    admin._kioskSetQuote(null);
    expect(admin._kioskGetQuote()).toBeNull();
  });

  test('T3d: quote ingredients carry scaled quantities (not base)', function () {
    admin._kioskSetQuote(MOCK_QUOTE_6X);
    var q = admin._kioskGetQuote();
    // At 6x scale, Pale Malt should be 30 kg (not 5 kg base)
    expect(q.ingredients[0].quantity).toBe(30);
    expect(q.ingredients[0].base_quantity).toBe(5);
    // Cascade Hops should be 300 g (not 50 g base)
    expect(q.ingredients[1].quantity).toBe(300);
    expect(q.ingredients[1].base_quantity).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// T4: Locked-price recipe shows scaled total on button
// ---------------------------------------------------------------------------
describe('locked-price recipe quote', function () {
  test('T4a: quote total reflects scaled locked price (2x = $300, not $150)', function () {
    var addBtn = injectEl('kiosk-add-recipe-to-cart', 'button');

    admin._kioskSetSelectedRecipe(BASE_RECIPE_LOCKED);
    admin._kioskSetSaleType('in-store');
    admin._kioskSetQuote(MOCK_QUOTE_LOCKED_2X);
    admin.kioskUpdateAddToCartButton();

    // Should show $300.00 from the quote, not $150 base locked_price
    expect(addBtn.textContent).toContain('300.00');
    expect(addBtn.textContent).not.toContain('150.00');
  });

  test('T4b: locked recipe quote carries scaled ingredient quantities', function () {
    admin._kioskSetQuote(MOCK_QUOTE_LOCKED_2X);
    var q = admin._kioskGetQuote();
    // At 2x: Pilsner Malt should be 8 kg (not 4 kg base)
    expect(q.ingredients[0].quantity).toBe(8);
    expect(q.ingredients[0].base_quantity).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// T5: kioskFetchRecipeQuote request construction
// ---------------------------------------------------------------------------
describe('kioskFetchRecipeQuote — request construction', function () {
  test('T5a: uses base batch_size_l as target_volume_l when _kioskTargetVolumeL is null', function () {
    admin._kioskSetSelectedRecipe(BASE_RECIPE);
    admin._kioskSetSaleType('in-store');
    admin._kioskSetTargetVolumeL(null);  // no explicit target

    global.fetch.mockResolvedValueOnce({
      status: 200,
      json: function () { return Promise.resolve({ ok: true, recipe_id: 'RCP-001', total: 109.20, ingredients: [] }); }
    });

    admin.kioskFetchRecipeQuote();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    var url = global.fetch.mock.calls[0][0];
    // Should include the batch_size_l as target_volume_l
    expect(url).toContain('target_volume_l=23');
  });

  test('T5b: does not call fetch when recipe is not selected', function () {
    admin._kioskSetSelectedRecipe(null);
    admin.kioskFetchRecipeQuote();
    admin.kioskFetchRecipeQuote();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
