'use strict';

jest.mock('../lib/logger', function () {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
});
jest.mock('../lib/zoho-api', function () {
  return {
    zohoGet: jest.fn(),
    zohoPost: jest.fn(),
    zohoPostOnce: jest.fn(),
    zohoDelete: jest.fn()
  };
});
jest.mock('../lib/cache', function () {
  return { get: jest.fn(), set: jest.fn().mockResolvedValue('OK') };
});
jest.mock('../lib/checkout-helpers', function () {
  return {
    readServicesSnapshot: jest.fn().mockReturnValue([]),
    findMakersFeeItem: jest.fn(),
    findMaterialsFeeItem: jest.fn()
  };
});

var zoho = require('../lib/zoho-api');
var cache = require('../lib/cache');
var helpers = require('../lib/checkout-helpers');
var dep = require('../lib/limited-releases-deposit');

var EMBER = '109900000001719001';

function unit(idx, count) {
  return {
    item_id: EMBER, sku: '80100269', name: 'Ember', release_label: 'November 2026',
    unitIndex: idx, unitCount: count
  };
}
var FEES = { makers: { item_id: '111', rate: 45 }, materials: { item_id: '222', rate: 5 } };

beforeEach(function () {
  jest.resetAllMocks();
  cache.set.mockResolvedValue('OK');
  helpers.readServicesSnapshot.mockReturnValue([]);
});

describe('getKitRate', function () {
  test('reads the live rate and caches it', async function () {
    cache.get.mockResolvedValue(null);
    zoho.zohoGet.mockResolvedValue({ item: { status: 'active', rate: 230 } });
    expect(await dep.getKitRate(EMBER)).toBe(230);
    expect(zoho.zohoGet).toHaveBeenCalledWith('/items/' + EMBER);
    expect(cache.set).toHaveBeenCalledWith('lr:itemrate:' + EMBER, 230, 600);
  });
  test('uses the cached rate without calling Zoho', async function () {
    cache.get.mockResolvedValue(230);
    expect(await dep.getKitRate(EMBER)).toBe(230);
    expect(zoho.zohoGet).not.toHaveBeenCalled();
  });
  test('rejects a non-allowlisted id with zero Zoho calls', async function () {
    await expect(dep.getKitRate('999')).rejects.toThrow();
    expect(zoho.zohoGet).not.toHaveBeenCalled();
  });
  test('rejects rate 0, inactive and missing item', async function () {
    cache.get.mockResolvedValue(null);
    zoho.zohoGet.mockResolvedValueOnce({ item: { status: 'active', rate: 0 } });
    await expect(dep.getKitRate(EMBER)).rejects.toThrow();
    zoho.zohoGet.mockResolvedValueOnce({ item: { status: 'inactive', rate: 230 } });
    await expect(dep.getKitRate(EMBER)).rejects.toThrow();
    zoho.zohoGet.mockResolvedValueOnce({});
    await expect(dep.getKitRate(EMBER)).rejects.toThrow();
  });
});

describe('resolveFeeItems', function () {
  test('returns numeric fee items', async function () {
    cache.get.mockResolvedValue([{}]);
    helpers.findMakersFeeItem.mockReturnValue({ item_id: '111', rate: 45 });
    helpers.findMaterialsFeeItem.mockReturnValue({ item_id: '222', rate: '5' });
    expect(await dep.resolveFeeItems()).toEqual(FEES);
  });
  test('rejects with isFeeConfig on missing or SKU-string ids', async function () {
    cache.get.mockResolvedValue([{}]);
    helpers.findMakersFeeItem.mockReturnValue({ item_id: 'MAKERS-FEE', rate: 45 });
    helpers.findMaterialsFeeItem.mockReturnValue({ item_id: '222', rate: 5 });
    await expect(dep.resolveFeeItems()).rejects.toMatchObject({ isFeeConfig: true });
    helpers.findMakersFeeItem.mockReturnValue(null);
    await expect(dep.resolveFeeItems()).rejects.toMatchObject({ isFeeConfig: true });
  });
  test('falls back to the snapshot when cache is empty', async function () {
    cache.get.mockResolvedValue(null);
    helpers.findMakersFeeItem.mockReturnValue({ item_id: '111', rate: 45 });
    helpers.findMaterialsFeeItem.mockReturnValue({ item_id: '222', rate: 5 });
    await dep.resolveFeeItems();
    expect(helpers.readServicesSnapshot).toHaveBeenCalled();
  });
});

