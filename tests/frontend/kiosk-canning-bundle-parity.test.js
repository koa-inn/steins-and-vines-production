'use strict';

// Phase 90 (D-15, D-22): the client bundle table and display totals must equal
// the server's (zoho-middleware/lib/kiosk-bundles.js + shared fixture).

global.window = global.window || {};
global.navigator = global.navigator || { userAgent: 'test' };
global.console = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() };

var server = require('../../zoho-middleware/lib/kiosk-bundles.js');
var fixture = require('../../zoho-middleware/__tests__/fixtures/canning-bundle-carts.js');

function loadCore() {
  jest.resetModules();
  if (global.window) delete global.window.KioskCore;
  document.body.innerHTML = '';
  return require('../../js/kiosk-core.js'); // eslint-disable-line global-require -- per-test isolation
}

describe('canning bundle table parity', function () {
  test('client table deep-equals the server BUNDLES (price, label, nominal, cap)', function () {
    var core = loadCore();
    expect(JSON.parse(JSON.stringify(core.CANNING_BUNDLES))).toEqual(JSON.parse(JSON.stringify(server.BUNDLES)));
  });

  test('no still-wine bundle exists on either side (D-13)', function () {
    var core = loadCore();
    expect(Object.keys(core.CANNING_BUNDLES).sort()).toEqual(['beer-25', 'cider-23']);
  });
});

describe('canning bundle display totals equal the server fixture totals', function () {
  fixture.CARTS.forEach(function (fx) {
    test(fx.name, function () {
      var core = loadCore();
      var byId = {};
      fixture.CATALOG.forEach(function (c) { byId[c.item_id] = c; });
      var cart = {};
      fx.items.forEach(function (it, i) {
        if (it.custom) {
          cart['l' + i] = {
            item: { custom: true, bundle_key: it.bundle_key, description: it.description, rate: it.rate, tax_percentage: 12, taxable: true },
            qty: it.quantity
          };
        } else {
          var cat = byId[it.item_id];
          var copy = {};
          Object.keys(cat).forEach(function (k) { copy[k] = cat[k]; });
          copy.rate = it.rate;
          if (it.bundle_can) copy.bundle_can = true;
          cart['l' + i] = { item: copy, qty: it.quantity };
        }
      });
      var preset = fx.discount ? fixture.DISCOUNT_PRESETS.filter(function (p) { return p.id === fx.discount.preset_id; })[0] : null;
      core.init({
        getCart: function () { return cart; },
        setCart: function (v) { cart = v; },
        getDiscount: function () { return preset ? { scope: preset.scope, type: preset.type, value: preset.value } : null; }
      });
      var t = core.calcTotals();
      // Fixture subtotal is post-discount, pre-tax; the client subtotal is pre-discount.
      expect(Math.round((t.subtotal - t.discount) * 100) / 100).toBe(fx.expected.subtotal);
      expect(t.discount).toBe(fx.expected.discount);
      expect(t.tax).toBe(fx.expected.tax);
      expect(t.total).toBe(fx.expected.total);
    });
  });
});
