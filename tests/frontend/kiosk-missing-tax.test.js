'use strict';

// Phase 67-02 Task 1 — regression tests for the kiosk client's silent tax
// guessing (INV-000160, .planning/debug/kiosk-tax-under-quote.md).
//
// Contract these tests pin (fail-closed, never guess):
//   1. A cart line whose item.tax_percentage is missing/unparseable must NOT
//      be taxed at the removed KIOSK_TAX_RATE_DEFAULT 5% — kioskCalcTotals
//      contributes 0 tax for that line and returns a `missingTaxItem` marker
//      naming the offending item (detection is in calcTotals; the BLOCK is at
//      checkout entry, mirroring the 57-03 phantom-item guard shape).
//   2. kioskProceedToPayment with a missing-tax cart line blocks checkout via
//      kioskShowError, naming the item — no sale POST, no payment view flow.
//   3. A legitimate 0% item (tax_percentage === 0) is VALID — never flagged.
//   4. KioskCore.itemTax is consistent with the cart calc: a missing/
//      unparseable tax_percentage returns NaN (a visible data error), never a
//      silent $0.00.
//
// Harness mirrors kiosk-catalog-freshness.test.js / kiosk-core-parity.test.js.

global.window = global.window || {};
global.navigator = global.navigator || { userAgent: 'test' };

global.console = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() };

global.fetch = jest.fn(function () {
  return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({}); } });
});

global.alert = jest.fn();

global.SHEETS_CONFIG = {
  MIDDLEWARE_URL: 'http://localhost:3001',
  MW_API_KEY: 'test-key',
  SPREADSHEET_ID: 'test-id',
  GOOGLE_CLIENT_ID: 'test-client-id',
  STAFF_EMAILS: 'test@example.com',
  API_BASE: 'https://script.google.com/test',
  SERVER_TOKEN: 'test-token'
};

var DEVICE_TOKEN_KEY = 'sv_kiosk_device_token';

function loadSurface(path) {
  jest.resetModules();
  if (global.window) delete global.window.KioskCore;
  document.body.innerHTML = '';
  var mod = require(path); // eslint-disable-line global-require -- intentional dynamic per-surface isolation
  return { mod: mod, core: global.window.KioskCore };
}

function injectEl(id, tag) {
  var el = document.createElement(tag || 'div');
  el.id = id;
  document.body.appendChild(el);
  return el;
}

function mockFetchOnce(status, body, ok) {
  global.fetch.mockImplementationOnce(function () {
    return Promise.resolve({
      ok: typeof ok === 'boolean' ? ok : (status >= 200 && status < 300),
      status: status,
      json: function () { return Promise.resolve(body); }
    });
  });
}

function flushPromises() {
  return new Promise(function (resolve) { setTimeout(resolve, 0); });
}

beforeEach(function () {
  localStorage.clear();
  global.fetch.mockReset();
  global.fetch.mockImplementation(function () {
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({}); } });
  });
});

