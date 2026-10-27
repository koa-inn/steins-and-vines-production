'use strict';

jest.mock('../lib/db', function () {
  return { withTransaction: jest.fn(function (fn) { return fn({ fake: true }); }) };
});
jest.mock('../lib/batch-pg-create', function () { return { createBatch: jest.fn() }; });
jest.mock('../lib/batch-type-hints', function () { return { zohoTypeHint: jest.fn() }; });
jest.mock('../lib/ops-mirror', function () { return { schedule: jest.fn() }; });
jest.mock('../lib/logger', function () {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
});

var db = require('../lib/db');
var create = require('../lib/batch-pg-create');
var hints = require('../lib/batch-type-hints');
var store = require('../lib/batch-store');

var CLIENT = { fake: true };

beforeEach(function () {
  jest.resetAllMocks();
  db.withTransaction.mockImplementation(function (fn) { return fn(CLIENT); });
  create.createBatch.mockResolvedValue({ ok: true, batch_id: 'SV-B-000001' });
  process.env.OPS_DATA_STORE = 'postgres';
  process.env.BATCHES_STORE = 'postgres';
  delete process.env.BATCHES_FREEZE;
});

afterEach(function () {
  delete process.env.OPS_DATA_STORE;
  delete process.env.BATCHES_STORE;
  delete process.env.BATCHES_FREEZE;
});

describe('batch-store create type hint', function () {
  it('awaits zohoTypeHint once and passes typeHints to createBatch', async function () {
    hints.zohoTypeHint.mockResolvedValue({ cfType: 'wine' });
    var r = await store.create({ product_sku: 'SKU-1', source: 'kiosk' });
    expect(r.ok).toBe(true);
    expect(hints.zohoTypeHint).toHaveBeenCalledTimes(1);
    expect(hints.zohoTypeHint).toHaveBeenCalledWith('SKU-1');
    expect(create.createBatch.mock.calls[0][2].typeHints).toEqual({ zohoCfType: 'wine' });
  });

  it('a null hint still creates with an empty cf type', async function () {
    hints.zohoTypeHint.mockResolvedValue(null);
    var r = await store.create({ product_sku: 'SKU-1' });
    expect(r.ok).toBe(true);
    expect(create.createBatch.mock.calls[0][2].typeHints).toEqual({ zohoCfType: '' });
  });

  it('a rejecting hint lookup never blocks create', async function () {
    hints.zohoTypeHint.mockRejectedValue(new Error('redis down'));
    var r = await store.create({ product_sku: 'SKU-1' });
    expect(r.ok).toBe(true);
    expect(create.createBatch.mock.calls[0][2].typeHints).toEqual({ zohoCfType: '' });
  });

  it('sheets mode does not look up the hint and resolves null', async function () {
    delete process.env.BATCHES_STORE;
    var r = await store.create({ product_sku: 'SKU-1' });
    expect(r).toBeNull();
    expect(hints.zohoTypeHint).not.toHaveBeenCalled();
  });

  it('frozen does not look up the hint and returns the maintenance envelope', async function () {
    process.env.BATCHES_FREEZE = '1';
    var r = await store.create({ product_sku: 'SKU-1' });
    expect(r.ok).toBe(false);
    expect(hints.zohoTypeHint).not.toHaveBeenCalled();
    expect(create.createBatch).not.toHaveBeenCalled();
  });

  it('skips the lookup when there is no product_sku', async function () {
    var r = await store.create({ recipe_id: 'SV-R-000001' });
    expect(r.ok).toBe(true);
    expect(hints.zohoTypeHint).not.toHaveBeenCalled();
  });
});
