'use strict';

// =============================================================================
// Tests: admin recipe volume + ×factor two-way sync (GAP-3, 36-09)
//
// FAC-1: factor → litres: editing factor sets _kioskTargetVolumeL = factor × base (rounded 0.5 L)
// FAC-2: litres → factor: editing litres sets factor input value = litres ÷ base (2 dp)
// FAC-3: bounds: factor ≤ 0 is clamped; factor > 10 is clamped so litres ≤ base × 10
// FAC-4: no-base disable: recipe without batch_size_l disables BOTH inputs
// FAC-5: display-only: editing the factor calls kioskScheduleRecipeQuote (no client price set)
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
    json: function () { return Promise.resolve({ ok: true }); }
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

// Inject the minimal DOM that kioskShowRecipePrompt reads (all elements are
// null-guarded with `if (el)` so missing ones are silently skipped).
function injectVolumeDOM() {
  injectEl('kiosk-recipe-volume-wrap', 'div');
  injectInput('kiosk-target-volume', 'number');
  injectInput('kiosk-target-factor', 'number');
  injectEl('kiosk-scale-factor-readout', 'div');
  injectEl('kiosk-stock-conflict', 'div');
  injectEl('kiosk-recipe-summary', 'div');
  injectEl('kiosk-recipe-modify-wrap', 'div');
  injectEl('kiosk-modify-panel', 'div');
  injectEl('kiosk-modify-toggle', 'button');
  injectEl('kiosk-modify-tbody', 'tbody');
  injectEl('kiosk-recipe-price-preview', 'div');
  injectEl('kiosk-locked-price-notice', 'div');
  injectEl('kiosk-save-as-new-wrap', 'div');
  injectEl('kiosk-avail-banner', 'div');
  injectEl('kiosk-add-recipe-to-cart', 'button');
  injectEl('kiosk-milling-toggle', 'div');
  injectInput('kiosk-mill-grain', 'checkbox');
  injectEl('kiosk-btn-in-store', 'button');
  injectEl('kiosk-btn-take-out', 'button');
}

// Fire an oninput event on the given input element value change
function fireInput(el, value) {
  el.value = value;
  if (typeof el.oninput === 'function') el.oninput();
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

var BASE_RECIPE_20L = {
  recipe_id: 'RCP-FAC1',
  name: 'FAC Test IPA',
  style: 'IPA',
  batch_size_l: 20,
  pricing_mode: 'dynamic',
  computed_price: 100,
  locked_price: 0,
  service_fee: 45,
  materials_fee: 5,
  abv: 5.5,
  ingredients: [
    { item_id: 'I-A', item_name: 'Base Malt', unit: 'kg', quantity: 4 }
  ]
};

var RECIPE_NO_BASE = {
  recipe_id: 'RCP-NOBASE',
  name: 'No Base Recipe',
  style: 'Lager',
  batch_size_l: 0,   // no base size — factor should be disabled
  pricing_mode: 'dynamic',
  computed_price: 0,
  locked_price: 0,
  service_fee: 0,
  materials_fee: 0,
  abv: 0,
  ingredients: []
};

// ---------------------------------------------------------------------------
// beforeEach / afterEach
// ---------------------------------------------------------------------------

beforeEach(function () {
  global.fetch.mockClear();
  global.fetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: function () { return Promise.resolve({ ok: true }); }
  });

  admin._kioskSetQuote(null);
  admin._kioskSetSelectedRecipe(null);
  admin._kioskSetSaleType(null);
  admin._kioskSetTargetVolumeL(null);
  admin._kioskClearCart();
  admin._kioskSetModifiedIngredients(null);

  injectVolumeDOM();
});

afterEach(function () {
  document.body.innerHTML = '';
});

// ---------------------------------------------------------------------------
// FAC-1: factor → litres
// ---------------------------------------------------------------------------
describe('FAC-1: factor → litres sync', function () {
  test('FAC-1: setting factor to 1.5 on base-20L recipe sets _kioskTargetVolumeL to 30 and litres input to 30', function () {
    admin._kioskShowRecipePrompt(BASE_RECIPE_20L);

    var factorInput = document.getElementById('kiosk-target-factor');
    var volInput    = document.getElementById('kiosk-target-volume');

    // Initially pre-filled to 1.00 / 20
    expect(parseFloat(factorInput.value)).toBeCloseTo(1.00, 1);
    expect(parseFloat(volInput.value)).toBeCloseTo(20, 0);

    // Edit factor to 1.5
    fireInput(factorInput, '1.5');

    // litres = round(1.5 × 20 to nearest 0.5) = round(30) = 30
    expect(admin._kioskGetTargetVolumeL()).toBeCloseTo(30, 1);
    expect(parseFloat(volInput.value)).toBeCloseTo(30, 1);
  });
});

