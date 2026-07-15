'use strict';

// ---------------------------------------------------------------------------
// pos-sale-autoreconcile.test.js — 57-04 (server safety net for the
// "refresh to sell" kiosk error, 57-DIAGNOSIS variant 1)
//
// Today, a catalog-miss on POST /api/kiosk/sale hard-rejects with:
//   "Item not found in current catalog: <id>. Refresh the product list and
//   try again." — even when the item is STILL CURRENT in Zoho and only
//   missing from the middleware's stale KIOSK_PRODUCTS_CACHE_KEY cache.
//
// This suite proves the bounded server auto-reconcile: on a catalog-miss the
// server forces ONE rebuild (reusing routes/catalog.js's rebuildKioskCatalog,
// the exact same rebuild the manual `?bust=1` refresh triggers) and re-checks
// before rejecting:
//   Test A — a current-but-uncached item self-heals (no 400).
//   Test B — a genuinely phantom item (absent even after rebuild) still 400s.
//   Test C — the rebuild fires AT MOST ONCE per sale attempt (no hot loop).
//   Test D — even on self-heal, the CATALOG rate is charged, never the
//            client-supplied rate (price-anchoring, T-57-04-01).
//
// Harness mirrors pos-custom-line.test.js (express/helcim/zoho-api/cache/etc
// mocked so router.post registers a handler we invoke directly). Additionally
// mocks ../routes/catalog so rebuildKioskCatalog() is a deterministic,
// independently-assertable jest.fn() rather than exercising the real
// Zoho-refetch implementation.
// ---------------------------------------------------------------------------

jest.mock('express', function () {
  var router = { get: jest.fn(), post: jest.fn(), put: jest.fn() };
  var express = function () {};
  express.Router = function () { return router; };
  return express;
});
jest.mock('../lib/helcim', function () {
  return {
    isTerminalEnabled: jest.fn().mockReturnValue(true),
    isEnabled: jest.fn().mockReturnValue(true),
    terminalPurchase: jest.fn().mockResolvedValue({ idempotencyKey: 'idem-1' }),
    pollTerminalResult: jest.fn().mockResolvedValue({
      approved: true,
      transactionId: 'txn-test-123',
      authorizationCode: 'AUTH1',
      cardType: 'Visa'
    }),
    voidTransaction: jest.fn().mockResolvedValue({}),
    getTerminalDiagnostics: jest.fn().mockReturnValue({}),
    generateIdempotencyKey: jest.fn().mockReturnValue('idem-so-1')
  };
});
jest.mock('../lib/zoho-api', function () {
  return {
    zohoGet: jest.fn(),
    zohoPost: jest.fn().mockResolvedValue({ invoice: { invoice_id: 'inv-1', invoice_number: 'INV-001' } }),
    zohoPut: jest.fn()
  };
});
jest.mock('../lib/cache', function () {
  return {
    get: jest.fn(),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    releaseLock: jest.fn().mockResolvedValue()
  };
});
jest.mock('../lib/logger', function () {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
});
jest.mock('../lib/eventLog', function () { return { logEvent: jest.fn() }; });
jest.mock('../lib/mailer', function () { return { sendVoidFailureAlert: jest.fn() }; });
jest.mock('../lib/inventory-ledger', function () {
  return {
    decrementStock: jest.fn().mockResolvedValue({}),
    reconcileFromZoho: jest.fn(),
    reconcile: jest.fn().mockResolvedValue(),
    overlayStock: jest.fn(function (items) { return Promise.resolve(items); })
  };
});
jest.mock('../lib/constants', function () {
  return {
    CACHE_KEYS: {
      KIOSK_PRODUCTS: 'test:kiosk-products',
      RECENT_ORDERS: 'test:recent-orders',
      KIOSK_IDEM_PREFIX: 'test:idem:',
      KIOSK_SALESORDERS: 'test:kiosk-salesorders',
      KIOSK_DISCOUNT_PRESETS: 'test:kiosk-discount-presets',
      CONSIGNMENT_REPORT_PREFIX: 'test:consignment:report:',
      KIOSK_PENDING_CHARGE_PREFIX: 'test:kiosk:pending-charge:'
    },
    LEDGER_KEYS: {},
    RATE_LIMIT_PREFIX: 'test:rl:'
  };
});
// 57-04: routes/pos.js requires routes/catalog.js directly (no cycle — catalog.js
// never requires pos.js) so BOTH the manual ?bust=1 refresh and the sale-time
// auto-reconcile share ONE rebuild implementation. Mock it here so the rebuild
// outcome + call count are deterministic and independently assertable.
jest.mock('../routes/catalog', function () {
  return { rebuildKioskCatalog: jest.fn() };
});

// ---------------------------------------------------------------------------
// Catalog fixtures
// ---------------------------------------------------------------------------

var ITEM_X = '1099000000000109999'; // current in Zoho, just missing from the STALE cache
var ITEM_Y = '1099000000000000001'; // phantom — absent even after rebuild
var ITEM_Z = '1099000000000000002'; // second phantom (Test C: two misses, one rebuild)

var STALE_CATALOG_MISSING_X = []; // simulates a stale cache that doesn't have ITEM_X yet
var FRESH_CATALOG_WITH_X = [
  { item_id: ITEM_X, name: 'Current Item X', sku: 'SKU-X', rate: 42, stock_on_hand: 5, custom_fields: [] }
];

// ---------------------------------------------------------------------------
// Test harness (mirrors pos-custom-line.test.js)
// ---------------------------------------------------------------------------

