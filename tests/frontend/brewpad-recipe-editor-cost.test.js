'use strict';

// =============================================================================
// Tests: BrewPad recipe editor — unit-aware line cost (73-07, closes CR-02)
//
// The editor's Cost/Retail columns + Totals footer previously computed
// raw `qty * rate` with NO unit conversion (e.g. 12 g against a $54/kg
// catalog item priced $648 instead of $0.65). This regression proves a
// module-scope `bpIngredientLineCost` mirror of the server
// zoho-middleware/lib/recipe-scaling.js `ingredientLineCost` helper exists,
// matches the server's conversion table + 4dp rounding exactly (parity
// asserted against the real server module, not hardcoded literals), and
// fails closed on non-convertible unit pairs.
// =============================================================================

// brewpad.js runs its IIFE on load — stub the globals it touches at the top level.
global.document = global.document || {};
global.window = global.window || {};
global.navigator = global.navigator || {};
global.google = { accounts: { oauth2: { initTokenClient: jest.fn() } } };
global.fetch = jest.fn();

// auth.js primitives are loaded via <script> in the browser; in tests wire them as globals.
var _auth = require('../../js/lib/auth');
global.waitForGoogleIdentity = _auth.waitForGoogleIdentity;
global.gsiInitTokenClient = _auth.gsiInitTokenClient;
global.fetchGoogleUserInfo = _auth.fetchGoogleUserInfo;

var bp = require('../../js/brewpad');
var bpIngredientLineCost = bp.bpIngredientLineCost;

// Server-authoritative helper — real cross-require (pure module, no deps) so
// parity is asserted against the actual server math, not copied literals.
var serverRecipeScaling = require('../../zoho-middleware/lib/recipe-scaling');

describe('bpIngredientLineCost — unit-aware editor cost (73-07 / CR-02)', function () {
  test('exports bpIngredientLineCost as a function', function () {
    expect(typeof bpIngredientLineCost).toBe('function');
  });

  test('mass conversion: 12 g line against a $54/kg catalog item -> $0.65 (not $648)', function () {
    var result = bpIngredientLineCost({ unit: 'kg', rate: 54 }, { unit: 'g', quantity: 12 });
    expect(result.ok).toBe(true);
    expect(result.convertedQty).toBe(0.012);
    expect(result.cost).toBe(0.648);
  });

  test('volume conversion: 20 ml line against a $25/l catalog item', function () {
    var result = bpIngredientLineCost({ unit: 'l', rate: 25 }, { unit: 'ml', quantity: 20 });
    expect(result.ok).toBe(true);
    expect(result.convertedQty).toBe(0.02);
    expect(result.cost).toBe(0.5);
  });

  test('count pass-through: 2 pcs line against a $10/pcs catalog item', function () {
    var result = bpIngredientLineCost({ unit: 'pcs', rate: 10 }, { unit: 'pcs', quantity: 2 });
    expect(result.ok).toBe(true);
    expect(result.convertedQty).toBe(2);
    expect(result.cost).toBe(20);
  });

  test('fails closed on cross-family units (pcs item vs g line) — no numeric product', function () {
    var result = bpIngredientLineCost({ unit: 'pcs' }, { unit: 'g', quantity: 10 });
    expect(result.ok).toBe(false);
    expect(result.cost).toBeUndefined();
    expect(result.convertedQty).toBeUndefined();
  });

  test('parity: matches server ingredientLineCost exactly for every convertible case', function () {
    var cases = [
      { item: { unit: 'kg', rate: 54 }, line: { unit: 'g', quantity: 12 } },
      { item: { unit: 'l', rate: 25 }, line: { unit: 'ml', quantity: 20 } },
      { item: { unit: 'pcs', rate: 10 }, line: { unit: 'pcs', quantity: 2 } },
      { item: { unit: 'g', rate: 0.08 }, line: { unit: 'kg', quantity: 2.5 } }
    ];
    cases.forEach(function (c) {
      var clientResult = bpIngredientLineCost(c.item, c.line);
      var serverResult = serverRecipeScaling.ingredientLineCost(c.item, c.line);
      expect(clientResult.ok).toBe(serverResult.ok);
      expect(clientResult.convertedQty).toBe(serverResult.convertedQty);
      expect(clientResult.cost).toBe(serverResult.cost);
    });
  });

  test('parity: fail-closed shape matches server for cross-family units', function () {
    var item = { unit: 'pcs', rate: 10 };
    var line = { unit: 'g', quantity: 10 };
    var clientResult = bpIngredientLineCost(item, line);
    var serverResult = serverRecipeScaling.ingredientLineCost(item, line);
    expect(clientResult.ok).toBe(false);
    expect(serverResult.ok).toBe(false);
  });
});

describe('bpIngredientLineCost — summing over a mixed-unit ingredient list (wiring intent)', function () {
  test('summing converted costs over a mixed-unit list yields the unit-aware total', function () {
    // Mirrors an enriched recipe ingredient list: line unit + distinct catalog_unit + rate.
    var ingredients = [
      { catalog_unit: 'kg', purchase_rate: 54, unit: 'g', quantity: 12 },   // 0.648
      { catalog_unit: 'l', purchase_rate: 25, unit: 'ml', quantity: 20 },   // 0.5
      { catalog_unit: 'pcs', purchase_rate: 10, unit: 'pcs', quantity: 2 } // 20
    ];
    var total = 0;
    ingredients.forEach(function (ing) {
      var result = bpIngredientLineCost(
        { unit: ing.catalog_unit, rate: ing.purchase_rate },
        { unit: ing.unit, quantity: ing.quantity }
      );
      if (result.ok) total += result.cost;
    });
    expect(Math.round(total * 100) / 100).toBe(21.15);
  });
});
