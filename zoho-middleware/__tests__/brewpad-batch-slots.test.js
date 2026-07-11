'use strict';

// Regression: batch count must be bounded by the Makers Fee quantity.
//
// Bug (found 2026-07-11): detectKitItems() treats EVERY non-fee, non-blank line as a
// kit. Once batch creation became quantity-aware (fda6e40), a line of ordinary
// merchandise produced one batch per unit — e.g. INV-000067 (Martin, James) carries
// "750mL Bordeaux Bottle Clear" x12 alongside a single real kit, which would create
// 13 batches instead of 1.
//
// The Makers Fee quantity is the authoritative count of fermentation slots sold, so
// it caps how many batches a sale may ever produce.

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

var brewpadIntegration = require('../lib/brewpad-integration');

var MAKERS_FEE = { item_id: '109900000000046478', sku: 'MAKERS-FEE', name: 'Makers Fee', quantity: 1, rate: 45 };
var MAT_FEE = { item_id: '109900000000515004', sku: 'MAT-FEE', name: 'Materials Fee', quantity: 1, rate: 5 };

function makersFee(qty) {
  return Object.assign({}, MAKERS_FEE, { quantity: qty });
}
function matFee(qty) {
  return Object.assign({}, MAT_FEE, { quantity: qty });
}

// Names of the kit each planned batch would be created for.
function plannedNames(lineItems) {
  return brewpadIntegration.planKitBatches(lineItems).map(function (i) { return i.name; });
}

describe('planKitBatches — Makers Fee quantity bounds batch creation', function () {

  it('INV-000137 shape: 3 kits, fee qty 3 => 3 batches (the clean case)', function () {
    var items = [
      { item_id: '109900000000021885', sku: '80087352', name: 'Italy Nebbiolo Style', quantity: 3, rate: 170 },
      makersFee(3),
      matFee(3),
      // the blank "Discount" line that used to create an empty-product batch
      { item_id: '', sku: '', name: '', description: 'Discount', quantity: 1, rate: -50 }
    ];
    expect(plannedNames(items)).toEqual([
      'Italy Nebbiolo Style', 'Italy Nebbiolo Style', 'Italy Nebbiolo Style'
    ]);
  });

  it('INV-000067 shape: 1 kit + 12 bottles, fee qty 1 => exactly 1 batch, and it is the KIT', function () {
    var items = [
      { item_id: 'bottle-1', sku: 'bor-clear', name: '750mL Bordeaux Bottle Clear', quantity: 12, rate: 2.5 },
      { item_id: '109900000000021885', sku: '80087352', name: 'Italy Nebbiolo Style', quantity: 1, rate: 170 },
      makersFee(1),
      matFee(1)
    ];
    // Before the fix this returned 13 entries (12 phantom bottle batches).
    expect(plannedNames(items)).toEqual(['Italy Nebbiolo Style']);
  });

  it('multi-kit sale (INV-000022 shape): fee qty 4 => 4 batches across both kits', function () {
    var items = [
      { item_id: 'k1', sku: 'ST1', name: 'Italy Super Tuscan', quantity: 3, rate: 180 },
      { item_id: 'k2', sku: 'SB1', name: 'South Africa Sauvignon Blanc', quantity: 1, rate: 160 },
      makersFee(4),
      matFee(4)
    ];
    var names = plannedNames(items);
    expect(names).toHaveLength(4);
    expect(names.filter(function (n) { return n === 'Italy Super Tuscan'; })).toHaveLength(3);
    expect(names.filter(function (n) { return n === 'South Africa Sauvignon Blanc'; })).toHaveLength(1);
  });

  it('kit + merchandise together: never exceeds the fee quantity', function () {
    var items = [
      { item_id: 'k1', sku: '80087352', name: 'Italy Nebbiolo Style', quantity: 2, rate: 170 },
      { item_id: 'm1', sku: 'bor-clear', name: '750mL Bordeaux Bottle Clear', quantity: 24, rate: 2.5 },
      { item_id: 'm2', sku: 'COR-1', name: 'Corks (bag of 30)', quantity: 2, rate: 12 },
      makersFee(2),
      matFee(2)
    ];
    expect(plannedNames(items)).toEqual(['Italy Nebbiolo Style', 'Italy Nebbiolo Style']);
  });

  it('no Makers Fee = not a ferment sale => no batches', function () {
    var items = [
      { item_id: 'm1', sku: 'bor-clear', name: '750mL Bordeaux Bottle Clear', quantity: 12, rate: 2.5 }
    ];
    expect(brewpadIntegration.planKitBatches(items)).toEqual([]);
  });

  it('legacy sale with no quantity on the fee line defaults to 1 batch', function () {
    var items = [
      { item_id: 'k1', sku: '80087352', name: 'Italy Nebbiolo Style', quantity: 1, rate: 170 },
      { item_id: '109900000000046478', sku: 'MAKERS-FEE', name: 'Makers Fee', rate: 45 }
    ];
    expect(plannedNames(items)).toEqual(['Italy Nebbiolo Style']);
  });

  it('blank lines never become batches', function () {
    var items = [
      { item_id: '', sku: '', name: '', description: 'Discount', quantity: 1, rate: -50 },
      { item_id: 'k1', sku: '80087352', name: 'Italy Nebbiolo Style', quantity: 1, rate: 170 },
      makersFee(1)
    ];
    expect(plannedNames(items)).toEqual(['Italy Nebbiolo Style']);
  });

  it('is defensive about junk input', function () {
    expect(brewpadIntegration.planKitBatches(null)).toEqual([]);
    expect(brewpadIntegration.planKitBatches([])).toEqual([]);
  });
});

