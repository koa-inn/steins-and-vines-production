'use strict';

// ---------------------------------------------------------------------------
// collect-webhook-reconcile.test.js — Phase 71-01
//
// Pins the correct end-state for the kiosk "collect payment on an existing
// sales order" money-path: a charged (APPROVED) collect webhook must convert
// or reuse the SO's invoice, finalize it (mark sent/open), and apply the
// customerpayment to that invoice via `invoices: [{ invoice_id, amount_applied }]`
// — never `salesorders_to_apply` (root cause, webhooks.js:206 pre-fix).
//
// Harness: combines the router-mock handler-extraction style of
// __tests__/collect.test.js with the flushPromises-after-200 pattern of
// __tests__/helcim-webhook.test.js (processCardTransactionResult runs
// fire-and-forget AFTER the webhook's 200 response).
//
// lib/money-path and lib/reconcile are NOT mocked — this exercises the real
// ensureOpenInvoiceForSalesOrder / recordCollectReconcileFailure
// implementations (Task 2) against a mocked zoho-api + cache + mailer, so the
// full integration (not just the webhooks.js call shape) is pinned.
// ---------------------------------------------------------------------------

jest.mock('../lib/helcim', function () {
  return {
    verifyWebhookSignature: jest.fn().mockReturnValue(true),
    getCardTransactionById: jest.fn(),
    getPendingInvoiceForDevice: jest.fn().mockResolvedValue(null),
    getDeviceCode: jest.fn().mockReturnValue('')
  };
});

jest.mock('../lib/calcom', function () {
  return { verifyWebhook: jest.fn().mockReturnValue(true) };
});

jest.mock('../lib/zoho-api', function () {
  return {
    zohoGet: jest.fn(),
    zohoPost: jest.fn(),
    zohoPut: jest.fn()
  };
});

jest.mock('../lib/cache', function () {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    isConnected: jest.fn().mockReturnValue(true),
    acquireLock: jest.fn().mockResolvedValue(true),
    releaseLock: jest.fn().mockResolvedValue()
  };
});

jest.mock('../lib/eventLog', function () { return { logEvent: jest.fn() }; });
jest.mock('../lib/logger', function () { return { info: jest.fn(), warn: jest.fn(), error: jest.fn() }; });
jest.mock('../lib/mailer', function () { return { sendVoidFailureAlert: jest.fn().mockResolvedValue({}) }; });
jest.mock('../lib/sentry-capture', function () { return { captureExceptionSafe: jest.fn() }; });

// NOTE: lib/reconcile and lib/money-path are intentionally left UNMOCKED —
// see file header.

jest.mock('express', function () {
  var router = { get: jest.fn(), post: jest.fn() };
  var express = function () {};
  express.Router = function () { return router; };
  return express;
});

var express = require('express');
require('../routes/webhooks');
// router.post(['/api/webhooks/terminal', '/webhooks/terminal'], handler) is the
// FIRST router.post call webhooks.js makes (calcom route is registered second).
var handler = express.Router().post.mock.calls[0][1];

var helcimLib = require('../lib/helcim');
var zohoApi = require('../lib/zoho-api');
var cache = require('../lib/cache');
var mailer = require('../lib/mailer');
var reconcile = require('../lib/reconcile');
var captureExceptionSafe = require('../lib/sentry-capture').captureExceptionSafe;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function flushPromises() {
  return new Promise(function (resolve) { setImmediate(resolve); });
}

// Chain several flushes — the real (unmocked) ensureOpenInvoiceForSalesOrder
// adds extra promise hops (zohoGet -> zohoPost fromsalesorder -> zohoPost
// submit -> zohoPost customerpayments) beyond what collect.test.js/
// helcim-webhook.test.js needed a single flush for.
function flushAll() {
  return flushPromises().then(flushPromises).then(flushPromises).then(flushPromises).then(flushPromises);
}

function makeReq(body) {
  return {
    headers: {
      'webhook-id': 'wh-1',
      'webhook-timestamp': '1750000000',
      'webhook-signature': 'v1,sig'
    },
    rawBody: Buffer.from(JSON.stringify(body || {})),
    body: body || {}
  };
}

function makeRes() {
  var res = { _status: null, _json: null };
  res.status = jest.fn(function (code) { res._status = code; return res; });
  res.json = jest.fn(function (data) { res._json = data; return res; });
  return res;
}

var SO_ID = 'SO123';
var SO_NUMBER = 'SO-001';
var AMOUNT = 45.50;
var TXN_ID = 'txn-1';
var COLLECT_PENDING_KEY = 'collect:pending:' + SO_NUMBER;

