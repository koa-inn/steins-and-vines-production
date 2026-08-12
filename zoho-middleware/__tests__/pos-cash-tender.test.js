'use strict';

/**
 * pos-cash-tender.test.js — Regression tests for Phase 70-01 (KIOSK-CASH)
 *
 * Cash tender: tender:'cash' skips the Helcim terminal entirely and books a
 * Zoho payment_mode:'cash' customerpayment for the server-computed total.
 *
 *   - /api/kiosk/sale: tender:'cash' skips terminalPurchase, responds
 *     {pending:false, cash:true, reference}, works even when the terminal
 *     capability guard would otherwise 503.
 *   - /api/kiosk/sale/confirm: tender:'cash' skips verifyManualCharge (no
 *     pollTerminalResult call), books payment_mode:'cash' with
 *     reference_number = the kiosk ref (never a transaction id), and writes
 *     no KIOSK_PENDING_CHARGE_PREFIX record.
 *   - Idempotency: cash rides the SAME acquireIdempotencyLock gates as every
 *     other tender — a double-tap cannot double-book.
 *   - Gift-card + cash split: gcApplied clamped; cashApplied = grandTotal -
 *     gcApplied; cash payment recorded BEFORE the gift-card 'others' leg.
 *   - Unknown tender value → 400 (allow-list).
 *   - Regression: no tender field still routes through the terminal branch.
 *
 * RED phase: all tests FAIL before the pos.js cash-tender branch exists.
 * GREEN phase: all tests PASS after.
 */

// =============================================================================
// Shared mocks (cloned from pos-money-defects.test.js:26-126)
// =============================================================================

jest.mock('express', function () {
  var router = { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() };
  var express = function () {};
  express.Router = function () { return router; };
  return express;
});

jest.mock('axios', function () {
  return { get: jest.fn(), post: jest.fn() };
});

jest.mock('../lib/helcim', function () {
  return {
    isTerminalEnabled: jest.fn().mockReturnValue(true),
    isEnabled: jest.fn().mockReturnValue(true),
    terminalPurchase: jest.fn().mockResolvedValue({ idempotencyKey: 'idem-cash-1' }),
    pollTerminalResult: jest.fn().mockResolvedValue({
      approved: true, transactionId: 'txn-cash-123', authorizationCode: 'AUTH1', cardType: 'Visa'
    }),
    voidTransaction: jest.fn().mockResolvedValue({}),
    getTerminalDiagnostics: jest.fn().mockReturnValue({}),
    generateIdempotencyKey: jest.fn().mockReturnValue('idem-cash-so-1'),
    cancelTerminal: jest.fn().mockResolvedValue({})
  };
});

jest.mock('../lib/zoho-api', function () {
  return {
    zohoGet: jest.fn(),
    zohoPost: jest.fn().mockResolvedValue({ invoice: { invoice_id: 'inv-cash-1', invoice_number: 'INV-CASH-001' } }),
    zohoPut: jest.fn()
  };
});

jest.mock('../lib/cache', function () {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    acquireLock: jest.fn().mockResolvedValue(true),
    releaseLock: jest.fn().mockResolvedValue()
  };
});

jest.mock('../lib/logger', function () {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
});

jest.mock('../lib/eventLog', function () {
  return { logEvent: jest.fn() };
});

jest.mock('../lib/mailer', function () {
  return { sendVoidFailureAlert: jest.fn().mockResolvedValue({}) };
});

jest.mock('../lib/inventory-ledger', function () {
  return { decrementStock: jest.fn().mockResolvedValue({}), reconcileFromZoho: jest.fn() };
});

jest.mock('../lib/brewpad-integration', function () {
  return { createBatchesFromSale: jest.fn(), detectRecipeSale: jest.fn() };
});

jest.mock('../lib/discount-match', function () {
  return { classifyCatalogItem: jest.fn().mockReturnValue([]), matches: jest.fn().mockReturnValue(false) };
});

jest.mock('../lib/checkout-helpers', function () {
  return { buildContactPayload: jest.fn(), withTimeout: function (p) { return p; } };
});

jest.mock('../lib/money-path', function () {
  return {
    acquireIdempotencyLock: jest.fn().mockResolvedValue({ status: 'acquired' }),
    voidWithTimeout: jest.fn().mockImplementation(function (helcimLike, txnId) {
      return helcimLike.voidTransaction(txnId)
        .then(function () {})
        .catch(function () {});
    }),
    CHECKOUT_IDEMPOTENCY_TTL: 600
  };
});

