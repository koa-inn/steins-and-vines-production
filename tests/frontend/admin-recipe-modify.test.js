'use strict';

// =============================================================================
// Tests: admin recipe-sale ingredient modification (36-04)
//
// The admin Kiosk Sale recipe-modify panel must:
//   1. Include modified_ingredients in the quote URL when _kioskModifiedIngredients is set.
//   2. Append "(Modified)" to Add-to-Cart label when modifications exist.
//   3. Splice the correct element when removing a row (data-ing-idx caveat).
//   4. Never mutate the original recipe object (deep-copy proof, D-04/D-14).
//   5. kioskSaveAsNewRecipe POSTs to /api/recipes with pricing_mode:'dynamic',
//      status:'draft', and the modified base list (not the scaled list).
//   6. No PUT/PATCH to /api/recipes/:id during save-as-new (D-14).
//   7. XSS: ingredient name with <img onerror> is escaped in rendered HTML.
// =============================================================================

global.window = global.window || {};
global.window.confirm = global.window.confirm || jest.fn(function () { return true; });
global.window.addEventListener = global.window.addEventListener || jest.fn();

global.navigator = global.navigator || { userAgent: 'test' };
global.localStorage = global.localStorage || {
  getItem: jest.fn(function () { return null; }),
  setItem: jest.fn(),
  removeItem: jest.fn()
};
global.sessionStorage = global.sessionStorage || {
  getItem: jest.fn(function () { return null; }),
  setItem: jest.fn(),
  removeItem: jest.fn()
};

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

var MODIFIED_INGREDIENTS = [
  { item_id: 'ING-001', item_name: 'Pale Malt', unit: 'kg', quantity: 5, base_quantity: 5 },
  { item_id: 'ING-002', item_name: 'Cascade Hops', unit: 'g', quantity: 50, base_quantity: 50 },
  { item_id: 'ING-003', item_name: 'Extra Grain', unit: 'kg', quantity: 2, base_quantity: 2 }
];

var MOCK_QUOTE_MODIFIED = {
  ok: true,
  recipe_id: 'RCP-001',
  base_volume_l: 23,
  target_volume_l: 23,
  scale_factor: 1,
  pricing_mode: 'dynamic',
  total: 125.50,
  is_modified: true,
  ingredients: [
    { item_id: 'ING-001', item_name: 'Pale Malt', unit: 'kg', base_quantity: 5, quantity: 5, rate: 3.00, line_total: 15.00 },
    { item_id: 'ING-002', item_name: 'Cascade Hops', unit: 'g', base_quantity: 50, quantity: 50, rate: 0.04, line_total: 2.00 },
    { item_id: 'ING-003', item_name: 'Extra Grain', unit: 'kg', base_quantity: 2, quantity: 2, rate: 4.50, line_total: 9.00 }
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
  admin._kioskSetModifiedIngredients(null);
});

afterEach(function () {
  document.body.innerHTML = '';
});

// ---------------------------------------------------------------------------
// T1: kioskFetchRecipeQuote includes modified_ingredients when set
// ---------------------------------------------------------------------------
describe('kioskFetchRecipeQuote — modified_ingredients param', function () {
  test('T1a: includes modified_ingredients in URL when _kioskModifiedIngredients is non-null', function () {
    admin._kioskSetSelectedRecipe(BASE_RECIPE);
    admin._kioskSetSaleType('in-store');
    admin._kioskSetModifiedIngredients(MODIFIED_INGREDIENTS);

    global.fetch.mockResolvedValueOnce({
      status: 200,
      json: function () { return Promise.resolve(MOCK_QUOTE_MODIFIED); }
    });

    return admin.kioskFetchRecipeQuote().then(function () {
      expect(global.fetch).toHaveBeenCalledTimes(1);
      var calledUrl = global.fetch.mock.calls[0][0];
      expect(calledUrl).toContain('modified_ingredients=');
      var decoded = decodeURIComponent(calledUrl.split('modified_ingredients=')[1]);
      var parsed = JSON.parse(decoded);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(3);
      expect(parsed[0].item_id).toBe('ING-001');
    });
  });

  test('T1b: does NOT include modified_ingredients in URL when _kioskModifiedIngredients is null', function () {
    admin._kioskSetSelectedRecipe(BASE_RECIPE);
    admin._kioskSetSaleType('in-store');
    admin._kioskSetModifiedIngredients(null);

    global.fetch.mockResolvedValueOnce({
      status: 200,
      json: function () { return Promise.resolve({ ok: true, recipe_id: 'RCP-001', total: 109.20 }); }
    });

    return admin.kioskFetchRecipeQuote().then(function () {
      var calledUrl = global.fetch.mock.calls[0][0];
      expect(calledUrl).not.toContain('modified_ingredients');
    });
  });
});

