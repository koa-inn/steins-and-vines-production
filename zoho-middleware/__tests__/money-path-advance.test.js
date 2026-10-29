'use strict';

// Phase 100 D-02: finalizeSalesOrderInvoiceAndApplyPayment optional advance step.

jest.mock('../lib/logger', function () {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
});
jest.mock('../lib/eventLog', function () { return { logEvent: jest.fn() }; });
jest.mock('../lib/sentry-capture', function () {
  return { captureExceptionSafe: jest.fn() };
});
jest.mock('../lib/zoho-api', function () {
  return { zohoGet: jest.fn(), zohoPost: jest.fn() };
});

var zoho = require('../lib/zoho-api');
var moneyPath = require('../lib/money-path');

var BASE_PAYMENT = {
  customer_id: 'C1',
  amount: 230,
  payment_mode: 'creditcard',
  reference_number: 'T1',
  notes: 'n',
  date: '2026-10-29'
};

function wire(opts) {
  opts = opts || {};
  var invoiceBalance = opts.invoiceBalance;
  zoho.zohoGet.mockImplementation(function (path) {
    if (path === '/salesorders/SO1') {
      return Promise.resolve({ salesorder: { invoices: [{ invoice_id: 'INV1', status: 'draft' }] } });
    }
    if (path === '/customerpayments/P1') {
      return Promise.resolve({ payment: { unused_amount: opts.unused } });
    }
    if (path === '/invoices/INV1') {
      return Promise.resolve({ invoice: { balance_due: invoiceBalance } });
    }
    return Promise.reject(new Error('unexpected GET ' + path));
  });
  zoho.zohoPost.mockImplementation(function (path) {
    if (path === '/invoices/INV1/credits' && opts.creditsFail) {
      return Promise.reject(new Error('credits rejected'));
    }
    return Promise.resolve({ ok: true, path: path });
  });
}

describe('finalizeSalesOrderInvoiceAndApplyPayment advance', function () {
  beforeEach(function () {
    zoho.zohoGet.mockReset();
    zoho.zohoPost.mockReset();
  });

  test('no advance: exact legacy call sequence', async function () {
    wire({ invoiceBalance: 230 });
    var res = await moneyPath.finalizeSalesOrderInvoiceAndApplyPayment('SO1', BASE_PAYMENT);
    expect(zoho.zohoGet.mock.calls).toEqual([['/salesorders/SO1'], ['/invoices/INV1']]);
    expect(zoho.zohoPost.mock.calls).toEqual([
      ['/invoices/INV1/status/sent', {}],
      ['/customerpayments', {
        customer_id: 'C1', payment_mode: 'creditcard', amount: 230, date: '2026-10-29',
        reference_number: 'T1', notes: 'n',
        invoices: [{ invoice_id: 'INV1', amount_applied: 230 }]
      }]
    ]);
    expect(res.advanceApplied).toBe(0);
    expect(res.appliedAmount).toBe(230);
  });

  test('advance: credits applied before invoice read and payment', async function () {
    wire({ unused: 50, invoiceBalance: 230 });
    var res = await moneyPath.finalizeSalesOrderInvoiceAndApplyPayment('SO1',
      Object.assign({}, BASE_PAYMENT, { advance: { payment_id: 'P1', amount: 50 } }));
    var creditCall = zoho.zohoPost.mock.calls.find(function (c) { return /credits$/.test(c[0]); });
    expect(creditCall[1]).toEqual({ invoice_payments: [{ payment_id: 'P1', amount_applied: 50 }] });
    var creditIdx = zoho.zohoPost.mock.calls.indexOf(creditCall);
    var creditOrder = zoho.zohoPost.mock.invocationCallOrder[creditIdx];
    var invGetIdx = zoho.zohoGet.mock.calls.findIndex(function (c) { return c[0] === '/invoices/INV1'; });
    var invGetOrder = zoho.zohoGet.mock.invocationCallOrder[invGetIdx];
    var payIdx = zoho.zohoPost.mock.calls.findIndex(function (c) { return c[0] === '/customerpayments'; });
    var payOrder = zoho.zohoPost.mock.invocationCallOrder[payIdx];
    expect(creditOrder).toBeLessThan(invGetOrder);
    expect(invGetOrder).toBeLessThan(payOrder);
    expect(zoho.zohoPost.mock.calls[payIdx][1].invoices[0].amount_applied).toBe(230);
    expect(res.advanceApplied).toBe(50);
  });

  test('unused already 0: no credits call, remainder still applied', async function () {
    wire({ unused: 0, invoiceBalance: 230 });
    var res = await moneyPath.finalizeSalesOrderInvoiceAndApplyPayment('SO1',
      Object.assign({}, BASE_PAYMENT, { advance: { payment_id: 'P1', amount: 50 } }));
    var credits = zoho.zohoPost.mock.calls.filter(function (c) { return /credits$/.test(c[0]); });
    expect(credits).toHaveLength(0);
    expect(res.advanceApplied).toBe(0);
    expect(res.appliedAmount).toBe(230);
  });

  test('credits rejection rejects the whole call', async function () {
    wire({ unused: 50, invoiceBalance: 280, creditsFail: true });
    await expect(moneyPath.finalizeSalesOrderInvoiceAndApplyPayment('SO1',
      Object.assign({}, BASE_PAYMENT, { advance: { payment_id: 'P1', amount: 50 } })))
      .rejects.toThrow('credits rejected');
    var pays = zoho.zohoPost.mock.calls.filter(function (c) { return c[0] === '/customerpayments'; });
    expect(pays).toHaveLength(0);
  });
});
