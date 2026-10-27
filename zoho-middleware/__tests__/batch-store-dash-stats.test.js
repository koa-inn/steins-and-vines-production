'use strict';

jest.mock('../lib/db', function () {
  return { withTransaction: jest.fn(function (fn) { return fn({ fake: true }); }) };
});
jest.mock('../lib/batch-pg-read', function () { return { getDashboardStats: jest.fn() }; });
jest.mock('../lib/batch-pg-update', function () { return { updateBatch: jest.fn() }; });
jest.mock('../lib/batch-type-hints', function () { return { kioskProductIndex: jest.fn() }; });
jest.mock('../lib/ops-mirror', function () { return { schedule: jest.fn() }; });
jest.mock('../lib/logger', function () {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
});

var db = require('../lib/db');
var pgRead = require('../lib/batch-pg-read');
var pgUpdate = require('../lib/batch-pg-update');
var hints = require('../lib/batch-type-hints');
var store = require('../lib/batch-store');

var CLIENT = { fake: true };
var clock;

function stats() {
  return {
    ok: true,
    data: {
      batches: [
        { batch_id: 'SV-B-000001', product_sku: 'SKU-1', product_subcategory: '', product_brand: '', product_manufacturer: '' },
        { batch_id: 'SV-B-000002', product_sku: 'NOPE', product_subcategory: '', product_brand: '', product_manufacturer: '' }
      ],
      tasks: [], latestReadings: [], summary: {}
    }
  };
}

beforeEach(function () {
  jest.resetAllMocks();
  db.withTransaction.mockImplementation(function (fn) { return fn(CLIENT); });
  pgRead.getDashboardStats.mockImplementation(function () { return Promise.resolve(stats()); });
  hints.kioskProductIndex.mockResolvedValue({});
  process.env.OPS_DATA_STORE = 'postgres';
  process.env.BATCHES_STORE = 'postgres';
  delete process.env.BATCHES_FREEZE;
  clock = 1000000;
  store._setDashClockForTest(function () { return clock; });
  store._clearDashMemoForTest();
});

afterEach(function () {
  delete process.env.OPS_DATA_STORE;
  delete process.env.BATCHES_STORE;
  delete process.env.BATCHES_FREEZE;
});

describe('batch-store dashStats', function () {
  it('memoises for 60 s and re-reads after', async function () {
    await store.dashStats();
    await store.dashStats();
    expect(pgRead.getDashboardStats).toHaveBeenCalledTimes(1);
    clock += 60000;
    await store.dashStats();
    expect(pgRead.getDashboardStats).toHaveBeenCalledTimes(1);
    clock += 1;
    await store.dashStats();
    expect(pgRead.getDashboardStats).toHaveBeenCalledTimes(2);
  });

  it('a successful write clears the memo', async function () {
    pgUpdate.updateBatch.mockResolvedValue({ ok: true, _batchId: 'SV-B-000001' });
    await store.dashStats();
    await store.update({ batch_id: 'SV-B-000001' });
    await store.dashStats();
    expect(pgRead.getDashboardStats).toHaveBeenCalledTimes(2);
  });

  it('a failed write does not clear the memo', async function () {
    pgUpdate.updateBatch.mockResolvedValue({ ok: false, error: 'nope' });
    await store.dashStats();
    await store.update({ batch_id: 'SV-B-000001' });
    await store.dashStats();
    expect(pgRead.getDashboardStats).toHaveBeenCalledTimes(1);
  });

  it('sheets mode resolves null without reading', async function () {
    delete process.env.BATCHES_STORE;
    var r = await store.dashStats();
    expect(r).toBeNull();
    expect(pgRead.getDashboardStats).not.toHaveBeenCalled();
  });

  it('enriches subcategory, brand and manufacturer from the kiosk index', async function () {
    hints.kioskProductIndex.mockResolvedValue({
      'SKU-1': { cf_type: 'wine', cf_subcategory: 'Red', brand: 'Cru', manufacturer: 'Winexpert' }
    });
    var r = await store.dashStats();
    expect(r.data.batches[0].product_subcategory).toBe('Red');
    expect(r.data.batches[0].product_brand).toBe('Cru');
    expect(r.data.batches[0].product_manufacturer).toBe('Winexpert');
    expect(r.data.batches[1].product_subcategory).toBe('');
  });

  it('returns unenriched rows when the kiosk index rejects', async function () {
    hints.kioskProductIndex.mockRejectedValue(new Error('redis down'));
    var r = await store.dashStats();
    expect(r.ok).toBe(true);
    expect(r.data.batches[0].product_subcategory).toBe('');
  });

  it('a DB error rejects and leaves no memo', async function () {
    pgRead.getDashboardStats.mockRejectedValueOnce(new Error('db down'));
    await expect(store.dashStats()).rejects.toThrow('db down');
    var r = await store.dashStats();
    expect(r.ok).toBe(true);
    expect(pgRead.getDashboardStats).toHaveBeenCalledTimes(2);
  });

  it('dashStats is not a write op', function () {
    expect(store.WRITE_OPS).not.toContain('dashStats');
  });
});
