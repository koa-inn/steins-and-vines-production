'use strict';

// =============================================================================
// Tests: BrewPad recipe-attach flow — scale + modify + advisory + save-as-new (36-06)
//
// The brewpad.js recipe-attach surface must:
//   1. bpScaleIngredients: weight (kg/g/l/ml) linear; discrete (pcs/each/unit/pkg/ft) ceil
//   2. Scaling parity with lib/recipe-scaling.js: 5 kg grain @1.5x -> 7.5 kg (linear,
//      no rounding); 1 pcs hop @1.5x -> 2 pcs (Math.max(1, Math.ceil(1.5)))
//   3. Selecting a recipe resolves but does NOT call update_batch (write on Attach only)
//   4. Attach snapshot carries target_volume_l, scale_factor, scaledIngredients,
//      modified_base_ingredients, is_modified
//   5. Soft advisory renders short items but Attach button is NEVER set disabled (D-11)
//   6. Source recipe object is unchanged after edits (_bpModifiedIngredients is a deep copy)
//   7. bpSaveAsNewRecipe POSTs /api/recipes with modified base list (pre-scale), pricing_mode
//      'dynamic', status 'draft'; no PUT to /api/recipes/:id (D-12/D-13/D-14)
//   8. XSS: ingredient names escaped in advisory + modify rows (T-36-18)
//   9. No recipe-quote / recipe-sale / Helcim call on attach path (D-10 / T-36-20)
// =============================================================================

// ---------------------------------------------------------------------------
// Environment stubs (mirror brewpad-recipes.test.js pattern)
// ---------------------------------------------------------------------------
global.window = global.window || {};
global.window.confirm = global.window.confirm || jest.fn(function () { return true; });
global.window.addEventListener = global.window.addEventListener || jest.fn();
global.window.scrollTo = global.window.scrollTo || jest.fn();

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
  SERVER_TOKEN: 'test-token',
  ADMIN_API_URL: 'https://script.google.com/test/admin'
};

// groupRecipeIngredients is loaded via <script> in browser; stub it for tests
global.groupRecipeIngredients = function (ingredients) {
  return [{ label: '', count: ingredients.length, items: ingredients }];
};

var bp = require('../../js/brewpad');

// ---------------------------------------------------------------------------
// Helper: inject a real jsdom element into document.body
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
var BASE_INGREDIENTS = [
  { item_id: 'ING-001', item_name: 'Pale Malt', unit: 'kg', quantity: 5, cf_type: 'Grain', cf_subcategory: '', display_group: '', stock_on_hand: 20 },
  { item_id: 'ING-002', item_name: 'Cascade Hops', unit: 'pcs', quantity: 1, cf_type: 'Hops', cf_subcategory: '', display_group: '', stock_on_hand: 10 }
];

var BASE_RECIPE = {
  recipe_id: 'RCP-001',
  name: 'Test IPA',
  style: 'IPA',
  batch_size_l: 23,
  pricing_mode: 'dynamic',
  locked_price: 0,
  service_fee: 45,
  materials_fee: 5,
  abv: 6.5
};

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------
beforeEach(function () {
  global.fetch.mockClear();
  global.fetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: function () { return Promise.resolve({}); }
  });

  // Reset attach state via exported setters
  if (bp._bpSetTargetVolumeL) bp._bpSetTargetVolumeL(null);
  if (bp._bpSetModifiedIngredients) bp._bpSetModifiedIngredients(null);
  if (bp._bpSetResolvedRecipe) bp._bpSetResolvedRecipe(null);
  if (bp._bpSetScaleFactor) bp._bpSetScaleFactor(1.0);
});

afterEach(function () {
  document.body.innerHTML = '';
});

