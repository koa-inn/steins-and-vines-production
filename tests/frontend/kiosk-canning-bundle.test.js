'use strict';

// Phase 90 (D-11..D-16, D-25): kiosk canning bundle lifecycle, rendering, payload.

global.window = global.window || {};
global.navigator = global.navigator || { userAgent: 'test' };
global.console = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() };
global.alert = jest.fn();
global.fetch = jest.fn(function () {
  return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({}); } });
});
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

function loadKiosk() {
  jest.resetModules();
  if (global.window) delete global.window.KioskCore;
  document.body.innerHTML = '';
  require('../../js/kiosk.js'); // eslint-disable-line global-require -- per-test isolation
  return global.window.KioskCore;
}

function injectEl(id, tag) {
  var el = document.createElement(tag || 'div');
  el.id = id;
  document.body.appendChild(el);
  return el;
}

function flushPromises() {
  return new Promise(function (resolve) { setTimeout(resolve, 0); });
}

var CAN_473 = { item_id: 'can473', name: 'Can 473 mL', sku: 'CAN-473', rate: 0.5, tax_percentage: 12, product_type: 'goods', stock_on_hand: 5000 };
var CAN_355 = { item_id: 'can355', name: 'Can 355 mL', sku: 'can-355', rate: 0.45, tax_percentage: 12, product_type: 'goods', stock_on_hand: 5000 };
var KIT = { item_id: 'kit1', name: 'Zero Kit', sku: 'kit-1', rate: 80, tax_percentage: 0, product_type: 'goods' };

function seedCatalog(core, items) {
  var products = core._getProducts();
  products.length = 0;
  (items || [CAN_473, CAN_355]).forEach(function (p) { products.push(p); });
}

function setup(withCatalog) {
  localStorage.clear();
  var core = loadKiosk();
  injectEl('kiosk-cart-items');
  injectEl('kiosk-cart-totals');
  injectEl('kiosk-subtotal');
  injectEl('kiosk-tax');
  injectEl('kiosk-total');
  core._setCart({});
  if (withCatalog !== false) seedCatalog(core);
  return core;
}

beforeEach(function () {
  global.fetch.mockReset();
  global.fetch.mockImplementation(function () {
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({}); } });
  });
});

describe('addCanningBundle', function () {
  test('adds the bundle line and a $0 can copy; catalog keeps its rate', function () {
    var core = setup();
    var res = core.addCanningBundle({ bundleKey: 'beer-25', canSize: 473, count: 52 });
    expect(res.ok).toBe(true);
    var cart = core._getCart();
    expect(cart['bundle-line'].qty).toBe(1);
    expect(cart['bundle-line'].item).toMatchObject({
      custom: true,
      bundle_key: 'beer-25',
      description: 'Canning Bundle — Beer 25 L (473 mL)',
      rate: 40,
      tax_percentage: 12,
      taxable: true
    });
    expect(cart['bundle-can'].qty).toBe(52);
    expect(cart['bundle-can'].item.rate).toBe(0);
    expect(cart['bundle-can'].item.bundle_can).toBe(true);
    expect(cart['bundle-can'].item.item_id).toBe('can473');
    expect(CAN_473.rate).toBe(0.5);
    expect(CAN_473.bundle_can).toBeUndefined();
    expect(cart['bundle-can'].item).not.toBe(CAN_473);
  });

  test('bundle keys are the first keys of the cart even with earlier items', function () {
    var core = setup();
    core._setCart({ kit1: { item: KIT, qty: 1 } });
    core.addCanningBundle({ bundleKey: 'cider-23', canSize: 355, count: 64 });
    expect(Object.keys(core._getCart())).toEqual(['bundle-line', 'bundle-can', 'kit1']);
  });

  test('bundle alone totals 40.00 + 4.80 = 44.80', function () {
    var core = setup();
    core.addCanningBundle({ bundleKey: 'beer-25', canSize: 473, count: 52 });
    var t = core.calcTotals();
    expect(t.subtotal).toBe(40);
    expect(t.tax).toBe(4.8);
    expect(t.total).toBe(44.8);
  });

  test('rejections leave the cart unchanged', function () {
    var core = setup();
    expect(core.addCanningBundle({ bundleKey: 'wine-still', canSize: 473, count: 10 })).toEqual({ ok: false, reason: 'unknown_bundle' });
    expect(core.addCanningBundle({ bundleKey: 'beer-25', canSize: 500, count: 10 }).ok).toBe(false);
    expect(core.addCanningBundle({ bundleKey: 'beer-25', canSize: 473, count: 0 }).reason).toBe('bad_count');
    expect(core.addCanningBundle({ bundleKey: 'beer-25', canSize: 473, count: 101 }).reason).toBe('bad_count');
    expect(Object.keys(core._getCart())).toEqual([]);

    core._setRecipeContext({ recipe_id: 'R1' });
    expect(core.addCanningBundle({ bundleKey: 'beer-25', canSize: 473, count: 52 })).toEqual({ ok: false, reason: 'recipe_cart' });
    core._setRecipeContext(null);

    seedCatalog(core, [CAN_355]);
    expect(core.addCanningBundle({ bundleKey: 'beer-25', canSize: 473, count: 52 })).toEqual({ ok: false, reason: 'can_item_missing' });
    expect(Object.keys(core._getCart())).toEqual([]);
  });

  test('a second bundle is refused', function () {
    var core = setup();
    core.addCanningBundle({ bundleKey: 'beer-25', canSize: 473, count: 52 });
    var before = JSON.stringify(core._getCart());
    expect(core.addCanningBundle({ bundleKey: 'cider-23', canSize: 355, count: 64 })).toEqual({ ok: false, reason: 'already_added' });
    expect(JSON.stringify(core._getCart())).toBe(before);
  });
});

