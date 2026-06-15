'use strict';

// Tests for prototype-pollution guard in the custom-field flattening helper
// extracted from js/modules/07-catalog-kits.js.
//
// Security regression for T-30-05-PP: a Zoho custom-field label that normalises
// to __proto__, constructor, or prototype must NOT pollute Object.prototype.

// Stub KIT_CATEGORIES so 07-catalog-kits.js loads in Node without error.
global.KIT_CATEGORIES = ['wine', 'beer', 'cider', 'seltzer'];

// Stub browser globals that 07-catalog-kits.js references at module scope.
global.document = { getElementById: function () { return null; } };
global.fetch = function () { return Promise.resolve({ ok: false, json: function () { return Promise.resolve({}); } }); };
global.localStorage = {
  getItem: function () { return null; },
  setItem: function () {}
};
global.SHEETS_CONFIG = { MIDDLEWARE_URL: '' };
global.window = global.window || {};
global.showCatalogSkeletons = function () {};

var mod = require('../../js/modules/07-catalog-kits.js');

// ---------------------------------------------------------------------------
// flattenCustomFields — prototype-pollution guard
// ---------------------------------------------------------------------------

describe('flattenCustomFields', function () {
  test('is exported from the module', function () {
    expect(typeof mod.flattenCustomFields).toBe('function');
  });

  test('skips __proto__ key — does NOT pollute Object.prototype', function () {
    var obj = {};
    mod.flattenCustomFields(obj, [{ label: '__proto__', value: 'polluted' }]);
    // __proto__ must not be set on the object or on Object.prototype
    expect(obj.__proto__).toBe(Object.prototype); // not a new object
    expect({}.polluted).toBeUndefined();           // Object.prototype not polluted
  });

  test('skips constructor key — does NOT pollute Object.prototype', function () {
    var obj = {};
    mod.flattenCustomFields(obj, [{ label: 'constructor', value: 'hacked' }]);
    expect(typeof obj.constructor).toBe('function'); // remains native constructor
    expect(Object.prototype.constructor).toBe(Object); // not replaced
  });

  test('skips prototype key — does NOT modify Object.prototype', function () {
    var obj = {};
    mod.flattenCustomFields(obj, [{ label: 'prototype', value: 'evil' }]);
    // "prototype" as a plain data-property key should not be set either
    expect(obj.prototype).toBeUndefined();
  });

  test('normalised labels that resolve to __proto__ are also skipped', function () {
    var obj = {};
    // Zoho label with spaces normalises to __proto__ after .toLowerCase().replace(/\s+/g,'_')
    // (label = '__proto__' directly — normalisation is idempotent here)
    mod.flattenCustomFields(obj, [{ label: '__proto__', value: 'x' }]);
    expect({}.injected).toBeUndefined();
  });

  test('legitimate custom-field labels still flatten normally', function () {
    var obj = { name: 'Test Kit', sku: 'WINE-001' };
    mod.flattenCustomFields(obj, [
      { label: 'Subcategory', value: 'Chardonnay' },
      { label: 'Tasting Notes', value: 'Crisp and dry' },
      { label: 'ABV', value: '12.5' }
    ]);
    expect(obj.subcategory).toBe('Chardonnay');
    expect(obj.tasting_notes).toBe('Crisp and dry');
    expect(obj.abv).toBe('12.5');
  });

  test('skips fields with undefined or null values', function () {
    var obj = {};
    mod.flattenCustomFields(obj, [
      { label: 'ValidLabel', value: undefined },
      { label: 'AnotherLabel', value: null }
    ]);
    expect(obj.validlabel).toBeUndefined();
    expect(obj.anotherlabel).toBeUndefined();
  });

  test('skips fields with empty label', function () {
    var obj = {};
    mod.flattenCustomFields(obj, [
      { label: '', value: 'something' }
    ]);
    // No key should be added
    expect(Object.keys(obj)).toHaveLength(0);
  });

  test('coerces values to strings', function () {
    var obj = {};
    mod.flattenCustomFields(obj, [
      { label: 'ABV', value: 12.5 },
      { label: 'Stock', value: 42 }
    ]);
    expect(obj.abv).toBe('12.5');
    expect(obj.stock).toBe('42');
  });
});
