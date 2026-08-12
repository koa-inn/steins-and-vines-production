'use strict';

/**
 * pos-moto-tender.test.js — Regression tests for Phase 70-02 (KIOSK-MOTO)
 *
 * Phone-order / card-not-present (MOTO) tender via HelcimPay.js hosted iframe:
 *
 *   - /api/kiosk/sale: tender:'moto' calls helcimLib.initializeCheckout
 *     in-process (NOT terminalPurchase), responds
 *     {pending:false, moto:true, checkout_token, reference}, works even when
 *     isTerminalEnabled() is false (only isEnabled() — the API token — is
 *     required), and writes NO KIOSK_PENDING_CHARGE_PREFIX record (HelcimPay
 *     resolves synchronously — no webhook race to reconcile, Pitfall 3).
 *   - /api/kiosk/sale/confirm: tender:'moto' REQUIRES the server to verify the
 *     ACTUAL Helcim-captured amount (via getCardTransactionById) covers the
 *     recorded total (±$0.01) BEFORE booking anything — the single most
 *     important control in this phase (T-70-06). A short/unverifiable
 *     capture books ZERO invoice and ZERO customerpayment and routes through
 *     the EXISTING outer void-on-failure catch (no new void path).
 *   - Happy path: verified capture books payment_mode:'creditcard',
 *     reference_number = the verified Helcim txn id, notes containing
 *     'card-not-present'; stock decremented.
 *   - MOTO + gift-card split: the gift-card 'others' leg still books AFTER
 *     the verified creditcard leg (Pitfall 1 ordering); stock decrement
 *     unchanged.
 *   - Regression: no-tender/terminal and tender:'cash' paths are unaffected
 *     by the MOTO branch insertion.
 *
 * RED phase: the MANDATORY phantom-revenue guard test (first describe block
 * below) FAILS before pos.js's verifyMotoCharge captured-amount gate exists —
 * a short/unverified capture would otherwise book the invoice + payment on
 * trust. GREEN phase: all tests PASS once verifyMotoCharge (gated via
 * Promise.all alongside verifyManualCharge, BEFORE any zohoPost('/invoices'))
 * is wired in.
 */

// =============================================================================
// Shared mocks (cloned from pos-cash-tender.test.js / pos-money-defects.test.js,
// with getCardTransactionById + initializeCheckout added — the base pos mock
// omits both; see checkout-captured-amount.test.js:48-63 for the mock shape).
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
    terminalPurchase: jest.fn().mockResolvedValue({ idempotencyKey: 'idem-moto-1' }),
    pollTerminalResult: jest.fn().mockResolvedValue({
      approved: true, transactionId: 'txn-moto-poll-123', authorizationCode: 'AUTH1', cardType: 'Visa'
    }),
    initializeCheckout: jest.fn().mockResolvedValue({ checkoutToken: 'tok-moto-test', secretToken: 'secret-moto-test' }),
    getCardTransactionById: jest.fn(),
    voidTransaction: jest.fn().mockResolvedValue({}),
    getTerminalDiagnostics: jest.fn().mockReturnValue({}),
    generateIdempotencyKey: jest.fn().mockReturnValue('idem-moto-so-1'),
    cancelTerminal: jest.fn().mockResolvedValue({})
  };
});