describe('kioskCalcTotals — missing tax_percentage is a data error, never a 5% guess', function () {

  test('a cart line with undefined tax_percentage is flagged by name and contributes 0 tax', function () {
    var core = loadSurface('../../js/kiosk.js').core;

    core._setCart({
      'GOOD': { item: { item_id: 'GOOD', name: 'Well Taxed Kit', rate: 100, tax_percentage: 12 }, qty: 1 },
      'BAD': { item: { item_id: 'BAD', name: 'Ghost Tax Kit', rate: 50 }, qty: 1 }
    });

    var totals = core.calcTotals();

    // The offending item is named in the returned totals object.
    expect(totals.missingTaxItem).toBe('Ghost Tax Kit');
    // Tax = ONLY the well-taxed line's 12% — the bad line contributes 0,
    // never the removed 5% fallback (which would have made this 14.50).
    expect(totals.tax).toBe(12);
    expect(totals.total).toBe(162);
  });

  test('a cart line with a non-numeric tax_percentage is flagged the same way', function () {
    var core = loadSurface('../../js/kiosk.js').core;

    core._setCart({
      'BAD2': { item: { item_id: 'BAD2', name: 'Corrupt Tax Kit', rate: 40, tax_percentage: 'not-a-number' }, qty: 2 }
    });

    var totals = core.calcTotals();

    expect(totals.missingTaxItem).toBe('Corrupt Tax Kit');
    expect(totals.tax).toBe(0);
    // 5% guess would have produced 84.00 — must be exactly the untaxed subtotal.
    expect(totals.total).toBe(80);
  });

  // Phase 67 review fix (CR-02): the REAL catalog builder
  // (rebuildKioskCatalog) now serves a genuinely unresolvable tax as
  // tax_percentage: null (it previously fabricated 0, which made this gate
  // unreachable in production). parseFloat(null) is NaN → same flag path.
  test('CR-02: a cart line with tax_percentage null (the real builder output for a missing tax) is flagged the same way', function () {
    var core = loadSurface('../../js/kiosk.js').core;

    core._setCart({
      'NULLTAX': { item: { item_id: 'NULLTAX', name: 'Unconfigured Import', rate: 75, tax_percentage: null }, qty: 1 }
    });

    var totals = core.calcTotals();

    expect(totals.missingTaxItem).toBe('Unconfigured Import');
    expect(totals.tax).toBe(0);
    expect(totals.total).toBe(75);
  });

  test('a valid 0% item (tax_percentage === 0) is NOT flagged — 0 is a real resolved rate', function () {
    var core = loadSurface('../../js/kiosk.js').core;

    core._setCart({
      'ZERO': { item: { item_id: 'ZERO', name: 'Zero Rated Ingredient', rate: 30, tax_percentage: 0 }, qty: 1 }
    });

    var totals = core.calcTotals();

    expect(totals.missingTaxItem).toBeFalsy();
    expect(totals.tax).toBe(0);
    expect(totals.total).toBe(30);
  });

  test('a cart of only well-taxed items has no missingTax marker', function () {
    var core = loadSurface('../../js/kiosk.js').core;

    core._setCart({
      'A': { item: { item_id: 'A', name: 'Kit A', rate: 100, tax_percentage: 12 }, qty: 1 },
      'B': { item: { item_id: 'B', name: 'Kit B', rate: 10, tax_percentage: 5 }, qty: 1 }
    });

    var totals = core.calcTotals();

    expect(totals.missingTaxItem).toBeFalsy();
    expect(totals.tax).toBe(12.5);
    expect(totals.total).toBe(122.5);
  });
});

describe('kioskItemTax — consistent with the cart calc (no silent 0% for missing tax)', function () {

  test('missing tax_percentage returns NaN, never a silent 0.00', function () {
    var core = loadSurface('../../js/kiosk.js').core;
    expect(isNaN(core.itemTax({ rate: 10 }, 1))).toBe(true);
    expect(isNaN(core.itemTax({ rate: 10, tax_percentage: 'garbage' }, 2))).toBe(true);
  });

  test('a valid explicit 0% still computes 0 tax (0 is a resolved rate)', function () {
    var core = loadSurface('../../js/kiosk.js').core;
    expect(core.itemTax({ rate: 10, tax_percentage: 0 }, 1)).toBe(0);
    expect(core.itemTax({ rate: 100, tax_percentage: 12 }, 1)).toBe(12);
  });
});

