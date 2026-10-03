'use strict';

// ---------------------------------------------------------------------------
// pos-giftcard-store.test.js — Phase 84-08 (DB-03)
//
// Regression coverage for routing routes/pos.js's gift-card call sites
// through lib/gift-card-store.js (84-08 Task 1): Pitfall 1 (two distinct
// composite tx_refs when one sale redeems one cert AND issues another),
// D-09 (DB outage at pre-payment lookup fails closed BEFORE any charge in
// production, non-gift-card sales unaffected), D-11 (a post-charge infra
// failure on redeem/issue/reload writes a durable giftcard:pending:<tx_ref>
// record — a business rejection does NOT), the kiosk-sale: actor prefix, and
// sheets-mode byte-for-byte parity (GIFT_CARDS_STORE unset).
//
// lib/gift-card-store.js and lib/reconcile.js are left REAL so the D-11
// assertion observes the actual cache.set record written by reconcile.js's
// recordGiftCardReconcileFailure(). lib/db and lib/gift-card-pg are mocked
// so no real Postgres connection is needed.
//
// Run alone: cd zoho-middleware && npx jest pos-giftcard-store
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
    terminalPurchase: jest.fn().mockResolvedValue({ idempotencyKey: 'idem-gcs-1' }),
    pollTerminalResult: jest.fn().mockResolvedValue({
      approved: true, transactionId: 'txn-gcs-123', authorizationCode: 'AUTH1', cardType: 'Visa'
    }),
    voidTransaction: jest.fn().mockResolvedValue({}),
    getTerminalDiagnostics: jest.fn().mockReturnValue({}),
    generateIdempotencyKey: jest.fn().mockReturnValue('idem-gcs-so-1'),
    // No default — set per test with the SAME total the test's own
    // cart/catalog establishes (mirrors pos-gift-card.test.js convention).
    getCardTransactionById: jest.fn()
  };
});

jest.mock('../lib/zoho-api', function () {
  return {
    zohoGet: jest.fn(),
    zohoPost: jest.fn().mockResolvedValue({
      invoice: { invoice_id: 'inv-gcs-1', invoice_number: 'INV-GCS-001' }
    }),
    zohoPut: jest.fn()
  };
});

jest.mock('../lib/cache', function () {
  return {
    get: jest.fn(),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    // Needed by moneyPath.acquireIdempotencyLock on the D-09 production-mode
    // sale test (idempotency_key required in production) — not exercised by
    // the other tests here, since a truthy cache.get short-circuits before
    // acquireLock is ever reached (mirrors pos-gift-card.test.js).
    acquireLock: jest.fn().mockResolvedValue(true),
    releaseLock: jest.fn().mockResolvedValue(true)
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
  return { buildContactPayload: jest.fn(), withTimeout: function (p) { return p; } };
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
      KIOSK_PENDING_CHARGE_PREFIX: 'test:kiosk:pending-charge:'
    },
    LEDGER_KEYS: {},
    RATE_LIMIT_PREFIX: 'test:rl:'
  };
});

// lib/gift-card-store.js and lib/reconcile.js are REAL (not mocked) — only
// their Postgres transport is faked, so the facade's tx_ref minting, the
// D-11 hook, and reconcile.js's actual cache.set record are all exercised
// for real.
jest.mock('../lib/db', function () {
  return {
    isConfigured: jest.fn().mockReturnValue(true),
    withTransaction: jest.fn(function (fn) { return fn({}); }),
    query: jest.fn()
  };
});

jest.mock('../lib/gift-card-pg', function () {
  return {
    lookup:         jest.fn().mockResolvedValue({ ok: false, error: 'not_mocked' }),
    issue:          jest.fn().mockResolvedValue({ ok: false, error: 'not_mocked' }),
    redeem:         jest.fn().mockResolvedValue({ ok: false, error: 'not_mocked' }),
    reload:         jest.fn().mockResolvedValue({ ok: false, error: 'not_mocked' }),
    adjust:         jest.fn().mockResolvedValue({ ok: false, error: 'not_mocked' }),
    voidCard:       jest.fn().mockResolvedValue({ ok: false, error: 'not_mocked' }),
    updateInvoice:  jest.fn().mockResolvedValue({ ok: false, error: 'not_mocked' }),
    nextCertNumber: jest.fn().mockResolvedValue('GC-000000')
  };
});