function pendingCtx() {
  return {
    salesorder_id: SO_ID,
    salesorder_number: SO_NUMBER,
    customer_id: 'CUST1',
    amount: AMOUNT,
    idempotency_key: 'idem-abc',
    created_at: new Date().toISOString()
  };
}

// Dispatches mocked zohoPost responses by endpoint, mirroring the shape used
// by webhook-wr07.test.js / pos-money-defects.test.js for multi-endpoint mocks.
function mockZohoPostRouting(overrides) {
  var routes = Object.assign({
    fromsalesorder: { invoice: { invoice_id: 'INV999' } },
    submit: {},
    customerpayments: {
      payment: {
        payment_id: 'PAY1',
        unused_amount: 0,
        applied_invoices: [{ invoice_id: 'INV999', invoice_number: 'INV-000200' }]
      }
    }
  }, overrides || {});

  zohoApi.zohoPost.mockImplementation(function (endpoint) {
    if (endpoint.indexOf('/invoices/fromsalesorder') === 0) {
      return routes.fromsalesorder instanceof Error
        ? Promise.reject(routes.fromsalesorder)
        : Promise.resolve(routes.fromsalesorder);
    }
    if (/^\/invoices\/.+\/submit$/.test(endpoint)) {
      return routes.submit instanceof Error
        ? Promise.reject(routes.submit)
        : Promise.resolve(routes.submit);
    }
    if (endpoint === '/customerpayments') {
      return routes.customerpayments instanceof Error
        ? Promise.reject(routes.customerpayments)
        : Promise.resolve(routes.customerpayments);
    }
    return Promise.resolve({});
  });
}