describe('kioskProceedToPayment — missing-tax cart line blocks checkout (fail-closed)', function () {

  test('checkout is blocked via kioskShowError naming the item, and no sale POST fires', async function () {
    localStorage.setItem(DEVICE_TOKEN_KEY, 'kiosk-token');
    var core = loadSurface('../../js/kiosk.js').core;
    injectEl('kiosk-product-grid');
    var errMsgEl = injectEl('kiosk-error-msg');
    var errTitleEl = injectEl('kiosk-error-title');

    // Catalog loaded and CONTAINS the item (so the 57-03 phantom guard passes —
    // this is specifically the missing-TAX gate, not the missing-ITEM gate).
    mockFetchOnce(200, {
      items: [{ item_id: 'BAD', name: 'Ghost Tax Kit', rate: 50 }]
    });
    core.loadProducts();
    await flushPromises();
    expect(core._getProducts()).toHaveLength(1);

    core._setCart({
      'BAD': { item: { item_id: 'BAD', name: 'Ghost Tax Kit', rate: 50 }, qty: 1 }
    });

    var callsBefore = global.fetch.mock.calls.length;
    core.proceedToPayment();

    // Checkout must be blocked BEFORE any sale POST is built/sent.
    var saleCall = global.fetch.mock.calls.slice(callsBefore).find(function (c) {
      return typeof c[0] === 'string' && c[0].indexOf('/api/kiosk/sale') !== -1;
    });
    expect(saleCall).toBeUndefined();

    // kioskShowError surface names the offending item with staff-actionable copy.
    expect(errTitleEl.textContent).toMatch(/tax/i);
    expect(errMsgEl.textContent).toContain('Ghost Tax Kit');
    expect(errMsgEl.textContent).toMatch(/refresh/i);
  });

  // Phase 67 review fix (WR-03): the gate must be scoped like its 57-03
  // phantom-guard sibling — an imported SO's charge amount is the SO's Zoho
  // balance via kioskCollectPayment, so the client's per-line tax resolution
  // is irrelevant to that money path, and the "re-add it" guidance is wrong
  // for SO-built carts (lines are mapped from Zoho, not re-added from the
  // grid). An unresolvable-tax line must NOT block SO payment collection.
  test('WR-03: an imported-SO cart is NOT blocked by the missing-tax gate — SO payment collection proceeds', async function () {
    localStorage.setItem(DEVICE_TOKEN_KEY, 'kiosk-token');
    var core = loadSurface('../../js/kiosk.js').core;
    injectEl('kiosk-product-grid');
    var errMsgEl = injectEl('kiosk-error-msg');
    injectEl('kiosk-error-title');
    injectEl('kiosk-payment-amount');
    injectEl('kiosk-terminal-msg');
    injectEl('kiosk-spinner');

    // SO-imported cart; the line's catalog entry has an unresolvable tax
    // (the real builder's null shape — see CR-02).
    core._setCart({
      'SO-LINE': { item: { item_id: 'SO-LINE', name: 'SO Imported Item', rate: 50, tax_percentage: null }, qty: 1 }
    });
    core._setImportedSo('so-12345', 'SO-001234');

    var callsBefore = global.fetch.mock.calls.length;
    core.proceedToPayment();
    await flushPromises();

    // The missing-tax gate must NOT fire for an SO cart…
    expect(errMsgEl.textContent).not.toContain('SO Imported Item');
    // …and the SO checkout fork must proceed (salesorder-update PUT fires).
    var soCall = global.fetch.mock.calls.slice(callsBefore).find(function (c) {
      return typeof c[0] === 'string' && c[0].indexOf('/api/kiosk/salesorder-update') !== -1;
    });
    expect(soCall).toBeTruthy();
  });

  test('a well-taxed cart is NOT blocked by the missing-tax gate', function () {
    localStorage.setItem(DEVICE_TOKEN_KEY, 'kiosk-token');
    var core = loadSurface('../../js/kiosk.js').core;
    injectEl('kiosk-product-grid');
    var errMsgEl = injectEl('kiosk-error-msg');
    injectEl('kiosk-error-title');

    core._setCart({
      'GOOD': { item: { item_id: 'GOOD', name: 'Well Taxed Kit', rate: 100, tax_percentage: 12 }, qty: 1 }
    });

    core.proceedToPayment();

    // No missing-tax error surfaced (checkout proceeds to the payment step).
    expect(errMsgEl.textContent).not.toContain('Well Taxed Kit');
  });
});
