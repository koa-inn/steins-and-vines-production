'use strict';

var scaling = require('../lib/recipe-scaling');
var scaleIngredient          = scaling.scaleIngredient;
var scaleIngredients         = scaling.scaleIngredients;
var computeScaledRecipeTotal = scaling.computeScaledRecipeTotal;
var checkScaledStock         = scaling.checkScaledStock;

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

  test('unknown non-blank token treated as discrete (ceil)', function () {
    // A token not in CONTINUOUS_UNITS and not blank → discrete
    var result = scaleIngredient({ item_id: 'z1', quantity: 2, unit: 'sack' }, 1.5);
    // 2 × 1.5 = 3.0 → Math.max(1, Math.ceil(3.0)) = 3
    expect(result.quantity).toBe(3);
  });

  test('unknown non-blank token with small factor applies floor-of-1', function () {
    // unknown token → discrete
    var result = scaleIngredient({ item_id: 'z2', quantity: 1, unit: 'sack' }, 0.4);
    // 1 × 0.4 = 0.4 → Math.max(1, Math.ceil(0.4)) = 1
    expect(result.quantity).toBe(1);
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
