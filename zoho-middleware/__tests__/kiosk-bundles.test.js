'use strict';

var kb = require('../lib/kiosk-bundles');
var fx = require('./fixtures/canning-bundle-carts');

function mapOf(catalog) {
  var m = {};
  catalog.forEach(function (p) { m[p.item_id] = p; });
  return m;
}

describe('kiosk-bundles', function () {
  var catalogMap = mapOf(fx.CATALOG);
  var savedEnv;

  beforeEach(function () {
    savedEnv = {
      id: process.env.ZOHO_TAX_STANDARD_ID,
      rule: process.env.ZOHO_TAX_STANDARD_RULE
    };
    delete process.env.ZOHO_TAX_STANDARD_ID;
    delete process.env.ZOHO_TAX_STANDARD_RULE;
  });
  afterEach(function () {
    ['id', 'rule'].forEach(function (k) {
      var name = k === 'id' ? 'ZOHO_TAX_STANDARD_ID' : 'ZOHO_TAX_STANDARD_RULE';
      if (savedEnv[k] === undefined) delete process.env[name];
      else process.env[name] = savedEnv[k];
    });
  });

  function bundle(key) {
    return { custom: true, bundle_key: key, description: 'x', quantity: 1, rate: 0.01, taxable: false };
  }
  function cans(id, qty) {
    return { item_id: id, bundle_can: true, quantity: qty, rate: 0 };
  }

  describe('BUNDLES table (D-13, D-22)', function () {
    test('exact prices and only two keys', function () {
      expect(kb.BUNDLES['beer-25'].price).toBe(40);
      expect(kb.BUNDLES['cider-23'].price).toBe(35);
      expect(Object.keys(kb.BUNDLES)).toEqual(['beer-25', 'cider-23']);
    });
    test('labels, nominal counts and caps are exported for the client parity test', function () {
      expect(kb.BUNDLES['beer-25'].label).toBe('Beer 25 L');
      expect(kb.BUNDLES['beer-25'].nominal).toEqual({ 473: 52, 355: 70 });
      expect(kb.BUNDLES['beer-25'].cap).toEqual({ 473: 55, 355: 72 });
      expect(kb.BUNDLES['cider-23'].label).toBe('Cider / sparkling wine 23 L');
      expect(kb.BUNDLES['cider-23'].nominal).toEqual({ 473: 48, 355: 64 });
      expect(kb.BUNDLES['cider-23'].cap).toEqual({ 473: 50, 355: 68 });
      expect(kb.CAN_SKUS).toEqual({ 'can-473': 473, 'can-355': 355 });
    });
  });

  describe('isBundleLine / isBundleCanLine', function () {
    test('bundle line only for custom lines with a bundle_key', function () {
      expect(kb.isBundleLine(bundle('beer-25'))).toBe(true);
      expect(kb.isBundleLine({ custom: true, description: 'x' })).toBe(false);
      expect(kb.isBundleLine({ bundle_key: 'beer-25' })).toBe(false);
      expect(kb.isBundleLine(null)).toBe(false);
    });
    test('can line only for bundle_can === true', function () {
      expect(kb.isBundleCanLine(cans(fx.CAN_473_ID, 5))).toBe(true);
      expect(kb.isBundleCanLine({ item_id: 'x', bundle_can: 'true' })).toBe(false);
      expect(kb.isBundleCanLine({ item_id: 'x' })).toBe(false);
    });
  });

  describe('validateBundleCart', function () {
    test('returns null for a valid cart', function () {
      expect(kb.validateBundleCart([bundle('beer-25'), cans(fx.CAN_473_ID, 52)], catalogMap)).toBeNull();
      expect(kb.validateBundleCart([bundle('cider-23'), cans(fx.CAN_355_ID, 64)], catalogMap)).toBeNull();
    });
    test('returns null for a cart with no bundle at all', function () {
      expect(kb.validateBundleCart([{ item_id: 'kit-fee-12', quantity: 1 }], catalogMap)).toBeNull();
    });
    test('D-13: unknown bundle key rejected', function () {
      var r = kb.validateBundleCart([bundle('wine-still'), cans(fx.CAN_473_ID, 5)], catalogMap);
      expect(r.status).toBe(400);
      expect(r.error).toMatch(/canning bundle/i);
    });
    test('inherited object keys are not bundle keys', function () {
      expect(kb.validateBundleCart([bundle('constructor'), cans(fx.CAN_473_ID, 5)], catalogMap).status).toBe(400);
      expect(kb.validateBundleCart([bundle('__proto__'), cans(fx.CAN_473_ID, 5)], catalogMap).status).toBe(400);
    });
    test('D-16: more than one bundle rejected', function () {
      var r = kb.validateBundleCart([bundle('beer-25'), bundle('cider-23'), cans(fx.CAN_473_ID, 5)], catalogMap);
      expect(r.status).toBe(400);
      expect(r.error).toMatch(/canning bundle/i);
    });
    test('D-16: bundle without can line rejected', function () {
      var r = kb.validateBundleCart([bundle('beer-25')], catalogMap);
      expect(r.status).toBe(400);
      expect(r.error).toMatch(/canning bundle/i);
    });
    test('D-16: can line without bundle rejected (no free cans)', function () {
      var r = kb.validateBundleCart([cans(fx.CAN_473_ID, 5)], catalogMap);
      expect(r.status).toBe(400);
      expect(r.error).toMatch(/canning bundle/i);
    });
    test('more than one can line rejected', function () {
      var r = kb.validateBundleCart([bundle('beer-25'), cans(fx.CAN_473_ID, 5), cans(fx.CAN_355_ID, 5)], catalogMap);
      expect(r.status).toBe(400);
    });
    test('can line for an item not in the catalog rejected', function () {
      expect(kb.validateBundleCart([bundle('beer-25'), cans('nope', 5)], catalogMap).status).toBe(400);
    });
    test('can line on a non-can SKU rejected (T-90-06)', function () {
      var r = kb.validateBundleCart([bundle('beer-25'), cans('kit-fee-12', 5)], catalogMap);
      expect(r.status).toBe(400);
      expect(r.error).toMatch(/canning bundle/i);
    });
    test('SKU match is case-insensitive', function () {
      var cm = mapOf([{ item_id: 'c1', sku: 'CAN-473', tax_id: 't' }]);
      expect(kb.validateBundleCart([bundle('beer-25'), cans('c1', 5)], cm)).toBeNull();
    });
    test('a custom or gift_cert line cannot be a can line', function () {
      var r = kb.validateBundleCart([bundle('beer-25'), { custom: true, bundle_can: true, item_id: fx.CAN_473_ID, quantity: 5 }], catalogMap);
      expect(r.status).toBe(400);
      r = kb.validateBundleCart([bundle('beer-25'), { gift_cert: true, bundle_can: true, item_id: fx.CAN_473_ID, quantity: 5 }], catalogMap);
      expect(r.status).toBe(400);
    });
    test.each([0, -1, 1.5, 101, 'abc', null, NaN])('can quantity %p rejected', function (q) {
      var r = kb.validateBundleCart([bundle('beer-25'), cans(fx.CAN_473_ID, q)], catalogMap);
      expect(r && r.status).toBe(400);
    });
    test.each([1, 52, 100])('can quantity %p accepted', function (q) {
      expect(kb.validateBundleCart([bundle('beer-25'), cans(fx.CAN_473_ID, q)], catalogMap)).toBeNull();
    });
    test('D-12: 60 cans on beer-25 / can-473 (above cap 55) is accepted', function () {
      expect(kb.validateBundleCart([bundle('beer-25'), cans(fx.CAN_473_ID, 60)], catalogMap)).toBeNull();
    });
  });

  describe('buildBundleLine', function () {
    var can473 = catalogMap[fx.CAN_473_ID];
    var can355 = catalogMap[fx.CAN_355_ID];

    test('server price, tax and description regardless of client rate / taxable', function () {
      var li = kb.buildBundleLine(bundle('beer-25'), can473, 'std-tax');
      expect(li).toEqual({
        custom: true,
        bundle_key: 'beer-25',
        description: 'Canning Bundle — Beer 25 L (473 mL)',
        rate: 40,
        quantity: 1,
        tax_percentage: 12,
        tax_id: 'std-tax'
      });
    });
    test('cider-23 with the 355 mL can', function () {
      var li = kb.buildBundleLine(bundle('cider-23'), can355, 'std-tax');
      expect(li.description).toBe('Canning Bundle — Cider / sparkling wine 23 L (355 mL)');
      expect(li.rate).toBe(35);
    });
    test('client-supplied quantity is ignored', function () {
      var item = bundle('beer-25');
      item.quantity = 99;
      expect(kb.buildBundleLine(item, can473, 't').quantity).toBe(1);
    });
  });

  describe('buildBundleCanLine', function () {
    test('rate 0, real quantity, catalog tax, bundle_can flag', function () {
      var li = kb.buildBundleCanLine({ item_id: fx.CAN_473_ID, quantity: 52, rate: 9.99, name: 'Cans' }, catalogMap[fx.CAN_473_ID]);
      expect(li).toEqual({
        item_id: fx.CAN_473_ID,
        name: 'Cans',
        sku: 'can-473',
        quantity: 52,
        rate: 0,
        bundle_can: true,
        tax_id: fx.STANDARD_TAX_ID,
        tax_percentage: 12
      });
    });
  });

  describe('resolveStandardTaxId', function () {
    test('env ZOHO_TAX_STANDARD_ID wins', function () {
      process.env.ZOHO_TAX_STANDARD_ID = 'env-std';
      expect(kb.resolveStandardTaxId(catalogMap)).toBe('env-std');
    });
    test('discovers from a catalog item on the standard rule', function () {
      expect(kb.resolveStandardTaxId(catalogMap)).toBe(fx.STANDARD_TAX_ID);
    });
    test('honours ZOHO_TAX_STANDARD_RULE override', function () {
      process.env.ZOHO_TAX_STANDARD_RULE = 'custom-rule';
      var cm = mapOf([{ item_id: 'a', sales_tax_rule_id: 'custom-rule', tax_id: 'tid-custom' }]);
      expect(kb.resolveStandardTaxId(cm)).toBe('tid-custom');
    });
    test('never returns the tax_id of an item on the zero-rated rule 109900000000033411', function () {
      var cm = mapOf([{ item_id: 'z', sales_tax_rule_id: '109900000000033411', tax_id: 'tax-zero-0', tax_percentage: 0 }]);
      expect(kb.resolveStandardTaxId(cm)).toBeNull();
    });
    test('never returns the 5% GST tax_id', function () {
      var cm = mapOf([{ item_id: 'g', sales_tax_rule_id: '109900000000033417', tax_id: 'tax-gst-5' }]);
      expect(kb.resolveStandardTaxId(cm)).toBeNull();
    });
    test('null on empty / missing catalog', function () {
      expect(kb.resolveStandardTaxId({})).toBeNull();
      expect(kb.resolveStandardTaxId(undefined)).toBeNull();
    });
  });
});
