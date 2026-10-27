'use strict';

/**
 * Phase 94 Plan 04 (D-15, D-16, T-94-12): the store facade must never forward a trusted /
 * source option to the Postgres update module; only server-side callers of pgUpdate can.
 */

jest.mock('../lib/db', function () {
  return { withTransaction: jest.fn(function (fn) { return fn({ fake: true }); }) };
});
jest.mock('../lib/batch-pg-read', function () { return {}; });
jest.mock('../lib/batch-pg-create', function () { return { createBatch: jest.fn() }; });
jest.mock('../lib/batch-pg-update', function () {
  return {
    updateBatch: jest.fn(), updateBatchSchedule: jest.fn(), deleteBatch: jest.fn(),
    regenerateToken: jest.fn()
  };
});
jest.mock('../lib/batch-pg-tasks', function () { return {}; });
jest.mock('../lib/ferm-schedule-store', function () { return { list: jest.fn() }; });
jest.mock('../lib/ops-mirror', function () { return { schedule: jest.fn() }; });
jest.mock('../lib/logger', function () {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
});

var db = require('../lib/db');
var upd = require('../lib/batch-pg-update');
var store = require('../lib/batch-store');

beforeEach(function () {
  jest.resetAllMocks();
  db.withTransaction.mockImplementation(function (fn) { return fn({ fake: true }); });
  upd.updateBatch.mockResolvedValue({ ok: true });
  process.env.OPS_DATA_STORE = 'postgres';
  process.env.BATCHES_STORE = 'postgres';
  delete process.env.BATCHES_FREEZE;
});

afterEach(function () {
  delete process.env.OPS_DATA_STORE;
  delete process.env.BATCHES_STORE;
});

describe('batch-store.update trusted channel', function () {
  it('drops trusted and source options from the opts passed to pgUpdate', async function () {
    var payload = {
      batch_id: 'SV-B-000001',
      updates: { batch_type: 'wine' },
      trusted: true,
      batchTypeSource: 'zoho',
      completedAtSource: 'backfill-task'
    };
    await store.update(payload, { trusted: true, batchTypeSource: 'zoho', actor: 'staff' });
    expect(upd.updateBatch).toHaveBeenCalledTimes(1);
    var passedOpts = upd.updateBatch.mock.calls[0][2];
    expect(Object.keys(passedOpts).sort()).toEqual(['actor', 'now']);
  });
});
