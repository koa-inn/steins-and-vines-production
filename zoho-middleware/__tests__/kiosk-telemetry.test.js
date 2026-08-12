'use strict';

/**
 * kiosk-telemetry.test.js — Regression tests for Phase 68-01 (kiosk terminal-push
 * latency instrumentation).
 *
 * (a) A normal /api/kiosk/sale call emits kiosk.sale_stage_timing events for at
 *     least the catalog-read stage (cache HIT vs rebuild) and the terminal-push
 *     stage — observation only, no control-flow change (pos-money-defects.test.js
 *     WR-03/F2 must stay green as the money-path-unchanged proof).
 * (b) A NEW /api/kiosk/telemetry sink route accepts a bounded client latency
 *     payload and emits kiosk.terminal_push_latency — mirrors, but does NOT
 *     overload, the pinned /api/kiosk/client-error beacon.
 *
 * RED phase: both describe blocks FAIL before the pos.js changes.
 * GREEN phase: both PASS after.
 */

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
    terminalPurchase: jest.fn().mockResolvedValue({ idempotencyKey: 'idem-tel-1' }),
    pollTerminalResult: jest.fn().mockResolvedValue({
      approved: true, transactionId: 'txn-tel-123', authorizationCode: 'AUTH1', cardType: 'Visa'
    }),
    voidTransaction: jest.fn().mockResolvedValue({}),
    getTerminalDiagnostics: jest.fn().mockReturnValue({}),
    generateIdempotencyKey: jest.fn().mockReturnValue('idem-tel-so-1'),
    cancelTerminal: jest.fn().mockResolvedValue({})
  };
});

