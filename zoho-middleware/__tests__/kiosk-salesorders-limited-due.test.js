'use strict';

// Phase 100 staging-run fix: the kiosk SO card showed the full SO total
// ("Collect $252.85") for limited-release SOs, while the terminal charges the
// total minus the $50 deposit. Collect pushes straight to the terminal, so the
// card is the only amount staff see before charging. The list route must carry
// the deposit-aware remainder for actionable LIMITED SOs.

jest.mock('../lib/helcim', function () { return {
  isTerminalEnabled: jest.fn().mockReturnValue(true),
  terminalPurchase: jest.fn().mockResolvedValue({ ok: true }),
  pollTerminalResult: jest.fn(),
  generateIdempotencyKey: jest.fn().mockReturnValue('k'),
  voidTransaction: jest.fn().mockResolvedValue({ ok: true })
}; });
jest.mock('../lib/zoho-api', function () { return { zohoGet: jest.fn(), zohoPost: jest.fn(), zohoPut: jest.fn() }; });
jest.mock('../lib/cache', function () { return {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
  isConnected: jest.fn().mockReturnValue(true)
}; });
jest.mock('../lib/eventLog', function () { return { logEvent: jest.fn() }; });
jest.mock('../lib/logger', function () { return { info: jest.fn(), warn: jest.fn(), error: jest.fn() }; });
jest.mock('../lib/mailer', function () { return { sendVoidFailureAlert: jest.fn().mockResolvedValue() }; });
jest.mock('../lib/inventory-ledger', function () { return { decrementStock: jest.fn().mockResolvedValue() }; });
jest.mock('../lib/limited-releases-deposit', function () {
  var actual = jest.requireActual('../lib/limited-releases-deposit');
  return Object.assign({}, actual, { findDepositAdvanceForSalesOrder: jest.fn() });
});

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

var zohoApi = require('../lib/zoho-api');
var cache = require('../lib/cache');
var deposit = require('../lib/limited-releases-deposit');
require('../routes/pos');

var handler = _routes.get.filter(function (r) { return r.path === '/api/kiosk/salesorders'; })[0].handler;

function makeReq() { return { body: {}, query: {}, headers: { 'x-api-key': 'test-api-key' } }; }
function makeRes() {
  var res = { _status: 200, _json: null };
  res.status = jest.fn(function (c) { res._status = c; return res; });
  res.json = jest.fn(function (d) { res._json = d; return res; });
  return res;
}
function flush() { return new Promise(function (r) { setTimeout(r, 0); }); }

var LIMITED = { salesorder_id: 'L1', salesorder_number: 'SO-000086', customer_id: 'C1', customer_name: 'Pat',
  total: 252.85, balance: 252.85, status: 'draft', date: '2026-10-29', reference_number: 'LIMITED-2026-27', line_items: [] };
var PLAIN = { salesorder_id: 'P1', salesorder_number: 'SO-000010', customer_id: 'C2', customer_name: 'Sam',
  total: 40, balance: 40, status: 'open', date: '2026-10-28', reference_number: '', line_items: [] };

function stubList(rows) {
  zohoApi.zohoGet.mockImplementation(function (path, params) {
    if (path === '/salesorders') {
      return Promise.resolve({ salesorders: rows.filter(function (r) { return r.status === params.status; }) });
    }
    return Promise.reject(new Error('unexpected ' + path));
  });
}

function run() {
  var res = makeRes();
  handler(makeReq(), res);
  return flush().then(flush).then(flush).then(function () { return res; });
}

var OLD_KEY;
beforeEach(function () {
  jest.clearAllMocks();
  cache.get.mockResolvedValue(null);
  OLD_KEY = process.env.MW_API_KEY;
  process.env.MW_API_KEY = 'test-api-key';
});
afterEach(function () { process.env.MW_API_KEY = OLD_KEY; });

describe('GET /api/kiosk/salesorders — limited-release remainder', function () {
  test('actionable LIMITED SO carries deposit_held and amount_due = total - unused advance', function () {
    stubList([LIMITED, PLAIN]);
    deposit.findDepositAdvanceForSalesOrder.mockResolvedValue({ payment_id: 'pay1', amount: 50, unused_amount: 50 });
    return run().then(function (res) {
      expect(res._status).toBe(200);
      var l = res._json.salesorders.filter(function (s) { return s.salesorder_id === 'L1'; })[0];
      expect(l.is_limited_release).toBe(true);
      expect(l.deposit_held).toBe(50);
      expect(l.amount_due).toBe(202.85);
    });
  });

  test('non-limited SO gets no deposit fields and triggers no deposit lookup', function () {
    stubList([PLAIN]);
    return run().then(function (res) {
      expect(res._status).toBe(200);
      var p = res._json.salesorders[0];
      expect(p.deposit_held).toBeUndefined();
      expect(p.amount_due).toBeUndefined();
      expect(deposit.findDepositAdvanceForSalesOrder).not.toHaveBeenCalled();
    });
  });

  test('LIMITED SO with no advance found shows deposit_held 0 and the full total due', function () {
    stubList([LIMITED]);
    deposit.findDepositAdvanceForSalesOrder.mockResolvedValue(null);
    return run().then(function (res) {
      expect(res._status).toBe(200);
      var l = res._json.salesorders[0];
      expect(l.deposit_held).toBe(0);
      expect(l.amount_due).toBe(252.85);
    });
  });

  test('a failing deposit lookup does not fail the list; the SO has no amount_due', function () {
    stubList([LIMITED, PLAIN]);
    deposit.findDepositAdvanceForSalesOrder.mockRejectedValue(new Error('zoho down'));
    return run().then(function (res) {
      expect(res._status).toBe(200);
      expect(res._json.salesorders.length).toBe(2);
      var l = res._json.salesorders.filter(function (s) { return s.salesorder_id === 'L1'; })[0];
      expect(l.amount_due).toBeUndefined();
    });
  });
});