jest.mock('../lib/constants', function () {
  return {
    CACHE_KEYS: {
      KIOSK_PRODUCTS:              'test:kiosk-products',
      RECENT_ORDERS:               'test:recent-orders',
      KIOSK_IDEM_PREFIX:           'test:idem:',
      KIOSK_SALESORDERS:           'test:kiosk-salesorders',
      KIOSK_DISCOUNT_PRESETS:      'test:kiosk-discount-presets',
      CONSIGNMENT_REPORT_PREFIX:   'test:consignment:report:',
      KIOSK_PENDING_CHARGE_PREFIX: 'test:kiosk:pending-charge:',
      INGREDIENTS_ALL:             'zoho:ingredients:all'
    },
    LOCK_KEYS: { RECIPE_SALE: 'recipe-sale' },
    LEDGER_KEYS: {},
    RATE_LIMIT_PREFIX: 'test:rl:'
  };
});

// =============================================================================
// Test harness (mirrors pos-money-defects.test.js getPosHandlers)
// =============================================================================

var cache, helcimLib, axiosMock, zohoApi, moneyPath, ledger, router, handlers;

function getHandlers() {
  jest.resetModules();
  cache      = require('../lib/cache');
  helcimLib  = require('../lib/helcim');
  axiosMock  = require('axios');
  zohoApi    = require('../lib/zoho-api');
  moneyPath  = require('../lib/money-path');
  ledger     = require('../lib/inventory-ledger');
  require('../routes/pos');
  router   = require('express').Router();
  handlers = {};
  router.post.mock.calls.forEach(function (call) { handlers[call[0]] = call[call.length - 1]; });
  router.get.mock.calls.forEach(function (call) { handlers[call[0]] = call[call.length - 1]; });
}

function mockRes() {
  var r = { json: jest.fn(), status: jest.fn(), headersSent: false };
  r.status.mockReturnValue(r);
  return r;
}

function captureStatus(res) {
  var captured = { code: null };
  res.status.mockImplementation(function (code) { captured.code = code; return res; });
  return captured;
}

// A single tax-exempt custom line: bypasses the catalog check entirely on
// both /sale and /confirm (item.custom === true), so no catalog cache mock
// is required — rate=100, taxable=false → grandTotal=$100 exactly.
function cashCartItems() {
  return [{ custom: true, description: 'Cash Test Item', quantity: 1, rate: 100, taxable: false }];
}

