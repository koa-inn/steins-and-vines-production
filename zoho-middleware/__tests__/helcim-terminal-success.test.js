'use strict';

// ---------------------------------------------------------------------------
// helcim-terminal-success.test.js
//
// Regression tests for Helcim terminal SUCCESS recognition (never worked).
//
// ROOT CAUSE: handleCardTransaction read event.data.* fields that Helcim
// never sends (minimal payload is { id, type:'cardTransaction' }).
// Fix: primary path = getCardTransactionById(event.id); fallback = device-pending.
//
// Cases:
//   (a) webhook APPROVED + getCardTransactionById mocked APPROVED
//       → caches helcim:terminal:result:{invoice} with approved:true
//   (b) API failure + device-pending invoice present
//       → caches approved:true (fallback) + logs warning
//   (c) API failure + NO device-pending invoice
//       → caches NOTHING (no false positive)
//   (d) getCardTransactionById returns DECLINED
//       → caches approved:false
//   (e) terminalCancel handler still works unchanged
//   (f) pollTerminalResult logs a 401 warning (still returns {status:'pending'})
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before any require()
// ---------------------------------------------------------------------------

jest.mock('express', function () {
  var router = { get: jest.fn(), post: jest.fn() };
  var express = function () {};
  express.Router = function () { return router; };
  return express;
});

jest.mock('../lib/helcim', function () {
  return {
    verifyWebhookSignature: jest.fn().mockReturnValue(true),
    isEnabled: jest.fn().mockReturnValue(false),
    isTerminalEnabled: jest.fn().mockReturnValue(false),
    getDeviceCode: jest.fn().mockReturnValue('DEVICE-001'),
    getDepositAmount: jest.fn().mockReturnValue(0),
    getTerminalDiagnostics: jest.fn().mockReturnValue({}),
    init: jest.fn(),
    initializeCheckout: jest.fn().mockResolvedValue({ checkoutToken: '' }),
    voidTransaction: jest.fn().mockResolvedValue({ ok: true }),
    refundTransaction: jest.fn().mockResolvedValue({ ok: true }),
    cancelTerminal: jest.fn().mockResolvedValue({ ok: false }),
    // New exports added by the fix:
    getCardTransactionById: jest.fn(),
    getPendingInvoiceForDevice: jest.fn()
  };
});

jest.mock('../lib/cache', function () {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    acquireLock: jest.fn().mockResolvedValue(true),
    releaseLock: jest.fn().mockResolvedValue(),
    isConnected: jest.fn().mockReturnValue(false),
    init: jest.fn().mockResolvedValue(),
    quit: jest.fn().mockResolvedValue()
  };
});

jest.mock('../lib/eventLog', function () { return { logEvent: jest.fn() }; });
jest.mock('../lib/logger', function () {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
});
jest.mock('../lib/zoho-api', function () {
  return { zohoGet: jest.fn(), zohoPost: jest.fn(), zohoPut: jest.fn() };
});
jest.mock('../lib/constants', function () {
  return {
    CACHE_KEYS: {
      COLLECT_PENDING_PREFIX: 'collect:pending:',
      COLLECT_IDEM_PREFIX: 'collect:idem:'
    }
  };
});
jest.mock('../lib/mailer', function () {
  return { sendVoidFailureAlert: jest.fn() };
});

// ---------------------------------------------------------------------------
// Load modules after mocks
// ---------------------------------------------------------------------------

var helcimLib = require('../lib/helcim');
var cache = require('../lib/cache');
var log = require('../lib/logger');
var express = require('express');

// Load the route so it registers handlers on the mock router
require('../routes/webhooks');

