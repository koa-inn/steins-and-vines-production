'use strict';

// =============================================================================
// Tests: BrewPad recipe-attach volume + ×factor two-way sync (GAP-3, 36-11)
//
// BFAC-1: factor → litres: factor 1.5 on base-60L recipe sets _bpTargetVolumeL = 90
//         and litres input value = 90
// BFAC-2: litres → factor: litres 90 on base-60L sets factor input value = "1.50"
// BFAC-3: bounds: factor ≤ 0 is rejected; factor > 10 is clamped so litres ≤ base × 10
// BFAC-4: no-base disable: no batch_size_l disables BOTH inputs + shows "Set batch size" copy
// BFAC-5: no quote/charge (D-10): editing the factor does NOT call recipe-quote, recipe-sale,
//         or any Helcim/payment path — only updates _bpTargetVolumeL + readout
// BFAC-6: snapshot carries volume: after factor 1.5 on base-60L, snapshot target_volume_l = 90
// =============================================================================

// ---------------------------------------------------------------------------
// Environment stubs (mirror brewpad-recipe-attach-modify.test.js pattern)
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
// Helpers
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

function injectInput(id, type) {
  var existing = document.getElementById(id);
  if (existing) return existing;
  var el = document.createElement('input');
  el.id = id;
  el.type = type || 'number';
  document.body.appendChild(el);
  return el;
}

// Inject the minimal DOM that wireAttachExpandedPanel reads.
// All elements are null-guarded so missing ones are silently skipped.
function injectAttachDOM() {
  injectEl('bp-recipe-volume-wrap', 'div');
  injectInput('bp-target-volume', 'number');
  injectInput('bp-target-factor', 'number');
  injectEl('bp-scale-factor-readout', 'div');
  injectEl('bp-recipe-modify-wrap', 'div');
  injectEl('bp-modify-toggle', 'button');
  injectEl('bp-modify-panel', 'div');
  injectEl('bp-modify-tbody', 'tbody');
  injectEl('bp-modify-add-row', 'button');
  injectEl('bp-recipe-stock-advisory', 'div');
  injectEl('bp-recipe-attach-confirm-btn', 'button');
  injectEl('bp-save-as-new-wrap', 'div');
  injectEl('bp-save-as-new-btn', 'button');
  injectEl('bp-save-as-new-prompt', 'div');
  injectInput('bp-new-recipe-name', 'text');
  injectEl('bp-save-draft-btn', 'button');
  injectEl('bp-save-cancel-btn', 'button');
}

// Fire oninput event on an input element with new value.
function fireInput(el, value) {
  el.value = value;
  if (typeof el.oninput === 'function') el.oninput();
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
var BASE_RECIPE_60L = {
  recipe_id: 'RCP-BFAC1',
  name: 'BFAC Test Ale',
  style: 'Ale',
  batch_size_l: 60,
  pricing_mode: 'dynamic',
  locked_price: 0,
  service_fee: 45,
  materials_fee: 5,
  abv: 5.0
};

var BASE_INGREDIENTS_60L = [
  { item_id: 'ING-001', item_name: 'Pale Malt', unit: 'kg', quantity: 12, cf_type: 'Grain', cf_subcategory: '', display_group: '', stock_on_hand: 100 },
  { item_id: 'ING-002', item_name: 'Cascade Hops', unit: 'pcs', quantity: 2, cf_type: 'Hops', cf_subcategory: '', display_group: '', stock_on_hand: 50 }
];

var RECIPE_NO_BASE = {
  recipe_id: 'RCP-NOBASE',
  name: 'No Base Recipe',
  style: 'Lager',
  batch_size_l: 0,
  pricing_mode: 'dynamic',
  locked_price: 0,
  service_fee: 0,
  materials_fee: 0,
  abv: 0
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
  if (bp._bpSetTargetVolumeL)       bp._bpSetTargetVolumeL(null);
  if (bp._bpSetModifiedIngredients) bp._bpSetModifiedIngredients(null);
  if (bp._bpSetResolvedRecipe)      bp._bpSetResolvedRecipe(null);
  if (bp._bpSetScaleFactor)         bp._bpSetScaleFactor(1.0);

  injectAttachDOM();
});