describe('pos — 70-01 cash tender (KIOSK-CASH)', function () {

  beforeEach(function () {
    getHandlers();
    process.env.KIOSK_CONTACT_ID = 'contact-walkin';
  });

  afterEach(function () {
    delete process.env.KIOSK_CONTACT_ID;
    delete process.env.NODE_ENV;
    delete process.env.APPS_SCRIPT_URL;
    delete process.env.APPS_SCRIPT_SERVER_TOKEN;
    delete process.env.ZOHO_GIFT_CARD_CLEARING_ACCOUNT_ID;
  });

  // ---------------------------------------------------------------------
  // /api/kiosk/sale — cash skips the terminal entirely
  // ---------------------------------------------------------------------

  describe('/api/kiosk/sale — tender:cash skips terminal', function () {

    test('cash sale, no gift card → {pending:false, cash:true, reference}; terminalPurchase NOT called', function (done) {
      var req = { body: { items: cashCartItems(), tender: 'cash' } };
      var res = mockRes();
      var statusCapture = captureStatus(res);
      res.json.mockImplementation(function (body) {
        try {
          expect(statusCapture.code).toBe(202);
          expect(body.pending).toBe(false);
          expect(body.cash).toBe(true);
          expect(body.reference).toBeTruthy();
          expect(helcimLib.terminalPurchase).not.toHaveBeenCalled();
          done();
        } catch (e) { done(e); }
      });
      handlers['/api/kiosk/sale'](req, res);
    });

    test('cash sale succeeds even when isTerminalEnabled() returns false (guard relaxed for cash)', function (done) {
      helcimLib.isTerminalEnabled.mockReturnValue(false);
      var req = { body: { items: cashCartItems(), tender: 'cash' } };
      var res = mockRes();
      var statusCapture = captureStatus(res);
      res.json.mockImplementation(function (body) {
        try {
          expect(statusCapture.code).toBe(202);
          expect(body.cash).toBe(true);
          done();
        } catch (e) { done(e); }
      });
      handlers['/api/kiosk/sale'](req, res);
    });

    test('unknown tender value → 400', function (done) {
      var req = { body: { items: cashCartItems(), tender: 'bitcoin' } };
      var res = mockRes();
      var statusCapture = captureStatus(res);
      res.json.mockImplementation(function (body) {
        try {
          expect(statusCapture.code).toBe(400);
          expect(body.error).toBeTruthy();
          expect(helcimLib.terminalPurchase).not.toHaveBeenCalled();
          done();
        } catch (e) { done(e); }
      });
      handlers['/api/kiosk/sale'](req, res);
    });

    test('regression: no tender field → terminal branch unchanged (terminalPurchase called)', function (done) {
      var req = { body: { items: cashCartItems() } };
      var res = mockRes();
      var statusCapture = captureStatus(res);
      res.json.mockImplementation(function (body) {
        try {
          expect(statusCapture.code).toBe(202);
          expect(body.pending).toBe(true);
          expect(helcimLib.terminalPurchase).toHaveBeenCalled();
          done();
        } catch (e) { done(e); }
      });
      handlers['/api/kiosk/sale'](req, res);
    });

  });

  // ---------------------------------------------------------------------
  // /api/kiosk/sale/confirm — cash books payment_mode:'cash', no Helcim
  // ---------------------------------------------------------------------

  describe('/api/kiosk/sale/confirm — tender:cash books payment_mode:cash', function () {

    test('cash confirm, no transaction_id → invoice created, payment_mode:cash amount=grandTotal, reference_number=refNumber; stock decremented', function (done) {
      var req = {
        body: {
          items: cashCartItems(),
          tender: 'cash',
          reference_number: 'KIOSK-CASH-001'
          // NO transaction_id — cash never sends one
        }
      };
      var res = mockRes();
      var statusCapture = captureStatus(res);
      res.json.mockImplementation(function (body) {
        try {
          expect(statusCapture.code).toBe(201);
          expect(body.ok).toBe(true);

          var paymentCalls = zohoApi.zohoPost.mock.calls.filter(function (c) {
            return c[0] === '/customerpayments';
          });
          expect(paymentCalls.length).toBe(1);
          expect(paymentCalls[0][1].payment_mode).toBe('cash');
          expect(paymentCalls[0][1].amount).toBe(100);
          expect(paymentCalls[0][1].reference_number).toBe('KIOSK-CASH-001');

          expect(ledger.decrementStock).toHaveBeenCalled();
          done();
        } catch (e) { done(e); }
      });
      handlers['/api/kiosk/sale/confirm'](req, res);
    });

    test('cash confirm does NOT call pollTerminalResult (verifyManualCharge skipped)', function (done) {
      var req = {
        body: { items: cashCartItems(), tender: 'cash', reference_number: 'KIOSK-CASH-002' }
      };
      var res = mockRes();
      captureStatus(res);
      res.json.mockImplementation(function () {
        try {
          expect(helcimLib.pollTerminalResult).not.toHaveBeenCalled();
          done();
        } catch (e) { done(e); }
      });
      handlers['/api/kiosk/sale/confirm'](req, res);
    });

    test('cash confirm writes no KIOSK_PENDING_CHARGE_PREFIX cache key', function (done) {
      var req = {
        body: { items: cashCartItems(), tender: 'cash', reference_number: 'KIOSK-CASH-003' }
      };
      var res = mockRes();
      captureStatus(res);
      res.json.mockImplementation(function () {
        try {
          var pendingChargeWrite = cache.set.mock.calls.find(function (c) {
            return typeof c[0] === 'string' && c[0].indexOf('test:kiosk:pending-charge:') === 0;
          });
          expect(pendingChargeWrite).toBeFalsy();
          done();
        } catch (e) { done(e); }
      });
      handlers['/api/kiosk/sale/confirm'](req, res);
    });

    test('double-tap: two confirms with the same idempotency_key → single invoice + single payment (replay 201)', function (done) {
      var body = {
        items: cashCartItems(),
        tender: 'cash',
        reference_number: 'KIOSK-CASH-004',
        idempotency_key: 'cash-double-tap-key'
      };

      var firstRes = mockRes();
      var firstStatus = captureStatus(firstRes);
      firstRes.json.mockImplementation(function (firstBody) {
        try {
          expect(firstStatus.code).toBe(201);
          expect(firstBody.ok).toBe(true);

          // Simulate the idempotency lock now reporting a cached replay,
          // exactly like moneyPath.acquireIdempotencyLock does on a real
          // second request under the same key.
          moneyPath.acquireIdempotencyLock.mockResolvedValueOnce({ status: 'replay', cached: firstBody });

          var secondRes = mockRes();
          var secondStatus = captureStatus(secondRes);
          secondRes.json.mockImplementation(function (secondBody) {
            try {
              expect(secondStatus.code).toBe(201);
              expect(secondBody).toEqual(firstBody);
              var invoiceCalls = zohoApi.zohoPost.mock.calls.filter(function (c) { return c[0] === '/invoices'; });
              expect(invoiceCalls.length).toBe(1);
              var paymentCalls = zohoApi.zohoPost.mock.calls.filter(function (c) { return c[0] === '/customerpayments'; });
              expect(paymentCalls.length).toBe(1);
              done();
            } catch (e) { done(e); }
          });
          handlers['/api/kiosk/sale/confirm']({ body: body }, secondRes);
        } catch (e) { done(e); }
      });
      handlers['/api/kiosk/sale/confirm']({ body: body }, firstRes);
    });

  });

  // ---------------------------------------------------------------------
  // Gift card + cash split tender
  // ---------------------------------------------------------------------

  describe('gift card + cash split tender', function () {

    beforeEach(function () {
      process.env.APPS_SCRIPT_URL = 'https://script.example.com/exec';
      process.env.APPS_SCRIPT_SERVER_TOKEN = 'server-token-test';
      process.env.ZOHO_GIFT_CARD_CLEARING_ACCOUNT_ID = '109900000000873231';
      // Gift-card balance lookup: ok:true with no current_balance → 'unavailable'
      // state → non-prod fail-open, submitted amount used unclamped (mirrors
      // pos-gift-card.test.js's partial-redemption pattern).
      axiosMock.post.mockResolvedValue({ data: { ok: true } });
    });

    test('sale: gift+cash split — /sale responds cash:true (tender:cash takes priority over terminal_amount math)', function (done) {
      var req = {
        body: {
          items: cashCartItems(),
          tender: 'cash',
          gift_card: { cert_number: 'GC-000001', amount_applied: 40 }
        }
      };
      var res = mockRes();
      var statusCapture = captureStatus(res);
      res.json.mockImplementation(function (body) {
        try {
          expect(statusCapture.code).toBe(202);
          expect(body.cash).toBe(true);
          expect(helcimLib.terminalPurchase).not.toHaveBeenCalled();
          done();
        } catch (e) { done(e); }
      });
      handlers['/api/kiosk/sale'](req, res);
    });

    test('confirm: gift+cash split — cashApplied = grandTotal - gcApplied; cash booked BEFORE the others (gift-card) leg', function (done) {
      var req = {
        body: {
          items: cashCartItems(),
          tender: 'cash',
          reference_number: 'KIOSK-CASH-GC-001',
          gift_card: { cert_number: 'GC-000001', amount_applied: 40 }
        }
      };
      var res = mockRes();
      var statusCapture = captureStatus(res);
      res.json.mockImplementation(function (body) {
        try {
          expect(statusCapture.code).toBe(201);

          var paymentCalls = zohoApi.zohoPost.mock.calls.filter(function (c) {
            return c[0] === '/customerpayments';
          });
          expect(paymentCalls.length).toBe(2);

          var cashCall = paymentCalls.find(function (c) { return c[1].payment_mode === 'cash'; });
          var gcCall = paymentCalls.find(function (c) { return c[1].payment_mode === 'others'; });

          expect(cashCall).toBeTruthy();
          expect(cashCall[1].amount).toBe(60); // grandTotal(100) - gcApplied(40)
          expect(gcCall).toBeTruthy();
          expect(gcCall[1].amount).toBe(40);

          // Cash leg recorded before the gift-card 'others' leg (Pitfall 1 ordering)
          var allPaymentCallOrder = zohoApi.zohoPost.mock.calls
            .map(function (c, i) { return c[0] === '/customerpayments' ? i : -1; })
            .filter(function (i) { return i !== -1; });
          var cashIdx = zohoApi.zohoPost.mock.calls.findIndex(function (c) {
            return c[0] === '/customerpayments' && c[1].payment_mode === 'cash';
          });
          var gcIdx = zohoApi.zohoPost.mock.calls.findIndex(function (c) {
            return c[0] === '/customerpayments' && c[1].payment_mode === 'others';
          });
          expect(cashIdx).toBeLessThan(gcIdx);
          expect(allPaymentCallOrder.length).toBe(2);

          done();
        } catch (e) { done(e); }
      });
      handlers['/api/kiosk/sale/confirm'](req, res);
    });

  });

});