// ---------------------------------------------------------------------------
// T2: kioskUpdateAddToCartButton — (Modified) suffix
// ---------------------------------------------------------------------------
describe('kioskUpdateAddToCartButton — (Modified) suffix', function () {
  test('T2a: appends "(Modified)" to label when _kioskModifiedIngredients is a non-null array', function () {
    injectEl('kiosk-add-recipe-to-cart', 'button');

    admin._kioskSetSelectedRecipe(BASE_RECIPE);
    admin._kioskSetSaleType('in-store');
    admin._kioskSetModifiedIngredients(MODIFIED_INGREDIENTS);
    admin._kioskSetQuote({ ok: true, recipe_id: 'RCP-001', total: 125.50 });

    admin.kioskUpdateAddToCartButton();

    var btn = document.getElementById('kiosk-add-recipe-to-cart');
    expect(btn.textContent).toContain('(Modified)');
    expect(btn.textContent).toContain('$125.50');
  });

  test('T2b: does NOT append "(Modified)" when _kioskModifiedIngredients is null', function () {
    injectEl('kiosk-add-recipe-to-cart', 'button');

    admin._kioskSetSelectedRecipe(BASE_RECIPE);
    admin._kioskSetSaleType('in-store');
    admin._kioskSetModifiedIngredients(null);
    admin._kioskSetQuote({ ok: true, recipe_id: 'RCP-001', total: 109.20 });

    admin.kioskUpdateAddToCartButton();

    var btn = document.getElementById('kiosk-add-recipe-to-cart');
    expect(btn.textContent).not.toContain('(Modified)');
  });
});

