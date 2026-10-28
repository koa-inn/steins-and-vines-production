'use strict';

// Phase 94 review WR-02: the staff list/detail reads ask Postgres for batch_type extras.

jest.mock('../lib/db', function () {
  return { withTransaction: jest.fn(function (fn) { return fn({ fake: true }); }) };
});
jest.mock('../lib/batch-pg-read', function () {
  return { listBatches: jest.fn(), getBatchDetail: jest.fn(), getDashboardSummary: jest.fn() };
});
jest.mock('../lib/ferm-schedule-store', function () { return { list: jest.fn() }; });
jest.mock('../lib/ops-mirror', function () { return { schedule: jest.fn() }; });
jest.mock('../lib/logger', function () {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
});

var db = require('../lib/db');
var pgRead = require('../lib/batch-pg-read');
var schedStore = require('../lib/ferm-schedule-store');
var store = require('../lib/batch-store');

var CLIENT = { fake: true };

beforeEach(function () {
  jest.resetAllMocks();
  db.withTransaction.mockImplementation(function (fn) { return fn(CLIENT); });
  pgRead.listBatches.mockResolvedValue({ ok: true, data: { batches: [] } });
  pgRead.getBatchDetail.mockResolvedValue({ ok: true, data: { batch: {} } });
  pgRead.getDashboardSummary.mockResolvedValue({ ok: true, data: {} });
  schedStore.list.mockResolvedValue({ ok: true, data: { schedules: [] } });
  process.env.OPS_DATA_STORE = 'postgres';
  process.env.BATCHES_STORE = 'postgres';
  delete process.env.BATCHES_FREEZE;
});

afterEach(function () {
  delete process.env.OPS_DATA_STORE;
  delete process.env.BATCHES_STORE;
});

describe('batch-store list/detail request batch_type', function () {
  it('list passes includeType', async function () {
    await store.list({ status: 'active' });
    expect(pgRead.listBatches.mock.calls[0][1].includeType).toBe(true);
  });

  it('batchInit passes includeType', async function () {
    await store.batchInit({});
    expect(pgRead.listBatches.mock.calls[0][1].includeType).toBe(true);
  });

  it('detail passes includeType', async function () {
    await store.detail({ batch_id: 'SV-B-000001' });
    expect(pgRead.getBatchDetail.mock.calls[0][2]).toEqual({ includeType: true });
  });
});