// ---------------------------------------------------------------------------
// Catalog fixture (tax-exempt $100 item — same convention as pos-giftcard.test.js)
// ---------------------------------------------------------------------------

var CATALOG_EXEMPT = [
  {
    item_id:        'item-gc-test',
    name:           'Gift Test Item',
    rate:           100.00,
    stock_on_hand:  10,
    tax_percentage: 0,
    tax_id:         'gc-test-exempt',   // blocks default 5% → grandTotal = $100
    custom_fields:  []
  }
];

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

describe('pos routes — gift-card store wiring (Phase 84-08, DB-03)', function () {
  var cache, zohoApi, helcimLib, axiosMock, db, giftCardPg, router, handlers;
  var ORIGINAL_NODE_ENV;

  function getHandlers() {
    jest.resetModules();
    cache      = require('../lib/cache');
    zohoApi    = require('../lib/zoho-api');
    helcimLib  = require('../lib/helcim');
    axiosMock  = require('axios');
    db         = require('../lib/db');
    giftCardPg = require('../lib/gift-card-pg');
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

  // Shared failure-surfacing status mock — any >=400 response fails the test
  // with the status code + body; a success code returns `res` itself so the
  // chained .json(...) call still routes through the test's own res.json
  // mock (matching the convention in pos-gift-card.test.js / pos-giftcard.test.js).
  function failOnErrorStatus(res, done) {
    return function (code) {
      if (code >= 400) {
        return { json: function (b) { done(new Error('Got ' + code + ': ' + JSON.stringify(b))); } };
      }
      return res;
    };
  }

  beforeEach(function () {
    getHandlers();
    ORIGINAL_NODE_ENV = process.env.NODE_ENV;
    process.env.KIOSK_CONTACT_ID                   = 'contact-walkin';
    process.env.APPS_SCRIPT_URL                    = 'https://script.example.com/exec';
    process.env.APPS_SCRIPT_SERVER_TOKEN            = 'server-token-test';
    process.env.ZOHO_GIFT_CARD_CLEARING_ACCOUNT_ID  = '109900000000873231';
    process.env.KIOSK_GIFT_CARD_ITEM_ID             = 'gc-item-server-123';
  });

  afterEach(function () {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    delete process.env.GIFT_CARDS_STORE;
    delete process.env.KIOSK_CONTACT_ID;
    delete process.env.APPS_SCRIPT_URL;
    delete process.env.APPS_SCRIPT_SERVER_TOKEN;
    delete process.env.ZOHO_GIFT_CARD_CLEARING_ACCOUNT_ID;
    delete process.env.KIOSK_GIFT_CARD_ITEM_ID;
  });

  // =========================================================================
  // Pitfall 1 — redeem + issue in ONE sale mint distinct composite tx_refs
  // =========================================================================

  test('Pitfall 1: confirm redeeming GC-000001 AND issuing GC-000002 mints two distinct composite tx_refs (postgres)', function (done) {
    process.env.GIFT_CARDS_STORE = 'postgres';
    cache.get.mockResolvedValue([]); // no catalog items — cart is the gift_cert line only
    zohoApi.zohoPost.mockImplementation(function (path) {
      if (path === '/invoices') {
        return Promise.resolve({ invoice: { invoice_id: 'inv-pf1-1', invoice_number: 'INV-PF1-001' } });
      }
      return Promise.resolve({});
    });
    helcimLib.getCardTransactionById.mockResolvedValue({ status: 'APPROVED', amount: 40.00 });

    giftCardPg.lookup.mockResolvedValue({ ok: true, data: { current_balance: 100, status: 'active' } });
    giftCardPg.redeem.mockResolvedValue({ ok: true, new_balance: 90, status: 'active' });
    giftCardPg.issue.mockImplementation(function (client, params) {
      return Promise.resolve({
        ok: true, cert_number: params.certNumber, face_value: params.faceValue,
        current_balance: params.faceValue
      });
    });
    giftCardPg.updateInvoice.mockResolvedValue({ ok: true });

    var req = {
      body: {
        items: [{ gift_cert: true, gift_action: 'issue', cert_number: 'GC-000002', rate: 50 }],
        transaction_id: 'txn-pf1-1',
        reference_number: 'KIOSK-PF1-001',
        gift_card: { cert_number: 'GC-000001', amount_applied: 10 }
      }
    };
    var res = mockRes();

    res.json.mockImplementation(function (body) {
      try {
        expect(body.ok).toBe(true);
        expect(body.gift_card_activation_failed).toBeUndefined();

        var redeemCall = giftCardPg.redeem.mock.calls[0];
        var issueCall = giftCardPg.issue.mock.calls[0];
        expect(redeemCall).toBeTruthy();
        expect(issueCall).toBeTruthy();

        expect(redeemCall[1].txRef).toBe('KIOSK-PF1-001:GC-000001:redeem');
        expect(issueCall[1].txRef).toBe('KIOSK-PF1-001:GC-000002:issue');
        expect(redeemCall[1].txRef).not.toBe(issueCall[1].txRef);
        done();
      } catch (e) { done(e); }
    });
    res.status.mockImplementation(failOnErrorStatus(res, done));

    handlers['/api/kiosk/sale/confirm'](req, res);
  });

  // =========================================================================
  // D-09 — DB outage at pre-payment lookup fails closed in production,
  // BEFORE any terminal charge; non-gift-card sales are unaffected.
  // =========================================================================

  test('D-09: db.withTransaction rejecting at pre-payment lookup -> 503 before any charge (postgres, production)', function (done) {
    process.env.GIFT_CARDS_STORE = 'postgres';
    process.env.NODE_ENV = 'production';

    // production requires idempotency_key — route the idempotency-check read
    // (falsy, so acquireIdempotencyLock proceeds to acquireLock) separately
    // from the catalog read (CATALOG_EXEMPT) on the SAME mocked cache.get.
    cache.get.mockImplementation(function (key) {
      if (key === 'test:kiosk-products') return Promise.resolve(CATALOG_EXEMPT);
      return Promise.resolve(null);
    });
    db.withTransaction.mockImplementation(function () {
      return Promise.reject(new Error('ECONNREFUSED'));
    });

    var req = {
      body: {
        items: [{ item_id: 'item-gc-test', name: 'Gift Test Item', quantity: 1 }],
        idempotency_key: 'idem-d09-1',
        gift_card: { cert_number: 'GC-000001', amount_applied: 30 }
      }
    };
    var res = mockRes();

    res.status.mockImplementation(function (code) {
      return {
        json: function (b) {
          try {
            expect(code).toBe(503);
            expect(helcimLib.terminalPurchase).not.toHaveBeenCalled();
            done();
          } catch (e) { done(e); }
        }
      };
    });
    res.json.mockImplementation(function (b) {
      done(new Error('Expected a 503 rejection, got a 2xx response: ' + JSON.stringify(b)));
    });

    handlers['/api/kiosk/sale'](req, res);
  });

  test('D-09: non-gift-card sale proceeds to terminalPurchase while the DB is down (postgres)', function (done) {
    process.env.GIFT_CARDS_STORE = 'postgres';
    cache.get.mockResolvedValue(CATALOG_EXEMPT);
    db.withTransaction.mockImplementation(function () {
      return Promise.reject(new Error('ECONNREFUSED'));
    });

    var req = {
      body: {
        items: [{ item_id: 'item-gc-test', name: 'Gift Test Item', quantity: 1 }]
        // no gift_card field — the lookup must never run
      }
    };
    var res = mockRes();

    res.json.mockImplementation(function (body) {
      try {
        expect(body.pending).toBe(true);
        var termCall = helcimLib.terminalPurchase.mock.calls[0];
        expect(termCall).toBeTruthy();
        expect(termCall[0]).toBeCloseTo(100, 2); // full grandTotal — no gift card involved
        done();
      } catch (e) { done(e); }
    });
    res.status.mockImplementation(failOnErrorStatus(res, done));

    handlers['/api/kiosk/sale'](req, res);
  });

  // =========================================================================
  // D-11 — post-charge infra failure writes a durable pending record;
  // a business rejection does NOT.
  // =========================================================================

  test('D-11: post-charge redeem infra failure -> gift_card_activation_failed + durable giftcard:pending record', function (done) {
    process.env.GIFT_CARDS_STORE = 'postgres';
    cache.get.mockResolvedValue(CATALOG_EXEMPT);
    zohoApi.zohoPost.mockImplementation(function (path) {
      if (path === '/invoices') {
        return Promise.resolve({ invoice: { invoice_id: 'inv-d11-1', invoice_number: 'INV-D11-001' } });
      }
      return Promise.resolve({});
    });
    helcimLib.getCardTransactionById.mockResolvedValue({ status: 'APPROVED', amount: 90.00 });

    giftCardPg.lookup.mockResolvedValue({ ok: true, data: { current_balance: 100, status: 'active' } });
    giftCardPg.redeem.mockImplementation(function () {
      return Promise.reject(new Error('ECONNREFUSED'));
    });

    var req = {
      body: {
        items: [{ item_id: 'item-gc-test', name: 'Gift Test Item', quantity: 1 }],
        transaction_id: 'txn-d11-1',
        reference_number: 'KIOSK-D11-001',
        gift_card: { cert_number: 'GC-000001', amount_applied: 10 }
      }
    };
    var res = mockRes();

    res.json.mockImplementation(function (body) {
      try {
        expect(body.ok).toBe(true);
        expect(body.gift_card_activation_failed).toBe(true);

        var pendingCall = cache.set.mock.calls.find(function (c) {
          return typeof c[0] === 'string' && c[0].indexOf('giftcard:pending:') === 0;
        });
        expect(pendingCall).toBeTruthy();
        expect(pendingCall[0]).toBe('giftcard:pending:KIOSK-D11-001:GC-000001:redeem');
        done();
      } catch (e) { done(e); }
    });
    res.status.mockImplementation(failOnErrorStatus(res, done));

    handlers['/api/kiosk/sale/confirm'](req, res);
  });

  test('business rejection (insufficient_balance) -> gift_card_activation_failed but NO durable pending record', function (done) {
    process.env.GIFT_CARDS_STORE = 'postgres';
    cache.get.mockResolvedValue(CATALOG_EXEMPT);
    zohoApi.zohoPost.mockImplementation(function (path) {
      if (path === '/invoices') {
        return Promise.resolve({ invoice: { invoice_id: 'inv-biz-1', invoice_number: 'INV-BIZ-001' } });
      }
      return Promise.resolve({});
    });
    helcimLib.getCardTransactionById.mockResolvedValue({ status: 'APPROVED', amount: 90.00 });

    giftCardPg.lookup.mockResolvedValue({ ok: true, data: { current_balance: 100, status: 'active' } });
    giftCardPg.redeem.mockResolvedValue({ ok: false, error: 'insufficient_balance' });

    var req = {
      body: {
        items: [{ item_id: 'item-gc-test', name: 'Gift Test Item', quantity: 1 }],
        transaction_id: 'txn-biz-1',
        reference_number: 'KIOSK-BIZ-001',
        gift_card: { cert_number: 'GC-000001', amount_applied: 10 }
      }
    };
    var res = mockRes();

    res.json.mockImplementation(function (body) {
      try {
        expect(body.ok).toBe(true);
        expect(body.gift_card_activation_failed).toBe(true);

        var pendingCall = cache.set.mock.calls.find(function (c) {
          return typeof c[0] === 'string' && c[0].indexOf('giftcard:pending:') === 0;
        });
        expect(pendingCall).toBeFalsy();
        done();
      } catch (e) { done(e); }
    });
    res.status.mockImplementation(failOnErrorStatus(res, done));

    handlers['/api/kiosk/sale/confirm'](req, res);
  });

  // =========================================================================
  // Attribution — every Postgres gift-card write records an actor
  // =========================================================================

  test('actor passed to gift-card-pg starts with the kiosk-sale: prefix', function (done) {
    process.env.GIFT_CARDS_STORE = 'postgres';
    cache.get.mockResolvedValue(CATALOG_EXEMPT);
    zohoApi.zohoPost.mockImplementation(function (path) {
      if (path === '/invoices') {
        return Promise.resolve({ invoice: { invoice_id: 'inv-actor-1', invoice_number: 'INV-ACTOR-001' } });
      }
      return Promise.resolve({});
    });
    helcimLib.getCardTransactionById.mockResolvedValue({ status: 'APPROVED', amount: 90.00 });

    giftCardPg.lookup.mockResolvedValue({ ok: true, data: { current_balance: 100, status: 'active' } });
    giftCardPg.redeem.mockResolvedValue({ ok: true, new_balance: 90, status: 'active' });

    var req = {
      body: {
        items: [{ item_id: 'item-gc-test', name: 'Gift Test Item', quantity: 1 }],
        transaction_id: 'txn-actor-1',
        reference_number: 'KIOSK-ACTOR-001',
        gift_card: { cert_number: 'GC-000001', amount_applied: 10 }
      }
    };
    var res = mockRes();

    res.json.mockImplementation(function (body) {
      try {
        expect(body.ok).toBe(true);
        var redeemCall = giftCardPg.redeem.mock.calls[0];
        expect(redeemCall).toBeTruthy();
        expect(redeemCall[1].actor).toMatch(/^kiosk-sale:/);
        done();
      } catch (e) { done(e); }
    });
    res.status.mockImplementation(failOnErrorStatus(res, done));

    handlers['/api/kiosk/sale/confirm'](req, res);
  });

  // =========================================================================
  // Sheets parity — GIFT_CARDS_STORE unset reproduces today's Apps Script
  // call shape exactly (transaction_ref === the raw refNumber, not a
  // composite tx_ref).
  // =========================================================================

  test('sheets parity: GIFT_CARDS_STORE unset -> redeem_gift_card transaction_ref === refNumber', function (done) {
    // GIFT_CARDS_STORE intentionally left unset — defaults to 'sheets'.
    cache.get.mockResolvedValue(CATALOG_EXEMPT);
    zohoApi.zohoPost.mockImplementation(function (path) {
      if (path === '/invoices') {
        return Promise.resolve({ invoice: { invoice_id: 'inv-sheets-1', invoice_number: 'INV-SHEETS-001' } });
      }
      return Promise.resolve({});
    });
    axiosMock.post.mockImplementation(function (url, body) {
      var parsed = (typeof body === 'string') ? JSON.parse(body) : body;
      if (parsed.action === 'lookup_gift_card') {
        return Promise.resolve({ data: { ok: true, data: { current_balance: 100 } } });
      }
      return Promise.resolve({ data: { ok: true } });
    });
    helcimLib.getCardTransactionById.mockResolvedValue({ status: 'APPROVED', amount: 90.00 });

    var req = {
      body: {
        items: [{ item_id: 'item-gc-test', name: 'Gift Test Item', quantity: 1 }],
        transaction_id: 'txn-sheets-1',
        reference_number: 'KIOSK-SHEETS-001',
        gift_card: { cert_number: 'GC-000001', amount_applied: 10 }
      }
    };
    var res = mockRes();

    res.json.mockImplementation(function (body) {
      try {
        expect(body.ok).toBe(true);

        var redeemCall = axiosMock.post.mock.calls.find(function (c) {
          var parsed = (typeof c[1] === 'string') ? JSON.parse(c[1]) : c[1];
          return parsed && parsed.action === 'redeem_gift_card';
        });
        expect(redeemCall).toBeTruthy();
        var parsedBody = (typeof redeemCall[1] === 'string') ? JSON.parse(redeemCall[1]) : redeemCall[1];
        expect(parsedBody.transaction_ref).toBe('KIOSK-SHEETS-001');

        // Never touches Postgres in sheets mode.
        expect(db.withTransaction).not.toHaveBeenCalled();
        done();
      } catch (e) { done(e); }
    });
    res.status.mockImplementation(failOnErrorStatus(res, done));

    handlers['/api/kiosk/sale/confirm'](req, res);
  });
});