describe('pos routes — sale-time catalog auto-reconcile (57-04)', function () {
  var cache, helcimLib, catalogRoutes, handlers;

  function getHandlers() {
    jest.resetModules();
    cache = require('../lib/cache');
    helcimLib = require('../lib/helcim');
    catalogRoutes = require('../routes/catalog');
    require('../routes/pos');
    var router = require('express').Router();
    handlers = {};
    router.post.mock.calls.forEach(function (call) {
      handlers[call[0]] = call[call.length - 1];
    });
    router.get.mock.calls.forEach(function (call) {
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
  });

  test('Test A: self-heal — current-but-uncached item does not 400 after auto-reconcile', function (done) {
    cache.get.mockResolvedValue(STALE_CATALOG_MISSING_X);
    catalogRoutes.rebuildKioskCatalog.mockResolvedValue(FRESH_CATALOG_WITH_X);

    var req = { body: { items: [{ item_id: ITEM_X, name: 'Current Item X', quantity: 1 }] } };
    var res = mockRes();

    res.json.mockImplementation(function (body) {
      try {
        expect(body.pending).toBe(true);
        expect(catalogRoutes.rebuildKioskCatalog).toHaveBeenCalledTimes(1);
        done();
      } catch (e) { done(e); }
    });
    res.status.mockImplementation(function (code) {
      if (code >= 400) {
        return { json: function (body) { done(new Error('Got status ' + code + ': ' + JSON.stringify(body))); } };
      }
      return res;
    });

    handlers['/api/kiosk/sale'](req, res);
  });

  test('Test B: phantom still rejects — absent even after rebuild returns 400', function (done) {
    cache.get.mockResolvedValue(STALE_CATALOG_MISSING_X);
    // Rebuild result STILL does not contain ITEM_Y — a genuinely-invalid item.
    catalogRoutes.rebuildKioskCatalog.mockResolvedValue(STALE_CATALOG_MISSING_X);

    var req = { body: { items: [{ item_id: ITEM_Y, name: 'Phantom Item Y', quantity: 1 }] } };
    var res = mockRes();
    var statusCode = null;

    res.status.mockImplementation(function (code) {
      statusCode = code;
      return {
        json: function (body) {
          try {
            expect(statusCode).toBe(400);
            expect(body.error).toContain('Item not found in current catalog: ' + ITEM_Y);
            done();
          } catch (e) { done(e); }
        }
      };
    });
    res.json.mockImplementation(function () {
      done(new Error('Expected a 400 for a phantom item still absent after rebuild'));
    });

    handlers['/api/kiosk/sale'](req, res);
  });

  test('Test C: bounded — rebuildKioskCatalog is invoked AT MOST ONCE per sale attempt', function (done) {
    cache.get.mockResolvedValue(STALE_CATALOG_MISSING_X);
    // Two DIFFERENT missing items in the same cart — the loop would otherwise
    // be tempted to rebuild once per miss. Rebuild result is still missing both.
    catalogRoutes.rebuildKioskCatalog.mockResolvedValue(STALE_CATALOG_MISSING_X);

    var req = {
      body: {
        items: [
          { item_id: ITEM_Y, name: 'Phantom Y', quantity: 1 },
          { item_id: ITEM_Z, name: 'Phantom Z', quantity: 1 }
        ]
      }
    };
    var res = mockRes();

    res.status.mockImplementation(function (code) {
      return {
        json: function () {
          try {
            expect(catalogRoutes.rebuildKioskCatalog).toHaveBeenCalledTimes(1);
            done();
          } catch (e) { done(e); }
        }
      };
    });
    res.json.mockImplementation(function () {
      done(new Error('Expected a 400 status response (both items are phantom)'));
    });

    handlers['/api/kiosk/sale'](req, res);
  });

  test('Test D: rate never trusted — self-heal still charges the CATALOG rate, not the client rate', function (done) {
    cache.get.mockResolvedValue(STALE_CATALOG_MISSING_X);
    catalogRoutes.rebuildKioskCatalog.mockResolvedValue(FRESH_CATALOG_WITH_X);

    var req = {
      body: {
        // Client attempts to smuggle a bogus rate — must be ignored even on self-heal.
        items: [{ item_id: ITEM_X, name: 'Current Item X', quantity: 1, rate: 999999 }]
      }
    };
    var res = mockRes();

    res.json.mockImplementation(function (body) {
      try {
        expect(body.pending).toBe(true);
        var termCall = helcimLib.terminalPurchase.mock.calls[0];
        // FRESH_CATALOG_WITH_X.rate = 42, no tax fields => grandTotal = 42
        expect(termCall[0]).toBe(42);
        done();
      } catch (e) { done(e); }
    });
    res.status.mockImplementation(function (code) {
      if (code >= 400) {
        return { json: function (body) { done(new Error('Got status ' + code + ': ' + JSON.stringify(body))); } };
      }
      return res;
    });

    handlers['/api/kiosk/sale'](req, res);
  });

  test('rebuild call failure falls back to the original 400 (does not crash / hang)', function (done) {
    cache.get.mockResolvedValue(STALE_CATALOG_MISSING_X);
    catalogRoutes.rebuildKioskCatalog.mockRejectedValue(new Error('Zoho unreachable'));

    var req = { body: { items: [{ item_id: ITEM_X, name: 'Current Item X', quantity: 1 }] } };
    var res = mockRes();
    var statusCode = null;

    res.status.mockImplementation(function (code) {
      statusCode = code;
      return {
        json: function (body) {
          try {
            expect(statusCode).toBe(400);
            expect(body.error).toContain('Item not found in current catalog: ' + ITEM_X);
            done();
          } catch (e) { done(e); }
        }
      };
    });
    res.json.mockImplementation(function () {
      done(new Error('Expected a 400 when the rebuild call itself fails'));
    });

    handlers['/api/kiosk/sale'](req, res);
  });
});