describe('buildDepositSalesOrder', function () {
  var so = dep.buildDepositSalesOrder({
    customerId: 'C1', unit: unit(2, 3), kitRate: 230, fees: FEES, txnId: 'T9',
    consentText: 'I agree', consentAt: '2026-10-29T10:00:00Z', date: '2026-10-29'
  });
  test('has exactly 3 lines, no tax_id, reference set', function () {
    expect(so.line_items).toHaveLength(3);
    so.line_items.forEach(function (l) { expect(l).not.toHaveProperty('tax_id'); });
    expect(so.line_items[0]).toEqual({ item_id: EMBER, quantity: 1, rate: 230 });
    expect(so.reference_number).toBe('LIMITED-2026-27');
    expect(so.customer_id).toBe('C1');
  });
  test('notes carry deposit, txn, release, unit, consent and fee note', function () {
    expect(so.notes).toContain('$50');
    expect(so.notes).toContain('T9');
    expect(so.notes).toContain('November 2026');
    expect(so.notes).toContain('Kit 2 of 3');
    expect(so.notes).toContain('"I agree"');
    expect(so.notes).toContain('2026-10-29T10:00:00Z');
    expect(so.notes).toContain("Maker's Fee and Materials Fee are on this SO and are invoiced on brew day");
  });
});

describe('bookSalesOrderDepositAdvance', function () {
  test('posts an advance with salesorders_to_apply and no invoices key', async function () {
    zoho.zohoPostOnce.mockResolvedValue({ payment: { payment_id: 'P1' } });
    await dep.bookSalesOrderDepositAdvance({
      customerId: 'C1', soId: 'S1', soNumber: 'SO-000090', amount: 50, date: '2026-10-29', helcimTxnId: 'T9'
    });
    var call = zoho.zohoPostOnce.mock.calls[0];
    expect(call[0]).toBe('/customerpayments');
    expect(call[1].salesorders_to_apply[0].salesorder_id).toBe('S1');
    expect(call[1].salesorders_to_apply[0].amount_applied).toBe(50);
    expect(call[1]).not.toHaveProperty('invoices');
    expect(call[1].description).toBe('LIMITED-2026-27 deposit SO-000090 (Helcim T9)');
    expect(call[1].payment_mode).toBe('creditcard');
    expect(call[1].reference_number).toBe('T9');
  });
});

describe('isLimitedReleaseSalesOrder', function () {
  test('matches only LIMITED- references', function () {
    expect(dep.isLimitedReleaseSalesOrder({ reference_number: 'LIMITED-2026-27' })).toBe(true);
    expect(dep.isLimitedReleaseSalesOrder({ reference_number: 'X' })).toBe(false);
    expect(dep.isLimitedReleaseSalesOrder({})).toBe(false);
    expect(dep.isLimitedReleaseSalesOrder(null)).toBe(false);
  });
});

describe('findDepositAdvanceForSalesOrder', function () {
  var SO = { salesorder_number: 'SO-000082', customer_id: 'C1' };
  test('finds the payment by description with unused_amount > 0', async function () {
    zoho.zohoGet.mockResolvedValueOnce({ customerpayments: [
      { payment_id: 'A', description: 'LIMITED-2026-27 deposit SO-000820 (Helcim 1)', unused_amount: 50 },
      { payment_id: 'B', description: 'LIMITED-2026-27 deposit SO-000082 (Helcim 2)', unused_amount: 0 },
      { payment_id: 'C', description: 'LIMITED-2026-27 deposit SO-000082 (Helcim 2)', unused_amount: 50 }
    ] });
    zoho.zohoGet.mockResolvedValueOnce({ payment: { payment_id: 'C', unused_amount: 50, amount: 50 } });
    var r = await dep.findDepositAdvanceForSalesOrder(SO);
    expect(r).toEqual({ payment_id: 'C', unused_amount: 50, amount: 50 });
    expect(zoho.zohoGet.mock.calls[0][0]).toContain('customer_id=C1');
    expect(zoho.zohoGet.mock.calls[0][0]).toContain('search_text=SO-000082');
  });
  test('returns null when none found', async function () {
    zoho.zohoGet.mockResolvedValueOnce({ customerpayments: [] });
    expect(await dep.findDepositAdvanceForSalesOrder(SO)).toBeNull();
  });
  test('rejects on Zoho errors', async function () {
    zoho.zohoGet.mockRejectedValueOnce(new Error('boom'));
    await expect(dep.findDepositAdvanceForSalesOrder(SO)).rejects.toThrow('boom');
  });
});