describe('bundle lifecycle', function () {
  test('can count edits change only the can line and report the cap', function () {
    var core = setup();
    core.addCanningBundle({ bundleKey: 'beer-25', canSize: 473, count: 52 });
    var r = core.setBundleCanCount(60);
    expect(r.overCap).toBe(true);
    expect(core._getCart()['bundle-can'].qty).toBe(60);
    expect(core._getCart()['bundle-line'].item.rate).toBe(40);
    expect(core.calcTotals().total).toBe(44.8);
    expect(core.setBundleCanCount(54).overCap).toBe(false);
    expect(core.setBundleCanCount(55).overCap).toBe(false);
    expect(core.setBundleCanCount(56).overCap).toBe(true);
  });

  test('bundle line qty is pinned at 1', function () {
    var core = setup();
    core.addCanningBundle({ bundleKey: 'beer-25', canSize: 473, count: 52 });
    var container = document.getElementById('kiosk-cart-items');
    expect(container.querySelector('[data-id="bundle-line"].kiosk-qty-btn')).toBeNull();
    expect(container.querySelector('input[data-id="bundle-line"]')).toBeNull();
    expect(container.querySelector('input[data-id="bundle-can"]')).not.toBeNull();
  });

  test('removing either line removes both; so does clear cart', function () {
    var core = setup();
    core.addCanningBundle({ bundleKey: 'beer-25', canSize: 473, count: 52 });
    document.querySelector('.kiosk-cart-remove-btn[data-id="bundle-line"]').click();
    expect(Object.keys(core._getCart())).toEqual([]);

    core.addCanningBundle({ bundleKey: 'beer-25', canSize: 473, count: 52 });
    document.querySelector('.kiosk-cart-remove-btn[data-id="bundle-can"]').click();
    expect(Object.keys(core._getCart())).toEqual([]);

    core.addCanningBundle({ bundleKey: 'beer-25', canSize: 473, count: 52 });
    core.removeCanningBundle();
    expect(Object.keys(core._getCart())).toEqual([]);
  });

  test('decrementing the can line to zero removes both lines', function () {
    var core = setup();
    core.addCanningBundle({ bundleKey: 'beer-25', canSize: 473, count: 1 });
    document.querySelector('.kiosk-qty-btn[data-id="bundle-can"][data-action="dec"]').click();
    expect(Object.keys(core._getCart())).toEqual([]);
  });

  test('discounts never touch the bundle line (D-14)', function () {
    var core = setup();
    core.init({ getDiscount: function () { return { scope: 'cart', type: 'percentage', value: 50 }; } });
    core.addCanningBundle({ bundleKey: 'beer-25', canSize: 473, count: 52 });
    var t = core.calcTotals();
    expect(t.discount).toBe(0);
    expect(t.total).toBe(44.8);
  });
});