afterEach(function () {
  document.body.innerHTML = '';
});

// ---------------------------------------------------------------------------
// BFAC-1: factor → litres sync
// ---------------------------------------------------------------------------
describe('BFAC-1: factor → litres sync', function () {
  test('BFAC-1: setting factor to 1.5 on base-60L recipe sets _bpTargetVolumeL to 90 and litres input to 90', function () {
    bp._bpSetResolvedRecipe({ recipe: BASE_RECIPE_60L, ingredients: BASE_INGREDIENTS_60L });
    bp._bpWireAttachExpandedPanel({ batch_id: 'BATCH-001' });

    var factorInput = document.getElementById('bp-target-factor');
    var volInput    = document.getElementById('bp-target-volume');

    // Initially pre-filled: litres = 60, factor = 1.00
    expect(parseFloat(volInput.value)).toBeCloseTo(60, 0);
    expect(parseFloat(factorInput.value)).toBeCloseTo(1.00, 1);

    // Edit factor to 1.5
    fireInput(factorInput, '1.5');

    // litres = round(1.5 × 60 to nearest 0.5) = 90
    expect(bp._bpGetTargetVolumeL()).toBeCloseTo(90, 1);
    expect(parseFloat(volInput.value)).toBeCloseTo(90, 1);
  });
});

// ---------------------------------------------------------------------------
// BFAC-2: litres → factor sync
// ---------------------------------------------------------------------------
describe('BFAC-2: litres → factor sync', function () {
  test('BFAC-2: setting litres to 90 on base-60L recipe sets factor input to "1.50"', function () {
    bp._bpSetResolvedRecipe({ recipe: BASE_RECIPE_60L, ingredients: BASE_INGREDIENTS_60L });
    bp._bpWireAttachExpandedPanel({ batch_id: 'BATCH-001' });

    var factorInput = document.getElementById('bp-target-factor');
    var volInput    = document.getElementById('bp-target-volume');

    // Edit litres to 90
    fireInput(volInput, '90');

    // factor = 90 / 60 = 1.5 → displayed as "1.50"
    expect(factorInput.value).toBe('1.50');
    expect(bp._bpGetTargetVolumeL()).toBeCloseTo(90, 1);
  });
});

// ---------------------------------------------------------------------------
// BFAC-3: factor bounds
// ---------------------------------------------------------------------------
describe('BFAC-3: factor bounds', function () {
  test('BFAC-3a: factor ≤ 0 is rejected — no negative/zero litres produced', function () {
    bp._bpSetResolvedRecipe({ recipe: BASE_RECIPE_60L, ingredients: BASE_INGREDIENTS_60L });
    bp._bpWireAttachExpandedPanel({ batch_id: 'BATCH-001' });

    var factorInput = document.getElementById('bp-target-factor');

    // Capture initial volume (should be 60)
    var initialVol = bp._bpGetTargetVolumeL();

    // Enter factor of 0 — should be rejected (return early)
    fireInput(factorInput, '0');

    // _bpTargetVolumeL must remain positive (unchanged or still > 0)
    var targetVol = bp._bpGetTargetVolumeL();
    expect(targetVol === null || targetVol > 0).toBe(true);
    // Should not have changed to a negative or zero value
    if (targetVol !== null) {
      expect(targetVol).toBeGreaterThan(0);
    }
    // Check initial vol preserved
    expect(bp._bpGetTargetVolumeL()).toBe(initialVol);
  });

  test('BFAC-3b: factor > 10 is clamped so litres ≤ base × 10 (600 L for base 60 L)', function () {
    bp._bpSetResolvedRecipe({ recipe: BASE_RECIPE_60L, ingredients: BASE_INGREDIENTS_60L });
    bp._bpWireAttachExpandedPanel({ batch_id: 'BATCH-001' });

    var factorInput = document.getElementById('bp-target-factor');

    // Enter factor of 15 (exceeds max of 10)
    fireInput(factorInput, '15');

    // litres must be ≤ 60 × 10 = 600
    var targetVol = bp._bpGetTargetVolumeL();
    expect(targetVol).toBeLessThanOrEqual(600);
    // Clamped factor value in input should be ≤ 10
    expect(parseFloat(factorInput.value)).toBeLessThanOrEqual(10);
  });
});