jest.mock('../lib/zoho-api', function () {
  return {
    zohoGet: jest.fn(),
    zohoPost: jest.fn().mockResolvedValue({ invoice: { invoice_id: 'inv-moto-1', invoice_number: 'INV-MOTO-001' } }),
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
// Test harness (mirrors pos-cash-tender.test.js getHandlers)
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
// both /sale and /confirm (item.custom === true) — rate=100, taxable=false
// → grandTotal=$100 exactly.
function motoCartItems() {
  return [{ custom: true, description: 'MOTO Test Item', quantity: 1, rate: 100, taxable: false }];
}

describe('pos — 70-02 MOTO (phone-order card-not-present) tender (KIOSK-MOTO)', function () {

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
  // MANDATORY: phantom-revenue guard (T-70-06) — the top-priority test
  // ---------------------------------------------------------------------

  describe('/api/kiosk/sale/confirm — captured-amount verify (phantom-revenue guard)', function () {

    test('MANDATORY: captured < grandTotal-$0.01 → NO invoice, NO customerpayment, routes to void-on-failure', function (done) {
      helcimLib.getCardTransactionById.mockResolvedValue({ amount: 50 }); // short of $100 total
      var req = {
        body: {
          items: motoCartItems(),
          tender: 'moto',
          transaction_id: 'txn-moto-short',
          reference_number: 'KIOSK-MOTO-001'
        }
      };
      var res = mockRes();
      var statusCapture = captureStatus(res);
      res.json.mockImplementation(function (body) {
        try {
          expect(statusCapture.code).toBe(502);
          var invoiceCalls = zohoApi.zohoPost.mock.calls.filter(function (c) { return c[0] === '/invoices'; });
          expect(invoiceCalls.length).toBe(0);
          var paymentCalls = zohoApi.zohoPost.mock.calls.filter(function (c) { return c[0] === '/customerpayments'; });
          expect(paymentCalls.length).toBe(0);
          // Routed through the EXISTING outer void-on-failure catch — no new void path.
          expect(helcimLib.voidTransaction).toHaveBeenCalledWith('txn-moto-short');
          expect(body.payment_voided).toBe(true);
          done();
        } catch (e) { done(e); }
      });
      handlers['/api/kiosk/sale/confirm'](req, res);
    });

    test('getCardTransactionById throws → REJECTED (fail-closed), no booking', function (done) {
      helcimLib.getCardTransactionById.mockRejectedValue(new Error('Helcim API unreachable'));
      var req = {
        body: {
          items: motoCartItems(),
          tender: 'moto',
          transaction_id: 'txn-moto-unreachable',
          reference_number: 'KIOSK-MOTO-002'
        }
      };
      var res = mockRes();
      var statusCapture = captureStatus(res);
      res.json.mockImplementation(function (body) {
        try {
          expect(statusCapture.code).toBe(502);
          var invoiceCalls = zohoApi.zohoPost.mock.calls.filter(function (c) { return c[0] === '/invoices'; });
          expect(invoiceCalls.length).toBe(0);
          var paymentCalls = zohoApi.zohoPost.mock.calls.filter(function (c) { return c[0] === '/customerpayments'; });
          expect(paymentCalls.length).toBe(0);
          expect(helcimLib.voidTransaction).toHaveBeenCalledWith('txn-moto-unreachable');
          done();
        } catch (e) { done(e); }
      });
      handlers['/api/kiosk/sale/confirm'](req, res);
    });

    test('getCardTransactionById returns non-finite/<=0 amount → REJECTED, no booking', function (done) {
      helcimLib.getCardTransactionById.mockResolvedValue({ amount: 0 });
      var req = {
        body: {
          items: motoCartItems(),
          tender: 'moto',
          transaction_id: 'txn-moto-zero',
          reference_number: 'KIOSK-MOTO-003'
        }
      };
      var res = mockRes();
      var statusCapture = captureStatus(res);
      res.json.mockImplementation(function (body) {
        try {
          expect(statusCapture.code).toBe(502);
          var paymentCalls = zohoApi.zohoPost.mock.calls.filter(function (c) { return c[0] === '/customerpayments'; });
          expect(paymentCalls.length).toBe(0);
          expect(helcimLib.voidTransaction).toHaveBeenCalledWith('txn-moto-zero');
          done();
        } catch (e) { done(e); }
      });
      handlers['/api/kiosk/sale/confirm'](req, res);
    });

    test('confirm with no transaction_id at all → REJECTED, no booking (REQUIRE body.transaction_id)', function (done) {
      var req = {
        body: {
          items: motoCartItems(),
          tender: 'moto',
          reference_number: 'KIOSK-MOTO-004'
          // no transaction_id
        }
      };
      var res = mockRes();
      var statusCapture = captureStatus(res);
      res.json.mockImplementation(function (body) {
        try {
          expect(statusCapture.code).toBe(502);
          var paymentCalls = zohoApi.zohoPost.mock.calls.filter(function (c) { return c[0] === '/customerpayments'; });
          expect(paymentCalls.length).toBe(0);
          expect(helcimLib.getCardTransactionById).not.toHaveBeenCalled();
          done();
        } catch (e) { done(e); }
      });
      handlers['/api/kiosk/sale/confirm'](req, res);
    });

    test('happy path: captured >= grandTotal-$0.01 → books invoice + payment_mode:creditcard, reference_number=verified txnId, notes contains card-not-present; stock decremented', function (done) {
      helcimLib.getCardTransactionById.mockResolvedValue({ amount: 100 });
      var req = {
        body: {
          items: motoCartItems(),
          tender: 'moto',
          transaction_id: 'txn-moto-verified',
          reference_number: 'KIOSK-MOTO-005'
        }
      };
      var res = mockRes();
      var statusCapture = captureStatus(res);
      res.json.mockImplementation(function (body) {
        try {
          expect(statusCapture.code).toBe(201);
          expect(body.ok).toBe(true);

          var paymentCalls = zohoApi.zohoPost.mock.calls.filter(function (c) { return c[0] === '/customerpayments'; });
          expect(paymentCalls.length).toBe(1);
          expect(paymentCalls[0][1].payment_mode).toBe('creditcard');
          expect(paymentCalls[0][1].amount).toBe(100);
          expect(paymentCalls[0][1].reference_number).toBe('txn-moto-verified');
          expect(paymentCalls[0][1].notes).toEqual(expect.stringContaining('card-not-present'));

          expect(ledger.decrementStock).toHaveBeenCalled();
          expect(helcimLib.voidTransaction).not.toHaveBeenCalled();
          done();
        } catch (e) { done(e); }
      });
      handlers['/api/kiosk/sale/confirm'](req, res);
    });

  });

  // ---------------------------------------------------------------------
  // /api/kiosk/sale — MOTO initializes HelcimPay in-process, skips terminal
  // ---------------------------------------------------------------------

  describe('/api/kiosk/sale — tender:moto initializes HelcimPay, skips terminal', function () {

    test('moto sale → calls initializeCheckout (NOT terminalPurchase), responds {pending:false, moto:true, checkout_token, reference}; NO pending-charge write', function (done) {
      var req = { body: { items: motoCartItems(), tender: 'moto' } };
      var res = mockRes();
      var statusCapture = captureStatus(res);
      res.json.mockImplementation(function (body) {
        try {
          expect(statusCapture.code).toBe(202);
          expect(body.pending).toBe(false);
          expect(body.moto).toBe(true);
          expect(body.checkout_token).toBe('tok-moto-test');
          expect(body.reference).toBeTruthy();
          expect(helcimLib.initializeCheckout).toHaveBeenCalled();
          expect(helcimLib.terminalPurchase).not.toHaveBeenCalled();

          var pendingChargeWrite = cache.set.mock.calls.find(function (c) {
            return typeof c[0] === 'string' && c[0].indexOf('test:kiosk:pending-charge:') === 0;
          });
          expect(pendingChargeWrite).toBeFalsy();
          done();
        } catch (e) { done(e); }
      });
      handlers['/api/kiosk/sale'](req, res);
    });

    test('moto sale succeeds when isTerminalEnabled() is false but isEnabled() is true', function (done) {
      helcimLib.isTerminalEnabled.mockReturnValue(false);
      helcimLib.isEnabled.mockReturnValue(true);
      var req = { body: { items: motoCartItems(), tender: 'moto' } };
      var res = mockRes();
      var statusCapture = captureStatus(res);
      res.json.mockImplementation(function (body) {
        try {
          expect(statusCapture.code).toBe(202);
          expect(body.moto).toBe(true);
          done();
        } catch (e) { done(e); }
      });
      handlers['/api/kiosk/sale'](req, res);
    });

    test('moto sale is rejected when isEnabled() is false (no Helcim API token)', function (done) {
      helcimLib.isEnabled.mockReturnValue(false);
      var req = { body: { items: motoCartItems(), tender: 'moto' } };
      var res = mockRes();
      var statusCapture = captureStatus(res);
      res.json.mockImplementation(function (body) {
        try {
          expect(statusCapture.code).toBe(503);
          expect(helcimLib.initializeCheckout).not.toHaveBeenCalled();
          done();
        } catch (e) { done(e); }
      });
      handlers['/api/kiosk/sale'](req, res);
    });

  });

  // ---------------------------------------------------------------------
  // Gift card + MOTO split tender
  // ---------------------------------------------------------------------

  describe('gift card + moto split tender', function () {

    beforeEach(function () {
      process.env.APPS_SCRIPT_URL = 'https://script.example.com/exec';
      process.env.APPS_SCRIPT_SERVER_TOKEN = 'server-token-test';
      process.env.ZOHO_GIFT_CARD_CLEARING_ACCOUNT_ID = '109900000000873231';
      // Gift-card balance lookup: ok:true with no current_balance → 'unavailable'
      // state → non-prod fail-open, submitted amount used unclamped (mirrors
      // pos-cash-tender.test.js's split-tender pattern).
      axiosMock.post.mockResolvedValue({ data: { ok: true } });
    });

    test('confirm: gift+moto split — verified creditcard leg booked BEFORE the gift-card "others" leg; stock decrement unchanged', function (done) {
      // grandTotal $100, gift card $40 → terminalApplied (moto verify target) = $60
      helcimLib.getCardTransactionById.mockResolvedValue({ amount: 60 });
      var req = {
        body: {
          items: motoCartItems(),
          tender: 'moto',
          transaction_id: 'txn-moto-gc',
          reference_number: 'KIOSK-MOTO-GC-001',
          gift_card: { cert_number: 'GC-000001', amount_applied: 40 }
        }
      };
      var res = mockRes();
      var statusCapture = captureStatus(res);
      res.json.mockImplementation(function (body) {
        try {
          expect(statusCapture.code).toBe(201);

          var paymentCalls = zohoApi.zohoPost.mock.calls.filter(function (c) { return c[0] === '/customerpayments'; });
          expect(paymentCalls.length).toBe(2);

          var creditcardCall = paymentCalls.find(function (c) { return c[1].payment_mode === 'creditcard'; });
          var gcCall = paymentCalls.find(function (c) { return c[1].payment_mode === 'others'; });

          expect(creditcardCall).toBeTruthy();
          expect(creditcardCall[1].amount).toBe(60);
          expect(creditcardCall[1].reference_number).toBe('txn-moto-gc');
          expect(gcCall).toBeTruthy();
          expect(gcCall[1].amount).toBe(40);

          var creditcardIdx = zohoApi.zohoPost.mock.calls.findIndex(function (c) {
            return c[0] === '/customerpayments' && c[1].payment_mode === 'creditcard';
          });
          var gcIdx = zohoApi.zohoPost.mock.calls.findIndex(function (c) {
            return c[0] === '/customerpayments' && c[1].payment_mode === 'others';
          });
          expect(creditcardIdx).toBeLessThan(gcIdx);

          expect(ledger.decrementStock).toHaveBeenCalled();
          done();
        } catch (e) { done(e); }
      });
      handlers['/api/kiosk/sale/confirm'](req, res);
    });

  });

  // ---------------------------------------------------------------------
  // Regression: no-tender/terminal and cash paths unaffected by the MOTO
  // branch insertion (full suites re-verified via pos-money.test.js and
  // pos-cash-tender.test.js in the verify step).
  // ---------------------------------------------------------------------

  describe('regression', function () {

    test('no tender field still routes through the terminal branch', function (done) {
      var req = { body: { items: motoCartItems() } };
      var res = mockRes();
      var statusCapture = captureStatus(res);
      res.json.mockImplementation(function (body) {
        try {
          expect(statusCapture.code).toBe(202);
          expect(body.pending).toBe(true);
          expect(helcimLib.terminalPurchase).toHaveBeenCalled();
          expect(helcimLib.initializeCheckout).not.toHaveBeenCalled();
          done();
        } catch (e) { done(e); }
      });
      handlers['/api/kiosk/sale'](req, res);
    });

    test('tender:cash still skips terminal AND initializeCheckout', function (done) {
      var req = { body: { items: motoCartItems(), tender: 'cash' } };
      var res = mockRes();
      var statusCapture = captureStatus(res);
      res.json.mockImplementation(function (body) {
        try {
          expect(statusCapture.code).toBe(202);
          expect(body.cash).toBe(true);
          expect(helcimLib.terminalPurchase).not.toHaveBeenCalled();
          expect(helcimLib.initializeCheckout).not.toHaveBeenCalled();
          done();
        } catch (e) { done(e); }
      });
      handlers['/api/kiosk/sale'](req, res);
    });

  });

});
