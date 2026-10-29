'use strict';

// Phase 100 D-02: kiosk salesorder-pay charges the remainder for LIMITED-* SOs
// and applies the deposit advance to the invoice.

jest.mock('../lib/helcim', function () { return {
  isTerminalEnabled: jest.fn().mockReturnValue(true),
  terminalPurchase: jest.fn().mockResolvedValue({ ok: true }),
  pollTerminalResult: jest.fn().mockResolvedValue({
    status: 'APPROVED', transactionId: 'txn-999', approved: true, cardType: 'VISA'
  }),
  voidTransaction: jest.fn().mockResolvedValue({ ok: true })
}; });
jest.mock('../lib/zoho-api', function () { return {
  zohoGet: jest.fn(),
  zohoPost: jest.fn(),
  zohoPut: jest.fn()
}; });
jest.mock('../lib/cache', function () { return {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
  acquireLock: jest.fn().mockResolvedValue(true),
  releaseLock: jest.fn().mockResolvedValue(1),
  isConnected: jest.fn().mockReturnValue(true)
}; });
jest.mock('../lib/eventLog', function () { return { logEvent: jest.fn() }; });
jest.mock('../lib/logger', function () { return { info: jest.fn(), warn: jest.fn(), error: jest.fn() }; });
jest.mock('../lib/mailer', function () { return {
  sendVoidFailureAlert: jest.fn().mockResolvedValue()
}; });
jest.mock('../lib/inventory-ledger', function () { return {
  decrementStock: jest.fn().mockResolvedValue()
}; });
jest.mock('../lib/brewpad-integration', function () {
  var actual = jest.requireActual('../lib/brewpad-integration');
  return Object.assign({}, actual, { createBatchesFromSale: jest.fn() });
});
jest.mock('../lib/limited-releases-deposit', function () {
  var actual = jest.requireActual('../lib/limited-releases-deposit');
  return Object.assign({}, actual, { findDepositAdvanceForSalesOrder: jest.fn() });
});

var helcimLib = require('../lib/helcim');
var zohoApi = require('../lib/zoho-api');
var eventLog = require('../lib/eventLog');
var brewpad = require('../lib/brewpad-integration');
var deposit = require('../lib/limited-releases-deposit');

var _routes = { get: [], post: [], put: [] };
jest.mock('express', function () {
  var router = {
    get: jest.fn(function (p, h) { _routes.get.push({ path: p, handler: h }); }),
    post: jest.fn(function (p, h) { _routes.post.push({ path: p, handler: h }); }),
    put: jest.fn(function (p, h) { _routes.put.push({ path: p, handler: h }); })
  };
  var express = function () {};
  express.Router = function () { return router; };
  return express;
});

var pos = require('../routes/pos');

var payHandler = _routes.post.filter(function (e) { return e.path === '/api/kiosk/salesorder-pay'; })[0].handler;

function makeRes() {
  var res = { _status: 200, _json: null, headersSent: false };
  res.status = jest.fn(function (c) { res._status = c; return res; });
  res.json = jest.fn(function (d) { res._json = d; res.headersSent = true; return res; });
  return res;
}
function flush(n) {
  var p = Promise.resolve();
  for (var i = 0; i < (n || 12); i++) {
    p = p.then(function () { return new Promise(function (r) { setImmediate(r); }); });
  }
  return p;
}

function wireZoho(so, invoiceBalance, unusedOnPayment) {
  zohoApi.zohoGet.mockImplementation(function (path) {
    if (path === '/salesorders/SO1') return Promise.resolve({ salesorder: so });
    if (path === '/invoices/INV1') {
      return Promise.resolve({ invoice: { invoice_id: 'INV1', balance_due: invoiceBalance } });
    }
    if (path === '/customerpayments/P1') {
      return Promise.resolve({ payment: { unused_amount: unusedOnPayment } });
    }
    return Promise.resolve({});
  });
  zohoApi.zohoPost.mockImplementation(function (endpoint) {
    if (endpoint.indexOf('/invoices/fromsalesorder') === 0) return Promise.resolve({ invoice: { invoice_id: 'INV1' } });
    if (/\/status\/sent$/.test(endpoint)) return Promise.resolve({});
    if (endpoint === '/customerpayments') return Promise.resolve({ payment: { payment_id: 'PAY-X' } });
    return Promise.resolve({});
  });
}

function limitedSo(extra) {
  return Object.assign({
    salesorder_id: 'SO1', salesorder_number: 'SO-00200', reference_number: 'LIMITED-2026-27',
    total: 280, balance: 280, status: 'confirmed', customer_id: 'C1', invoices: [], line_items: []
  }, extra || {});
}

async function pay() {
  var res = makeRes();
  payHandler({ body: { salesorder_id: 'SO1' }, headers: {}, query: {} }, res);
  await flush();
  return res;
}