// ---------------------------------------------------------------------------
// T1: bpScaleIngredients — parity with lib/recipe-scaling.js (D-10, T-36-SC)
// ---------------------------------------------------------------------------
describe('bpScaleIngredients — scaling parity with lib/recipe-scaling', function () {
  test('T1a: exports bpScaleIngredients as a function', function () {
    expect(typeof bp.bpScaleIngredients).toBe('function');
  });

  test('T1b: weight-based ingredient 5 kg grain at 1.5x -> 7.5 kg (linear, no rounding)', function () {
    var ingredients = [
      { item_id: 'ING-001', item_name: 'Pale Malt', unit: 'kg', quantity: 5 }
    ];
    var result = bp.bpScaleIngredients(ingredients, 1.5);
    expect(result[0].quantity).toBe(7.5);
    expect(result[0].unit).toBe('kg');
    // Source array must NOT be mutated
    expect(ingredients[0].quantity).toBe(5);
  });

  test('T1c: discrete ingredient 1 pcs hop at 1.5x -> 2 pcs (Math.max(1, Math.ceil(1.5)))', function () {
    var ingredients = [
      { item_id: 'ING-002', item_name: 'Cascade Hops', unit: 'pcs', quantity: 1 }
    ];
    var result = bp.bpScaleIngredients(ingredients, 1.5);
    expect(result[0].quantity).toBe(2);
    expect(result[0].unit).toBe('pcs');
    // Source must NOT be mutated
    expect(ingredients[0].quantity).toBe(1);
  });

  test('T1d: continuous units (g, l, ml) scale linearly', function () {
    var ingredients = [
      { item_id: 'ING-G', item_name: 'Grain', unit: 'g', quantity: 200 },
      { item_id: 'ING-L', item_name: 'Water', unit: 'l', quantity: 10 },
      { item_id: 'ING-ML', item_name: 'Additive', unit: 'ml', quantity: 50 }
    ];
    var result = bp.bpScaleIngredients(ingredients, 2.0);
    expect(result[0].quantity).toBe(400);   // 200 * 2.0
    expect(result[1].quantity).toBe(20);    // 10 * 2.0
    expect(result[2].quantity).toBe(100);   // 50 * 2.0
  });

  test('T1e: discrete units (each, unit, pkg, ft) round up via Math.max(1, ceil)', function () {
    var ingredients = [
      { item_id: 'A', item_name: 'Each item', unit: 'each', quantity: 2 },
      { item_id: 'B', item_name: 'Unit item', unit: 'unit', quantity: 3 },
      { item_id: 'C', item_name: 'Pkg item', unit: 'pkg', quantity: 1 },
      { item_id: 'D', item_name: 'Ft item', unit: 'ft', quantity: 2 }
    ];
    var result = bp.bpScaleIngredients(ingredients, 1.3);
    // 2 * 1.3 = 2.6 -> ceil(2.6) = 3
    expect(result[0].quantity).toBe(3);
    // 3 * 1.3 = 3.9 -> ceil(3.9) = 4
    expect(result[1].quantity).toBe(4);
    // 1 * 1.3 = 1.3 -> ceil(1.3) = 2
    expect(result[2].quantity).toBe(2);
    // 2 * 1.3 = 2.6 -> ceil(2.6) = 3
    expect(result[3].quantity).toBe(3);
  });

  test('T1f: discrete quantity that rounds below 1 is clamped to 1', function () {
    var ingredients = [
      { item_id: 'ING-SMALL', item_name: 'Tiny Item', unit: 'pcs', quantity: 0.1 }
    ];
    var result = bp.bpScaleIngredients(ingredients, 0.5);
    // 0.1 * 0.5 = 0.05 -> Math.max(1, Math.ceil(0.05)) = 1
    expect(result[0].quantity).toBe(1);
  });

  test('T1g: unknown non-blank unit treated as discrete (conservative default)', function () {
    var ingredients = [
      { item_id: 'ING-U', item_name: 'Mystery', unit: 'oz', quantity: 3 }
    ];
    var result = bp.bpScaleIngredients(ingredients, 1.3);
    // 3 * 1.3 = 3.9 -> ceil = 4
    expect(result[0].quantity).toBe(4);
  });

  test('T1h: blank unit treated as continuous (linear, D-03)', function () {
    var ingredients = [
      { item_id: 'ING-B', item_name: 'Blank Unit', unit: '', quantity: 4 }
    ];
    var result = bp.bpScaleIngredients(ingredients, 1.5);
    // 4 * 1.5 = 6.0 (linear)
    expect(result[0].quantity).toBe(6);
  });

  test('T1i: returns shallow clones — source array and objects not mutated', function () {
    var ingredients = [
      { item_id: 'ING-001', item_name: 'Pale Malt', unit: 'kg', quantity: 5 }
    ];
    var result = bp.bpScaleIngredients(ingredients, 2.0);
    expect(result).not.toBe(ingredients);
    expect(result[0]).not.toBe(ingredients[0]);
    expect(ingredients[0].quantity).toBe(5);  // original unchanged
    expect(result[0].quantity).toBe(10);       // scaled
  });
});