describe('createDepositSet', function () {
  function args(n) {
    var units = [];
    for (var i = 1; i <= n; i++) units.push(unit(i, n));
    var rates = {}; rates[EMBER] = 230;
    return { customerId: 'C1', units: units, kitRates: rates, fees: FEES, txnId: 'T9',
      consentText: 'ok', consentAt: 'now', date: '2026-10-29' };
  }
  function soOk(n) { return { salesorder: { salesorder_id: 'S' + n, salesorder_number: 'SO-' + n } }; }
  function payOk(n) { return { payment: { payment_id: 'P' + n } }; }

  test('creates SO then payment per unit in order', async function () {
    zoho.zohoPostOnce
      .mockResolvedValueOnce(soOk(1)).mockResolvedValueOnce(payOk(1))
      .mockResolvedValueOnce(soOk(2)).mockResolvedValueOnce(payOk(2));
    var r = await dep.createDepositSet(args(2));
    expect(r.created).toHaveLength(2);
    expect(r.created[1]).toMatchObject({ salesorder_id: 'S2', payment_id: 'P2', name: 'Ember' });
    expect(zoho.zohoPostOnce.mock.calls.map(function (c) { return c[0]; }))
      .toEqual(['/salesorders', '/customerpayments', '/salesorders', '/customerpayments']);
  });

  test('SO_2 failure carries the partial list and stops', async function () {
    var e = new Error('bad'); e.response = { status: 400 };
    zoho.zohoPostOnce
      .mockResolvedValueOnce(soOk(1)).mockResolvedValueOnce(payOk(1))
      .mockRejectedValueOnce(e);
    var caught;
    try { await dep.createDepositSet(args(3)); } catch (x) { caught = x; }
    expect(zoho.zohoPostOnce).toHaveBeenCalledTimes(3);
    expect(caught.created).toHaveLength(1);
    expect(caught.possibleOrphan).toBeFalsy();
  });

  test('payment_2 failure keeps SO_2 with null payment_id', async function () {
    var e = new Error('bad'); e.response = { status: 400 };
    zoho.zohoPostOnce
      .mockResolvedValueOnce(soOk(1)).mockResolvedValueOnce(payOk(1))
      .mockResolvedValueOnce(soOk(2)).mockRejectedValueOnce(e);
    var caught;
    try { await dep.createDepositSet(args(2)); } catch (x) { caught = x; }
    expect(caught.created).toHaveLength(2);
    expect(caught.created[1]).toMatchObject({ salesorder_id: 'S2', payment_id: null });
  });

  test('timeout sets possibleOrphan', async function () {
    var e = new Error('timeout'); e.code = 'ECONNABORTED';
    zoho.zohoPostOnce.mockRejectedValueOnce(e);
    var caught;
    try { await dep.createDepositSet(args(1)); } catch (x) { caught = x; }
    expect(caught.possibleOrphan).toBe(true);
    expect(caught.created).toEqual([]);
  });
});

describe('cleanupDepositSet', function () {
  var created = [
    { salesorder_id: 'S1', payment_id: 'P1' },
    { salesorder_id: 'S2', payment_id: 'P2' }
  ];
  test('deletes payment then SO for each record, reverse order', async function () {
    zoho.zohoDelete.mockResolvedValue({});
    var r = await dep.cleanupDepositSet(created, 'T9');
    expect(r).toEqual({ ok: true, leftovers: [] });
    expect(zoho.zohoDelete.mock.calls.map(function (c) { return c[0]; })).toEqual([
      '/customerpayments/P2', '/salesorders/S2', '/customerpayments/P1', '/salesorders/S1'
    ]);
  });
  test('a failing payment delete is reported and the rest still attempted', async function () {
    zoho.zohoDelete.mockImplementation(function (p) {
      return p === '/customerpayments/P2' ? Promise.reject(new Error('no')) : Promise.resolve({});
    });
    var r = await dep.cleanupDepositSet(created, 'T9');
    expect(r.ok).toBe(false);
    expect(r.leftovers).toHaveLength(1);
    expect(r.leftovers[0]).toMatchObject({ kind: 'payment', id: 'P2' });
    expect(zoho.zohoDelete).toHaveBeenCalledTimes(4);
  });
  test('SO delete failure falls back to void, then reports', async function () {
    zoho.zohoDelete.mockImplementation(function (p) {
      return p.indexOf('/salesorders/') === 0 ? Promise.reject(new Error('x')) : Promise.resolve({});
    });
    zoho.zohoPost.mockRejectedValue(new Error('void failed'));
    var r = await dep.cleanupDepositSet([created[0]], 'T9');
    expect(zoho.zohoPost).toHaveBeenCalledWith('/salesorders/S1/status/void', {});
    expect(r.leftovers[0]).toMatchObject({ kind: 'salesorder', id: 'S1' });
  });
  test('never rejects on empty input', async function () {
    expect(await dep.cleanupDepositSet(undefined)).toEqual({ ok: true, leftovers: [] });
  });
});
