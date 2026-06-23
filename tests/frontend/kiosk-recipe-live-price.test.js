'use strict';

// =============================================================================
// Tests: admin kiosk-sale surface — live price visibility (GAP-4, 36-14)
//
// ALP-1: volume change with modify panel CLOSED → #kiosk-recipe-summary-price
//         updated from the SERVER quote total (not client computed_price).
// ALP-2: ×factor change with panel CLOSED → prominent price updated from quote.
// ALP-3: ingredient add/remove/qty change → prominent price updated from quote.
// ALP-4: #kiosk-recipe-price-preview is shown once a sale-type is selected,
//         independent of the modify panel state.
// ALP-5: server-authoritative (D-06) — displayed total from quote response only;
//         a failed/empty quote shows error copy, never a fabricated value.
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
  recipe_id: 'RCP-ALP',
  name: 'Live Price IPA',
  style: 'IPA',
  batch_size_l: 23,
  pricing_mode: 'dynamic',
  computed_price: 109.20,
  locked_price: 0,
  service_fee: 45,
  materials_fee: 5,
  abv: 6.5
};

var QUOTE_TOTAL = 132.00;

var MOCK_QUOTE_SUCCESS = {
  ok: true,
  recipe_id: 'RCP-ALP',
  base_volume_l: 23,
  target_volume_l: 30,
  scale_factor: 1.3,
  pricing_mode: 'dynamic',
  total: QUOTE_TOTAL,
  is_modified: false,
  ingredients: [],
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
// ALP-1: volume change, modify panel CLOSED → prominent price from server quote
// ---------------------------------------------------------------------------
describe('ALP-1: volume change with modify panel closed updates #kiosk-recipe-summary-price', function () {
  test('ALP-1: server quote total is written to prominent price when panel is closed', function () {
    // Inject DOM elements needed by kioskFetchRecipeQuote and kioskUpdateSummaryPrice
    var summaryPriceEl = injectEl('kiosk-recipe-summary-price');
    var previewEl = injectEl('kiosk-recipe-price-preview');
    injectEl('kiosk-add-recipe-to-cart', 'button');

    admin._kioskSetSelectedRecipe(BASE_RECIPE);
    admin._kioskSetSaleType('in-store');
    admin._kioskSetTargetVolumeL(30);
    // Panel is CLOSED (default state after _kioskSetSelectedRecipe)
    // _kioskModifyPanelOpen is false by default

    global.fetch.mockResolvedValueOnce({
      status: 200,
      json: function () { return Promise.resolve(MOCK_QUOTE_SUCCESS); }
    });

    return admin.kioskFetchRecipeQuote().then(function () {
      var priceText = summaryPriceEl.textContent;
      // The prominent price must reflect the server quote total ($132.00)
      expect(priceText).toContain('132');
      // Must NOT show a different fabricated price (computed_price 109.20)
      expect(priceText).not.toBe('Price calculated at checkout');
    });
  });
});

// ---------------------------------------------------------------------------
// ALP-2: ×factor change, modify panel CLOSED → prominent price from server quote
// ---------------------------------------------------------------------------
describe('ALP-2: ×factor change with modify panel closed updates prominent price', function () {
  test('ALP-2: after factor triggers quote, summary-price reflects server total with panel closed', function () {
    var summaryPriceEl = injectEl('kiosk-recipe-summary-price');
    var previewEl = injectEl('kiosk-recipe-price-preview');
    injectEl('kiosk-add-recipe-to-cart', 'button');

    admin._kioskSetSelectedRecipe(BASE_RECIPE);
    admin._kioskSetSaleType('in-store');
    admin._kioskSetTargetVolumeL(46); // 2× factor

    var factorQuote = Object.assign({}, MOCK_QUOTE_SUCCESS, {
      target_volume_l: 46,
      scale_factor: 2.0,
      total: 218.40
    });

    global.fetch.mockResolvedValueOnce({
      status: 200,
      json: function () { return Promise.resolve(factorQuote); }
    });

    return admin.kioskFetchRecipeQuote().then(function () {
      var priceText = summaryPriceEl.textContent;
      expect(priceText).toContain('218');
    });
  });
});

// ---------------------------------------------------------------------------
// ALP-3: ingredient change → prominent price from server quote
// ---------------------------------------------------------------------------
describe('ALP-3: ingredient change updates prominent price from server quote', function () {
  test('ALP-3: modified ingredients quote updates prominent price', function () {
    var summaryPriceEl = injectEl('kiosk-recipe-summary-price');
    var previewEl = injectEl('kiosk-recipe-price-preview');
    injectEl('kiosk-add-recipe-to-cart', 'button');

    admin._kioskSetSelectedRecipe(BASE_RECIPE);
    admin._kioskSetSaleType('in-store');
    admin._kioskSetModifiedIngredients([
      { item_id: 'ING-001', item_name: 'Extra Grain', unit: 'kg', quantity: 3, base_quantity: 0 }
    ]);

    var modQuote = Object.assign({}, MOCK_QUOTE_SUCCESS, {
      total: 145.75,
      is_modified: true
    });

    global.fetch.mockResolvedValueOnce({
      status: 200,
      json: function () { return Promise.resolve(modQuote); }
    });

    return admin.kioskFetchRecipeQuote().then(function () {
      var priceText = summaryPriceEl.textContent;
      expect(priceText).toContain('145');
    });
  });
});

// ---------------------------------------------------------------------------
// ALP-4: #kiosk-recipe-price-preview shown once sale-type selected,
//         regardless of modify panel state
// ---------------------------------------------------------------------------
describe('ALP-4: price-preview visibility independent of modify panel state', function () {
  test('ALP-4: price-preview is shown by kioskFetchRecipeQuote when panel is CLOSED', function () {
    var previewEl = injectEl('kiosk-recipe-price-preview');
    previewEl.style.display = 'none'; // start hidden
    injectEl('kiosk-recipe-summary-price');
    injectEl('kiosk-add-recipe-to-cart', 'button');

    admin._kioskSetSelectedRecipe(BASE_RECIPE);
    admin._kioskSetSaleType('in-store');

    global.fetch.mockResolvedValueOnce({
      status: 200,
      json: function () { return Promise.resolve(MOCK_QUOTE_SUCCESS); }
    });

    return admin.kioskFetchRecipeQuote().then(function () {
      // The preview must be visible (not display:none) after the quote succeeds
      expect(previewEl.style.display).not.toBe('none');
    });
  });

  test('ALP-4b: price-preview loading state shown immediately even before response', function () {
    var previewEl = injectEl('kiosk-recipe-price-preview');
    previewEl.style.display = 'none';
    injectEl('kiosk-recipe-summary-price');
    injectEl('kiosk-add-recipe-to-cart', 'button');

    admin._kioskSetSelectedRecipe(BASE_RECIPE);
    admin._kioskSetSaleType('in-store');

    // Use a deferred promise to check "Calculating..." state before resolve
    var resolveQuote;
    global.fetch.mockReturnValueOnce(
      new Promise(function (resolve) {
        resolveQuote = function () {
          resolve({
            status: 200,
            json: function () { return Promise.resolve(MOCK_QUOTE_SUCCESS); }
          });
        };
      })
    );

    var fetchPromise = admin.kioskFetchRecipeQuote();
    // Before resolving: preview should show Calculating...
    expect(previewEl.innerHTML).toContain('Calculating');
    resolveQuote();
    return fetchPromise;
  });
});

// ---------------------------------------------------------------------------
// ALP-5: server-authoritative (D-06) — displayed price ONLY from server quote;
//         failed quote shows error copy, never a fabricated value
// ---------------------------------------------------------------------------
describe('ALP-5: server-authoritative pricing — no fabricated values', function () {
  test('ALP-5a: failed quote (non-200) shows error copy in price-preview, not a stale number', function () {
    var previewEl = injectEl('kiosk-recipe-price-preview');
    previewEl.style.display = 'none';
    injectEl('kiosk-recipe-summary-price');
    injectEl('kiosk-add-recipe-to-cart', 'button');

    admin._kioskSetSelectedRecipe(BASE_RECIPE);
    admin._kioskSetSaleType('in-store');

    global.fetch.mockResolvedValueOnce({
      status: 503,
      json: function () { return Promise.resolve({ ok: false, error: 'Service unavailable' }); }
    });

    return admin.kioskFetchRecipeQuote().then(function () {
      expect(previewEl.innerHTML).toContain('unavailable');
      // Must not contain a dollar amount (no fabricated price shown)
      expect(previewEl.textContent).not.toMatch(/\$\d+\.\d{2}/);
    });
  });

  test('ALP-5b: network error shows error copy in price-preview, not a stale number', function () {
    var previewEl = injectEl('kiosk-recipe-price-preview');
    previewEl.style.display = 'none';
    injectEl('kiosk-recipe-summary-price');
    injectEl('kiosk-add-recipe-to-cart', 'button');

    admin._kioskSetSelectedRecipe(BASE_RECIPE);
    admin._kioskSetSaleType('in-store');

    global.fetch.mockRejectedValueOnce(new Error('Network error'));

    return admin.kioskFetchRecipeQuote().then(function () {
      expect(previewEl.innerHTML).toContain('unavailable');
      expect(previewEl.textContent).not.toMatch(/\$\d+\.\d{2}/);
    });
  });

  test('ALP-5c: quote success total is written to prominent price (not computed_price)', function () {
    var summaryPriceEl = injectEl('kiosk-recipe-summary-price');
    var previewEl = injectEl('kiosk-recipe-price-preview');
    injectEl('kiosk-add-recipe-to-cart', 'button');

    admin._kioskSetSelectedRecipe(BASE_RECIPE);
    admin._kioskSetSaleType('in-store');

    // Quote returns a DIFFERENT total from computed_price (109.20)
    var distinctQuote = Object.assign({}, MOCK_QUOTE_SUCCESS, { total: 175.00 });
    global.fetch.mockResolvedValueOnce({
      status: 200,
      json: function () { return Promise.resolve(distinctQuote); }
    });

    return admin.kioskFetchRecipeQuote().then(function () {
      var priceText = summaryPriceEl.textContent;
      // Must show 175 (server quote), NOT 109.20 (client computed_price)
      expect(priceText).toContain('175');
      expect(priceText).not.toContain('109');
    });
  });
});
