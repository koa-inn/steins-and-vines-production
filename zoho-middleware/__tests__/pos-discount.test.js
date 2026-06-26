'use strict';

// Mocks for pos.js dependencies (mirrors pos-recipe.test.js setup)
jest.mock('express', function () {
  var router = { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() };
  var express = function () {};
  express.Router = function () { return router; };
  return express;
});
jest.mock('axios', function () { return { get: jest.fn(), post: jest.fn() }; });
jest.mock('../lib/helcim', function () {
  return { isTerminalEnabled: jest.fn().mockReturnValue(true), terminalPurchase: jest.fn(), voidTransaction: jest.fn() };
});
jest.mock('../lib/zoho-api', function () {
  return { zohoGet: jest.fn(), zohoPost: jest.fn(), zohoPut: jest.fn() };
});
jest.mock('../lib/cache', function () {
  return { get: jest.fn(), set: jest.fn(), del: jest.fn(), acquireLock: jest.fn(), releaseLock: jest.fn(), isConnected: jest.fn().mockReturnValue(true) };
});
jest.mock('../lib/logger', function () { return { info: jest.fn(), warn: jest.fn(), error: jest.fn() }; });
jest.mock('../lib/eventLog', function () { return { logEvent: jest.fn() }; });
jest.mock('../lib/mailer', function () { return { sendVoidFailureAlert: jest.fn() }; });
jest.mock('../lib/brewpad-integration', function () { return { detectRecipeSale: jest.fn() }; });
jest.mock('../lib/inventory-ledger', function () {
  return { reconcile: jest.fn(), overlayStock: jest.fn(), recordSale: jest.fn() };
});

var cache = require('../lib/cache');
var pos = require('../routes/pos');
var resolveDiscount = pos.resolveDiscount;

var CATALOG = {
  w: { item_id: 'w', cf_type: 'wine', rate: 100 },
  h: { item_id: 'h', cf_type: 'ingredient', cf_subcategory: 'Hops', rate: 50 },
  g: { item_id: 'g', cf_type: 'ingredient', cf_subcategory: 'Grain', rate: 40 }
};

function lines() {
  return [
    { item_id: 'w', quantity: 1, rate: 100 },
    { item_id: 'h', quantity: 1, rate: 50 },
    { item_id: 'g', quantity: 1, rate: 40 }
  ];
}

beforeEach(function () { jest.clearAllMocks(); });

describe('resolveDiscount — type scope (standard cart)', function () {
  test('percentage discounts only matching (kit:wine) line', function () {
    cache.get.mockResolvedValue([{ id: 'd1', name: 'Wine 10%', type: 'percentage', value: 10, scope: 'type', applies_to: ['kit:wine'], active: true }]);
    var li = lines();
    return resolveDiscount({ discount: { preset_id: 'd1' } }, li, 190, CATALOG).then(function (r) {
      expect(li[0].discount).toBe('10%');     // wine
      expect(li[1].discount).toBeUndefined(); // hops
      expect(li[2].discount).toBeUndefined(); // grain
      expect(r.subtotal).toBe(180);           // 90 + 50 + 40
      expect(r.discountApplied.scope).toBe('type');
    });
  });

  test('group token (ingredient) matches all ingredients, not the kit', function () {
    cache.get.mockResolvedValue([{ id: 'd2', name: 'Ingredients 50%', type: 'percentage', value: 50, scope: 'type', applies_to: ['ingredient'], active: true }]);
    var li = lines();
    return resolveDiscount({ discount: { preset_id: 'd2' } }, li, 190, CATALOG).then(function (r) {
      expect(li[0].discount).toBeUndefined(); // wine untouched
      expect(li[1].discount).toBe('50%');     // hops
      expect(li[2].discount).toBe('50%');     // grain
      expect(r.subtotal).toBe(145);           // 100 + 25 + 20
    });
  });

  test('fixed discount distributes across matched lines, capped at matched subtotal', function () {
    cache.get.mockResolvedValue([{ id: 'd3', name: '$30 ingredients', type: 'fixed', value: 30, scope: 'type', applies_to: ['ingredient'], active: true }]);
    var li = lines();
    return resolveDiscount({ discount: { preset_id: 'd3' } }, li, 190, CATALOG).then(function (r) {
      // matched subtotal = 90 (hops 50 + grain 40); distribute $30
      var applied = (Number(li[1].discount) || 0) + (Number(li[2].discount) || 0);
      expect(applied).toBeCloseTo(30, 2);
      expect(li[0].discount).toBeUndefined(); // wine untouched
      expect(r.subtotal).toBeCloseTo(160, 2); // 190 - 30
    });
  });

  test('fixed discount cannot exceed matched subtotal', function () {
    cache.get.mockResolvedValue([{ id: 'd4', name: '$999 wine', type: 'fixed', value: 999, scope: 'type', applies_to: ['kit:wine'], active: true }]);
    var li = lines();
    return resolveDiscount({ discount: { preset_id: 'd4' } }, li, 190, CATALOG).then(function (r) {
      expect(Number(li[0].discount)).toBeCloseTo(100, 2); // capped at wine line total
      expect(r.subtotal).toBeCloseTo(90, 2);              // 190 - 100
    });
  });

  test('no matching lines -> no discount applied', function () {
    cache.get.mockResolvedValue([{ id: 'd5', name: 'Seltzer', type: 'percentage', value: 10, scope: 'type', applies_to: ['kit:seltzer'], active: true }]);
    var li = lines();
    return resolveDiscount({ discount: { preset_id: 'd5' } }, li, 190, CATALOG).then(function (r) {
      expect(li[0].discount).toBeUndefined();
      expect(li[1].discount).toBeUndefined();
      expect(r.subtotal).toBe(190);
    });
  });
});

