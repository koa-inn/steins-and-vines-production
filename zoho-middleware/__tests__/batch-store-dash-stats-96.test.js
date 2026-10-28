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

function stats(withNew) {
  var d = {
    batches: [
      { batch_id: 'SV-B-000001', product_sku: 'SKU-1', product_subcategory: '', product_brand: '', product_manufacturer: '' }
    ],
    tasks: [], latestReadings: [], summary: {}
  };
  if (withNew) {
    d.taskRows = [{ batch_id: 'SV-B-000001', task_id: 'BT-000001', title: 'Rack', due_date: '2026-10-24', completed: false, completed_day: null, is_packaging: false, is_transfer: true }];
    d.readings = [{ batch_id: 'SV-B-000001', reading_at: '2026-10-05T12:00:00Z', reading_day: '2026-10-05', degrees_plato: 12.5, temperature: null, ph: null }];
    d.vessels = [{ vessel_id: 'VZ-001', type: 'Fermenter', capacity_liters: 23.5, archived: false }];
    d.batchMeta = [{ batch_id: 'SV-B-000001', has_invoice_link: true, planned_days: 21, recipe_name: 'Hazy', recipe_style: 'NEIPA', og: null, target_fg: null }];
  }
  return { ok: true, data: d };
}

var clock;

beforeEach(function () {
  jest.resetAllMocks();
  db.withTransaction.mockImplementation(function (fn) { return fn(CLIENT); });
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

describe('batch-store dashStats Phase 96 arrays', function () {
  it('passes taskRows, readings, vessels and batchMeta through unchanged', async function () {
    pgRead.getDashboardStats.mockImplementation(function () { return Promise.resolve(stats(true)); });
    var res = await store.dashStats();
    var expected = stats(true).data;
    ['taskRows', 'readings', 'vessels', 'batchMeta'].forEach(function (k) {
      expect(res.data[k]).toEqual(expected[k]);
    });
  });

  it('keeps the arrays on a memoised second call', async function () {
    pgRead.getDashboardStats.mockImplementation(function () { return Promise.resolve(stats(true)); });
    await store.dashStats();
    var res = await store.dashStats();
    expect(pgRead.getDashboardStats).toHaveBeenCalledTimes(1);
    expect(res.data.taskRows.length).toBe(1);
    expect(res.data.batchMeta[0].recipe_name).toBe('Hazy');
  });

  it('tolerates a pre-deploy shape without the new keys', async function () {
    pgRead.getDashboardStats.mockImplementation(function () { return Promise.resolve(stats(false)); });
    var res = await store.dashStats();
    expect(res.ok).toBe(true);
    ['taskRows', 'readings', 'vessels', 'batchMeta'].forEach(function (k) {
      expect(res.data[k]).toBeUndefined();
    });
  });
});