// ---------------------------------------------------------------------------
// BFAC-4: no-base disables BOTH inputs
// ---------------------------------------------------------------------------
describe('BFAC-4: no-base-recipe disables both litres and factor inputs', function () {
  test('BFAC-4: recipe with batch_size_l=0 disables both #bp-target-volume and #bp-target-factor', function () {
    bp._bpSetResolvedRecipe({ recipe: RECIPE_NO_BASE, ingredients: [] });
    bp._bpWireAttachExpandedPanel({ batch_id: 'BATCH-002' });

    var volInput    = document.getElementById('bp-target-volume');
    var factorInput = document.getElementById('bp-target-factor');

    expect(volInput.disabled).toBe(true);
    expect(factorInput.disabled).toBe(true);

    // Readout should show the no-base copy
    var rdout = document.getElementById('bp-scale-factor-readout');
    expect(rdout.textContent).toContain('Set batch size (L)');
  });
});

// ---------------------------------------------------------------------------
// BFAC-5: no quote/charge on factor edit (D-10)
// ---------------------------------------------------------------------------
describe('BFAC-5: factor edit fires NO quote/charge/Helcim call (D-10)', function () {
  test('BFAC-5: editing the factor does NOT call recipe-quote, recipe-sale, or any payment path', function () {
    bp._bpSetResolvedRecipe({ recipe: BASE_RECIPE_60L, ingredients: BASE_INGREDIENTS_60L });
    bp._bpWireAttachExpandedPanel({ batch_id: 'BATCH-001' });

    global.fetch.mockClear();  // clear any calls from wiring setup

    var factorInput = document.getElementById('bp-target-factor');

    // Edit factor to 2.0
    fireInput(factorInput, '2.0');

    // If any fetch was called at all, it must NOT be a quote/sale/payment call
    var calls = global.fetch.mock.calls;
    calls.forEach(function (call) {
      var url = typeof call[0] === 'string' ? call[0] : '';
      expect(url).not.toContain('recipe-quote');
      expect(url).not.toContain('recipe-sale');
      expect(url).not.toContain('helcim');
      expect(url).not.toContain('payment');
    });

    // _bpTargetVolumeL must have been updated (side effect of factor edit)
    // 2.0 × 60 = 120 (rounded to nearest 0.5 = 120)
    expect(bp._bpGetTargetVolumeL()).toBeCloseTo(120, 1);

    // The readout must reflect the new factor (not a charge call)
    var rdout = document.getElementById('bp-scale-factor-readout');
    expect(rdout.textContent).toContain('2.00');
  });
});

// ---------------------------------------------------------------------------
// BFAC-6: snapshot carries the factor-derived volume (D-10 record-keeping)
// ---------------------------------------------------------------------------
describe('BFAC-6: snapshot target_volume_l reflects the factor-derived litres', function () {
  test('BFAC-6: after setting factor 1.5 on base-60L recipe, snapshot.target_volume_l = 90', function () {
    bp._bpSetResolvedRecipe({ recipe: BASE_RECIPE_60L, ingredients: BASE_INGREDIENTS_60L });
    bp._bpWireAttachExpandedPanel({ batch_id: 'BATCH-001' });

    var factorInput = document.getElementById('bp-target-factor');

    // Set factor to 1.5 → litres = 90
    fireInput(factorInput, '1.5');

    // Now build the snapshot and verify target_volume_l carries the factor-derived litres
    var snap = bp.buildBpAttachSnapshot();

    expect(snap.target_volume_l).toBeCloseTo(90, 1);
    // Scale factor in snapshot should also be ~1.5
    expect(snap.scale_factor).toBeCloseTo(1.5, 1);
  });
});