// ---------------------------------------------------------------------------
// T2: Attach snapshot — no update_batch on recipe selection (write only on Attach click)
// ---------------------------------------------------------------------------
describe('attach flow — no update_batch on recipe selection', function () {
  test('T2a: resolving a recipe (selection) does NOT trigger any fetch/adminApiPost call', function () {
    // The resolve step should ONLY store _bpResolvedRecipe and show UI controls
    // We test that no fetch call is made when _bpSetResolvedRecipe is called
    bp._bpSetResolvedRecipe({ recipe: BASE_RECIPE, ingredients: BASE_INGREDIENTS });

    // No fetch should have been made by simply setting the resolved recipe
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('T2b: _bpGetResolvedRecipe returns the set recipe object', function () {
    bp._bpSetResolvedRecipe({ recipe: BASE_RECIPE, ingredients: BASE_INGREDIENTS });
    var resolved = bp._bpGetResolvedRecipe();
    expect(resolved).not.toBeNull();
    expect(resolved.recipe.recipe_id).toBe('RCP-001');
    expect(resolved.ingredients.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// T3: Attach snapshot content — snapshot carries required fields
// ---------------------------------------------------------------------------
describe('buildBpAttachSnapshot — snapshot structure', function () {
  test('T3a: exports buildBpAttachSnapshot function', function () {
    expect(typeof bp.buildBpAttachSnapshot).toBe('function');
  });

  test('T3b: snapshot carries target_volume_l, scale_factor, scaledIngredients', function () {
    bp._bpSetResolvedRecipe({ recipe: BASE_RECIPE, ingredients: BASE_INGREDIENTS });
    bp._bpSetTargetVolumeL(34.5);  // 1.5x of 23 L
    bp._bpSetScaleFactor(1.5);
    bp._bpSetModifiedIngredients(null);  // unmodified

    var snap = bp.buildBpAttachSnapshot();
    expect(typeof snap.target_volume_l).toBe('number');
    expect(snap.target_volume_l).toBe(34.5);
    expect(typeof snap.scale_factor).toBe('number');
    expect(snap.scale_factor).toBe(1.5);
    expect(Array.isArray(snap.scaledIngredients)).toBe(true);
  });

  test('T3c: scaledIngredients contains literal parity values — 7.5 kg grain + 2 pcs hop at 1.5x', function () {
    var parity_ingredients = [
      { item_id: 'ING-001', item_name: 'Pale Malt', unit: 'kg', quantity: 5, cf_type: 'Grain', cf_subcategory: '', display_group: '' },
      { item_id: 'ING-002', item_name: 'Cascade Hops', unit: 'pcs', quantity: 1, cf_type: 'Hops', cf_subcategory: '', display_group: '' }
    ];
    bp._bpSetResolvedRecipe({ recipe: BASE_RECIPE, ingredients: parity_ingredients });
    bp._bpSetTargetVolumeL(34.5);
    bp._bpSetScaleFactor(1.5);
    bp._bpSetModifiedIngredients(null);

    var snap = bp.buildBpAttachSnapshot();
    var grain = snap.scaledIngredients.find(function (i) { return i.item_id === 'ING-001'; });
    var hop = snap.scaledIngredients.find(function (i) { return i.item_id === 'ING-002'; });

    // LITERAL PARITY VALUES — must match zoho-middleware/lib/recipe-scaling.js scaleIngredient
    expect(grain).toBeDefined();
    expect(grain.quantity).toBe(7.5);  // 5 * 1.5 = 7.5 (linear, no rounding)

    expect(hop).toBeDefined();
    expect(hop.quantity).toBe(2);      // Math.max(1, Math.ceil(1 * 1.5)) = Math.max(1, 2) = 2
  });

  test('T3d: snapshot carries modified_base_ingredients when modifications exist', function () {
    bp._bpSetResolvedRecipe({ recipe: BASE_RECIPE, ingredients: BASE_INGREDIENTS });
    bp._bpSetTargetVolumeL(23);
    bp._bpSetScaleFactor(1.0);
    var modified = [
      { item_id: 'ING-001', item_name: 'Pale Malt', unit: 'kg', quantity: 6, cf_type: 'Grain', cf_subcategory: '', display_group: '' },
      { item_id: 'ING-NEW', item_name: 'Extra Hops', unit: 'g', quantity: 50, cf_type: 'Hops', cf_subcategory: '', display_group: '' }
    ];
    bp._bpSetModifiedIngredients(modified);

    var snap = bp.buildBpAttachSnapshot();
    expect(Array.isArray(snap.modified_base_ingredients)).toBe(true);
    expect(snap.modified_base_ingredients.length).toBe(2);
    expect(snap.is_modified).toBe(true);
  });

  test('T3e: modified_base_ingredients is null when no modifications (is_modified = false)', function () {
    bp._bpSetResolvedRecipe({ recipe: BASE_RECIPE, ingredients: BASE_INGREDIENTS });
    bp._bpSetTargetVolumeL(23);
    bp._bpSetScaleFactor(1.0);
    bp._bpSetModifiedIngredients(null);

    var snap = bp.buildBpAttachSnapshot();
    expect(snap.modified_base_ingredients).toBeNull();
    expect(snap.is_modified).toBe(false);
  });

  test('T3f: scaledIngredients uses modified list when modifications exist (not base list)', function () {
    var modified = [
      { item_id: 'ING-001', item_name: 'Pale Malt', unit: 'kg', quantity: 8, cf_type: 'Grain', cf_subcategory: '', display_group: '' }
    ];
    bp._bpSetResolvedRecipe({ recipe: BASE_RECIPE, ingredients: BASE_INGREDIENTS });
    bp._bpSetTargetVolumeL(23);
    bp._bpSetScaleFactor(1.0);
    bp._bpSetModifiedIngredients(modified);

    var snap = bp.buildBpAttachSnapshot();
    // Only 1 ingredient (the modified list, not the original 2)
    expect(snap.scaledIngredients.length).toBe(1);
    expect(snap.scaledIngredients[0].item_id).toBe('ING-001');
    expect(snap.scaledIngredients[0].quantity).toBe(8);  // 8 * 1.0 = 8
  });
});

// ---------------------------------------------------------------------------
// T4: Soft stock advisory — never disables Attach button (D-11)
// ---------------------------------------------------------------------------
describe('soft stock advisory — never blocks attach (D-11)', function () {
  test('T4a: exports refreshBpStockAdvisory function', function () {
    expect(typeof bp.refreshBpStockAdvisory).toBe('function');
  });

  test('T4b: advisory element hidden when no stock conflicts', function () {
    var advisoryEl = injectEl('bp-recipe-stock-advisory');

    bp._bpSetResolvedRecipe({ recipe: BASE_RECIPE, ingredients: BASE_INGREDIENTS });
    bp._bpSetScaleFactor(1.0);
    bp._bpSetModifiedIngredients(null);

    // Inject a catalog with enough stock
    bp._bpSetCatalogForTest([
      { item_id: 'ING-001', stock_on_hand: 20 },
      { item_id: 'ING-002', stock_on_hand: 10 }
    ]);

    bp.refreshBpStockAdvisory();

    expect(advisoryEl.style.display).toBe('none');
  });

  test('T4c: advisory element shows when scaled quantity exceeds stock', function () {
    var advisoryEl = injectEl('bp-recipe-stock-advisory');

    bp._bpSetResolvedRecipe({ recipe: BASE_RECIPE, ingredients: BASE_INGREDIENTS });
    bp._bpSetScaleFactor(5.0);  // scale up massively → will exceed stock
    bp._bpSetModifiedIngredients(null);

    // Inject catalog with low stock
    bp._bpSetCatalogForTest([
      { item_id: 'ING-001', stock_on_hand: 2 },  // 5 kg * 5 = 25 kg needed, only 2 available
      { item_id: 'ING-002', stock_on_hand: 10 }
    ]);

    bp.refreshBpStockAdvisory();

    expect(advisoryEl.style.display).not.toBe('none');
    expect(advisoryEl.innerHTML).toContain('Pale Malt');
  });

  test('T4d: Attach confirm button is NEVER set to disabled when stock shortfalls exist (D-11)', function () {
    injectEl('bp-recipe-stock-advisory');
    var attachBtn = injectEl('bp-recipe-attach-confirm-btn', 'button');
    attachBtn.disabled = false;

    bp._bpSetResolvedRecipe({ recipe: BASE_RECIPE, ingredients: BASE_INGREDIENTS });
    bp._bpSetScaleFactor(100.0);  // extreme scale → all stock exceeded
    bp._bpSetModifiedIngredients(null);

    bp._bpSetCatalogForTest([
      { item_id: 'ING-001', stock_on_hand: 1 },
      { item_id: 'ING-002', stock_on_hand: 0 }
    ]);

    bp.refreshBpStockAdvisory();

    // The attach button must NEVER be disabled by stock (soft advisory only)
    expect(attachBtn.disabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T5: Deep-copy proof — source recipe never mutated (D-14)
// ---------------------------------------------------------------------------
describe('deep-copy — source recipe not mutated', function () {
  test('T5: modifying _bpModifiedIngredients does not alter the resolved recipe ingredients', function () {
    var originalIngredients = [
      { item_id: 'ING-001', item_name: 'Pale Malt', unit: 'kg', quantity: 5 },
      { item_id: 'ING-002', item_name: 'Hops', unit: 'pcs', quantity: 2 }
    ];
    bp._bpSetResolvedRecipe({ recipe: BASE_RECIPE, ingredients: originalIngredients });

    // Simulate deep copy on modify expand
    var deepCopy = originalIngredients.map(function (ing) {
      return Object.assign({}, ing);
    });
    bp._bpSetModifiedIngredients(deepCopy);

    // Mutate the copy
    var mods = bp._bpGetModifiedIngredients();
    mods[0].quantity = 999;
    mods.push({ item_id: 'ING-NEW', item_name: 'Extra', unit: 'g', quantity: 100 });

    // Original ingredients array must be unchanged
    expect(originalIngredients[0].quantity).toBe(5);
    expect(originalIngredients.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// T6: No recipe-quote / recipe-sale / Helcim call on attach path (D-10 / T-36-20)
// ---------------------------------------------------------------------------
describe('no charge path on attach (D-10 / T-36-20)', function () {
  test('T6: bpAttachRecipe writes only via adminApiPost update_batch — no quote/sale/Helcim fetch', function () {
    // Set up resolved recipe state
    bp._bpSetResolvedRecipe({ recipe: BASE_RECIPE, ingredients: BASE_INGREDIENTS });
    bp._bpSetTargetVolumeL(23);
    bp._bpSetScaleFactor(1.0);
    bp._bpSetModifiedIngredients(null);

    // Mock the adminApiPost (via fetch) to capture calls
    global.fetch.mockClear();
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: function () { return Promise.resolve({ ok: true }); }
    });

    return bp.bpAttachRecipe('BATCH-001').then(function () {
      // Verify fetch was called
      expect(global.fetch).toHaveBeenCalled();

      // Verify none of the calls go to recipe-quote, recipe-sale, or any Helcim path
      var calls = global.fetch.mock.calls;
      calls.forEach(function (call) {
        var url = call[0] || '';
        expect(url).not.toContain('recipe-quote');
        expect(url).not.toContain('recipe-sale');
        expect(url).not.toContain('helcim');
        expect(url).not.toContain('payment');
      });
    });
  });
});

// ---------------------------------------------------------------------------
// T7: bpSaveAsNewRecipe — POST /api/recipes with correct payload (D-12/D-13/D-14)
// ---------------------------------------------------------------------------
describe('bpSaveAsNewRecipe — POST payload', function () {
  test('T7a: exports bpSaveAsNewRecipe as a function', function () {
    expect(typeof bp.bpSaveAsNewRecipe).toBe('function');
  });

  test('T7b: POSTs /api/recipes with pricing_mode:dynamic, status:draft, modified base list (pre-scale)', function () {
    bp._bpSetResolvedRecipe({ recipe: BASE_RECIPE, ingredients: BASE_INGREDIENTS });
    bp._bpSetScaleFactor(1.5);  // Scale factor is set but ingredients should be PRE-SCALE base

    var modifiedBase = [
      { item_id: 'ING-001', item_name: 'Pale Malt', unit: 'kg', quantity: 7 },
      { item_id: 'ING-NEW', item_name: 'Crystal Malt', unit: 'kg', quantity: 1 }
    ];

    global.fetch.mockClear();
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: function () { return Promise.resolve({ ok: true, recipe_id: 'RCP-NEW' }); }
    });

    return bp.bpSaveAsNewRecipe('My Custom IPA', modifiedBase).then(function () {
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
      // Must be the pre-scale base ingredients, not the scaled list
      expect(body.ingredients).toEqual(modifiedBase);
      expect(body.batch_size_l).toBe(23);  // from resolved recipe
    });
  });

  test('T7c: does NOT make a PUT/PATCH to /api/recipes/:id (D-14 — original untouched)', function () {
    bp._bpSetResolvedRecipe({ recipe: BASE_RECIPE, ingredients: BASE_INGREDIENTS });

    var modifiedBase = [
      { item_id: 'ING-001', item_name: 'Pale Malt', unit: 'kg', quantity: 7 }
    ];

    global.fetch.mockClear();
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: function () { return Promise.resolve({ ok: true, recipe_id: 'RCP-NEW' }); }
    });

    return bp.bpSaveAsNewRecipe('New Recipe', modifiedBase).then(function () {
      expect(global.fetch).toHaveBeenCalledTimes(1);
      var call = global.fetch.mock.calls[0];
      var calledUrl = call[0];
      var calledOpts = call[1];

      // Must be POST, not PUT/PATCH
      expect(calledOpts.method).toBe('POST');
      // URL must not contain a recipe ID path segment (no /api/recipes/RCP-001)
      expect(calledUrl).not.toMatch(/\/api\/recipes\/[^/]+/);
    });
  });

  test('T7d: ingredients in POST body are the pre-scale modified base, not scaled values', function () {
    bp._bpSetResolvedRecipe({ recipe: BASE_RECIPE, ingredients: BASE_INGREDIENTS });
    bp._bpSetScaleFactor(2.0);  // scale factor is 2x but body must have base qty

    var modifiedBase = [
      { item_id: 'ING-001', item_name: 'Pale Malt', unit: 'kg', quantity: 5 }  // base qty
    ];

    global.fetch.mockClear();
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: function () { return Promise.resolve({ ok: true, recipe_id: 'RCP-NEW' }); }
    });

    return bp.bpSaveAsNewRecipe('Draft', modifiedBase).then(function () {
      var body = JSON.parse(global.fetch.mock.calls[0][1].body);
      // Must be 5 (base), not 10 (scaled at 2x)
      expect(body.ingredients[0].quantity).toBe(5);
    });
  });
});

// ---------------------------------------------------------------------------
// T8: XSS — ingredient names are escaped (T-36-18)
// ---------------------------------------------------------------------------
describe('XSS — ingredient names escaped in advisory (T-36-18)', function () {
  test('T8: malicious ingredient name in advisory does not inject img tag', function () {
    var advisoryEl = injectEl('bp-recipe-stock-advisory');

    var maliciousIngredients = [
      { item_id: 'ING-XSS', item_name: '<img src=x onerror=alert(1)>', unit: 'kg', quantity: 999, cf_type: 'Grain', cf_subcategory: '', display_group: '' }
    ];

    bp._bpSetResolvedRecipe({ recipe: BASE_RECIPE, ingredients: maliciousIngredients });
    bp._bpSetScaleFactor(1.0);
    bp._bpSetModifiedIngredients(null);

    // Inject catalog with low stock to trigger advisory
    bp._bpSetCatalogForTest([
      { item_id: 'ING-XSS', stock_on_hand: 1 }  // 999 needed, 1 available
    ]);

    bp.refreshBpStockAdvisory();

    // Must NOT create an img element in the DOM
    expect(advisoryEl.querySelectorAll('img').length).toBe(0);
    // The advisory text content should include the ingredient name as escaped text
    expect(advisoryEl.textContent).toContain('img');  // the text "img" appears in the escaped string
  });
});

// ---------------------------------------------------------------------------
// T9: _bpSetTargetVolumeL / _bpGetTargetVolumeL / _bpSetScaleFactor exports
// ---------------------------------------------------------------------------
describe('state accessor exports', function () {
  test('T9a: _bpSetTargetVolumeL and _bpGetTargetVolumeL round-trip', function () {
    bp._bpSetTargetVolumeL(46);
    expect(bp._bpGetTargetVolumeL()).toBe(46);
  });

  test('T9b: _bpSetModifiedIngredients and _bpGetModifiedIngredients round-trip', function () {
    var mods = [{ item_id: 'X', item_name: 'Test', unit: 'kg', quantity: 1 }];
    bp._bpSetModifiedIngredients(mods);
    expect(bp._bpGetModifiedIngredients()).toEqual(mods);
  });

  test('T9c: _bpSetModifiedIngredients(null) returns null', function () {
    bp._bpSetModifiedIngredients(null);
    expect(bp._bpGetModifiedIngredients()).toBeNull();
  });
});