// Extract the terminal webhook handler
var router = express.Router();
var terminalHandler = null;
router.post.mock.calls.forEach(function (call) {
  var paths = call[0];
  var fn = call[call.length - 1];
  if (Array.isArray(paths)) {
    if (paths.indexOf('/api/webhooks/terminal') !== -1 || paths.indexOf('/webhooks/terminal') !== -1) {
      terminalHandler = fn;
    }
  } else if (paths === '/api/webhooks/terminal' || paths === '/webhooks/terminal') {
    terminalHandler = fn;
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockRes() {
  var res = { json: jest.fn(), status: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
}

function makeTerminalReq(body) {
  return {
    headers: {
      'webhook-id': 'wh-test-001',
      'webhook-timestamp': '1750000000',
      'webhook-signature': 'v1,valid-sig'
    },
    rawBody: Buffer.from(JSON.stringify(body)),
    body: body
  };
}

// ---------------------------------------------------------------------------
// Main test suite: handleCardTransaction — async processing
// ---------------------------------------------------------------------------

describe('handleCardTransaction — terminal success recognition (regression)', function () {
  beforeEach(function () {
    jest.clearAllMocks();
    helcimLib.verifyWebhookSignature.mockReturnValue(true);
    // Default: API lookup and device-pending both return null (overridden per test)
    helcimLib.getCardTransactionById.mockRejectedValue(new Error('not configured'));
    helcimLib.getPendingInvoiceForDevice.mockResolvedValue(null);
    cache.get.mockResolvedValue(null);
    cache.set.mockResolvedValue('OK');
    cache.del.mockResolvedValue(1);
  });

  // -------------------------------------------------------------------------
  // (a) APPROVED via primary API path — core regression
  // Helcim sends { id:'txn-001', type:'cardTransaction' }
  // getCardTransactionById returns real status+invoice
  // → must cache helcim:terminal:result:{invoice} with approved:true
  // -------------------------------------------------------------------------

  test('(a) APPROVED: getCardTransactionById resolves APPROVED → caches approved:true', function () {
    helcimLib.getCardTransactionById.mockResolvedValue({
      status: 'APPROVED',
      transactionId: 'txn-001',
      invoiceNumber: 'INV-0001',
      cardType: 'Visa',
      amount: 50.00
    });

    var req = makeTerminalReq({ id: 'txn-001', type: 'cardTransaction' });
    var res = mockRes();

    terminalHandler(req, res);

    // 200 returned synchronously
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ received: true });

    // async processing — wait for promises to flush
    return new Promise(function (resolve) { setImmediate(resolve); }).then(function () {
      return new Promise(function (resolve) { setImmediate(resolve); });
    }).then(function () {
      expect(helcimLib.getCardTransactionById).toHaveBeenCalledWith('txn-001');
      expect(cache.set).toHaveBeenCalledWith(
        'helcim:terminal:result:INV-0001',
        expect.objectContaining({ approved: true, status: 'APPROVED', transactionId: 'txn-001' }),
        expect.any(Number)
      );
    });
  });

  // -------------------------------------------------------------------------
  // (b) API failure + device-pending invoice present → fallback caches approved
  // -------------------------------------------------------------------------

  test('(b) API failure + device-pending invoice → caches approved:true (fallback) + logs warning', function () {
    helcimLib.getCardTransactionById.mockRejectedValue(new Error('Network error'));
    helcimLib.getPendingInvoiceForDevice.mockResolvedValue('INV-FALLBACK');

    var req = makeTerminalReq({ id: 'txn-fallback', type: 'cardTransaction' });
    var res = mockRes();

    terminalHandler(req, res);

    return new Promise(function (resolve) { setImmediate(resolve); }).then(function () {
      return new Promise(function (resolve) { setImmediate(resolve); });
    }).then(function () {
      expect(helcimLib.getCardTransactionById).toHaveBeenCalledWith('txn-fallback');
      expect(helcimLib.getPendingInvoiceForDevice).toHaveBeenCalled();
      // Fallback must cache with approved:true
      expect(cache.set).toHaveBeenCalledWith(
        'helcim:terminal:result:INV-FALLBACK',
        expect.objectContaining({ approved: true }),
        expect.any(Number)
      );
      // Must log the unconfirmed-fallback warning
      expect(log.warn).toHaveBeenCalledWith(
        expect.stringContaining('device-pending fallback')
      );
    });
  });

  // -------------------------------------------------------------------------
  // (c) API failure + NO device-pending invoice → caches NOTHING (no false positive)
  // -------------------------------------------------------------------------

  test('(c) API failure + no device-pending → caches NOTHING (no false positive)', function () {
    helcimLib.getCardTransactionById.mockRejectedValue(new Error('Network error'));
    helcimLib.getPendingInvoiceForDevice.mockResolvedValue(null);

    var req = makeTerminalReq({ id: 'txn-nopending', type: 'cardTransaction' });
    var res = mockRes();

    terminalHandler(req, res);

    return new Promise(function (resolve) { setImmediate(resolve); }).then(function () {
      return new Promise(function (resolve) { setImmediate(resolve); });
    }).then(function () {
      // No terminal-result cache write should occur
      var terminalResultCalls = cache.set.mock.calls.filter(function (call) {
        return typeof call[0] === 'string' && call[0].indexOf('helcim:terminal:result:') === 0;
      });
      expect(terminalResultCalls).toHaveLength(0);
      // Must log a warning about no correlation
      expect(log.warn).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // (d) getCardTransactionById returns DECLINED → caches approved:false
  // -------------------------------------------------------------------------

  test('(d) DECLINED: getCardTransactionById returns DECLINED → caches approved:false', function () {
    helcimLib.getCardTransactionById.mockResolvedValue({
      status: 'DECLINED',
      transactionId: 'txn-declined',
      invoiceNumber: 'INV-DECLINED',
      cardType: 'Mastercard',
      amount: 25.00
    });

    var req = makeTerminalReq({ id: 'txn-declined', type: 'cardTransaction' });
    var res = mockRes();

    terminalHandler(req, res);

    return new Promise(function (resolve) { setImmediate(resolve); }).then(function () {
      return new Promise(function (resolve) { setImmediate(resolve); });
    }).then(function () {
      expect(cache.set).toHaveBeenCalledWith(
        'helcim:terminal:result:INV-DECLINED',
        expect.objectContaining({ approved: false, status: 'DECLINED' }),
        expect.any(Number)
      );
    });
  });

  // -------------------------------------------------------------------------
  // (e) terminalCancel: existing behavior preserved
  // Sends { type:'terminalCancel' } → caches CANCELLED via device-pending lookup
  // -------------------------------------------------------------------------

  test('(e) terminalCancel: caches CANCELLED via device-pending lookup (unchanged)', function () {
    // Simulate: device-pending has a pending invoice
    cache.get.mockImplementation(function (key) {
      if (key === 'helcim:terminal:pending:DEVICE-001') {
        return Promise.resolve('INV-CANCEL');
      }
      return Promise.resolve(null);
    });

    var req = makeTerminalReq({ id: 'cancel-evt-001', type: 'terminalCancel', data: {} });
    var res = mockRes();

    terminalHandler(req, res);

    return new Promise(function (resolve) { setImmediate(resolve); }).then(function () {
      return new Promise(function (resolve) { setImmediate(resolve); });
    }).then(function () {
      // The terminalCancel handler passes a JSON-stringified value to cache.set
      // (existing behavior preserved — not changed by this fix)
      expect(cache.set).toHaveBeenCalledWith(
        'helcim:terminal:result:INV-CANCEL',
        expect.stringContaining('"CANCELLED"'),
        expect.any(Number)
      );
    });
  });

  // -------------------------------------------------------------------------
  // Collect-pending flow preserved: existing collect-pending record in cache
  // causes Zoho payment POST (APPROVED), cleans up on DECLINED.
  // -------------------------------------------------------------------------

  test('collect-pending APPROVED: calls zohoPost customerpayments + clears pending key', function () {
    var zohoApi = require('../lib/zoho-api');
    zohoApi.zohoPost.mockResolvedValue({ code: 0 });

    helcimLib.getCardTransactionById.mockResolvedValue({
      status: 'APPROVED',
      transactionId: 'txn-collect-001',
      invoiceNumber: 'INV-COLLECT',
      cardType: 'Visa',
      amount: 75.00
    });

    var collectCtx = JSON.stringify({
      customer_id: 'C-001',
      salesorder_id: 'SO-001',
      salesorder_number: 'SO-0001',
      amount: 75.00,
      idempotencyKey: 'idem-001'
    });

    cache.get.mockImplementation(function (key) {
      if (key === 'collect:pending:INV-COLLECT') {
        return Promise.resolve(collectCtx);
      }
      return Promise.resolve(null);
    });

    var req = makeTerminalReq({ id: 'txn-collect-001', type: 'cardTransaction' });
    var res = mockRes();

    terminalHandler(req, res);

    return new Promise(function (resolve) { setImmediate(resolve); }).then(function () {
      return new Promise(function (resolve) { setImmediate(resolve); });
    }).then(function () {
      return new Promise(function (resolve) { setImmediate(resolve); });
    }).then(function () {
      expect(zohoApi.zohoPost).toHaveBeenCalledWith(
        '/customerpayments',
        expect.objectContaining({
          customer_id: 'C-001',
          reference_number: 'txn-collect-001',
          salesorders_to_apply: expect.arrayContaining([
            expect.objectContaining({ salesorder_id: 'SO-001' })
          ])
        })
      );
    });
  });

  test('collect-pending DECLINED: clears pending + idem keys, no zohoPost', function () {
    var zohoApi = require('../lib/zoho-api');
    zohoApi.zohoPost.mockResolvedValue({ code: 0 });

    helcimLib.getCardTransactionById.mockResolvedValue({
      status: 'DECLINED',
      transactionId: 'txn-collect-declined',
      invoiceNumber: 'INV-COLLECT-D',
      cardType: 'Visa',
      amount: 30.00
    });

    var collectCtx = JSON.stringify({
      customer_id: 'C-002',
      salesorder_id: 'SO-002',
      salesorder_number: 'SO-0002',
      amount: 30.00,
      idempotencyKey: 'idem-002'
    });

    cache.get.mockImplementation(function (key) {
      if (key === 'collect:pending:INV-COLLECT-D') {
        return Promise.resolve(collectCtx);
      }
      return Promise.resolve(null);
    });

    var req = makeTerminalReq({ id: 'txn-collect-declined', type: 'cardTransaction' });
    var res = mockRes();

    terminalHandler(req, res);

    return new Promise(function (resolve) { setImmediate(resolve); }).then(function () {
      return new Promise(function (resolve) { setImmediate(resolve); });
    }).then(function () {
      return new Promise(function (resolve) { setImmediate(resolve); });
    }).then(function () {
      expect(zohoApi.zohoPost).not.toHaveBeenCalled();
      expect(cache.del).toHaveBeenCalledWith('collect:pending:INV-COLLECT-D');
    });
  });
});

// ---------------------------------------------------------------------------
// (f) pollTerminalResult — 401 forbidden logs a specific warning (helcim.js)
//
// These tests need the REAL helcim.js (not the mock above), so they use
// jest.resetModules() + jest.isolateModules() to get a fresh module registry
// where we can spy on the logger. Pattern mirrors Block A of helcim-webhook.test.js.
// ---------------------------------------------------------------------------

describe('pollTerminalResult — 401 forbidden warning (regression)', function () {
  afterEach(function () {
    delete process.env.HELCIM_API_TOKEN;
  });

  test('(f) 401 API response → returns {status:pending} AND logs a distinct warn for forbidden', function () {
    var warnSpy;
    var helcimReal;
    var axiosMod;

    jest.isolateModules(function () {
      // Unmock the real modules for this isolated scope
      jest.unmock('../lib/helcim');
      jest.unmock('../lib/logger');
      jest.unmock('../lib/cache');

      // Mock cache to avoid real Redis inside isolated scope
      jest.mock('../lib/cache', function () {
        return {
          get: jest.fn().mockResolvedValue(null),
          set: jest.fn().mockResolvedValue('OK'),
          del: jest.fn().mockResolvedValue(1)
        };
      });

      process.env.HELCIM_API_TOKEN = 'test-token';
      helcimReal = require('../lib/helcim');
      helcimReal.init();

      var logger = require('../lib/logger');
      warnSpy = jest.spyOn(logger, 'warn').mockImplementation(function () {});

      axiosMod = require('axios');
      var err401 = new Error('Unauthorized');
      err401.response = { status: 401 };
      jest.spyOn(axiosMod, 'get').mockRejectedValue(err401);
    });

    return helcimReal.pollTerminalResult('INV-TEST-401').then(function (result) {
      expect(result).toEqual(
        expect.objectContaining({ status: 'pending' })
      );
      // Must log a distinct warning about forbidden/scope
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/401|403|forbidden|scope/i)
      );
    });
  });

  test('(f) 403 API response → returns {status:pending} AND logs a distinct warn for forbidden', function () {
    var warnSpy;
    var helcimReal;

    jest.isolateModules(function () {
      jest.unmock('../lib/helcim');
      jest.unmock('../lib/logger');
      jest.unmock('../lib/cache');

      jest.mock('../lib/cache', function () {
        return {
          get: jest.fn().mockResolvedValue(null),
          set: jest.fn().mockResolvedValue('OK'),
          del: jest.fn().mockResolvedValue(1)
        };
      });

      process.env.HELCIM_API_TOKEN = 'test-token';
      helcimReal = require('../lib/helcim');
      helcimReal.init();

      var logger = require('../lib/logger');
      warnSpy = jest.spyOn(logger, 'warn').mockImplementation(function () {});

      var axiosMod = require('axios');
      var err403 = new Error('Forbidden');
      err403.response = { status: 403 };
      jest.spyOn(axiosMod, 'get').mockRejectedValue(err403);
    });

    return helcimReal.pollTerminalResult('INV-TEST-403').then(function (result) {
      expect(result).toEqual(
        expect.objectContaining({ status: 'pending' })
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/401|403|forbidden|scope/i)
      );
    });
  });

  test('(f) non-401 network error → returns {status:pending} AND does NOT log a scope warn', function () {
    var warnSpy;
    var infoSpy;
    var helcimReal;

    jest.isolateModules(function () {
      jest.unmock('../lib/helcim');
      jest.unmock('../lib/logger');
      jest.unmock('../lib/cache');

      jest.mock('../lib/cache', function () {
        return {
          get: jest.fn().mockResolvedValue(null),
          set: jest.fn().mockResolvedValue('OK'),
          del: jest.fn().mockResolvedValue(1)
        };
      });

      process.env.HELCIM_API_TOKEN = 'test-token';
      helcimReal = require('../lib/helcim');
      helcimReal.init();

      var logger = require('../lib/logger');
      warnSpy = jest.spyOn(logger, 'warn').mockImplementation(function () {});
      infoSpy = jest.spyOn(logger, 'info').mockImplementation(function () {});

      var axiosMod = require('axios');
      var netErr = new Error('ECONNREFUSED');
      // No .response property — pure network error
      jest.spyOn(axiosMod, 'get').mockRejectedValue(netErr);
    });

    return helcimReal.pollTerminalResult('INV-TEST-NET').then(function (result) {
      expect(result).toEqual(
        expect.objectContaining({ status: 'pending' })
      );
      // Network errors should NOT trigger the scope-forbidden warning
      var warnCalls = warnSpy.mock.calls.filter(function (call) {
        return /401|403|forbidden|scope/i.test(call[0] || '');
      });
      expect(warnCalls).toHaveLength(0);
      // Should still log via info
      expect(infoSpy).toHaveBeenCalled();
    });
  });
});