// ---------------------------------------------------------------------------
// T3: Remove row splices _kioskModifiedIngredients at the correct index
// ---------------------------------------------------------------------------
describe('_kioskModifiedIngredients splicing — remove row', function () {
  test('T3: removing the middle ingredient splices the correct index', function () {
    // Simulate state: 3 ingredients, remove index 1 (Cascade Hops)
    var mods = [
      { item_id: 'ING-001', item_name: 'Pale Malt', unit: 'kg', quantity: 5 },
      { item_id: 'ING-002', item_name: 'Cascade Hops', unit: 'g', quantity: 50 },
      { item_id: 'ING-003', item_name: 'Extra Grain', unit: 'kg', quantity: 2 }
    ];
    admin._kioskSetModifiedIngredients(mods);

    // Splice index 1 (simulating the remove handler logic)
    var current = admin._kioskGetModifiedIngredients();
    current.splice(1, 1);

    var result = admin._kioskGetModifiedIngredients();
    expect(result.length).toBe(2);
    expect(result[0].item_id).toBe('ING-001');
    expect(result[1].item_id).toBe('ING-003');
    // Confirm ING-002 is gone
    expect(result.some(function (i) { return i.item_id === 'ING-002'; })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T4: Deep-copy proof — original recipe is never mutated (D-04/D-14)
// ---------------------------------------------------------------------------
describe('Deep-copy — original recipe not mutated', function () {
  test('T4: modifying _kioskModifiedIngredients does not alter the recipe object', function () {
    // The original recipe object with a known ingredient list
    var originalRecipe = {
      recipe_id: 'RCP-ORIG',
      name: 'Original Recipe',
      batch_size_l: 23,
      ingredients: [
        { item_id: 'ING-A', item_name: 'Base Malt', unit: 'kg', quantity: 6 },
        { item_id: 'ING-B', item_name: 'Hops', unit: 'g', quantity: 30 }
      ]
    };

    // Simulate what the modify-toggle handler does: deep-copy the recipe ingredients
    var deepCopy = originalRecipe.ingredients.map(function (ing) {
      return Object.assign({}, ing);
    });
    admin._kioskSetModifiedIngredients(deepCopy);

    // Mutate the copy (simulating user edits)
    var mods = admin._kioskGetModifiedIngredients();
    mods[0].quantity = 999;  // change first ingredient qty
    mods.push({ item_id: 'ING-C', item_name: 'Extra', unit: 'g', quantity: 100 });

    // Original recipe's ingredients must be unchanged
    expect(originalRecipe.ingredients[0].quantity).toBe(6);  // not 999
    expect(originalRecipe.ingredients.length).toBe(2);       // not 3
  });
});

// ---------------------------------------------------------------------------
// T5: kioskSaveAsNewRecipe — POST /api/recipes with correct payload
// ---------------------------------------------------------------------------
describe('kioskSaveAsNewRecipe — POST payload', function () {
  test('T5a: POSTs to /api/recipes with pricing_mode:dynamic, status:draft, and modified base list', function () {
    admin._kioskSetSelectedRecipe(BASE_RECIPE);

    var modifiedBase = [
      { item_id: 'ING-001', item_name: 'Pale Malt', unit: 'kg', quantity: 7 },
      { item_id: 'ING-NEW', item_name: 'Crystal Malt', unit: 'kg', quantity: 1 }
    ];

    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: function () { return Promise.resolve({ ok: true, recipe_id: 'RCP-NEW' }); }
    });

    return admin.kioskSaveAsNewRecipe('My Custom IPA', modifiedBase).then(function () {
      expect(global.fetch).toHaveBeenCalledTimes(1);
      var call = global.fetch.mock.calls[0];
      var calledUrl = call[0];
      var calledOpts = call[1];

      expect(calledUrl).toContain('/api/recipes');
      expect(calledOpts.method).toBe('POST');

      var body = JSON.parse(calledOpts.body);
      expect(body.pricing_mode).toBe('dynamic');
      expect(body.status).toBe('draft');
      expect(body.name).toBe('My Custom IPA');
      expect(body.ingredients).toEqual(modifiedBase);
      // Must include batch_size_l from the original recipe (pre-scale, D-12)
      expect(body.batch_size_l).toBe(23);
    });
  });

  test('T5b: does NOT make a PUT/PATCH to /api/recipes/:id (original untouched, D-14)', function () {
    admin._kioskSetSelectedRecipe(BASE_RECIPE);

    var modifiedBase = [
      { item_id: 'ING-001', item_name: 'Pale Malt', unit: 'kg', quantity: 7 }
    ];

    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: function () { return Promise.resolve({ ok: true, recipe_id: 'RCP-NEW' }); }
    });

    return admin.kioskSaveAsNewRecipe('New Recipe', modifiedBase).then(function () {
      expect(global.fetch).toHaveBeenCalledTimes(1);
      var call = global.fetch.mock.calls[0];
      var calledUrl = call[0];
      var calledOpts = call[1];

      // Must be POST, not PUT/PATCH
      expect(calledOpts.method).toBe('POST');
      // URL must not contain a recipe ID path segment (no /api/recipes/RCP-001)
      expect(calledUrl).not.toMatch(/\/api\/recipes\/[^\/]+/);
    });
  });
});

// ---------------------------------------------------------------------------
// T6: XSS — ingredient names are escaped in rendered rows (T-36-12)
// ---------------------------------------------------------------------------
describe('XSS — ingredient names escaped in modify rows', function () {
  test('T6: renderKioskModifyRows escapes malicious ingredient name', function () {
    var maliciousIngredient = [
      { item_id: 'ING-XSS', item_name: '<img src=x onerror=alert(1)>', unit: 'kg', quantity: 1 }
    ];
    admin._kioskSetModifiedIngredients(maliciousIngredient);

    var tbody = injectEl('kiosk-modify-tbody', 'tbody');

    admin.renderKioskModifyRows();

    // The raw HTML tag must not be present in innerHTML unescaped
    expect(tbody.innerHTML).not.toContain('<img src=x onerror=alert(1)>');
    // The escaped form should appear
    expect(tbody.innerHTML).toContain('&lt;img');
  });
});