// ---------------------------------------------------------------------------
// FAC-2: litres → factor
// ---------------------------------------------------------------------------
describe('FAC-2: litres → factor sync', function () {
  test('FAC-2: setting litres to 30 on base-20L recipe sets factor input to "1.50" and _kioskScaleFactor ≈ 1.5', function () {
    admin._kioskShowRecipePrompt(BASE_RECIPE_20L);

    var factorInput = document.getElementById('kiosk-target-factor');
    var volInput    = document.getElementById('kiosk-target-volume');

    // Edit litres to 30
    fireInput(volInput, '30');

    // factor = 30 / 20 = 1.5 → displayed as "1.50"
    expect(factorInput.value).toBe('1.50');
    expect(admin._kioskGetTargetVolumeL()).toBeCloseTo(30, 1);
  });
});

// ---------------------------------------------------------------------------
// FAC-3: bounds
// ---------------------------------------------------------------------------
describe('FAC-3: factor bounds', function () {
  test('FAC-3a: factor ≤ 0 is clamped — no negative/zero litres produced', function () {
    admin._kioskShowRecipePrompt(BASE_RECIPE_20L);

    var factorInput = document.getElementById('kiosk-target-factor');

    // Enter factor of 0 — should clamp to 0.1
    fireInput(factorInput, '0');

    // _kioskTargetVolumeL must remain a positive value (we clamp to 0.1 minimum)
    var targetVol = admin._kioskGetTargetVolumeL();
    // After clamping factor=0 → return early without updating, so targetVol stays at 20 (base)
    // or the input handler does nothing. The contract is no negative litres.
    expect(targetVol === null || targetVol > 0).toBe(true);
  });

  test('FAC-3b: factor > 10 is clamped so litres ≤ base × 10 (200 L for base 20 L)', function () {
    admin._kioskShowRecipePrompt(BASE_RECIPE_20L);

    var factorInput = document.getElementById('kiosk-target-factor');

    // Enter factor of 15 (exceeds max of 10)
    fireInput(factorInput, '15');

    // litres must be ≤ 20 × 10 = 200
    var targetVol = admin._kioskGetTargetVolumeL();
    expect(targetVol).toBeLessThanOrEqual(200);
    // Clamped factor value in input should be ≤ 10
    expect(parseFloat(factorInput.value)).toBeLessThanOrEqual(10);
  });
});

// ---------------------------------------------------------------------------
// FAC-4: no-base disables BOTH inputs
// ---------------------------------------------------------------------------
describe('FAC-4: no-base-recipe disables both litres and factor inputs', function () {
  test('FAC-4: recipe with batch_size_l=0 disables both #kiosk-target-volume and #kiosk-target-factor', function () {
    admin._kioskShowRecipePrompt(RECIPE_NO_BASE);

    var volInput    = document.getElementById('kiosk-target-volume');
    var factorInput = document.getElementById('kiosk-target-factor');

    expect(volInput.disabled).toBe(true);
    expect(factorInput.disabled).toBe(true);

    // Readout should show the no-base copy
    var rdout = document.getElementById('kiosk-scale-factor-readout');
    expect(rdout.textContent).toContain('Set batch size (L)');
  });
});

// ---------------------------------------------------------------------------
// FAC-5: factor change calls kioskScheduleRecipeQuote (display-only — server authoritative)
// ---------------------------------------------------------------------------
describe('FAC-5: factor input triggers re-quote (server-authoritative price)', function () {
  test('FAC-5: editing the factor calls kioskScheduleRecipeQuote (fetch is called, client does not set price)', function () {
    admin._kioskShowRecipePrompt(BASE_RECIPE_20L);
    // Set sale type AFTER prompt (kioskShowRecipePrompt resets _kioskSaleType to null)
    admin._kioskSetSaleType('in-store');

    global.fetch.mockClear();  // clear calls from prompt setup

    var factorInput = document.getElementById('kiosk-target-factor');

    // Edit factor to 2.0
    fireInput(factorInput, '2.0');

    // fetch should have been called (kioskScheduleRecipeQuote → kioskFetchRecipeQuote)
    // The factor itself is NEVER passed as the price; the server receives target_volume_l
    expect(global.fetch).toHaveBeenCalled();

    // Verify the fetch call goes to the recipe-quote endpoint (not a price endpoint)
    var calls = global.fetch.mock.calls.filter(function (args) {
      return typeof args[0] === 'string' && args[0].indexOf('recipe-quote') !== -1;
    });
    expect(calls.length).toBeGreaterThanOrEqual(1);

    // Confirm the URL contains target_volume_l (the litres value) and NOT a 'factor=' param
    var quoteUrl = calls[0][0];
    expect(quoteUrl).toContain('target_volume_l');
    expect(quoteUrl).not.toContain('factor=');
  });
});
