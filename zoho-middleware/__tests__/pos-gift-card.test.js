'use strict';

// ---------------------------------------------------------------------------
// pos-gift-card.test.js
// Split-tender gift card redemption tests for /api/kiosk/sale and
// /api/kiosk/sale/confirm (Phase 44-04).
//
// Run these tests alone: cd zoho-middleware && npm test -- gift-card
// ---------------------------------------------------------------------------

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
    terminalPurchase: jest.fn().mockResolvedValue({ idempotencyKey: 'idem-gc-1' }),
    pollTerminalResult: jest.fn().mockResolvedValue({
      approved: true, transactionId: 'txn-gc-123', authorizationCode: 'AUTH1', cardType: 'Visa'
    }),
    voidTransaction: jest.fn().mockResolvedValue({}),
    getTerminalDiagnostics: jest.fn().mockReturnValue({}),
    generateIdempotencyKey: jest.fn().mockReturnValue('idem-gc-so-1')
  };
});

jest.mock('../lib/zoho-api', function () {
  return {
    zohoGet: jest.fn(),
    zohoPost: jest.fn().mockResolvedValue({ invoice: { invoice_id: 'inv-gc-1', invoice_number: 'INV-GC-001' } }),
    zohoPut: jest.fn()
  };
});

jest.mock('../lib/cache', function () {
  return {
    get: jest.fn(),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1)
  };
});

jest.mock('../lib/logger', function () {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
});

jest.mock('../lib/eventLog', function () { return { logEvent: jest.fn() }; });
jest.mock('../lib/mailer', function () {
  return { sendVoidFailureAlert: jest.fn().mockResolvedValue({}) };
});
jest.mock('../lib/inventory-ledger', function () {
  return {
    decrementStock: jest.fn().mockResolvedValue({}),
    reconcileFromZoho: jest.fn()
  };
});
jest.mock('../lib/brewpad-integration', function () {
  return { createBatchesFromSale: jest.fn() };
});
jest.mock('../lib/checkout-helpers', function () {
  return { buildContactPayload: jest.fn() };
});
jest.mock('../lib/constants', function () {
  return {
    CACHE_KEYS: {
      KIOSK_PRODUCTS: 'test:kiosk-products',
      RECENT_ORDERS: 'test:recent-orders',
      KIOSK_IDEM_PREFIX: 'test:idem:',
      KIOSK_SALESORDERS: 'test:kiosk-salesorders',
      KIOSK_DISCOUNT_PRESETS: 'test:kiosk-discount-presets',
      CONSIGNMENT_REPORT_PREFIX: 'test:consignment:report:'
    },
    LEDGER_KEYS: {},
    RATE_LIMIT_PREFIX: 'test:rl:'
  };
});

// ---------------------------------------------------------------------------
// Catalog fixtures
// ---------------------------------------------------------------------------

// A simple tax-exempt catalog item.
// tax_id must be set (even as a dummy value) so computeTax does NOT fall through to
// the "!pct && !catalogItem.tax_id → apply default 5% rate" branch in pos.js.
var CATALOG_EXEMPT = [
  {
    item_id: 'item-gc-test',
    name: 'Gift Test Item',
    rate: 100.00,
    stock_on_hand: 10,
    tax_percentage: 0,
    tax_id: 'gc-test-exempt',  // blocks default 5% → grandTotal = rate = $100
    custom_fields: []
  }
];

// ---------------------------------------------------------------------------
// Test harness (mirrors pos-custom-line.test.js pattern)
// ---------------------------------------------------------------------------

