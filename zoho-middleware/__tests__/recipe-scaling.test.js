'use strict';

var scaling = require('../lib/recipe-scaling');
var scaleIngredient             = scaling.scaleIngredient;
var scaleIngredients            = scaling.scaleIngredients;
var computeScaledRecipeTotal    = scaling.computeScaledRecipeTotal;
var computeModifiedRecipeTotal  = scaling.computeModifiedRecipeTotal;
var checkScaledStock            = scaling.checkScaledStock;

// ---------------------------------------------------------------------------
// scaleIngredient — continuous units (kg, g, l, ml)
// ---------------------------------------------------------------------------
describe('scaleIngredient — continuous units', function () {
  test('kg × 1.5 = linear (5 kg → 7.5 kg)', function () {
    var result = scaleIngredient({ item_id: 'm1', quantity: 5, unit: 'kg' }, 1.5);
    expect(result.quantity).toBe(7.5);
  });

  test('g × 1.5 = linear (100 g → 150 g)', function () {
    var result = scaleIngredient({ item_id: 'h1', quantity: 100, unit: 'g' }, 1.5);
    expect(result.quantity).toBe(150);
  });

  test('l × 2.0 = linear (10 l → 20 l)', function () {
    var result = scaleIngredient({ item_id: 'w1', quantity: 10, unit: 'l' }, 2.0);
    expect(result.quantity).toBe(20);
  });

  test('ml × 0.5 = linear (200 ml → 100 ml)', function () {
    var result = scaleIngredient({ item_id: 'a1', quantity: 200, unit: 'ml' }, 0.5);
    expect(result.quantity).toBe(100);
  });

  test('does not mutate original ingredient', function () {
    var ing = { item_id: 'm1', quantity: 5, unit: 'kg' };
    var result = scaleIngredient(ing, 1.5);
    expect(ing.quantity).toBe(5);
    expect(result.quantity).toBe(7.5);
  });

  test('preserves other fields on ingredient', function () {
    var ing = { item_id: 'x1', item_name: 'Pale Malt', quantity: 5, unit: 'kg', cf_type: 'Malt' };
    var result = scaleIngredient(ing, 2.0);
    expect(result.item_id).toBe('x1');
    expect(result.item_name).toBe('Pale Malt');
    expect(result.cf_type).toBe('Malt');
    expect(result.quantity).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// scaleIngredient — discrete units (pcs, each, unit, pkg, ft)
// ---------------------------------------------------------------------------
describe('scaleIngredient — discrete units', function () {
  test('pcs ceil: 2 × 1.15 = 2.3 → 3 (SCALE-02, D-01)', function () {
    var result = scaleIngredient({ item_id: 'h1', quantity: 2, unit: 'pcs' }, 1.15);
    expect(result.quantity).toBe(3);
  });

  test('floor-of-1: 0.5× of 1 pcs yeast stays 1 (D-02)', function () {
    var result = scaleIngredient({ item_id: 'y1', quantity: 1, unit: 'pcs' }, 0.5);
    expect(result.quantity).toBe(1); // Math.max(1, Math.ceil(0.5)) = 1
  });

  test('each: 3 × 1.5 = 4.5 → 5', function () {
    var result = scaleIngredient({ item_id: 'e1', quantity: 3, unit: 'each' }, 1.5);
    expect(result.quantity).toBe(5);
  });

  test('pkg ceil: 2 × 0.6 = 1.2 → 2', function () {
    var result = scaleIngredient({ item_id: 'p1', quantity: 2, unit: 'pkg' }, 0.6);
    expect(result.quantity).toBe(2);
  });

  test('ft discrete: 4 × 1.5 = 6.0 → 6 (whole integer)', function () {
    var result = scaleIngredient({ item_id: 'f1', quantity: 4, unit: 'ft' }, 1.5);
    expect(result.quantity).toBe(6);
  });

  test('ft floor-of-1: 1 × 0.3 = 0.3 → 1 (D-02)', function () {
    var result = scaleIngredient({ item_id: 'f1', quantity: 1, unit: 'ft' }, 0.3);
    expect(result.quantity).toBe(1); // Math.max(1, Math.ceil(0.3)) = 1
  });

  test('unit token: 1 × 1.5 = 1.5 → 2', function () {
    var result = scaleIngredient({ item_id: 'u1', quantity: 1, unit: 'unit' }, 1.5);
    expect(result.quantity).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// scaleIngredient — blank/unknown unit (D-03)
// ---------------------------------------------------------------------------
describe('scaleIngredient — blank/unknown unit', function () {
  test('blank unit defaults to linear scaling (D-03)', function () {
    var result = scaleIngredient({ item_id: 'x1', quantity: 4, unit: '' }, 1.5);
    expect(result.quantity).toBe(6); // linear: 4 × 1.5
  });

  test('null unit defaults to linear scaling (D-03)', function () {
    var result = scaleIngredient({ item_id: 'x2', quantity: 8, unit: null }, 2.0);
    expect(result.quantity).toBe(16);
  });

  test('undefined unit defaults to linear scaling (D-03)', function () {
    var result = scaleIngredient({ item_id: 'x3', quantity: 3 }, 1.5);
    expect(result.quantity).toBe(4.5);
  });

  test('unknown non-blank token defaults to linear (not ceil)', function () {
    // Behaviour change: an unrecognised unit now scales LINEARLY (continuous)
    // instead of being ceil'd. Only units explicitly in DISCRETE_UNITS round up.
    // This prevents imperial/other unmapped units from silently losing decimals.
    var result = scaleIngredient({ item_id: 'z1', quantity: 2, unit: 'sack' }, 1.5);
    expect(result.quantity).toBe(3); // 2 × 1.5 linear
  });

  test('unknown non-blank token preserves fractional quantity', function () {
    var result = scaleIngredient({ item_id: 'z2', quantity: 2.5, unit: 'sack' }, 1.0);
    expect(result.quantity).toBe(2.5); // linear, no ceil → decimal preserved
  });
});

// ---------------------------------------------------------------------------
// scaleIngredient — imperial units (oz, lb, tsp, tbsp, gal, ...) must be linear
// Regression: BeerSmith/BeerXML recipes use imperial units; treating them as
// discrete (ceil) lost decimals and inflated charged amounts.
// ---------------------------------------------------------------------------
describe('scaleIngredient — imperial units scale linearly', function () {
  test('oz preserves decimal at factor 1.0 (5.5 oz → 5.5, not 6)', function () {
    var result = scaleIngredient({ item_id: 'hop1', quantity: 5.5, unit: 'oz' }, 1.0);
    expect(result.quantity).toBe(5.5);
  });

  test('lb preserves decimal at factor 1.0 (9.25 lb → 9.25, not 10)', function () {
    var result = scaleIngredient({ item_id: 'grain1', quantity: 9.25, unit: 'lb' }, 1.0);
    expect(result.quantity).toBe(9.25);
  });

  test('oz scales linearly (4.5 oz × 1.5 = 6.75)', function () {
    var result = scaleIngredient({ item_id: 'hop2', quantity: 4.5, unit: 'oz' }, 1.5);
    expect(result.quantity).toBe(6.75);
  });

  test('tsp/tbsp/gal/qt/pt/cup all scale linearly', function () {
    expect(scaleIngredient({ item_id: 'a', quantity: 1.5, unit: 'tsp' }, 1.0).quantity).toBe(1.5);
    expect(scaleIngredient({ item_id: 'b', quantity: 0.75, unit: 'tbsp' }, 1.0).quantity).toBe(0.75);
    expect(scaleIngredient({ item_id: 'c', quantity: 2.5, unit: 'gal' }, 1.0).quantity).toBe(2.5);
    expect(scaleIngredient({ item_id: 'd', quantity: 1.25, unit: 'qt' }, 1.0).quantity).toBe(1.25);
    expect(scaleIngredient({ item_id: 'e', quantity: 3.5, unit: 'pt' }, 1.0).quantity).toBe(3.5);
    expect(scaleIngredient({ item_id: 'f', quantity: 0.5, unit: 'cup' }, 1.0).quantity).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// scaleIngredients (array helper)
// ---------------------------------------------------------------------------
describe('scaleIngredients', function () {
  test('scales all ingredients in array', function () {
    var ings = [
      { item_id: 'm1', quantity: 5, unit: 'kg' },
      { item_id: 'y1', quantity: 1, unit: 'pcs' }
    ];
    var results = scaleIngredients(ings, 1.5);
    expect(results).toHaveLength(2);
    expect(results[0].quantity).toBe(7.5);           // kg × 1.5 = 7.5 (linear)
    expect(results[1].quantity).toBe(2);              // pcs: 1 × 1.5 = 1.5 → Math.ceil(1.5) = 2
  });

  test('ceil rounding: 1 pcs × 1.5 = 1.5 → 2', function () {
    var results = scaleIngredients([{ item_id: 'y1', quantity: 1, unit: 'pcs' }], 1.5);
    expect(results[0].quantity).toBe(2);
  });

  test('returns empty array for null input', function () {
    var results = scaleIngredients(null, 1.5);
    expect(results).toEqual([]);
  });

  test('returns empty array for empty array input', function () {
    var results = scaleIngredients([], 2.0);
    expect(results).toEqual([]);
  });

  test('does not mutate original array or ingredient objects', function () {
    var ings = [{ item_id: 'm1', quantity: 5, unit: 'kg' }];
    scaleIngredients(ings, 2.0);
    expect(ings[0].quantity).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// computeScaledRecipeTotal — locked pricing (D-04/D-05)
// ---------------------------------------------------------------------------
describe('computeScaledRecipeTotal — locked pricing', function () {
  // Worked example from CONTEXT.md §Specific Ideas
  // locked_price=45, service_fee=45, materials_fee=5
  // 1.0× in-store: 45×1 + 45 + 5 = $95.00
  // 1.5× in-store: 45×1.5 + 45 + 5 = 67.50 + 50 = $117.50

  test('locked 1.0× in-store = locked_price + service_fee + materials_fee ($95)', function () {
    expect(computeScaledRecipeTotal(
      { locked_price: 45, service_fee: 45, materials_fee: 5, pricing_mode: 'locked', _scale_factor: 1 },
      [],
      {},
      'in-store'
    )).toBe(95.00);
  });

  test('locked 1.5× in-store = locked_price × 1.5 + fees ($117.50)', function () {
    expect(computeScaledRecipeTotal(
      { locked_price: 45, service_fee: 45, materials_fee: 5, pricing_mode: 'locked', _scale_factor: 1.5 },
      [],
      {},
      'in-store'
    )).toBe(117.50);
  });

  test('locked take-out (non in-store) — fees NOT added (ingredient portion only)', function () {
    // locked_price × factor only; no service_fee or materials_fee
    expect(computeScaledRecipeTotal(
      { locked_price: 45, service_fee: 45, materials_fee: 5, pricing_mode: 'locked', _scale_factor: 1 },
      [],
      {},
      'take-out'
    )).toBe(45.00);
  });

  test('locked take-out 1.5× — fees NOT added', function () {
    expect(computeScaledRecipeTotal(
      { locked_price: 45, service_fee: 45, materials_fee: 5, pricing_mode: 'locked', _scale_factor: 1.5 },
      [],
      {},
      'take-out'
    )).toBe(67.50);
  });

  test('locked _scale_factor defaults to 1 when not set', function () {
    expect(computeScaledRecipeTotal(
      { locked_price: 100, service_fee: 10, materials_fee: 5, pricing_mode: 'locked' },
      [],
      {},
      'in-store'
    )).toBe(115.00);
  });

  test('locked 2.0× in-store', function () {
    expect(computeScaledRecipeTotal(
      { locked_price: 50, service_fee: 20, materials_fee: 5, pricing_mode: 'locked', _scale_factor: 2.0 },
      [],
      {},
      'in-store'
    )).toBe(125.00); // 50×2 + 20 + 5 = 100 + 25
  });
});

// ---------------------------------------------------------------------------
// computeScaledRecipeTotal — dynamic pricing (D-07)
// ---------------------------------------------------------------------------
describe('computeScaledRecipeTotal — dynamic pricing', function () {
  test('dynamic in-store: sum of scaled qty × rate + fees', function () {
    var scaledIngs = [
      { item_id: 'a1', quantity: 7.5, unit: 'kg' },
      { item_id: 'b1', quantity: 2,   unit: 'pcs' }
    ];
    var catalogMap = {
      a1: { rate: 2.00 },  // 7.5 × 2.00 = 15.00
      b1: { rate: 5.00 }   // 2   × 5.00 = 10.00
    };
    // subtotal = 25.00; service_fee=10, materials_fee=5 → total = 40.00
    expect(computeScaledRecipeTotal(
      { pricing_mode: 'dynamic', service_fee: 10, materials_fee: 5 },
      scaledIngs,
      catalogMap,
      'in-store'
    )).toBe(40.00);
  });

  test('dynamic take-out: no fees added', function () {
    var scaledIngs = [
      { item_id: 'a1', quantity: 5, unit: 'kg' }
    ];
    var catalogMap = { a1: { rate: 3.00 } }; // 5 × 3.00 = 15.00
    expect(computeScaledRecipeTotal(
      { pricing_mode: 'dynamic', service_fee: 20, materials_fee: 5 },
      scaledIngs,
      catalogMap,
      'take-out'
    )).toBe(15.00);
  });

  test('dynamic: ingredient not in catalogMap is skipped', function () {
    var scaledIngs = [
      { item_id: 'a1', quantity: 5, unit: 'kg' },
      { item_id: 'unknown', quantity: 10, unit: 'kg' }  // not in catalogMap
    ];
    var catalogMap = { a1: { rate: 2.00 } };
    expect(computeScaledRecipeTotal(
      { pricing_mode: 'dynamic', service_fee: 0, materials_fee: 0 },
      scaledIngs,
      catalogMap,
      'in-store'
    )).toBe(10.00); // only a1 contributes
  });

  test('dynamic: empty ingredients and catalog returns only fees (in-store)', function () {
    expect(computeScaledRecipeTotal(
      { pricing_mode: 'dynamic', service_fee: 15, materials_fee: 5 },
      [],
      {},
      'in-store'
    )).toBe(20.00);
  });

  test('dynamic: result is rounded to 2 decimal places', function () {
    var scaledIngs = [{ item_id: 'a1', quantity: 1, unit: 'kg' }];
    var catalogMap = { a1: { rate: 14.999 } };
    var result = computeScaledRecipeTotal(
      { pricing_mode: 'dynamic', service_fee: 0, materials_fee: 0 },
      scaledIngs,
      catalogMap,
      'in-store'
    );
    expect(result).toBe(15.00);
  });
});

// ---------------------------------------------------------------------------
// checkScaledStock (D-08, SCALE-05)
// ---------------------------------------------------------------------------
describe('checkScaledStock', function () {
  test('ok when all scaled quantities are within stock', function () {
    var result = checkScaledStock(
      [{ item_id: 'a', item_name: 'Pale Malt', quantity: 5, unit: 'kg' }],
      { a: { stock_on_hand: 10 } }
    );
    expect(result.ok).toBe(true);
    expect(result.conflicts).toHaveLength(0);
  });

  test('conflict when scaled quantity exceeds stock_on_hand (D-08)', function () {
    var result = checkScaledStock(
      [{ item_id: 'a', item_name: 'Cascade Hops', quantity: 7, unit: 'kg' }],
      { a: { stock_on_hand: 5 } }
    );
    expect(result.ok).toBe(false);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].item_id).toBe('a');
    expect(result.conflicts[0].item_name).toBe('Cascade Hops');
    expect(result.conflicts[0].needed).toBe(7);
    expect(result.conflicts[0].stock).toBe(5);
    expect(result.conflicts[0].unit).toBe('kg');
  });

  test('item not in catalogMap is skipped (not a conflict)', function () {
    var result = checkScaledStock(
      [
        { item_id: 'known', item_name: 'Malt', quantity: 5, unit: 'kg' },
        { item_id: 'unknown', item_name: 'Mystery', quantity: 100, unit: 'pcs' }
      ],
      { known: { stock_on_hand: 10 } }
    );
    expect(result.ok).toBe(true);
    expect(result.conflicts).toHaveLength(0);
  });

  test('multiple conflicts reported', function () {
    var result = checkScaledStock(
      [
        { item_id: 'a', item_name: 'Malt',  quantity: 10, unit: 'kg'  },
        { item_id: 'b', item_name: 'Hops',  quantity: 5,  unit: 'pcs' },
        { item_id: 'c', item_name: 'Yeast', quantity: 2,  unit: 'pcs' }
      ],
      {
        a: { stock_on_hand: 5 },   // conflict: need 10, have 5
        b: { stock_on_hand: 10 },  // ok: need 5, have 10
        c: { stock_on_hand: 1 }    // conflict: need 2, have 1
      }
    );
    expect(result.ok).toBe(false);
    expect(result.conflicts).toHaveLength(2);
    expect(result.conflicts.map(function (c) { return c.item_id; })).toEqual(['a', 'c']);
  });

  test('exact stock match (needed === stock_on_hand) is NOT a conflict', function () {
    var result = checkScaledStock(
      [{ item_id: 'a', item_name: 'Malt', quantity: 5, unit: 'kg' }],
      { a: { stock_on_hand: 5 } }
    );
    expect(result.ok).toBe(true);
    expect(result.conflicts).toHaveLength(0);
  });

  test('returns ok:true with empty conflicts for empty ingredient list', function () {
    var result = checkScaledStock([], {});
    expect(result.ok).toBe(true);
    expect(result.conflicts).toHaveLength(0);
  });

  test('returns ok:true with empty conflicts for null input', function () {
    var result = checkScaledStock(null, {});
    expect(result.ok).toBe(true);
    expect(result.conflicts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// computeModifiedRecipeTotal (D-07/D-08/D-09, MOD-02)
// ---------------------------------------------------------------------------
describe('computeModifiedRecipeTotal', function () {

  // Shared base recipe fixture: locked_price 45, service_fee 45, materials_fee 5
  // Locked base at 1.0×:  45×1 + 45 + 5 = $95.00 (unmodified locked total, for reference)
  // Locked base at 1.5×: 45×1.5 + 45 + 5 = 67.50 + 50 = $117.50 (unmodified locked total, for reference)

  // ---------------------------------------------------------------------------
  // LOCKED_ADD — D-07: locked recipe + added ingredient
  // ---------------------------------------------------------------------------

  // LOCKED_ADD_1X:
  //   recipe { locked_price:45, service_fee:45, materials_fee:5 }
  //   original ingredients: [] (empty — no base ingredients)
  //   modified base list: [hop H1, quantity:1, unit:'pcs']
  //   catalog: H1 rate $4/ea
  //   scaleFactor: 1.0
  //   Charge = locked_price×1 + service_fee + materials_fee + (1pcs × $4)
  //          = 45 + 45 + 5 + 4 = $99.00
  test('LOCKED_ADD_1X: locked recipe + added hop 1pcs at 1.0× = $99', function () {
    var recipe = { locked_price: 45, service_fee: 45, materials_fee: 5, pricing_mode: 'locked', batch_size_l: 20 };
    var originalIngredients = [];
    var modifiedBaseIngredients = [{ item_id: 'H1', item_name: 'Cascade Hops', quantity: 1, unit: 'pcs' }];
    var catalogMap = { H1: { rate: 4, item_name: 'Cascade Hops', unit: 'pcs' } };
    var result = computeModifiedRecipeTotal(recipe, originalIngredients, modifiedBaseIngredients, catalogMap, 1.0, 'in-store');
    expect(result).toBe(99);
  });

  // LOCKED_ADD_1_5X:
  //   Same recipe, same original [], same hop H1 added at base qty 1pcs
  //   scaleFactor: 1.5
  //   Locked portion scales: 45×1.5 = 67.50
  //   Fees flat: 45 + 5 = 50
  //   Added hop scales identically to base ingredients (D-04):
  //     pcs is discrete → Math.max(1, Math.ceil(1 × 1.5)) = Math.max(1, Math.ceil(1.5)) = 2 pcs
  //     cost = 2 × $4 = $8
  //   Charge = 67.50 + 50 + 8 = $125.50
  // ⚠ OWNER DECISION 2026-06-21: Added ingredients scale with the rest of the modified list.
  // The value $125.50 is the owner-approved figure from CONTEXT §Specifics.
  // This literal MUST be hard-coded here — do NOT compute from scaleIngredient at assert time.
  test('LOCKED_ADD_1_5X: locked recipe + added hop 1pcs at 1.5× = $125.50 (literal, D-07)', function () {
    var recipe = { locked_price: 45, service_fee: 45, materials_fee: 5, pricing_mode: 'locked', batch_size_l: 20 };
    var originalIngredients = [];
    var modifiedBaseIngredients = [{ item_id: 'H1', item_name: 'Cascade Hops', quantity: 1, unit: 'pcs' }];
    var catalogMap = { H1: { rate: 4, item_name: 'Cascade Hops', unit: 'pcs' } };
    var result = computeModifiedRecipeTotal(recipe, originalIngredients, modifiedBaseIngredients, catalogMap, 1.5, 'in-store');
    expect(result).toBe(125.50);
  });

  // ---------------------------------------------------------------------------
  // LOCKED_REMOVE — D-08: locked recipe + removed ingredient — NO CREDIT
  // ---------------------------------------------------------------------------

  // Recipe has 2 original ingredients; modified list drops one.
  // Charge is always locked_price × factor + fees — removing a line gives no discount.

  test('LOCKED_REMOVE 1.0×: removed ingredient gives no credit — total = locked×1 + fees ($95)', function () {
    var recipe = { locked_price: 45, service_fee: 45, materials_fee: 5, pricing_mode: 'locked', batch_size_l: 20 };
    // Two base ingredients
    var originalIngredients = [
      { item_id: 'G1', item_name: 'Pale Malt', quantity: 5, unit: 'kg' },
      { item_id: 'H1', item_name: 'Cascade Hops', quantity: 1, unit: 'pcs' }
    ];
    // Modified: removed G1 (only H1 remains — still an original item, not an addition)
    var modifiedBaseIngredients = [
      { item_id: 'H1', item_name: 'Cascade Hops', quantity: 1, unit: 'pcs' }
    ];
    var catalogMap = {
      G1: { rate: 2, item_name: 'Pale Malt', unit: 'kg' },
      H1: { rate: 4, item_name: 'Cascade Hops', unit: 'pcs' }
    };
    var result = computeModifiedRecipeTotal(recipe, originalIngredients, modifiedBaseIngredients, catalogMap, 1.0, 'in-store');
    // = 45×1 + 45 + 5 = $95 — no credit for removed ingredient (D-08)
    expect(result).toBe(95);
  });

  test('LOCKED_REMOVE 1.5×: removed ingredient gives no credit at 1.5× — total = locked×1.5 + fees ($117.50)', function () {
    var recipe = { locked_price: 45, service_fee: 45, materials_fee: 5, pricing_mode: 'locked', batch_size_l: 20 };
    var originalIngredients = [
      { item_id: 'G1', item_name: 'Pale Malt', quantity: 5, unit: 'kg' },
      { item_id: 'H1', item_name: 'Cascade Hops', quantity: 1, unit: 'pcs' }
    ];
    var modifiedBaseIngredients = [
      { item_id: 'H1', item_name: 'Cascade Hops', quantity: 1, unit: 'pcs' }
    ];
    var catalogMap = {
      G1: { rate: 2, item_name: 'Pale Malt', unit: 'kg' },
      H1: { rate: 4, item_name: 'Cascade Hops', unit: 'pcs' }
    };
    var result = computeModifiedRecipeTotal(recipe, originalIngredients, modifiedBaseIngredients, catalogMap, 1.5, 'in-store');
    // = 45×1.5 + 45 + 5 = 67.50 + 50 = $117.50 — identical to unmodified locked total (D-08)
    expect(result).toBe(117.50);
  });

  // ---------------------------------------------------------------------------
  // DYNAMIC_MODIFY — D-09: dynamic recipe + any modification
  // ---------------------------------------------------------------------------

  test('DYNAMIC_MODIFY 1.0×: dynamic recipe sums modified list at base scale', function () {
    var recipe = { locked_price: 0, pricing_mode: 'dynamic', service_fee: 10, materials_fee: 5, batch_size_l: 20 };
    var originalIngredients = [
      { item_id: 'G1', item_name: 'Pale Malt', quantity: 5, unit: 'kg' }
    ];
    // Modified: kept G1, added hop H1
    var modifiedBaseIngredients = [
      { item_id: 'G1', item_name: 'Pale Malt', quantity: 5, unit: 'kg' },
      { item_id: 'H1', item_name: 'Cascade Hops', quantity: 1, unit: 'pcs' }
    ];
    var catalogMap = {
      G1: { rate: 2, item_name: 'Pale Malt', unit: 'kg' },
      H1: { rate: 4, item_name: 'Cascade Hops', unit: 'pcs' }
    };
    var result = computeModifiedRecipeTotal(recipe, originalIngredients, modifiedBaseIngredients, catalogMap, 1.0, 'in-store');
    // = (5kg × $2) + (1pcs × $4) + service_fee + materials_fee
    // = 10 + 4 + 10 + 5 = $29
    expect(result).toBe(29);
  });

  test('DYNAMIC_MODIFY 1.5×: dynamic recipe sums scaled modified list', function () {
    var recipe = { locked_price: 0, pricing_mode: 'dynamic', service_fee: 10, materials_fee: 5, batch_size_l: 20 };
    var originalIngredients = [
      { item_id: 'G1', item_name: 'Pale Malt', quantity: 5, unit: 'kg' }
    ];
    var modifiedBaseIngredients = [
      { item_id: 'G1', item_name: 'Pale Malt', quantity: 5, unit: 'kg' },
      { item_id: 'H1', item_name: 'Cascade Hops', quantity: 1, unit: 'pcs' }
    ];
    var catalogMap = {
      G1: { rate: 2, item_name: 'Pale Malt', unit: 'kg' },
      H1: { rate: 4, item_name: 'Cascade Hops', unit: 'pcs' }
    };
    var result = computeModifiedRecipeTotal(recipe, originalIngredients, modifiedBaseIngredients, catalogMap, 1.5, 'in-store');
    // G1: 5kg × 1.5 = 7.5kg × $2 = $15 (linear)
    // H1: 1pcs × 1.5 = Math.max(1, ceil(1.5)) = 2pcs × $4 = $8 (discrete)
    // + service_fee 10 + materials_fee 5 = $38
    expect(result).toBe(38);
  });

  test('DYNAMIC_MODIFY remove: dynamic recipe with removed line prices only the remaining list', function () {
    var recipe = { locked_price: 0, pricing_mode: 'dynamic', service_fee: 10, materials_fee: 5, batch_size_l: 20 };
    var originalIngredients = [
      { item_id: 'G1', item_name: 'Pale Malt', quantity: 5, unit: 'kg' },
      { item_id: 'H1', item_name: 'Cascade Hops', quantity: 1, unit: 'pcs' }
    ];
    // Modified: removed H1
    var modifiedBaseIngredients = [
      { item_id: 'G1', item_name: 'Pale Malt', quantity: 5, unit: 'kg' }
    ];
    var catalogMap = {
      G1: { rate: 2, item_name: 'Pale Malt', unit: 'kg' },
      H1: { rate: 4, item_name: 'Cascade Hops', unit: 'pcs' }
    };
    var result = computeModifiedRecipeTotal(recipe, originalIngredients, modifiedBaseIngredients, catalogMap, 1.0, 'in-store');
    // = (5kg × $2) + 10 + 5 = $25 (H1 credit is natural since dynamic sums the list — D-09)
    expect(result).toBe(25);
  });

  // ---------------------------------------------------------------------------
  // Immutability & determinism
  // ---------------------------------------------------------------------------

  test('immutability: original and modified arrays are unchanged after call', function () {
    var recipe = { locked_price: 45, service_fee: 45, materials_fee: 5, pricing_mode: 'locked', batch_size_l: 20 };
    var originalIngredients = [
      { item_id: 'G1', item_name: 'Pale Malt', quantity: 5, unit: 'kg' }
    ];
    var modifiedBaseIngredients = [
      { item_id: 'G1', item_name: 'Pale Malt', quantity: 5, unit: 'kg' },
      { item_id: 'H1', item_name: 'Cascade Hops', quantity: 1, unit: 'pcs' }
    ];
    var catalogMap = { H1: { rate: 4, item_name: 'Cascade Hops', unit: 'pcs' } };

    // Deep copy before call to compare after
    var origBefore = JSON.parse(JSON.stringify(originalIngredients));
    var modBefore  = JSON.parse(JSON.stringify(modifiedBaseIngredients));

    computeModifiedRecipeTotal(recipe, originalIngredients, modifiedBaseIngredients, catalogMap, 1.5, 'in-store');

    // Arrays unchanged
    expect(originalIngredients).toHaveLength(origBefore.length);
    expect(modifiedBaseIngredients).toHaveLength(modBefore.length);
    // Ingredient objects unchanged
    expect(originalIngredients[0].quantity).toBe(origBefore[0].quantity);
    expect(modifiedBaseIngredients[0].quantity).toBe(modBefore[0].quantity);
    expect(modifiedBaseIngredients[1].quantity).toBe(modBefore[1].quantity);
  });

  test('determinism: same inputs return same number twice', function () {
    var recipe = { locked_price: 45, service_fee: 45, materials_fee: 5, pricing_mode: 'locked', batch_size_l: 20 };
    var originalIngredients = [];
    var modifiedBaseIngredients = [{ item_id: 'H1', item_name: 'Cascade Hops', quantity: 1, unit: 'pcs' }];
    var catalogMap = { H1: { rate: 4, item_name: 'Cascade Hops', unit: 'pcs' } };
    var r1 = computeModifiedRecipeTotal(recipe, originalIngredients, modifiedBaseIngredients, catalogMap, 1.5, 'in-store');
    var r2 = computeModifiedRecipeTotal(recipe, originalIngredients, modifiedBaseIngredients, catalogMap, 1.5, 'in-store');
    expect(r1).toBe(r2);
    expect(r1).toBe(125.50);
  });

  // ---------------------------------------------------------------------------
  // Security: T-36-01 — client-supplied rate field MUST be ignored (catalog rate used)
  // ---------------------------------------------------------------------------

  test('T-36-01: client-supplied rate on added ingredient is ignored; catalog rate is used', function () {
    var recipe = { locked_price: 45, service_fee: 45, materials_fee: 5, pricing_mode: 'locked', batch_size_l: 20 };
    var originalIngredients = [];
    // Client sends a "rate" field on the ingredient — this MUST be ignored
    var modifiedBaseIngredients = [{ item_id: 'H1', item_name: 'Cascade Hops', quantity: 1, unit: 'pcs', rate: 999 }];
    var catalogMap = { H1: { rate: 4, item_name: 'Cascade Hops', unit: 'pcs' } };
    var result = computeModifiedRecipeTotal(recipe, originalIngredients, modifiedBaseIngredients, catalogMap, 1.0, 'in-store');
    // Must use catalog rate $4, not client-sent $999
    // = 45 + 45 + 5 + (1 × 4) = $99
    expect(result).toBe(99);
  });

});

// ---------------------------------------------------------------------------
// CONTINUOUS_UNITS / DISCRETE_UNITS exports
// ---------------------------------------------------------------------------
describe('exported unit constants', function () {
  test('CONTINUOUS_UNITS contains kg, g, l, ml', function () {
    expect(scaling.CONTINUOUS_UNITS).toContain('kg');
    expect(scaling.CONTINUOUS_UNITS).toContain('g');
    expect(scaling.CONTINUOUS_UNITS).toContain('l');
    expect(scaling.CONTINUOUS_UNITS).toContain('ml');
  });

  test('DISCRETE_UNITS contains pcs, each, unit, pkg, ft', function () {
    expect(scaling.DISCRETE_UNITS).toContain('pcs');
    expect(scaling.DISCRETE_UNITS).toContain('each');
    expect(scaling.DISCRETE_UNITS).toContain('unit');
    expect(scaling.DISCRETE_UNITS).toContain('pkg');
    expect(scaling.DISCRETE_UNITS).toContain('ft');
  });
});