describe('collect webhook reconcile — APPROVED path (Phase 71-01)', function () {
  beforeEach(function () {
    jest.clearAllMocks();
    helcimLib.verifyWebhookSignature.mockReturnValue(true);
    helcimLib.getPendingInvoiceForDevice.mockResolvedValue(null);
    helcimLib.getDeviceCode.mockReturnValue('');

    cache.get.mockImplementation(function (key) {
      if (key === COLLECT_PENDING_KEY) {
        return Promise.resolve(JSON.stringify(pendingCtx()));
      }
      return Promise.resolve(null);
    });
    cache.set.mockResolvedValue('OK');
    cache.del.mockResolvedValue(1);
    cache.acquireLock.mockResolvedValue(true);
    cache.releaseLock.mockResolvedValue();

    mailer.sendVoidFailureAlert.mockResolvedValue({});
  });

  // -------------------------------------------------------------------------
  // 1. Happy path — no existing invoice on the SO
  // -------------------------------------------------------------------------
  test('APPROVED + no existing invoice -> converts SO to invoice, submits it, applies payment via invoices[]', function () {
    helcimLib.getCardTransactionById.mockResolvedValue({
      status: 'APPROVED', invoiceNumber: SO_NUMBER, cardType: 'Visa'
    });
    zohoApi.zohoGet.mockResolvedValue({ salesorder: { invoices: [] } });
    mockZohoPostRouting();

    var req = makeReq({ type: 'cardTransaction', id: TXN_ID });
    var res = makeRes();
    handler(req, res);

    return flushAll().then(function () {
      // Finalize: convert SO -> invoice, then mark it sent/open
      expect(zohoApi.zohoGet).toHaveBeenCalledWith('/salesorders/' + SO_ID);
      expect(zohoApi.zohoPost).toHaveBeenCalledWith(
        '/invoices/fromsalesorder?salesorder_id=' + SO_ID, {}
      );
      expect(zohoApi.zohoPost).toHaveBeenCalledWith('/invoices/INV999/submit', {});

      // Apply: verified-correct payment shape — invoices array, no salesorders_to_apply
      var paymentCall = zohoApi.zohoPost.mock.calls.find(function (c) { return c[0] === '/customerpayments'; });
      expect(paymentCall).toBeTruthy();
      var body = paymentCall[1];
      expect(body.invoices).toEqual([{ invoice_id: 'INV999', amount_applied: AMOUNT }]);
      expect(body.salesorders_to_apply).toBeUndefined();

      // Mocked Zoho response represents the correct paid/applied end-state —
      // the payment shape used here (invoices[]) is the one that produces it.
      var mockedResponse = zohoApi.zohoPost.mock.results
        .map(function (r) { return r.value; })[zohoApi.zohoPost.mock.calls.indexOf(paymentCall)];
      return mockedResponse.then(function (resolved) {
        expect(resolved.payment.unused_amount).toBe(0);
        expect(resolved.payment.applied_invoices.length).toBeGreaterThan(0);
      });
    }).then(function () {
      // Double-apply guard: pending key deleted only AFTER a successful apply
      expect(cache.del).toHaveBeenCalledWith(COLLECT_PENDING_KEY);

      var eventLog = require('../lib/eventLog');
      expect(eventLog.logEvent).toHaveBeenCalledWith('collect.payment_recorded', expect.objectContaining({
        soId: SO_ID,
        soNumber: SO_NUMBER,
        txnId: TXN_ID,
        amount: AMOUNT,
        invoiceId: 'INV999'
      }));
    });
  });

  // -------------------------------------------------------------------------
  // 2. Existing-draft reuse — no duplicate invoice created
  // -------------------------------------------------------------------------
  test('APPROVED + SO already has a linked draft invoice -> reuses it, does not create a duplicate', function () {
    helcimLib.getCardTransactionById.mockResolvedValue({
      status: 'APPROVED', invoiceNumber: SO_NUMBER, cardType: 'Visa'
    });
    zohoApi.zohoGet.mockResolvedValue({
      salesorder: { invoices: [{ invoice_id: 'INV777', invoice_number: 'INV-000169', status: 'draft' }] }
    });
    mockZohoPostRouting();

    var req = makeReq({ type: 'cardTransaction', id: TXN_ID });
    var res = makeRes();
    handler(req, res);

    return flushAll().then(function () {
      var fromSoCalls = zohoApi.zohoPost.mock.calls.filter(function (c) {
        return c[0].indexOf('/invoices/fromsalesorder') === 0;
      });
      expect(fromSoCalls.length).toBe(0); // no duplicate invoice created

      expect(zohoApi.zohoPost).toHaveBeenCalledWith('/invoices/INV777/submit', {});

      var paymentCall = zohoApi.zohoPost.mock.calls.find(function (c) { return c[0] === '/customerpayments'; });
      expect(paymentCall).toBeTruthy();
      expect(paymentCall[1].invoices).toEqual([{ invoice_id: 'INV777', amount_applied: AMOUNT }]);

      expect(cache.del).toHaveBeenCalledWith(COLLECT_PENDING_KEY);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Post-charge failure — fail-closed, no silent draft/unapplied advance
  // -------------------------------------------------------------------------
  test('APPROVED + payment-apply fails after charge -> reconcile-failure record + alert, pending key retained', function () {
    jest.spyOn(reconcile, 'recordCollectReconcileFailure');

    helcimLib.getCardTransactionById.mockResolvedValue({
      status: 'APPROVED', invoiceNumber: SO_NUMBER, cardType: 'Visa'
    });
    zohoApi.zohoGet.mockResolvedValue({ salesorder: { invoices: [] } });
    var applyErr = new Error('Zoho payment apply failed');
    mockZohoPostRouting({ customerpayments: applyErr });

    var req = makeReq({ type: 'cardTransaction', id: TXN_ID });
    var res = makeRes();
    handler(req, res);

    return flushAll().then(function () {
      // Fail-closed sentinel written + staff alert fired
      expect(reconcile.recordCollectReconcileFailure).toHaveBeenCalledWith(
        expect.objectContaining({ salesorder_id: SO_ID, salesorder_number: SO_NUMBER, amount: AMOUNT }),
        TXN_ID,
        expect.objectContaining({ message: expect.stringContaining('Zoho payment apply failed') })
      );

      var reconcileFailureCall = cache.set.mock.calls.find(function (c) {
        return typeof c[0] === 'string' && c[0].indexOf('collect:reconcile-failure:') === 0;
      });
      expect(reconcileFailureCall).toBeTruthy();
      expect(reconcileFailureCall[1]).toEqual(expect.objectContaining({
        txn_id: TXN_ID,
        needs_manual_review: true
      }));

      expect(mailer.sendVoidFailureAlert).toHaveBeenCalled();
      expect(captureExceptionSafe).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('Zoho payment apply failed') }),
        expect.objectContaining({ tags: expect.objectContaining({ soId: SO_ID, txnId: TXN_ID }) })
      );

      // No silent success — the pending key must NOT be deleted so the charge
      // stays recoverable.
      expect(cache.del).not.toHaveBeenCalledWith(COLLECT_PENDING_KEY);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Regression — no collect code path ever books salesorders_to_apply
  // -------------------------------------------------------------------------
  test('regression: no zohoPost call in the collect APPROVED flow ever carries salesorders_to_apply', function () {
    helcimLib.getCardTransactionById.mockResolvedValue({
      status: 'APPROVED', invoiceNumber: SO_NUMBER, cardType: 'Debit'
    });
    zohoApi.zohoGet.mockResolvedValue({ salesorder: { invoices: [] } });
    mockZohoPostRouting();

    var req = makeReq({ type: 'cardTransaction', id: TXN_ID });
    var res = makeRes();
    handler(req, res);

    return flushAll().then(function () {
      expect(zohoApi.zohoPost.mock.calls.length).toBeGreaterThan(0);
      zohoApi.zohoPost.mock.calls.forEach(function (call) {
        var body = call[1];
        if (body && typeof body === 'object') {
          expect(body.salesorders_to_apply).toBeUndefined();
        }
      });
    });
  });
});

// ---------------------------------------------------------------------------
// Phase 71 code-review fixes: BL-01 (idempotency lock), WR-01 (best-effort
// cleanup), WR-03 (apply against invoice balance_due).
//
// Routes zohoGet by endpoint so the WR-03 balance read
// (GET /invoices/{id}.invoice.balance_due) can be exercised alongside the
// existing GET /salesorders/{id} dedup read.
// ---------------------------------------------------------------------------
var COLLECT_LOCK_KEY = 'reconcile:collect:txn:' + TXN_ID;

function mockZohoGetRouting(opts) {
  opts = opts || {};
  var soResponse = opts.salesorder || { salesorder: { invoices: [] } };
  var hasBalance = Object.prototype.hasOwnProperty.call(opts, 'balanceDue');
  zohoApi.zohoGet.mockImplementation(function (endpoint) {
    if (endpoint.indexOf('/salesorders/') === 0) return Promise.resolve(soResponse);
    if (endpoint.indexOf('/invoices/') === 0) {
      return Promise.resolve({
        invoice: hasBalance
          ? { invoice_id: 'INV999', balance_due: opts.balanceDue }
          : { invoice_id: 'INV999' }
      });
    }
    return Promise.resolve({});
  });
}

describe('collect webhook reconcile — code-review fixes (Phase 71)', function () {
  beforeEach(function () {
    jest.clearAllMocks();
    helcimLib.verifyWebhookSignature.mockReturnValue(true);
    helcimLib.getPendingInvoiceForDevice.mockResolvedValue(null);
    helcimLib.getDeviceCode.mockReturnValue('');
    helcimLib.getCardTransactionById.mockResolvedValue({
      status: 'APPROVED', invoiceNumber: SO_NUMBER, cardType: 'Visa'
    });

    cache.get.mockImplementation(function (key) {
      if (key === COLLECT_PENDING_KEY) return Promise.resolve(JSON.stringify(pendingCtx()));
      return Promise.resolve(null);
    });
    cache.set.mockResolvedValue('OK');
    cache.del.mockResolvedValue(1);
    cache.acquireLock.mockResolvedValue(true);
    cache.releaseLock.mockResolvedValue();
    mailer.sendVoidFailureAlert.mockResolvedValue({});
    mockZohoGetRouting();
    mockZohoPostRouting();
  });

  // -------------------------------------------------------------------------
  // BL-01: idempotency lock guards the apply
  // -------------------------------------------------------------------------
  test('BL-01: apply is wrapped in a per-transaction lock, released only on the acquired path', function () {
    var req = makeReq({ type: 'cardTransaction', id: TXN_ID });
    var res = makeRes();
    handler(req, res);

    return flushAll().then(function () {
      expect(cache.acquireLock).toHaveBeenCalledWith(COLLECT_LOCK_KEY, 60);
      // Payment booked, key cleaned up, lock released on the acquired (success) path.
      var paymentCall = zohoApi.zohoPost.mock.calls.find(function (c) { return c[0] === '/customerpayments'; });
      expect(paymentCall).toBeTruthy();
      expect(cache.del).toHaveBeenCalledWith(COLLECT_PENDING_KEY);
      expect(cache.releaseLock).toHaveBeenCalledWith(COLLECT_LOCK_KEY);
    });
  });

  test('BL-01: duplicate delivery (lock held) skips the apply and does NOT release the lock', function () {
    cache.acquireLock.mockResolvedValue(false); // lock already held by the in-flight delivery

    var req = makeReq({ type: 'cardTransaction', id: TXN_ID });
    var res = makeRes();
    handler(req, res);

    return flushAll().then(function () {
      expect(cache.acquireLock).toHaveBeenCalledWith(COLLECT_LOCK_KEY, 60);
      // No money booked, no key deleted, and the holder's lock is left intact.
      var paymentCall = zohoApi.zohoPost.mock.calls.find(function (c) { return c[0] === '/customerpayments'; });
      expect(paymentCall).toBeFalsy();
      expect(cache.del).not.toHaveBeenCalledWith(COLLECT_PENDING_KEY);
      expect(cache.releaseLock).not.toHaveBeenCalled();
    });
  });

  test('BL-01: apply failure after charge still releases the lock and fires the fail-closed alert', function () {
    jest.spyOn(reconcile, 'recordCollectReconcileFailure');
    mockZohoPostRouting({ customerpayments: new Error('Zoho payment apply failed') });

    var req = makeReq({ type: 'cardTransaction', id: TXN_ID });
    var res = makeRes();
    handler(req, res);

    return flushAll().then(function () {
      expect(reconcile.recordCollectReconcileFailure).toHaveBeenCalled();
      expect(cache.releaseLock).toHaveBeenCalledWith(COLLECT_LOCK_KEY);
      expect(cache.del).not.toHaveBeenCalledWith(COLLECT_PENDING_KEY);
    });
  });

  // -------------------------------------------------------------------------
  // WR-01: a cleanup failure after a booked payment must NOT masquerade as a
  // post-charge apply failure.
  // -------------------------------------------------------------------------
  test('WR-01: cache.del failure after a successful apply does NOT fire the fail-closed alert', function () {
    jest.spyOn(reconcile, 'recordCollectReconcileFailure');
    cache.del.mockImplementation(function (key) {
      if (key === COLLECT_PENDING_KEY) return Promise.reject(new Error('redis blip'));
      return Promise.resolve(1);
    });

    var req = makeReq({ type: 'cardTransaction', id: TXN_ID });
    var res = makeRes();
    handler(req, res);

    return flushAll().then(function () {
      // Payment was booked...
      var paymentCall = zohoApi.zohoPost.mock.calls.find(function (c) { return c[0] === '/customerpayments'; });
      expect(paymentCall).toBeTruthy();
      // ...and the swallowed cleanup failure must NOT look like an apply failure.
      expect(reconcile.recordCollectReconcileFailure).not.toHaveBeenCalled();
      expect(mailer.sendVoidFailureAlert).not.toHaveBeenCalled();
      // Lock still released on the (successful) acquired path.
      expect(cache.releaseLock).toHaveBeenCalledWith(COLLECT_LOCK_KEY);
    });
  });

  // -------------------------------------------------------------------------
  // WR-03: apply against the invoice's actual balance_due, not stale ctx.amount.
  // -------------------------------------------------------------------------
  test('WR-03: amount_applied is clamped to invoice balance_due when it is below the charged amount', function () {
    // Invoice balance is lower than the collect-time charged amount (e.g. a
    // prior deposit reduced it): amount_applied must clamp to balance_due so
    // Zoho is never asked to over-apply.
    mockZohoGetRouting({ balanceDue: 40.00 });

    var req = makeReq({ type: 'cardTransaction', id: TXN_ID });
    var res = makeRes();
    handler(req, res);

    return flushAll().then(function () {
      var paymentCall = zohoApi.zohoPost.mock.calls.find(function (c) { return c[0] === '/customerpayments'; });
      expect(paymentCall).toBeTruthy();
      expect(paymentCall[1].amount).toBe(AMOUNT);              // top-level payment = what actually hit the card
      expect(paymentCall[1].invoices).toEqual([{ invoice_id: 'INV999', amount_applied: 40.00 }]);
    });
  });

  test('WR-03: amount_applied equals ctx.amount when balance_due matches within tolerance', function () {
    mockZohoGetRouting({ balanceDue: AMOUNT });

    var req = makeReq({ type: 'cardTransaction', id: TXN_ID });
    var res = makeRes();
    handler(req, res);

    return flushAll().then(function () {
      var paymentCall = zohoApi.zohoPost.mock.calls.find(function (c) { return c[0] === '/customerpayments'; });
      expect(paymentCall[1].invoices).toEqual([{ invoice_id: 'INV999', amount_applied: AMOUNT }]);
    });
  });

  test('WR-03: unreadable balance_due falls back to the charged amount (does not block a real charge)', function () {
    mockZohoGetRouting(); // no balance_due on the invoice response

    var req = makeReq({ type: 'cardTransaction', id: TXN_ID });
    var res = makeRes();
    handler(req, res);

    return flushAll().then(function () {
      var paymentCall = zohoApi.zohoPost.mock.calls.find(function (c) { return c[0] === '/customerpayments'; });
      expect(paymentCall[1].invoices).toEqual([{ invoice_id: 'INV999', amount_applied: AMOUNT }]);
    });
  });
});
