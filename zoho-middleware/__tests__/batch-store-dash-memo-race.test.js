'use strict';

// Phase 94 review WR-03: a dashStats read in flight when a write commits must not memoise its
// pre-write snapshot.

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

function stats(tag) {
  return { ok: true, data: { batches: [], tasks: [], latestReadings: [], summary: { tag: tag } } };
}

beforeEach(function () {
  jest.resetAllMocks();
  db.withTransaction.mockImplementation(function (fn) { return fn({ fake: true }); });
  hints.kioskProductIndex.mockResolvedValue({});
  pgUpdate.updateBatch.mockResolvedValue({ ok: true, _batchId: 'SV-B-000001' });
  process.env.OPS_DATA_STORE = 'postgres';
  process.env.BATCHES_STORE = 'postgres';
  delete process.env.BATCHES_FREEZE;
  store._setDashClockForTest(function () { return 1000000; });
  store._clearDashMemoForTest();
});

afterEach(function () {
  delete process.env.OPS_DATA_STORE;
  delete process.env.BATCHES_STORE;
});

describe('batch-store dashStats memo vs concurrent write', function () {
  it('does not cache a read that started before a write committed', async function () {
    var release;
    pgRead.getDashboardStats.mockImplementationOnce(function () {
      return new Promise(function (resolve) { release = function () { resolve(stats('before')); }; });
    });
    pgRead.getDashboardStats.mockImplementation(function () { return Promise.resolve(stats('after')); });

    var inFlight = store.dashStats();
    await store.update({ batch_id: 'SV-B-000001' });
    release();
    var first = await inFlight;
    expect(first.data.summary.tag).toBe('before');

    var next = await store.dashStats();
    expect(next.data.summary.tag).toBe('after');
    expect(pgRead.getDashboardStats).toHaveBeenCalledTimes(2);
  });
});