describe('salesorder-pay advance awareness', function () {
  beforeEach(function () {
    jest.clearAllMocks();
    helcimLib.isTerminalEnabled.mockReturnValue(true);
    helcimLib.terminalPurchase.mockResolvedValue({ ok: true });
    helcimLib.pollTerminalResult.mockResolvedValue({
      status: 'APPROVED', transactionId: 'txn-999', approved: true, cardType: 'VISA'
    });
  });

  test('LIMITED SO, no invoice, advance 50 -> charge 230 and apply advance', async function () {
    wireZoho(limitedSo(), 280, 50);
    deposit.findDepositAdvanceForSalesOrder.mockResolvedValue({ payment_id: 'P1', unused_amount: 50, amount: 50 });
    var res = await pay();
    expect(helcimLib.terminalPurchase.mock.calls[0][0]).toBe(230);
    expect(res._json.ok).toBe(true);
    expect(res._json.amount).toBe(230);
    expect(res._json.deposit_applied).toBe(50);
    var credits = zohoApi.zohoPost.mock.calls.filter(function (c) { return /\/credits$/.test(c[0]); });
    expect(credits).toHaveLength(1);
    expect(credits[0][1]).toEqual({ invoice_payments: [{ payment_id: 'P1', amount_applied: 50 }] });
    expect(eventLog.logEvent).toHaveBeenCalledWith('kiosk.salesorder_payment',
      expect.objectContaining({ amount: 230, depositApplied: 50 }));
    expect(brewpad.createBatchesFromSale).toHaveBeenCalledTimes(1);
  });

  test('retry A: open invoice balance 280, advance unused 50 -> charge 230', async function () {
    wireZoho(limitedSo({ invoices: [{ invoice_id: 'INV1', status: 'sent' }] }), 280, 50);
    deposit.findDepositAdvanceForSalesOrder.mockResolvedValue({ payment_id: 'P1', unused_amount: 50, amount: 50 });
    var res = await pay();
    expect(helcimLib.terminalPurchase.mock.calls[0][0]).toBe(230);
    expect(res._json.amount).toBe(230);
  });

  test('retry B: invoice balance 230, advance already consumed -> charge 230, no credits call', async function () {
    wireZoho(limitedSo({ invoices: [{ invoice_id: 'INV1', status: 'sent' }] }), 230, 0);
    deposit.findDepositAdvanceForSalesOrder.mockResolvedValue(null);
    var res = await pay();
    expect(helcimLib.terminalPurchase.mock.calls[0][0]).toBe(230);
    expect(res._json.deposit_applied).toBe(0);
    var credits = zohoApi.zohoPost.mock.calls.filter(function (c) { return /\/credits$/.test(c[0]); });
    expect(credits).toHaveLength(0);
    expect(eventLog.logEvent).toHaveBeenCalledWith('kiosk.limited_so_no_advance', { soId: 'SO1' });
  });

  test('LIMITED SO without a deposit charges the full base', async function () {
    wireZoho(limitedSo(), 280, 0);
    deposit.findDepositAdvanceForSalesOrder.mockResolvedValue(null);
    var res = await pay();
    expect(helcimLib.terminalPurchase.mock.calls[0][0]).toBe(280);
    expect(res._json.deposit_applied).toBe(0);
  });

  test('deposit lookup failure -> 502, terminal never called', async function () {
    wireZoho(limitedSo(), 280, 50);
    deposit.findDepositAdvanceForSalesOrder.mockRejectedValue(new Error('zoho down'));
    var res = await pay();
    expect(res._status).toBe(502);
    expect(res._json.error).toBe('Could not read the deposit for this order. Try again.');
    expect(helcimLib.terminalPurchase).not.toHaveBeenCalled();
  });

  test('deposit covers whole order -> 400, terminal never called', async function () {
    wireZoho(limitedSo({ total: 50 }), 50, 50);
    deposit.findDepositAdvanceForSalesOrder.mockResolvedValue({ payment_id: 'P1', unused_amount: 50, amount: 50 });
    var res = await pay();
    expect(res._status).toBe(400);
    expect(res._json.error).toMatch(/Deposit covers this order/);
    expect(helcimLib.terminalPurchase).not.toHaveBeenCalled();
  });

  test('LIMITED SO with zero base -> 400 no balance', async function () {
    wireZoho(limitedSo({ invoices: [{ invoice_id: 'INV1', status: 'paid' }] }), 0, 0);
    deposit.findDepositAdvanceForSalesOrder.mockResolvedValue(null);
    var res = await pay();
    expect(res._status).toBe(400);
    expect(res._json.error).toBe('No balance due on this order');
  });

  test('non-LIMITED SO: legacy amount, no deposit lookup', async function () {
    var so = limitedSo({ reference_number: '', balance: 150, total: 150 });
    wireZoho(so, 150, 0);
    var res = await pay();
    expect(deposit.findDepositAdvanceForSalesOrder).not.toHaveBeenCalled();
    expect(helcimLib.terminalPurchase.mock.calls[0][0]).toBe(150);
    expect(res._json.deposit_applied).toBeUndefined();
    var credits = zohoApi.zohoPost.mock.calls.filter(function (c) { return /\/credits$/.test(c[0]); });
    expect(credits).toHaveLength(0);
  });

  test('computeSalesOrderAmountDue: non-LIMITED makes no Zoho calls', async function () {
    zohoApi.zohoGet.mockClear();
    var r = await pos.computeSalesOrderAmountDue({ reference_number: 'X', balance: '12.50' });
    expect(r).toEqual({ isLimited: false, base: 12.5, depositApplied: 0, due: 12.5, advance: null });
    expect(zohoApi.zohoGet).not.toHaveBeenCalled();
  });
});
