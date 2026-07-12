'use strict';

// Kit identification from the authoritative Kits sheet (97 kits, 8 brands).
//
// The Zoho catalog carries no marker for a kit — every item has a blank category and
// product_type "goods" — so detectKitItems() treated EVERY non-fee line as a kit and
// planKitBatches() had to guess by unit price when a sale mixed kits with merchandise.
// The Kits sheet is the real registry and discriminates exactly: SKU 80087352 (Italy
// Nebbiolo Style) is a kit; bor-clear (750mL bottle), MAKERS-FEE and MAT-FEE are not.
//
// Safety contract: the registry may only ever NARROW the candidate lines. If it is
// unavailable, stale, or recognises nothing on a genuine ferment sale, we fall back to
// the previous behaviour rather than create ZERO batches — a kit newly added to Zoho
// but not yet to the sheet must not silently lose its batch.

jest.mock('../lib/cache', function () {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(),
    del: jest.fn().mockResolvedValue(),
    isConnected: jest.fn().mockReturnValue(true),
    getClient: jest.fn().mockResolvedValue({ keys: jest.fn().mockResolvedValue([]) })
  };
});
jest.mock('../lib/logger', function () {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
});
jest.mock('../lib/eventLog', function () {
  return { logEvent: jest.fn() };
});
jest.mock('axios');

var axios = require('axios');
var brewpadIntegration = require('../lib/brewpad-integration');

var MAKERS_FEE = { item_id: '109900000000046478', sku: 'MAKERS-FEE', name: 'Makers Fee', rate: 45 };
var MAT_FEE = { item_id: '109900000000515004', sku: 'MAT-FEE', name: 'Materials Fee', rate: 5 };

function makersFee(qty) { return Object.assign({}, MAKERS_FEE, { quantity: qty }); }
function matFee(qty) { return Object.assign({}, MAT_FEE, { quantity: qty }); }

var KIT = { item_id: '109900000000021885', sku: '80087352', name: 'Italy Nebbiolo Style', quantity: 1, rate: 170 };
var BOTTLES = { item_id: 'b1', sku: 'bor-clear', name: '750mL Bordeaux Bottle Clear', quantity: 12, rate: 2.5 };

// The Apps Script get_kits response: raw sheet rows, header first.
function mockKitsSheet(skus) {
  axios.get.mockResolvedValue({
    data: {
      ok: true,
      data: { values: [['sku', 'name', 'type', 'brand']].concat(skus.map(function (s) {
        return [s, 'Some Kit', 'Wine', 'Cru Select'];
      })) }
    }
  });
}

function plannedNames(items) {
  return brewpadIntegration.planKitBatches(items).map(function (i) { return i.name; });
}

beforeEach(function () {
  axios.get.mockReset();
  brewpadIntegration._setKitSkus(null);   // registry unknown until refreshed
  process.env.APPS_SCRIPT_URL = 'https://script.google.com/test';
  process.env.APPS_SCRIPT_SERVER_TOKEN = 'test-token';
});

describe('refreshKitSkus — loads the Kits sheet registry', function () {

  it('parses the sheet into a SKU set and reports its size', function () {
    mockKitsSheet(['80087352', '26115', '80088332']);
    return brewpadIntegration.refreshKitSkus().then(function (set) {
      expect(set.size).toBe(3);
      expect(set.has('80087352')).toBe(true);
      expect(set.has('bor-clear')).toBe(false);
    });
  });

  it('leaves the registry unset when Apps Script fails (no hard dependency)', function () {
    axios.get.mockRejectedValue(new Error('apps script down'));
    return brewpadIntegration.refreshKitSkus().then(function (set) {
      expect(set).toBeNull();
      expect(brewpadIntegration._getKitSkus()).toBeNull();
    });
  });
});

describe('planKitBatches with the Kits registry loaded', function () {

  it('the bottles line is excluded because it is not a kit — no price guessing', function () {
    brewpadIntegration._setKitSkus(new Set(['80087352']));
    var items = [BOTTLES, KIT, makersFee(1), matFee(1)];
    expect(plannedNames(items)).toEqual(['Italy Nebbiolo Style']);
  });

  it('a CHEAP kit still wins over EXPENSIVE merchandise (the heuristic could not do this)', function () {
    // A $40 cider kit sold alongside a $300 conical fermenter: price order would have
    // picked the fermenter and created a batch for a piece of equipment.
    brewpadIntegration._setKitSkus(new Set(['CIDER-1']));
    var items = [
      { item_id: 'e1', sku: 'FERM-CONICAL', name: 'Conical Fermenter 30L', quantity: 1, rate: 300 },
      { item_id: 'c1', sku: 'CIDER-1', name: 'Mangrove Jack Cider', quantity: 1, rate: 40 },
      makersFee(1), matFee(1)
    ];
    expect(plannedNames(items)).toEqual(['Mangrove Jack Cider']);
  });

  it('still creates one batch per unit for a multi-unit kit line', function () {
    brewpadIntegration._setKitSkus(new Set(['80087352']));
    var items = [
      Object.assign({}, KIT, { quantity: 3 }),
      BOTTLES,
      makersFee(3), matFee(3)
    ];
    expect(plannedNames(items)).toEqual([
      'Italy Nebbiolo Style', 'Italy Nebbiolo Style', 'Italy Nebbiolo Style'
    ]);
  });

  it('SAFETY: an unrecognised kit still gets its batch (never zero)', function () {
    // A kit added to Zoho but not yet to the Kits sheet. Falling closed here would
    // silently lose the customer's batch — worse than the bug we are fixing.
    brewpadIntegration._setKitSkus(new Set(['80087352']));
    var items = [
      { item_id: 'new1', sku: 'BRAND-NEW-KIT', name: 'Brand New Kit', quantity: 2, rate: 190 },
      makersFee(2), matFee(2)
    ];
    expect(plannedNames(items)).toEqual(['Brand New Kit', 'Brand New Kit']);
  });

  it('is still capped by the Makers Fee quantity', function () {
    brewpadIntegration._setKitSkus(new Set(['80087352']));
    var items = [
      Object.assign({}, KIT, { quantity: 5 }),   // 5 kits on the line...
      makersFee(2), matFee(2)                     // ...but only 2 slots paid for
    ];
    expect(plannedNames(items)).toHaveLength(2);
  });

  it('falls back to the old behaviour when the registry is unavailable', function () {
    brewpadIntegration._setKitSkus(null);
    var items = [BOTTLES, KIT, makersFee(1), matFee(1)];
    // Price heuristic: the $170 kit outranks the $2.50 bottles.
    expect(plannedNames(items)).toEqual(['Italy Nebbiolo Style']);
  });
});