// The Apps Script createBatch guard rejects a second batch for the same
// (zoho_so_number + product_sku) as a duplicate — which silently killed batches
// 2..N of every multi-unit kit line (INV-000137 sold 3 kits and kept 1).
// The payload now carries unit_total so the guard can allow exactly that many.
describe('createBatchesFromSale — unit_total lets Apps Script admit every unit', function () {
  var axios = require('axios');

  beforeEach(function () {
    jest.resetModules();
    axios.post.mockReset();
    axios.post.mockResolvedValue({ data: { ok: true, batch_id: 'SV-B-000001' } });
    process.env.APPS_SCRIPT_URL = 'https://script.google.com/test';
    process.env.APPS_SCRIPT_SERVER_TOKEN = 'test-token';
  });

  it('stamps unit_total = the number of batches for that invoice+SKU', function () {
    var items = [
      { item_id: 'kit-1', sku: '80087352', name: 'Italy Nebbiolo Style', quantity: 3, rate: 170 },
      makersFee(3),
      matFee(3)
    ];
    brewpadIntegration.createBatchesFromSale(items, 'INV-000137', 'Gamba, Remo', 'C-1', null);

    expect(axios.post).toHaveBeenCalledTimes(3);
    axios.post.mock.calls.forEach(function (call) {
      var payload = JSON.parse(call[1]);
      expect(payload.product_sku).toBe('80087352');
      expect(payload.unit_total).toBe(3);
    });
  });

  it('unit_total is per-SKU, not per-sale, on a multi-kit invoice', function () {
    var items = [
      { item_id: 'k1', sku: 'ST1', name: 'Italy Super Tuscan', quantity: 3, rate: 180 },
      { item_id: 'k2', sku: 'SB1', name: 'South Africa Sauvignon Blanc', quantity: 1, rate: 160 },
      makersFee(4),
      matFee(4)
    ];
    brewpadIntegration.createBatchesFromSale(items, 'INV-000022', 'Tanner, Ken', 'C-2', null);

    expect(axios.post).toHaveBeenCalledTimes(4);
    var bySku = {};
    axios.post.mock.calls.forEach(function (call) {
      var p = JSON.parse(call[1]);
      bySku[p.product_sku] = p.unit_total;
    });
    expect(bySku.ST1).toBe(3);   // 3 units of this kit
    expect(bySku.SB1).toBe(1);   // 1 unit of that kit
  });
});
