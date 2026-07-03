'use strict';

// ---------------------------------------------------------------------------
// pos-sale-quarantine.test.js — 52-03 (M2, RESIL-01)
//
// Legacy `POST /api/pos/sale` charged the Helcim terminal then treated a
// subsequent Zoho invoice/payment failure as "non-fatal" (no void, no
// pending record) — an invisible orphan charge invisible even to the 45-08
// reconciliation backstop.
//
// Grep-confirmed dead (2026-07-03): `grep -rn "pos/sale" js/` → zero
// frontend callers. Only remaining references: docs/*, openapi.yaml, and
// this file's own JSDoc/route def + the `app.use('/api/pos/sale',
// paymentLimiter)` rate-limit mount in server.js.
//
// Fix: the route now returns 410 Gone BEFORE any helcimLib terminal call,
// so no charge — and therefore no orphan — can ever occur again.
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
    terminalPurchase: jest.fn().mockResolvedValue({ idempotencyKey: 'idem-quarantine-1' }),
    pollTerminalResult: jest.fn().mockResolvedValue({
      approved: true, transactionId: 'txn-quarantine-1', authorizationCode: 'AUTH1', cardType: 'Visa'
    }),
    voidTransaction: jest.fn().mockResolvedValue({}),
    getTerminalDiagnostics: jest.fn().mockReturnValue({}),
    generateIdempotencyKey: jest.fn().mockReturnValue('idem-quarantine-so-1'),
    cancelTerminal: jest.fn().mockResolvedValue({})
  };
});

jest.mock('../lib/zoho-api', function () {
  return {
    zohoGet: jest.fn(),
    zohoPost: jest.fn().mockResolvedValue({ invoice: { invoice_id: 'inv-q-1', invoice_number: 'INV-Q-001' } }),
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

jest.mock('../lib/eventLog', function () { return { logEvent: jest.fn() }; });
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
    voidWithTimeout: jest.fn().mockResolvedValue(),
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

describe('POST /api/pos/sale — quarantined (52-03 M2)', function () {
  var helcimLib, zohoApi, router, handlers;

  function getHandlers() {
    jest.resetModules();
    helcimLib = require('../lib/helcim');
    zohoApi   = require('../lib/zoho-api');
    require('../routes/pos');
    router   = require('express').Router();
    handlers = {};
    router.post.mock.calls.forEach(function (call) { handlers[call[0]] = call[call.length - 1]; });
    router.get.mock.calls.forEach(function (call) { handlers[call[0]] = call[call.length - 1]; });
  }

  beforeEach(function () {
    getHandlers();
  });

  function mockRes() {
    var res = { json: jest.fn(), status: jest.fn(), headersSent: false };
    res.status.mockReturnValue(res);
    return res;
  }

  test('returns 410 Gone with the retirement message', function (done) {
    var req = { body: { amount: 49.99, salesorder_number: 'SO-00123' } };
    var res = mockRes();
    var statusCapture = { code: null };
    res.status.mockImplementation(function (code) { statusCapture.code = code; return res; });
    res.json.mockImplementation(function (body) {
      try {
        expect(statusCapture.code).toBe(410);
        expect(body.error).toMatch(/retired/i);
        expect(body.error).toMatch(/kiosk\/sale/i);
        done();
      } catch (e) { done(e); }
    });
    handlers['/api/pos/sale'](req, res);
  });

  test('never calls helcimLib.isTerminalEnabled or terminalPurchase — no charge can occur', function () {
    var req = { body: { amount: 49.99, salesorder_number: 'SO-00124' } };
    var res = mockRes();
    handlers['/api/pos/sale'](req, res);
    expect(helcimLib.isTerminalEnabled).not.toHaveBeenCalled();
    expect(helcimLib.terminalPurchase).not.toHaveBeenCalled();
  });

  test('never creates a Zoho invoice/payment (no orphan charge write path reached)', function () {
    var req = { body: { amount: 49.99, salesorder_number: 'SO-00125' } };
    var res = mockRes();
    handlers['/api/pos/sale'](req, res);
    expect(zohoApi.zohoPost).not.toHaveBeenCalled();
  });

  test('returns 410 even with no amount / malformed body — the quarantine short-circuits before any validation', function (done) {
    var req = { body: {} };
    var res = mockRes();
    var statusCapture = { code: null };
    res.status.mockImplementation(function (code) { statusCapture.code = code; return res; });
    res.json.mockImplementation(function () {
      try {
        expect(statusCapture.code).toBe(410);
        expect(helcimLib.terminalPurchase).not.toHaveBeenCalled();
        done();
      } catch (e) { done(e); }
    });
    handlers['/api/pos/sale'](req, res);
  });
});