jest.mock('../lib/zoho-api', function () {
  return {
    zohoGet: jest.fn(),
    zohoPost: jest.fn().mockResolvedValue({ invoice: { invoice_id: 'inv-tel-1', invoice_number: 'INV-TEL-001' } }),
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
      return helcimLike.voidTransaction(txnId).then(function () {}).catch(function () {});
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

var CATALOG_HIT = [
  {
    item_id:        'item-tel-1',
    name:           'Test Telemetry Item',
    rate:           50.00,
    stock_on_hand:  10,
    tax_percentage: 0,
    tax_id:         'exempt-tax',
    custom_fields:  []
  }
];

var cache, helcimLib, zohoApi, moneyPath, eventLog, router, handlers;

function getPosHandlers() {
  jest.resetModules();
  cache      = require('../lib/cache');
  helcimLib  = require('../lib/helcim');
  zohoApi    = require('../lib/zoho-api');
  moneyPath  = require('../lib/money-path');
  eventLog   = require('../lib/eventLog');
  require('../routes/pos');
  router   = require('express').Router();
  handlers = {};
  router.post.mock.calls.forEach(function (call) { handlers[call[0]] = call[call.length - 1]; });
  router.get.mock.calls.forEach(function (call) { handlers[call[0]] = call[call.length - 1]; });
}

function mockRes() {
  var r = { json: jest.fn(), status: jest.fn(), end: jest.fn(), headersSent: false };
  r.status.mockReturnValue(r);
  r.end.mockReturnValue(r);
  return r;
}

function captureStatus(res) {
  var captured = { code: null };
  res.status.mockImplementation(function (code) { captured.code = code; return res; });
  return captured;
}

describe('68-01 — server stage-timing telemetry on /api/kiosk/sale', function () {
  beforeEach(function () {
    getPosHandlers();
    process.env.KIOSK_CONTACT_ID = 'contact-walkin';
    cache.get.mockImplementation(function (key) {
      if (key === 'test:kiosk-products') return Promise.resolve(CATALOG_HIT);
      return Promise.resolve(null);
    });
    moneyPath.acquireIdempotencyLock.mockResolvedValue({ status: 'acquired' });
  });

  afterEach(function () {
    delete process.env.KIOSK_CONTACT_ID;
  });

  test('a normal sale emits kiosk.sale_stage_timing for the catalog and terminal-push stages, catalog stage carries cache hit/rebuild', function (done) {
    var req = {
      body: {
        items: [{ item_id: 'item-tel-1', name: 'Test Telemetry Item', quantity: 1 }],
        idempotency_key: 'idem-tel-normal-001'
      }
    };
    var res = mockRes();
    res.json.mockImplementation(function () {
      try {
        var stageEvents = eventLog.logEvent.mock.calls.filter(function (c) {
          return c[0] === 'kiosk.sale_stage_timing';
        });
        expect(stageEvents.length).toBeGreaterThan(0);

        var catalogEvent = stageEvents.find(function (c) {
          return c[1] && c[1].stage && String(c[1].stage).indexOf('catalog') !== -1;
        });
        expect(catalogEvent).toBeTruthy();
        // catalog stage must distinguish cache HIT vs rebuild (boolean/enum field)
        var cacheField = catalogEvent[1].cache;
        expect(['hit', 'rebuild']).toContain(cacheField);
        expect(cacheField).toBe('hit'); // this fixture is a warm cache

        var terminalPushEvent = stageEvents.find(function (c) {
          return c[1] && c[1].stage && String(c[1].stage).indexOf('terminal_push') !== -1;
        });
        expect(terminalPushEvent).toBeTruthy();

        // Every stage-timing event carries a millisecond delta (observation-only,
        // never PII — T-68-01-1).
        stageEvents.forEach(function (c) {
          expect(typeof c[1].ms_since_start).toBe('number');
        });

        done();
      } catch (e) { done(e); }
    });
    handlers['/api/kiosk/sale'](req, res);
  });
});

describe('68-01 — /api/kiosk/telemetry sink route (client push-latency beacon)', function () {
  beforeEach(function () {
    getPosHandlers();
  });

  test('a valid payload emits kiosk.terminal_push_latency and returns a 2xx no-side-effect response', function () {
    expect(handlers['/api/kiosk/telemetry']).toBeInstanceOf(Function);

    var req = {
      body: {
        stage: 'push_to_202',
        duration_ms: 2450,
        reference_number: 'KIOSK-TEL-001'
      }
    };
    var res = mockRes();
    var statusCapture = captureStatus(res);

    handlers['/api/kiosk/telemetry'](req, res);

    expect(statusCapture.code).toBeGreaterThanOrEqual(200);
    expect(statusCapture.code).toBeLessThan(300);

    var latencyEvents = eventLog.logEvent.mock.calls.filter(function (c) {
      return c[0] === 'kiosk.terminal_push_latency';
    });
    expect(latencyEvents.length).toBe(1);
    expect(latencyEvents[0][1].duration_ms).toBe(2450);
    expect(latencyEvents[0][1].reference_number).toBe('KIOSK-TEL-001');

    // No side effects: no Zoho / Helcim / cache write triggered by the sink.
    expect(zohoApi.zohoPost).not.toHaveBeenCalled();
    expect(helcimLib.terminalPurchase).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
  });

  test('a non-numeric duration_ms is rejected/ignored without throwing, and no event is emitted', function () {
    expect(handlers['/api/kiosk/telemetry']).toBeInstanceOf(Function);

    var req = {
      body: {
        stage: 'push_to_202',
        duration_ms: 'not-a-number',
        reference_number: 'KIOSK-TEL-002'
      }
    };
    var res = mockRes();
    var statusCapture = captureStatus(res);

    expect(function () {
      handlers['/api/kiosk/telemetry'](req, res);
    }).not.toThrow();

    expect(statusCapture.code).not.toBe(500);

    var latencyEvents = eventLog.logEvent.mock.calls.filter(function (c) {
      return c[0] === 'kiosk.terminal_push_latency';
    });
    expect(latencyEvents.length).toBe(0);
  });
});