describe('pos routes — gift card split-tender (Phase 44)', function () {
  var cache, zohoApi, helcimLib, axiosMock, log, router, handlers;

  function getHandlers() {
    jest.resetModules();
    cache      = require('../lib/cache');
    zohoApi    = require('../lib/zoho-api');
    helcimLib  = require('../lib/helcim');
    axiosMock  = require('axios');
    log        = require('../lib/logger');
    require('../routes/pos');
    router = require('express').Router();
    handlers = {};
    router.post.mock.calls.forEach(function (call) {
      handlers[call[0]] = call[call.length - 1];
    });
    router.get.mock.calls.forEach(function (call) {
      handlers[call[0]] = call[call.length - 1];
    });
    router.put.mock.calls.forEach(function (call) {
      handlers[call[0]] = call[call.length - 1];
    });
  }

  function mockRes() {
    var res = { json: jest.fn(), status: jest.fn(), headersSent: false };
    res.status.mockReturnValue(res);
    return res;
  }

  beforeEach(function () {
    getHandlers();
    process.env.KIOSK_CONTACT_ID = 'contact-walkin';
    process.env.APPS_SCRIPT_URL = 'https://script.example.com/exec';
    process.env.APPS_SCRIPT_SERVER_TOKEN = 'server-token-test';
    process.env.ZOHO_GIFT_CARD_CLEARING_ACCOUNT_ID = '109900000000873231';
  });

  afterEach(function () {
    delete process.env.KIOSK_CONTACT_ID;
    delete process.env.APPS_SCRIPT_URL;
    delete process.env.APPS_SCRIPT_SERVER_TOKEN;
    delete process.env.ZOHO_GIFT_CARD_CLEARING_ACCOUNT_ID;
  });

  // -------------------------------------------------------------------------
  // /api/kiosk/sale — split-tender terminal_amount math
  // -------------------------------------------------------------------------

  describe('/api/kiosk/sale — split-tender terminal_amount math', function () {

    test('partial redemption: terminalPurchase called with grandTotal - gift_amount', function (done) {
      // item rate=100, taxable=false → grandTotal=100
      // gift_amount=40 → terminal_amount=60
      cache.get.mockResolvedValue(CATALOG_EXEMPT);

      var req = {
        body: {
          items: [{ item_id: 'item-gc-test', name: 'Gift Test Item', quantity: 1 }],
          gift_card: { cert_number: 'GC-000001', amount_applied: 40 }
        }
      };
      var res = mockRes();

      res.json.mockImplementation(function (body) {
        try {
          expect(body.pending).toBe(true);
          var termCall = helcimLib.terminalPurchase.mock.calls[0];
          expect(termCall).toBeTruthy();
          expect(termCall[0]).toBe(60);   // terminal_amount = 100 - 40
          done();
        } catch (e) { done(e); }
      });
      res.status.mockImplementation(function (code) {
        if (code >= 400) {
          return { json: function (b) { done(new Error('Got status ' + code + ': ' + JSON.stringify(b))); } };
        }
        return res;
      });

      handlers['/api/kiosk/sale'](req, res);
    });

    test('full redemption (gift_card_only): terminalPurchase NOT called; response has gift_card_only:true', function (done) {
      // item rate=100, taxable=false → grandTotal=100
      // gift_amount=100 → terminal_amount=0 → skip terminal
      cache.get.mockResolvedValue(CATALOG_EXEMPT);

      var req = {
        body: {
          items: [{ item_id: 'item-gc-test', name: 'Gift Test Item', quantity: 1 }],
          gift_card: { cert_number: 'GC-000002', amount_applied: 100 }
        }
      };
      var res = mockRes();

      res.json.mockImplementation(function (body) {
        try {
          expect(helcimLib.terminalPurchase).not.toHaveBeenCalled();
          expect(body.gift_card_only).toBe(true);
          expect(body.pending).toBe(false);
          expect(body.reference).toBeTruthy();
          done();
        } catch (e) { done(e); }
      });
      res.status.mockImplementation(function (code) {
        if (code >= 400) {
          return { json: function (b) { done(new Error('Got status ' + code + ': ' + JSON.stringify(b))); } };
        }
        return res;
      });

      handlers['/api/kiosk/sale'](req, res);
    });

    test('over-apply guard: amount_applied > grandTotal clamped to grandTotal; terminal NOT charged', function (done) {
      // item rate=100, taxable=false → grandTotal=100
      // amount_applied=250 → clamped to 100 → terminal_amount=0
      cache.get.mockResolvedValue(CATALOG_EXEMPT);

      var req = {
        body: {
          items: [{ item_id: 'item-gc-test', name: 'Gift Test Item', quantity: 1 }],
          gift_card: { cert_number: 'GC-000003', amount_applied: 250 }
        }
      };
      var res = mockRes();

      res.json.mockImplementation(function (body) {
        try {
          expect(helcimLib.terminalPurchase).not.toHaveBeenCalled();
          expect(body.gift_card_only).toBe(true);
          done();
        } catch (e) { done(e); }
      });
      res.status.mockImplementation(function (code) {
        if (code >= 400) {
          return { json: function (b) { done(new Error('Got status ' + code + ': ' + JSON.stringify(b))); } };
        }
        return res;
      });

      handlers['/api/kiosk/sale'](req, res);
    });

  }); // /api/kiosk/sale split-tender

  // -------------------------------------------------------------------------
  // /api/kiosk/sale/confirm — two-payment chain + redeem_gift_card LAST
  // -------------------------------------------------------------------------

  describe('/api/kiosk/sale/confirm — two-payment chain + redeem ordering', function () {

    test('partial redemption: two customerpayments summing to grandTotal (creditcard + others)', function (done) {
      // item rate=100, taxable=false → grandTotal=100; gift=40 → terminal=60
      cache.get.mockResolvedValue(CATALOG_EXEMPT);
      zohoApi.zohoPost.mockImplementation(function (path) {
        if (path === '/invoices') {
          return Promise.resolve({ invoice: { invoice_id: 'inv-gc-1', invoice_number: 'INV-GC-001' } });
        }
        return Promise.resolve({});
      });
      axiosMock.post.mockResolvedValue({ data: { ok: true } });

      var req = {
        body: {
          items: [{ item_id: 'item-gc-test', name: 'Gift Test Item', quantity: 1 }],
          transaction_id: 'txn-gc-terminal-123',
          reference_number: 'KIOSK-GC-001',
          gift_card: { cert_number: 'GC-000001', amount_applied: 40 }
        }
      };
      var res = mockRes();

      res.json.mockImplementation(function (body) {
        try {
          expect(body.ok).toBe(true);

          // Collect all zohoPost payment calls
          var paymentCalls = zohoApi.zohoPost.mock.calls.filter(function (c) {
            return c[0] === '/customerpayments';
          });
          expect(paymentCalls.length).toBe(2);

          var ccCall = paymentCalls.find(function (c) { return c[1].payment_mode === 'creditcard'; });
          var gcCall = paymentCalls.find(function (c) { return c[1].payment_mode === 'others'; });

          // Terminal portion: creditcard for 60
          expect(ccCall).toBeTruthy();
          expect(ccCall[1].amount).toBe(60);
          expect(ccCall[1].invoices[0].amount_applied).toBe(60);
          expect(ccCall[1].reference_number).toBe('txn-gc-terminal-123');

          // Gift card portion: others for 40 with correct account_id
          expect(gcCall).toBeTruthy();
          expect(gcCall[1].amount).toBe(40);
          expect(gcCall[1].invoices[0].amount_applied).toBe(40);
          expect(gcCall[1].account_id).toBe('109900000000873231');
          expect(gcCall[1].reference_number).toBe('GC-000001');

          // Amounts sum to grandTotal
          expect(ccCall[1].amount + gcCall[1].amount).toBe(100);
          done();
        } catch (e) { done(e); }
      });
      res.status.mockImplementation(function (code) {
        if (code >= 400) {
          return { json: function (b) { done(new Error('Got status ' + code + ': ' + JSON.stringify(b))); } };
        }
        return res;
      });

      handlers['/api/kiosk/sale/confirm'](req, res);
    });

    test('full redemption (gift_card_only): only "others" payment, no creditcard payment', function (done) {
      // gift_amount=100 = grandTotal → terminal_amount=0 → skip creditcard payment
      cache.get.mockResolvedValue(CATALOG_EXEMPT);
      zohoApi.zohoPost.mockImplementation(function (path) {
        if (path === '/invoices') {
          return Promise.resolve({ invoice: { invoice_id: 'inv-gc-2', invoice_number: 'INV-GC-002' } });
        }
        return Promise.resolve({});
      });
      axiosMock.post.mockResolvedValue({ data: { ok: true } });

      var req = {
        body: {
          items: [{ item_id: 'item-gc-test', name: 'Gift Test Item', quantity: 1 }],
          // No transaction_id — gift_card_only sale (no terminal)
          reference_number: 'KIOSK-GC-002',
          gift_card: { cert_number: 'GC-000002', amount_applied: 100 }
        }
      };
      var res = mockRes();

      res.json.mockImplementation(function (body) {
        try {
          expect(body.ok).toBe(true);

          var paymentCalls = zohoApi.zohoPost.mock.calls.filter(function (c) {
            return c[0] === '/customerpayments';
          });
          // Only the 'others' payment (no creditcard)
          expect(paymentCalls.length).toBe(1);
          expect(paymentCalls[0][1].payment_mode).toBe('others');
          expect(paymentCalls[0][1].amount).toBe(100);
          expect(paymentCalls[0][1].account_id).toBe('109900000000873231');

          // terminalPurchase was NOT invoked (confirmed via confirm handler)
          expect(helcimLib.terminalPurchase).not.toHaveBeenCalled();
          done();
        } catch (e) { done(e); }
      });
      res.status.mockImplementation(function (code) {
        if (code >= 400) {
          return { json: function (b) { done(new Error('Got status ' + code + ': ' + JSON.stringify(b))); } };
        }
        return res;
      });

      handlers['/api/kiosk/sale/confirm'](req, res);
    });

    test('ordering: redeem_gift_card axios.post called AFTER both zohoPost payment calls', function (done) {
      cache.get.mockResolvedValue(CATALOG_EXEMPT);

      var callOrder = [];
      zohoApi.zohoPost.mockImplementation(function (path) {
        callOrder.push('zohoPost:' + path);
        if (path === '/invoices') {
          return Promise.resolve({ invoice: { invoice_id: 'inv-gc-3', invoice_number: 'INV-GC-003' } });
        }
        return Promise.resolve({});
      });
      axiosMock.post.mockImplementation(function (url, body) {
        var parsed = (typeof body === 'string') ? JSON.parse(body) : body;
        callOrder.push('axiosPost:' + (parsed && parsed.action));
        return Promise.resolve({ data: { ok: true } });
      });

      var req = {
        body: {
          items: [{ item_id: 'item-gc-test', name: 'Gift Test Item', quantity: 1 }],
          transaction_id: 'txn-gc-order-123',
          reference_number: 'KIOSK-GC-003',
          gift_card: { cert_number: 'GC-000003', amount_applied: 40 }
        }
      };
      var res = mockRes();

      res.json.mockImplementation(function (body) {
        try {
          expect(body.ok).toBe(true);

          var redeemIdx = callOrder.indexOf('axiosPost:redeem_gift_card');
          expect(redeemIdx).toBeGreaterThan(-1);

          // Both customerpayments must appear BEFORE redeem_gift_card
          var paymentIndices = callOrder
            .map(function (c, i) { return c === 'zohoPost:/customerpayments' ? i : -1; })
            .filter(function (i) { return i !== -1; });

          expect(paymentIndices.length).toBe(2);
          paymentIndices.forEach(function (pi) {
            expect(redeemIdx).toBeGreaterThan(pi);
          });
          done();
        } catch (e) { done(e); }
      });
      res.status.mockImplementation(function (code) {
        if (code >= 400) {
          return { json: function (b) { done(new Error('Got status ' + code + ': ' + JSON.stringify(b))); } };
        }
        return res;
      });

      handlers['/api/kiosk/sale/confirm'](req, res);
    });

    test('void-on-failure: Zoho invoice failure + terminal charged → voidTransaction called, redeem_gift_card NOT called', function (done) {
      cache.get.mockResolvedValue(CATALOG_EXEMPT);
      // Make zohoPost('/invoices') reject — simulates invoice creation failure after terminal charge
      zohoApi.zohoPost.mockImplementation(function (path) {
        if (path === '/invoices') {
          return Promise.reject(new Error('Zoho 500 — invoice creation failed'));
        }
        return Promise.resolve({});
      });
      axiosMock.post.mockResolvedValue({ data: { ok: true } });

      var req = {
        body: {
          items: [{ item_id: 'item-gc-test', name: 'Gift Test Item', quantity: 1 }],
          transaction_id: 'txn-gc-void-123',  // terminal was charged
          reference_number: 'KIOSK-GC-004',
          gift_card: { cert_number: 'GC-000004', amount_applied: 40 }
        }
      };
      var res = mockRes();

      res.status.mockImplementation(function (code) {
        return {
          json: function (body) {
            try {
              expect(code).toBe(502);
              // voidTransaction must have been called with the terminal txnId
              expect(helcimLib.voidTransaction).toHaveBeenCalledWith('txn-gc-void-123');
              // redeem_gift_card must NOT be called (balance not decremented)
              var redeemCalls = axiosMock.post.mock.calls.filter(function (c) {
                try {
                  var parsed = typeof c[1] === 'string' ? JSON.parse(c[1]) : c[1];
                  return parsed && parsed.action === 'redeem_gift_card';
                } catch (e) { return false; }
              });
              expect(redeemCalls.length).toBe(0);
              done();
            } catch (e) { done(e); }
          }
        };
      });
      res.json.mockImplementation(function () {
        done(new Error('Expected res.status(502) but got res.json directly'));
      });

      handlers['/api/kiosk/sale/confirm'](req, res);
    });

    test('redeem_gift_card failure (Apps Script down) → still returns 201, CRITICAL logged', function (done) {
      cache.get.mockResolvedValue(CATALOG_EXEMPT);
      zohoApi.zohoPost.mockImplementation(function (path) {
        if (path === '/invoices') {
          return Promise.resolve({ invoice: { invoice_id: 'inv-gc-5', invoice_number: 'INV-GC-005' } });
        }
        return Promise.resolve({});
      });
      // Apps Script call fails
      axiosMock.post.mockRejectedValue(new Error('Apps Script unreachable'));

      var req = {
        body: {
          items: [{ item_id: 'item-gc-test', name: 'Gift Test Item', quantity: 1 }],
          transaction_id: 'txn-gc-asdown-123',
          reference_number: 'KIOSK-GC-005',
          gift_card: { cert_number: 'GC-000005', amount_applied: 40 }
        }
      };
      var res = mockRes();

      res.json.mockImplementation(function (body) {
        try {
          // Invoice is already paid — still return 201 (Pitfall 1 accepted failure mode)
          expect(body.ok).toBe(true);
          // CRITICAL must be logged (check log.error was called with CRITICAL message)
          var criticalLogs = log.error.mock.calls.filter(function (c) {
            return c[0] && c[0].indexOf('CRITICAL') !== -1;
          });
          expect(criticalLogs.length).toBeGreaterThan(0);
          done();
        } catch (e) { done(e); }
      });
      res.status.mockImplementation(function (code) {
        if (code >= 400) {
          return { json: function (b) { done(new Error('Got status ' + code + ': ' + JSON.stringify(b))); } };
        }
        return res;
      });

      handlers['/api/kiosk/sale/confirm'](req, res);
    });

    test('redeem_gift_card non-ok response → still returns 201, CRITICAL logged', function (done) {
      cache.get.mockResolvedValue(CATALOG_EXEMPT);
      zohoApi.zohoPost.mockImplementation(function (path) {
        if (path === '/invoices') {
          return Promise.resolve({ invoice: { invoice_id: 'inv-gc-6', invoice_number: 'INV-GC-006' } });
        }
        return Promise.resolve({});
      });
      // Apps Script returns non-ok (e.g., balance not found)
      axiosMock.post.mockResolvedValue({ data: { ok: false, error: 'not_found' } });

      var req = {
        body: {
          items: [{ item_id: 'item-gc-test', name: 'Gift Test Item', quantity: 1 }],
          transaction_id: 'txn-gc-nok-123',
          reference_number: 'KIOSK-GC-006',
          gift_card: { cert_number: 'GC-000006', amount_applied: 40 }
        }
      };
      var res = mockRes();

      res.json.mockImplementation(function (body) {
        try {
          expect(body.ok).toBe(true);
          var criticalLogs = log.error.mock.calls.filter(function (c) {
            return c[0] && c[0].indexOf('CRITICAL') !== -1;
          });
          expect(criticalLogs.length).toBeGreaterThan(0);
          done();
        } catch (e) { done(e); }
      });
      res.status.mockImplementation(function (code) {
        if (code >= 400) {
          return { json: function (b) { done(new Error('Got status ' + code + ': ' + JSON.stringify(b))); } };
        }
        return res;
      });

      handlers['/api/kiosk/sale/confirm'](req, res);
    });

  }); // /api/kiosk/sale/confirm two-payment

  // -------------------------------------------------------------------------
  // Regression: no gift_card in body → existing single-payment path unchanged
  // -------------------------------------------------------------------------

  describe('regression — no gift_card in body', function () {

    test('/api/kiosk/sale: no gift_card → terminalPurchase called with full grandTotal', function (done) {
      // item rate=100, taxable=false → grandTotal=100; no gift card → terminal=100
      cache.get.mockResolvedValue(CATALOG_EXEMPT);

      var req = {
        body: {
          items: [{ item_id: 'item-gc-test', name: 'Gift Test Item', quantity: 1 }]
          // no gift_card
        }
      };
      var res = mockRes();

      res.json.mockImplementation(function (body) {
        try {
          expect(body.pending).toBe(true);
          var termCall = helcimLib.terminalPurchase.mock.calls[0];
          expect(termCall).toBeTruthy();
          expect(termCall[0]).toBe(100);   // full grandTotal, no gift deduction
          done();
        } catch (e) { done(e); }
      });
      res.status.mockImplementation(function (code) {
        if (code >= 400) {
          return { json: function (b) { done(new Error('Got status ' + code + ': ' + JSON.stringify(b))); } };
        }
        return res;
      });

      handlers['/api/kiosk/sale'](req, res);
    });

    test('/api/kiosk/sale/confirm: no gift_card → single creditcard payment for grandTotal', function (done) {
      cache.get.mockResolvedValue(CATALOG_EXEMPT);
      zohoApi.zohoPost.mockImplementation(function (path) {
        if (path === '/invoices') {
          return Promise.resolve({ invoice: { invoice_id: 'inv-reg-1', invoice_number: 'INV-REG-001' } });
        }
        return Promise.resolve({});
      });
      axiosMock.post.mockResolvedValue({ data: { ok: true } });

      var req = {
        body: {
          items: [{ item_id: 'item-gc-test', name: 'Gift Test Item', quantity: 1 }],
          transaction_id: 'txn-reg-123',
          reference_number: 'KIOSK-REG-001'
          // no gift_card
        }
      };
      var res = mockRes();

      res.json.mockImplementation(function (body) {
        try {
          expect(body.ok).toBe(true);

          var paymentCalls = zohoApi.zohoPost.mock.calls.filter(function (c) {
            return c[0] === '/customerpayments';
          });
          // Exactly one payment: creditcard for grandTotal
          expect(paymentCalls.length).toBe(1);
          expect(paymentCalls[0][1].payment_mode).toBe('creditcard');
          expect(paymentCalls[0][1].amount).toBe(100);

          // No Apps Script redeem call
          var redeemCalls = axiosMock.post.mock.calls.filter(function (c) {
            try {
              var parsed = typeof c[1] === 'string' ? JSON.parse(c[1]) : c[1];
              return parsed && parsed.action === 'redeem_gift_card';
            } catch (e) { return false; }
          });
          expect(redeemCalls.length).toBe(0);
          done();
        } catch (e) { done(e); }
      });
      res.status.mockImplementation(function (code) {
        if (code >= 400) {
          return { json: function (b) { done(new Error('Got status ' + code + ': ' + JSON.stringify(b))); } };
        }
        return res;
      });

      handlers['/api/kiosk/sale/confirm'](req, res);
    });

  }); // regression

}); // describe