describe('resolveDiscount — cart scope + errors', function () {
  test('cart percentage discounts every line', function () {
    cache.get.mockResolvedValue([{ id: 'c1', name: 'All 10%', type: 'percentage', value: 10, scope: 'cart', active: true }]);
    var li = lines();
    return resolveDiscount({ discount: { preset_id: 'c1' } }, li, 190, CATALOG).then(function (r) {
      expect(li[0].discount).toBe('10%');
      expect(li[1].discount).toBe('10%');
      expect(r.subtotal).toBeCloseTo(171, 2);
    });
  });

  test('legacy "item" scope is rejected', function () {
    cache.get.mockResolvedValue([{ id: 'i1', name: 'Legacy', type: 'percentage', value: 10, scope: 'item', active: true }]);
    return resolveDiscount({ discount: { preset_id: 'i1' } }, lines(), 190, CATALOG).then(function (r) {
      expect(r.error).toBeTruthy();
      expect(r.status).toBe(400);
    });
  });

  test('inactive preset rejected', function () {
    cache.get.mockResolvedValue([{ id: 'x1', name: 'Off', type: 'percentage', value: 10, scope: 'cart', active: false }]);
    return resolveDiscount({ discount: { preset_id: 'x1' } }, lines(), 190, CATALOG).then(function (r) {
      expect(r.status).toBe(400);
    });
  });

  test('no discount in body resolves to null', function () {
    return resolveDiscount({}, lines(), 190, CATALOG).then(function (r) {
      expect(r).toBeNull();
    });
  });
});

describe('recipe discount helpers', function () {
  var posRecipe = require('../routes/pos-recipe');

  test('recipe token discounts the product portion only', function () {
    // grandTotal 150, fees 50 -> product 100; 10% of product = 10
    var preset = { id: 'r1', name: 'Recipe 10%', type: 'percentage', value: 10, scope: 'type', applies_to: ['recipe'], active: true };
    var d = posRecipe.computeRecipeDiscount(preset, 150, 50);
    expect(d.discountAmount).toBeCloseTo(10, 2);
    expect(d.total).toBeCloseTo(140, 2);
  });

  test('service token discounts the fee portion only', function () {
    var preset = { id: 'r2', name: 'Fees 50%', type: 'percentage', value: 50, scope: 'type', applies_to: ['service'], active: true };
    var d = posRecipe.computeRecipeDiscount(preset, 150, 50);
    expect(d.discountAmount).toBeCloseTo(25, 2); // 50% of 50
    expect(d.total).toBeCloseTo(125, 2);
  });

  test('recipe + service together discount the whole recipe', function () {
    var preset = { id: 'r3', name: 'All', type: 'percentage', value: 10, scope: 'type', applies_to: ['recipe', 'service'], active: true };
    var d = posRecipe.computeRecipeDiscount(preset, 150, 50);
    expect(d.discountAmount).toBeCloseTo(15, 2); // 10% of 150
  });

  test('cart scope discounts the whole recipe', function () {
    var preset = { id: 'r4', name: 'Cart', type: 'percentage', value: 10, scope: 'cart', active: true };
    var d = posRecipe.computeRecipeDiscount(preset, 150, 50);
    expect(d.discountAmount).toBeCloseTo(15, 2);
  });

  test('non-applicable tokens (kit/ingredient) yield zero on a recipe', function () {
    var preset = { id: 'r5', name: 'Kits', type: 'percentage', value: 10, scope: 'type', applies_to: ['kit', 'ingredient:hops'], active: true };
    var d = posRecipe.computeRecipeDiscount(preset, 150, 50);
    expect(d.discountAmount).toBe(0);
    expect(d.total).toBeCloseTo(150, 2);
  });

  test('distributeRecipeDiscount splits across product lines and caps per line', function () {
    var feeItemIds = ['fee-brew', 'fee-mat'];
    var li = [
      { item_id: 'ing1', quantity: 1, rate: 60 },
      { item_id: 'ing2', quantity: 1, rate: 40 },
      { item_id: 'fee-brew', quantity: 1, rate: 45 }
    ];
    var preset = { scope: 'type', applies_to: ['recipe'], active: true };
    posRecipe.distributeRecipeDiscount(li, feeItemIds, preset, 10);
    var sum = (Number(li[0].discount) || 0) + (Number(li[1].discount) || 0);
    expect(sum).toBeCloseTo(10, 2);
    expect(li[2].discount).toBeUndefined(); // fee untouched for recipe-only target
  });
});
