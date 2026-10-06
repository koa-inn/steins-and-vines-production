'use strict';

/**
 * helcim-webhook-reversal-ignored.test.js — a reversal/refund webhook must
 * never be treated as a new approved charge.
 *
 * Verified live 2026-10-06: reversing test txn 56129497 produced reversal
 * 56129650, and Helcim's webhook for it resolved (via GET
 * /card-transactions/56129650) to status "APPROVED", type "reverse", with the
 * ORIGINAL sale's invoiceNumber ("KIOSK-1791324387910"). The handler keyed
 * everything off status alone, so a reversal would:
 *   - overwrite helcim:terminal:result:<ref> with approved:true + the
 *     reversal id (read by the manual-confirm verify),
 *   - book a Zoho payment if a collect-pending record existed,
 *   - run reconcilePendingCharge for a still-pending kiosk charge,
 *   - or, on a cancelled ref, try to VOID the reversal.
 * Fix: skip reverse/refund/void types before any of that. Unknown types keep
 * the existing behaviour so a real charge is never dropped.
 *
 * Harness cloned from webhook-wr07.test.js.
 */

jest.mock('../lib/reconcile', function () {
  return {
    reconcilePendingCharge: jest.fn().mockResolvedValue(),
    sweepPendingCharges:    jest.fn().mockResolvedValue()
  };
});

// Mock helcim — all methods needed by server startup + webhook route
jest.mock('../lib/helcim', function () {
  return {
    verifyWebhookSignature: jest.fn().mockReturnValue(true),
    isEnabled:             jest.fn().mockReturnValue(false),
    isTerminalEnabled:     jest.fn().mockReturnValue(false),
    getDeviceCode:         jest.fn().mockReturnValue('DEV-WR07'),
    getDepositAmount:      jest.fn().mockReturnValue(0),
    getTerminalDiagnostics:jest.fn().mockReturnValue({}),
    init:                  jest.fn(),
    initializeCheckout:    jest.fn().mockResolvedValue({ checkoutToken: '' }),
    voidTransaction:       jest.fn().mockResolvedValue({ ok: true }),
    refundTransaction:     jest.fn().mockResolvedValue({ ok: true }),
    cancelTerminal:        jest.fn().mockResolvedValue({ ok: false }),
    // Methods needed for the webhook fallback path being tested:
    getCardTransactionById:    jest.fn().mockRejectedValue(new Error('Helcim API unavailable')),
    getPendingInvoiceForDevice:jest.fn().mockResolvedValue('KIOSK-WR07-001'),
    pollTerminalResult:        jest.fn().mockResolvedValue({ status: 'pending', transactionId: null, approved: false, cardType: '' })
  };
});

jest.mock('../lib/zohoAuth', function () {
  return { init: jest.fn().mockResolvedValue(), isAuthenticated: jest.fn().mockReturnValue(true) };
});
jest.mock('../lib/validateEnv', function () { return jest.fn(); });
jest.mock('../lib/checkRedis',  function () { return jest.fn().mockResolvedValue(); });
jest.mock('../lib/checkMailer', function () { return jest.fn(); });
jest.mock('../lib/brewpad-integration', function () {
  return {
    syncBatch: jest.fn(),
    init: jest.fn(),
    retryPendingBatches: jest.fn().mockResolvedValue(),
    retrySyncQueue: jest.fn().mockResolvedValue()
  };
});
jest.mock('node-cron', function () { return { schedule: jest.fn() }; });
jest.mock('@sentry/node', function () {
  return { init: jest.fn(), setupExpressErrorHandler: jest.fn(), captureException: jest.fn() };
});
jest.mock('../lib/cache', function () {
  return {
    get:          jest.fn().mockResolvedValue(null),
    set:          jest.fn().mockResolvedValue('OK'),
    del:          jest.fn().mockResolvedValue(1),
    acquireLock:  jest.fn().mockResolvedValue(true),
    releaseLock:  jest.fn().mockResolvedValue(),
    isConnected:  jest.fn().mockReturnValue(false),
    init:         jest.fn().mockResolvedValue(),
    quit:         jest.fn().mockResolvedValue(),
    getClient:    jest.fn().mockResolvedValue({ keys: jest.fn().mockResolvedValue([]) })
  };
});
jest.mock('../lib/eventLog', function () { return { logEvent: jest.fn() }; });
jest.mock('../lib/logger',   function () {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
});

describe('Helcim cardTransaction webhook — reversals are not charges', function () {
  var request = require('supertest');
  var helcim = require('../lib/helcim');
  var cacheLib = require('../lib/cache');
  var reconcileLib = require('../lib/reconcile');
  var app = require('../server');

  var REF = 'KIOSK-1791324387910';
  var RESULT_KEY = 'helcim:terminal:result:' + REF;

  beforeEach(function () {
    jest.clearAllMocks();
    cacheLib.get.mockResolvedValue(null);
    cacheLib.set.mockResolvedValue('OK');
    cacheLib.del.mockResolvedValue(1);
    helcim.verifyWebhookSignature.mockReturnValue(true);
    helcim.getPendingInvoiceForDevice.mockResolvedValue(null);
    reconcileLib.reconcilePendingCharge.mockResolvedValue();
  });

  function postWebhook(id) {
    return request(app)
      .post('/api/webhooks/terminal')
      .set('webhook-id', 'wh-' + id)
      .set('webhook-timestamp', '1750001000')
      .set('webhook-signature', 'v1,valid')
      .send({ type: 'cardTransaction', id: id })
      .expect(200)
      .then(function () { return new Promise(function (r) { setTimeout(r, 20); }); });
  }

  function resultKeyWrites() {
    return cacheLib.set.mock.calls.filter(function (c) { return c[0] === RESULT_KEY; });
  }

  test.each(['reverse', 'refund', 'void'])('type "%s" + APPROVED: no terminal-result cache write, no reconcile', function (type) {
    helcim.getCardTransactionById.mockResolvedValue({
      status: 'APPROVED', type: type, transactionId: '56129650', invoiceNumber: REF, cardType: 'AX', amount: 1.05
    });
    return postWebhook('56129650').then(function () {
      expect(resultKeyWrites()).toHaveLength(0);
      expect(reconcileLib.reconcilePendingCharge).not.toHaveBeenCalled();
      expect(helcim.voidTransaction).not.toHaveBeenCalled();
    });
  });

  test('type "purchase" + APPROVED still caches the result and reconciles (unchanged)', function () {
    helcim.getCardTransactionById.mockResolvedValue({
      status: 'APPROVED', type: 'purchase', transactionId: '56129497', invoiceNumber: REF, cardType: 'AX', amount: 1.05
    });
    return postWebhook('56129497').then(function () {
      expect(resultKeyWrites()).toHaveLength(1);
      expect(reconcileLib.reconcilePendingCharge).toHaveBeenCalledWith('56129497');
    });
  });

  test('missing type keeps the existing behaviour (never drop a real charge)', function () {
    helcim.getCardTransactionById.mockResolvedValue({
      status: 'APPROVED', transactionId: '56129497', invoiceNumber: REF, cardType: 'AX', amount: 1.05
    });
    return postWebhook('56129497b').then(function () {
      expect(resultKeyWrites()).toHaveLength(1);
      expect(reconcileLib.reconcilePendingCharge).toHaveBeenCalled();
    });
  });
});