describe('cart rendering', function () {
  test('bundle row shows 12% tax, can row shows Included in bundle', function () {
    var core = setup();
    core.addCanningBundle({ bundleKey: 'beer-25', canSize: 473, count: 52 });
    var html = document.getElementById('kiosk-cart-items').innerHTML;
    expect(html).toContain('12% tax');
    expect(html).toContain('Included in bundle');
    expect(html).toContain('Canning Bundle');
    expect(html).not.toContain('Above the bundle cap');
  });

  test('over-cap shows an inline warning with OK, one batch and never calls confirm()', function () {
    var core = setup();
    global.confirm = jest.fn(function () { return true; });
    core.addCanningBundle({ bundleKey: 'beer-25', canSize: 473, count: 52 });
    document.querySelector('.kiosk-qty-btn[data-id="bundle-can"][data-action="inc"]').click(); // 53
    expect(document.querySelector('.kiosk-bundle-cap-warn')).toBeNull();
    core.setBundleCanCount(56);
    var warn = document.querySelector('.kiosk-bundle-cap-warn');
    expect(warn.textContent).toContain('Above the bundle cap. Confirm this is one batch.');
    var ok = document.querySelector('.kiosk-bundle-cap-ok');
    expect(ok.textContent).toBe('OK, one batch');
    ok.click();
    expect(document.querySelector('.kiosk-bundle-cap-warn')).toBeNull();
    expect(global.confirm).not.toHaveBeenCalled();
    delete global.confirm;
  });
});

describe('opener gating (D-25)', function () {
  test('standalone kiosk registers the hook: opener renders and calls it', function () {
    var core = setup();
    var hook = jest.fn();
    core.init({ showCanningBundleModal: hook });
    core.removeCanningBundle(); // re-renders the (empty) cart
    var btn = document.getElementById('kiosk-canning-bundle-btn');
    expect(btn).not.toBeNull();
    expect(btn.textContent).toBe('Canning bundle');
    expect(btn.disabled).toBe(false);
    btn.click();
    expect(hook).toHaveBeenCalledTimes(1);
  });

  test('opener is disabled with Bundle added while a bundle exists', function () {
    var core = setup();
    core.init({ showCanningBundleModal: function () {} });
    core.addCanningBundle({ bundleKey: 'beer-25', canSize: 473, count: 52 });
    var btn = document.getElementById('kiosk-canning-bundle-btn');
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe('Bundle added');
  });

  test('no opener in a recipe cart', function () {
    var core = setup();
    core.init({ showCanningBundleModal: function () {} });
    core._setRecipeContext({ recipe_id: 'R1' });
    core.removeCanningBundle();
    expect(document.getElementById('kiosk-canning-bundle-btn')).toBeNull();
  });

  test('a consumer without the hook (admin-embedded) gets no opener', function () {
    jest.resetModules();
    delete global.window.KioskCore;
    document.body.innerHTML = '';
    var core = require('../../js/kiosk-core.js'); // eslint-disable-line global-require -- bare core, no kiosk.js
    injectEl('kiosk-cart-items');
    var cartState = {};
    core.init({ getCart: function () { return cartState; }, setCart: function (v) { cartState = v; } });
    core.removeCanningBundle();
    expect(document.getElementById('kiosk-canning-bundle-btn')).toBeNull();
  });
});

describe('sale payload', function () {
  test('bundle and can lines carry bundle_key / bundle_can and rate 0', async function () {
    var core = setup();
    localStorage.setItem(DEVICE_TOKEN_KEY, 'kiosk-token');
    injectEl('kiosk-payment-items');
    injectEl('kiosk-payment-amount');
    injectEl('kiosk-terminal-msg');
    injectEl('kiosk-spinner');
    core.addCanningBundle({ bundleKey: 'beer-25', canSize: 473, count: 52 });

    core.proceedToPayment();
    await flushPromises();
    document.getElementById('kgcr-skip-btn').click(); // standard sale: skip the gift-card tender step
    await flushPromises();

    var saleCall = global.fetch.mock.calls.find(function (c) {
      return typeof c[0] === 'string' && c[0].indexOf('/api/kiosk/sale') !== -1;
    });
    expect(saleCall).toBeTruthy();
    var body = JSON.parse(saleCall[1].body);
    expect(body.items[0]).toEqual({
      custom: true,
      bundle_key: 'beer-25',
      description: 'Canning Bundle — Beer 25 L (473 mL)',
      note: '',
      quantity: 1,
      rate: 40,
      taxable: true
    });
    expect(body.items[1]).toMatchObject({ item_id: 'can473', bundle_can: true, quantity: 52, rate: 0 });
    expect(body.client_grand_total).toBe(44.8);
  });
});
